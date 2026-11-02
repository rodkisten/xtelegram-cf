import { editTelegramText, sendTelegramText } from "../telegram";
import type { Env, ParseMode, TelegramApiResult, TelegramMessage } from "../types";
import type { NotificationButton } from "./github-notifications";

/**
 * D1-backed outbox keyed by a logical workflow/batch rather than a Telegram
 * message ID. Lease acquisition is atomic across concurrent Worker isolates.
 * Only acknowledge a higher/equal sequence after Telegram confirms delivery.
 */
export interface MutableNotification {
  chatId: string;
  threadId: number | null;
  notificationKey: string;
  sequence: number;
  text: string;
  parseMode: ParseMode | null;
  buttons: NotificationButton[][];
  disableNotification?: boolean;
}
export interface NotificationReceipt {
  ok: boolean;
  messageId: number | null;
  edited: boolean;
  unchanged?: boolean;
  stale?: boolean;
  description?: string;
  telegramStatus?: number | null;
  busy?: boolean;
}
type Row = {
  message_id: number | null;
  sequence: number;
  state: string;
  lease_token: string | null;
};
const KEY = /^[a-zA-Z0-9_:./-]{1,180}$/;
const MAX_SEQ = 9_000_000_000_000;
export function validNotificationKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}
export function validNotificationSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= MAX_SEQ;
}

function isNotModified(result: TelegramApiResult<TelegramMessage | true>): boolean {
  return result.httpStatus === 400 &&
    /message is not modified/i.test(result.description || "");
}
function cannotEdit(result: TelegramApiResult<TelegramMessage | true>): boolean {
  return result.httpStatus === 400 &&
    /message (?:to edit )?not found|message can't be edited|message can not be edited/i.test(result.description || "");
}
function receiptError(
  result: TelegramApiResult<TelegramMessage | true>,
): NotificationReceipt {
  return {
    ok: false, messageId: null, edited: false,
    description: result.description || "Telegram did not acknowledge the notification",
    telegramStatus: result.httpStatus ?? null,
  };
}
function messageIdFrom(result: TelegramApiResult<TelegramMessage>): number | null {
  const id = result.result?.message_id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function editDirectNotification(
  env: Env, options: Omit<MutableNotification, "notificationKey" | "sequence" | "threadId"> & { messageId: number },
): Promise<NotificationReceipt> {
  const response = await editTelegramText({
    botToken: env.TELEGRAM_BOT_TOKEN, chatId: options.chatId,
    messageId: options.messageId, text: options.text,
    parseMode: options.parseMode, buttons: options.buttons,
  });
  if (isNotModified(response))
    return { ok: true, messageId: options.messageId, edited: false, unchanged: true };
  if (!response.ok) return receiptError(response);
  return { ok: true, messageId: options.messageId, edited: true };
}

export async function deliverMutableNotification(
  env: Env, options: MutableNotification,
): Promise<NotificationReceipt> {
  if (!validNotificationKey(options.notificationKey) ||
      !validNotificationSequence(options.sequence)) {
    return { ok: false, messageId: null, edited: false, description: "Invalid notification key or sequence" };
  }
  const db = env.RELAY_DB;
  if (!db) {
    return { ok: false, messageId: null, edited: false, description: "RELAY_DB is not configured" };
  }
  const threadId = options.threadId ?? 0;
  const owner = crypto.randomUUID();
  let acquired: D1Result<unknown>;
  try {
    acquired = await db.prepare(
      "INSERT INTO notification_messages " +
      "(chat_id, thread_id, notification_key, message_id, sequence, state, lease_token, lease_until, updated_at) " +
      "VALUES (?1, ?2, ?3, NULL, -1, 'processing', ?4, unixepoch() + 45, unixepoch()) " +
      "ON CONFLICT(chat_id, thread_id, notification_key) DO UPDATE SET " +
      "state='processing', lease_token=excluded.lease_token, " +
      "lease_until=unixepoch() + 45, updated_at=unixepoch() " +
      "WHERE notification_messages.lease_until <= unixepoch()"
    ).bind(options.chatId, threadId, options.notificationKey, owner).run();
  } catch {
    return { ok: false, messageId: null, edited: false, description: "D1 notification state unavailable; apply migration 0010" };
  }
  if ((acquired.meta.changes ?? 0) === 0) {
    return { ok: false, busy: true, messageId: null, edited: false, description: "Notification update in progress" };
  }

  let result: NotificationReceipt = { ok: false, messageId: null, edited: false, description: "Delivery interrupted" };
  let shouldCommit = false;
  try {
    const row = await db.prepare(
      "SELECT message_id, sequence, state, lease_token FROM notification_messages " +
      "WHERE chat_id=?1 AND thread_id=?2 AND notification_key=?3"
    ).bind(options.chatId, threadId, options.notificationKey).first<Row>();
    if (!row || row.lease_token !== owner) {
      return { ok: false, messageId: null, edited: false, description: "Notification lease lost" };
    }
    if (options.sequence < row.sequence) {
      result = { ok: true, messageId: row.message_id, edited: false, stale: true };
      shouldCommit = true;
      return result;
    }
    if (row.message_id != null) {
      const edited = await editTelegramText({
        botToken: env.TELEGRAM_BOT_TOKEN, chatId: options.chatId,
        messageId: row.message_id, text: options.text,
        parseMode: options.parseMode, buttons: options.buttons,
      });
      if (isNotModified(edited)) {
        result = { ok: true, messageId: row.message_id, edited: false, unchanged: true };
      } else if (edited.ok) {
        result = { ok: true, messageId: row.message_id, edited: true };
      } else if (!cannotEdit(edited)) {
        return receiptError(edited);
      } else {
        // Deleted/expired Telegram messages can be recovered with a fresh send.
        result = await createNewNotification(env, options);
      }
    } else {
      result = await createNewNotification(env, options);
    }
    shouldCommit = result.ok && result.messageId != null;
    return result;
  } finally {
    try {
      if (shouldCommit) {
        await db.prepare(
          "UPDATE notification_messages SET message_id=?5, sequence=max(sequence,?6), " +
          "state='sent', lease_token=NULL, lease_until=0, updated_at=unixepoch() " +
          "WHERE chat_id=?1 AND thread_id=?2 AND notification_key=?3 AND lease_token=?4"
        ).bind(options.chatId, threadId, options.notificationKey, owner, result.messageId, options.sequence).run();
      } else {
        await db.prepare(
          "UPDATE notification_messages SET state='failed', lease_token=NULL, lease_until=0, updated_at=unixepoch() " +
          "WHERE chat_id=?1 AND thread_id=?2 AND notification_key=?3 AND lease_token=?4"
        ).bind(options.chatId, threadId, options.notificationKey, owner).run();
      }
    } catch {
      // Never claim successful storage to the API if the Telegram ACK could not be recorded.
      result.ok = false;
      result.description = "Notification state could not be persisted; retry may duplicate";
    }
  }
}

async function createNewNotification(env: Env, options: MutableNotification): Promise<NotificationReceipt> {
  const sent = await sendTelegramText({
    botToken: env.TELEGRAM_BOT_TOKEN, chatId: options.chatId,
    messageThreadId: options.threadId, text: options.text,
    parseMode: options.parseMode, buttons: options.buttons,
    disableNotification: options.disableNotification,
  });
  if (!sent.ok) return receiptError(sent);
  const messageId = messageIdFrom(sent);
  if (!messageId)
    return { ok: false, messageId: null, edited: false, description: "Telegram omitted message_id" };
  return { ok: true, messageId, edited: false };
}
