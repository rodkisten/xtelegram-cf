import { stripSocialAccessNotices } from "./lib/social-caption";
import type { Env, MediaType } from "./types";
import { debugError, debugUrl, relayDebug } from "./lib/debug";
import { RELAY_LIMITS } from "./config/constants";
import { mapWithConcurrency } from "./lib/concurrency";
import { resolveSssInstagramStory, supportsSssInstagramStory, resolveEasyDownInstagram, resolveGetInSaverInstagram } from "./resolvers/instagram";

export type SocialProvider = "instagram" | "twitter" | "tiktok" | "reddit" | "youtube";
export type ResolvedSocialMediaType = "video" | "photo" | "audio";

export interface ResolvedSocialMediaVariant {
  url: string;
  type: ResolvedSocialMediaType;
  quality: string | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
  contentLength: number | null;
  bitrate: number | null;
  mediaHeaders: Record<string, string>;
}

export interface ResolvedSocialMedia extends ResolvedSocialMediaVariant {
  index: number;
  /** All known renditions of this same logical media, ordered best to worst. */
  variants: ResolvedSocialMediaVariant[];
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
  authorName: string | null;
  authorUsername: string | null;
  media: ResolvedSocialMedia[];
  attempts: ResolverAttempt[];
}

export interface SocialResolveOptions {
  /** A client-captured X handle used only if public syndication is unavailable. */
  twitterHandleHint?: string;
  /** Correlates resolver steps with the original Worker request. */
  traceId?: string;
}

interface ResolverResult {
  title: string | null;
  caption: string | null;
  authorName: string | null;
  authorUsername: string | null;
  media: ResolvedSocialMedia[];
}

interface ResolverDefinition {
  id: string;
  enabled?: () => boolean;
  run: () => Promise<ResolverResult>;
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
  if (hostname === "x.com" || hostname.endsWith(".x.com") ||
      hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "twitter";
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  if (hostname === "reddit.com" || hostname.endsWith(".reddit.com") ||
      hostname === "redd.it" || hostname.endsWith(".redd.it")) return "reddit";
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be" || hostname.endsWith(".youtu.be")) return "youtube";
  return null;
}

export async function resolveSocialMedia(
  sourceUrl: string,
  env: Env,
  options: SocialResolveOptions = {},
): Promise<SocialResolution> {
  const source = detectSocialProvider(sourceUrl);
  if (!source) {
    throw new Error("Unsupported social URL. Supported: Instagram, Twitter/X, TikTok, Reddit, YouTube.");
  }

  const traceId = String(options.traceId || "social");
  relayDebug(env, traceId, "social.detected", {
    provider: source,
    sourceUrl: debugUrl(sourceUrl),
    hasTwitterHandleHint: Boolean(options.twitterHandleHint),
  });

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
  const metadata: Partial<ResolverResult> = {};
  const providers = resolverRegistry(source, canonicalSourceUrl, env);

  for (const provider of providers) {
    if (provider.enabled && !provider.enabled()) continue;
    const startedAt = Date.now();

    relayDebug(env, traceId, "social.resolver.started", {
      provider: provider.id,
      source,
      sourceUrl: debugUrl(canonicalSourceUrl),
    });

    try {
      const result = await provider.run();
      result.caption = stripSocialAccessNotices(result.caption || "").caption || null;
      result.title = stripSocialAccessNotices(result.title || "").caption || null;
      mergeMetadata(metadata, result);

      if (!result.media.length) {
        const durationMs = Date.now() - startedAt;
        attempts.push({ provider: provider.id, ok: true, durationMs });
        relayDebug(env, traceId, "social.resolver.metadata-only", {
          provider: provider.id,
          durationMs,
        });
        continue;
      }

      const durationMs = Date.now() - startedAt;
      attempts.push({ provider: provider.id, ok: true, durationMs });
      relayDebug(env, traceId, "social.resolver.succeeded", {
        provider: provider.id,
        durationMs,
        mediaCount: result.media.length,
        mediaTypes: result.media.map((item) => item.type),
      });
      return {
        source,
        sourceUrl: canonicalSourceUrl,
        resolver: provider.id,
        title: result.title || metadata.title || null,
        caption: result.caption || metadata.caption || null,
        authorName: result.authorName || metadata.authorName || null,
        authorUsername: result.authorUsername || metadata.authorUsername || null,
        media: await finalizeResolvedMediaQualities(
          dedupeAndRankMedia(result.media),
          env,
          traceId,
        ),
        attempts,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      attempts.push({
        provider: provider.id,
        ok: false,
        durationMs,
        error: errorMessage(error),
      });
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

function resolverRegistry(source: SocialProvider, sourceUrl: string, env: Env): ResolverDefinition[] {
  const cobalt = {
    id: "cobalt",
    enabled: () => Boolean(env.COBALT_API_URL?.trim()),
    run: () => resolveCobalt(sourceUrl, env),
  };
  const ytdlp = {
    id: "yt-dlp",
    enabled: () => Boolean(env.YTDLP_API_URL?.trim()),
    run: () => resolveYtDlp(sourceUrl, env),
  };

  if (source === "twitter") {
    return [
      { id: "fxtwitter", run: () => resolveFxTwitter(sourceUrl) },
      { id: "vxtwitter", run: () => resolveVxTwitter(sourceUrl) },
      { id: "twirrl", run: () => resolveTwirrl(sourceUrl, env.TWIRRL_VERSION_TOKEN) },
      { id: "dtwitter", run: () => resolveDTwitter(sourceUrl) },
      cobalt,
      ytdlp,
    ];
  }

  if (source === "tiktok") {
    return [
      { id: "tikwm", run: () => resolveTikWm(sourceUrl) },
      { id: "dtiktok", run: () => resolveDTikTok(sourceUrl) },
      cobalt,
      ytdlp,
    ];
  }

  if (source === "reddit") {
    return [
      { id: "reddit-native", run: () => resolveRedditNative(sourceUrl) },
      cobalt,
      ytdlp,
    ];
  }

  if (source === "youtube") {
    return [
      { id: "youtube-oembed", run: () => resolveYouTubeOEmbed(sourceUrl) },
      { id: "piped", run: () => resolvePipedYouTube(sourceUrl, env) },
      cobalt,
      ytdlp,
    ];
  }

  return [
    // sssInstagram v2 is an undocumented signed API. Only attempt it when
    // the current browser-bundle signing parameters are explicitly configured.
    { id: "sssinstagram-v2-story", enabled: () => supportsSssInstagramStory(sourceUrl, env),
      run: () => resolveSssInstagramStory(sourceUrl, env) },
    { id: "zoraahub", run: () => resolveZoraaHub(sourceUrl) },
    cobalt,
    ytdlp,
    // Paid API fallbacks are opt-in and deliberately last.
    { id: "easydown", enabled: () => Boolean(env.EASYDOWN_API_KEY?.trim()),
      run: () => resolveEasyDownInstagram(sourceUrl, env) },
    { id: "getinsaver", enabled: () => Boolean(env.GETINSAVER_API_KEY?.trim()),
      run: () => resolveGetInSaverInstagram(sourceUrl, env) },
  ];
}

export class SocialResolverError extends Error {
  constructor(message: string, public readonly attempts: ResolverAttempt[]) {
    super(message);
    this.name = "SocialResolverError";
  }
}

async function resolveFxTwitter(sourceUrl: string): Promise<ResolverResult> {
  const parsed = parseTwitterStatus(sourceUrl);
  if (!parsed.id) throw new Error("FxTwitter requires a Twitter/X status URL.");

  const handle = parsed.handle || "i";
  const data = await fetchJson<any>(
    `https://api.fxtwitter.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(parsed.id)}`,
    { headers: jsonHeaders() },
  );
  const status = data?.tweet || data?.status || data;
  if (!status || Number(data?.code || 200) >= 400) {
    throw new Error(firstString(data?.message, data?.error, "FxTwitter returned no status")!);
  }

  const author = status.author || {};
  const mediaRoot = status.media || {};
  const rawMedia = array<any>(mediaRoot.all).length
    ? array<any>(mediaRoot.all)
    : [...array<any>(mediaRoot.videos), ...array<any>(mediaRoot.photos)];

  const media: ResolvedSocialMedia[] = [];
  for (const item of rawMedia) {
    const formats = array<any>(item?.formats);
    if (formats.length) {
      const variants = formats.map((format) => {
        const url = normalizeProviderUrl(format?.url);
        if (!url || String(format?.container || "").toLowerCase() === "m3u8") return null;
        return mediaVariant(url, inferType(undefined, item?.type, url), {
          ...item, ...format, filesize: format?.size ?? item?.filesize, bitrate: format?.bitrate,
        });
      }).filter(isMediaVariant);
      const logical = logicalMediaFromVariants(media.length, variants);
      if (logical) media.push(logical);
      continue;
    }

    const url = normalizeProviderUrl(firstString(item?.url, item?.transcode_url));
    if (url) media.push(mediaItem(media.length, url, inferType(undefined, item?.type, url), item));
  }

  return {
    title: firstString(status?.article?.title),
    caption: firstString(status?.text, status?.raw_text?.text),
    authorName: firstString(author?.name, author?.display_name),
    authorUsername: normalizeUsername(firstString(author?.screen_name, author?.username)),
    media,
  };
}

async function resolveVxTwitter(sourceUrl: string): Promise<ResolverResult> {
  const parsed = parseTwitterStatus(sourceUrl);
  if (!parsed.id) throw new Error("VXTwitter requires a Twitter/X status URL.");

  const handle = parsed.handle || "Twitter";
  const data = await fetchJson<any>(
    `https://api.vxtwitter.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(parsed.id)}`,
    { headers: jsonHeaders() },
  );

  const raw = array<any>(data?.media_extended);
  const media = raw.map((item, index) => {
    const url = normalizeProviderUrl(firstString(item?.url, item?.media_url));
    return url ? mediaItem(index, url, inferType(undefined, item?.type, url), item) : null;
  }).filter(isMedia);

  if (!media.length) {
    for (const rawUrl of array<any>(data?.mediaURLs)) {
      const url = normalizeProviderUrl(rawUrl);
      if (url) media.push(mediaItem(media.length, url, inferType(undefined, null, url), {}));
    }
  }

  return {
    title: null,
    caption: firstString(data?.text),
    authorName: firstString(data?.user_name),
    authorUsername: normalizeUsername(firstString(data?.user_screen_name)),
    media,
  };
}

async function resolveTikWm(sourceUrl: string): Promise<ResolverResult> {
  const canonical = await canonicalizeTikTokUrl(sourceUrl);
  const body = new URLSearchParams({ url: canonical, hd: "1" });
  const data = await fetchJson<any>("https://www.tikwm.com/api/", {
    method: "POST",
    headers: {
      ...jsonHeaders(),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: "https://www.tikwm.com/",
    },
    body: body.toString(),
  });

  if (Number(data?.code) !== 0 || !data?.data) {
    throw new Error(firstString(data?.msg, data?.message, "TikWM returned an unsuccessful response")!);
  }

  const item = data.data;
  const media: ResolvedSocialMedia[] = [];

  for (const image of array<any>(item?.images)) {
    const url = normalizeProviderUrl(image);
    if (url) media.push(mediaItem(media.length, url, "photo", { thumbnail: item?.cover }));
  }

  if (!media.length) {
    const variants = [
      { url: item?.hdplay, quality: "hd", size: item?.hd_size },
      { url: item?.play, quality: "sd", size: item?.size },
      { url: item?.wmplay, quality: "watermark", size: item?.wm_size },
    ];

    const candidates = variants.map((variant) => {
      const url = normalizeProviderUrl(variant.url);
      return url ? mediaVariant(url, "video", { quality: variant.quality, filesize: variant.size,
        width: item?.width, height: item?.height, thumbnail: item?.cover }) : null;
    }).filter(isMediaVariant);
    const logical = logicalMediaFromVariants(media.length, candidates);
    if (logical) media.push(logical);
  }

  return {
    title: null,
    caption: firstString(item?.title),
    authorName: firstString(item?.author?.nickname),
    authorUsername: normalizeUsername(firstString(item?.author?.unique_id)),
    media,
  };
}

async function resolveRedditNative(sourceUrl: string): Promise<ResolverResult> {
  const canonical = await canonicalizeRedditUrl(sourceUrl);
  const jsonUrl = canonical.replace(/\/+$/, "") + ".json?raw_json=1";
  const data = await fetchJson<any>(jsonUrl, {
    headers: {
      ...jsonHeaders(),
      "User-Agent": "xtelegram-relay/2.13 (+Cloudflare Worker)",
    },
  });

  const post = findRedditPost(data);
  if (!post) throw new Error("Reddit returned no post data.");

  const video = post?.secure_media?.reddit_video || post?.media?.reddit_video ||
    post?.crosspost_parent_list?.[0]?.secure_media?.reddit_video ||
    post?.crosspost_parent_list?.[0]?.media?.reddit_video;

  const media: ResolvedSocialMedia[] = [];
  if (video) {
    const url = normalizeProviderUrl(video?.fallback_url);
    if (url) {
      media.push(mediaItem(0, url, "video", {
        width: video?.width,
        height: video?.height,
        bitrate: video?.bitrate_kbps ? Number(video.bitrate_kbps) * 1000 : null,
      }));
    }
  }

  if (!media.length && Array.isArray(post?.gallery_data?.items)) {
    const metadata = post?.media_metadata || {};
    for (const galleryItem of post.gallery_data.items) {
      const entry = metadata[galleryItem?.media_id];
      const raw = entry?.s?.u || entry?.s?.gif;
      const url = normalizeProviderUrl(typeof raw === "string" ? raw.replace(/&amp;/g, "&") : null);
      if (url) media.push(mediaItem(media.length, url, entry?.e === "AnimatedImage" ? "video" : "photo", entry?.s || {}));
    }
  }

  if (!media.length) {
    const url = normalizeProviderUrl(post?.url_overridden_by_dest);
    if (url && /\.(?:jpe?g|png|webp|gif)(?:$|[?#])/i.test(url)) {
      media.push(mediaItem(0, url, "photo", {}));
    }
  }

  return {
    title: firstString(post?.title),
    caption: firstString(post?.selftext, post?.title),
    authorName: null,
    authorUsername: normalizeUsername(firstString(post?.author)),
    media,
  };
}

async function resolveCobalt(sourceUrl: string, env: Env): Promise<ResolverResult> {
  const endpoint = env.COBALT_API_URL?.trim();
  if (!endpoint) throw new Error("COBALT_API_URL is not configured.");

  const headers: Record<string, string> = {
    ...jsonHeaders(),
    "Content-Type": "application/json",
  };
  if (env.COBALT_API_KEY?.trim()) headers.Authorization = `Api-Key ${env.COBALT_API_KEY.trim()}`;

  const data = await fetchJson<any>(endpoint.replace(/\/+$/, "") + "/", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: sourceUrl, downloadMode: "auto", filenameStyle: "basic" }),
  });

  const media: ResolvedSocialMedia[] = [];
  const direct = normalizeProviderUrl(firstString(data?.url));
  if (direct) media.push(mediaItem(0, direct, inferType(undefined, null, direct), {}));

  for (const item of array<any>(data?.picker)) {
    const url = normalizeProviderUrl(firstString(item?.url));
    if (url) media.push(mediaItem(media.length, url, inferType(undefined, item?.type, url), item));
  }

  if (!media.length) throw new Error(firstString(data?.error?.code, data?.error, data?.status, "Cobalt returned no direct media")!);
  return { title: null, caption: null, authorName: null, authorUsername: null, media };
}

async function resolveYtDlp(sourceUrl: string, env: Env): Promise<ResolverResult> {
  const endpoint = env.YTDLP_API_URL?.trim();
  if (!endpoint) throw new Error("YTDLP_API_URL is not configured.");

  const headers: Record<string, string> = { ...jsonHeaders(), "Content-Type": "application/json" };
  if (env.YTDLP_API_TOKEN?.trim()) headers.Authorization = `Bearer ${env.YTDLP_API_TOKEN.trim()}`;

  const data = await fetchJson<any>(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: sourceUrl }),
  });

  const media: ResolvedSocialMedia[] = [];

  if (array<any>(data?.media).length) {
    for (const item of array<any>(data.media)) {
      const nestedFormats = array<any>(item?.formats);
      if (nestedFormats.length) {
        const variants = ytDlpFormatsToVariants(nestedFormats);
        const logical = logicalMediaFromVariants(media.length, variants);
        if (logical) media.push(logical);
        continue;
      }

      const url = normalizeProviderUrl(firstString(item?.url, item?.download_url));
      if (url) media.push(mediaItem(media.length, url, inferType(undefined, item?.type, url), item));
    }
  } else {
    // Root-level yt-dlp formats are renditions of one logical media item.
    const variants = ytDlpFormatsToVariants(array<any>(data?.formats));
    const logical = logicalMediaFromVariants(0, variants);
    if (logical) media.push(logical);
  }

  if (!media.length) {
    const url = normalizeProviderUrl(firstString(data?.url, data?.download_url));
    if (url) media.push(mediaItem(0, url, inferType(undefined, data?.type, url), data));
  }
  if (!media.length) throw new Error(firstString(data?.error, data?.message, "yt-dlp service returned no media")!);

  return {
    title: firstString(data?.title),
    caption: firstString(data?.description),
    authorName: firstString(data?.uploader, data?.channel),
    authorUsername: normalizeUsername(firstString(data?.uploader_id, data?.channel_id)),
    media,
  };
}

function ytDlpFormatsToVariants(formats: any[]): ResolvedSocialMediaVariant[] {
  return formats.map((item) => {
    const url = normalizeProviderUrl(firstString(item?.url, item?.download_url));
    if (!url) return null;

    const hasVideo = String(item?.vcodec || "none").toLowerCase() !== "none";
    const hasAudio = String(item?.acodec || "none").toLowerCase() !== "none";

    // A video-only adaptive stream is not a complete Telegram video.
    if (hasVideo && !hasAudio) return null;
    if (!hasVideo && !hasAudio) return null;

    return mediaVariant(url, hasVideo ? "video" : "audio", {
      ...item,
      filesize: item?.filesize ?? item?.filesize_approx,
      bitrate: item?.tbr ? Number(item.tbr) * 1000 : item?.bitrate,
      quality: firstString(item?.format_note, item?.format_id, item?.quality),
    });
  }).filter(isMediaVariant);
}

async function resolveYouTubeOEmbed(sourceUrl: string): Promise<ResolverResult> {
  const endpoint =
    `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;

  const data = await fetchJson<any>(endpoint, {
    headers: jsonHeaders(),
  });

  return {
    title: firstString(data?.title),
    caption: null,
    authorName: firstString(data?.author_name),
    authorUsername: null,
    media: [],
  };
}

async function resolvePipedYouTube(sourceUrl: string, env: Env): Promise<ResolverResult> {
  const apiBase = env.PIPED_API_URL?.trim() || "https://pipedapi.kavin.rocks";

  const videoId = extractYouTubeId(sourceUrl);
  if (!videoId) throw new Error("Could not extract YouTube video ID.");

  const data = await fetchJson<any>(
    `${apiBase.replace(/\/+$/, "")}/streams/${encodeURIComponent(videoId)}`,
    { headers: jsonHeaders() },
  );

  const variants: ResolvedSocialMediaVariant[] = [];

  for (const item of array<any>(data?.videoStreams)) {
    // Only progressive/muxed streams are directly playable by Telegram.
    if (item?.videoOnly === true) continue;

    const url = normalizeProviderUrl(item?.url);
    if (!url) continue;

    variants.push(mediaVariant(url, "video", {
      ...item,
      quality: firstString(item?.quality, item?.qualityLabel),
      width: item?.width,
      height: item?.height,
      bitrate: item?.bitrate,
      filesize: item?.contentLength,
      thumbnail: firstString(data?.thumbnailUrl),
    }));
  }

  const logical = logicalMediaFromVariants(0, variants);

  return {
    title: firstString(data?.title),
    caption: firstString(data?.description),
    authorName: firstString(data?.uploader),
    authorUsername: null,
    media: logical ? [logical] : [],
  };
}

function extractYouTubeId(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const watch = url.searchParams.get("v");
      if (watch && /^[A-Za-z0-9_-]{11}$/.test(watch)) return watch;

      const match = url.pathname.match(
        /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/i,
      );

      if (match?.[1]) return match[1];
    }
  } catch {}

  return null;
}

async function resolveZoraaHub(sourceUrl: string): Promise<ResolverResult> {
  const data = await fetchJson<any>("https://api.zoraahub.com/fetch.php", {
    method: "POST",
    headers: { ...jsonHeaders(), "Content-Type": "application/json", Origin: "https://downreels.com", Referer: "https://downreels.com/" },
    body: JSON.stringify({ url: sourceUrl }),
  });
  if (!data || String(data.status || "").toLowerCase() !== "ok") {
    throw new Error(data?.message || data?.error || "ZoraaHub returned an unsuccessful response");
  }
  const media = array<any>(data.videos).map((item, index) => {
    const rawUrl = firstString(item?.url, item?.download, item?.downloadUrl, item?.src);
    const url = normalizeProviderUrl(rawUrl);
    if (!url) return null;
    const nested = unwrapKnownProxyUrl(url);
    return mediaItem(index, nested || url, inferType(item?.isVideo ?? item?.is_video, item?.type, nested || url), item);
  }).filter(isMedia);
  return { title: firstString(data.title, data.meta?.title), caption: firstString(data.caption, data.description),
    authorName: null, authorUsername: null, media };
}

async function resolveTwirrl(sourceUrl: string, token?: string): Promise<ResolverResult> {
  const body: Record<string, string> = { u: sourceUrl, o: "iOS" };
  if (token?.trim()) body.v = token.trim();

  const data = await fetchJson<any>("https://api.twirrl.app/video", {
    method: "POST",
    headers: { ...jsonHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const media: ResolvedSocialMedia[] = [];

  for (const rawGroup of array<any>(data?.d?.i)) {
    if (!rawGroup || typeof rawGroup !== "object") continue;

    const seen = new Set<string>();
    const variants: ResolvedSocialMediaVariant[] = [];

    for (const value of Object.values(rawGroup as Record<string, any>)) {
      const url = normalizeProviderUrl(value?.u);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const resolution = resolutionFromUrl(url);
      variants.push(mediaVariant(url, "video", {
        ...value,
        width: numberOrNull(value?.width ?? value?.w) || resolution.width,
        height: numberOrNull(value?.height ?? value?.h) || resolution.height,
        quality: firstString(value?.quality, value?.resolution, resolution.label),
      }));
    }

    const logical = logicalMediaFromVariants(media.length, variants);
    if (logical) media.push(logical);
  }

  if (!media.length) {
    throw new Error(data?.error || data?.message || "Twirrl returned no valid video variants");
  }

  return { title: null, caption: null, authorName: null, authorUsername: null, media };
}

/**
 * Re-queries Twirrl when the selected Twitter/X video is above the Worker's
 * safe media budget. The function intentionally returns a medium rung of the
 * quality ladder while preserving the original aspect ratio as closely as
 * possible.
 *
 * This export is part of the media pipeline contract: src/media.ts imports it
 * to retry oversized Twitter videos before falling back to Shortcuts.
 */
export async function resolveTwitterMediumMedia(
  sourceUrl: string,
  token?: string,
): Promise<ResolvedSocialMedia | null> {
  const body: Record<string, string> = { u: sourceUrl, o: "iOS" };

  if (token?.trim()) {
    body.v = token.trim();
  }

  const data = await fetchJson<any>("https://api.twirrl.app/video", {
    method: "POST",
    headers: {
      ...jsonHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const groups: ResolvedSocialMedia[][] = [];

  for (const [mediaIndex, rawGroup] of array<any>(data?.d?.i).entries()) {
    if (!rawGroup || typeof rawGroup !== "object") continue;

    const seen = new Set<string>();
    const variants: ResolvedSocialMedia[] = [];
    const expectedAspect = twitterAspectHint(rawGroup);

    for (const value of Object.values(rawGroup as Record<string, any>)) {
      const url = normalizeProviderUrl(value?.u);

      if (!url || seen.has(url)) {
        continue;
      }

      seen.add(url);

      const resolution = resolutionFromUrl(url);

      variants.push({
        ...mediaItem(mediaIndex, url, "video", {
          ...value,
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
              value?.original_width ??
              value?.originalWidth,
            ) || resolution.width,
          height:
            numberOrNull(
              value?.height ??
              value?.h ??
              value?.original_height ??
              value?.originalHeight,
            ) || resolution.height,
        }),
        index: mediaIndex,
      });
    }

    variants.sort((left, right) =>
      compareTwitterVideoVariants(left, right, expectedAspect)
    );

    if (variants.length) {
      groups.push(variants);
    }
  }

  const candidates = groups
    .flat()
    .filter((item) => item.type === "video");

  if (!candidates.length) {
    return null;
  }

  /*
   * First prefer labels explicitly indicating a medium rendition. Twirrl has
   * used textual quality labels as well as resolution-style labels over time.
   */
  const explicitMedium = candidates
    .filter((item) => isMediumQualityLabel(item.quality))
    .sort((left, right) =>
      compareTwitterVideoVariants(
        left,
        right,
        twitterAspectHint(candidates[0]),
      )
    );

  if (explicitMedium[0]) {
    return explicitMedium[0];
  }

  /*
   * Otherwise choose the middle rung by pixel area. This is deliberately not
   * hardcoded to landscape 720p because portrait X videos must keep their
   * geometry intact.
   */
  const ranked = [...candidates].sort((left, right) => {
    const leftArea = (left.width || 0) * (left.height || 0);
    const rightArea = (right.width || 0) * (right.height || 0);

    if (leftArea !== rightArea) {
      return leftArea - rightArea;
    }

    return (left.bitrate || 0) - (right.bitrate || 0);
  });

  if (ranked.length === 1) {
    return ranked[0] || null;
  }

  return ranked[Math.floor((ranked.length - 1) / 2)] || null;
}

function isMediumQualityLabel(value: string | null): boolean {
  const normalized = String(value || "").trim().toLowerCase();

  return /^(?:medium|med|mid|480p|540p|720p)$/.test(normalized);
}

function twitterAspectHint(value: any): number | null {
  if (!value) return null;

  if (
    typeof value === "object" &&
    "width" in value &&
    "height" in value
  ) {
    const directWidth = numberOrNull(value.width);
    const directHeight = numberOrNull(value.height);

    if (directWidth && directHeight) {
      return directWidth / directHeight;
    }
  }

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
    const leftAspect =
      left.width && left.height ? left.width / left.height : 0;

    const rightAspect =
      right.width && right.height ? right.width / right.height : 0;

    const leftDistance = leftAspect
      ? Math.abs(Math.log(leftAspect / expectedAspect))
      : Number.POSITIVE_INFINITY;

    const rightDistance = rightAspect
      ? Math.abs(Math.log(rightAspect / expectedAspect))
      : Number.POSITIVE_INFINITY;

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
  }

  return (
    ((right.width || 0) * (right.height || 0)) -
    ((left.width || 0) * (left.height || 0))
  );
}

async function resolveDTwitter(sourceUrl: string): Promise<ResolverResult> {
  const body = new FormData();
  body.set("url", sourceUrl);
  body.set("version", JSON.stringify({ dtwitter: { api: "https://dtwitter.heismauri.com/" }, id: "6166", name: "DTwitter", version: "4.2.1" }));
  body.set("selector", JSON.stringify({ selector: false }));
  const data = await fetchJson<any>("https://dtwitter.heismauri.com/", { method: "POST", headers: jsonHeaders(), body });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && status !== "success") throw new Error(data?.error || data?.message || `DTwitter status ${status}`);
  const media = array<any>(data?.media).map((item, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(undefined, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!media.length) throw new Error(data?.error || data?.message || "DTwitter returned no media");
  return { title: null, caption: null, authorName: null, authorUsername: null, media };
}

async function resolveDTikTok(sourceUrl: string): Promise<ResolverResult> {
  const canonical = await canonicalizeTikTokUrl(sourceUrl);
  const body = new FormData();
  body.set("url", canonical);
  body.set("version", "4.3.3");
  const data = await fetchJson<any>("https://dtiktok.heismauri.com/", { method: "POST", headers: jsonHeaders(), body });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && !["success", "ok", "true"].includes(status)) throw new Error(data?.error || data?.message || `DTikTok status ${status}`);
  const media = array<any>(data?.media).map((item, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(undefined, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!media.length) throw new Error(data?.error || data?.message || "DTikTok returned no media");
  return { title: null, caption: null, authorName: null, authorUsername: null, media };
}

async function finalizeResolvedMediaQualities(
  items: ResolvedSocialMedia[],
  env: Env,
  traceId: string,
): Promise<ResolvedSocialMedia[]> {
  const finalized = await mapWithConcurrency(
    items,
    RELAY_LIMITS.qualityProbeConcurrency,
    async (item) => {
      const variants = item.variants.length
        ? item.variants
        : [stripMediaIndex(item)];
      const hydrated = await hydrateVariantSizes(variants);
      const ranked = dedupeVariants(hydrated).sort(compareQualityVariants);
      const maximumBytes = resolveSocialUploadLimitBytes(
        item.type,
        env.MAX_MEDIA_BYTES,
        env.WORKER_BUFFERED_MEDIA_BYTES,
      );
      const selected = selectBestQualityVariant(ranked, maximumBytes);

      if (!selected) return item;

      relayDebug(env, traceId, "social.quality-selected", {
        mediaIndex: item.index,
        mediaType: item.type,
        maximumBytes,
        selectedQuality: selected.quality,
        selectedBytes: selected.contentLength,
        available: ranked.map((variant) => ({
          quality: variant.quality,
          width: variant.width,
          height: variant.height,
          bitrate: variant.bitrate,
          contentLength: variant.contentLength,
          fits: variant.contentLength == null ? null : variant.contentLength <= maximumBytes,
          url: debugUrl(variant.url),
        })),
      });

      return {
        ...selected,
        index: item.index,
        variants: ranked,
      };
    },
  );

  return finalized.map((item, index) => ({ ...item, index }));
}

async function hydrateVariantSizes(
  variants: ResolvedSocialMediaVariant[],
): Promise<ResolvedSocialMediaVariant[]> {
  return mapWithConcurrency(
    variants,
    RELAY_LIMITS.qualityProbeConcurrency,
    async (variant) => {
      if (variant.contentLength != null) return variant;
      const contentLength = await probeVariantContentLength(variant.url, variant.mediaHeaders);
      return contentLength == null ? variant : { ...variant, contentLength };
    },
  );
}

async function probeVariantContentLength(
  url: string,
  mediaHeaders: Record<string, string>,
): Promise<number | null> {
  const headers = { ...mediaHeaders, Accept: "*/*" };

  try {
    const response = await fetchWithQualityProbeTimeout(url, {
      method: "HEAD",
      headers,
      redirect: "follow",
    });
    const value = positiveHeaderNumber(response.headers.get("content-length"));
    if (value != null) return value;
  } catch {}

  try {
    const response = await fetchWithQualityProbeTimeout(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      redirect: "follow",
    });

    const range = response.headers.get("content-range");
    const rangeMatch = range?.match(/\/(\d+)\s*$/);
    const rangedTotal = rangeMatch?.[1] ? Number(rangeMatch[1]) : NaN;
    const fallbackLength = positiveHeaderNumber(response.headers.get("content-length"));

    try { await response.body?.cancel(); } catch {}

    if (Number.isFinite(rangedTotal) && rangedTotal > 0) return Math.floor(rangedTotal);
    if (response.status === 200 && fallbackLength != null) return fallbackLength;
  } catch {}

  return null;
}

async function fetchWithQualityProbeTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("quality size probe timeout"),
    RELAY_LIMITS.qualityProbeTimeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function positiveHeaderNumber(value: string | null): number | null {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
}

function resolveSocialUploadLimitBytes(
  mediaType: ResolvedSocialMediaType,
  rawConfigured: string | undefined,
  rawWorkerBuffered: string | undefined,
): number {
  const configuredRaw = Number(rawConfigured);
  const configured = Number.isFinite(configuredRaw)
    ? Math.min(
        RELAY_LIMITS.directMediaHardBytes,
        Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(configuredRaw)),
      )
    : RELAY_LIMITS.directMediaDefaultBytes;

  const workerRaw = Number(rawWorkerBuffered);
  const workerBuffered = Number.isFinite(workerRaw)
    ? Math.min(
        RELAY_LIMITS.workerBufferedMediaHardBytes,
        Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(workerRaw)),
      )
    : RELAY_LIMITS.workerBufferedMediaDefaultBytes;

  return mediaType === "photo"
    ? Math.min(configured, RELAY_LIMITS.telegramUploadPhotoBytes, workerBuffered)
    : Math.min(configured, RELAY_LIMITS.telegramUploadOtherBytes, workerBuffered);
}

function selectBestQualityVariant(
  items: ResolvedSocialMediaVariant[],
  maximumBytes: number,
): ResolvedSocialMediaVariant | null {
  if (!items.length) return null;
  const ranked = [...items].sort(compareQualityVariants);

  // Walk the ladder from best to worst. A known oversized rendition is skipped.
  // If a probe could not determine a size, keep that higher quality and let
  // prepareMedia perform the authoritative byte-limited download; it has the same
  // ladder and will continue to the next variant if the file proves too large.
  for (const item of ranked) {
    if (item.contentLength == null || item.contentLength <= maximumBytes) return item;
  }

  return ranked[ranked.length - 1] || null;
}

function compareQualityVariants(
  left: ResolvedSocialMediaVariant,
  right: ResolvedSocialMediaVariant,
): number {
  const leftArea = (left.width || 0) * (left.height || 0);
  const rightArea = (right.width || 0) * (right.height || 0);
  if (leftArea !== rightArea) return rightArea - leftArea;
  if ((left.bitrate || 0) !== (right.bitrate || 0)) {
    return (right.bitrate || 0) - (left.bitrate || 0);
  }
  return qualityScore(right.quality) - qualityScore(left.quality);
}

function qualityScore(value: string | null): number {
  const quality = String(value || "").toLowerCase();
  if (/4320|8k/.test(quality)) return 600;
  if (/2160|4k|uhd/.test(quality)) return 500;
  if (/1440|2k|qhd/.test(quality)) return 450;
  if (/1080|full.?hd|fhd/.test(quality)) return 400;
  if (/720|\bhd\b/.test(quality)) return 300;
  if (/480|\bsd\b/.test(quality)) return 200;
  if (/360/.test(quality)) return 150;
  if (/240|watermark/.test(quality)) return 100;
  return 0;
}

function logicalMediaFromVariants(
  index: number,
  variants: ResolvedSocialMediaVariant[],
): ResolvedSocialMedia | null {
  const ranked = dedupeVariants(variants).sort(compareQualityVariants);
  const selected = ranked[0];
  return selected ? { ...selected, index, variants: ranked } : null;
}

function dedupeVariants(
  variants: ResolvedSocialMediaVariant[],
): ResolvedSocialMediaVariant[] {
  const map = new Map<string, ResolvedSocialMediaVariant>();
  for (const variant of variants) {
    const existing = map.get(variant.url);
    if (!existing) {
      map.set(variant.url, variant);
      continue;
    }
    map.set(variant.url, {
      ...existing,
      ...variant,
      contentLength: variant.contentLength ?? existing.contentLength,
      width: variant.width ?? existing.width,
      height: variant.height ?? existing.height,
      bitrate: variant.bitrate ?? existing.bitrate,
      quality: variant.quality || existing.quality,
    });
  }
  return [...map.values()];
}

function dedupeAndRankMedia(items: ResolvedSocialMedia[]): ResolvedSocialMedia[] {
  // Quality ordering belongs inside each logical media item's variants[]. Keep
  // different media in the provider/source order so albums do not reshuffle.
  const map = new Map<string, ResolvedSocialMedia>();
  for (const item of items) if (!map.has(item.url)) map.set(item.url, item);
  return [...map.values()].map((item, index) => ({ ...item, index }));
}

function mergeMetadata(target: Partial<ResolverResult>, incoming: ResolverResult): void {
  target.title ||= incoming.title;
  target.caption ||= incoming.caption;
  target.authorName ||= incoming.authorName;
  target.authorUsername ||= incoming.authorUsername;
}

function mediaVariant(
  url: string,
  type: ResolvedSocialMediaType,
  item: any,
): ResolvedSocialMediaVariant {
  const explicitWidth = numberOrNull(item?.width);
  const explicitHeight = numberOrNull(item?.height);
  const fromUrl = resolutionFromUrl(url);
  // CDN rendition URLs are authoritative for per-quality dimensions. Some
  // providers repeat the original 1080p metadata on every 720p/480p/320p URL.
  const width = fromUrl.width || explicitWidth;
  const height = fromUrl.height || explicitHeight;
  return {
    url,
    type,
    quality: firstString(fromUrl.label, item?.quality, item?.resolution,
      width && height ? `${width}x${height}` : null),
    width,
    height,
    thumbnail: firstString(item?.thumbnail, item?.thumbnail_url, item?.thumb, item?.poster, item?.cover),
    contentLength: numberOrNull(item?.filesize ?? item?.size ?? item?.contentLength),
    bitrate: numberOrNull(item?.bitrate),
    mediaHeaders: mediaHeadersForUrl(url),
  };
}

function mediaItem(
  index: number,
  url: string,
  type: ResolvedSocialMediaType,
  item: any,
): ResolvedSocialMedia {
  const variant = mediaVariant(url, type, item);
  return { ...variant, index, variants: [variant] };
}

function stripMediaIndex(item: ResolvedSocialMedia): ResolvedSocialMediaVariant {
  return {
    url: item.url,
    type: item.type,
    quality: item.quality,
    width: item.width,
    height: item.height,
    thumbnail: item.thumbnail,
    contentLength: item.contentLength,
    bitrate: item.bitrate,
    mediaHeaders: item.mediaHeaders,
  };
}

function inferType(isVideo: unknown, rawType: unknown, url: string): ResolvedSocialMediaType {
  if (typeof isVideo === "boolean") return isVideo ? "video" : "photo";
  const type = String(rawType || "").toLowerCase();
  if (["image", "photo", "picture"].includes(type)) return "photo";
  if (["audio", "music", "mp3"].includes(type)) return "audio";
  if (["video", "mp4", "movie", "gif"].includes(type)) return "video";
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); } })();
  if (/\.(jpe?g|png|webp|avif|gif)$/.test(path)) return "photo";
  if (/\.(mp3|m4a|aac|ogg|wav|flac)$/.test(path)) return "audio";
  return "video";
}

function parseTwitterStatus(value: string): { handle: string | null; id: string | null } {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i) || url.pathname.match(/^\/i\/status\/(\d+)/i);
    if (!match) return { handle: null, id: null };
    if (match.length === 2) return { handle: null, id: match[1] || null };
    return { handle: match[1] === "i" ? null : (match[1] || null), id: match[2] || null };
  } catch { return { handle: null, id: null }; }
}

function findRedditPost(value: any): any | null {
  const queue = [value];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (current?.kind === "t3" && current?.data) return current.data;
    if (Array.isArray(current)) queue.push(...current);
    else {
      if (current?.data?.children) queue.push(...array<any>(current.data.children));
      if (current?.crosspost_parent_list) queue.push(...array<any>(current.crosspost_parent_list));
    }
  }
  return null;
}

async function canonicalizeRedditUrl(sourceUrl: string): Promise<string> {
  try {
    const parsed = new URL(sourceUrl);
    if (!parsed.hostname.endsWith("redd.it")) return `${parsed.origin}${parsed.pathname}`;
    const response = await fetchWithTimeout(sourceUrl, { method: "HEAD", redirect: "follow", headers: jsonHeaders() });
    return response.url || sourceUrl;
  } catch { return sourceUrl; }
}


async function canonicalizeTwitterUrl(sourceUrl: string, handleHint = ""): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!(host === "x.com" || host === "twitter.com" ||
        host.endsWith(".x.com") || host.endsWith(".twitter.com"))) {
    return sourceUrl;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = parts.findIndex((part) => /^(?:status|statuses)$/i.test(part));
  const tweetId = statusIndex >= 0 ? String(parts[statusIndex + 1] || "") : "";
  if (!/^\d{5,}$/.test(tweetId)) return sourceUrl;

  const directHandle = cleanTwitterHandle(parts[statusIndex - 1] || "");
  if (directHandle) return `https://x.com/${directHandle}/status/${tweetId}`;

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

  return ["i", "web", "intent", "share", "search", "home", "explore"].includes(
    handle.toLowerCase(),
  )
    ? ""
    : handle;
}

async function twitterHandleFromSyndication(tweetId: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("Twitter canonicalization timeout"),
    4_500,
  );

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
  const canonicalPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d{8,}/i;
  if (canonicalPattern.test(sourceUrl)) return sourceUrl;
  try {
    const response = await fetchWithTimeout(sourceUrl, {
      method: "GET", redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "User-Agent": USER_AGENT },
    });
    const finalUrl = response.url || sourceUrl;
    if (canonicalPattern.test(finalUrl)) return finalUrl;
    const html = (await response.text()).slice(0, 250_000);
    const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    if (match?.[1] && canonicalPattern.test(match[1])) return match[1].replace(/&amp;/gi, "&");
  } catch {}
  return sourceUrl;
}

function normalizeUsername(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim().replace(/^@+/, "");
  return clean ? `@${clean}` : null;
}

function jsonHeaders(): Record<string, string> {
  return { Accept: "application/json, text/plain, */*", "User-Agent": USER_AGENT };
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
  const raw = value.trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
  } catch { return null; }
}

function mediaHeadersForUrl(url: string): Record<string, string> {
  let hostname = "";
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return { "User-Agent": USER_AGENT }; }
  if (hostname === "video.twimg.com" || hostname.endsWith(".twimg.com")) {
    return { "User-Agent": USER_AGENT, Referer: "https://x.com/" };
  }
  if (hostname.endsWith(".tiktok.com") || hostname.endsWith(".tiktokcdn.com") || hostname.endsWith(".tiktokcdn-us.com")) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.tiktok.com/" };
  }
  if (hostname.endsWith(".cdninstagram.com") || hostname.endsWith(".fbcdn.net")) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.instagram.com/" };
  }
  if (hostname.endsWith(".redditmedia.com") || hostname.endsWith(".redd.it") || hostname.endsWith(".reddit.com")) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.reddit.com/" };
  }
  if (hostname.endsWith(".googlevideo.com") || hostname.endsWith(".youtube.com")) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.youtube.com/" };
  }
  return { "User-Agent": USER_AGENT };
}

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    try { const next = decodeURIComponent(current); if (next === current) break; current = next; } catch { break; }
  }
  return current;
}

function resolutionFromUrl(url: string) {
  const match = url.match(/(?:\/|_)(\d{2,5})x(\d{2,5})(?:\/|[_.?]|$)/i);
  if (!match) return { width: null, height: null, label: null };
  const width = Number(match[1]); const height = Number(match[2]);
  return { width, height, label: `${width}x${height}` };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("resolver timeout"), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: init.redirect || "follow" });
  } finally { clearTimeout(timer); }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Resolver returned non-JSON: ${text.slice(0, 300)}`); }
}

function array<T>(value: T[] | null | undefined): T[] { return Array.isArray(value) ? value : []; }
function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
function numberOrNull(value: unknown): number | null {
  const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null;
}
function isMedia(value: ResolvedSocialMedia | null): value is ResolvedSocialMedia { return Boolean(value?.url); }
function isMediaVariant(value: ResolvedSocialMediaVariant | null): value is ResolvedSocialMediaVariant { return Boolean(value?.url); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function toRelayMediaType(type: ResolvedSocialMediaType): MediaType { return type === "photo" ? "photo" : type; }
