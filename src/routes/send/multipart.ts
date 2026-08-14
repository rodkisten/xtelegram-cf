import { persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import { resolveMaxMediaBytes } from "../../media";
import {
  resolveDefaultTelegramChatId,
  resolveTelegramChatIds,
} from "../../services/channels";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
} from "../../services/delivery-plan";
import { getTelegramMethodName } from "../../services/telegram-delivery";
import { sendTelegramUpload } from "../../telegram";
import type { Env, MediaType, TelegramApiResult, TelegramMessage } from "../../types";
import {
  normalizeMediaType,
  normalizeMetadata,
  normalizeParseMode,
  normalizeTelegramChannels,
  resolvePayloadCaption,
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
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
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
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.payload;

  const channelValidation = normalizeTelegramChannels(payload.channel, payload.channels);
  if (!channelValidation.ok) {
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

  const chatIds = resolveTelegramChatIds(
    channelValidation.value,
    resolveDefaultTelegramChatId(env),
  );
  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided.",
        stage: "validate-channels",
        details: {
          hint: "Send channel/channels inside payload or configure TELEGRAM_CHAT_ID.",
        },
      },
      400,
    );
  }

  const parseMode = normalizeParseMode(payload.parseMode);
  if (payload.parseMode && !parseMode) {
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
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  if (!plan.channelsToSend.length) {
    return json(buildDeliveryConflict(plan), 409);
  }

  try {
    const caption = resolvePayloadCaption(payload as Record<string, unknown>);
    const deliveries: MultipartDelivery[] = [];

    // Channel-first lets us stop a destination after its first failure instead
    // of creating even more partial side effects on the same Telegram chat.
    for (const chatId of plan.channelsToSend) {
      for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex += 1) {
        const uploaded = uploadedFiles[fileIndex]!;
        let result: TelegramApiResult<TelegramMessage>;
        try {
          result = await sendTelegramUpload({
            botToken: env.TELEGRAM_BOT_TOKEN,
            chatId,
            file: uploaded.file,
            filename: sanitizeUploadedFilename(uploaded.file.name, fileIndex),
            contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
            mediaType: uploaded.mediaType,
            caption: fileIndex === 0 ? caption : "",
            parseMode: fileIndex === 0 ? parseMode : null,
          });
        } catch (error) {
          result = {
            ok: false,
            description: `Unexpected exception while forwarding uploaded file: ${getErrorMessage(error)}`,
          };
        }

        deliveries.push({
          fileIndex,
          field: uploaded.field,
          filename: uploaded.file.name,
          contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
          size: uploaded.file.size,
          mediaType: uploaded.mediaType,
          requestedChatId: chatId,
          result,
        });

        if (!result.ok) break;
      }
    }

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
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: payload.sourceUrl || payload.pageUrl || null,
        pageUrl: payload.pageUrl || null,
        mediaType: uploadedFiles.length > 1 ? "album" : uploadedFiles[0]!.mediaType,
        mediaCount: uploadedFiles.length,
        metadata: normalizeMetadata(payload.metadata),
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
      console.error("[media-relay] Multipart Telegram delivery persisted incompletely", {
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
      console.error("[media-relay] Multipart forwarding partially or fully failed", {
        files,
        channels: chatIds,
        deliveries: formattedDeliveries,
        payload,
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
          metrics: multipartMetrics,
        },
        completedChannels.length > 0 ? 207 : 502,
      );
    }

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
      metrics: multipartMetrics,
    });
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      console.error("[media-relay] Failed to release multipart claims", {
        media: plan.identity.key,
        error: getErrorMessage(error),
      });
    });
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
