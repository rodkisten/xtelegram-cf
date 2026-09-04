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

export function buildLimitExceededPayload(
  error: RelayLimitExceededError,
  fallback: {
    sourceUrl?: string | null;
    inputUrl?: string | null;
    mediaType?: string | null;
  } = {},
) {
  const resolvedMediaUrl = error.details.resolvedMediaUrl || fallback.inputUrl || null;
  const sourceUrl = error.details.sourceUrl || fallback.sourceUrl || null;
  const inputUrl = error.details.inputUrl || fallback.inputUrl || null;

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
    forceCpuRequired: error.details.kind === "cpu_heavy_disabled",
    forceCpuParameter: error.details.kind === "cpu_heavy_disabled" ? "force_cpu=true" : null,
    clientFallback: error.details.kind === "cpu_heavy_disabled"
      ? {
          available: true,
          action: "retry_with_force_cpu",
          url: resolvedMediaUrl,
          hint: "Retry the same relay request with force_cpu=true to enable CPU-heavy processing for this request only.",
        }
      : {
          available: Boolean(resolvedMediaUrl),
          action: "download_compress_and_resend",
          url: resolvedMediaUrl,
          hint: resolvedMediaUrl
            ? "Download the resolved media URL in Shortcuts, compress it, then resend it to /send as multipart/form-data."
            : "The relay exceeded a processing limit before a downloadable resolved URL was available.",
        },
  };
}
