import { editTelegramMessageCaption } from "../telegram";
import type { ParseMode } from "../types";

export interface CaptionSyncDelivery {
  channelId: string;
  telegramChatId: string | null;
  lastMessageIds: unknown;
}

export interface CaptionSyncResult {
  channelId: string;
  chatId: string | null;
  messageId: number | null;
  ok: boolean;
  skipped: boolean;
  error: string | null;
}

/**
 * Telegram media captions live on one message. For single sends this is the
 * only message; for albums the relay stores all message ids and the album
 * caption is attached to the first message in the latest batch.
 */
export async function syncCaptionToTelegramDeliveries(options: {
  botToken: string;
  caption: string;
  parseMode: ParseMode | null;
  deliveries: CaptionSyncDelivery[];
}): Promise<CaptionSyncResult[]> {
  const results: CaptionSyncResult[] = [];

  for (const delivery of options.deliveries) {
    const ids = Array.isArray(delivery.lastMessageIds)
      ? delivery.lastMessageIds.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : [];
    const messageId = ids[0] ?? null;
    const chatId = delivery.telegramChatId;

    if (!chatId || messageId == null) {
      results.push({
        channelId: delivery.channelId,
        chatId,
        messageId,
        ok: false,
        skipped: true,
        error: "Stored delivery does not have a Telegram chat/message id to edit.",
      });
      continue;
    }

    const result = await editTelegramMessageCaption({
      botToken: options.botToken,
      chatId,
      messageId,
      caption: options.caption,
      parseMode: options.parseMode,
    });

    const alreadyCurrent = !result.ok && /message is not modified/i.test(result.description || "");
    results.push({
      channelId: delivery.channelId,
      chatId,
      messageId,
      ok: result.ok || alreadyCurrent,
      skipped: alreadyCurrent,
      error: result.ok || alreadyCurrent ? null : result.description || "Telegram rejected editMessageCaption.",
    });
  }

  return results;
}
