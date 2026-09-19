import type { Env, ParseMode } from "../types";
import { debugUrl } from "../lib/debug";
import { RELAY_LIMITS } from "../config/constants";
import { appendHashtagsToCaption } from "../lib/hashtags";

export type SocialPlatform = "twitter" | "instagram" | "tiktok" | "reddit" | "youtube";

export interface SocialPostMetadata {
  platform: SocialPlatform;
  origin: "X" | "Instagram" | "TikTok" | "Reddit" | "YouTube";
  sourceUrl: string;
  author: string | null;
  caption: string | null;
  strategy: string;
  enriched: boolean;
}

export interface SocialDeliveryContent {
  caption: string;
  captionExplicit?: boolean;
  hashtags?: string[];
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
  social: SocialPostMetadata | null;
}

interface SocialDeliveryInput {
  provider?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  caption: string;
  captionExplicit?: boolean;
  hashtags?: string[];
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
}

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const cache = new Map<string, { expiresAt: number; value: SocialPostMetadata }>();
const inFlight = new Map<string, Promise<SocialPostMetadata>>();
const SOCIAL_CACHE_PATH_PREFIX = "https://xtelegram-social-cache.invalid/v1/";

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
  // Explicit caller content is authoritative. This enables caption-first
  // workflows where metadata is captured before a downloadable media URL is
  // available, and avoids replacing a richer caption with scraper output.
  if (input.captionExplicit && input.caption.trim()) {
    return finalizeHashtags({
      caption: input.caption,
      parseMode: input.parseMode,
      metadata: input.metadata,
      social: null,
    }, input.hashtags);
  }

  const target = resolveSocialTarget(input);
  if (!target) {
    const fallbackUrl = resolveDeliveryFallbackUrl(input);
    const caption = input.caption.trim() || fallbackUrl || "";

    return finalizeHashtags({
      caption,
      parseMode: input.caption.trim() ? input.parseMode : null,
      metadata: input.metadata,
      social: null,
    }, input.hashtags);
  }

  let social: SocialPostMetadata;
  try {
    social =
      metadataHintFromInput(target.platform, target.url, input.metadata) ||
      await resolveSocialPostMetadata(target.platform, target.url, env);
  } catch (error) {
    console.warn("[media-relay] Social metadata enrichment failed", {
      platform: target.platform,
      sourceUrl: debugUrl(target.url),
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

  return finalizeHashtags({
    caption,
    parseMode: hasMetadata ? "HTML" : null,
    metadata,
    social,
  }, input.hashtags);
}

function finalizeHashtags(
  content: SocialDeliveryContent,
  hashtags: string[] | undefined,
): SocialDeliveryContent {
  const applied = appendHashtagsToCaption(
    content.caption,
    hashtags || [],
    content.parseMode,
  );

  return {
    ...content,
    caption: applied.caption,
    parseMode: applied.parseMode,
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
    // The in-memory cache only survives while a Worker isolate is warm.
    // Cloudflare's edge Cache API lets hot social posts skip the external
    // metadata request even when the request lands on a different isolate.
    const edgeCached = await readEdgeSocialCache(key);
    if (edgeCached) {
      remember(key, edgeCached);
      return edgeCached;
    }

    const value =
      platform === "twitter"
        ? await resolveTwitterMetadata(sourceUrl, env)
        : platform === "instagram"
          ? await resolveInstagramMetadata(sourceUrl, env)
          : platform === "tiktok"
            ? await resolveTikTokMetadata(sourceUrl, env)
            : platform === "reddit"
              ? await resolveRedditMetadata(sourceUrl, env)
              : await resolveYouTubeMetadata(sourceUrl, env);
    remember(key, value);
    void writeEdgeSocialCache(key, value);
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

      if (
        (host === "x.com" || host === "twitter.com" ||
          host.endsWith(".x.com") || host.endsWith(".twitter.com")) &&
        /\/status\/\d+/i.test(url.pathname)
      ) {
        return { platform: "twitter", url: normalizeTwitterPostUrl(url) };
      }

      if (
        (host === "instagram.com" || host.endsWith(".instagram.com")) &&
        /\/(?:p|reel|tv)\/[^/?#]+/i.test(url.pathname)
      ) {
        return { platform: "instagram", url: normalizeInstagramPostUrl(url) };
      }

      if (
        host === "tiktok.com" || host.endsWith(".tiktok.com")
      ) {
        return { platform: "tiktok", url: url.href };
      }

      if (
        host === "reddit.com" || host.endsWith(".reddit.com") ||
        host === "redd.it" || host.endsWith(".redd.it")
      ) {
        return { platform: "reddit", url: url.href };
      }

      if (
        host === "youtube.com" || host.endsWith(".youtube.com") ||
        host === "youtu.be" || host.endsWith(".youtu.be")
      ) {
        return { platform: "youtube", url: url.href };
      }
    } catch {}
  }

  const platform: SocialPlatform | null =
    provider === "twitter" || provider === "x" ? "twitter" :
    provider === "instagram" ? "instagram" :
    provider === "tiktok" ? "tiktok" :
    provider === "reddit" ? "reddit" :
    provider === "youtube" || provider === "youtube-shorts" ? "youtube" :
    null;

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

function resolveDeliveryFallbackUrl(input: SocialDeliveryInput): string {
  for (const value of [input.pageUrl, input.sourceUrl]) {
    if (typeof value !== "string" || !value.trim()) continue;

    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
    } catch {}
  }

  return "";
}

function metadataHintFromInput(
  platform: SocialPlatform,
  sourceUrl: string,
  metadata: Record<string, string> | null,
): SocialPostMetadata | null {
  if (!metadata) return null;

  const authorUsername = cleanUsername(
    stringValue(metadata.socialAuthorUsername).replace(/^@/, ""),
  );
  const authorName = cleanCaption(stringValue(metadata.socialAuthorName));
  const caption = cleanCaption(
    stringValue(metadata.socialResolvedCaption) ||
    stringValue(metadata.socialCaption),
  );

  const author = authorUsername
    ? `@${authorUsername}`
    : authorName || null;

  if (!author && !caption) return null;

  return {
    platform,
    origin: socialOrigin(platform),
    sourceUrl,
    author,
    caption: caption || null,
    strategy: "resolver-metadata",
    enriched: true,
  };
}

async function resolveTwitterMetadata(sourceUrl: string, env: Env): Promise<SocialPostMetadata> {
  const normalized = normalizeTwitterPostUrl(new URL(sourceUrl));
  const parsed = new URL(normalized);
  const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  const tweetId = match?.[2] || "";

  if (!tweetId) {
    return fallbackMetadata("twitter", normalized, "url-fallback");
  }

  // Syndication and the public HTML page are independent sources. Racing them
  // removes the old worst-case waterfall where a failed syndication request
  // consumed the full timeout before HTML was even attempted. The first source
  // that produces useful metadata wins and the slower request is aborted.
  const raceController = new AbortController();
  const timeoutMs = resolveTimeoutMs(env);

  const attempts = [
    resolveTwitterSyndication(normalized, tweetId, timeoutMs, raceController.signal),
    resolveTwitterHtmlMetadata(normalized, timeoutMs, raceController.signal),
  ];

  try {
    const metadata = await Promise.any(attempts);
    raceController.abort("twitter-metadata-resolved");
    return metadata;
  } catch {
    raceController.abort("twitter-metadata-failed");
    return fallbackMetadata("twitter", normalized, "url-fallback");
  }
}

async function resolveTwitterSyndication(
  normalized: string,
  tweetId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<SocialPostMetadata> {
  try {
    const token = randomToken();
    const data = await fetchJson(
      `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&lang=en&token=${encodeURIComponent(token)}`,
      timeoutMs,
      signal,
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

    if (!author && !caption) {
      throw new Error("Twitter syndication returned no useful metadata");
    }

    return {
      platform: "twitter",
      origin: "X",
      sourceUrl: normalized,
      author: author ? `@${author}` : null,
      caption: caption || null,
      strategy: "twitter-syndication",
      enriched: true,
    };
  } catch (error) {
    // Cancellation is expected when the other metadata source wins the race.
    if (!signal.aborted) {
      console.debug("[media-relay] Twitter syndication metadata failed", {
        sourceUrl: debugUrl(normalized),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function resolveTwitterHtmlMetadata(
  normalized: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<SocialPostMetadata> {
  try {
    const html = await fetchHtml(normalized, timeoutMs, signal);
    const ogTitle = metaContent(html, "og:title");
    const ogDescription = metaContent(html, "og:description") || metaContent(html, "twitter:description");
    const author = cleanUsername(
      firstMatch(ogTitle, [/@([A-Za-z0-9_]{1,15})/, /\((?:@)?([A-Za-z0-9_]{1,15})\)/]),
    );
    const caption = cleanCaption(ogDescription);

    if (!author && !caption) {
      throw new Error("Twitter HTML metadata contained no useful metadata");
    }

    return {
      platform: "twitter",
      origin: "X",
      sourceUrl: normalized,
      author: author ? `@${author}` : null,
      caption: caption || null,
      strategy: "twitter-html-meta",
      enriched: true,
    };
  } catch (error) {
    // Cancellation is expected when the other metadata source wins the race.
    if (!signal.aborted) {
      console.debug("[media-relay] Twitter page metadata failed", {
        sourceUrl: debugUrl(normalized),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
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
      sourceUrl: debugUrl(normalized),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fallbackMetadata("instagram", normalized, "url-fallback");
}


async function resolveTikTokMetadata(
  sourceUrl: string,
  env: Env,
): Promise<SocialPostMetadata> {
  const timeoutMs = resolveTimeoutMs(env);

  try {
    const body = new URLSearchParams({
      url: sourceUrl,
      hd: "0",
    });

    const response = await fetchWithTimeout(
      "https://www.tikwm.com/api/",
      {
        method: "POST",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Referer: "https://www.tikwm.com/",
          "User-Agent": USER_AGENT,
        },
        body: body.toString(),
        redirect: "follow",
      },
      timeoutMs,
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as any;
    if (Number(data?.code) !== 0 || !data?.data) {
      throw new Error(stringValue(data?.msg) || "TikWM metadata unavailable");
    }

    const item = data.data;
    const username = cleanUsername(
      stringValue(item?.author?.unique_id) ||
      stringValue(item?.author?.uniqueId),
    );
    const caption = cleanCaption(stringValue(item?.title));

    if (!username && !caption) {
      throw new Error("TikWM returned no useful metadata");
    }

    return {
      platform: "tiktok",
      origin: "TikTok",
      sourceUrl,
      author: username ? `@${username}` : null,
      caption: caption || null,
      strategy: "tikwm",
      enriched: true,
    };
  } catch (error) {
    console.debug("[media-relay] TikTok metadata failed", {
      sourceUrl: debugUrl(sourceUrl),
      error: error instanceof Error ? error.message : String(error),
    });

    return fallbackMetadata("tiktok", sourceUrl, "url-fallback");
  }
}

async function resolveRedditMetadata(
  sourceUrl: string,
  env: Env,
): Promise<SocialPostMetadata> {
  const timeoutMs = resolveTimeoutMs(env);

  try {
    const canonical = await canonicalizeRedditMetadataUrl(sourceUrl, timeoutMs);
    const jsonUrl = `${canonical.replace(/\/+$/, "")}.json?raw_json=1`;
    const response = await fetchWithTimeout(
      jsonUrl,
      {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "xtelegram-relay/2.14 (+Cloudflare Worker)",
        },
        redirect: "follow",
      },
      timeoutMs,
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as any;
    const post = findRedditMetadataPost(data);

    if (!post) throw new Error("Reddit returned no post metadata");

    const username = cleanUsername(stringValue(post?.author));
    const title = cleanCaption(stringValue(post?.title));
    const body = cleanCaption(stringValue(post?.selftext));
    const caption = body || title;

    return {
      platform: "reddit",
      origin: "Reddit",
      sourceUrl: canonical,
      author: username ? `@${username}` : null,
      caption: caption || null,
      strategy: "reddit-json",
      enriched: Boolean(username || caption),
    };
  } catch (error) {
    console.debug("[media-relay] Reddit metadata failed", {
      sourceUrl: debugUrl(sourceUrl),
      error: error instanceof Error ? error.message : String(error),
    });

    return fallbackMetadata("reddit", sourceUrl, "url-fallback");
  }
}

async function resolveYouTubeMetadata(
  sourceUrl: string,
  env: Env,
): Promise<SocialPostMetadata> {
  const timeoutMs = resolveTimeoutMs(env);

  try {
    const url =
      `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;

    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
      },
      timeoutMs,
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as any;
    const authorName = cleanCaption(stringValue(data?.author_name));
    const title = cleanCaption(stringValue(data?.title));

    return {
      platform: "youtube",
      origin: "YouTube",
      sourceUrl,
      author: authorName || null,
      caption: title || null,
      strategy: "youtube-oembed",
      enriched: Boolean(authorName || title),
    };
  } catch (error) {
    console.debug("[media-relay] YouTube metadata failed", {
      sourceUrl: debugUrl(sourceUrl),
      error: error instanceof Error ? error.message : String(error),
    });

    return fallbackMetadata("youtube", sourceUrl, "url-fallback");
  }
}

async function canonicalizeRedditMetadataUrl(
  sourceUrl: string,
  timeoutMs: number,
): Promise<string> {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (host !== "redd.it") {
      return `${parsed.origin}${parsed.pathname}`;
    }

    const response = await fetchWithTimeout(
      sourceUrl,
      {
        method: "HEAD",
        redirect: "follow",
        headers: {
          "User-Agent": "xtelegram-relay/2.14 (+Cloudflare Worker)",
        },
      },
      timeoutMs,
    );

    return response.url || sourceUrl;
  } catch {
    return sourceUrl;
  }
}

function findRedditMetadataPost(value: any): any | null {
  const queue = [value];
  const seen = new Set<any>();

  while (queue.length) {
    const current = queue.shift();

    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (current?.kind === "t3" && current?.data) {
      return current.data;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (Array.isArray(current?.data?.children)) {
      queue.push(...current.data.children);
    }
  }

  return null;
}

function socialOrigin(
  platform: SocialPlatform,
): SocialPostMetadata["origin"] {
  if (platform === "twitter") return "X";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  if (platform === "reddit") return "Reddit";
  return "YouTube";
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
  if (metadata.caption) parts.push(escapeHtml(truncate(metadata.caption, RELAY_LIMITS.socialCaptionTextMax)));
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
    origin: socialOrigin(platform),
    sourceUrl,
    author: null,
    caption: null,
    strategy,
    enriched: false,
  };
}

function normalizeTwitterPostUrl(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => /^(?:status|statuses)$/i.test(part));
  const tweetId = statusIndex >= 0 ? String(parts[statusIndex + 1] || "") : "";
  if (!/^\d{5,}$/.test(tweetId)) return url.href;
  const handle = cleanUsername(parts[statusIndex - 1] || "");
  if (handle && !["i", "web", "intent", "share", "search", "home", "explore"].includes(handle.toLowerCase())) {
    return `https://x.com/${handle}/status/${tweetId}`;
  }
  // No public handle is embedded in /i/status/:id. Retain the deterministic
  // internal form here; resolveTwitterMetadata immediately upgrades it via
  // syndication when public author metadata is available.
  return `https://x.com/i/status/${tweetId}`;
}

function normalizeInstagramPostUrl(url: URL): string {
  const match = url.pathname.match(/\/(p|reel|tv)\/([^/?#]+)/i);
  if (!match) return url.href;
  return `https://www.instagram.com/${match[1]!.toLowerCase()}/${match[2]!}/`;
}

function canonicalLookupUrl(platform: SocialPlatform, sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl);

    if (platform === "twitter") return normalizeTwitterPostUrl(parsed);
    if (platform === "instagram") return normalizeInstagramPostUrl(parsed);

    parsed.hash = "";
    return parsed.href;
  } catch {
    return sourceUrl;
  }
}

async function fetchHtml(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
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

async function fetchJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<any> {
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
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(externalSignal?.reason || "social-metadata-aborted");
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromCaller();
    } else {
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort("social-metadata-timeout"), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function resolveTimeoutMs(env: Env): number {
  const raw = Number(env.SOCIAL_METADATA_TIMEOUT_MS || RELAY_LIMITS.socialMetadataTimeoutDefaultMs);
  if (!Number.isFinite(raw)) return RELAY_LIMITS.socialMetadataTimeoutDefaultMs;
  return Math.min(RELAY_LIMITS.socialMetadataTimeoutMaxMs, Math.max(1_000, Math.floor(raw)));
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

/**
 * Reads a previously resolved social metadata record from the edge cache.
 *
 * @example
 * Input: a canonical X post cache key
 * Output: the cached SocialPostMetadata, or null on a cache miss/error
 */
async function readEdgeSocialCache(key: string): Promise<SocialPostMetadata | null> {
  try {
    const cache = getEdgeCache();
    if (!cache) return null;

    const response = await cache.match(createSocialCacheRequest(key));
    if (!response) return null;

    const value = (await response.json()) as SocialPostMetadata;
    return isValidSocialMetadata(value) ? value : null;
  } catch {
    // Cache availability must never become a dependency for message delivery.
    return null;
  }
}

/**
 * Stores resolved social metadata at the edge so warm data survives isolate
 * churn and avoids repeating expensive public-page requests.
 *
 * @example
 * Input: a resolved Instagram post metadata object
 * Output: the metadata is available to subsequent Worker invocations
 */
async function writeEdgeSocialCache(key: string, value: SocialPostMetadata): Promise<void> {
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Cache-Control": `public, max-age=${Math.floor(RELAY_LIMITS.socialMetadataCacheTtlMs / 1000)}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    const cache = getEdgeCache();
    if (!cache) return;

    await cache.put(createSocialCacheRequest(key), response);
  } catch {
    // A cache write is an optimization only and must never delay delivery.
  }
}

/**
 * Returns Cloudflare's default edge cache while keeping local TypeScript DOM
 * typings compatible with the Workers-specific `caches.default` extension.
 *
 * @example
 * Input: no arguments
 * Output: the default edge Cache, or null when the runtime does not expose it
 */
function getEdgeCache(): Cache | null {
  const cacheStorage = globalThis.caches as CacheStorage & { default?: Cache };
  return cacheStorage.default || null;
}

/**
 * Creates a deterministic synthetic cache request without exposing the source
 * URL as a query parameter or allowing it to influence the actual Worker route.
 *
 * @example
 * Input: `twitter:https://x.com/user/status/123`
 * Output: a stable synthetic Request used exclusively as a Cache API key
 */
function createSocialCacheRequest(key: string): Request {
  return new Request(`${SOCIAL_CACHE_PATH_PREFIX}${encodeURIComponent(key)}`);
}

/**
 * Validates cached metadata before trusting it as a Telegram caption source.
 *
 * @example
 * Input: `{ platform: "twitter", origin: "X", sourceUrl: "...", ... }`
 * Output: true
 */
function isValidSocialMetadata(value: unknown): value is SocialPostMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SocialPostMetadata>;
  return (
      candidate.platform === "twitter" ||
      candidate.platform === "instagram" ||
      candidate.platform === "tiktok" ||
      candidate.platform === "reddit" ||
      candidate.platform === "youtube"
    ) &&
    (
      candidate.origin === "X" ||
      candidate.origin === "Instagram" ||
      candidate.origin === "TikTok" ||
      candidate.origin === "Reddit" ||
      candidate.origin === "YouTube"
    ) &&
    typeof candidate.sourceUrl === "string" &&
    (typeof candidate.author === "string" || candidate.author === null) &&
    (typeof candidate.caption === "string" || candidate.caption === null) &&
    typeof candidate.strategy === "string" &&
    typeof candidate.enriched === "boolean";
}

function remember(key: string, value: SocialPostMetadata): void {
  if (cache.size >= RELAY_LIMITS.socialMetadataCacheEntriesMax) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + RELAY_LIMITS.socialMetadataCacheTtlMs, value });
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
