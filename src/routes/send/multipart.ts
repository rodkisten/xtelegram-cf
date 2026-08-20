import { persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import { mapWithConcurrency } from "../../lib/concurrency";
import {
  debugChannelSummary,
  debugError,
  relayDebug,
  relayTraceId,
} from "../../lib/debug";
import { resolveMaxMediaBytes } from "../../media";
import {
  parseTelegramDestination,
  resolveTelegramChatIdsForEnv,
} from "../../services/channels";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
} from "../../services/delivery-plan";
import { getTelegramMethodName } from "../../services/telegram-delivery";
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
import { sendTelegramUpload } from "../../telegram";
import type { Env, MediaType, TelegramApiResult, TelegramMessage } from "../../types";
import {
  normalizeCaption,
  normalizeMediaType,
  normalizeMetadata,
  normalizeParseMode,
  normalizeTelegramChannels,
  normalizeRoutingUsernames,
  resolvePayloadCaption,
  resolveOriginalSourceUrl,
} from "../../validation/common";
import {
  buildMultipartIdentityInput,
  collectFormFieldNames,
  collectUploadedFiles,
  inferUploadedContentType,
  resolveMultipartMaxTotalBytes,
  sanitizeUploadedFilename,
  type MultipartPayload,
} from "./multipart-utils";

interface MultipartDelivery {
  fileIndex: number;
  field: string;
  filename: string;
  contentType: string;
  size: number;
  mediaType: MediaType;
  requestedChatId: string;
  result: TelegramApiResult<TelegramMessage>;
}

export async function handleMultipartSend(request: Request, env: Env): Promise<Response> {
  const traceId = relayTraceId(request);
  relayDebug(env, traceId, "multipart.started", {
    contentType: request.headers.get("Content-Type") || null,
  });
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    relayDebug(env, traceId, "multipart.parse-failed", { error: debugError(error) });
    return json(
      {
        ok: false,
        error: "Could not parse multipart/form-data request.",
        stage: "parse-multipart",
        details: {
          reason: getErrorMessage(error),
          contentType: request.headers.get("Content-Type"),
          expectedFields: [
            "payload: JSON string",
            "file: one or more photo/video/audio/document files",
            "files: optional repeated file field",
            "audioFile: optional separate audio track",
          ],
        },
      },
      400,
    );
  }

  const payloadResult = parseMultipartPayload(form);
  if (!payloadResult.ok) {
    relayDebug(env, traceId, "multipart.payload-invalid", {});
    return payloadResult.response;
  }
  const payload = payloadResult.payload;

  const channelValidation = normalizeTelegramChannels(payload.channel, payload.channels);
  if (!channelValidation.ok) {
    relayDebug(env, traceId, "multipart.invalid-channels", { error: channelValidation.error });
    return json(
      {
        ok: false,
        error: channelValidation.error,
        stage: "validate-channels",
        details: {
          channel: payload.channel ?? null,
          channels: payload.channels ?? null,
        },
      },
      400,
    );
  }

  const usernameValidation = normalizeRoutingUsernames(payload.username, payload.usernames);
  if (!usernameValidation.ok) {
    relayDebug(env, traceId, "multipart.invalid-usernames", { error: usernameValidation.error });
    return json({ ok: false, error: usernameValidation.error, stage: "validate-usernames" }, 400);
  }

  const chatIds = resolveTelegramChatIdsForEnv(env, channelValidation.value, usernameValidation.value);
  if (!chatIds.length) {
    relayDebug(env, traceId, "multipart.no-channels", {});
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided.",
        stage: "validate-channels",
        details: {
          hint: "Send channel/channels or username/usernames inside payload, configure TELEGRAM_USERNAME_CHANNEL_MAP_JSON, or configure TELEGRAM_CHAT_ID.",
        },
      },
      400,
    );
  }

  const parseMode = normalizeParseMode(payload.parseMode);
  if (payload.parseMode && !parseMode) {
    relayDebug(env, traceId, "multipart.invalid-parse-mode", { parseMode: String(payload.parseMode) });
    return json(
      {
        ok: false,
        error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
        stage: "validate-payload",
        details: { received: payload.parseMode },
      },
      400,
    );
  }

  const requestedMediaType = normalizeMediaType(payload.mediaType);
  if (payload.mediaType && !requestedMediaType) {
    relayDebug(env, traceId, "multipart.invalid-media-type", { mediaType: String(payload.mediaType) });
    return json(
      {
        ok: false,
        error: "Invalid mediaType. Use photo, video, audio, or document",
        stage: "validate-payload",
        details: { received: payload.mediaType },
      },
      400,
    );
  }

  const uploadedFiles = collectUploadedFiles(form, requestedMediaType);
  if (!uploadedFiles.length) {
    relayDebug(env, traceId, "multipart.no-files", { fields: collectFormFieldNames(form) });
    return json(
      {
        ok: false,
        error: "Multipart request did not contain any non-empty files.",
        stage: "validate-files",
        details: {
          receivedFields: collectFormFieldNames(form),
          acceptedFileFields: ["file", "files", "audioFile", "any repeated File field"],
          hint: "Append one or more File/Blob values to FormData. Example: form.append('file', blob, 'video.mp4').",
        },
      },
      400,
    );
  }

  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const oversized = uploadedFiles.filter(({ file }) => file.size > maxMediaBytes);
  if (oversized.length) {
    relayDebug(env, traceId, "multipart.file-too-large", {
      fileCount: oversized.length,
      maxMediaBytes,
    });
    return json(
      {
        ok: false,
        error: "One or more uploaded files exceed the configured Worker upload limit.",
        stage: "validate-files",
        details: {
          maxMediaBytes,
          files: oversized.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        },
      },
      413,
    );
  }

  const multipartTotalBytes = uploadedFiles.reduce((sum, entry) => sum + entry.file.size, 0);
  const multipartMaxTotalBytes = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes,
  );
  if (multipartTotalBytes > multipartMaxTotalBytes) {
    relayDebug(env, traceId, "multipart.total-too-large", {
      multipartTotalBytes,
      multipartMaxTotalBytes,
    });
    return json(
      {
        ok: false,
        error: "The combined multipart file size exceeds the safe per-request forwarding budget.",
        stage: "validate-files",
        details: {
          multipartTotalBytes,
          multipartMaxTotalBytes,
          recommendation: "Send one file per POST and wait for the response before sending the next file.",
          files: uploadedFiles.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        },
      },
      413,
    );
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    relayDebug(env, traceId, "multipart.database-unavailable", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  let plan;
  try {
    plan = await createDeliveryPlan({
      db,
      env,
      channels: chatIds,
      force: payload.force === true,
      identityInput: buildMultipartIdentityInput(payload),
    });
  } catch (error) {
    relayDebug(env, traceId, "multipart.delivery-plan-failed", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  relayDebug(env, traceId, "multipart.delivery-plan-ready", {
    fileCount: uploadedFiles.length,
    totalBytes: multipartTotalBytes,
    channelsToSend: plan.channelsToSend.length,
    alreadySent: plan.skippedAlreadySent.length,
    inProgress: plan.skippedInProgress.length,
  });

  if (!plan.channelsToSend.length) {
    relayDebug(env, traceId, "multipart.delivery-conflict", {
      channels: debugChannelSummary(buildDeliveryConflict(plan).channels),
    });
    return json(buildDeliveryConflict(plan), 409);
  }

  try {
    relayDebug(env, traceId, "multipart.social-metadata.started", {});
    const baseMetadata = normalizeMetadata(payload.metadata);
    const socialContent = await resolveSocialDeliveryContent({
      provider: payload.provider || null,
      sourceUrl: resolveOriginalSourceUrl(payload as Record<string, unknown>),
      pageUrl: payload.pageUrl || null,
      caption: resolvePayloadCaption(payload as Record<string, unknown>),
      captionExplicit: Boolean(normalizeCaption(payload.caption)),
      parseMode,
      metadata: baseMetadata,
    }, env);
    relayDebug(env, traceId, "multipart.social-metadata.completed", {
      captionLength: socialContent.caption.length,
      socialMetadataStrategy: socialContent.social?.strategy || null,
    });
    const caption = socialContent.caption;
    relayDebug(env, traceId, "multipart.telegram.started", {
      fileCount: uploadedFiles.length,
      channelCount: plan.channelsToSend.length,
    });

    // Preserve file order inside each destination, but destinations are
    // independent after the D1 claims are acquired. Sending two channels at a
    // time removes avoidable cross-channel latency without multiplying the
    // uploaded file across an unbounded number of concurrent requests.
    const processChannel = async (destinationKey: string): Promise<MultipartDelivery[]> => {
      const destination = parseTelegramDestination(destinationKey);
      if (!destination) return [];

      const channelDeliveries: MultipartDelivery[] = [];

      for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex += 1) {
        const uploaded = uploadedFiles[fileIndex]!;
        let result: TelegramApiResult<TelegramMessage>;
        try {
          result = await sendTelegramUpload({
            botToken: env.TELEGRAM_BOT_TOKEN,
            chatId: destination.chatId,
            messageThreadId: destination.messageThreadId,
            file: uploaded.file,
            filename: sanitizeUploadedFilename(uploaded.file.name, fileIndex),
            contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
            mediaType: uploaded.mediaType,
            caption: fileIndex === 0 ? caption : "",
            parseMode: fileIndex === 0 ? socialContent.parseMode : null,
          });
        } catch (error) {
          result = {
            ok: false,
            description: `Unexpected exception while forwarding uploaded file: ${getErrorMessage(error)}`,
          };
        }

        channelDeliveries.push({
          fileIndex,
          field: uploaded.field,
          filename: uploaded.file.name,
          contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
          size: uploaded.file.size,
          mediaType: uploaded.mediaType,
          requestedChatId: destination.key,
          result,
        });

        relayDebug(env, traceId, "multipart.telegram-file.completed", {
          fileIndex,
          mediaType: uploaded.mediaType,
          ok: result.ok,
          httpStatus: result.httpStatus || null,
          error: result.ok ? null : result.description || null,
        });

        if (!result.ok) break;
      }

      return channelDeliveries;
    };

    const channelConcurrency = Math.min(2, plan.channelsToSend.length);
    const deliveriesByChannel = await mapWithConcurrency(
      plan.channelsToSend,
      channelConcurrency,
      processChannel,
    );
    const deliveries = deliveriesByChannel.flat();
    const failed = deliveries.filter((entry) => !entry.result.ok);
    const succeeded = deliveries.filter((entry) => entry.result.ok);
    const completedChannels = plan.channelsToSend.filter((chatId) => {
      const channelDeliveries = deliveries.filter((entry) => entry.requestedChatId === chatId);
      return (
        channelDeliveries.length === uploadedFiles.length &&
        channelDeliveries.every((entry) => entry.result.ok)
      );
    });
    const channelsWithAnySuccess = new Set(
      succeeded.map((entry) => entry.requestedChatId),
    );
    retainSuccessfulClaimsUntilPersistence(plan, channelsWithAnySuccess);

    relayDebug(env, traceId, "multipart.telegram.completed", {
      attempted: deliveries.length,
      succeeded: succeeded.length,
      failed: failed.length,
      completedChannelCount: completedChannels.length,
    });

    const failedChannels = plan.channelsToSend
      .filter((chatId) => !completedChannels.includes(chatId))
      .map((channelId) => {
        const channelDeliveries = deliveries.filter((entry) => entry.requestedChatId === channelId);
        return {
          channelId,
          reason: "telegram_error" as const,
          partialDelivery: channelDeliveries.some((entry) => entry.result.ok),
          errors: channelDeliveries
            .filter((entry) => !entry.result.ok)
            .map((entry) => ({
              fileIndex: entry.fileIndex,
              error: entry.result.description || "Telegram rejected uploaded media",
              httpStatus: entry.result.httpStatus ?? null,
            })),
        };
      });

    let insertedChannelIds: string[] = [];
    try {
      relayDebug(env, traceId, "multipart.persist.started", {
        completedChannelCount: completedChannels.length,
      });
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: resolveOriginalSourceUrl(payload as Record<string, unknown>),
        pageUrl: payload.pageUrl || null,
        mediaType: uploadedFiles.length > 1 ? "album" : uploadedFiles[0]!.mediaType,
        mediaCount: uploadedFiles.length,
        metadata: socialContent.metadata,
        caption: socialContent.caption,
        parseMode: socialContent.parseMode,
        mediaStatus: "sent",
        deliveries: completedChannels.map((chatId) => {
          const messages = deliveries
            .filter((entry) => entry.requestedChatId === chatId && entry.result.ok)
            .map((entry) => entry.result.result)
            .filter((message): message is TelegramMessage => Boolean(message));
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
      relayDebug(env, traceId, "multipart.persist.failed", {
        identityKey: plan.identity.key,
        error: debugError(error),
      });
      return json(
        {
          ok: false,
          error: getErrorMessage(error),
          stage: "persist-delivery",
          warning:
            "Telegram accepted one or more uploaded files but D1 history could not be fully committed. Claims for channels with external side effects are retained until TTL.",
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

    relayDebug(env, traceId, "multipart.persist.completed", {
      insertedChannelCount: insertedChannelIds.length,
    });

    const notSent = [
      ...plan.skippedAlreadySent,
      ...plan.skippedInProgress,
      ...failedChannels,
    ];
    const formattedDeliveries = deliveries.map((entry) => ({
      fileIndex: entry.fileIndex,
      field: entry.field,
      filename: entry.filename,
      contentType: entry.contentType,
      size: entry.size,
      mediaType: entry.mediaType,
      requestedChatId: entry.requestedChatId,
      ok: entry.result.ok,
      telegramMethod: entry.result.requestMethod || getTelegramMethodName(entry.mediaType),
      httpStatus: entry.result.httpStatus ?? null,
      telegramErrorCode: entry.result.error_code ?? null,
      description: entry.result.description ?? null,
      parameters: entry.result.parameters ?? null,
      rawResponse: entry.result.rawResponse ?? null,
      messageId: entry.result.result?.message_id ?? null,
      chatId: entry.result.result?.chat?.id ?? null,
      chatTitle: entry.result.result?.chat?.title ?? null,
    }));
    const multipartMetrics = {
      identityAliasQueries: plan.identityAliasQueries,
      claimQueries: plan.claim.queryCount,
      claimedChannels: plan.channelsToSend.length,
      telegramAttempts: deliveries.length,
      successfulTelegramAttempts: succeeded.length,
      mediaResolutions: 0,
      dbRoundTrips:
        plan.identityAliasQueries + 1 + (completedChannels.length ? 1 : 0) + 1,
      dbStatements:
        plan.identityAliasQueries +
        plan.claim.queryCount +
        (completedChannels.length ? 1 + completedChannels.length : 0) +
        1,
    };
    const files = uploadedFiles.map(({ field, file, mediaType }, index) => ({
      index,
      field,
      filename: file.name,
      contentType: file.type || inferUploadedContentType(file.name),
      size: file.size,
      mediaType,
    }));

    if (failed.length) {
      relayDebug(env, traceId, "multipart.completed-with-failures", {
        status: completedChannels.length > 0 ? 207 : 502,
        failedCount: failed.length,
        channels: debugChannelSummary({
          requested: chatIds,
          attempted: plan.channelsToSend,
          inserted: insertedChannelIds,
          notSent,
        }),
      });

      return json(
        {
          ok: completedChannels.length > 0,
          partial: completedChannels.length > 0,
          error:
            completedChannels.length > 0
              ? `${failed.length} Telegram delivery attempt(s) failed; some channels completed successfully.`
              : "No Telegram channel received the complete multipart media set.",
          stage: "telegram-forward",
          summary: {
            filesReceived: uploadedFiles.length,
            channelsRequested: chatIds.length,
            channelsCompleted: completedChannels.length,
            deliveriesAttempted: deliveries.length,
            deliveriesSucceeded: succeeded.length,
            deliveriesFailed: failed.length,
          },
          files,
          media: plan.identity,
          channels: {
            requested: chatIds,
            attempted: plan.channelsToSend,
            inserted: insertedChannelIds,
            notSent,
          },
          telegram: { deliveries: formattedDeliveries },
          payload,
          metadata: socialContent.metadata,
          socialMetadata: socialContent.social,
          metrics: multipartMetrics,
        },
        completedChannels.length > 0 ? 207 : 502,
      );
    }

    relayDebug(env, traceId, "multipart.completed", {
      status: 200,
      channels: debugChannelSummary({
        requested: chatIds,
        attempted: plan.channelsToSend,
        inserted: insertedChannelIds,
        notSent,
      }),
    });
    return json({
      ok: true,
      message:
        uploadedFiles.length === 1
          ? "Uploaded file forwarded to Telegram"
          : `${uploadedFiles.length} uploaded files forwarded to Telegram`,
      mode: "multipart-file-forward",
      summary: {
        filesReceived: uploadedFiles.length,
        channelsRequested: chatIds.length,
        channelsCompleted: completedChannels.length,
        deliveriesAttempted: deliveries.length,
        deliveriesSucceeded: succeeded.length,
        deliveriesFailed: 0,
      },
      files,
      media: plan.identity,
      channels: {
        requested: chatIds,
        attempted: plan.channelsToSend,
        inserted: insertedChannelIds,
        notSent,
      },
      telegram: { deliveries: formattedDeliveries },
      payload,
      metadata: socialContent.metadata,
      socialMetadata: socialContent.social,
      metrics: multipartMetrics,
    });
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      relayDebug(env, traceId, "multipart.claim-release.failed", {
        identityKey: plan.identity.key,
        error: debugError(error),
      });
    });
    relayDebug(env, traceId, "multipart.claim-release.completed", { identityKey: plan.identity.key });
  }
}

function parseMultipartPayload(
  form: FormData,
): { ok: true; payload: MultipartPayload } | { ok: false; response: Response } {
  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string" || !rawPayload.trim()) {
    return { ok: true, payload: {} };
  }

  try {
    const parsed = JSON.parse(rawPayload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must decode to a JSON object");
    }
    return { ok: true, payload: parsed as MultipartPayload };
  } catch (error) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "Invalid JSON in multipart payload field.",
          stage: "parse-payload",
          details: {
            reason: getErrorMessage(error),
            payloadPreview: rawPayload.slice(0, 2000),
          },
        },
        400,
      ),
    };
  }
}
