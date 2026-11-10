export interface Env {
  /** Publishing provider secret. Set with Wrangler secret put, never commit its value. */
  ZERNIO_API_KEY?: string;
  /** Explicit feature gate; false by default even if a key is present. */
  ZERNIO_ENABLED?: string;
  ZERNIO_TWITTER_ACCOUNT_ID?: string;
  ZERNIO_INSTAGRAM_ACCOUNT_ID?: string;
  /** Explicit second opt-in for cron-driven posts. */
  ZERNIO_AUTO_PUBLISH?: string;
  ZERNIO_AUTO_PLATFORM?: "twitter" | "instagram";
  /** Explicit opt-in to queue successful X/Twitter Relay deliveries without request flags. */
  X_REPOST_AUTO_QUEUE?: string;
  /** Optional Telegram chat for due-time Scriptable reminders. */
  X_REPOST_NOTIFY_CHAT_ID?: string;
  /** Optional R2 bucket with a durable copy of the video, for deferred iPhone sharing. */
  X_REPOST_MEDIA?: R2Bucket;
  RELAY_DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /** Default destination for text notifications. Numeric chat IDs may contain a :topic suffix. */
  NOTIFICATION_CHAT_ID?: string;
  /** Independent bearer secret required by POST /notifications/send. */
  NOTIFICATION_API_TOKEN?: string;
  /** HMAC-SHA256 secret supplied to GitHub repository/organization webhook settings. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** Destination for GitHub Actions alerts (falls back to NOTIFICATION_CHAT_ID). */
  GITHUB_WEBHOOK_CHAT_ID?: string;
  /** Comma-separated workflow_run actions; default completed. */
  GITHUB_NOTIFY_ACTIONS?: string;
  TELEGRAM_CHAT_ID?: string;
  /** @deprecated Use TELEGRAM_CHAT_ID. Kept for backwards compatibility. */
  TELEGRAM_CHANNEL_ID?: string;
  RELAY_TOKEN: string;
  MAX_MEDIA_BYTES?: string;
  /** Target bytes for client-side a-Shell compression before direct Telegram upload. */
  CLIENT_COMPRESS_TARGET_BYTES?: string;
  HLS_CONCURRENCY?: string;
  HLS_MAX_MEDIA_BYTES?: string;
  /** Max bytes the Worker may buffer for one direct media upload before client fallback. */
  WORKER_BUFFERED_MEDIA_BYTES?: string;
  /** Max combined bytes the Worker may hold while assembling HLS/fMP4 media. */
  WORKER_HLS_BUFFERED_MEDIA_BYTES?: string;
  /** Global opt-in for CPU-heavy media processing. Defaults to false. */
  ENABLE_CPU_HEAVY?: string;
  /** @deprecated Use ENABLE_CPU_HEAVY or per-request force_cpu=true. */
  ALLOW_WORKER_HLS_TRANSMUX?: string;
  MULTIPART_MAX_TOTAL_BYTES?: string;
  TWIRRL_VERSION_TOKEN?: string;
  /** Optional self-hosted Cobalt API base URL. */
  COBALT_API_URL?: string;
  /** Optional API key for a protected self-hosted Cobalt instance. */
  COBALT_API_KEY?: string;
  /** Optional Piped API base URL for YouTube stream fallback. */
  PIPED_API_URL?: string;
  /** Optional external yt-dlp JSON resolver endpoint. */
  YTDLP_API_URL?: string;
  /** Optional bearer token for the external yt-dlp resolver endpoint. */
  YTDLP_API_TOKEN?: string;
  /** Optional HMAC key extracted from the current sssInstagram browser bundle. */
  SSSINSTAGRAM_HMAC_KEY?: string;
  /** Browser bundle _ts constant paired with SSSINSTAGRAM_HMAC_KEY. */
  SSSINSTAGRAM_BUILD_TS?: string;
  /** Optional paid EasyDown API token. */
  EASYDOWN_API_KEY?: string;
  /** Optional paid GetInSaver API token. */
  GETINSAVER_API_KEY?: string;
  DELIVERY_CLAIM_TTL_SECONDS?: string;
  SOCIAL_METADATA_TIMEOUT_MS?: string;
  /** Maximum binary thumbnail bytes encoded into response Base64. */
  THUMBNAIL_BASE64_MAX_BYTES?: string;
  /** Maximum width used when auto-resizing response thumbnails. */
  THUMBNAIL_MAX_WIDTH?: string;
  /** Enables privacy-safe structured pipeline logs. Disabled unless true. */
  RELAY_DEBUG?: string;
  /** Sample rate for non-error debug steps when RELAY_DEBUG is enabled. */
  RELAY_DEBUG_SAMPLE_RATE?: string;
  /** Optional JSON map from @username keys to Telegram destinations (<chat_id> or <chat_id>:<message_thread_id>). */
  TELEGRAM_USERNAME_CHANNEL_MAP_JSON?: string;
}

export type ParseMode = "HTML" | "MarkdownV2";
export type MediaType = "video" | "audio" | "document" | "photo";
export type AlbumMediaType = "video" | "photo";
export type RelayForceMode = "resend" | "forward" | null;


export interface RelayMediaVariant {
  mediaUrl: URL;
  quality: string | null;
  width: number | null;
  height: number | null;
  contentLength: number | null;
  bitrate: number | null;
  mediaHeaders: Record<string, string>;
}

export interface RelayInput {
  mediaUrl: URL;
  sourceUrl: string | null;
  pageUrl: string | null;
  provider: string | null;
  title: string;
  text: string;
  caption: string;
  captionExplicit: boolean;
  hashtags: string[];
  parseMode: ParseMode | null;
  mediaType: MediaType | null;
  mediaHeaders: Record<string, string>;
  mediaVariants: RelayMediaVariant[];
  channels: string[];
  usernames: string[];
  metadata: Record<string, string> | null;
  /** True when the caller explicitly supplied a metadata field, including an empty object. */
  metadataProvided: boolean;
  /** Original caller metadata, excluding resolver additions. */
  presentationMetadata?: Record<string, string> | null;
  mediaId: string | null;
  mediaKey: string | null;
  force: boolean;
  /** `resend` re-fetches/re-sends media; `forward` copies the latest stored Telegram message(s). */
  forceMode: RelayForceMode;
  /** Enables CPU-heavy processing for this request only. */
  forceCpu: boolean;
}

export interface RelayAlbumItem {
  mediaUrl: URL;
  mediaType: AlbumMediaType;
  caption: string;
  parseMode: ParseMode | null;
  /** Headers required by this individual CDN URL during Worker fallback. */
  mediaHeaders: Record<string, string>;
  mediaVariants: RelayMediaVariant[];
  metadata: Record<string, string> | null;
}

export interface RelayAlbumInput {
  items: RelayAlbumItem[];
  sourceUrl: string | null;
  pageUrl: string | null;
  provider: string | null;
  title: string;
  text: string;
  caption: string;
  captionExplicit: boolean;
  hashtags: string[];
  parseMode: ParseMode | null;
  channels: string[];
  usernames: string[];
  metadata: Record<string, string> | null;
  /** True when the caller explicitly supplied a metadata field, including an empty object. */
  metadataProvided: boolean;
  /** Original caller metadata, excluding resolver additions. */
  presentationMetadata?: Record<string, string> | null;
  mediaId: string | null;
  mediaKey: string | null;
  force: boolean;
  /** `resend` re-fetches/re-sends media; `forward` copies the latest stored Telegram message(s). */
  forceMode: RelayForceMode;
  /** Enables CPU-heavy processing for this request only. */
  forceCpu: boolean;
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: unknown;
  httpStatus?: number;
  rawResponse?: string;
  requestMethod?: string;
}


export interface TelegramChat {
  id?: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramForumTopicCreated {
  name?: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

export interface TelegramUpdateMessage {
  message_id?: number;
  chat?: TelegramChat;
  message_thread_id?: number;
  forum_topic_created?: TelegramForumTopicCreated;
  date?: number;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramUpdateMessage;
  edited_message?: TelegramUpdateMessage;
  channel_post?: TelegramUpdateMessage;
  edited_channel_post?: TelegramUpdateMessage;
  my_chat_member?: { chat?: TelegramChat };
  chat_member?: { chat?: TelegramChat };
  chat_join_request?: { chat?: TelegramChat };
}

export interface TelegramMessage {
  message_id?: number;
  message_thread_id?: number;
  caption?: string;
  chat?: {
    id?: number | string;
    title?: string;
    username?: string;
  };
}

export interface VideoMetadata {
  /** Display width in pixels after applying container rotation metadata. */
  width: number;
  /** Display height in pixels after applying container rotation metadata. */
  height: number;
  /** Duration in seconds when available from the container. */
  durationSeconds: number | null;
  /** Container rotation metadata normalized to a quarter-turn. */
  rotation: 0 | 90 | 180 | 270;
}

export interface ResolvedDirectFile {
  type: "file";
  url: string;
  contentType: string;
  contentLength: number | null;
  selectedBitrate: number | null;
  selectedResolution: string | null;
  playlistDepth: number;
  videoMetadata: VideoMetadata | null;
  /** Fast path transport. URL lets Telegram fetch; stream proxies bytes without buffering them. */
  deliveryMode?: "telegram-url" | "worker-stream";
  /** Source headers used only when worker-stream must proxy a protected CDN URL. */
  mediaHeaders?: Record<string, string>;
  /** Filename used by the streaming multipart fallback. */
  filename?: string;
  /** Effective configured/Telegram multipart ceiling for streaming validation. */
  streamMaxBytes?: number;
}

export interface PreparedUpload {
  type: "upload";
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  mediaType: MediaType;
  selectedBitrate: number | null;
  selectedResolution: string | null;
  playlistDepth: number;
  videoMetadata: VideoMetadata | null;
  sourceUrl: string;
  hls: boolean;
  segmentCount: number;
  encrypted: boolean;
  remuxed: boolean;
  /** Exact SHA-256 of the Worker-owned media bytes, when available. */
  mediaSha256?: string | null;
  /** Cheap robustness fingerprint used only as a near-duplicate hint. */
  mediaFingerprint?: string | null;
  mediaFingerprintVersion?: number | null;
  /** Exact byte length used to contextualize content identity. */
  mediaByteLength?: number | null;
}

export type PreparedMedia = ResolvedDirectFile | PreparedUpload;
