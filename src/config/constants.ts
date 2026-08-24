export const SERVICE_NAME = "generic-telegram-media-relay";
export const SERVICE_VERSION = "2.14.1";
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
  telegramRemoteUrlBytes: 20 * 1024 * 1024,
  twitterMediumFallbackTriggerBytes: 50 * 1024 * 1024,

  directMediaDefaultBytes: 48 * 1024 * 1024,
  directMediaHardBytes: 50 * 1024 * 1024,

  hlsMediaDefaultBytes: 48 * 1024 * 1024,
  hlsMediaHardBytes: 50 * 1024 * 1024,
  hlsPlaylistBytes: 2 * 1024 * 1024,
  hlsResolverDepth: 4,
  hlsConcurrencyDefault: 4,
  hlsConcurrencyMax: 8,

  telegramVideoDimensionMax: 10_000,

  socialCaptionTextMax: 900,
  socialMetadataTimeoutDefaultMs: 4_000,
  socialMetadataTimeoutMaxMs: 10_000,
  socialMetadataCacheTtlMs: 15 * 60 * 1000,
  socialMetadataCacheEntriesMax: 500,

  videoMetadataBoxDepthMax: 12,
  videoMetadataBoxCountMax: 2_048,
} as const);
