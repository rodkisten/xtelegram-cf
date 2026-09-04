export interface Env {
  RELAY_DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID?: string;
  /** @deprecated Use TELEGRAM_CHAT_ID. Kept for backwards compatibility. */
  TELEGRAM_CHANNEL_ID?: string;
  RELAY_TOKEN: string;
  MAX_MEDIA_BYTES?: string;
  HLS_CONCURRENCY?: string;
  HLS_MAX_MEDIA_BYTES?: string;
  /** Max bytes the Worker may buffer for one direct media upload before client fallback. */
  WORKER_BUFFERED_MEDIA_BYTES?: string;
  /** Max combined bytes the Worker may hold while assembling HLS/fMP4 media. */
  WORKER_HLS_BUFFERED_MEDIA_BYTES?: string;
  /** Opt-in only: allow CPU-heavy MPEG-TS -> MP4 transmuxing inside the Worker. */
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
  DELIVERY_CLAIM_TTL_SECONDS?: string;
  SOCIAL_METADATA_TIMEOUT_MS?: string;
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
  parseMode: ParseMode | null;
  mediaType: MediaType | null;
  mediaHeaders: Record<string, string>;
  mediaVariants: RelayMediaVariant[];
  channels: string[];
  usernames: string[];
  metadata: Record<string, string> | null;
  mediaId: string | null;
  mediaKey: string | null;
  force: boolean;
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
  parseMode: ParseMode | null;
  channels: string[];
  usernames: string[];
  metadata: Record<string, string> | null;
  mediaId: string | null;
  mediaKey: string | null;
  force: boolean;
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
  caption?: string;
  chat?: {
    id?: number | string;
    title?: string;
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
