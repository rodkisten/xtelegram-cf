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
import { RELAY_LIMITS } from "./config/constants";
import { fetchPublic, getBaseContentType } from "./lib/http";


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
  const metadataError = validateRequiredVideoMetadata(
    options.mediaType,
    options.videoMetadata,
  );
  if (metadataError) {
    return {
      ok: false,
      httpStatus: 422,
      requestMethod: method,
      description: metadataError,
    };
  }

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
  const metadataError = validateRequiredVideoMetadata(
    options.mediaType,
    options.videoMetadata,
  );
  if (metadataError) {
    return {
      ok: false,
      httpStatus: 422,
      requestMethod: method,
      description: metadataError,
    };
  }

  const sizeError = validateTelegramMultipartFileSize(options.mediaType, options.file.size);
  if (sizeError) {
    return {
      ok: false,
      httpStatus: 413,
      requestMethod: method,
      description: sizeError,
    };
  }

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

/**
 * Proxies a remote media body into Telegram multipart/form-data without ever
 * materializing the complete file in the Worker isolate. This is the default
 * transport for files above Telegram's 20 MB remote-URL ceiling but below the
 * normal multipart ceiling.
 */
export async function sendTelegramStreamUpload(
  options: TelegramSendBase & {
    mediaUrl: string;
    mediaHeaders: Record<string, string>;
    filename: string;
    contentType: string;
    maximumBytes: number;
    expectedContentLength?: number | null;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const metadataError = validateRequiredVideoMetadata(
    options.mediaType,
    options.videoMetadata,
  );
  if (metadataError) {
    return {
      ok: false,
      httpStatus: 422,
      requestMethod: method,
      description: metadataError,
    };
  }

  const telegramMaximum = options.mediaType === "photo"
    ? RELAY_LIMITS.telegramUploadPhotoBytes
    : RELAY_LIMITS.telegramUploadOtherBytes;
  const maximumBytes = Math.min(
    telegramMaximum,
    Math.max(1, Math.floor(options.maximumBytes || telegramMaximum)),
  );

  if (
    options.expectedContentLength != null &&
    options.expectedContentLength > maximumBytes
  ) {
    return {
      ok: false,
      httpStatus: 413,
      requestMethod: method,
      description:
        `Streaming upload exceeds the effective limit: ` +
        `${options.expectedContentLength} bytes > ${maximumBytes} bytes.`,
    };
  }

  const sourceHeaders = new Headers(options.mediaHeaders);
  sourceHeaders.delete("content-length");
  sourceHeaders.delete("range");
  if (!sourceHeaders.has("accept")) sourceHeaders.set("accept", "*/*");
  if (!sourceHeaders.has("accept-encoding")) sourceHeaders.set("accept-encoding", "identity");

  let source: Response;
  try {
    source = await fetchPublic(options.mediaUrl, {
      method: "GET",
      headers: sourceHeaders,
    });
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      requestMethod: method,
      description: `Unable to open media source for streaming: ${getErrorMessage(error)}`,
    };
  }

  if (!source.ok || !source.body) {
    try { await source.body?.cancel(); } catch {}
    return {
      ok: false,
      httpStatus: 502,
      requestMethod: method,
      description:
        `Media source rejected streaming download with HTTP ${source.status}.`,
    };
  }

  const sourceLengthHeader = Number(source.headers.get("content-length") || 0);
  const sourceLength = Number.isFinite(sourceLengthHeader) && sourceLengthHeader > 0
    ? sourceLengthHeader
    : options.expectedContentLength ?? null;

  if (sourceLength != null && sourceLength > maximumBytes) {
    try { await source.body.cancel(); } catch {}
    return {
      ok: false,
      httpStatus: 413,
      requestMethod: method,
      description:
        `Streaming source is ${sourceLength} bytes, above the effective ` +
        `Telegram/configured limit of ${maximumBytes} bytes.`,
    };
  }

  const boundary = `----xtelegram-${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();
  const safeContentType =
    getBaseContentType(source.headers.get("content-type")) ||
    getBaseContentType(options.contentType) ||
    "application/octet-stream";
  const prefix = encoder.encode(
    buildStreamingMultipartPrefix({
      boundary,
      field,
      chatId: options.chatId,
      messageThreadId: options.messageThreadId,
      filename: options.filename,
      contentType: safeContentType,
      mediaType: options.mediaType,
      caption: options.caption,
      parseMode: options.parseMode,
      videoMetadata: options.videoMetadata,
    }),
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const state: { bytesRead: number; failure: string | null } = {
    bytesRead: 0,
    failure: null,
  };
  const composed = createMultipartProxyStream(
    source.body,
    prefix,
    suffix,
    maximumBytes,
    state,
  );

  let requestBody: ReadableStream<Uint8Array> = composed;
  let pipePromise: Promise<void> | null = null;

  // FixedLengthStream lets workerd emit Content-Length while preserving
  // streaming semantics. Fall back to a normal streaming request when the
  // origin does not expose a reliable size.
  if (sourceLength != null) {
    const fixed = new FixedLengthStream(
      prefix.byteLength + sourceLength + suffix.byteLength,
    );
    requestBody = fixed.readable;
    pipePromise = composed.pipeTo(fixed.writable);
  }

  const telegramPromise = requestTelegram<TelegramMessage>(
    options.botToken,
    method,
    {
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: requestBody,
    },
  );

  if (!pipePromise) {
    const result = await telegramPromise;
    if (state.failure) {
      return {
        ok: false,
        httpStatus: 413,
        requestMethod: method,
        description: state.failure,
      };
    }
    return result;
  }

  const [telegramResult, pipeResult] = await Promise.allSettled([
    telegramPromise,
    pipePromise,
  ]);

  if (pipeResult.status === "rejected") {
    return {
      ok: false,
      httpStatus: state.failure ? 413 : 502,
      requestMethod: method,
      description:
        state.failure ||
        `Streaming multipart pipeline failed: ${getErrorMessage(pipeResult.reason)}`,
    };
  }

  if (telegramResult.status === "rejected") {
    return {
      ok: false,
      httpStatus: 502,
      requestMethod: method,
      description: `Telegram streaming request failed: ${getErrorMessage(telegramResult.reason)}`,
    };
  }

  return telegramResult.value;
}

function createMultipartProxyStream(
  source: ReadableStream<Uint8Array>,
  prefix: Uint8Array,
  suffix: Uint8Array,
  maximumBytes: number,
  state: { bytesRead: number; failure: string | null },
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let phase: "prefix" | "source" | "suffix" | "done" = "prefix";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (phase === "prefix") {
          phase = "source";
          controller.enqueue(prefix);
          return;
        }

        if (phase === "source") {
          const { done, value } = await reader.read();
          if (!done) {
            if (!value?.byteLength) return;
            state.bytesRead += value.byteLength;
            if (state.bytesRead > maximumBytes) {
              state.failure =
                `Streaming source exceeded the effective limit while reading: ` +
                `${state.bytesRead} bytes > ${maximumBytes} bytes.`;
              try { await reader.cancel(state.failure); } catch {}
              controller.error(new Error(state.failure));
              return;
            }
            controller.enqueue(value);
            return;
          }
          phase = "suffix";
        }

        if (phase === "suffix") {
          phase = "done";
          controller.enqueue(suffix);
          return;
        }

        controller.close();
      } catch (error) {
        try { await reader.cancel(error); } catch {}
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch {}
    },
  });
}

function buildStreamingMultipartPrefix(options: {
  boundary: string;
  field: "video" | "audio" | "document" | "photo";
  chatId: string;
  messageThreadId?: number | null;
  filename: string;
  contentType: string;
  mediaType: MediaType;
  caption: string;
  parseMode: ParseMode | null;
  videoMetadata?: VideoMetadata | null;
}): string {
  const fields: Array<[string, string]> = [["chat_id", options.chatId]];

  if (options.messageThreadId != null) {
    fields.push(["message_thread_id", String(options.messageThreadId)]);
  }
  if (options.mediaType === "video") {
    fields.push(["supports_streaming", "true"]);
    if (options.videoMetadata) {
      fields.push(["width", String(Math.round(options.videoMetadata.width))]);
      fields.push(["height", String(Math.round(options.videoMetadata.height))]);
      if (
        options.videoMetadata.durationSeconds != null &&
        Number.isFinite(options.videoMetadata.durationSeconds)
      ) {
        fields.push([
          "duration",
          String(Math.max(0, Math.round(options.videoMetadata.durationSeconds))),
        ]);
      }
    }
  }
  if (options.caption) fields.push(["caption", options.caption]);
  if (options.parseMode) fields.push(["parse_mode", options.parseMode]);

  let output = "";
  for (const [name, value] of fields) {
    output +=
      `--${options.boundary}\r\n` +
      `Content-Disposition: form-data; name="${escapeMultipartToken(name)}"\r\n\r\n` +
      `${value}\r\n`;
  }

  output +=
    `--${options.boundary}\r\n` +
    `Content-Disposition: form-data; name="${escapeMultipartToken(options.field)}"; ` +
    `filename="${escapeMultipartToken(options.filename)}"\r\n` +
    `Content-Type: ${options.contentType}\r\n\r\n`;

  return output;
}

function escapeMultipartToken(value: string): string {
  return String(value)
    .replace(/[\r\n]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
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

  const invalidVideoIndex = options.items.findIndex(
    (item) =>
      item.mediaType === "video" &&
      Boolean(validateRequiredVideoMetadata("video", item.videoMetadata)),
  );

  if (invalidVideoIndex >= 0) {
    return {
      ok: false,
      httpStatus: 422,
      requestMethod: "sendMediaGroup",
      description:
        `Video item ${invalidVideoIndex + 1} is missing valid width/height metadata. ` +
        "Refusing Telegram URL delivery to prevent aspect-ratio distortion.",
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

  const invalidVideoIndex = options.items.findIndex(
    (item) =>
      item.mediaType === "video" &&
      Boolean(validateRequiredVideoMetadata("video", item.videoMetadata)),
  );

  if (invalidVideoIndex >= 0) {
    return {
      ok: false,
      httpStatus: 422,
      requestMethod: "sendMediaGroup",
      description:
        `Video item ${invalidVideoIndex + 1} is missing valid width/height metadata. ` +
        "Refusing Telegram multipart delivery to prevent aspect-ratio distortion.",
    };
  }

  const oversizedIndex = options.items.findIndex((item) =>
    Boolean(validateTelegramMultipartFileSize(item.mediaType, item.file.size)),
  );
  if (oversizedIndex >= 0) {
    const item = options.items[oversizedIndex]!;
    return {
      ok: false,
      httpStatus: 413,
      requestMethod: "sendMediaGroup",
      description:
        `Album item ${oversizedIndex + 1} exceeds the hosted Telegram Bot API multipart limit: ` +
        `${item.file.size} bytes for ${item.mediaType}.`,
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

export async function copyTelegramMessage(options: {
  botToken: string;
  chatId: string | number;
  messageThreadId?: number | null;
  fromChatId: string | number;
  messageId: number;
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramApiResult<{ message_id?: number }>> {
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    from_chat_id: options.fromChatId,
    message_id: options.messageId,
    // Explicitly send the current caption, including an empty string, so the
    // copied message never inherits stale presentation from the original.
    caption: options.caption,
  };
  if (options.messageThreadId != null) payload.message_thread_id = options.messageThreadId;
  if (options.caption && options.parseMode) payload.parse_mode = options.parseMode;

  return requestTelegram<{ message_id?: number }>(options.botToken, "copyMessage", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function copyTelegramMessages(options: {
  botToken: string;
  chatId: string | number;
  messageThreadId?: number | null;
  fromChatId: string | number;
  messageIds: number[];
  removeCaption?: boolean;
}): Promise<TelegramApiResult<Array<{ message_id?: number }>>> {
  const messageIds = [...new Set(options.messageIds)]
    .filter((messageId) => Number.isSafeInteger(messageId) && messageId > 0)
    .sort((left, right) => left - right);
  if (!messageIds.length) {
    return {
      ok: false,
      httpStatus: 400,
      requestMethod: "copyMessages",
      description: "copyMessages requires at least one positive Telegram message id.",
    };
  }

  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    from_chat_id: options.fromChatId,
    message_ids: messageIds,
    remove_caption: options.removeCaption === true,
  };
  if (options.messageThreadId != null) payload.message_thread_id = options.messageThreadId;

  return requestTelegram<Array<{ message_id?: number }>>(options.botToken, "copyMessages", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

function validateTelegramMultipartFileSize(
  mediaType: MediaType,
  fileSize: number,
): string | null {
  const maximum = mediaType === "photo"
    ? RELAY_LIMITS.telegramUploadPhotoBytes
    : RELAY_LIMITS.telegramUploadOtherBytes;
  if (!Number.isFinite(fileSize) || fileSize < 0) return "Invalid upload file size.";
  return fileSize <= maximum
    ? null
    : `Hosted Telegram Bot API multipart limit exceeded: ${fileSize} bytes > ${maximum} bytes for ${mediaType}.`;
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
function validateRequiredVideoMetadata(
  mediaType: MediaType,
  metadata: VideoMetadata | null | undefined,
): string | null {
  if (mediaType !== "video") return null;

  if (!metadata) {
    return (
      "Video width/height metadata is required before calling Telegram. " +
      "The relay refuses to send a video whose display geometry is unknown."
    );
  }

  if (!isValidVideoDimension(metadata.width) || !isValidVideoDimension(metadata.height)) {
    return (
      `Invalid video display dimensions ${metadata.width}x${metadata.height}. ` +
      "The relay refuses to send potentially distorted video."
    );
  }

  return null;
}

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
  return Number.isFinite(value) && value > 0 && value <= RELAY_LIMITS.telegramVideoDimensionMax;
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


/**
 * Text-only notification delivery. Reuses the same Telegram Bot API
 * transport and error reporting as media delivery.
 */
export async function sendTelegramText(options: {
  botToken: string;
  chatId: string;
  messageThreadId?: number | null;
  text: string;
  parseMode?: ParseMode | null;
  disableNotification?: boolean;
  buttons?: { text: string; url: string }[][];
}): Promise<TelegramApiResult<TelegramMessage>> {
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    text: options.text,
    link_preview_options: { is_disabled: true },
  };
  if (options.messageThreadId != null) {
    payload.message_thread_id = options.messageThreadId;
  }
  if (options.parseMode) payload.parse_mode = options.parseMode;
  if (options.disableNotification) payload.disable_notification = true;
  if (options.buttons?.length) {
    payload.reply_markup = {
      inline_keyboard: options.buttons.map((row) =>
        row.map((button) => ({ text: button.text, url: button.url }))
      ),
    };
  }
  return requestTelegram<TelegramMessage>(options.botToken, "sendMessage", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Edit the same Telegram notification rather than publishing a new bubble. */
export async function editTelegramText(options: {
  botToken: string;
  chatId: string;
  messageId: number;
  text: string;
  parseMode?: ParseMode | null;
  buttons?: { text: string; url: string }[][];
}): Promise<TelegramApiResult<TelegramMessage | true>> {
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    message_id: options.messageId,
    text: options.text,
    link_preview_options: { is_disabled: true },
    // Explicitly clear obsolete Sentry buttons when a run recovers.
    reply_markup: {
      inline_keyboard: options.buttons?.map((row) =>
        row.map((button) => ({ text: button.text, url: button.url }))
      ) ?? [],
    },
  };
  if (options.parseMode) payload.parse_mode = options.parseMode;
  return requestTelegram<TelegramMessage | true>(options.botToken, "editMessageText", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
