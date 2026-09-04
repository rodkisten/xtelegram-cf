import { findContentDuplicateMatches, persistKnownMedia, persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import {
  inferTelegramMediaType,
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
  resolveWorkerBufferedMediaBytes,
  resolveWorkerHlsBufferedMediaBytes,
} from "../../media";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import { buildLimitExceededPayload, isRelayLimitExceededError } from "../../lib/limit-error";
import {
  debugChannelSummary,
  debugError,
  debugUrl,
  relayDebug,
  relayTraceId,
} from "../../lib/debug";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  getAlreadySentDeliveryDetails,
  applyContentDuplicateMatches,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
} from "../../services/delivery-plan";
import {
  resolveTelegramChatIdsForEnv,
} from "../../services/channels";
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
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
  const traceId = relayTraceId(request);
  relayDebug(env, traceId, "single.started", {
    provider: input.provider || null,
    mediaType: input.mediaType || null,
    mediaUrl: debugUrl(input.mediaUrl.href),
    sourceUrl: debugUrl(input.sourceUrl),
    requestedChannelCount: input.channels.length,
    routingUsernames: input.usernames,
    force: input.force,
    forceCpu: input.forceCpu,
    hasMediaHeaders: Object.keys(input.mediaHeaders || {}).length > 0,
  });
  const chatIds = resolveTelegramChatIdsForEnv(env, input.channels, input.usernames);

  if (!chatIds.length) {
    relayDebug(env, traceId, "single.no-channels", {});
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
    relayDebug(env, traceId, "single.database-unavailable", { error: debugError(error) });
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
    relayDebug(env, traceId, "single.delivery-plan-failed", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  relayDebug(env, traceId, "single.delivery-plan-ready", {
    identityKey: plan.identity.key,
    identityProvider: plan.identity.provider,
    identityMediaId: plan.identity.providerMediaId,
    identityCanonicalUrl: debugUrl(plan.identity.canonicalUrl),
    requestedChannelCount: plan.requestedChannels.length,
    channelsToSend: plan.channelsToSend.length,
    alreadySent: plan.skippedAlreadySent.length,
    inProgress: plan.skippedInProgress.length,
    claimQueries: plan.claim.queryCount,
  });

  if (!plan.channelsToSend.length) {
    relayDebug(env, traceId, "single.delivery-conflict", {
      channels: debugChannelSummary(buildDeliveryConflict(plan).channels),
    });
    return json(buildDeliveryConflict(plan), 409);
  }

  try {
    const configuredMaxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
    const maxMediaBytes = Math.min(
      configuredMaxMediaBytes,
      resolveWorkerBufferedMediaBytes(env.WORKER_BUFFERED_MEDIA_BYTES),
    );
    const concurrency = resolveConcurrency(env.HLS_CONCURRENCY);
    const hlsMaxMediaBytes = Math.min(
      resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
      resolveWorkerHlsBufferedMediaBytes(env.WORKER_HLS_BUFFERED_MEDIA_BYTES),
    );
    let prepared: PreparedMedia;

    const prepareStartedAt = Date.now();
    const socialStartedAt = Date.now();

    // Media preparation and social metadata enrichment have no data dependency:
    // both only need the validated input. Start them together so network latency
    // is overlapped instead of paying for two sequential pipelines.
    relayDebug(env, traceId, "single.prepare-media.started", {
      mediaUrl: debugUrl(input.mediaUrl.href),
      maxMediaBytes,
      hlsMaxMediaBytes,
      concurrency,
    });
    relayDebug(env, traceId, "single.social-metadata.started", {
      provider: input.provider || null,
      hasCaption: Boolean(input.caption),
    });

    const preparePromise = prepareMedia(input, {
      maxMediaBytes,
      hlsMaxMediaBytes,
      concurrency,
      signal: request.signal,
      twirrlVersionToken: env.TWIRRL_VERSION_TOKEN,
      allowCpuHeavy: input.forceCpu,
    });

    const socialPromise = resolveSocialDeliveryContent({
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      caption: input.caption,
      captionExplicit: input.captionExplicit,
      parseMode: input.parseMode,
      metadata: input.metadata,
    }, env);

    let socialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>>;

    try {
      [prepared, socialContent] = await Promise.all([preparePromise, socialPromise]);
      relayDebug(env, traceId, "single.prepare-media.succeeded", {
        durationMs: Date.now() - prepareStartedAt,
      });
      relayDebug(env, traceId, "single.social-metadata.completed", {
        durationMs: Date.now() - socialStartedAt,
        parseMode: socialContent.parseMode || null,
        captionLength: socialContent.caption.length,
        metadataKeys: Object.keys(socialContent.metadata || {}).slice(0, 24),
        socialMetadataStrategy: socialContent.social?.strategy || null,
      });
    } catch (error) {
      // Promise.all reports the first rejection. The error is classified below
      // using the independently observed promise states so callers retain the
      // existing stage-specific API instead of receiving a generic failure.
      const [prepareResult, socialResult] = await Promise.allSettled([preparePromise, socialPromise]);

      if (prepareResult.status === "rejected") {
        relayDebug(env, traceId, "single.prepare-media.failed", {
          mediaUrl: debugUrl(input.mediaUrl.href),
          durationMs: Date.now() - prepareStartedAt,
          error: debugError(prepareResult.reason),
        });

        if (isRelayLimitExceededError(prepareResult.reason)) {
          return json(
            {
              ...buildLimitExceededPayload(prepareResult.reason, {
                sourceUrl: input.sourceUrl,
                inputUrl: input.mediaUrl.href,
                mediaType: input.mediaType,
              }),
              forceCpu: input.forceCpu,
              channels: chatIds,
              metadata: input.metadata,
            },
            prepareResult.reason.details.kind === "cpu_heavy_disabled" ? 422 : 413,
          );
        }

        return json(
          {
            ok: false,
            error: getErrorMessage(prepareResult.reason),
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

      if (socialResult.status === "rejected") {
        relayDebug(env, traceId, "single.social-metadata.failed", {
          durationMs: Date.now() - socialStartedAt,
          error: debugError(socialResult.reason),
        });
        // Social enrichment normally handles provider failures internally, but
        // preserve a deterministic fallback if a future implementation throws.
        socialContent = {
          caption: input.sourceUrl || input.mediaUrl.href,
          parseMode: null,
          metadata: input.metadata,
          social: null,
        };
      } else {
        socialContent = socialResult.value;
      }

      // A rejected preparation returns above, so the remaining branch is
      // necessarily fulfilled and TypeScript can safely narrow the result.
      prepared = prepareResult.value;
    }

    const mediaType =
      input.mediaType ||
      (prepared.type === "file"
        ? inferTelegramMediaType(prepared.url, prepared.contentType)
        : prepared.mediaType);
    const delivery = prepared.type === "file" ? "telegram-url" : "multipart-upload";

    relayDebug(env, traceId, "single.prepare-media.succeeded", {
      inputUrl: debugUrl(input.mediaUrl.href),
      sourceUrl: debugUrl(input.sourceUrl),
      delivery,
      mediaType,
      resolvedUrl: debugUrl(prepared.type === "file" ? prepared.url : prepared.sourceUrl),
      selectedBitrate: prepared.selectedBitrate,
      selectedResolution: prepared.selectedResolution,
      videoWidth: prepared.videoMetadata?.width ?? null,
      videoHeight: prepared.videoMetadata?.height ?? null,
      videoRotation: prepared.videoMetadata?.rotation ?? null,
      playlistDepth: prepared.playlistDepth,
      size: prepared.type === "file" ? prepared.contentLength : prepared.bytes.byteLength,
      hls: prepared.type === "file" ? false : prepared.hls,
      remuxed: prepared.type === "file" ? false : prepared.remuxed,
      channelsToSend: plan.channelsToSend.length,
    });

    if (
      !input.force &&
      input.forceCpu &&
      prepared.type === "upload" &&
      mediaType === "video" &&
      Boolean(prepared.mediaSha256 || prepared.mediaFingerprint)
    ) {
      const contentMatches = await findContentDuplicateMatches(
        db,
        {
          mediaKey: plan.identity.key,
          sha256: prepared.mediaSha256,
          fingerprint: prepared.mediaFingerprint,
          fingerprintVersion: prepared.mediaFingerprintVersion,
          byteLength: prepared.mediaByteLength,
          width: prepared.videoMetadata?.width,
          height: prepared.videoMetadata?.height,
        },
        plan.channelsToSend,
      );
      applyContentDuplicateMatches(plan, contentMatches);

      relayDebug(env, traceId, "single.content-dedup.completed", {
        exactHash: Boolean(prepared.mediaSha256),
        candidateCount: contentMatches.length,
        duplicateChannels: plan.skippedContentDuplicates.map((entry) => entry.channelId),
      });

      if (!plan.channelsToSend.length) {
        return json(buildDeliveryConflict(plan, "Media"), 409);
      }
    }

    // Persist the resolved media independently from Telegram. If delivery fails
    // after this point, a later request can resume from a durable `ready` row.
    await persistKnownMedia(db, {
      identity: plan.identity,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      mediaType,
      mediaCount: 1,
      metadata: socialContent.metadata,
      caption: socialContent.caption || null,
      parseMode: socialContent.parseMode,
      resolvedMediaUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
      mediaStatus: "ready",
      mediaSha256: prepared.type === "upload" ? prepared.mediaSha256 : null,
      mediaFingerprint: prepared.type === "upload" ? prepared.mediaFingerprint : null,
      mediaFingerprintVersion: prepared.type === "upload" ? prepared.mediaFingerprintVersion : null,
      mediaByteLength: prepared.type === "upload" ? prepared.mediaByteLength : null,
      mediaWidth: prepared.videoMetadata?.width ?? null,
      mediaHeight: prepared.videoMetadata?.height ?? null,
    });

    relayDebug(env, traceId, "single.telegram.started", {
      delivery,
      mediaType,
      channelCount: plan.channelsToSend.length,
    });
    const deliveries = await sendPreparedMediaToChats({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatIds: plan.channelsToSend,
      prepared,
      mediaType,
      caption: socialContent.caption,
      parseMode: socialContent.parseMode,
    });
    const failedDeliveries = deliveries.filter((entry) => !entry.result.ok);
    const successfulDeliveries = deliveries.filter((entry) => entry.result.ok);

    relayDebug(env, traceId, "single.telegram.completed", {
      attempted: deliveries.length,
      succeeded: successfulDeliveries.length,
      failed: failedDeliveries.length,
      failures: failedDeliveries.map((entry) => ({
        httpStatus: entry.result.httpStatus || null,
        error: entry.result.description || "Telegram rejected media",
      })),
    });

    retainSuccessfulClaimsUntilPersistence(
      plan,
      successfulDeliveries.map((entry) => entry.requestedChatId),
    );

    let insertedChannelIds: string[] = [];
    try {
      relayDebug(env, traceId, "single.persist.started", {
        successfulTelegramDeliveries: successfulDeliveries.length,
      });
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType,
        mediaCount: 1,
        metadata: socialContent.metadata,
        caption: socialContent.caption,
        parseMode: socialContent.parseMode,
        resolvedMediaUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
        mediaStatus: "sent",
        mediaSha256: prepared.type === "upload" ? prepared.mediaSha256 : null,
        mediaFingerprint: prepared.type === "upload" ? prepared.mediaFingerprint : null,
        mediaFingerprintVersion: prepared.type === "upload" ? prepared.mediaFingerprintVersion : null,
        mediaByteLength: prepared.type === "upload" ? prepared.mediaByteLength : null,
        mediaWidth: prepared.videoMetadata?.width ?? null,
        mediaHeight: prepared.videoMetadata?.height ?? null,
        deliveries: successfulDeliveries.map((entry) => ({
          requestedChatId: entry.requestedChatId,
          telegramChatId: entry.result.result?.chat?.id ?? null,
          telegramChatTitle: entry.result.result?.chat?.title ?? null,
          messageIds: [entry.result.result?.message_id ?? null],
        })),
      });
      markChannelsPersisted(plan, insertedChannelIds);
    } catch (error) {
      relayDebug(env, traceId, "single.persist.failed", {
        identityKey: plan.identity.key,
        successfulTelegramDeliveries: successfulDeliveries.length,
        error: debugError(error),
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

    relayDebug(env, traceId, "single.persist.completed", {
      insertedChannelCount: insertedChannelIds.length,
    });

    const failedChannels = failedDeliveries.map((entry) => ({
      channelId: entry.requestedChatId,
      reason: "telegram_error" as const,
      error: entry.result.description || "Telegram rejected the media request",
      httpStatus: entry.result.httpStatus ?? null,
    }));
    const notSent = [
      ...plan.skippedAlreadySent,
      ...plan.skippedContentDuplicates,
      ...plan.skippedInProgress,
      ...failedChannels,
    ];
    const firstMessage = successfulDeliveries[0]?.result.result;
    const payload = {
      ok: successfulDeliveries.length > 0,
      partial: notSent.length > 0,
      conflict:
        successfulDeliveries.length === 0 &&
        (plan.skippedAlreadySent.length > 0 || plan.skippedContentDuplicates.length > 0),
      message:
        successfulDeliveries.length > 0
          ? `Media sent to ${successfulDeliveries.length} Telegram channel(s)`
          : "Media was not sent to Telegram",
      media: plan.identity,
      contentIdentity: prepared.type === "upload" && prepared.mediaSha256
        ? {
            sha256: prepared.mediaSha256,
            fingerprint: prepared.mediaFingerprint,
            fingerprintVersion: prepared.mediaFingerprintVersion,
            byteLength: prepared.mediaByteLength,
          }
        : null,
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
      // Duplicate details come directly from the atomic D1 claim lookup, so the
      // client can show the exact Telegram message/channel that caused the skip.
      duplicates: getAlreadySentDeliveryDetails(plan),
      contentDuplicates: plan.contentDuplicates.map((match) => ({
        matchType: match.matchType,
        similarity: Number(match.similarity.toFixed(4)),
        mediaKey: match.mediaKey,
        provider: match.provider,
        sourceUrl: match.sourceUrl,
        pageUrl: match.pageUrl,
        mediaSha256: match.mediaSha256,
        mediaByteLength: match.mediaByteLength,
        deliveries: match.deliveries.map((delivery) => ({
          channelId: delivery.channelId,
          telegramChatId: delivery.telegramChatId,
          messageThreadId: delivery.messageThreadId,
          telegramChatTitle: delivery.telegramChatTitle,
          messageIds: delivery.lastMessageIds.length ? delivery.lastMessageIds : delivery.firstMessageIds,
          firstMessageIds: delivery.firstMessageIds,
          lastMessageIds: delivery.lastMessageIds,
          sendCount: delivery.sendCount,
          firstSentAt: delivery.firstSentAt,
          lastSentAt: delivery.lastSentAt,
        })),
      })),
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
      metadata: socialContent.metadata,
      socialMetadata: socialContent.social,
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
      relayDebug(env, traceId, "single.telegram-all-failed", {
        identityKey: plan.identity.key,
        channelSummary: debugChannelSummary(payload.channels),
        failureReasons: failedChannels.map((entry) => entry.reason),
      });
      return json(payload, 502);
    }

    relayDebug(env, traceId, "single.completed", {
      status: notSent.length ? 207 : 200,
      channelSummary: debugChannelSummary(payload.channels),
    });
    return json(payload, notSent.length ? 207 : 200);
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      relayDebug(env, traceId, "single.claim-release.failed", {
        identityKey: plan.identity.key,
        error: debugError(error),
      });
    });
    relayDebug(env, traceId, "single.claim-release.completed", {
      identityKey: plan.identity.key,
    });
  }
}
