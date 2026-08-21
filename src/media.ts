import { HlsDownloader } from "./hls/downloader";
import { HlsRemuxer } from "./hls/remuxer";
import { HlsResolver, looksLikeHlsUrl } from "./hls/resolver";
import { parseVideoDimensions } from "./media/video-metadata";
import { fetchPublic, getBaseContentType, getFileExtension } from "./lib/http";
import type {
  MediaType,
  PreparedMedia,
  RelayInput,
  ResolvedDirectFile,
} from "./types";

const TELEGRAM_REMOTE_URL_LIMIT = 60_000_000; // 20
const DEFAULT_MAX_MEDIA_BYTES = 100_000_000; //49
const HARD_MAX_MEDIA_BYTES = 100_000_000;
const DEFAULT_HLS_MAX_MEDIA_BYTES = 32_000_000; //12
const HARD_HLS_MAX_MEDIA_BYTES = 96_000_000; // 24

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "wav",
  "flac",
]);

export interface PrepareMediaOptions {
  maxMediaBytes?: number;
  concurrency?: number;
  hlsMaxMediaBytes?: number;
  signal?: AbortSignal;
  /** Force a Worker-owned file so it can be attached to a Telegram album. */
  forceUpload?: boolean;
}

export async function prepareMedia(
  input: RelayInput,
  options: PrepareMediaOptions = {},
): Promise<PreparedMedia> {
  const maxMediaBytes = clampMaxMediaBytes(options.maxMediaBytes);
  const hlsMaxMediaBytes = clampHlsMaxMediaBytes(options.hlsMaxMediaBytes);
  const resolver = new HlsResolver({
    maxDepth: 8,
    maxPlaylistBytes: 2 * 1024 * 1024,
    headers: input.mediaHeaders,
    preferSelfContained: true,
  });
  // URLs with a known media type cannot be HLS playlists. Skip the HEAD probe
  // entirely for those inputs. The previous implementation paid one network RTT
  // just to rediscover information already encoded in the URL.
  const probe = shouldSkipMediaProbe(input.mediaUrl.href)
    ? {
        url: input.mediaUrl.href,
        contentType: inferContentTypeFromUrl(input.mediaUrl.href),
        contentLength: null,
        isPlaylist: false,
      }
    : looksLikeHlsUrl(input.mediaUrl)
      ? {
          url: input.mediaUrl.href,
          contentType: "application/vnd.apple.mpegurl",
          contentLength: null,
          isPlaylist: true,
        }
      : await resolver.probe(input.mediaUrl, {
          headers: input.mediaHeaders,
          signal: options.signal,
        });

  if (!probe.isPlaylist && !looksLikeHlsUrl(input.mediaUrl)) {
    const direct: ResolvedDirectFile = {
      type: "file",
      url: probe.url,
      contentType: probe.contentType || inferContentTypeFromUrl(probe.url),
      contentLength: probe.contentLength,
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth: 0,
      videoMetadata: null,
    };
    const inferredMediaType =
      input.mediaType || inferTelegramMediaType(direct.url, direct.contentType);
    const isVideo = inferredMediaType === "video";

    if (isVideo && direct.contentLength == null) {
      const rangedLength = await probeContentLengthByRange(
        direct.url,
        input.mediaHeaders,
        options.signal,
      );
      if (rangedLength != null) direct.contentLength = rangedLength;
    }

    if (
      !options.forceUpload &&
      !isVideo &&
      (direct.contentLength == null ||
        direct.contentLength <= TELEGRAM_REMOTE_URL_LIMIT)
    ) {
      return direct;
    }

    if (direct.contentLength != null && direct.contentLength > maxMediaBytes) {
      throw new Error(
        `Direct media is ${direct.contentLength} bytes, above the configured upload limit of ${maxMediaBytes} bytes`,
      );
    }

    const bytes = await downloadDirectFile(
      direct.url,
      input.mediaHeaders,
      maxMediaBytes,
      options.signal,
    );
    const mediaType =
      input.mediaType || inferTelegramMediaType(direct.url, direct.contentType);
    const videoMetadata =
      mediaType === "video"
        ? parseVideoDimensions(bytes, direct.contentType)
        : null;

    if (mediaType === "video" && !videoMetadata) {
      throw new Error(
        "Unable to determine the real video dimensions. Refusing to send the video without width/height metadata to prevent Telegram aspect-ratio distortion.",
      );
    }

    return {
      type: "upload",
      bytes,
      filename: filenameFromUrl(direct.url),
      contentType: direct.contentType || "application/octet-stream",
      mediaType,
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth: 0,
      videoMetadata,
      sourceUrl: direct.url,
      hls: false,
      segmentCount: 1,
      encrypted: false,
      remuxed: false,
    };
  }

  const resolved = await resolver.resolve(probe.url || input.mediaUrl.href, {
    headers: input.mediaHeaders,
    signal: options.signal,
  });
  const downloader = new HlsDownloader({
    headers: input.mediaHeaders,
    concurrency: options.concurrency,
    maxMediaBytes: hlsMaxMediaBytes,
  });
  const downloaded = await downloader.download(resolved, {
    signal: options.signal,
  });
  const remuxer = new HlsRemuxer();
  const baseName = baseNameFromUrl(input.sourceUrl || input.mediaUrl.href);
  const remuxed = remuxer.remux(downloaded, baseName);

  if (remuxed.bytes.byteLength > hlsMaxMediaBytes) {
    throw new Error(
      `Remuxed HLS output is ${remuxed.bytes.byteLength} bytes, above the configured in-memory HLS limit of ${hlsMaxMediaBytes} bytes`,
    );
  }

  const variant = resolved.selectedVariant;
  const parsedVideoMetadata = parseVideoDimensions(remuxed.bytes, remuxed.contentType);
  const videoMetadata =
    parsedVideoMetadata ||
    (variant?.resolution
      ? {
          width: variant.resolution.width,
          height: variant.resolution.height,
          durationSeconds: null,
          rotation: 0 as const,
        }
      : null);

  const preparedMediaType = input.mediaType || remuxed.mediaType;
  if (preparedMediaType === "video" && !videoMetadata) {
    throw new Error(
      "Unable to determine the real HLS video dimensions. Refusing to send the video without width/height metadata to prevent Telegram aspect-ratio distortion.",
    );
  }

  return {
    type: "upload",
    bytes: remuxed.bytes,
    filename: remuxed.filename,
    contentType: remuxed.contentType,
    mediaType: preparedMediaType,
    selectedBitrate:
      variant?.averageBandwidth ||
      variant?.bandwidth ||
      null,
    selectedResolution: variant?.resolution?.label || null,
    playlistDepth: Math.max(0, resolved.chain.length - 1),
    videoMetadata,
    sourceUrl: resolved.mediaPlaylist.url,
    hls: true,
    segmentCount:
      downloaded.video.segmentCount +
      (downloaded.audio?.segmentCount || 0),
    encrypted:
      downloaded.video.encrypted ||
      Boolean(downloaded.audio?.encrypted),
    remuxed: remuxed.remuxed,
  };
}

/**
 * Determines whether media probing can be skipped safely because the URL itself
 * already identifies a non-HLS media resource. This avoids an unnecessary HEAD
 * request while preserving probing for opaque URLs whose content type is unknown.
 *
 * @example
 * Input: `https://cdn.example.com/video.mp4`
 * Output: true
 */
function shouldSkipMediaProbe(mediaUrl: string): boolean {
  if (looksLikeHlsUrl(mediaUrl)) return false;

  if (shouldPreferWorkerUploadForTelegram({ mediaType: "video" }, mediaUrl)) {
    return true;
  }

  const extension = getFileExtension(mediaUrl);
  return VIDEO_EXTENSIONS.has(extension) ||
    PHOTO_EXTENSIONS.has(extension) ||
    AUDIO_EXTENSIONS.has(extension);
}

export function resolveMaxMediaBytes(rawValue: string | undefined): number {
  const value = Number(rawValue);

  return clampMaxMediaBytes(Number.isFinite(value) ? value : undefined);
}

export function resolveConcurrency(rawValue: string | undefined): number {
  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    return 4;
  }

  return Math.min(6, Math.max(1, Math.floor(value)));
}

export function resolveHlsMaxMediaBytes(rawValue: string | undefined): number {
  const value = Number(rawValue);

  return clampHlsMaxMediaBytes(Number.isFinite(value) ? value : undefined);
}

export function inferTelegramMediaType(
  mediaUrl: string,
  contentType: string,
): MediaType {
  const type = getBaseContentType(contentType);

  if (type.startsWith("image/")) {
    return "photo";
  }

  if (type.startsWith("video/")) {
    return "video";
  }

  if (type.startsWith("audio/")) {
    return "audio";
  }

  const extension = getFileExtension(mediaUrl);

  if (PHOTO_EXTENSIONS.has(extension)) {
    return "photo";
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  return "document";
}

/**
 * Forces Worker-owned uploads for videos whenever the configured size limit
 * permits it. This is intentionally provider-agnostic: the Worker must inspect
 * the actual container dimensions and send those dimensions to Telegram instead
 * of allowing a remote fetch to guess the media geometry.
 *
 * @example
 * shouldPreferWorkerUploadForTelegram({ mediaType: "video" }, "https://cdn.example/video.mp4");
 * // true
 */
export function shouldPreferWorkerUploadForTelegram(
  input: Pick<RelayInput, "mediaType">,
  _mediaUrl: string,
): boolean {
  return input.mediaType === "video";
}

function clampHlsMaxMediaBytes(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_HLS_MAX_MEDIA_BYTES;
  }

  return Math.min(
    HARD_HLS_MAX_MEDIA_BYTES,
    Math.max(1_000_000, Math.floor(value!)),
  );
}

function clampMaxMediaBytes(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_MEDIA_BYTES;
  }

  return Math.min(
    HARD_MAX_MEDIA_BYTES,
    Math.max(1_000_000, Math.floor(value!)),
  );
}

async function downloadDirectFile(
  url: string,
  headers: HeadersInit,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetchPublic(url, {
    method: "GET",
    headers,
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading direct media`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength > maximumBytes) {
    throw new Error(
      `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > maximumBytes) {
    throw new Error(
      `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`,
    );
  }

  return bytes;
}

/**
 * A few X CDN edges reject HEAD but honor a one-byte range request. Use this
 * only for the Worker-owned Twitter video path so an unknown HEAD length does
 * not silently fall back to Telegram's remote re-fetch.
 */
async function probeContentLengthByRange(
  url: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<number | null> {
  const rangeHeaders = new Headers(headers);
  rangeHeaders.set("Range", "bytes=0-0");

  try {
    const response = await fetchPublic(url, {
      method: "GET",
      headers: rangeHeaders,
      signal,
    });
    const contentRange = String(response.headers.get("content-range") || "");
    const total = Number(contentRange.match(/\/(\d+)\s*$/)?.[1] || 0);
    try { await response.body?.cancel(); } catch {}
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

function inferContentTypeFromUrl(value: string): string {
  const extension = getFileExtension(value);

  if (PHOTO_EXTENSIONS.has(extension)) {
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return `image/${extension}`;
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return extension === "webm" ? "video/webm" : "video/mp4";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    if (extension === "mp3") {
      return "audio/mpeg";
    }

    if (extension === "m4a") {
      return "audio/mp4";
    }

    return `audio/${extension}`;
  }

  return "application/octet-stream";
}

function filenameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "media");

    return sanitizeFilename(name || "media");
  } catch {
    return "media";
  }
}

function baseNameFromUrl(value: string): string {
  const filename = filenameFromUrl(value);

  return filename.replace(/\.[a-z0-9]{1,8}$/i, "") || "media";
}

function sanitizeFilename(value: string): string {
  return (
    String(value || "media")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "media"
  );
}
