import { sendTelegramStreamUpload, sendTelegramUpload, sendTelegramUrl } from "../telegram";
import type {
  MediaType,
  ParseMode,
  PreparedMedia,
  TelegramApiResult,
  TelegramMessage,
} from "../types";
import { getErrorMessage } from "../lib/errors";
import { parseTelegramDestination } from "./channels";
import { mapWithConcurrency } from "../lib/concurrency";

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
  const sendOne = async (destinationKey: string): Promise<TelegramDelivery> => {
    const destination = parseTelegramDestination(destinationKey);

    if (!destination) {
      return {
        requestedChatId: destinationKey,
        result: { ok: false, description: `Invalid Telegram destination: ${destinationKey}` },
      };
    }

    try {
      let result: TelegramApiResult<TelegramMessage>;

      if (options.prepared.type === "file") {
        const prepared = options.prepared;

        if (prepared.deliveryMode === "worker-stream") {
          result = await sendPreparedFileAsStream(
            options.botToken,
            destination.chatId,
            destination.messageThreadId,
            prepared,
            options.mediaType,
            options.caption,
            options.parseMode,
          );
        } else {
          result = await sendTelegramUrl({
            botToken: options.botToken,
            chatId: destination.chatId,
            messageThreadId: destination.messageThreadId,
            mediaUrl: prepared.url,
            mediaType: options.mediaType,
            caption: options.caption,
            parseMode: options.parseMode,
            videoMetadata: prepared.videoMetadata,
          });

          // Telegram cannot forward request-specific Referer/User-Agent headers
          // when it fetches a URL itself. A definitive Bot API 400 means no
          // message was created, so it is safe to retry the same logical media
          // once through the constant-memory Worker streaming proxy.
          if (shouldRetryTelegramUrlAsStream(result, prepared)) {
            result = await sendPreparedFileAsStream(
              options.botToken,
              destination.chatId,
              destination.messageThreadId,
              prepared,
              options.mediaType,
              options.caption,
              options.parseMode,
            );
          }
        }
      } else {
        result = await sendTelegramUpload({
          botToken: options.botToken,
          chatId: destination.chatId,
          messageThreadId: destination.messageThreadId,
          file: new Blob([toBlobArrayBuffer(options.prepared.bytes)], {
            type: options.prepared.contentType,
          }),
          filename: options.prepared.filename,
          contentType: options.prepared.contentType,
          mediaType: options.mediaType,
          caption: options.caption,
          parseMode: options.parseMode,
          videoMetadata: options.prepared.videoMetadata,
        });
      }

      return { requestedChatId: destination.key, result };
    } catch (error) {
      return {
        requestedChatId: destination.key,
        result: {
          ok: false,
          description: `Unexpected exception while sending media: ${getErrorMessage(error)}`,
        },
      };
    }
  };

  // Pure Telegram-URL delivery is network-bound and uses negligible media
  // memory. Streaming proxy or Worker-owned uploads use one destination at a
  // time to keep subrequests and backpressure predictable.
  const concurrency =
    options.prepared.type === "file" &&
    (options.prepared.deliveryMode || "telegram-url") === "telegram-url"
      ? 2
      : 1;

  return mapWithConcurrency(options.chatIds, concurrency, sendOne);
}

async function sendPreparedFileAsStream(
  botToken: string,
  chatId: string,
  messageThreadId: number | null,
  prepared: Extract<PreparedMedia, { type: "file" }>,
  mediaType: MediaType,
  caption: string,
  parseMode: ParseMode | null,
): Promise<TelegramApiResult<TelegramMessage>> {
  return sendTelegramStreamUpload({
    botToken,
    chatId,
    messageThreadId,
    mediaUrl: prepared.url,
    mediaHeaders: prepared.mediaHeaders || {},
    filename: prepared.filename || "media",
    contentType: prepared.contentType,
    maximumBytes: prepared.streamMaxBytes || Number.MAX_SAFE_INTEGER,
    expectedContentLength: prepared.contentLength,
    mediaType,
    caption,
    parseMode,
    videoMetadata: prepared.videoMetadata,
  });
}

function shouldRetryTelegramUrlAsStream(
  result: TelegramApiResult<TelegramMessage>,
  prepared: Extract<PreparedMedia, { type: "file" }>,
): boolean {
  if (result.ok) return false;

  // Only a definitive Telegram 400 is retried. Network failures, 5xx responses,
  // and ambiguous outcomes are never replayed because Telegram might already
  // have accepted the message before the connection failed.
  const definitiveBadRequest =
    result.httpStatus === 400 || result.error_code === 400;
  if (!definitiveBadRequest) return false;

  if (!prepared.streamMaxBytes) return false;
  if (
    prepared.contentLength != null &&
    prepared.contentLength > prepared.streamMaxBytes
  ) {
    return false;
  }

  return true;
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
        delivery: prepared.deliveryMode || "telegram-url",
        contentLength: prepared.contentLength,
        contentType: prepared.contentType,
      }
    : {
        delivery: "multipart-upload",
        filename: prepared.filename,
        contentType: prepared.contentType,
        size: prepared.bytes.byteLength,
        videoWidth: prepared.videoMetadata?.width ?? null,
        videoHeight: prepared.videoMetadata?.height ?? null,
        videoRotation: prepared.videoMetadata?.rotation ?? null,
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
