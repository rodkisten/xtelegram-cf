import { storedCaptionHasAccessNotice } from "../../lib/social-caption";
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
import {
  buildLimitExceededPayload,
  isRelayLimitExceededError,
  RelayLimitExceededError,
  resolveClientCompressionTargetBytes,
} from "../../lib/limit-error";
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
  getAlreadySentTelegramMessageLinkFields,
  applyContentDuplicateMatches,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
  type DeliveryPlan,
} from "../../services/delivery-plan";
import {
  resolveTelegramChatIdsForEnv,
} from "../../services/channels";
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
import { reconcileExistingMediaPresentation } from "../../services/presentation-reconciliation";
import {
  buildProcessingResult,
  formatTelegramDelivery,
  getTelegramMethodName,
  sendPreparedMediaToChats,
} from "../../services/telegram-delivery";
import type { Env, PreparedMedia, RelayInput } from "../../types";
import { buildTelegramMessageLinkFields } from "../../lib/telegram-message-links";
import { copyStoredTelegramDeliveries } from "../../services/telegram-forward";

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
    forceMode: input.forceMode,
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
        metadata: input.metadataProvided ? (reconciledSocialContent?.metadata ?? input.metadata) : null,
        metadataProvided: input.metadataProvided,
        caption: reconciledSocialContent?.caption ?? "",
        captionProvided,
        parseMode: reconciledSocialContent?.parseMode ?? null,
        mediaStatus: "sent",
      });

      relayDebug(env, traceId, "single.presentation-reconciled", presentationSync.summary);
    } catch (error) {
      relayDebug(env, traceId, "single.presentation-reconcile-failed", {
        error: debugError(error),
      });
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
          ? `Existing Telegram message presentation compared; ${presentationSync.summary.edited} message(s) edited.`
          : "Existing Telegram message presentation is already current.",
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

    relayDebug(env, traceId, "single.delivery-conflict", {
      channels: debugChannelSummary(buildDeliveryConflict(plan).channels),
    });
    return json(buildDeliveryConflict(plan), 409);
  }

  try {
    if (input.forceMode === "forward") {
      if (!socialPromise) {
        throw new Error("Internal error: social content promise was not initialized for force=forward.");
      }
      const socialContent = reconciledSocialContent || await socialPromise;
      return await handleSingleForwardCopy({
        input,
        env,
        db,
        plan,
        chatIds,
        socialContent,
        traceId,
      });
    }

    const configuredMaxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
    const maxMediaBytes = configuredMaxMediaBytes;
    const workerBufferedMaxBytes = resolveWorkerBufferedMediaBytes(
      env.WORKER_BUFFERED_MEDIA_BYTES,
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
      workerBufferedMaxBytes,
      hlsMaxMediaBytes,
      concurrency,
    });
    relayDebug(env, traceId, "single.social-metadata.started", {
      provider: input.provider || null,
      hasCaption: Boolean(input.caption),
    });

    const preparePromise = prepareMedia(input, {
      maxMediaBytes,
      workerBufferedMaxBytes,
      hlsMaxMediaBytes,
      concurrency,
      signal: request.signal,
      twirrlVersionToken: env.TWIRRL_VERSION_TOKEN,
      allowCpuHeavy: input.forceCpu,
    });

    let socialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>>;
    if (!socialPromise) {
      throw new Error("Internal error: social content promise was not initialized.");
    }

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
          const fallbackSocial = socialResult.status === "fulfilled"
            ? socialResult.value
            : {
                caption: input.caption || input.sourceUrl || input.mediaUrl.href,
                parseMode: input.parseMode,
                metadata: input.metadata,
              };
          const payload = buildLimitExceededPayload(prepareResult.reason, {
            sourceUrl: input.sourceUrl,
            inputUrl: input.mediaUrl.href,
            mediaType: input.mediaType,
            targetBytes: resolveClientCompressionTargetBytes(env.CLIENT_COMPRESS_TARGET_BYTES),
            mediaHeaders: input.mediaHeaders,
            variants: input.mediaVariants,
            caption: fallbackSocial.caption,
            parseMode: fallbackSocial.parseMode,
            provider: input.provider,
            mediaId: input.mediaId,
            mediaKey: plan.identity.key,
            hashtags: input.hashtags,
            channels: plan.channelsToSend,
            metadata: fallbackSocial.metadata,
          });
          return json(
            {
              ...payload,
              forceCpu: input.forceCpu,
              channels: chatIds,
              media: plan.identity,
              metadata: fallbackSocial.metadata,
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
    const delivery = prepared.type === "file"
      ? prepared.deliveryMode || "telegram-url"
      : "multipart-upload";

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
    const messageLinks = buildTelegramMessageLinkFields(
      successfulDeliveries.map((entry) => ({
        requestedChatId: entry.requestedChatId,
        telegramChatId: entry.result.result?.chat?.id ?? null,
        telegramUsername: entry.result.result?.chat?.username ?? null,
        messageThreadId: entry.result.result?.message_thread_id ?? null,
        messageId: entry.result.result?.message_id ?? null,
      })),
    );

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
        presentationMetadata: input.metadataProvided ? (input.presentationMetadata !== undefined ? input.presentationMetadata : input.metadata) : null,
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
          ...messageLinks,
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
      ...messageLinks,
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
      presentation: presentationSync?.summary ?? null,
      presentationResults: presentationSync?.results ?? [],
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

      const sizeFailure = failedDeliveries.find((entry) =>
        entry.result.httpStatus === 413 ||
        /(?:exceeds|above).*(?:limit|maximum)|too large/i.test(
          entry.result.description || "",
        ),
      );

      if (sizeFailure && prepared.type === "file") {
        const maximumBytes = prepared.streamMaxBytes || resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
        const limitError = new RelayLimitExceededError(
          sizeFailure.result.description || "Telegram delivery exceeded the upload limit.",
          {
            kind: "direct_media_bytes",
            stage: "telegram-delivery",
            limitBytes: maximumBytes,
            actualBytes: prepared.contentLength,
            resolvedMediaUrl: prepared.url,
            sourceUrl: input.sourceUrl,
            inputUrl: input.mediaUrl.href,
            mediaType,
            contentType: prepared.contentType,
          },
        );
        const fallback = buildLimitExceededPayload(limitError, {
          sourceUrl: input.sourceUrl,
          inputUrl: prepared.url,
          mediaType,
          targetBytes: resolveClientCompressionTargetBytes(env.CLIENT_COMPRESS_TARGET_BYTES),
          mediaHeaders: prepared.mediaHeaders,
          variants: input.mediaVariants,
          caption: socialContent.caption,
          parseMode: socialContent.parseMode,
          provider: input.provider,
          mediaId: input.mediaId,
          mediaKey: plan.identity.key,
          hashtags: input.hashtags,
          channels: plan.channelsToSend,
          metadata: socialContent.metadata,
        });
        return json({
          ...fallback,
          channels: payload.channels,
          telegram: payload.telegram,
          deliveryFailure: sizeFailure.result.description || null,
        }, 413);
      }

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


async function handleSingleForwardCopy(options: {
  input: RelayInput;
  env: Env;
  db: D1Database;
  plan: DeliveryPlan;
  chatIds: string[];
  socialContent: Awaited<ReturnType<typeof resolveSocialDeliveryContent>>;
  traceId: string;
}): Promise<Response> {
  const { input, env, db, plan, chatIds, socialContent, traceId } = options;
  relayDebug(env, traceId, "single.forward.started", {
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
      const mediaType = input.mediaType || inferTelegramMediaType(input.mediaUrl.href, "");
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType,
        mediaCount: 1,
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
      relayDebug(env, traceId, "single.forward.persist-failed", {
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
          "Telegram copied one or more stored messages but D1 history could not be committed. Claims are retained until TTL to reduce duplicate retries.",
        media: plan.identity,
        telegram: {
          method: "copyMessage/copyMessages",
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

  relayDebug(env, traceId, "single.forward.completed", {
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
      ? `Stored Telegram media copied as ${successfulDeliveries.length} new delivery(s) with the current caption.`
      : "No stored Telegram message could be copied for force=forward.",
    media: plan.identity,
    source: {
      inputUrl: input.mediaUrl.href,
      sourceUrl: input.sourceUrl,
    },
    channels: {
      requested: chatIds,
      attempted: plan.channelsToSend,
      inserted: insertedChannelIds,
      notSent,
    },
    telegram: {
      method: "copyMessage/copyMessages",
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
