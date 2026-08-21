import type {
  AlbumMediaType,
  Env,
  MediaType,
  ParseMode,
  TelegramApiResult,
  TelegramMessage,
  TelegramUpdate,
  VideoMetadata,
} from "./types";

const MAX_TELEGRAM_VIDEO_DIMENSION = 65_535;

interface TelegramSendBase {
  botToken: string;
  chatId: string;
  messageThreadId?: number | null;
  caption: string;
  parseMode: ParseMode | null;
  mediaType: MediaType;
  videoMetadata?: VideoMetadata | null;
}

export interface TelegramAlbumUrlItem {
  mediaUrl: string;
  mediaType: AlbumMediaType;
  videoMetadata?: VideoMetadata | null;
  caption?: string;
  parseMode?: ParseMode | null;
}

export interface TelegramAlbumUploadItem {
  mediaType: AlbumMediaType;
  file: Blob;
  filename: string;
  videoMetadata?: VideoMetadata | null;
  caption?: string;
  parseMode?: ParseMode | null;
}

export async function getTelegramUpdates(
  botToken: string,
  limit = 100,
): Promise<TelegramApiResult<TelegramUpdate[]>> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const endpoint = `https://api.telegram.org/bot${botToken}/getUpdates?limit=${safeLimit}&timeout=0`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const rawResponse = await response.text();
    let result: TelegramApiResult<TelegramUpdate[]>;

    try {
      result = rawResponse
        ? (JSON.parse(rawResponse) as TelegramApiResult<TelegramUpdate[]>)
        : ({ ok: response.ok } as TelegramApiResult<TelegramUpdate[]>);
    } catch {
      return {
        ok: false,
        httpStatus: response.status,
        requestMethod: "getUpdates",
        rawResponse,
        description: `Telegram returned a non-JSON response for getUpdates.`,
      };
    }

    if (!response.ok || !result.ok) {
      return {
        ...result,
        ok: false,
        httpStatus: response.status,
        requestMethod: "getUpdates",
        rawResponse,
        description: [
          result.description || "Telegram rejected getUpdates.",
          `HTTP ${response.status}${result.error_code ? ` / Telegram error ${result.error_code}` : ""}.`,
        ].join(" "),
      };
    }

    return {
      ...result,
      httpStatus: response.status,
      requestMethod: "getUpdates",
    };
  } catch (error) {
    return {
      ok: false,
      requestMethod: "getUpdates",
      description: getErrorMessage(error),
    };
  }
}

export async function sendTelegramUrl(
  options: TelegramSendBase & {
    mediaUrl: string;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    [field]: options.mediaUrl,
  };
  if (options.messageThreadId != null) payload.message_thread_id = options.messageThreadId;

  if (options.mediaType === "video") {
    payload.supports_streaming = true;
    appendVideoMetadata(payload, options.videoMetadata);
  }

  if (options.caption) {
    payload.caption = options.caption;
  }

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  return requestTelegram(options.botToken, method, {
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function sendTelegramUpload(
  options: TelegramSendBase & {
    file: Blob;
    filename: string;
    contentType: string;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const form = new FormData();

  form.set("chat_id", options.chatId);
  if (options.messageThreadId != null) form.set("message_thread_id", String(options.messageThreadId));
  form.set(field, options.file, options.filename);

  if (options.mediaType === "video") {
    form.set("supports_streaming", "true");
    appendVideoMetadata(form, options.videoMetadata);
  }

  if (options.caption) {
    form.set("caption", options.caption);
  }

  if (options.parseMode) {
    form.set("parse_mode", options.parseMode);
  }

  return requestTelegram(options.botToken, method, {
    body: form,
  });
}

export async function sendTelegramMediaGroupUrl(options: {
  botToken: string;
  chatId: string;
  messageThreadId?: number | null;
  items: TelegramAlbumUrlItem[];
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramApiResult<TelegramMessage[]>> {
  if (options.items.length < 2 || options.items.length > 10) {
    return {
      ok: false,
      description: `sendMediaGroup requires 2-10 items; received ${options.items.length}.`,
      requestMethod: "sendMediaGroup",
    };
  }

  const media = options.items.map((item, index) => {
    const entry: Record<string, unknown> = {
      type: item.mediaType,
      media: item.mediaUrl,
    };

    if (item.mediaType === "video") {
      entry.supports_streaming = true;
      appendVideoMetadata(entry, item.videoMetadata);
    }

    const caption = item.caption || (index === 0 ? options.caption : "");
    const parseMode = item.caption
      ? item.parseMode ?? options.parseMode
      : index === 0
        ? options.parseMode
        : null;

    if (caption) {
      entry.caption = caption;
      if (parseMode) {
        entry.parse_mode = parseMode;
      }
    }

    return entry;
  });

  return requestTelegram<TelegramMessage[]>(options.botToken, "sendMediaGroup", {
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: options.chatId,
      ...(options.messageThreadId != null ? { message_thread_id: options.messageThreadId } : {}),
      media,
    }),
  });
}

/**
 * Sends a mixed photo/video album as Telegram attach:// parts. This is the
 * Worker-side fallback for CDNs that require Referer/User-Agent headers which
 * Telegram's remote URL fetch cannot provide.
 */
export async function sendTelegramMediaGroupUpload(options: {
  botToken: string;
  chatId: string;
  messageThreadId?: number | null;
  items: TelegramAlbumUploadItem[];
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramApiResult<TelegramMessage[]>> {
  if (options.items.length < 2 || options.items.length > 10) {
    return {
      ok: false,
      description: `sendMediaGroup requires 2-10 items; received ${options.items.length}.`,
      requestMethod: "sendMediaGroup",
    };
  }

  const form = new FormData();
  const media = options.items.map((item, index) => {
    const field = `media${index}`;
    form.set(field, item.file, item.filename);

    const entry: Record<string, unknown> = {
      type: item.mediaType,
      media: `attach://${field}`,
    };

    if (item.mediaType === "video") {
      entry.supports_streaming = true;
      appendVideoMetadata(entry, item.videoMetadata);
    }

    const caption = item.caption || (index === 0 ? options.caption : "");
    const parseMode = item.caption
      ? item.parseMode ?? options.parseMode
      : index === 0
        ? options.parseMode
        : null;

    if (caption) {
      entry.caption = caption;
      if (parseMode) {
        entry.parse_mode = parseMode;
      }
    }

    return entry;
  });

  form.set("chat_id", options.chatId);
  if (options.messageThreadId != null) form.set("message_thread_id", String(options.messageThreadId));
  form.set("media", JSON.stringify(media));
  return requestTelegram<TelegramMessage[]>(options.botToken, "sendMediaGroup", {
    body: form,
  });
}

export async function editTelegramMessageCaption(options: {
  botToken: string;
  chatId: string | number;
  messageId: number;
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramApiResult<TelegramMessage | true>> {
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    message_id: options.messageId,
    caption: options.caption,
  };
  if (options.parseMode) payload.parse_mode = options.parseMode;

  return requestTelegram<TelegramMessage | true>(options.botToken, "editMessageCaption", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function validateEnvironment(env: Env): string | null {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "Missing TELEGRAM_BOT_TOKEN secret";
  }

  if (!env.RELAY_TOKEN) {
    return "Missing RELAY_TOKEN secret";
  }

  return null;
}

/**
 * Adds only validated video metadata to a Telegram payload. Telegram will use
 * these values for the media preview and player geometry instead of guessing
 * dimensions that can squash a portrait or rotated source.
 *
 * @example
 * const payload: Record<string, unknown> = {};
 * appendVideoMetadata(payload, {
 *   width: 1080,
 *   height: 1920,
 *   durationSeconds: 12,
 *   rotation: 0,
 * });
 */
function appendVideoMetadata(
  target: Record<string, unknown> | FormData,
  metadata: VideoMetadata | null | undefined,
): void {
  if (!metadata) return;
  if (!isValidVideoDimension(metadata.width) || !isValidVideoDimension(metadata.height)) {
    return;
  }

  const values = {
    width: String(Math.round(metadata.width)),
    height: String(Math.round(metadata.height)),
    duration:
      metadata.durationSeconds != null && Number.isFinite(metadata.durationSeconds)
        ? String(Math.max(0, Math.round(metadata.durationSeconds)))
        : null,
  };

  if (target instanceof FormData) {
    target.set("width", values.width);
    target.set("height", values.height);
    if (values.duration) target.set("duration", values.duration);
    return;
  }

  target.width = Number(values.width);
  target.height = Number(values.height);
  if (values.duration) target.duration = Number(values.duration);
}

function isValidVideoDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TELEGRAM_VIDEO_DIMENSION;
}

function getTelegramMethod(mediaType: MediaType): {
  method: "sendVideo" | "sendAudio" | "sendDocument" | "sendPhoto";
  field: "video" | "audio" | "document" | "photo";
} {
  switch (mediaType) {
    case "photo":
      return {
        method: "sendPhoto",
        field: "photo",
      };
    case "audio":
      return {
        method: "sendAudio",
        field: "audio",
      };
    case "document":
      return {
        method: "sendDocument",
        field: "document",
      };
    case "video":
    default:
      return {
        method: "sendVideo",
        field: "video",
      };
  }
}

async function requestTelegram<T>(
  botToken: string,
  method: string,
  init: RequestInit,
): Promise<TelegramApiResult<T>> {
  const endpoint = `https://api.telegram.org/bot${botToken}/${method}`;
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      ...init,
    });
  } catch (error) {
    return {
      ok: false,
      description: getErrorMessage(error),
      requestMethod: method,
    };
  }

  const rawResponse = await response.text();
  let result: TelegramApiResult<T>;

  try {
    result = rawResponse
      ? (JSON.parse(rawResponse) as TelegramApiResult<T>)
      : ({ ok: response.ok } as TelegramApiResult<T>);
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        `Telegram returned a non-JSON response for ${method}.`,
        `HTTP status: ${response.status} ${response.statusText}`.trim(),
        rawResponse ? `Response body: ${rawResponse.slice(0, 4000)}` : "Response body was empty.",
      ].join(" "),
    };
  }

  if (!response.ok || !result.ok) {
    return {
      ...result,
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        result.description || `Telegram rejected ${method}.`,
        `HTTP ${response.status}${result.error_code ? ` / Telegram error ${result.error_code}` : ""}.`,
      ].join(" "),
    };
  }

  return {
    ...result,
    httpStatus: response.status,
    requestMethod: method,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
