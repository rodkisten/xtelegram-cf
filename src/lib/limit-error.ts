import { RELAY_LIMITS } from "../config/constants";

export type RelayLimitKind =
  | "direct_media_bytes"
  | "hls_media_bytes"
  | "hls_playlist_bytes"
  | "hls_cpu_budget"
  | "cpu_heavy_disabled"
  | "worker_resource_budget"
  | "multipart_file_bytes"
  | "multipart_total_bytes"
  | "album_total_bytes";

export interface RelayLimitExceededDetails {
  kind: RelayLimitKind;
  stage: string;
  limitBytes: number;
  actualBytes?: number | null;
  resolvedMediaUrl?: string | null;
  sourceUrl?: string | null;
  inputUrl?: string | null;
  mediaType?: string | null;
  contentType?: string | null;
}

export class RelayLimitExceededError extends Error {
  readonly details: RelayLimitExceededDetails;

  constructor(message: string, details: RelayLimitExceededDetails) {
    super(message);
    this.name = "RelayLimitExceededError";
    this.details = details;
  }
}

export function isRelayLimitExceededError(error: unknown): error is RelayLimitExceededError {
  return error instanceof RelayLimitExceededError;
}

export function resolveClientCompressionTargetBytes(value?: string | number | null): number {
  const parsed = Number(value ?? RELAY_LIMITS.clientCompressionTargetDefaultBytes);
  if (!Number.isFinite(parsed)) return RELAY_LIMITS.clientCompressionTargetDefaultBytes;
  return Math.min(
    RELAY_LIMITS.clientCompressionTargetHardBytes,
    Math.max(1_000_000, Math.floor(parsed)),
  );
}

export function buildLimitExceededPayload(
  error: RelayLimitExceededError,
  fallback: {
    sourceUrl?: string | null;
    inputUrl?: string | null;
    mediaType?: string | null;
    targetBytes?: number | null;
    mediaHeaders?: Record<string, string> | null;
    variants?: Array<{
      mediaUrl?: string | URL | null;
      quality?: string | null;
      width?: number | null;
      height?: number | null;
      contentLength?: number | null;
      bitrate?: number | null;
      mediaHeaders?: Record<string, string> | null;
    }>;
    caption?: string | null;
    parseMode?: string | null;
    provider?: string | null;
    mediaId?: string | null;
    mediaKey?: string | null;
    hashtags?: string[] | null;
    channels?: string[] | null;
    metadata?: Record<string, string> | null;
  } = {},
) {
  const resolvedMediaUrl = error.details.resolvedMediaUrl || fallback.inputUrl || null;
  const sourceUrl = error.details.sourceUrl || fallback.sourceUrl || null;
  const inputUrl = error.details.inputUrl || fallback.inputUrl || null;
  const targetBytes = resolveClientCompressionTargetBytes(fallback.targetBytes);
  const variants = (fallback.variants || []).map((variant) => ({
    mediaUrl: variant.mediaUrl instanceof URL ? variant.mediaUrl.href : String(variant.mediaUrl || "") || null,
    quality: variant.quality || null,
    width: Number.isFinite(Number(variant.width)) ? Number(variant.width) : null,
    height: Number.isFinite(Number(variant.height)) ? Number(variant.height) : null,
    contentLength: Number.isFinite(Number(variant.contentLength)) ? Number(variant.contentLength) : null,
    bitrate: Number.isFinite(Number(variant.bitrate)) ? Number(variant.bitrate) : null,
    mediaHeaders: variant.mediaHeaders || {},
  })).filter((variant) => Boolean(variant.mediaUrl));

  const cpuOnly = error.details.kind === "cpu_heavy_disabled";

  return {
    ok: false,
    limitExceeded: true,
    error: error.message,
    stage: error.details.stage,
    reason: error.details.kind,
    resolvedMediaUrl,
    sourceUrl,
    inputUrl,
    mediaType: error.details.mediaType || fallback.mediaType || null,
    contentType: error.details.contentType || null,
    limit: {
      kind: error.details.kind,
      maxBytes: error.details.limitBytes,
      actualBytes: error.details.actualBytes ?? null,
    },
    forceCpuRequired: cpuOnly,
    forceCpuParameter: cpuOnly ? "force_cpu=true" : null,
    clientFallback: {
      available: Boolean(resolvedMediaUrl),
      action: "download_prepare_and_upload",
      url: resolvedMediaUrl,
      downloadHeaders: fallback.mediaHeaders || {},
      targetBytes,
      telegramHostedUploadMaxBytes: RELAY_LIMITS.telegramUploadOtherBytes,
      registerEndpoint: "/media/register",
      variants,
      context: {
        sourceUrl,
        inputUrl,
        resolvedMediaUrl,
        mediaType: error.details.mediaType || fallback.mediaType || null,
        provider: fallback.provider || null,
        mediaId: fallback.mediaId || null,
        mediaKey: fallback.mediaKey || null,
        caption: fallback.caption || "",
        parseMode: fallback.parseMode || null,
        hashtags: fallback.hashtags || [],
        channels: fallback.channels || [],
        metadata: fallback.metadata || null,
      },
      hint: resolvedMediaUrl
        ? "Prepare the media on the client (a-Shell/FFmpeg), upload it directly to Telegram, then POST the successful Telegram message to /media/register."
        : "The relay stopped before a downloadable media URL was available.",
    },
  };
}
