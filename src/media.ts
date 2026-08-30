import { HlsDownloader, HlsDownloadError } from "./hls/downloader";
import { HlsRemuxer } from "./hls/remuxer";
import { HlsResolver, looksLikeHlsUrl } from "./hls/resolver";
import { parseVideoDimensions } from "./media/video-metadata";
import { resolveTwitterMediumMedia } from "./social";
import { buildMediaFingerprint, MediaFingerprintAccumulator, type MediaContentFingerprint } from "./services/media-fingerprint";
import { fetchPublic, getBaseContentType, getFileExtension } from "./lib/http";
import { RELAY_LIMITS } from "./config/constants";
import { RelayLimitExceededError, isRelayLimitExceededError } from "./lib/limit-error";
import type {
  MediaType,
  PreparedMedia,
  RelayInput,
  RelayMediaVariant,
  ResolvedDirectFile,
  VideoMetadata,
} from "./types";

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
  /** Optional Twirrl token used only by the oversized X medium-quality fallback. */
  twirrlVersionToken?: string;
}

export async function prepareMedia(
  input: RelayInput,
  options: PrepareMediaOptions = {},
): Promise<PreparedMedia> {
  const maxMediaBytes = clampMaxMediaBytes(options.maxMediaBytes);
  const hlsMaxMediaBytes = clampHlsMaxMediaBytes(options.hlsMaxMediaBytes);
  const resolver = new HlsResolver({
    maxDepth: RELAY_LIMITS.hlsResolverDepth,
    maxPlaylistBytes: RELAY_LIMITS.hlsPlaylistBytes,
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
      selectedBitrate: Number(input.metadata?.resolvedBitrate || 0) || null,
      selectedResolution: input.metadata?.resolvedQuality || null,
      playlistDepth: 0,
      videoMetadata: null,
    };
    const inferredMediaType =
      input.mediaType || inferTelegramMediaType(direct.url, direct.contentType);
    const isVideo = inferredMediaType === "video";
    const uploadLimitBytes = resolveTelegramUploadLimitBytes(inferredMediaType, maxMediaBytes);
    const remoteLimitBytes = resolveTelegramRemoteUrlLimitBytes(inferredMediaType);

    // The hosted Telegram Bot API has different URL and multipart ceilings.
    // Resolve the real size before deciding the transport whenever the resolver
    // did not already provide it.
    if (direct.contentLength == null) {
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
      direct.contentLength != null &&
      direct.contentLength <= remoteLimitBytes
    ) {
      return direct;
    }

    if (direct.contentLength != null && direct.contentLength > uploadLimitBytes) {
      const qualityFallback = await tryKnownQualityFallback(
        input,
        direct,
        inferredMediaType,
        uploadLimitBytes,
        options.signal,
      );
      if (qualityFallback) return qualityFallback;

      // Legacy compatibility for older clients/resolvers that do not yet send
      // mediaVariants. New resolve-and-send traffic normally never needs this.
      const mediumFallback = await tryTwitterMediumQualityFallback(
        input,
        direct,
        uploadLimitBytes,
        options.signal,
        options.twirrlVersionToken,
      );
      if (mediumFallback) return mediumFallback;

      throw new RelayLimitExceededError(
        `Direct media is ${direct.contentLength} bytes, above the effective Telegram/configured upload limit of ${uploadLimitBytes} bytes`,
        {
          kind: "direct_media_bytes",
          stage: "prepare-media",
          limitBytes: uploadLimitBytes,
          actualBytes: direct.contentLength,
          resolvedMediaUrl: direct.url,
          sourceUrl: input.sourceUrl,
          inputUrl: input.mediaUrl.href,
          mediaType: inferredMediaType,
          contentType: direct.contentType,
        },
      );
    }

    const downloadedDirect = await downloadDirectFile(
      direct.url,
      input.mediaHeaders,
      uploadLimitBytes,
      options.signal,
    );
    const bytes = downloadedDirect.bytes;
    const mediaType =
      input.mediaType || inferTelegramMediaType(direct.url, direct.contentType);
    const videoMetadata =
      mediaType === "video"
        ? reconcileVideoMetadata(
            parseVideoDimensions(bytes, direct.contentType),
            videoMetadataHintFromInput(input),
          )
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
      mediaSha256: downloadedDirect.contentIdentity.sha256,
      mediaFingerprint: downloadedDirect.contentIdentity.fingerprint,
      mediaFingerprintVersion: downloadedDirect.contentIdentity.fingerprintVersion,
      mediaByteLength: downloadedDirect.contentIdentity.byteLength,
    };
  }

  let resolved;
  try {
    resolved = await resolver.resolve(probe.url || input.mediaUrl.href, {
      headers: input.mediaHeaders,
      signal: options.signal,
    });
  } catch (error) {
    if (/playlist exceeds the relay size limit/i.test(String(error instanceof Error ? error.message : error))) {
      throw new RelayLimitExceededError(
        "HLS playlist exceeds the relay processing limit",
        {
          kind: "hls_playlist_bytes",
          stage: "resolve-hls",
          limitBytes: RELAY_LIMITS.hlsPlaylistBytes,
          actualBytes: null,
          resolvedMediaUrl: probe.url || input.mediaUrl.href,
          sourceUrl: input.sourceUrl,
          inputUrl: input.mediaUrl.href,
          mediaType: input.mediaType || "video",
          contentType: "application/vnd.apple.mpegurl",
        },
      );
    }
    throw error;
  }
  const downloader = new HlsDownloader({
    headers: input.mediaHeaders,
    concurrency: options.concurrency,
    maxMediaBytes: hlsMaxMediaBytes,
  });
  let downloaded;
  try {
    downloaded = await downloader.download(resolved, {
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof HlsDownloadError) {
      const actualBytes = Number(error.details.used || 0) || null;
      const limitBytes = Number(error.details.maximum || hlsMaxMediaBytes);
      throw new RelayLimitExceededError(error.message, {
        kind: "hls_media_bytes",
        stage: "prepare-hls",
        limitBytes,
        actualBytes,
        resolvedMediaUrl: resolved.mediaPlaylist.url,
        sourceUrl: input.sourceUrl,
        inputUrl: input.mediaUrl.href,
        mediaType: input.mediaType || "video",
        contentType: "application/vnd.apple.mpegurl",
      });
    }
    throw error;
  }
  const remuxer = new HlsRemuxer();
  const baseName = baseNameFromUrl(input.sourceUrl || input.mediaUrl.href);
  const remuxed = remuxer.remux(downloaded, baseName);

  if (remuxed.bytes.byteLength > hlsMaxMediaBytes) {
    throw new RelayLimitExceededError(
      `Remuxed HLS output is ${remuxed.bytes.byteLength} bytes, above the configured in-memory HLS limit of ${hlsMaxMediaBytes} bytes`,
      {
        kind: "hls_media_bytes",
        stage: "prepare-hls",
        limitBytes: hlsMaxMediaBytes,
        actualBytes: remuxed.bytes.byteLength,
        resolvedMediaUrl: resolved.mediaPlaylist.url,
        sourceUrl: input.sourceUrl,
        inputUrl: input.mediaUrl.href,
        mediaType: input.mediaType || remuxed.mediaType,
        contentType: remuxed.contentType,
      },
    );
  }

  const variant = resolved.selectedVariant;
  const parsedVideoMetadata = parseVideoDimensions(remuxed.bytes, remuxed.contentType);
  const videoMetadata = reconcileVideoMetadata(
    parsedVideoMetadata ||
      (variant?.resolution
        ? {
            width: variant.resolution.width,
            height: variant.resolution.height,
            durationSeconds: null,
            rotation: 0 as const,
          }
        : null),
    videoMetadataHintFromInput(input),
  );

  const preparedMediaType = input.mediaType || remuxed.mediaType;
  if (preparedMediaType === "video" && !videoMetadata) {
    throw new Error(
      "Unable to determine the real HLS video dimensions. Refusing to send the video without width/height metadata to prevent Telegram aspect-ratio distortion.",
    );
  }

  const contentIdentity = await buildMediaFingerprint(remuxed.bytes);

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
    mediaSha256: contentIdentity.sha256,
    mediaFingerprint: contentIdentity.fingerprint,
    mediaFingerprintVersion: contentIdentity.fingerprintVersion,
    mediaByteLength: contentIdentity.byteLength,
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
    return RELAY_LIMITS.hlsConcurrencyDefault;
  }

  return Math.min(RELAY_LIMITS.hlsConcurrencyMax, Math.max(1, Math.floor(value)));
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
export function resolveTelegramRemoteUrlLimitBytes(mediaType: MediaType): number {
  return mediaType === "photo"
    ? RELAY_LIMITS.telegramRemotePhotoBytes
    : RELAY_LIMITS.telegramRemoteOtherBytes;
}

export function resolveTelegramUploadLimitBytes(
  mediaType: MediaType,
  configuredMaxBytes: number,
): number {
  const telegramLimit = mediaType === "photo"
    ? RELAY_LIMITS.telegramUploadPhotoBytes
    : RELAY_LIMITS.telegramUploadOtherBytes;
  return Math.min(configuredMaxBytes, telegramLimit);
}

export function shouldPreferWorkerUploadForTelegram(
  input: Pick<RelayInput, "mediaType">,
  _mediaUrl: string,
): boolean {
  return input.mediaType === "video";
}

function clampHlsMaxMediaBytes(value?: number): number {
  if (!Number.isFinite(value)) {
    return RELAY_LIMITS.hlsMediaDefaultBytes;
  }

  return Math.min(
    RELAY_LIMITS.hlsMediaHardBytes,
    Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(value!)),
  );
}

function clampMaxMediaBytes(value?: number): number {
  if (!Number.isFinite(value)) {
    return RELAY_LIMITS.directMediaDefaultBytes;
  }

  return Math.min(
    RELAY_LIMITS.directMediaHardBytes,
    Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(value!)),
  );
}

async function tryKnownQualityFallback(
  input: RelayInput,
  direct: ResolvedDirectFile,
  mediaType: MediaType,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<PreparedMedia | null> {
  if (!input.mediaVariants.length || signal?.aborted) return null;

  const variants = dedupeRelayVariants(input.mediaVariants);
  const currentIndex = variants.findIndex((variant) =>
    variant.mediaUrl.href === direct.url || variant.mediaUrl.href === input.mediaUrl.href,
  );
  const lowerVariants = (currentIndex >= 0 ? variants.slice(currentIndex + 1) : variants)
    .filter((variant) =>
      variant.mediaUrl.href !== direct.url && variant.mediaUrl.href !== input.mediaUrl.href,
    );

  for (const variant of lowerVariants) {
    if (signal?.aborted) return null;
    if (variant.contentLength != null && variant.contentLength > maximumBytes) continue;

    try {
      const downloaded = await downloadDirectFile(
        variant.mediaUrl.href,
        variant.mediaHeaders,
        maximumBytes,
        signal,
      );
      const bytes = downloaded.bytes;
      const contentType = inferContentTypeFromUrl(variant.mediaUrl.href);
      const videoMetadata = mediaType === "video"
        ? reconcileVideoMetadata(
            parseVideoDimensions(bytes, contentType),
            variant.width && variant.height
              ? {
                  width: variant.width,
                  height: variant.height,
                  durationSeconds: null,
                  rotation: 0,
                }
              : videoMetadataHintFromInput(input),
          )
        : null;

      if (mediaType === "video" && !videoMetadata) continue;

      return {
        type: "upload",
        bytes,
        filename: filenameFromUrl(variant.mediaUrl.href),
        contentType,
        mediaType,
        selectedBitrate: variant.bitrate,
        selectedResolution:
          variant.quality ||
          (variant.width && variant.height ? `${variant.width}x${variant.height}` : null),
        playlistDepth: 0,
        videoMetadata,
        sourceUrl: variant.mediaUrl.href,
        hls: false,
        segmentCount: 1,
        encrypted: false,
        remuxed: false,
        mediaSha256: downloaded.contentIdentity.sha256,
        mediaFingerprint: downloaded.contentIdentity.fingerprint,
        mediaFingerprintVersion: downloaded.contentIdentity.fingerprintVersion,
        mediaByteLength: downloaded.contentIdentity.byteLength,
      };
    } catch (error) {
      if (isRelayLimitExceededError(error)) continue;
      // A broken lower CDN rendition should not prevent trying the next rung.
      continue;
    }
  }

  return null;
}

function dedupeRelayVariants(variants: RelayMediaVariant[]): RelayMediaVariant[] {
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = variant.mediaUrl.href;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function tryTwitterMediumQualityFallback(
  input: RelayInput,
  direct: ResolvedDirectFile,
  maximumBytes: number,
  signal?: AbortSignal,
  twirrlVersionToken?: string,
): Promise<PreparedMedia | null> {
  if (input.provider?.toLowerCase() !== "twitter") return null;
  if (direct.contentLength == null) return null;
  if (direct.contentLength <= RELAY_LIMITS.twitterMediumFallbackTriggerBytes) return null;
  if (!input.sourceUrl) return null;
  if (signal?.aborted) return null;

  try {
    const medium = await resolveTwitterMediumMedia(
      input.sourceUrl,
      twirrlVersionToken,
    );

    if (!medium || medium.url === direct.url) return null;

    const downloadedMedium = await downloadDirectFile(
      medium.url,
      medium.mediaHeaders,
      maximumBytes,
      signal,
    );
    const bytes = downloadedMedium.bytes;

    const videoMetadata = reconcileVideoMetadata(
      parseVideoDimensions(
        bytes,
        inferContentTypeFromUrl(medium.url),
      ),
      medium.width && medium.height
        ? {
            width: medium.width,
            height: medium.height,
            durationSeconds: null,
            rotation: 0,
          }
        : videoMetadataHintFromInput(input),
    );

    if (!videoMetadata) {
      throw new Error(
        "Twirrl medium-quality fallback did not expose valid video dimensions",
      );
    }

    return {
      type: "upload",
      bytes,
      filename: filenameFromUrl(medium.url),
      contentType: inferContentTypeFromUrl(medium.url),
      mediaType: "video",
      selectedBitrate: null,
      selectedResolution:
        medium.quality ||
        (medium.width && medium.height
          ? `${medium.width}x${medium.height}`
          : null),
      playlistDepth: 0,
      videoMetadata,
      sourceUrl: medium.url,
      hls: false,
      segmentCount: 1,
      encrypted: false,
      remuxed: false,
      mediaSha256: downloadedMedium.contentIdentity.sha256,
      mediaFingerprint: downloadedMedium.contentIdentity.fingerprint,
      mediaFingerprintVersion: downloadedMedium.contentIdentity.fingerprintVersion,
      mediaByteLength: downloadedMedium.contentIdentity.byteLength,
    };
  } catch (error) {
    // If Twirrl already gave us a concrete medium-quality media URL but that URL
    // still exceeds the Worker budget, expose that resolved URL to the client.
    // It is a better Shortcuts fallback than sending the user back to the larger
    // original variant.
    if (isRelayLimitExceededError(error)) throw error;

    // Other lower-quality failures are only an optimization failure. Preserve
    // the original path rather than sending an unverified remote video.
    return null;
  }
}


function videoMetadataHintFromInput(input: RelayInput): VideoMetadata | null {
  const width = Number(input.metadata?.resolvedWidth || 0);
  const height = Number(input.metadata?.resolvedHeight || 0);

  if (!isUsableVideoDimension(width) || !isUsableVideoDimension(height)) {
    return null;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    durationSeconds: null,
    rotation: 0,
  };
}

/**
 * Keeps container metadata authoritative while using resolver geometry as a
 * guard against a missed 90/270-degree rotation. If the container parser
 * produces the reciprocal aspect ratio of a trusted resolver hint, the display
 * dimensions are swapped before reaching Telegram.
 */
function reconcileVideoMetadata(
  actual: VideoMetadata | null,
  hint: VideoMetadata | null,
): VideoMetadata | null {
  if (!actual) return hint;
  if (!hint) return actual;

  const actualAspect = actual.width / actual.height;
  const hintAspect = hint.width / hint.height;

  if (aspectRatiosClose(actualAspect, hintAspect)) {
    return actual;
  }

  if (aspectRatiosClose(1 / actualAspect, hintAspect)) {
    return {
      ...actual,
      width: actual.height,
      height: actual.width,
      rotation:
        actual.rotation === 0
          ? 90
          : actual.rotation === 90
            ? 0
            : actual.rotation === 180
              ? 270
              : 180,
    };
  }

  // Do not override genuinely different geometry with third-party metadata.
  return actual;
}

function aspectRatiosClose(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return false;
  }

  return Math.abs(Math.log(left / right)) <= 0.035;
}

function isUsableVideoDimension(value: number): boolean {
  return Number.isFinite(value) &&
    value > 0 &&
    value <= RELAY_LIMITS.telegramVideoDimensionMax;
}

interface DownloadedDirectFile {
  bytes: Uint8Array;
  contentIdentity: MediaContentFingerprint;
}

/**
 * Downloads a Worker-owned media body while hashing every received chunk in the
 * same pass. The bytes are still collected because the Telegram multipart path
 * requires a replayable Blob, but no second full-buffer hash pass is needed.
 *
 * @example
 * const downloaded = await downloadDirectFile(url, headers, 49_000_000);
 * console.log(downloaded.contentIdentity.sha256);
 */
async function downloadDirectFile(
  url: string,
  headers: HeadersInit,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<DownloadedDirectFile> {
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
    throw new RelayLimitExceededError(
      `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`,
      { kind: "direct_media_bytes", stage: "download-media", limitBytes: maximumBytes, actualBytes: contentLength, resolvedMediaUrl: response.url || url, inputUrl: url, contentType: response.headers.get("content-type") },
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new RelayLimitExceededError(
        `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`,
        { kind: "direct_media_bytes", stage: "download-media", limitBytes: maximumBytes, actualBytes: bytes.byteLength, resolvedMediaUrl: response.url || url, inputUrl: url, contentType: response.headers.get("content-type") },
      );
    }
    const contentIdentity = await buildMediaFingerprint(bytes);
    return { bytes, contentIdentity };
  }

  const accumulator = new MediaFingerprintAccumulator();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw new RelayLimitExceededError(
          `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`,
          { kind: "direct_media_bytes", stage: "download-media", limitBytes: maximumBytes, actualBytes: totalBytes, resolvedMediaUrl: response.url || url, inputUrl: url, contentType: response.headers.get("content-type") },
        );
      }

      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
      await accumulator.update(chunk);
    }
  } finally {
    try { await reader.releaseLock(); } catch {}
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    bytes,
    contentIdentity: await accumulator.digest(),
  };
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
