import { persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
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
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
import { sendTelegramMediaGroupUrl } from "../../telegram";
import type {
  Env,
  RelayAlbumInput,
  TelegramApiResult,
  TelegramMessage,
} from "../../types";

interface TelegramAlbumBatchDelivery {
  requestedChatId: string;
  batchIndex: number;
  itemOffset: number;
  itemCount: number;
  result: TelegramApiResult<TelegramMessage[]>;
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
    const socialContent = await resolveSocialDeliveryContent({
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      caption: input.caption,
      parseMode: input.parseMode,
      metadata: input.metadata,
    }, env);

    const batches = chunkTelegramAlbum(input.items);
    const deliveries: TelegramAlbumBatchDelivery[] = [];

    for (const chatId of plan.channelsToSend) {
      let itemOffset = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex]!;
        let result: TelegramApiResult<TelegramMessage[]>;
        try {
          result = await sendTelegramMediaGroupUrl({
            botToken: env.TELEGRAM_BOT_TOKEN,
            chatId,
            items: batch.map((item) => ({
              mediaUrl: item.mediaUrl.href,
              mediaType: item.mediaType,
              caption: item.caption,
              parseMode: item.parseMode,
            })),
            caption: batchIndex === 0 ? socialContent.caption : "",
            parseMode: batchIndex === 0 ? socialContent.parseMode : null,
          });
        } catch (error) {
          result = {
            ok: false,
            description: `Unexpected exception while sending media group: ${getErrorMessage(error)}`,
          };
        }

        deliveries.push({
          requestedChatId: chatId,
          batchIndex,
          itemOffset,
          itemCount: batch.length,
          result,
        });
        itemOffset += batch.length;

        // Once a chunk failed, continuing would create more orphaned album
        // chunks that cannot be represented as one successful channel delivery.
        if (!result.ok) break;
      }
    }

    const formatted = deliveries.map((delivery) => ({
      requestedChatId: delivery.requestedChatId,
      batchIndex: delivery.batchIndex,
      itemOffset: delivery.itemOffset,
      itemCount: delivery.itemCount,
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
        metadata: socialContent.metadata,
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
      metadata: socialContent.metadata,
      socialMetadata: socialContent.social,
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
