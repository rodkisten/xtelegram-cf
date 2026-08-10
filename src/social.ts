import type { Env, MediaType } from "./types";

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

export async function resolveSocialMedia(sourceUrl: string, env: Env): Promise<SocialResolution> {
  const source = detectSocialProvider(sourceUrl);
  if (!source) throw new Error("Unsupported social URL. Supported: Instagram, Twitter/X, TikTok.");

  const attempts: ResolverAttempt[] = [];
  const providers = source === "instagram"
    ? [{ id: "zoraahub", run: () => resolveZoraaHub(sourceUrl) }]
    : source === "twitter"
      ? [
          { id: "twirrl", run: () => resolveTwirrl(sourceUrl, env.TWIRRL_VERSION_TOKEN) },
          { id: "dtwitter", run: () => resolveDTwitter(sourceUrl) },
        ]
      : [{ id: "dtiktok", run: () => resolveDTikTok(sourceUrl) }];

  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      const result = await provider.run();
      if (!result.media.length) throw new Error("Resolver returned no usable media");
      attempts.push({ provider: provider.id, ok: true, durationMs: Date.now() - startedAt });
      return { source, sourceUrl, resolver: provider.id, attempts, ...result };
    } catch (error) {
      attempts.push({ provider: provider.id, ok: false, durationMs: Date.now() - startedAt, error: errorMessage(error) });
    }
  }

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
  const body: Record<string, string> = { u: sourceUrl, o: "iOS" };
  if (token?.trim()) body.v = token.trim();

  const data = await fetchJson<any>("https://api.twirrl.app/video", {
    method: "POST",
    headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  });

  const seen = new Set<string>();
  const variants: ResolvedSocialMedia[] = [];
  for (const item of array(data?.d?.i)) {
    if (!item || typeof item !== "object") continue;
    for (const value of Object.values(item as Record<string, any>)) {
      const url = normalizeProviderUrl(value?.u);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const resolution = resolutionFromUrl(url);
      variants.push({ index: variants.length, url, type: "video", quality: resolution.label || "best", width: resolution.width, height: resolution.height, thumbnail: null });
    }
  }
  variants.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  if (!variants.length) throw new Error(data?.error || data?.message || "Twirrl returned no valid video variants");

  return { title: "Twitter video", caption: null, media: [variants[0]!] };
}

async function resolveDTwitter(sourceUrl: string) {
  const version = { dtwitter: { api: "https://dtwitter.heismauri.com/" }, id: "6166", name: "DTwitter", version: "4.2.1" };
  const selector = { selector: false };
  const body = new URLSearchParams({ url: sourceUrl, version: JSON.stringify(version), selector: JSON.stringify(selector) });
  const data = await fetchJson<any>("https://dtwitter.heismauri.com/", {
    method: "POST",
    headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": USER_AGENT },
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
  const body = new URLSearchParams({ url: sourceUrl, version: "4.3.3" });
  const data = await fetchJson<any>("https://dtiktok.heismauri.com", {
    method: "POST",
    headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": USER_AGENT },
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
  };
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
  const decoded = decodeRepeatedly(value.trim());
  try {
    const url = new URL(decoded);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
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
