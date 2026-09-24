import { parseTelegramDestination } from "../services/channels";

export interface TelegramMessageReference {
  requestedChatId?: string | null;
  telegramChatId?: string | number | null;
  telegramUsername?: string | null;
  messageThreadId?: number | null;
  messageId?: number | null;
  single?: boolean;
}

export interface TelegramMessageLinkFields {
  message_id: number | null;
  message_url: string | null;
  message_deeplink: string | null;
  message_ids: number[];
  message_urls: string[];
  message_deeplinks: string[];
}

export interface StoredTelegramDeliveryLike {
  channelId: string;
  telegramChatId: string | number | null;
  messageThreadId: number | null;
  firstMessageIds: number[];
  lastMessageIds: number[];
}

/**
 * Builds the flat Telegram message contract used by Shortcuts and Scriptable.
 *
 * `message_id` / `message_url` / `message_deeplink` always describe the first
 * message reference. The plural fields preserve every Telegram message created
 * by albums, multipart sends, or multi-channel delivery.
 */
export function buildTelegramMessageLinkFields(
  references: TelegramMessageReference[],
): TelegramMessageLinkFields {
  const resolved = references
    .map(resolveTelegramMessageReference)
    .filter((entry): entry is ResolvedTelegramMessageReference => entry !== null);

  const first = resolved[0] ?? null;
  return {
    message_id: first?.messageId ?? null,
    message_url: first?.url ?? null,
    message_deeplink: first?.deeplink ?? null,
    message_ids: resolved.map((entry) => entry.messageId),
    message_urls: resolved.map((entry) => entry.url).filter((value): value is string => Boolean(value)),
    message_deeplinks: resolved
      .map((entry) => entry.deeplink)
      .filter((value): value is string => Boolean(value)),
  };
}

/** Build the same flat fields from persisted D1 delivery history. */
export function buildStoredTelegramMessageLinkFields(
  deliveries: StoredTelegramDeliveryLike[],
): TelegramMessageLinkFields {
  return buildTelegramMessageLinkFields(
    deliveries.flatMap((delivery) => {
      const messageIds = delivery.lastMessageIds.length
        ? delivery.lastMessageIds
        : delivery.firstMessageIds;
      const single = messageIds.length > 1;
      return messageIds.map((messageId) => ({
        requestedChatId: delivery.channelId,
        telegramChatId: delivery.telegramChatId,
        messageThreadId: delivery.messageThreadId,
        messageId,
        single,
      }));
    }),
  );
}

/**
 * Aggregates already-flat child responses, used by /resolve-and-send and /batch.
 * This intentionally reads only top-level fields so nested debug/duplicate data
 * cannot accidentally leak unrelated historical message IDs into the result.
 */
export function aggregateTelegramMessageLinkFields(
  values: unknown[],
): TelegramMessageLinkFields {
  const messageIds: number[] = [];
  const messageUrls: string[] = [];
  const messageDeeplinks: string[] = [];
  let firstId: number | null = null;
  let firstUrl: string | null = null;
  let firstDeeplink: string | null = null;

  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;

    const ids = normalizePositiveIntegerArray(record.message_ids);
    const urls = normalizeStringArray(record.message_urls);
    const deeplinks = normalizeStringArray(record.message_deeplinks);

    const directId = positiveInteger(record.message_id);
    const directUrl = cleanString(record.message_url);
    const directDeeplink = cleanString(record.message_deeplink);

    if (firstId == null) firstId = directId ?? ids[0] ?? null;
    if (firstUrl == null) firstUrl = directUrl ?? urls[0] ?? null;
    if (firstDeeplink == null) firstDeeplink = directDeeplink ?? deeplinks[0] ?? null;

    if (ids.length) messageIds.push(...ids);
    else if (directId != null) messageIds.push(directId);

    if (urls.length) messageUrls.push(...urls);
    else if (directUrl) messageUrls.push(directUrl);

    if (deeplinks.length) messageDeeplinks.push(...deeplinks);
    else if (directDeeplink) messageDeeplinks.push(directDeeplink);
  }

  return {
    message_id: firstId,
    message_url: firstUrl,
    message_deeplink: firstDeeplink,
    message_ids: messageIds,
    message_urls: messageUrls,
    message_deeplinks: messageDeeplinks,
  };
}

interface ResolvedTelegramMessageReference {
  messageId: number;
  url: string | null;
  deeplink: string | null;
}

function resolveTelegramMessageReference(
  reference: TelegramMessageReference,
): ResolvedTelegramMessageReference | null {
  const messageId = positiveInteger(reference.messageId);
  if (messageId == null) return null;

  const destination = reference.requestedChatId
    ? parseTelegramDestination(reference.requestedChatId)
    : null;
  const messageThreadId = positiveInteger(reference.messageThreadId)
    ?? destination?.messageThreadId
    ?? null;
  const username = normalizeTelegramUsername(reference.telegramUsername)
    ?? normalizeTelegramUsername(destination?.chatId);
  const single = reference.single === true;

  if (username) {
    const query = buildMessageQuery({ single, messageThreadId });
    return {
      messageId,
      url: `https://t.me/${username}/${messageId}${query.https}`,
      deeplink: `tg://resolve?domain=${username}&post=${messageId}${query.tg}`,
    };
  }

  const privateChannelId = toPrivateChannelId(
    reference.telegramChatId ?? destination?.chatId ?? null,
  );
  if (privateChannelId) {
    const query = buildMessageQuery({ single, messageThreadId });
    return {
      messageId,
      url: `https://t.me/c/${privateChannelId}/${messageId}${query.https}`,
      deeplink: `tg://privatepost?channel=${privateChannelId}&post=${messageId}${query.tg}`,
    };
  }

  // Basic private groups and private users do not have the channel-style
  // message links Telegram exposes for channels/supergroups. Keep the ID and
  // return null links rather than manufacturing an invalid URL.
  return { messageId, url: null, deeplink: null };
}

function buildMessageQuery(options: {
  single: boolean;
  messageThreadId: number | null;
}): { https: string; tg: string } {
  const https: string[] = [];
  const tg: string[] = [];

  if (options.single) {
    https.push("single");
    tg.push("single");
  }
  if (options.messageThreadId != null) {
    https.push(`thread=${options.messageThreadId}`);
    tg.push(`thread=${options.messageThreadId}`);
  }

  return {
    https: https.length ? `?${https.join("&")}` : "",
    tg: tg.length ? `&${tg.join("&")}` : "",
  };
}

function normalizeTelegramUsername(value: unknown): string | null {
  const text = cleanString(value)?.replace(/^@+/, "") ?? "";
  return /^[A-Za-z0-9_]{1,64}$/.test(text) ? text : null;
}

/** Convert Bot API -100<channel_id> into the MTProto/t.me channel id. */
function toPrivateChannelId(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const parsed = parseTelegramDestination(text);
  const chatId = parsed?.chatId ?? text;
  const match = String(chatId).match(/^-100(\d+)$/);
  return match?.[1] || null;
}

function normalizePositiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(positiveInteger)
    .filter((entry): entry is number => entry !== null);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter((entry): entry is string => Boolean(entry));
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
