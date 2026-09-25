import { storedCaptionHasAccessNotice } from "../../lib/social-caption";
import { persistKnownMedia, persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import {
  buildLimitExceededPayload,
  isRelayLimitExceededError,
  RelayLimitExceededError,
  resolveClientCompressionTargetBytes,
} from "../../lib/limit-error";
import { mapWithConcurrency } from "../../lib/concurrency";
import {
  debugChannelSummary,
  debugError,
  relayDebug,
} from "../../lib/debug";
import {
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
  resolveWorkerBufferedMediaBytes,
  resolveWorkerHlsBufferedMediaBytes,
  resolveTelegramRemoteUrlLimitBytes,
  shouldPreferWorkerUploadForTelegram,
} from "../../media";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  getAlreadySentDeliveryDetails,
  getAlreadySentTelegramMessageLinkFields,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
  type DeliveryPlan,
} from "../../services/delivery-plan";
import {
  parseTelegramDestination,
  resolveTelegramChatIdsForEnv,
} from "../../services/channels";
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
import { reconcileExistingMediaPresentation } from "../../services/presentation-reconciliation";
import { toBlobArrayBuffer } from "../../services/telegram-delivery";
import {
  sendTelegramMediaGroupUpload,
  sendTelegramMediaGroupUrl,
  sendTelegramUpload,
  sendTelegramUrl,
} from "../../telegram";
import type {
  Env,
  PreparedUpload,
  RelayAlbumInput,
  RelayInput,
  TelegramApiResult,
  TelegramMessage,
} from "../../types";
import { isGenericMediaLabel } from "../../validation/common";
import { resolveMultipartMaxTotalBytes } from "./multipart-utils";
import { buildTelegramMessageLinkFields } from "../../lib/telegram-message-links";
import { copyStoredTelegramDeliveries } from "../../services/telegram-forward";

type AlbumTransport =
  | "url"
  | "multipart-upload"
  | "ordered-single-url"
  | "ordered-single-upload";

interface TelegramAlbumBatchDelivery {
  requestedChatId: string;
  batchIndex: number;
  itemOffset: number;
  itemCount: number;
  result: TelegramApiResult<TelegramMessage[]>;
  transport: AlbumTransport;
  fallbackAttempted: boolean;
  orderedFallbackAttempted: boolean;
  fallbackError: string | null;
  /** A partial ordered fallback already has external side effects. */
  hadExternalSideEffect: boolean;
  attemptCount: number;
  clientFallback?: ReturnType<typeof buildLimitExceededPayload> | null;
}

interface TelegramAlbumBatchAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  transport: AlbumTransport;
  fallbackAttempted: boolean;
  orderedFallbackAttempted: boolean;
  fallbackError: string | null;
  hadExternalSideEffect: boolean;
  attemptCount: number;
  clientFallback?: ReturnType<typeof buildLimitExceededPayload> | null;
}

interface PreparedAlbumUpload {
  mediaType: RelayAlbumInput["items"][number]["mediaType"];
  file: Blob;
  filename: string;
  contentType: string;
  videoMetadata: PreparedUpload["videoMetadata"];
}

function albumItemToRelayInput(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
): RelayInput {
  return {
    mediaUrl: item.mediaUrl,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    provider: input.provider,
    title: input.title,
    text: input.text,
    caption: item.caption || input.caption,
    captionExplicit: Boolean(item.caption && !isGenericMediaLabel(item.caption)) || input.captionExplicit,
    hashtags: input.hashtags,
    parseMode: item.parseMode ?? input.parseMode,
    mediaType: item.mediaType,
    mediaHeaders: item.mediaHeaders,
    mediaVariants: item.mediaVariants,
    channels: [],
    usernames: input.usernames,
    metadata: item.metadata ?? input.metadata,
    metadataProvided: item.metadata != null || input.metadataProvided,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    force: input.force,
    forceMode: input.forceMode,
    forceCpu: input.forceCpu,
  };
}

function albumUploadFilename(
  prepared: PreparedUpload,
  item: RelayAlbumInput["items"][number],
  index: number,
): string {
  const raw = String(prepared.filename || "").trim();
  if (/\.[a-z0-9]{2,8}$/i.test(raw)) return raw;
  const extension = item.mediaType === "photo" ? "jpg" : "mp4";
  return `${raw || `album-${index + 1}`}.${extension}`;
}

function shouldRetryAlbumAsUpload(result: TelegramApiResult<TelegramMessage[]>): boolean {
  if (result.ok) return false;
  // Network failures and 5xx replies are ambiguous: another Telegram call
  // could duplicate a message. These are definitive Bot API rejections.
  return [400, 413, 415].includes(Number(result.httpStatus || 0));
}

function isMixedPhotoVideoBatch(batch: RelayAlbumInput["items"]): boolean {
  let hasPhoto = false;
  let hasVideo = false;
  for (const item of batch) {
    if (item.mediaType === "photo") hasPhoto = true;
    if (item.mediaType === "video") hasVideo = true;
  }
  return hasPhoto && hasVideo;
}

function allowsOrderedMixedFallback(input: RelayAlbumInput): boolean {
  const value = String(input.metadata?.allowOrderedSingleFallback || "").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

function batchPrefersWorkerUpload(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
): boolean {
  if (!input.forceCpu) return false;

  return batch.some((item) => {
    if (
      shouldPreferWorkerUploadForTelegram(
        albumItemToRelayInput(input, item),
        item.mediaUrl.href,
        true,
      )
    ) {
      return true;
    }

    const resolvedBytes = Number(item.metadata?.resolvedContentLength || 0);
    return item.mediaType === "photo" &&
      Number.isFinite(resolvedBytes) &&
      resolvedBytes > resolveTelegramRemoteUrlLimitBytes("photo");
  });
}

function albumItemVideoMetadata(
  item: RelayAlbumInput["items"][number],
): PreparedUpload["videoMetadata"] {
  if (item.mediaType !== "video") return null;

  const width = Number(item.metadata?.resolvedWidth || 0);
  const height = Number(item.metadata?.resolvedHeight || 0);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  return {
    width,
    height,
    durationSeconds: null,
    rotation: 0,
  };
}

function itemCaption(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): string {
  return item.caption || input.caption;
}

function itemParseMode(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): RelayAlbumInput["parseMode"] {
  if (item.caption) return item.parseMode ?? input.parseMode;
  return input.parseMode;
}

function appendFallbackContext<T>(
  result: TelegramApiResult<T>,
  context: string,
): TelegramApiResult<T> {
  if (result.ok) return result;
  return {
    ...result,
    description: [context, result.description || "Telegram rejected the ordered fallback."].join(" "),
  };
}

async function prepareAlbumUploads(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
): Promise<PreparedAlbumUpload[]> {
  const maxMediaBytes = Math.min(
    resolveMaxMediaBytes(env.MAX_MEDIA_BYTES),
    resolveWorkerBufferedMediaBytes(env.WORKER_BUFFERED_MEDIA_BYTES),
  );
  const uploadBudget = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes,
  );
  const uploads: PreparedAlbumUpload[] = [];
  let totalBytes = 0;

  // Keep memory bounded while retaining exactly the source order.
  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const prepared = await prepareMedia(albumItemToRelayInput(input, item), {
      maxMediaBytes,
      concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
      hlsMaxMediaBytes: Math.min(
        resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
        resolveWorkerHlsBufferedMediaBytes(env.WORKER_HLS_BUFFERED_MEDIA_BYTES),
      ),
      twirrlVersionToken: env.TWIRRL_VERSION_TOKEN,
      allowCpuHeavy: input.forceCpu,
      forceUpload: true,
    });
    if (prepared.type !== "upload") {
      throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
    }

    totalBytes += prepared.bytes.byteLength;
    if (totalBytes > uploadBudget) {
      throw new RelayLimitExceededError(
        `Album upload fallback is ${totalBytes} bytes, above the safe ${uploadBudget} byte Worker forwarding budget.`,
        {
          kind: "album_total_bytes",
          stage: "prepare-album",
          limitBytes: uploadBudget,
          actualBytes: totalBytes,
          resolvedMediaUrl: prepared.sourceUrl || item.mediaUrl.href,
          sourceUrl: input.sourceUrl,
          inputUrl: item.mediaUrl.href,
          mediaType: item.mediaType,
          contentType: prepared.contentType,
        },
      );
    }

    uploads.push({
      mediaType: item.mediaType,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
      videoMetadata: prepared.videoMetadata,
    });
  }

  return uploads;
}

interface OrderedSinglesAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  hadExternalSideEffect: boolean;
  attemptCount: number;
  /** A URL retry is only safe before any item has been accepted. */
  safeToTryUrls: boolean;
}

async function sendPreparedAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  uploads: PreparedAlbumUpload[],
  env: Env,
  chatId: string,
  messageThreadId: number | null,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]!;
    const item = batch[index]!;
    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageThreadId,
      file: upload.file,
      filename: upload.filename,
      contentType: upload.contentType,
      videoMetadata: upload.videoMetadata,
      mediaType: upload.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        safeToTryUrls:
          !batch.some((entry) => entry.mediaType === "video") &&
          sent.length === 0 &&
          [400, 413, 415].includes(Number(result.httpStatus || 0)),
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: uploads.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  messageThreadId: number | null,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];
  const maxMediaBytes = Math.min(
    resolveMaxMediaBytes(env.MAX_MEDIA_BYTES),
    resolveWorkerBufferedMediaBytes(env.WORKER_BUFFERED_MEDIA_BYTES),
  );

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    let prepared: PreparedUpload;
    try {
      const candidate = await prepareMedia(albumItemToRelayInput(input, item), {
        maxMediaBytes,
        concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
        hlsMaxMediaBytes: Math.min(
        resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
        resolveWorkerHlsBufferedMediaBytes(env.WORKER_HLS_BUFFERED_MEDIA_BYTES),
      ),
      twirrlVersionToken: env.TWIRRL_VERSION_TOKEN,
      allowCpuHeavy: input.forceCpu,
        forceUpload: true,
      });
      if (candidate.type !== "upload") {
        throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
      }
      prepared = candidate;
    } catch (error) {
      return {
        result: {
          ok: false,
          result: sent,
          description: `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before Worker preparation of item ${index + 1} failed: ${getErrorMessage(error)}`,
        },
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index,
        safeToTryUrls:
          !batch.some((entry) => entry.mediaType === "video") &&
          sent.length === 0,
      };
    }

    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageThreadId,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
      videoMetadata: prepared.videoMetadata,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        // An ambiguous network/5xx result might have already reached Telegram.
        safeToTryUrls:
          sent.length === 0 && [400, 413, 415].includes(Number(result.httpStatus || 0)),
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: batch.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumUrlsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  messageThreadId: number | null,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const result = await sendTelegramUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageThreadId,
      mediaUrl: item.mediaUrl.href,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Emergency ordered mixed-media URL fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        safeToTryUrls: false,
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: batch.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumBatch(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  destinationKey: string,
  batchIndex: number,
): Promise<TelegramAlbumBatchAttempt> {
  const destination = parseTelegramDestination(destinationKey);
  if (!destination) {
    return {
      result: { ok: false, description: `Invalid Telegram destination: ${destinationKey}` },
      transport: "url",
      fallbackAttempted: false,
      orderedFallbackAttempted: false,
      fallbackError: null,
      hadExternalSideEffect: false,
      attemptCount: 0,
    };
  }
  const { chatId, messageThreadId } = destination;
  let preferredUploadAttempted = false;
  let preferredUploadError: string | null = null;

  // Videos are intentionally Worker-owned whenever possible. This gives the
  // relay control over the exact bytes and the real width/height sent to
  // Telegram, instead of allowing a remote fetch to choose media geometry.
  if (batchPrefersWorkerUpload(input, batch)) {
    try {
      const uploads = await prepareAlbumUploads(input, batch, env);
      const uploaded = await sendTelegramMediaGroupUpload({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        messageThreadId,
        items: uploads,
        caption: input.caption,
        parseMode: input.parseMode,
      });
      preferredUploadAttempted = true;

      if (uploaded.ok) {
        return {
          result: uploaded,
          transport: "multipart-upload",
          fallbackAttempted: false,
          orderedFallbackAttempted: false,
          fallbackError: null,
          hadExternalSideEffect: true,
          attemptCount: 1,
        };
      }

      // Do not retry an ambiguous upload result. A network/5xx response may
      // already have reached Telegram and could create a duplicate album.
      if (!shouldRetryAlbumAsUpload(uploaded)) {
        return {
          result: uploaded,
          transport: "multipart-upload",
          fallbackAttempted: false,
          orderedFallbackAttempted: false,
          fallbackError: uploaded.description || "Telegram rejected the video upload",
          hadExternalSideEffect: false,
          attemptCount: 1,
        };
      }
      preferredUploadError = uploaded.description || "Telegram rejected the video upload";
    } catch (error) {
      if (isRelayLimitExceededError(error)) {
        const firstItem = batch[0];
        const clientFallback = buildLimitExceededPayload(error, {
          sourceUrl: input.sourceUrl,
          inputUrl: firstItem?.mediaUrl.href || null,
          mediaType: firstItem?.mediaType || null,
          targetBytes: resolveClientCompressionTargetBytes(env.CLIENT_COMPRESS_TARGET_BYTES),
          mediaHeaders: firstItem?.mediaHeaders || {},
          variants: firstItem?.mediaVariants || [],
          caption: firstItem?.caption || input.caption,
          parseMode: firstItem?.parseMode ?? input.parseMode,
          provider: input.provider,
          mediaId: input.mediaId,
          mediaKey: input.mediaKey,
          hashtags: input.hashtags,
          channels: [chatId],
          metadata: firstItem?.metadata ?? input.metadata,
        });
        return {
          result: { ok: false, httpStatus: 413, description: error.message },
          transport: "multipart-upload",
          fallbackAttempted: true,
          orderedFallbackAttempted: false,
          fallbackError: error.message,
          hadExternalSideEffect: false,
          attemptCount: 0,
          clientFallback,
        };
      }
      preferredUploadError = getErrorMessage(error);
    }

    // A video must never fall back to a remote URL after the Worker has tried
    // to establish exact media geometry. Retry only through the ordered upload
    // path, which reuses the same metadata-aware sendVideo implementation.
    const ordered = await sendAlbumItemsIndividually(
      input,
      batch,
      env,
      chatId,
      messageThreadId,
      batchIndex,
    );
    return {
      result: appendFallbackContext(
        ordered.result,
        `Worker video upload fallback: ${preferredUploadError || "preferred album upload failed"}.`,
      ),
      transport: "ordered-single-upload",
      fallbackAttempted: true,
      orderedFallbackAttempted: true,
      fallbackError: ordered.result.ok
        ? null
        : ordered.result.description || "Ordered video upload fallback failed",
      hadExternalSideEffect: ordered.hadExternalSideEffect,
      attemptCount: (preferredUploadAttempted ? 1 : 0) + ordered.attemptCount + 1,
    };
  }

  const priorAttemptCount = preferredUploadAttempted ? 1 : 0;
  let direct: TelegramApiResult<TelegramMessage[]>;
  try {
    direct = await sendTelegramMediaGroupUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageThreadId,
      items: batch.map((item) => ({
        mediaUrl: item.mediaUrl.href,
        mediaType: item.mediaType,
        videoMetadata: albumItemVideoMetadata(item),
        caption: item.caption,
        parseMode: item.parseMode,
      })),
      caption: input.caption,
      parseMode: input.parseMode,
    });
  } catch (error) {
    return {
      result: {
        ok: false,
        description: `Unexpected exception while sending media group: ${getErrorMessage(error)}`,
      },
      transport: "url",
      fallbackAttempted: Boolean(preferredUploadError),
      orderedFallbackAttempted: false,
      fallbackError: preferredUploadError,
      hadExternalSideEffect: false,
      attemptCount: 1 + priorAttemptCount,
    };
  }

  if (!shouldRetryAlbumAsUpload(direct)) {
    return {
      result: direct,
      transport: "url",
      fallbackAttempted: Boolean(preferredUploadError),
      orderedFallbackAttempted: false,
      fallbackError: preferredUploadError,
      hadExternalSideEffect: direct.ok,
      attemptCount: 1 + priorAttemptCount,
    };
  }

  const mixedFallback = isMixedPhotoVideoBatch(batch) && allowsOrderedMixedFallback(input);

  if (!input.forceCpu) {
    return {
      result: {
        ...direct,
        httpStatus: direct.httpStatus || 422,
        description: [
          direct.description || "Telegram rejected remote album delivery.",
          "Worker multipart buffering is disabled in fast mode. Retry with force_cpu=true only if you want the resource-heavy fallback.",
        ].join(" "),
      },
      transport: "url",
      fallbackAttempted: false,
      orderedFallbackAttempted: false,
      fallbackError: "cpu_heavy_disabled",
      hadExternalSideEffect: false,
      attemptCount: 1 + priorAttemptCount,
    };
  }

  try {
    const uploads = await prepareAlbumUploads(input, batch, env);
    const uploaded = await sendTelegramMediaGroupUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      messageThreadId,
      items: uploads,
      caption: input.caption,
      parseMode: input.parseMode,
    });
    if (uploaded.ok) {
      return {
        result: uploaded,
        transport: "multipart-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: false,
        fallbackError: null,
        hadExternalSideEffect: true,
        attemptCount: 2 + priorAttemptCount,
      };
    }

    // Both group variants were definitively rejected. Telegram accepts these
    // same items individually on problematic mixed photo/video payloads.
    if (mixedFallback && shouldRetryAlbumAsUpload(uploaded)) {
      const ordered = await sendPreparedAlbumItemsIndividually(
        input,
        batch,
        uploads,
        env,
        chatId,
        messageThreadId,
        batchIndex,
      );
      return {
        result: appendFallbackContext(
          ordered.result,
          `Telegram rejected the mixed media group by URL and multipart (${direct.description || "URL rejected"}; ${uploaded.description || "multipart rejected"}).`,
        ),
        transport: "ordered-single-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: true,
        fallbackError: ordered.result.ok
          ? null
          : ordered.result.description || "Ordered mixed-media upload fallback failed",
        hadExternalSideEffect: ordered.hadExternalSideEffect,
        attemptCount: 2 + priorAttemptCount + ordered.attemptCount,
      };
    }

    return {
      result: {
        ...uploaded,
        description: [
          "Telegram rejected both album transports.",
          `URL: ${direct.description || "unknown error"}`,
          `multipart: ${uploaded.description || "unknown error"}`,
        ].join(" "),
      },
      transport: "multipart-upload",
      fallbackAttempted: true,
      orderedFallbackAttempted: false,
      fallbackError: uploaded.description || "Telegram rejected multipart upload",
      hadExternalSideEffect: false,
      attemptCount: 2 + priorAttemptCount,
    };
  } catch (error) {
    if (isRelayLimitExceededError(error)) {
      const firstItem = batch[0];
      const clientFallback = buildLimitExceededPayload(error, {
        sourceUrl: input.sourceUrl,
        inputUrl: firstItem?.mediaUrl.href || null,
        mediaType: firstItem?.mediaType || null,
        targetBytes: resolveClientCompressionTargetBytes(env.CLIENT_COMPRESS_TARGET_BYTES),
        mediaHeaders: firstItem?.mediaHeaders || {},
        variants: firstItem?.mediaVariants || [],
        caption: firstItem?.caption || input.caption,
        parseMode: firstItem?.parseMode ?? input.parseMode,
        provider: input.provider,
        mediaId: input.mediaId,
        mediaKey: input.mediaKey,
        hashtags: input.hashtags,
        channels: [chatId],
        metadata: firstItem?.metadata ?? input.metadata,
      });
      return {
        result: { ok: false, httpStatus: 413, description: error.message },
        transport: "multipart-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: false,
        fallbackError: error.message,
        hadExternalSideEffect: false,
        attemptCount: 1 + priorAttemptCount,
        clientFallback,
      };
    }
    const fallbackError = getErrorMessage(error);
    if (mixedFallback) {
      const ordered = await sendAlbumItemsIndividually(input, batch, env, chatId, messageThreadId, batchIndex);
      const urlFallback = !ordered.result.ok && ordered.safeToTryUrls
        ? await sendAlbumUrlsIndividually(input, batch, env, chatId, messageThreadId, batchIndex)
        : null;
      const finalAttempt = urlFallback || ordered;
      return {
        result: appendFallbackContext(
          finalAttempt.result,
          `The Worker could not prepare a multipart mixed-media album (${fallbackError}).`,
        ),
        transport: urlFallback ? "ordered-single-url" : "ordered-single-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: true,
        fallbackError: finalAttempt.result.ok
          ? null
          : finalAttempt.result.description || "Ordered mixed-media fallback failed",
        hadExternalSideEffect: finalAttempt.hadExternalSideEffect,
        attemptCount: 1 + priorAttemptCount + ordered.attemptCount + (urlFallback ? urlFallback.attemptCount : 0),
      };
    }
    return {
      result: {
        ...direct,
        description: [
          direct.description || "Telegram rejected the URL album.",
          `Worker multipart fallback failed: ${fallbackError}`,
        ].join(" "),
      },
      transport: "url",
      fallbackAttempted: true,
      orderedFallbackAttempted: false,
      fallbackError,
      hadExternalSideEffect: false,
      attemptCount: 1 + priorAttemptCount,
    };
  }
}

export async function handleJsonAlbumSend(
  input: RelayAlbumInput,
  env: Env,
  traceId = "album",
): Promise<Response> {
  relayDebug(env, traceId, "album.started", {
    provider: input.provider || null,
    itemCount: input.items.length,
    mediaTypes: input.items.map((item) => item.mediaType),
    requestedChannelCount: input.channels.length,
    routingUsernames: input.usernames,
    force: input.force,
    forceMode: input.forceMode,
  });
  const chatIds = resolveTelegramChatIdsForEnv(env, input.channels, input.usernames);

  if (!chatIds.length) {
    relayDebug(env, traceId, "album.no-channels", {});
    return json(
      {
        ok: false,
        error:
          "No Telegram channel was provided. Send channel/channels or username/usernames in the request, configure TELEGRAM_USERNAME_CHANNEL_MAP_JSON, or configure TELEGRAM_CHAT_ID as the default.",
      },
      400,
    );
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    relayDebug(env, traceId, "album.database-unavailable", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  let plan;
  try {
    plan = await createDeliveryPlan({
      db,
      env,
      channels: chatIds,
      force: input.force,
      identityInput: {
        provider: input.provider,
        mediaId: input.mediaId,
        mediaKey: input.mediaKey,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaUrl: input.items[0]?.mediaUrl.href || null,
      },
    });
  } catch (error) {
    relayDebug(env, traceId, "album.delivery-plan-failed", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  relayDebug(env, traceId, "album.delivery-plan-ready", {
    identityKey: plan.identity.key,
    channelsToSend: plan.channelsToSend.length,
    alreadySent: plan.skippedAlreadySent.length,
    inProgress: plan.skippedInProgress.length,
  });

  const needsCaptionRepair = plan.claim.alreadySentDeliveries.some((delivery) =>
    storedCaptionHasAccessNotice(delivery.presentationJson));
  const presentationRequested =
    !input.force &&
    (input.captionExplicit || input.hashtags.length > 0 || input.metadataProvided || needsCaptionRepair);
  const captionProvided = input.captionExplicit || input.hashtags.length > 0;
  const socialPromise = plan.channelsToSend.length || (presentationRequested && captionProvided)
    ? resolveSocialDeliveryContent({
        provider: input.provider,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        caption: input.caption,
        captionExplicit: input.captionExplicit,
        hashtags: input.hashtags,
        parseMode: input.parseMode,
        metadata: input.metadata,
      }, env)
    : null;
  let presentationSync: Awaited<ReturnType<typeof reconcileExistingMediaPresentation>> | null = null;
  let reconciledSocialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>> | null = null;

  if (presentationRequested && plan.skippedAlreadySent.length > 0) {
    try {
      reconciledSocialContent = socialPromise ? await socialPromise : null;
      presentationSync = await reconcileExistingMediaPresentation({
        db,
        env,
        identity: plan.identity,
        channels: plan.skippedAlreadySent.map((entry) => entry.channelId),
        caption: reconciledSocialContent?.caption ?? "",
        captionProvided,
        parseMode: reconciledSocialContent?.parseMode ?? null,
        metadata: input.presentationMetadata !== undefined ? input.presentationMetadata : input.metadata,
        metadataProvided: input.metadataProvided,
      });
      if (presentationSync.summary.changed > 0 && presentationSync.summary.failed === 0) await persistKnownMedia(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType: "album",
        mediaCount: input.items.length,
        metadata: input.metadataProvided ? (reconciledSocialContent?.metadata ?? input.metadata) : null,
        metadataProvided: input.metadataProvided,
        caption: reconciledSocialContent?.caption ?? "",
        captionProvided,
        parseMode: reconciledSocialContent?.parseMode ?? null,
        mediaStatus: "sent",
      });
      relayDebug(env, traceId, "album.presentation-reconciled", presentationSync.summary);
    } catch (error) {
      relayDebug(env, traceId, "album.presentation-reconcile-failed", { error: debugError(error) });
      await releasePendingDeliveryClaims(plan).catch(() => {});
      return json({
        ok: false,
        error: getErrorMessage(error),
        stage: "presentation-reconcile",
        media: plan.identity,
      }, 500);
    }
  }

  if (!plan.channelsToSend.length) {
    if (presentationSync) {
      const failed = presentationSync.summary.failed;
      const changed = presentationSync.summary.changed;
      return json({
        ok: failed === 0,
        ...getAlreadySentTelegramMessageLinkFields(plan),
        partial: failed > 0,
        conflict: false,
        action: changed > 0 ? "presentation_reconciled" : "presentation_unchanged",
        message: changed > 0
          ? `Existing Telegram album presentation compared; ${presentationSync.summary.edited} message(s) edited.`
          : "Existing Telegram album presentation is already current.",
        media: plan.identity,
        channels: {
          requested: chatIds,
          attempted: [],
          inserted: [],
          notSent: plan.skippedAlreadySent,
        },
        presentation: presentationSync.summary,
        presentationResults: presentationSync.results,
        metadata: reconciledSocialContent?.metadata ?? input.metadata,
      }, failed > 0 ? 207 : 200);
    }

    relayDebug(env, traceId, "album.delivery-conflict", {
      channels: debugChannelSummary(buildDeliveryConflict(plan, "Album").channels),
    });
    return json(buildDeliveryConflict(plan, "Album"), 409);
  }

  try {
    relayDebug(env, traceId, "album.social-metadata.started", {});
    if (!socialPromise) {
      throw new Error("Internal error: social content promise was not initialized.");
    }
    const socialContent = reconciledSocialContent || await socialPromise;
    relayDebug(env, traceId, "album.social-metadata.completed", {
      captionLength: socialContent.caption.length,
      socialMetadataStrategy: socialContent.social?.strategy || null,
    });

    if (input.forceMode === "forward") {
      return await handleAlbumForwardCopy({
        input,
        env,
        db,
        plan,
        chatIds,
        socialContent,
        traceId,
      });
    }

    await persistKnownMedia(db, {
      identity: plan.identity,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      mediaType: "album",
      mediaCount: input.items.length,
      metadata: socialContent.metadata,
      caption: socialContent.caption || null,
      parseMode: socialContent.parseMode,
      mediaStatus: "ready",
    });

    // The fallback transports must use the same enriched caption and metadata
    // as the URL-first album path, so social delivery behavior stays intact.
    const deliveryInput: RelayAlbumInput = {
      ...input,
      // Social enrichment owns the single post caption. Clearing client-side
      // per-item captions ensures the first Telegram album entry receives the
      // enriched caption (or its URL-only fallback) instead of stale browser
      // text, while generic albums preserve their individual captions.
      items: socialContent.social
        ? input.items.map((item) => ({ ...item, caption: "", parseMode: null }))
        : input.items,
      caption: socialContent.caption,
      parseMode: socialContent.parseMode,
      metadata: socialContent.metadata,
    };
    const batches = chunkTelegramAlbum(deliveryInput.items);
    relayDebug(env, traceId, "album.telegram.started", {
      channelCount: plan.channelsToSend.length,
      batchCount: batches.length,
      mixedPhotoVideo: isMixedPhotoVideoBatch(deliveryInput.items),
    });

    // Album chunks must remain ordered within a channel, but Telegram channels
    // are independent. Process a small number of channels concurrently so a
    // slow destination does not serialize every other destination.
    const processAlbumChannel = async (chatId: string): Promise<TelegramAlbumBatchDelivery[]> => {
      let itemOffset = 0;
      const channelDeliveries: TelegramAlbumBatchDelivery[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex]!;
        const attempt = await sendAlbumBatch(
          deliveryInput,
          batch,
          env,
          chatId,
          batchIndex,
        );

        relayDebug(env, traceId, "album.telegram-batch.completed", {
          batchIndex,
          itemCount: batch.length,
          transport: attempt.transport,
          ok: attempt.result.ok,
          httpStatus: attempt.result.httpStatus || null,
          fallbackAttempted: attempt.fallbackAttempted,
          orderedFallbackAttempted: attempt.orderedFallbackAttempted,
          error: attempt.result.ok ? null : attempt.result.description || null,
        });

        channelDeliveries.push({
          requestedChatId: chatId,
          batchIndex,
          itemOffset,
          itemCount: batch.length,
          result: attempt.result,
          transport: attempt.transport,
          fallbackAttempted: attempt.fallbackAttempted,
          orderedFallbackAttempted: attempt.orderedFallbackAttempted,
          fallbackError: attempt.fallbackError,
          hadExternalSideEffect: attempt.hadExternalSideEffect,
          attemptCount: attempt.attemptCount,
          clientFallback: attempt.clientFallback || null,
        });
        itemOffset += batch.length;

        // Once a chunk failed, continuing would create more orphaned album
        // chunks that cannot be represented as one successful channel delivery.
        if (!attempt.result.ok) break;
      }

      return channelDeliveries;
    };

    const channelConcurrency = Math.min(1, plan.channelsToSend.length);
    const deliveriesByChannel = await mapWithConcurrency(
      plan.channelsToSend,
      channelConcurrency,
      processAlbumChannel,
    );
    const deliveries = deliveriesByChannel.flat();
    const messageLinks = buildTelegramMessageLinkFields(
      deliveries.flatMap((delivery) => {
        const messages = Array.isArray(delivery.result.result) ? delivery.result.result : [];
        const single = messages.length > 1;
        return messages.map((message) => ({
          requestedChatId: delivery.requestedChatId,
          telegramChatId: message?.chat?.id ?? null,
          telegramUsername: message?.chat?.username ?? null,
          messageThreadId: message?.message_thread_id ?? null,
          messageId: message?.message_id ?? null,
          single,
        }));
      }),
    );

    const formatted = deliveries.map((delivery) => ({
      requestedChatId: delivery.requestedChatId,
      batchIndex: delivery.batchIndex,
      itemOffset: delivery.itemOffset,
      itemCount: delivery.itemCount,
      transport: delivery.transport,
      fallbackAttempted: delivery.fallbackAttempted,
      orderedFallbackAttempted: delivery.orderedFallbackAttempted,
      fallbackError: delivery.fallbackError,
      hadExternalSideEffect: delivery.hadExternalSideEffect,
      attemptCount: delivery.attemptCount,
      ok: delivery.result.ok,
      httpStatus: delivery.result.httpStatus ?? null,
      error: delivery.result.ok
        ? null
        : delivery.result.description || "Telegram rejected sendMediaGroup",
      messageIds: Array.isArray(delivery.result.result)
        ? delivery.result.result.map((message) => message?.message_id ?? null)
        : [],
    }));

    const completedChannels = plan.channelsToSend.filter((chatId) => {
      const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
      return (
        channelDeliveries.length === batches.length &&
        channelDeliveries.every((delivery) => delivery.result.ok)
      );
    });
    const channelsWithExternalSideEffects = new Set(
      deliveries
        .filter((delivery) => delivery.hadExternalSideEffect)
        .map((delivery) => delivery.requestedChatId),
    );
    retainSuccessfulClaimsUntilPersistence(plan, channelsWithExternalSideEffects);

    relayDebug(env, traceId, "album.telegram.completed", {
      attemptedBatches: deliveries.length,
      completedChannelCount: completedChannels.length,
      externalSideEffectChannelCount: channelsWithExternalSideEffects.size,
    });

    const failedChannels = plan.channelsToSend
      .filter((chatId) => !completedChannels.includes(chatId))
      .map((channelId) => {
        const channelDeliveries = deliveries.filter(
          (delivery) => delivery.requestedChatId === channelId,
        );
        const errors = channelDeliveries.filter((delivery) => !delivery.result.ok);
        return {
          channelId,
          reason: "telegram_error" as const,
          partialDelivery: channelDeliveries.some(
            (delivery) => delivery.result.ok || delivery.hadExternalSideEffect,
          ),
          errors: errors.map((delivery) => ({
            batchIndex: delivery.batchIndex,
            transport: delivery.transport,
            orderedFallbackAttempted: delivery.orderedFallbackAttempted,
            error: delivery.result.description || "Telegram rejected sendMediaGroup",
            httpStatus: delivery.result.httpStatus ?? null,
          })),
        };
      });

    let insertedChannelIds: string[] = [];
    try {
      relayDebug(env, traceId, "album.persist.started", {
        completedChannelCount: completedChannels.length,
      });
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType: "album",
        mediaCount: input.items.length,
        metadata: socialContent.metadata,
        presentationMetadata: input.metadataProvided ? (input.presentationMetadata !== undefined ? input.presentationMetadata : input.metadata) : null,
        caption: socialContent.caption,
        parseMode: socialContent.parseMode,
        mediaStatus: "sent",
        deliveries: completedChannels.map((chatId) => {
          const channelDeliveries = deliveries.filter(
            (delivery) => delivery.requestedChatId === chatId,
          );
          const messages = channelDeliveries.flatMap((delivery) =>
            Array.isArray(delivery.result.result) ? delivery.result.result : [],
          );
          return {
            requestedChatId: chatId,
            telegramChatId: messages[0]?.chat?.id ?? null,
            telegramChatTitle: messages[0]?.chat?.title ?? null,
            messageIds: messages.map((message) => message.message_id ?? null),
          };
        }),
      });
      markChannelsPersisted(plan, insertedChannelIds);
    } catch (error) {
      relayDebug(env, traceId, "album.persist.failed", {
        identityKey: plan.identity.key,
        completedChannelCount: completedChannels.length,
        error: debugError(error),
      });
      return json(
        {
          ok: false,
          ...messageLinks,
          error: getErrorMessage(error),
          stage: "persist-delivery",
          warning:
            "Telegram accepted album chunks but D1 history could not be fully committed. Claims for channels with external side effects are retained until TTL.",
          media: plan.identity,
          channels: {
            requested: chatIds,
            attempted: plan.channelsToSend,
            inserted: [],
            telegramCompleted: completedChannels,
          },
        },
        500,
      );
    }

    relayDebug(env, traceId, "album.persist.completed", {
      insertedChannelCount: insertedChannelIds.length,
    });

    const notSent = [
      ...plan.skippedAlreadySent,
      ...plan.skippedInProgress,
      ...failedChannels,
    ];
    const usedOrderedSingleFallback = deliveries.some(
      (delivery) => delivery.transport === "ordered-single-url" || delivery.transport === "ordered-single-upload",
    );
    const payload = {
      ok: completedChannels.length > 0,
      ...messageLinks,
      partial: notSent.length > 0,
      media: plan.identity,
      message:
        completedChannels.length > 0
          ? `Album delivered completely to ${completedChannels.length} Telegram channel(s)${usedOrderedSingleFallback ? " using the ordered mixed-media fallback" : ""}`
          : "Album was not completely delivered to any Telegram channel",
      mode: usedOrderedSingleFallback
        ? "telegram-media-group-ordered-single-fallback"
        : "telegram-media-group",
      source: { sourceUrl: input.sourceUrl, pageUrl: input.pageUrl },
      channels: {
        requested: chatIds,
        attempted: plan.channelsToSend,
        inserted: insertedChannelIds,
        notSent,
      },
      // Duplicate details come directly from the atomic D1 claim lookup, so the
      // client can show every previous Telegram message belonging to the album.
      duplicates: getAlreadySentDeliveryDetails(plan),
      mediaSet: {
        count: input.items.length,
        batches: batches.length,
        items: input.items.map((item, index) => ({
          index,
          mediaType: item.mediaType,
          mediaUrl: item.mediaUrl.href,
        })),
      },
      telegram: {
        method: usedOrderedSingleFallback
          ? "sendMediaGroup -> sendPhoto/sendVideo"
          : "sendMediaGroup",
        deliveries: formatted,
      },
      clientFallbacks: deliveries
        .map((delivery) => delivery.clientFallback)
        .filter((fallback): fallback is NonNullable<typeof fallback> => Boolean(fallback)),
      metadata: socialContent.metadata,
      presentation: presentationSync?.summary ?? null,
      presentationResults: presentationSync?.results ?? [],
      socialMetadata: socialContent.social,
      metrics: {
        identityAliasQueries: plan.identityAliasQueries,
        claimQueries: plan.claim.queryCount,
        claimedChannels: plan.channelsToSend.length,
        telegramAttempts: deliveries.reduce(
          (total, delivery) => total + delivery.attemptCount,
          0,
        ),
        dbRoundTrips:
          plan.identityAliasQueries +
          1 +
          (completedChannels.length ? 1 : 0) +
          1,
        dbStatements:
          plan.identityAliasQueries +
          plan.claim.queryCount +
          (completedChannels.length ? 1 + completedChannels.length : 0) +
          1,
      },
    };

    const status = !completedChannels.length
      ? payload.clientFallbacks.length ? 413 : 502
      : notSent.length ? 207 : 200;
    relayDebug(env, traceId, "album.completed", {
      status,
      usedOrderedSingleFallback,
      channels: debugChannelSummary(payload.channels),
    });
    return json(payload, status);
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      relayDebug(env, traceId, "album.claim-release.failed", {
        identityKey: plan.identity.key,
        error: debugError(error),
      });
    });
    relayDebug(env, traceId, "album.claim-release.completed", { identityKey: plan.identity.key });
  }
}

function chunkTelegramAlbum(
  items: RelayAlbumInput["items"],
): RelayAlbumInput["items"][] {
  const batches: RelayAlbumInput["items"][] = [];
  let cursor = 0;

  while (cursor < items.length) {
    const remaining = items.length - cursor;
    const batchSize = remaining > 10 && remaining % 10 === 1 ? 9 : Math.min(10, remaining);
    batches.push(items.slice(cursor, cursor + batchSize));
    cursor += batchSize;
  }

  return batches;
}


async function handleAlbumForwardCopy(options: {
  input: RelayAlbumInput;
  env: Env;
  db: D1Database;
  plan: DeliveryPlan;
  chatIds: string[];
  socialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>>;
  traceId: string;
}): Promise<Response> {
  const { input, env, db, plan, chatIds, socialContent, traceId } = options;
  relayDebug(env, traceId, "album.forward.started", {
    channelCount: plan.channelsToSend.length,
    storedDeliveryCount: plan.claim.alreadySentDeliveries.length,
    captionLength: socialContent.caption.length,
  });

  const deliveries = await copyStoredTelegramDeliveries({
    botToken: env.TELEGRAM_BOT_TOKEN,
    channels: plan.channelsToSend,
    storedDeliveries: plan.claim.alreadySentDeliveries,
    caption: socialContent.caption,
    parseMode: socialContent.parseMode,
    messagePresentations: buildForwardAlbumPresentations(input, socialContent),
  });
  const successfulDeliveries = deliveries.filter((delivery) => delivery.ok);
  const failedDeliveries = deliveries.filter((delivery) => !delivery.ok);
  const externalSideEffectChannels = deliveries
    .filter((delivery) => delivery.hadExternalSideEffect)
    .map((delivery) => delivery.requestedChatId);
  retainSuccessfulClaimsUntilPersistence(plan, externalSideEffectChannels);

  const messageLinks = buildTelegramMessageLinkFields(
    successfulDeliveries.flatMap((delivery) =>
      delivery.messageIds.map((messageId) => ({
        requestedChatId: delivery.requestedChatId,
        telegramChatId: delivery.telegramChatId,
        messageThreadId: delivery.messageThreadId,
        messageId,
        single: delivery.messageIds.length > 1,
      }))),
  );

  let insertedChannelIds: string[] = [];
  if (successfulDeliveries.length) {
    try {
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType: "album",
        mediaCount: input.items.length,
        metadata: socialContent.metadata,
        presentationMetadata: input.metadataProvided
          ? (input.presentationMetadata !== undefined ? input.presentationMetadata : input.metadata)
          : null,
        caption: socialContent.caption,
        parseMode: socialContent.parseMode,
        mediaStatus: "sent",
        deliveries: successfulDeliveries.map((delivery) => ({
          requestedChatId: delivery.requestedChatId,
          telegramChatId: delivery.telegramChatId,
          telegramChatTitle: delivery.telegramChatTitle,
          messageIds: delivery.messageIds,
        })),
      });
      markChannelsPersisted(plan, insertedChannelIds);
    } catch (error) {
      relayDebug(env, traceId, "album.forward.persist-failed", {
        error: debugError(error),
        successfulTelegramDeliveries: successfulDeliveries.length,
      });
      return json({
        ok: false,
        ...messageLinks,
        action: "forward",
        force_mode: "forward",
        error: getErrorMessage(error),
        stage: "persist-delivery",
        warning:
          "Telegram copied one or more stored album messages but D1 history could not be committed. Claims are retained until TTL to reduce duplicate retries.",
        media: plan.identity,
        telegram: {
          method: "copyMessages+editMessageCaption",
          deliveries,
        },
      }, 500);
    }
  }

  const failedChannels = failedDeliveries.map((delivery) => ({
    channelId: delivery.requestedChatId,
    reason: delivery.sourceMessageIds.length ? "telegram_error" : "forward_source_missing",
    error: delivery.error,
    httpStatus: delivery.httpStatus,
    hadExternalSideEffect: delivery.hadExternalSideEffect,
    messageIds: delivery.messageIds,
  }));
  const notSent = [...plan.skippedInProgress, ...failedChannels];
  const status = successfulDeliveries.length
    ? notSent.length ? 207 : 200
    : failedChannels.every((delivery) => delivery.reason === "forward_source_missing")
      ? 409
      : 502;

  relayDebug(env, traceId, "album.forward.completed", {
    status,
    succeeded: successfulDeliveries.length,
    failed: failedDeliveries.length,
    inserted: insertedChannelIds.length,
  });

  return json({
    ok: successfulDeliveries.length > 0,
    ...messageLinks,
    action: "forward",
    force_mode: "forward",
    partial: successfulDeliveries.length > 0 && notSent.length > 0,
    conflict: successfulDeliveries.length === 0 && status === 409,
    message: successfulDeliveries.length
      ? `Stored Telegram album copied as ${successfulDeliveries.length} new delivery(s) with the current caption.`
      : "No stored Telegram album could be copied for force=forward.",
    media: plan.identity,
    mode: "telegram-forward-copy",
    source: { sourceUrl: input.sourceUrl, pageUrl: input.pageUrl },
    channels: {
      requested: chatIds,
      attempted: plan.channelsToSend,
      inserted: insertedChannelIds,
      notSent,
    },
    telegram: {
      method: "copyMessages+editMessageCaption",
      deliveries,
    },
    metadata: socialContent.metadata,
    socialMetadata: socialContent.social,
    metrics: {
      identityAliasQueries: plan.identityAliasQueries,
      claimQueries: plan.claim.queryCount,
      claimedChannels: plan.channelsToSend.length,
      telegramAttempts: deliveries.length,
      successfulTelegramAttempts: successfulDeliveries.length,
    },
  }, status);
}


function buildForwardAlbumPresentations(
  input: RelayAlbumInput,
  socialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>>,
): Array<{ caption: string; parseMode: RelayAlbumInput["parseMode"] }> {
  const effectiveItems = socialContent.social
    ? input.items.map((item) => ({ ...item, caption: "", parseMode: null }))
    : input.items;

  return chunkTelegramAlbum(effectiveItems).flatMap((batch) =>
    batch.map((item, index) => ({
      caption: item.caption || (index === 0 ? socialContent.caption : ""),
      parseMode: item.caption
        ? item.parseMode ?? socialContent.parseMode
        : index === 0
          ? socialContent.parseMode
          : null,
    })),
  );
}
