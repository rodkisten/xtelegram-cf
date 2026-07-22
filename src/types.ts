export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID?: string;
  RELAY_TOKEN: string;
  MAX_MEDIA_BYTES?: string;
  HLS_CONCURRENCY?: string;
}

export type ParseMode = "HTML" | "MarkdownV2";
export type MediaType = "video" | "audio" | "document";

export interface RelayInput {
  mediaUrl: URL;
  sourceUrl: string | null;
  caption: string;
  parseMode: ParseMode | null;
  mediaType: MediaType | null;
  mediaHeaders: Record<string, string>;
  channels: string[];
  metadata: Record<string, string> | null;
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: unknown;
  httpStatus?: number;
}

export interface TelegramMessage {
  message_id?: number;
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
