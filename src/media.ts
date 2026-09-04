import { HlsDownloader, HlsDownloadError } from "./hls/downloader";
import { HlsRemuxer } from "./hls/remuxer";
import { HlsResolver, looksLikeHlsUrl } from "./hls/resolver";
import { parseVideoDimensionsBounded } from "./media/video-metadata";
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
  /** Enables CPU-heavy processing for this request only. Defaults to false. */
  allowCpuHeavy?: boolean;
  /** @deprecated Kept for source compatibility. Use allowCpuHeavy. */
  allowWorkerHlsTransmux?: boolean;
}

export async function prepareMedia(
  input: RelayInput,
  options: PrepareMediaOptions = {},
): Promise<PreparedMedia> {
  const maxMediaBytes = clampMaxMediaBytes(options.maxMediaBytes);
  const hlsMaxMediaBytes = clampHlsMaxMediaBytes(options.hlsMaxMediaBytes);
  const allowCpuHeavy = Boolean(options.allowCpuHeavy || options.allowWorkerHlsTransmux);
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
    const directMetadataHint = isVideo ? videoMetadataHintFromInput(input) : null;

    if (isVideo && !directMetadataHint && !allowCpuHeavy) {
      const metadataSafeFallback = await tryKnownQualityFallback(
        input,
        direct,
        inferredMediaType,
        uploadLimitBytes,
        options.signal,
        false,
      );
      if (metadataSafeFallback) return metadataSafeFallback;

      throwCpuHeavyDisabled(
        input,
        direct.url,
        "video-metadata",
        "Video dimensions are not available from the resolver, and container parsing is disabled in fast mode.",
      );
    }

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
        allowCpuHeavy,
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
        allowCpuHeavy,
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

    let downloadedDirect: DownloadedDirectFile;
    try {
      downloadedDirect = await downloadDirectFile(
        direct.url,
        input.mediaHeaders,
        uploadLimitBytes,
        options.signal,
        allowCpuHeavy,
      );
    } catch (error) {
      if (isRelayLimitExceededError(error)) {
        // The resolver may have been unable to determine Content-Length during
        // its HEAD/Range probes. If the authoritative download discovers that
        // the selected quality is too large, keep walking the already-known
        // quality ladder instead of returning 413 immediately.
        const qualityFallback = await tryKnownQualityFallback(
          input,
          direct,
          inferredMediaType,
          uploadLimitBytes,
          options.signal,
          allowCpuHeavy,
        );
        if (qualityFallback) return qualityFallback;

        const mediumFallback = await tryTwitterMediumQualityFallback(
          input,
          direct,
          uploadLimitBytes,
          options.signal,
          options.twirrlVersionToken,
          allowCpuHeavy,
        );
        if (mediumFallback) return mediumFallback;
      }
      throw error;
    }
    const bytes = downloadedDirect.bytes;
    const mediaType =
      input.mediaType || inferTelegramMediaType(direct.url, direct.contentType);
    const videoMetadata =
      mediaType === "video"
        ? reconcileVideoMetadata(
            directMetadataHint || !allowCpuHeavy
              ? null
              : parseVideoDimensionsBounded(bytes, direct.contentType),
            directMetadataHint,
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

  if (!allowCpuHeavy) {
    throwCpuHeavyDisabled(
      input,
      probe.url || input.mediaUrl.href,
      "hls-processing",
      "Worker-side HLS download/remux is disabled in fast mode.",
    );
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
  assertHlsPreflightCpuBudget(resolved, input, allowCpuHeavy);

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
  assertHlsTransmuxCpuBudget(downloaded, resolved.mediaPlaylist.url, input, allowCpuHeavy);

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
  const inputMetadataHint = videoMetadataHintFromInput(input);
  const variantMetadataHint = variant?.resolution
    ? {
        width: variant.resolution.width,
        height: variant.resolution.height,
        durationSeconds: null,
        rotation: 0 as const,
      }
    : null;
  const metadataHint = inputMetadataHint || variantMetadataHint;
  const parsedVideoMetadata = metadataHint
    ? null
    : parseVideoDimensionsBounded(remuxed.bytes, remuxed.contentType);
  const videoMetadata = reconcileVideoMetadata(
    parsedVideoMetadata || variantMetadataHint,
    inputMetadataHint,
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

export function resolveWorkerBufferedMediaBytes(rawValue?: string | number): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return RELAY_LIMITS.workerBufferedMediaDefaultBytes;
  return Math.min(
    RELAY_LIMITS.workerBufferedMediaHardBytes,
    Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(value)),
  );
}

export function resolveWorkerHlsBufferedMediaBytes(rawValue?: string | number): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return RELAY_LIMITS.workerHlsBufferedMediaDefaultBytes;
  return Math.min(
    RELAY_LIMITS.workerHlsBufferedMediaHardBytes,
    Math.max(RELAY_LIMITS.mediaMinimumBytes, Math.floor(value)),
  );
}

export function resolveWorkerHlsTransmuxEnabled(rawValue?: string | boolean): boolean {
  return ["1", "true", "yes", "on"].includes(String(rawValue ?? "").trim().toLowerCase());
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
  allowCpuHeavy = false,
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
      const contentType = inferContentTypeFromUrl(variant.mediaUrl.href);
      const variantMetadataHint = variant.width && variant.height
        ? {
            width: variant.width,
            height: variant.height,
            durationSeconds: null,
            rotation: 0 as const,
          }
        : videoMetadataHintFromInput(input);

      if (mediaType === "video" && !variantMetadataHint && !allowCpuHeavy) continue;

      const downloaded = await downloadDirectFile(
        variant.mediaUrl.href,
        variant.mediaHeaders,
        maximumBytes,
        signal,
        allowCpuHeavy,
      );
      const bytes = downloaded.bytes;
      const videoMetadata = mediaType === "video"
        ? reconcileVideoMetadata(
            variantMetadataHint || !allowCpuHeavy
              ? null
              : parseVideoDimensionsBounded(bytes, contentType),
            variantMetadataHint,
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
  allowCpuHeavy = false,
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

    const preflightMetadataHint = medium.width && medium.height
      ? {
          width: medium.width,
          height: medium.height,
          durationSeconds: null,
          rotation: 0 as const,
        }
      : videoMetadataHintFromInput(input);
    if (!preflightMetadataHint && !allowCpuHeavy) return null;

    const downloadedMedium = await downloadDirectFile(
      medium.url,
      medium.mediaHeaders,
      maximumBytes,
      signal,
      allowCpuHeavy,
    );
    const bytes = downloadedMedium.bytes;

    const mediumMetadataHint = preflightMetadataHint;
    const videoMetadata = reconcileVideoMetadata(
      mediumMetadataHint || !allowCpuHeavy
        ? null
        : parseVideoDimensionsBounded(
            bytes,
            inferContentTypeFromUrl(medium.url),
          ),
      mediumMetadataHint,
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


function assertHlsPreflightCpuBudget(
  resolved: {
    mediaPlaylist: {
      url: string;
      segments: Array<{ uri: string; gap: boolean; map: { uri: string } | null; keys: unknown[]; key: unknown | null }>;
      trailingParts: Array<{ uri: string; gap: boolean }>;
    };
    audio: {
      playlist: {
        segments: Array<{ uri: string; gap: boolean; map: { uri: string } | null; keys: unknown[]; key: unknown | null }>;
        trailingParts: Array<{ uri: string; gap: boolean }>;
      };
    } | null;
  },
  input: RelayInput,
  allowWorkerHlsTransmux: boolean,
): void {
  const playlists = [
    resolved.mediaPlaylist,
    ...(resolved.audio ? [resolved.audio.playlist] : []),
  ];

  const segmentCount = playlists.reduce((total, playlist) => {
    const regular = playlist.segments.filter((segment) => segment.uri && !segment.gap).length;
    const parts = regular ? 0 : playlist.trailingParts.filter((part) => part.uri && !part.gap).length;
    return total + regular + parts;
  }, 0);

  // EXT-X-MAP strongly indicates fragmented MP4, which only needs concatenation.
  // MPEG-TS requires mux.js-style parsing/rewrite and is disabled by default
  // because it is the dominant CPU-1102 path on Cloudflare Workers.
  const likelyTransportStream = playlists.some((playlist) =>
    playlist.segments.some((segment) =>
      !segment.map?.uri && /\.ts(?:$|[?#])/i.test(segment.uri)
    )
  );

  if (!likelyTransportStream || allowWorkerHlsTransmux) return;

  throw new RelayLimitExceededError(
    allowWorkerHlsTransmux
      ? `HLS MPEG-TS has ${segmentCount} segments, above the Worker CPU-safe transmux budget`
      : "Worker-side MPEG-TS transmuxing is disabled to prevent Cloudflare Error 1102",
    {
      kind: "hls_cpu_budget",
      stage: "hls-transmux-preflight-cpu-guard",
      limitBytes: RELAY_LIMITS.hlsTransmuxCpuMaxInputBytes,
      actualBytes: null,
      resolvedMediaUrl: resolved.mediaPlaylist.url,
      sourceUrl: input.sourceUrl,
      inputUrl: input.mediaUrl.href,
      mediaType: input.mediaType || "video",
      contentType: "application/vnd.apple.mpegurl",
    },
  );
}

function assertHlsTransmuxCpuBudget(
  downloaded: {
    video: { container: string; size: number; segmentCount: number };
    audio: { container: string; size: number; segmentCount: number } | null;
  },
  resolvedMediaUrl: string,
  input: RelayInput,
  allowWorkerHlsTransmux: boolean,
): void {
  const requiresTransmux =
    downloaded.video.container === "mpegts" ||
    downloaded.audio?.container === "mpegts";

  if (!requiresTransmux) return;

  const inputBytes = downloaded.video.size + (downloaded.audio?.size || 0);
  const segmentCount =
    downloaded.video.segmentCount + (downloaded.audio?.segmentCount || 0);

  if (allowWorkerHlsTransmux) return;

  throw new RelayLimitExceededError(
    allowWorkerHlsTransmux
      ? `HLS MPEG-TS requires CPU-heavy transmuxing beyond the Worker safe budget (${inputBytes} bytes / ${segmentCount} segments)`
      : "Worker-side MPEG-TS transmuxing is disabled to prevent Cloudflare Error 1102",
    {
      kind: "hls_cpu_budget",
      stage: "hls-transmux-cpu-guard",
      limitBytes: RELAY_LIMITS.hlsTransmuxCpuMaxInputBytes,
      actualBytes: inputBytes,
      resolvedMediaUrl,
      sourceUrl: input.sourceUrl,
      inputUrl: input.mediaUrl.href,
      mediaType: input.mediaType || "video",
      contentType: "application/vnd.apple.mpegurl",
    },
  );
}

function videoMetadataHintFromInput(input: RelayInput): VideoMetadata | null {
  let width = Number(input.metadata?.resolvedWidth || 0);
  let height = Number(input.metadata?.resolvedHeight || 0);

  if (!isUsableVideoDimension(width) || !isUsableVideoDimension(height)) {
    const currentVariant = input.mediaVariants.find((variant) =>
      variant.mediaUrl.href === input.mediaUrl.href &&
      variant.width != null && variant.height != null,
    );
    width = Number(currentVariant?.width || 0);
    height = Number(currentVariant?.height || 0);
  }

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
  computeContentIdentity = false,
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
    const contentIdentity = computeContentIdentity
      ? await buildMediaFingerprint(bytes)
      : emptyContentIdentity(bytes.byteLength);
    return { bytes, contentIdentity };
  }

  // Unknown-size and large bodies deliberately skip exact SHA-256. Provider/media
  // identity remains authoritative and the fixed-budget fingerprint still gives
  // content-level duplicate protection without hashing tens of megabytes.
  const shouldComputeExactHash = computeContentIdentity;
  const accumulator = computeContentIdentity
    ? new MediaFingerprintAccumulator(shouldComputeExactHash)
    : null;
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

      // ReadableStream already gives us an owned Uint8Array. Keeping that chunk
      // directly avoids one full extra memcpy before the final contiguous buffer.
      chunks.push(value);
      if (accumulator) await accumulator.update(value);
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
    contentIdentity: accumulator
      ? await accumulator.digest()
      : emptyContentIdentity(totalBytes),
  };
}

function emptyContentIdentity(byteLength: number): MediaContentFingerprint {
  return {
    sha256: null,
    fingerprint: "",
    fingerprintVersion: 0,
    byteLength,
    sampledBytes: 0,
  };
}

function throwCpuHeavyDisabled(
  input: RelayInput,
  resolvedMediaUrl: string,
  stage: string,
  message: string,
): never {
  throw new RelayLimitExceededError(message, {
    kind: "cpu_heavy_disabled",
    stage,
    limitBytes: 0,
    actualBytes: null,
    resolvedMediaUrl,
    sourceUrl: input.sourceUrl,
    inputUrl: input.mediaUrl.href,
    mediaType: input.mediaType || "video",
    contentType: null,
  });
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
