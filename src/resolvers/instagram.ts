/**
 * Optional Instagram resolvers for the Cloudflare Worker.
 *
 * sssInstagram v2 is an UNDOCUMENTED endpoint. The HMAC recipe is based on the
 * older /api/convert protocol and MUST be validated against the current v2
 * browser bundle before it is enabled in production. Never store replayed
 * DevTools signatures or hard-code the signing key.
 *
 * EasyDown and GetInSaver are documented authenticated APIs, both opt-in.
 * These resolvers only return URLs; the existing Worker owns delivery,
 * Telegram retries, D1 deduplication and media limits.
 */
import type { Env } from "../types";
import type {
  ResolvedSocialMedia,
  ResolvedSocialMediaVariant,
  ResolvedSocialMediaType,
} from "../social";

export interface InstagramResolverResult {
  title: string | null;
  caption: string | null;
  authorName: string | null;
  authorUsername: string | null;
  media: ResolvedSocialMedia[];
}

const INSTAGRAM_REFERER = "https://www.instagram.com/";
const SSS_ORIGIN = "https://sssinstagram.com/";
const USER_AGENT = "Mozilla/5.0 (compatible; XTelegramRelay/2; +https://www.instagram.com/)";
const TIMEOUT_MS = 12_000;

type JsonRecord = Record<string, any>;
type MediaCandidate = {
  url: string;
  type: ResolvedSocialMediaType;
  quality: string | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
  contentLength: number | null;
  bitrate: number | null;
  mediaHeaders: Record<string, string>;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function textOrNull(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && !!value.trim())?.trim() ?? null;
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedUsername(value: unknown): string | null {
  const raw = textOrNull(value);
  if (!raw) return null;
  const cleaned = raw.replace(/^@+/, "").trim();
  return /^[\w.]{1,30}$/.test(cleaned) ? `@${cleaned}` : null;
}

/** Do not turn a compromised third-party resolver into an internal SSRF proxy. */
function safeMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&"));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".test") ||
      host.endsWith(".example") ||
      host.endsWith(".invalid") ||
      host.endsWith(".onion") ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      host.includes(":")
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function inferMediaType(item: JsonRecord, url: string): ResolvedSocialMediaType {
  const value = textOrNull(item.type, item.media_type, item.mimeType, item.mime_type, item.mimetype)?.toLowerCase() || "";
  if (item.isVideo === true || item.is_video === true || /video|mp4|mov|reel/.test(value)) return "video";
  if (/audio|mp3|m4a/.test(value)) return "audio";
  if (item.isVideo === false || item.is_video === false || /image|photo|jpg|png|webp/.test(value)) return "photo";
  const pathname = new URL(url).pathname.toLowerCase();
  if (/\.(?:jpe?g|png|webp|avif)$/.test(pathname)) return "photo";
  if (/\.(?:mp3|m4a|aac|ogg)$/.test(pathname)) return "audio";
  return "video";
}

function candidate(value: unknown, kind?: ResolvedSocialMediaType): MediaCandidate | null {
  const entry = typeof value === "string" ? { url: value } : asRecord(value);
  const url = safeMediaUrl(textOrNull(
    entry.url, entry.download_url, entry.downloadUrl, entry.video_url,
    entry.image_url, entry.download, entry.src, entry.href, entry.play,
  ));
  if (!url) return null;
  const type = kind || inferMediaType(entry, url);
  const host = new URL(url).hostname.toLowerCase();
  const mediaHeaders: Record<string, string> = {};
  if (host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net")) {
    mediaHeaders.Referer = INSTAGRAM_REFERER;
  }
  const thumb = safeMediaUrl(textOrNull(entry.thumbnail, entry.thumbnail_url, entry.cover, entry.poster));
  return {
    url, type,
    quality: textOrNull(entry.quality, entry.resolution, entry.label),
    width: positiveNumber(entry.width),
    height: positiveNumber(entry.height),
    thumbnail: thumb,
    contentLength: positiveNumber(entry.filesize ?? entry.size ?? entry.contentLength),
    bitrate: positiveNumber(entry.bitrate),
    mediaHeaders,
  };
}

function collectCandidates(
  raw: unknown,
  results: MediaCandidate[],
  depth = 0,
  kind?: ResolvedSocialMediaType,
): void {
  if (results.length >= 30 || depth > 5 || raw == null) return;
  if (Array.isArray(raw)) {
    for (const value of raw.slice(0, 30)) collectCandidates(value, results, depth + 1, kind);
    return;
  }
  const entry = asRecord(raw);
  const media = candidate(raw, kind);
  if (media) results.push(media);

  // Only follow documented media-bearing fields, not covers, avatars,
  // suggested posts, thumbnails or other unrelated URLs in response metadata.
  for (const key of ["items", "medias", "media", "results", "result", "data", "carousel", "carousel_media", "resources"]) {
    if (entry[key]) collectCandidates(entry[key], results, depth + 1);
  }
  for (const [field, type] of [
    ["videos", "video"], ["images", "photo"], ["audios", "audio"],
  ] as const) {
    if (entry[field]) collectCandidates(entry[field], results, depth + 1, type);
  }
}

export function normalizeInstagramMedia(
  payload: unknown,
  options: { reelOnly?: boolean } = {},
): ResolvedSocialMedia[] {
  const candidates: MediaCandidate[] = [];
  collectCandidates(payload, candidates);
  const seen = new Set<string>();
  const media: ResolvedSocialMedia[] = [];
  for (const item of candidates) {
    if (options.reelOnly && item.type !== "video") continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const variant: ResolvedSocialMediaVariant = { ...item };
    media.push({ ...variant, index: media.length, variants: [variant] });
  }
  return media;
}

function isInstagramStory(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(^|\.)instagram\.com$/i.test(parsed.hostname)) return false;
    return /^\/stories\/(?!highlights\/)[\w.]+\/\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isReel(url: string): boolean {
  try { return /^\/reels?\//i.test(new URL(url).pathname); }
  catch { return false; }
}

async function postJson(endpoint: string, body: JsonRecord, headers: Record<string, string>): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    // Never include provider response bodies or signed URLs in logged failures.
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => null);
    if (data == null || typeof data !== "object") throw new Error("Invalid JSON payload");
    return data as JsonRecord;
  } finally {
    clearTimeout(timer);
  }
}

async function signSss(url: string, timestamp: number, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${url}${timestamp}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveSssInstagramStory(url: string, env: Env): Promise<InstagramResolverResult> {
  if (!isInstagramStory(url)) throw new Error("sssInstagram v2 story requires a specific Story URL");
  const key = env.SSSINSTAGRAM_HMAC_KEY?.trim();
  const buildTs = Number(env.SSSINSTAGRAM_BUILD_TS);
  if (!key || !Number.isSafeInteger(buildTs) || buildTs <= 0) {
    throw new Error("sssInstagram signing parameters are not configured");
  }
  const ts = Date.now();
  const data = await postJson(
    "https://api-wh.sssinstagram.com/api/v2/instagram/story",
    {
      url, ts, _ts: buildTs, _tsc: 0, _sv: 2,
      _s: await signSss(url, ts, key),
    },
    { Origin: SSS_ORIGIN.slice(0, -1), Referer: SSS_ORIGIN, "User-Agent": USER_AGENT },
  );
  if (data.error || data.success === false) throw new Error("sssInstagram rejected the signed request");
  const media = normalizeInstagramMedia(data);
  if (!media.length) throw new Error("sssInstagram returned no downloadable media");
  return {
    title: textOrNull(data.title, data.data?.title),
    caption: textOrNull(data.caption, data.data?.caption),
    authorName: textOrNull(data.author?.name, data.data?.author?.name),
    authorUsername: normalizedUsername(data.author?.username ?? data.data?.author?.username),
    media,
  };
}

export async function resolveEasyDownInstagram(url: string, env: Env): Promise<InstagramResolverResult> {
  const key = env.EASYDOWN_API_KEY?.trim();
  if (!key) throw new Error("EASYDOWN_API_KEY is not configured");
  const payload = await postJson(
    "https://api.easydown.org/api/v1/platforms/instagram/parse",
    { url },
    { Authorization: `Bearer ${key}` },
  );
  if (payload.status && Number(payload.status) !== 200) {
    throw new Error(`EasyDown status ${Number(payload.status)}`);
  }
  const root = asRecord(payload.data);
  const normalized = asRecord(root.media);
  const platform = asRecord(root.platformData);
  const user = asRecord(platform.user);
  const media = normalizeInstagramMedia(normalized, { reelOnly: isReel(url) });
  if (!media.length) throw new Error("EasyDown returned no downloadable media");
  return {
    title: textOrNull(normalized.title, root.title),
    caption: textOrNull(platform.caption?.text, platform.caption?.content, root.title),
    authorName: textOrNull(user.full_name, user.fullName),
    authorUsername: normalizedUsername(user.username),
    media,
  };
}

export async function resolveGetInSaverInstagram(url: string, env: Env): Promise<InstagramResolverResult> {
  const key = env.GETINSAVER_API_KEY?.trim();
  if (!key) throw new Error("GETINSAVER_API_KEY is not configured");
  const service = isInstagramStory(url)
    ? "instagram-story"
    : /\/stories\/highlights\//i.test(new URL(url).pathname)
      ? "instagram-highlight"
      : "instagram";
  // A small credit reservation for Stories, while keeping carousel support.
  const maxResults = service === "instagram" ? 10 : 1;
  const data = await postJson(
    "https://developers.getinsaver.com/v1/resolve",
    { service, url, max_results: maxResults },
    { Authorization: `Bearer ${key}` },
  );
  if (data.ok !== true) throw new Error("GetInSaver resolution failed");
  const media = normalizeInstagramMedia({ items: data.items }, { reelOnly: isReel(url) });
  if (!media.length) throw new Error("GetInSaver returned no downloadable media");
  const metadata = asRecord(data.metadata);
  return {
    title: textOrNull(metadata.title),
    caption: textOrNull(metadata.caption),
    authorName: textOrNull(metadata.author),
    authorUsername: normalizedUsername(metadata.username ?? metadata.author),
    media,
  };
}

export function supportsSssInstagramStory(url: string, env: Env): boolean {
  return isInstagramStory(url) &&
    Boolean(env.SSSINSTAGRAM_HMAC_KEY?.trim()) &&
    Number.isSafeInteger(Number(env.SSSINSTAGRAM_BUILD_TS)) &&
    Number(env.SSSINSTAGRAM_BUILD_TS) > 0;
}
