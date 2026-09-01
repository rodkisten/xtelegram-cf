export const SERVICE_NAME = "generic-telegram-media-relay";
export const SERVICE_VERSION = "2.15.1";
export const SERVICE_RUNTIME =
  "typescript-hls-remux-photo-video-album-ordered-fallback-d1-atomic-claims-batch-send-social-metadata-modular";

export const MAX_MEDIA_CHECK_ITEMS = 100;
export const MAX_MEDIA_CHECK_CHANNELS = 100;
export const MAX_BATCH_ITEMS = 50;
export const DEFAULT_BATCH_CONCURRENCY = 3;
export const MAX_BATCH_CONCURRENCY = 5;
export const MAX_TELEGRAM_CHANNELS_PER_REQUEST = 20;

export const RELAY_LIMITS = Object.freeze({
  mediaMinimumBytes: 1 * 1024 * 1024,
  // Official hosted Bot API "Sending Files" ceilings for the transports this relay uses.
  // URL: 5 MB for photos, 20 MB for other content.
  // multipart/form-data: 10 MB for photos, 50 MB for other files.
  telegramRemotePhotoBytes: 5 * 1024 * 1024,
  telegramRemoteOtherBytes: 20 * 1024 * 1024,
  telegramUploadPhotoBytes: 10 * 1024 * 1024,
  telegramUploadOtherBytes: 50 * 1024 * 1024,
  // Backwards-compatible alias used by older callers.
  telegramRemoteUrlBytes: 20 * 1024 * 1024,
  twitterMediumFallbackTriggerBytes: 50 * 1024 * 1024,

  directMediaDefaultBytes: 48 * 1024 * 1024,
  directMediaHardBytes: 50 * 1024 * 1024,

  hlsMediaDefaultBytes: 48 * 1024 * 1024,
  hlsMediaHardBytes: 50 * 1024 * 1024,
  hlsPlaylistBytes: 2 * 1024 * 1024,
  hlsResolverDepth: 4,
  hlsConcurrencyDefault: 3,
  hlsConcurrencyMax: 4,

  telegramVideoDimensionMax: 10_000,

  socialCaptionTextMax: 900,
  socialMetadataTimeoutDefaultMs: 4_000,
  socialMetadataTimeoutMaxMs: 10_000,
  socialMetadataCacheTtlMs: 15 * 60 * 1000,
  socialMetadataCacheEntriesMax: 500,

  videoMetadataBoxDepthMax: 12,
  videoMetadataBoxCountMax: 2_048,

  // Variant probing is intentionally bounded: all quality URLs are retained, while
  // unknown sizes are resolved with HEAD/Range requests at controlled concurrency.
  qualityProbeConcurrency: 2,
  qualityProbeTimeoutMs: 6_000,

  // CPU safety. Exact hashing is secondary to the provider/media identity and
  // becomes disproportionately expensive on large Worker-owned videos. Large
  // media keeps the bounded near-duplicate fingerprint but skips full SHA-256.
  exactContentHashMaxBytes: 8 * 1024 * 1024,

  // mux.js transmuxes MPEG-TS in pure JavaScript. Above either threshold the
  // Worker returns a controlled client fallback instead of risking Cloudflare
  // terminating the isolate for excessive CPU. fMP4 concatenation is not
  // subject to this guard because it does not parse/rewrite the full stream.
  hlsTransmuxCpuMaxInputBytes: 12 * 1024 * 1024,
  hlsTransmuxCpuMaxSegments: 72,
} as const);
