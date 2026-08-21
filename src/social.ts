import type { Env, MediaType } from "./types";
import { debugError, debugUrl, relayDebug } from "./lib/debug";

export type SocialProvider = "instagram" | "twitter" | "tiktok";
export type ResolvedSocialMediaType = "video" | "photo" | "audio";

export interface ResolvedSocialMedia {
  index: number;
  url: string;
  type: ResolvedSocialMediaType;
  quality: string | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
  /** Headers used when the relay itself must fetch the resolved CDN URL. */
  mediaHeaders: Record<string, string>;
}

export interface ResolverAttempt {
  provider: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface SocialResolution {
  source: SocialProvider;
  sourceUrl: string;
  resolver: string;
  title: string | null;
  caption: string | null;
  media: ResolvedSocialMedia[];
  attempts: ResolverAttempt[];
}

export interface SocialResolveOptions {
  /** A client-captured X handle used only if public syndication is unavailable. */
  twitterHandleHint?: string;
  /** Correlates resolver steps with the original Worker request. */
  traceId?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PROVIDER_TIMEOUT_MS = 15_000;

export function detectSocialProvider(value: string): SocialProvider | null {
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) return "instagram";
  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "twitter";
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  return null;
}

export async function resolveSocialMedia(
  sourceUrl: string,
  env: Env,
  options: SocialResolveOptions = {},
): Promise<SocialResolution> {
  const source = detectSocialProvider(sourceUrl);
  if (!source) throw new Error("Unsupported social URL. Supported: Instagram, Twitter/X, TikTok.");
  const traceId = String(options.traceId || "social");
  relayDebug(env, traceId, "social.detected", {
    provider: source,
    sourceUrl: debugUrl(sourceUrl),
    hasTwitterHandleHint: Boolean(options.twitterHandleHint),
  });

  // The X client can legitimately emit /i/status/:id from an immersive viewer
  // or a virtualized Bookmarks card. Turn that internal shell URL into a
  // public author/status URL before calling Twirrl/DTwitter; those providers
  // commonly reject the internal form even though the Tweet itself is public.
  const canonicalSourceUrl = source === "twitter"
    ? await canonicalizeTwitterUrl(sourceUrl, options.twitterHandleHint)
    : sourceUrl;
  relayDebug(env, traceId, "social.canonicalized", {
    provider: source,
    sourceUrl: debugUrl(sourceUrl),
    canonicalSourceUrl: debugUrl(canonicalSourceUrl),
    changed: canonicalSourceUrl !== sourceUrl,
  });

  const attempts: ResolverAttempt[] = [];
  const providers = source === "instagram"
    ? [{ id: "zoraahub", run: () => resolveZoraaHub(canonicalSourceUrl) }]
    : source === "twitter"
      ? [
          
          { id: "dtwitter", run: () => resolveDTwitter(canonicalSourceUrl) },
          { id: "twirrl", run: () => resolveTwirrl(canonicalSourceUrl, env.TWIRRL_VERSION_TOKEN) },

        ]
      : [{ id: "dtiktok", run: () => resolveDTikTok(canonicalSourceUrl) }];

  for (const provider of providers) {
    const startedAt = Date.now();
    relayDebug(env, traceId, "social.resolver.started", {
      provider: provider.id,
      source,
      sourceUrl: debugUrl(canonicalSourceUrl),
    });
    try {
      const result = await provider.run();
      if (!result.media.length) throw new Error("Resolver returned no usable media");
      const durationMs = Date.now() - startedAt;
      attempts.push({ provider: provider.id, ok: true, durationMs });
      relayDebug(env, traceId, "social.resolver.succeeded", {
        provider: provider.id,
        durationMs,
        mediaCount: result.media.length,
        mediaTypes: result.media.map((item) => item.type),
      });
      return { source, sourceUrl: canonicalSourceUrl, resolver: provider.id, attempts, ...result };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = errorMessage(error);
      attempts.push({ provider: provider.id, ok: false, durationMs, error: message });
      relayDebug(env, traceId, "social.resolver.failed", {
        provider: provider.id,
        durationMs,
        error: debugError(error),
      });
    }
  }

  relayDebug(env, traceId, "social.all-resolvers-failed", {
    provider: source,
    attemptCount: attempts.length,
    attempts: attempts.map((attempt) => ({
      provider: attempt.provider,
      ok: attempt.ok,
      durationMs: attempt.durationMs,
      error: attempt.error || null,
    })),
  });
  throw new SocialResolverError(`All ${source} resolvers failed`, attempts);
}

export class SocialResolverError extends Error {
  constructor(message: string, public readonly attempts: ResolverAttempt[]) {
    super(message);
    this.name = "SocialResolverError";
  }
}

async function resolveZoraaHub(sourceUrl: string) {
  const data = await fetchJson<any>("https://api.zoraahub.com/fetch.php", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://downreels.com",
      Referer: "https://downreels.com/",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ url: sourceUrl }),
  });

  if (!data || String(data.status || "").toLowerCase() !== "ok") {
    throw new Error(data?.message || data?.error || "ZoraaHub returned an unsuccessful response");
  }

  const media = array(data.videos).map((item: any, index) => {
    const rawUrl = firstString(item?.url, item?.download, item?.downloadUrl, item?.src);
    const url = normalizeProviderUrl(rawUrl);
    if (!url) return null;
    const nested = unwrapKnownProxyUrl(url);
    return mediaItem(index, nested || url, inferType(item?.isVideo ?? item?.is_video, item?.type, nested || url), item);
  }).filter(isMedia);

  return {
    title: firstString(data.title, data.meta?.title),
    caption: firstString(data.caption, data.description),
    media,
  };
}

async function resolveTwirrl(sourceUrl: string, token?: string) {
  const media = await fetchTwirrlVariants(sourceUrl, token);
  const selected = media.map((variants) => variants[0]).filter((item): item is ResolvedSocialMedia => Boolean(item));

  if (!selected.length) {
    throw new Error("Twirrl returned no valid video variants");
  }

  return { title: "Twitter video", caption: null, media: selected };
}

/**
 * Re-queries Twirrl only when the primary X media exceeds the Worker upload
 * budget. The returned variants retain the source aspect hint, allowing the
 * caller to choose a lower-quality URL without changing the video geometry.
 *
 * @example
 * Input: an X status URL whose best video is too large for the Worker.
 * Output: the closest medium-quality Twirrl variant, or null when unavailable.
 */
export async function resolveTwitterMediumMedia(
  sourceUrl: string,
  token?: string,
): Promise<ResolvedSocialMedia | null> {
  const variantGroups = await fetchTwirrlVariants(sourceUrl, token);
  const candidates = variantGroups
    .flat()
    .filter((item) => item.type === "video");

  if (!candidates.length) return null;

  const explicitlyMedium = candidates
    .filter((item) => isMediumQualityLabel(item.quality))
    .sort((left, right) => compareTwitterVideoVariants(
      left,
      right,
      twitterAspectHint(candidates[0]),
    ));

  if (explicitlyMedium[0]) return explicitlyMedium[0];

  const ranked = [...candidates].sort((left, right) => {
    const leftArea = (left.width || 0) * (left.height || 0);
    const rightArea = (right.width || 0) * (right.height || 0);
    return leftArea - rightArea;
  });

  if (ranked.length === 1) return ranked[0] || null;

  // Prefer the middle of the available quality ladder. This is intentionally
  // not tied to a fixed pixel height because X/Twirrl can expose portrait,
  // landscape, and unusual source dimensions.
  return ranked[Math.floor((ranked.length - 1) / 2)] || null;
}

async function fetchTwirrlVariants(
  sourceUrl: string,
  token?: string,
): Promise<ResolvedSocialMedia[][]> {
  const body: Record<string, string> = { u: sourceUrl, o: "iOS" };
  if (token?.trim()) body.v = token.trim();

  const data = await fetchJson<any>("https://api.twirrl.app/video", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  const groups: ResolvedSocialMedia[][] = [];

  for (const [mediaIndex, item] of array(data?.d?.i).entries()) {
    if (!item || typeof item !== "object") continue;

    const seen = new Set<string>();
    const variants: ResolvedSocialMedia[] = [];

    for (const value of Object.values(item as Record<string, any>)) {
      const url = normalizeProviderUrl(value?.u);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const resolution = resolutionFromUrl(url);
      variants.push({
        index: mediaIndex,
        url,
        type: "video",
        quality: firstString(
          value?.quality,
          value?.resolution,
          resolution.label,
          "best",
        ),
        width:
          numberOrNull(
            value?.width ??
            value?.w ??
            value?.original_width,
          ) || resolution.width,
        height:
          numberOrNull(
            value?.height ??
            value?.h ??
            value?.original_height,
          ) || resolution.height,
        thumbnail: null,
        mediaHeaders: mediaHeadersForUrl(url),
      });
    }

    variants.sort((left, right) =>
      compareTwitterVideoVariants(
        left,
        right,
        twitterAspectHint(item),
      ),
    );

    if (variants.length) groups.push(variants);
  }

  if (!groups.length) {
    throw new Error(
      data?.error ||
      data?.message ||
      "Twirrl returned no valid video variants",
    );
  }

  return groups;
}

function isMediumQualityLabel(value: string | null): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return /^(?:medium|med|mid|480p|540p|720p)$/.test(normalized);
}

async function resolveDTwitter(sourceUrl: string) {
  const version = { dtwitter: { api: "https://dtwitter.heismauri.com/" }, id: "6166", name: "DTwitter", version: "4.2.1" };
  const selector = { selector: false };

  // Match the Apple Shortcuts "Form" request as closely as possible.
  // Do not set Content-Type manually: fetch adds the multipart boundary.
  const body = new FormData();
  body.set("url", sourceUrl);
  body.set("version", JSON.stringify(version));
  body.set("selector", JSON.stringify(selector));

  const data = await fetchJson<any>("https://dtwitter.heismauri.com/", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && status !== "success") throw new Error(data?.error || data?.message || `DTwitter status ${status}`);

  const candidates = array(data?.media).map((item: any, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(undefined, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!candidates.length) throw new Error(data?.error || data?.message || "DTwitter returned no media");

  const videos = candidates.filter((item) => item.type === "video");
  videos.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  return { title: "Twitter media", caption: null, media: videos.length ? [videos[0]!] : candidates };
}

async function resolveDTikTok(sourceUrl: string) {
  // DTikTok's own Worker validates a canonical URL in the form
  // https://www.tiktok.com/@user/video/<id> (or /photo/<id>).
  // Share-sheet URLs are often vt.tiktok.com / vm.tiktok.com, so resolve
  // redirects first instead of handing the short URL directly to DTikTok.
  const canonicalSourceUrl = await canonicalizeTikTokUrl(sourceUrl);

  const body = new FormData();
  body.set("url", canonicalSourceUrl);
  body.set("version", "4.3.3");

  const data = await fetchJson<any>("https://dtiktok.heismauri.com/", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && !["success", "ok", "true"].includes(status)) throw new Error(data?.error || data?.message || `DTikTok status ${status}`);

  const media = array(data?.media).map((item: any, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(undefined, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!media.length) throw new Error(data?.error || data?.message || "DTikTok returned no media");
  return { title: "TikTok", caption: null, media };
}

function mediaItem(index: number, url: string, type: ResolvedSocialMediaType, item: any): ResolvedSocialMedia {
  const explicitWidth = numberOrNull(item?.width);
  const explicitHeight = numberOrNull(item?.height);
  const fromUrl = resolutionFromUrl(url);
  const width = explicitWidth || fromUrl.width;
  const height = explicitHeight || fromUrl.height;

  return {
    index,
    url,
    type,
    quality: firstString(item?.quality, item?.resolution, width && height ? `${width}x${height}` : null),
    width,
    height,
    thumbnail: firstString(item?.thumbnail, item?.thumb, item?.poster, item?.cover),
    mediaHeaders: mediaHeadersForUrl(url),
  };
}

function twitterAspectHint(value: any): number | null {
  const width = numberOrNull(
    value?.width ??
    value?.w ??
    value?.original_width ??
    value?.originalWidth,
  );
  const height = numberOrNull(
    value?.height ??
    value?.h ??
    value?.original_height ??
    value?.originalHeight,
  );
  return width && height ? width / height : null;
}

function compareTwitterVideoVariants(
  left: ResolvedSocialMedia,
  right: ResolvedSocialMedia,
  expectedAspect: number | null,
): number {
  if (expectedAspect && expectedAspect > 0) {
    const leftAspect = left.width && left.height ? left.width / left.height : 0;
    const rightAspect = right.width && right.height ? right.width / right.height : 0;
    const leftDistance = leftAspect
      ? Math.abs(Math.log(leftAspect / expectedAspect))
      : Number.POSITIVE_INFINITY;
    const rightDistance = rightAspect
      ? Math.abs(Math.log(rightAspect / expectedAspect))
      : Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  }
  return ((right.width || 0) * (right.height || 0)) -
    ((left.width || 0) * (left.height || 0));
}

function inferType(isVideo: unknown, rawType: unknown, url: string): ResolvedSocialMediaType {
  if (typeof isVideo === "boolean") return isVideo ? "video" : "photo";
  const type = String(rawType || "").toLowerCase();
  if (["image", "photo", "picture"].includes(type)) return "photo";
  if (["audio", "music", "mp3"].includes(type)) return "audio";
  if (["video", "mp4", "movie"].includes(type)) return "video";
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); } })();
  if (/\.(jpe?g|png|webp|avif|gif)$/.test(path)) return "photo";
  if (/\.(mp3|m4a|aac|ogg|wav|flac)$/.test(path)) return "audio";
  return "video";
}

function unwrapKnownProxyUrl(value: string): string {
  try {
    let current = value;
    for (let i = 0; i < 4; i += 1) {
      const parsed = new URL(current);
      const keys = parsed.hostname === "media.zoraahub.com" && parsed.pathname.toLowerCase().includes("/download.php")
        ? ["url"] : ["mediaUrl", "media_url", "target", "source", "src", "url"];
      const nested = keys.map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!nested) break;
      const decoded = decodeRepeatedly(nested);
      if (!/^https?:\/\//i.test(decoded) || decoded === current) break;
      current = decoded;
    }
    return current;
  } catch { return value; }
}

function normalizeProviderUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  // CRITICAL: media CDN URLs are frequently signed. Never run
  // decodeURIComponent() over the complete URL and never return new URL(...).href,
  // because either operation can change an encoded query value and invalidate the
  // signature. Only undo JSON slash escaping / HTML ampersands, then validate.
  const raw = value
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");

  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? raw
      : null;
  } catch {
    return null;
  }
}

function mediaHeadersForUrl(url: string): Record<string, string> {
  let hostname = "";

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { "User-Agent": USER_AGENT };
  }

  if (hostname === "video.twimg.com" || hostname.endsWith(".twimg.com")) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://x.com/",
    };
  }

  if (
    hostname.endsWith(".tiktok.com") ||
    hostname.endsWith(".tiktokcdn.com") ||
    hostname.endsWith(".tiktokcdn-us.com")
  ) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://www.tiktok.com/",
    };
  }

  if (
    hostname.endsWith(".cdninstagram.com") ||
    hostname.endsWith(".fbcdn.net")
  ) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://www.instagram.com/",
    };
  }

  return { "User-Agent": USER_AGENT };
}

async function canonicalizeTwitterUrl(sourceUrl: string, handleHint = ""): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!(host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com"))) {
    return sourceUrl;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => /^(?:status|statuses)$/i.test(part));
  const tweetId = statusIndex >= 0 ? String(parts[statusIndex + 1] || "") : "";
  if (!/^\d{5,}$/.test(tweetId)) return sourceUrl;

  const directHandle = cleanTwitterHandle(parts[statusIndex - 1] || "");
  if (directHandle) return `https://x.com/${directHandle}/status/${tweetId}`;

  // The internal path does not contain an author. Syndication is a compact
  // public Tweet lookup and avoids sending a malformed /i/status URL to an
  // external media resolver.
  const resolvedHandle = await twitterHandleFromSyndication(tweetId);
  const hintedHandle = cleanTwitterHandle(handleHint);
  return resolvedHandle
    ? `https://x.com/${resolvedHandle}/status/${tweetId}`
    : hintedHandle
      ? `https://x.com/${hintedHandle}/status/${tweetId}`
    : `https://x.com/i/status/${tweetId}`;
}

function cleanTwitterHandle(value: unknown): string {
  const handle = String(value || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return "";
  return ["i", "web", "intent", "share", "search", "home", "explore"].includes(handle.toLowerCase())
    ? ""
    : handle;
}

async function twitterHandleFromSyndication(tweetId: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Twitter canonicalization timeout"), 4_500);
  try {
    const token = Math.random().toString(36).slice(2, 14);
    const response = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=${encodeURIComponent(token)}`,
      {
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://x.com/",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: controller.signal,
      },
    );
    if (!response.ok) return "";
    const data = await response.json() as Record<string, any>;
    return cleanTwitterHandle(
      firstString(
        data?.user?.screen_name,
        data?.user?.username,
        data?.screen_name,
      ),
    );
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function canonicalizeTikTokUrl(sourceUrl: string): Promise<string> {
  const canonicalPattern =
    /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d{8,}/i;

  if (canonicalPattern.test(sourceUrl)) {
    return sourceUrl;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("TikTok canonicalization timeout"), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
    });

    const finalUrl = response.url || sourceUrl;

    if (canonicalPattern.test(finalUrl)) {
      return finalUrl;
    }

    // Some TikTok responses expose the canonical URL in HTML even when the
    // redirect chain terminates on an interstitial. Read only a bounded prefix.
    const html = (await response.text()).slice(0, 250_000);
    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    );

    if (canonicalMatch?.[1] && canonicalPattern.test(canonicalMatch[1])) {
      return canonicalMatch[1].replace(/&amp;/gi, "&");
    }
  } catch {
    // Keep the original URL so DTikTok can return a useful provider error.
  } finally {
    clearTimeout(timer);
  }

  return sourceUrl;
}

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    try { const next = decodeURIComponent(current); if (next === current) break; current = next; } catch { break; }
  }
  return current;
}

function resolutionFromUrl(url: string) {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})(?:\/|$)/i);
  if (!match) return { width: null, height: null, label: null };
  const width = Number(match[1]); const height = Number(match[2]);
  return { width, height, label: `${width}x${height}` };
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("resolver timeout"), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text) as T; } catch { throw new Error(`Resolver returned non-JSON: ${text.slice(0, 300)}`); }
  } finally { clearTimeout(timer); }
}

function array<T>(value: T[] | null | undefined): T[] { return Array.isArray(value) ? value : []; }
function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
function numberOrNull(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function isMedia(value: ResolvedSocialMedia | null): value is ResolvedSocialMedia { return Boolean(value?.url); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function toRelayMediaType(type: ResolvedSocialMediaType): MediaType { return type === "photo" ? "photo" : type; }
