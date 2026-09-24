import { sanitizeDeliveryCaption } from "../../lib/social-caption";
import {
  checkStoredMediaDeliveries,
  persistKnownMedia,
  persistSuccessfulDeliveries,
  requireRelayDb,
  resolveMediaIdentity,
  resolveStoredMediaIdentity,
} from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import { relayDebug, relayTraceId } from "../../lib/debug";
import { normalizePublicHttpUrl } from "../../lib/http";
import { buildTelegramMessageLinkFields } from "../../lib/telegram-message-links";
import { parseTelegramDestination } from "../../services/channels";
import {
  reconcileTelegramPresentation,
  summarizePresentationSync,
} from "../../services/media-presentation-sync";
import type { Env, MediaType, ParseMode } from "../../types";
import { normalizeMetadata, normalizeParseMode } from "../../validation/common";

interface RegisterBody {
  provider?: unknown;
  mediaId?: unknown;
  mediaKey?: unknown;
  sourceUrl?: unknown;
  pageUrl?: unknown;
  resolvedMediaUrl?: unknown;
  mediaType?: unknown;
  mediaByteLength?: unknown;
  mediaWidth?: unknown;
  mediaHeight?: unknown;
  caption?: unknown;
  parseMode?: unknown;
  metadata?: unknown;
  channel?: unknown;
  requestedChatId?: unknown;
  telegramChatId?: unknown;
  telegramChatTitle?: unknown;
  messageThreadId?: unknown;
  messageId?: unknown;
  messageIds?: unknown;
  telegramFileId?: unknown;
  telegramFileUniqueId?: unknown;
  compression?: unknown;
}

/**
 * Reconciles a Telegram delivery that happened outside the Worker.
 *
 * The iOS fallback uploads compressed bytes directly to Telegram so large files
 * never enter the Cloudflare isolate. This endpoint records the successful
 * Telegram message in the same D1 tables used by /send, preserving dedupe.
 */
export async function handleMediaRegister(request: Request, env: Env): Promise<Response> {
  const traceId = relayTraceId(request);
  let body: RegisterBody;
  try {
    body = await request.json() as RegisterBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const provider = cleanString(body.provider) || "generic";
  const mediaId = cleanString(body.mediaId);
  const mediaKey = cleanString(body.mediaKey);
  const sourceUrl = publicUrlOrNull(body.sourceUrl);
  const pageUrl = publicUrlOrNull(body.pageUrl);
  const resolvedMediaUrl = publicUrlOrNull(body.resolvedMediaUrl);
  const mediaType = normalizeMediaType(body.mediaType);
  const parseMode = normalizeOptionalParseMode(body.parseMode);
  const caption = sanitizeDeliveryCaption(cleanString(body.caption) || "", parseMode, sourceUrl || pageUrl);
  const customMetadata = normalizeMetadata(body.metadata);
  const metadataProvided = Object.prototype.hasOwnProperty.call(body, "metadata");
  const captionProvided = Object.prototype.hasOwnProperty.call(body, "caption");
  const metadata = {
    ...(customMetadata || {}),
    ...(cleanString(body.telegramFileId) ? { telegramFileId: cleanString(body.telegramFileId)! } : {}),
    ...(cleanString(body.telegramFileUniqueId)
      ? { telegramFileUniqueId: cleanString(body.telegramFileUniqueId)! }
      : {}),
    ...normalizeCompressionMetadata(body.compression),
    directClientUpload: "true",
  };

  const explicitChannel = cleanString(body.channel) || cleanString(body.requestedChatId);
  const telegramChatId = cleanString(body.telegramChatId);
  const messageThreadId = positiveInteger(body.messageThreadId);
  const synthesizedChannel = telegramChatId
    ? `${telegramChatId}${messageThreadId ? `:${messageThreadId}` : ""}`
    : null;
  const destination = parseTelegramDestination(explicitChannel || synthesizedChannel || "");
  if (!destination) {
    return json({ ok: false, error: "channel/requestedChatId or telegramChatId is required" }, 400);
  }

  if (telegramChatId && String(destination.chatId) !== telegramChatId) {
    return json({
      ok: false,
      error: "Telegram response chat id does not match the requested relay destination",
    }, 400);
  }
  if (
    messageThreadId &&
    destination.messageThreadId != null &&
    destination.messageThreadId !== messageThreadId
  ) {
    return json({ ok: false, error: "Telegram message_thread_id does not match channel" }, 400);
  }

  const messageIds = normalizeMessageIds(body.messageIds, body.messageId);
  if (!messageIds.length) {
    return json({ ok: false, error: "messageId/messageIds from Telegram is required" }, 400);
  }
  const messageLinks = buildTelegramMessageLinkFields(
    messageIds.map((messageId) => ({
      requestedChatId: destination.key,
      telegramChatId: telegramChatId || destination.chatId,
      messageThreadId: messageThreadId ?? destination.messageThreadId,
      messageId,
      single: messageIds.length > 1,
    })),
  );

  const identitySeed = sourceUrl || pageUrl || resolvedMediaUrl;
  if (!mediaKey && !mediaId && !identitySeed) {
    return json({
      ok: false,
      error: "mediaKey/mediaId or a stable sourceUrl/pageUrl/resolvedMediaUrl is required",
    }, 400);
  }

  try {
    const db = requireRelayDb(env);
    const resolvedIdentity = await resolveMediaIdentity({
      provider,
      mediaId,
      mediaKey,
      sourceUrl,
      pageUrl,
      mediaUrl: resolvedMediaUrl,
    });
    const identity = await resolveStoredMediaIdentity(db, resolvedIdentity);

    // Make registration retries idempotent. A Shortcut may rerun this tiny
    // reconciliation call after Telegram already accepted the video.
    const existing = await checkStoredMediaDeliveries(db, [identity], [destination.key]);
    const existingRecord = existing.get(identity.key) || [...existing.values()][0];
    const existingDelivery = existingRecord?.deliveries.find(
      (entry) => entry.channelId === destination.key,
    );
    const existingLastMessageIds = existingDelivery && Array.isArray(existingDelivery.lastMessageIds)
      ? existingDelivery.lastMessageIds.map(Number).filter(Number.isFinite)
      : [];
    const alreadyRegistered = Boolean(
      existingDelivery && messageIds.some((id) => existingLastMessageIds.includes(id)),
    );

    if (alreadyRegistered) {
      let presentationResults: Awaited<ReturnType<typeof reconcileTelegramPresentation>> = [];
      if ((captionProvided || metadataProvided) && existingRecord?.deliveries.length) {
        presentationResults = await reconcileTelegramPresentation({
          db,
          mediaKey: existingRecord.media.key || identity.key,
          botToken: env.TELEGRAM_BOT_TOKEN,
          caption,
          parseMode,
          captionProvided,
          metadata: customMetadata,
          metadataProvided,
          storedMedia: existingRecord.media,
          deliveries: existingRecord.deliveries.filter((entry) => entry.channelId === destination.key),
        });
        const summary = summarizePresentationSync(presentationResults);
        if (summary.changed > 0 && summary.failed === 0) await persistKnownMedia(db, {
          identity,
          sourceUrl,
          pageUrl,
          metadata: Object.keys(metadata).length ? metadata : null,
          caption: captionProvided ? caption || null : null,
          captionProvided,
          metadataProvided,
          parseMode: captionProvided ? parseMode : null,
          mediaStatus: "sent",
        });
      }
      const failed = summarizePresentationSync(presentationResults).failed;
      return json({
        ok: failed === 0,
        ...messageLinks,
        partial: failed > 0,
        alreadyRegistered: true,
        media: identity,
        channels: {
          requested: [destination.key],
          inserted: [],
          covered: [destination.key],
        },
        presentation: summarizePresentationSync(presentationResults),
        presentationResults,
        messageIds,
      }, failed ? 207 : 200);
    }

    const inserted = await persistSuccessfulDeliveries(db, {
      identity,
      sourceUrl,
      pageUrl,
      mediaType,
      mediaCount: 1,
      metadata: Object.keys(metadata).length ? metadata : null,
      presentationMetadata: metadataProvided ? customMetadata : null,
      caption,
      parseMode,
      resolvedMediaUrl,
      mediaStatus: "sent",
      mediaByteLength: positiveInteger(body.mediaByteLength),
      mediaWidth: positiveInteger(body.mediaWidth),
      mediaHeight: positiveInteger(body.mediaHeight),
      deliveries: [{
        requestedChatId: destination.key,
        telegramChatId: telegramChatId || destination.chatId,
        telegramChatTitle: cleanString(body.telegramChatTitle),
        messageIds,
      }],
    });

    relayDebug(env, traceId, "media-register.completed", {
      mediaKey: identity.key,
      channel: destination.key,
      messageIds,
    });

    return json({
      ok: true,
      ...messageLinks,
      alreadyRegistered: false,
      media: identity,
      channels: {
        requested: [destination.key],
        inserted,
        covered: [destination.key],
      },
      messageIds,
    });
  } catch (error) {
    relayDebug(env, traceId, "media-register.failed", { error: getErrorMessage(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "media-register" }, 500);
  }
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function publicUrlOrNull(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  return normalizePublicHttpUrl(text)?.href || null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeMessageIds(value: unknown, single: unknown): number[] {
  const values = Array.isArray(value) ? value : [value, single];
  return [...new Set(values
    .map(positiveInteger)
    .filter((item): item is number => item !== null))];
}

function normalizeMediaType(value: unknown): MediaType {
  const normalized = String(value || "video").trim().toLowerCase();
  return normalized === "photo" || normalized === "audio" || normalized === "document"
    ? normalized
    : "video";
}

function normalizeOptionalParseMode(value: unknown): ParseMode | null {
  if (value === null || value === undefined || value === "") return null;
  return normalizeParseMode(value) || null;
}

function normalizeCompressionMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "object") continue;
    const text = String(raw).trim();
    if (text) output[`compression_${key}`] = text.slice(0, 512);
  }
  return output;
}
