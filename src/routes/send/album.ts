import { persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import {
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
} from "../../media";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
} from "../../services/delivery-plan";
import {
  resolveDefaultTelegramChatId,
  resolveTelegramChatIds,
} from "../../services/channels";
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
import { resolveMultipartMaxTotalBytes } from "./multipart-utils";

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
  /**
   * A failed ordered fallback can still have sent earlier items. Keep the D1
   * claim alive in that case so an immediate retry does not duplicate them.
   */
  hadExternalSideEffect: boolean;
  attemptCount: number;
}

interface TelegramAlbumBatchAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  transport: AlbumTransport;
  fallbackAttempted: boolean;
  orderedFallbackAttempted: boolean;
  fallbackError: string | null;
  hadExternalSideEffect: boolean;
  attemptCount: number;
}

interface PreparedAlbumUpload {
  mediaType: RelayAlbumInput["items"][number]["mediaType"];
  file: Blob;
  filename: string;
  contentType: string;
  caption: string;
  parseMode: RelayAlbumInput["items"][number]["parseMode"];
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
    parseMode: item.parseMode ?? input.parseMode,
    mediaType: item.mediaType,
    mediaHeaders: item.mediaHeaders,
    channels: [],
    metadata: item.metadata ?? input.metadata,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    force: input.force,
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

  // Network failures and 5xx replies are ambiguous: retrying could duplicate a
  // message. These 4xx rejections are definitive and commonly mean Telegram
  // could not fetch the protected CDN URL itself.
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

function itemCaption(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): string {
  return item.caption || (index === 0 && batchIndex === 0 ? input.caption : "");
}

function itemParseMode(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): RelayAlbumInput["parseMode"] {
  if (item.caption) return item.parseMode ?? (batchIndex === 0 ? input.parseMode : null);
  return index === 0 && batchIndex === 0 ? input.parseMode : null;
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
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const uploadBudget = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes,
  );
  const uploads: PreparedAlbumUpload[] = [];
  let totalBytes = 0;

  // Sequential preparation bounds Worker memory while preserving the exact
  // photo/video order that Telegram expects in a media group.
  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const prepared = await prepareMedia(albumItemToRelayInput(input, item), {
      maxMediaBytes,
      concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
      hlsMaxMediaBytes: resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
      forceUpload: true,
    });
    if (prepared.type !== "upload") {
      throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
    }

    totalBytes += prepared.bytes.byteLength;
    if (totalBytes > uploadBudget) {
      throw new Error(
        `Album upload fallback is ${totalBytes} bytes, above the safe ${uploadBudget} byte Worker forwarding budget.`,
      );
    }

    uploads.push({
      mediaType: item.mediaType,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], {
        type: prepared.contentType,
      }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
      caption: item.caption,
      parseMode: item.parseMode,
    });
  }

  return uploads;
}

interface OrderedSinglesAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  hadExternalSideEffect: boolean;
  attemptCount: number;
  /** URL fallback is only safe before any individual message has been accepted. */
  safeToTryUrls: boolean;
}

async function sendPreparedAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  uploads: PreparedAlbumUpload[],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]!;
    const item = batch[index]!;
    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      file: upload.file,
      filename: upload.filename,
      contentType: upload.contentType,
      mediaType: upload.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          {
            ...result,
            result: sent,
          },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        // A retry with another Telegram method is only unambiguous after a
        // definitive rejection. Network/5xx failures may already have sent
        // the item, even when no response made it back to the Worker.
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
    attemptCount: uploads.length,
    safeToTryUrls: false,
  };
}

/**
 * The group multipart budget protects Worker memory, but it must not make a
 * mixed carousel impossible to deliver. When the group preparation is too
 * large, prepare/upload one item at a time so only one file is retained while
 * still using the per-item Referer/User-Agent headers.
 */
async function sendAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    let prepared: PreparedUpload;
    try {
      const candidate = await prepareMedia(albumItemToRelayInput(input, item), {
        maxMediaBytes,
        concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
        hlsMaxMediaBytes: resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
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
        safeToTryUrls: sent.length === 0,
      };
    }

    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          {
            ...result,
            result: sent,
          },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        // Do not change Telegram transport after an ambiguous failure. The
        // current call may have succeeded remotely even though its response
        // did not reach the Worker.
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
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const result = await sendTelegramUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      mediaUrl: item.mediaUrl.href,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          {
            ...result,
            result: sent,
          },
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
  chatId: string,
  batchIndex: number,
): Promise<TelegramAlbumBatchAttempt> {
  let direct: TelegramApiResult<TelegramMessage[]>;
  try {
    direct = await sendTelegramMediaGroupUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      items: batch.map((item) => ({
        mediaUrl: item.mediaUrl.href,
        mediaType: item.mediaType,
        caption: item.caption,
        parseMode: item.parseMode,
      })),
      caption: batchIndex === 0 ? input.caption : "",
      parseMode: batchIndex === 0 ? input.parseMode : null,
    });
  } catch (error) {
    return {
      result: {
        ok: false,
        description: `Unexpected exception while sending media group: ${getErrorMessage(error)}`,
      },
      transport: "url",
      fallbackAttempted: false,
      orderedFallbackAttempted: false,
      fallbackError: null,
      hadExternalSideEffect: false,
      attemptCount: 1,
    };
  }

  if (!shouldRetryAlbumAsUpload(direct)) {
    return {
      result: direct,
      transport: "url",
      fallbackAttempted: false,
      orderedFallbackAttempted: false,
      fallbackError: null,
      hadExternalSideEffect: direct.ok,
      attemptCount: 1,
    };
  }

  const mixedFallback =
    isMixedPhotoVideoBatch(batch) && allowsOrderedMixedFallback(input);

  try {
    const uploads = await prepareAlbumUploads(input, batch, env);

    const uploaded = await sendTelegramMediaGroupUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      items: uploads,
      caption: batchIndex === 0 ? input.caption : "",
      parseMode: batchIndex === 0 ? input.parseMode : null,
    });
    if (uploaded.ok) {
      return {
        result: uploaded,
        transport: "multipart-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: false,
        fallbackError: null,
        hadExternalSideEffect: true,
        attemptCount: 2,
      };
    }

    // sendMediaGroup is atomic on a Telegram 4xx rejection, so this last
    // branch is safe from duplicating an album. It specifically rescues
    // mixed photo/video posts where Telegram accepts each item but rejects
    // their combined media-group payload or total multipart request.
    if (mixedFallback && shouldRetryAlbumAsUpload(uploaded)) {
      const ordered = await sendPreparedAlbumItemsIndividually(
        input,
        batch,
        uploads,
        env,
        chatId,
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
        attemptCount: 2 + ordered.attemptCount,
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
      attemptCount: 2,
    };
  } catch (error) {
    const fallbackError = getErrorMessage(error);
    if (mixedFallback) {
      const ordered = await sendAlbumItemsIndividually(input, batch, env, chatId, batchIndex);
      // If Worker preparation itself failed before it delivered anything, a
      // direct single-message attempt is still unambiguous and can rescue a
      // CDN that Telegram is able to fetch without the Worker. Never attempt
      // this after one item was sent: that would risk duplicates.
      const urlFallback = !ordered.result.ok && ordered.safeToTryUrls
        ? await sendAlbumUrlsIndividually(input, batch, env, chatId, batchIndex)
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
        attemptCount: 1 + ordered.attemptCount + (urlFallback ? urlFallback.attemptCount : 0),
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
      attemptCount: 1,
    };
  }
}

export async function handleJsonAlbumSend(
  input: RelayAlbumInput,
  env: Env,
): Promise<Response> {
  const chatIds = resolveTelegramChatIds(
    input.channels,
    resolveDefaultTelegramChatId(env),
  );

  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error:
          "No Telegram channel was provided. Send channel/channels in the request or configure TELEGRAM_CHAT_ID as the default.",
      },
      400,
    );
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
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
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  if (!plan.channelsToSend.length) {
    return json(buildDeliveryConflict(plan, "Album"), 409);
  }

  try {
    const batches = chunkTelegramAlbum(input.items);
    const deliveries: TelegramAlbumBatchDelivery[] = [];

    for (const chatId of plan.channelsToSend) {
      let itemOffset = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex]!;
        const attempt = await sendAlbumBatch(input, batch, env, chatId, batchIndex);

        deliveries.push({
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
        });
        itemOffset += batch.length;

        // Once a chunk failed, continuing would create more orphaned album
        // chunks that cannot be represented as one successful channel delivery.
        if (!attempt.result.ok) break;
      }
    }

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
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType: "album",
        mediaCount: input.items.length,
        metadata: input.metadata,
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
      console.error("[media-relay] Album reached Telegram but D1 persistence failed", {
        media: plan.identity.key,
        completedChannels,
        error: getErrorMessage(error),
      });
      return json(
        {
          ok: false,
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
      metadata: input.metadata,
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

    if (!completedChannels.length) return json(payload, 502);
    return json(payload, notSent.length ? 207 : 200);
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      console.error("[media-relay] Failed to release album claims", {
        media: plan.identity.key,
        error: getErrorMessage(error),
      });
    });
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
