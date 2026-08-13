import type { Env, ParseMode } from "../types";

export type SocialPlatform = "twitter" | "instagram";

export interface SocialPostMetadata {
  platform: SocialPlatform;
  origin: "X" | "Instagram";
  sourceUrl: string;
  author: string | null;
  caption: string | null;
  strategy: string;
  enriched: boolean;
}

export interface SocialDeliveryContent {
  caption: string;
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
  social: SocialPostMetadata | null;
}

interface SocialDeliveryInput {
  provider?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  caption: string;
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
}

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 256;
const MAX_SOCIAL_CAPTION_TEXT = 820;

const cache = new Map<string, { expiresAt: number; value: SocialPostMetadata }>();
const inFlight = new Map<string, Promise<SocialPostMetadata>>();

/**
 * Enrich Telegram captions for Instagram and Twitter/X server-side.
 *
 * Social posts deliberately ignore the caller's fallback title/text caption.
 * When public metadata cannot be recovered, the only caption is the original
 * post URL, which keeps the behavior deterministic and avoids sending guessed
 * or unrelated page text.
 */
export async function resolveSocialDeliveryContent(
  input: SocialDeliveryInput,
  env: Env,
): Promise<SocialDeliveryContent> {
  const target = resolveSocialTarget(input);
  if (!target) {
    return {
      caption: input.caption,
      parseMode: input.parseMode,
      metadata: input.metadata,
      social: null,
    };
  }

  let social: SocialPostMetadata;
  try {
    social = await resolveSocialPostMetadata(target.platform, target.url, env);
  } catch (error) {
    console.warn("[media-relay] Social metadata enrichment failed", {
      platform: target.platform,
      sourceUrl: target.url,
      error: error instanceof Error ? error.message : String(error),
    });
    social = fallbackMetadata(target.platform, target.url, "fetch-error");
  }

  const hasMetadata = Boolean(social.author || social.caption);
  const caption = hasMetadata
    ? buildRichCaption(social)
    : target.url;
  const metadata = mergeMetadata(input.metadata, {
    socialPlatform: social.platform,
    socialOrigin: social.origin,
    socialSourceUrl: social.sourceUrl,
    socialAuthor: social.author || "",
    socialCaption: social.caption || "",
    socialMetadataStrategy: social.strategy,
    socialMetadataEnriched: hasMetadata ? "true" : "false",
  });

  return {
    caption,
    parseMode: hasMetadata ? "HTML" : null,
    metadata,
    social,
  };
}

export async function resolveSocialPostMetadata(
  platform: SocialPlatform,
  sourceUrl: string,
  env: Env,
): Promise<SocialPostMetadata> {
  const key = `${platform}:${canonicalLookupUrl(platform, sourceUrl)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cache.delete(key);

  const running = inFlight.get(key);
  if (running) return running;

  const promise = (async () => {
    const value = platform === "twitter"
      ? await resolveTwitterMetadata(sourceUrl, env)
      : await resolveInstagramMetadata(sourceUrl, env);
    remember(key, value);
    return value;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

function resolveSocialTarget(input: SocialDeliveryInput): {
  platform: SocialPlatform;
  url: string;
} | null {
  const provider = String(input.provider || "").toLowerCase();
  const candidates = [input.pageUrl, input.sourceUrl]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));

  for (const value of candidates) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if ((host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) && /\/status\/\d+/i.test(url.pathname)) {
        return { platform: "twitter", url: normalizeTwitterPostUrl(url) };
      }
      if ((host === "instagram.com" || host.endsWith(".instagram.com")) && /\/(?:p|reel|tv)\/[^/?#]+/i.test(url.pathname)) {
        return { platform: "instagram", url: normalizeInstagramPostUrl(url) };
      }
    } catch {}
  }

  const platform: SocialPlatform | null =
    provider === "twitter" || provider === "x" ? "twitter" :
    provider === "instagram" ? "instagram" : null;
  if (!platform) return null;

  const fallback = candidates[0];
  if (!fallback) return null;
  try {
    const parsed = new URL(fallback);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return { platform, url: parsed.href };
  } catch {
    return null;
  }
}

async function resolveTwitterMetadata(sourceUrl: string, env: Env): Promise<SocialPostMetadata> {
  const normalized = normalizeTwitterPostUrl(new URL(sourceUrl));
  const parsed = new URL(normalized);
  const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  const usernameFromUrl = cleanUsername(match?.[1] || "");
  const tweetId = match?.[2] || "";

  if (tweetId) {
    try {
      const token = randomToken();
      const data = await fetchJson(
        `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=${encodeURIComponent(token)}`,
        resolveTimeoutMs(env),
      );
      const author = cleanUsername(
        stringValue(data?.user?.screen_name) ||
        stringValue(data?.user?.username) ||
        stringValue(data?.screen_name),
      );
      const caption = cleanCaption(
        stringValue(data?.text) ||
        stringValue(data?.full_text) ||
        stringValue(data?.tweet?.text),
      );
      if (author || caption) {
        return {
          platform: "twitter",
          origin: "X",
          sourceUrl: normalized,
          author: author ? `@${author}` : null,
          caption: caption || null,
          strategy: "twitter-syndication",
          enriched: true,
        };
      }
    } catch (error) {
      console.debug("[media-relay] Twitter syndication metadata failed", {
        sourceUrl: normalized,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const html = await fetchHtml(normalized, resolveTimeoutMs(env));
    const ogTitle = metaContent(html, "og:title");
    const ogDescription = metaContent(html, "og:description") || metaContent(html, "twitter:description");
    const author = cleanUsername(
      firstMatch(ogTitle, [/@([A-Za-z0-9_]{1,15})/, /\((?:@)?([A-Za-z0-9_]{1,15})\)/]),
    );
    const caption = cleanCaption(ogDescription);
    if (author || caption) {
      return {
        platform: "twitter",
        origin: "X",
        sourceUrl: normalized,
        author: author ? `@${author}` : null,
        caption: caption || null,
        strategy: "twitter-html-meta",
        enriched: true,
      };
    }
  } catch (error) {
    console.debug("[media-relay] Twitter page metadata failed", {
      sourceUrl: normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fallbackMetadata("twitter", normalized, "url-fallback");
}

async function resolveInstagramMetadata(sourceUrl: string, env: Env): Promise<SocialPostMetadata> {
  const normalized = normalizeInstagramPostUrl(new URL(sourceUrl));
  try {
    const html = await fetchHtml(normalized, resolveTimeoutMs(env));
    const ogTitle = metaContent(html, "og:title") || metaContent(html, "twitter:title");
    const ogDescription = metaContent(html, "og:description") || metaContent(html, "twitter:description");

    const embeddedUsername = extractJsonString(html, "username");
    const usernameFromMeta = firstMatch(`${ogTitle}\n${ogDescription}`, [
      /@([A-Za-z0-9._]{1,30})/,
      /(?:^|[-–—]\s*)([A-Za-z0-9._]{1,30})\s+on\s+Instagram\b/i,
      /^([A-Za-z0-9._]{1,30})\s+on\s+Instagram\b/i,
    ]);
    const author = cleanUsername(usernameFromMeta || embeddedUsername || "");

    const embeddedCaption =
      extractJsonStringAfterKey(html, "caption", "text") ||
      extractJsonString(html, "caption_text");
    const caption = cleanCaption(
      embeddedCaption ||
      instagramCaptionFromMeta(ogTitle, ogDescription, author),
    );

    if (author || caption) {
      return {
        platform: "instagram",
        origin: "Instagram",
        sourceUrl: normalized,
        author: author ? `@${author}` : null,
        caption: caption || null,
        strategy: embeddedCaption || embeddedUsername ? "instagram-embedded-json" : "instagram-html-meta",
        enriched: true,
      };
    }
  } catch (error) {
    console.debug("[media-relay] Instagram page metadata failed", {
      sourceUrl: normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fallbackMetadata("instagram", normalized, "url-fallback");
}

function instagramCaptionFromMeta(title: string, description: string, author: string): string {
  const candidates = [description, title].map((value) => cleanCaption(value)).filter(Boolean);
  for (const candidate of candidates) {
    let text = candidate;
    // Typical public Instagram metadata forms include either
    // "username on Instagram: \"caption\"" or engagement counters followed by
    // "- username on ...: \"caption\"". Strip that wrapper when present.
    const colon = text.match(/(?:^|\s[-–—]\s)[^:]{1,180}\bon\s+Instagram\s*:\s*[“\"]?([\s\S]+?)[”\"]?$/i);
    if (colon?.[1]) text = colon[1];
    else {
      const simple = text.match(/^[^:]{1,120}\bon\s+Instagram\s*:\s*[“\"]?([\s\S]+?)[”\"]?$/i);
      if (simple?.[1]) text = simple[1];
    }

    text = text.replace(/^[“\"]|[”\"]$/g, "").trim();
    if (author) {
      const escaped = escapeRegExp(author.replace(/^@/, ""));
      text = text.replace(new RegExp(`^@?${escaped}\\s*[:\\-–—]?\\s*`, "i"), "").trim();
    }
    if (text && !/^instagram$/i.test(text)) return text;
  }
  return "";
}

function buildRichCaption(metadata: SocialPostMetadata): string {
  const parts = [`<b>${escapeHtml(metadata.origin)}</b>`];
  if (metadata.author) parts.push(escapeHtml(metadata.author));
  if (metadata.caption) parts.push(escapeHtml(truncate(metadata.caption, MAX_SOCIAL_CAPTION_TEXT)));
  parts.push(`<a href="${escapeHtmlAttribute(metadata.sourceUrl)}">Origem</a>`);
  return parts.join("\n\n");
}

function fallbackMetadata(
  platform: SocialPlatform,
  sourceUrl: string,
  strategy: string,
): SocialPostMetadata {
  return {
    platform,
    origin: platform === "twitter" ? "X" : "Instagram",
    sourceUrl,
    author: null,
    caption: null,
    strategy,
    enriched: false,
  };
}

function normalizeTwitterPostUrl(url: URL): string {
  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  if (!match) return url.href;
  return `https://x.com/${match[1]}/status/${match[2]}`;
}

function normalizeInstagramPostUrl(url: URL): string {
  const match = url.pathname.match(/\/(p|reel|tv)\/([^/?#]+)/i);
  if (!match) return url.href;
  return `https://www.instagram.com/${match[1]!.toLowerCase()}/${match[2]!}/`;
}

function canonicalLookupUrl(platform: SocialPlatform, sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);
    return platform === "twitter" ? normalizeTwitterPostUrl(parsed) : normalizeInstagramPostUrl(parsed);
  } catch {
    return sourceUrl;
  }
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
  }, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`Unexpected content type: ${contentType}`);
  }
  const text = await response.text();
  return text.slice(0, 2_500_000);
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": USER_AGENT,
      Referer: "https://x.com/",
    },
    redirect: "follow",
  }, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("social-metadata-timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function resolveTimeoutMs(env: Env): number {
  const raw = Number(env.SOCIAL_METADATA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(raw)));
}

function metaContent(html: string, key: string): string {
  const escaped = escapeRegExp(key);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function extractJsonString(html: string, key: string): string {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = html.match(pattern);
  return match?.[1] ? decodeJsonString(match[1]) : "";
}

function extractJsonStringAfterKey(html: string, outerKey: string, innerKey: string): string {
  const outer = new RegExp(`"${escapeRegExp(outerKey)}"\\s*:\\s*\\{([\\s\\S]{0,8000}?)\\}`, "i").exec(html)?.[1] || "";
  return outer ? extractJsonString(outer, innerKey) : "";
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\//g, "/");
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanCaption(value: string): string {
  return decodeHtml(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanUsername(value: string): string {
  const normalized = String(value || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(normalized) ? normalized : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function mergeMetadata(
  base: Record<string, string> | null,
  extra: Record<string, string>,
): Record<string, string> | null {
  const result: Record<string, string> = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra)) {
    if (value) result[key] = value.slice(0, 2000);
  }
  return Object.keys(result).length ? result : null;
}

function remember(key: string, value: SocialPostMetadata): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

function randomToken(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 14);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
