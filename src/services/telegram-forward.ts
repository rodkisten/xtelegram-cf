import type { DeliveryHistoryRecord } from "../db";
import type { ParseMode } from "../types";
import { parseTelegramDestination } from "./channels";
import {
  copyTelegramMessage,
  copyTelegramMessages,
  editTelegramMessageCaption,
} from "../telegram";

export interface TelegramForwardCopyDelivery {
  requestedChatId: string;
  telegramChatId: string | number | null;
  telegramChatTitle: string | null;
  messageThreadId: number | null;
  sourceMessageIds: number[];
  messageIds: number[];
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  method: "copyMessage" | "copyMessages+editMessageCaption" | "copyMessages" | null;
  hadExternalSideEffect: boolean;
  captionApplied: boolean;
}

/**
 * Implements `force: "forward"` without re-downloading/re-uploading media.
 *
 * Telegram's forwardMessage API cannot replace a caption. copyMessage can, so a
 * single stored message is copied directly with the current caption. Multiple
 * stored messages use copyMessages to preserve album grouping; old captions are
 * removed and the current caption is then applied to the first copied message.
 */
export async function copyStoredTelegramDeliveries(options: {
  botToken: string;
  channels: string[];
  storedDeliveries: DeliveryHistoryRecord[];
  caption: string;
  parseMode: ParseMode | null;
  messagePresentations?: Array<{ caption: string; parseMode: ParseMode | null }>;
}): Promise<TelegramForwardCopyDelivery[]> {
  const histories = latestDeliveryByChannel(options.storedDeliveries);

  return Promise.all(
    options.channels.map(async (requestedChatId) => {
      const stored = histories.get(requestedChatId) ?? null;
      return copyStoredTelegramDelivery({
        botToken: options.botToken,
        requestedChatId,
        stored,
        caption: options.caption,
        parseMode: options.parseMode,
        messagePresentations: options.messagePresentations,
      });
    }),
  );
}

async function copyStoredTelegramDelivery(options: {
  botToken: string;
  requestedChatId: string;
  stored: DeliveryHistoryRecord | null;
  caption: string;
  parseMode: ParseMode | null;
  messagePresentations?: Array<{ caption: string; parseMode: ParseMode | null }>;
}): Promise<TelegramForwardCopyDelivery> {
  const destination = parseTelegramDestination(options.requestedChatId);
  const stored = options.stored;
  const sourceMessageIds = stored ? storedMessageIds(stored) : [];
  const sourceChatId = stored?.telegramChatId ?? destination?.chatId ?? null;
  const targetChatId = destination?.chatId ?? null;
  const messageThreadId = destination?.messageThreadId ?? stored?.messageThreadId ?? null;
  const base = {
    requestedChatId: options.requestedChatId,
    telegramChatId: stored?.telegramChatId ?? targetChatId,
    telegramChatTitle: stored?.telegramChatTitle ?? null,
    messageThreadId,
    sourceMessageIds,
  };

  if (!stored || !sourceChatId || !targetChatId || !sourceMessageIds.length) {
    return {
      ...base,
      messageIds: [],
      ok: false,
      httpStatus: 409,
      error: "No stored Telegram message is available for force=forward on this destination.",
      method: null,
      hadExternalSideEffect: false,
      captionApplied: false,
    };
  }

  if (sourceMessageIds.length === 1) {
    const copied = await copyTelegramMessage({
      botToken: options.botToken,
      chatId: targetChatId,
      messageThreadId,
      fromChatId: sourceChatId,
      messageId: sourceMessageIds[0]!,
      caption: options.caption,
      parseMode: options.parseMode,
    });
    const messageId = positiveInteger(copied.result?.message_id);
    return {
      ...base,
      messageIds: messageId == null ? [] : [messageId],
      ok: copied.ok && messageId != null,
      httpStatus: copied.httpStatus ?? null,
      error: copied.ok && messageId != null
        ? null
        : copied.description || "Telegram copyMessage did not return a new message id.",
      method: "copyMessage",
      hadExternalSideEffect: copied.ok && messageId != null,
      captionApplied: copied.ok && messageId != null,
    };
  }

  const copied = await copyTelegramMessages({
    botToken: options.botToken,
    chatId: targetChatId,
    messageThreadId,
    fromChatId: sourceChatId,
    messageIds: sourceMessageIds,
    removeCaption: true,
  });
  const messageIds = Array.isArray(copied.result)
    ? copied.result
      .map((message) => positiveInteger(message?.message_id))
      .filter((messageId): messageId is number => messageId != null)
    : [];
  const hadExternalSideEffect = copied.ok && messageIds.length > 0;

  if (!copied.ok || !messageIds.length) {
    return {
      ...base,
      messageIds,
      ok: false,
      httpStatus: copied.httpStatus ?? null,
      error: copied.description || "Telegram copyMessages failed.",
      method: "copyMessages",
      hadExternalSideEffect,
      captionApplied: false,
    };
  }

  const presentations = options.messagePresentations?.length === messageIds.length
    ? options.messagePresentations
    : messageIds.map((_, index) => ({
        caption: index === 0 ? options.caption : "",
        parseMode: index === 0 ? options.parseMode : null,
      }));
  let captionApplied = true;
  let editError: string | null = null;
  let editHttpStatus: number | null = null;

  for (let index = 0; index < messageIds.length; index += 1) {
    const presentation = presentations[index];
    if (!presentation?.caption) continue;
    const edited = await editTelegramMessageCaption({
      botToken: options.botToken,
      chatId: targetChatId,
      messageId: messageIds[index]!,
      caption: presentation.caption,
      parseMode: presentation.parseMode,
    });
    editHttpStatus = edited.httpStatus ?? editHttpStatus;
    if (edited.ok) continue;
    captionApplied = false;
    editError = edited.description ||
      `Telegram copied the messages but rejected the current caption for copied message ${messageIds[index]}.`;
    break;
  }

  const completeCopy = messageIds.length === sourceMessageIds.length;
  const completeError = completeCopy
    ? null
    : `Telegram copied ${messageIds.length} of ${sourceMessageIds.length} stored message(s).`;

  return {
    ...base,
    messageIds,
    ok: completeCopy && captionApplied,
    httpStatus: editHttpStatus ?? copied.httpStatus ?? null,
    error: editError || completeError,
    method: presentations.some((presentation) => Boolean(presentation.caption))
      ? "copyMessages+editMessageCaption"
      : "copyMessages",
    hadExternalSideEffect,
    captionApplied,
  };
}

function latestDeliveryByChannel(
  deliveries: DeliveryHistoryRecord[],
): Map<string, DeliveryHistoryRecord> {
  const output = new Map<string, DeliveryHistoryRecord>();
  for (const delivery of deliveries) {
    if (!output.has(delivery.channelId)) output.set(delivery.channelId, delivery);
  }
  return output;
}

function storedMessageIds(delivery: DeliveryHistoryRecord): number[] {
  const source = delivery.lastMessageIds.length
    ? delivery.lastMessageIds
    : delivery.firstMessageIds;
  return [...new Set(source)]
    .map(positiveInteger)
    .filter((messageId): messageId is number => messageId != null)
    .sort((left, right) => left - right);
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
