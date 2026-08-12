import { sendTelegramUpload, sendTelegramUrl } from "../telegram";
import type {
  MediaType,
  ParseMode,
  PreparedMedia,
  TelegramApiResult,
  TelegramMessage,
} from "../types";
import { getErrorMessage } from "../lib/errors";

export interface TelegramDelivery {
  requestedChatId: string;
  result: TelegramApiResult<TelegramMessage>;
}

export async function sendPreparedMediaToChats(options: {
  botToken: string;
  chatIds: string[];
  prepared: PreparedMedia;
  mediaType: MediaType;
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramDelivery[]> {
  const deliveries: TelegramDelivery[] = [];

  // Sequential by design: a large upload Blob must not be multiplied in memory
  // for several concurrent Bot API requests inside the same Worker isolate.
  for (const chatId of options.chatIds) {
    let result: TelegramApiResult<TelegramMessage>;
    try {
      result =
        options.prepared.type === "file"
          ? await sendTelegramUrl({
              botToken: options.botToken,
              chatId,
              mediaUrl: options.prepared.url,
              mediaType: options.mediaType,
              caption: options.caption,
              parseMode: options.parseMode,
            })
          : await sendTelegramUpload({
              botToken: options.botToken,
              chatId,
              file: new Blob([toBlobArrayBuffer(options.prepared.bytes)], {
                type: options.prepared.contentType,
              }),
              filename: options.prepared.filename,
              contentType: options.prepared.contentType,
              mediaType: options.mediaType,
              caption: options.caption,
              parseMode: options.parseMode,
            });
    } catch (error) {
      result = {
        ok: false,
        description: `Unexpected exception while sending media: ${getErrorMessage(error)}`,
      };
    }

    deliveries.push({ requestedChatId: chatId, result });
  }

  return deliveries;
}

/**
 * BlobPart accepts ArrayBuffer. Newer DOM typings reject a Uint8Array whose
 * backing store could theoretically be SharedArrayBuffer. Keep a full
 * ArrayBuffer view zero-copy; otherwise materialize only the exact byte range.
 */
export function toBlobArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }

  const copy = new Uint8Array(byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function formatTelegramDelivery(delivery: TelegramDelivery) {
  const message = delivery.result.result;
  return {
    requestedChatId: delivery.requestedChatId,
    ok: delivery.result.ok,
    messageId: message?.message_id ?? null,
    chatId: message?.chat?.id ?? null,
    chatTitle: message?.chat?.title ?? null,
    error: delivery.result.ok
      ? null
      : delivery.result.description || "Telegram rejected the media request",
    httpStatus: delivery.result.httpStatus ?? null,
  };
}

export function buildProcessingResult(prepared: PreparedMedia) {
  return prepared.type === "file"
    ? {
        delivery: "telegram-url",
        contentLength: prepared.contentLength,
        contentType: prepared.contentType,
      }
    : {
        delivery: "multipart-upload",
        filename: prepared.filename,
        contentType: prepared.contentType,
        size: prepared.bytes.byteLength,
        hls: prepared.hls,
        segmentCount: prepared.segmentCount,
        encrypted: prepared.encrypted,
        remuxed: prepared.remuxed,
      };
}

export function getTelegramMethodName(mediaType: MediaType) {
  return mediaType === "photo"
    ? "sendPhoto"
    : mediaType === "audio"
      ? "sendAudio"
      : mediaType === "document"
        ? "sendDocument"
        : "sendVideo";
}
