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

interface TelegramAlbumBatchDelivery {
  requestedChatId: string;
  batchIndex: number;
  itemOffset: number;
  itemCount: number;
  result: TelegramApiResult<TelegramMessage[]>;
  transport: "url" | "multipart-upload";
  fallbackAttempted: boolean;
  fallbackError: string | null;
}

interface TelegramAlbumBatchAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  transport: "url" | "multipart-upload";
  fallbackAttempted: boolean;
  fallbackError: string | null;
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
      fallbackError: null,
    };
  }

  if (!shouldRetryAlbumAsUpload(direct)) {
    return {
      result: direct,
      transport: "url",
      fallbackAttempted: false,
      fallbackError: null,
    };
  }

  try {
    const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
    const uploadBudget = resolveMultipartMaxTotalBytes(
      env.MULTIPART_MAX_TOTAL_BYTES,
      maxMediaBytes,
    );
    const uploads = [];
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
        caption: item.caption,
        parseMode: item.parseMode,
      });
    }

    const uploaded = await sendTelegramMediaGroupUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      items: uploads,
      caption: batchIndex === 0 ? input.caption : "",
      parseMode: batchIndex === 0 ? input.parseMode : null,
    });
    return {
      result: uploaded.ok
        ? uploaded
        : {
            ...uploaded,
            description: [
              "Telegram rejected both album transports.",
              `URL: ${direct.description || "unknown error"}`,
              `multipart: ${uploaded.description || "unknown error"}`,
            ].join(" "),
          },
      transport: "multipart-upload",
      fallbackAttempted: true,
      fallbackError: uploaded.ok
        ? null
        : uploaded.description || "Telegram rejected multipart upload",
    };
  } catch (error) {
    const fallbackError = getErrorMessage(error);
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
      fallbackError,
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
          fallbackError: attempt.fallbackError,
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
      fallbackError: delivery.fallbackError,
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
    const channelsWithAnySuccess = new Set(
      deliveries.filter((delivery) => delivery.result.ok).map((delivery) => delivery.requestedChatId),
    );
    retainSuccessfulClaimsUntilPersistence(plan, channelsWithAnySuccess);

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
          partialDelivery: channelDeliveries.some((delivery) => delivery.result.ok),
          errors: errors.map((delivery) => ({
            batchIndex: delivery.batchIndex,
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
    const payload = {
      ok: completedChannels.length > 0,
      partial: notSent.length > 0,
      media: plan.identity,
      message:
        completedChannels.length > 0
          ? `Album delivered completely to ${completedChannels.length} Telegram channel(s)`
          : "Album was not completely delivered to any Telegram channel",
      mode: "telegram-media-group",
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
      telegram: { method: "sendMediaGroup", deliveries: formatted },
      metadata: input.metadata,
      metrics: {
        identityAliasQueries: plan.identityAliasQueries,
        claimQueries: plan.claim.queryCount,
        claimedChannels: plan.channelsToSend.length,
        telegramAttempts: deliveries.length,
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
