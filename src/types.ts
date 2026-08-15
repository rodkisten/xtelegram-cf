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
  MULTIPART_MAX_TOTAL_BYTES?: string;
  TWIRRL_VERSION_TOKEN?: string;
  DELIVERY_CLAIM_TTL_SECONDS?: string;
  SOCIAL_METADATA_TIMEOUT_MS?: string;
  /** Enables privacy-safe structured pipeline logs. Disabled unless true. */
  RELAY_DEBUG?: string;
  /** Optional JSON map from @username keys to Telegram chat IDs. */
  TELEGRAM_USERNAME_CHANNEL_MAP_JSON?: string;
}

export type ParseMode = "HTML" | "MarkdownV2";
export type MediaType = "video" | "audio" | "document" | "photo";
export type AlbumMediaType = "video" | "photo";

export interface RelayInput {
  mediaUrl: URL;
  sourceUrl: string | null;
  pageUrl: string | null;
  provider: string | null;
  title: string;
  text: string;
  caption: string;
  parseMode: ParseMode | null;
  mediaType: MediaType | null;
  mediaHeaders: Record<string, string>;
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

export interface TelegramMessage {
  message_id?: number;
  caption?: string;
  chat?: {
    id?: number | string;
    title?: string;
  };
}

export interface ResolvedDirectFile {
  type: "file";
  url: string;
  contentType: string;
  contentLength: number | null;
  selectedBitrate: number | null;
  selectedResolution: string | null;
  playlistDepth: number;
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
  sourceUrl: string;
  hls: boolean;
  segmentCount: number;
  encrypted: boolean;
  remuxed: boolean;
}

export type PreparedMedia = ResolvedDirectFile | PreparedUpload;
