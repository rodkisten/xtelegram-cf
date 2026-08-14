import { persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import {
  inferTelegramMediaType,
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
} from "../../media";
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
import {
  buildProcessingResult,
  formatTelegramDelivery,
  getTelegramMethodName,
  sendPreparedMediaToChats,
} from "../../services/telegram-delivery";
import type { Env, PreparedMedia, RelayInput } from "../../types";

export async function handleSingleSend(
  request: Request,
  input: RelayInput,
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
        mediaUrl: input.mediaUrl.href,
      },
    });
  } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  if (!plan.channelsToSend.length) {
    return json(buildDeliveryConflict(plan), 409);
  }

  try {
    const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
    const concurrency = resolveConcurrency(env.HLS_CONCURRENCY);
    const hlsMaxMediaBytes = resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES);
    let prepared: PreparedMedia;

    try {
      prepared = await prepareMedia(input, {
        maxMediaBytes,
        hlsMaxMediaBytes,
        concurrency,
        signal: request.signal,
      });
    } catch (error) {
      console.error("[media-relay] Failed to prepare media", {
        inputUrl: input.mediaUrl.href,
        sourceUrl: input.sourceUrl,
        channels: chatIds,
        error: getErrorMessage(error),
        metadata: input.metadata,
      });

      return json(
        {
          ok: false,
          error: getErrorMessage(error),
          stage: "prepare-media",
          source: {
            inputUrl: input.mediaUrl.href,
            sourceUrl: input.sourceUrl,
          },
          channels: chatIds,
          metadata: input.metadata,
        },
        422,
      );
    }

    const mediaType =
      input.mediaType ||
      (prepared.type === "file"
        ? inferTelegramMediaType(prepared.url, prepared.contentType)
        : prepared.mediaType);
    const delivery = prepared.type === "file" ? "telegram-url" : "multipart-upload";

    console.log("[media-relay] Sending media", {
      inputUrl: input.mediaUrl.href,
      sourceUrl: input.sourceUrl,
      channels: chatIds,
      delivery,
      mediaType,
      resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
      selectedBitrate: prepared.selectedBitrate,
      selectedResolution: prepared.selectedResolution,
      playlistDepth: prepared.playlistDepth,
      size: prepared.type === "file" ? prepared.contentLength : prepared.bytes.byteLength,
      hls: prepared.type === "file" ? false : prepared.hls,
      remuxed: prepared.type === "file" ? false : prepared.remuxed,
      metadata: input.metadata,
    });

    const deliveries = await sendPreparedMediaToChats({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatIds: plan.channelsToSend,
      prepared,
      mediaType,
      caption: input.caption,
      parseMode: input.parseMode,
    });
    const failedDeliveries = deliveries.filter((entry) => !entry.result.ok);
    const successfulDeliveries = deliveries.filter((entry) => entry.result.ok);

    retainSuccessfulClaimsUntilPersistence(
      plan,
      successfulDeliveries.map((entry) => entry.requestedChatId),
    );

    let insertedChannelIds: string[] = [];
    try {
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType,
        mediaCount: 1,
        metadata: input.metadata,
        deliveries: successfulDeliveries.map((entry) => ({
          requestedChatId: entry.requestedChatId,
          telegramChatId: entry.result.result?.chat?.id ?? null,
          telegramChatTitle: entry.result.result?.chat?.title ?? null,
          messageIds: [entry.result.result?.message_id ?? null],
        })),
      });
      markChannelsPersisted(plan, insertedChannelIds);
    } catch (error) {
      console.error("[media-relay] Telegram succeeded but D1 persistence failed", {
        media: plan.identity.key,
        successfulChannels: successfulDeliveries.map((entry) => entry.requestedChatId),
        error: getErrorMessage(error),
      });
      return json(
        {
          ok: false,
          error: getErrorMessage(error),
          stage: "persist-delivery",
          warning:
            "Telegram accepted one or more deliveries but their D1 history could not be committed. Successful delivery claims are retained until TTL to reduce duplicate retries.",
          media: plan.identity,
          channels: {
            requested: chatIds,
            attempted: plan.channelsToSend,
            inserted: [],
            telegramSucceeded: successfulDeliveries.map((entry) => entry.requestedChatId),
          },
        },
        500,
      );
    }

    const failedChannels = failedDeliveries.map((entry) => ({
      channelId: entry.requestedChatId,
      reason: "telegram_error" as const,
      error: entry.result.description || "Telegram rejected the media request",
      httpStatus: entry.result.httpStatus ?? null,
    }));
    const notSent = [
      ...plan.skippedAlreadySent,
      ...plan.skippedInProgress,
      ...failedChannels,
    ];
    const firstMessage = successfulDeliveries[0]?.result.result;
    const payload = {
      ok: successfulDeliveries.length > 0,
      partial: notSent.length > 0,
      conflict: successfulDeliveries.length === 0 && plan.skippedAlreadySent.length > 0,
      message:
        successfulDeliveries.length > 0
          ? `Media sent to ${successfulDeliveries.length} Telegram channel(s)`
          : "Media was not sent to Telegram",
      media: plan.identity,
      source: {
        inputUrl: input.mediaUrl.href,
        resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
        sourceUrl: input.sourceUrl,
      },
      channels: {
        requested: chatIds,
        attempted: plan.channelsToSend,
        inserted: insertedChannelIds,
        notSent,
      },
      resolution: {
        selectedBitrate: prepared.selectedBitrate,
        selectedResolution: prepared.selectedResolution,
        playlistDepth: prepared.playlistDepth,
      },
      processing: buildProcessingResult(prepared),
      telegram: {
        method: getTelegramMethodName(mediaType),
        messageId: firstMessage?.message_id ?? null,
        chatId: firstMessage?.chat?.id ?? null,
        chatTitle: firstMessage?.chat?.title ?? null,
        deliveries: deliveries.map(formatTelegramDelivery),
      },
      metadata: input.metadata,
      metrics: {
        identityAliasQueries: plan.identityAliasQueries,
        claimQueries: plan.claim.queryCount,
        claimedChannels: plan.channelsToSend.length,
        telegramAttempts: deliveries.length,
        successfulTelegramAttempts: successfulDeliveries.length,
        dbRoundTrips:
          plan.identityAliasQueries +
          1 +
          (successfulDeliveries.length ? 1 : 0) +
          1,
        dbStatements:
          plan.identityAliasQueries +
          plan.claim.queryCount +
          (successfulDeliveries.length ? 1 + successfulDeliveries.length : 0) +
          1,
      },
    };

    if (!successfulDeliveries.length) {
      console.error("[media-relay] Telegram rejected every attempted delivery", {
        media: plan.identity,
        notSent,
      });
      return json(payload, 502);
    }

    return json(payload, notSent.length ? 207 : 200);
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      console.error("[media-relay] Failed to release delivery claims", {
        media: plan.identity.key,
        error: getErrorMessage(error),
      });
    });
  }
}
