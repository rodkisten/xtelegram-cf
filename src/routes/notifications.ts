import { appendNotificationGroup } from "../services/notification-groups";
import { scheduleNotificationDeletion } from "../services/notification-retention";
import { json } from "../http/response";
import { parseTelegramDestination, resolveDefaultTelegramChatId } from "../services/channels";
import { sendTelegramText } from "../telegram";
import { deliverMutableNotification, editDirectNotification, validNotificationKey, validNotificationSequence } from "../lib/mutable-notifications";
import type { Env, ParseMode } from "../types";
import type { NotificationButton } from "../lib/github-notifications";

type Input = Record<string, unknown>;

function isObject(value: unknown): value is Input {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buttonsFrom(value: unknown): NotificationButton[][] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return null;
  const rows: NotificationButton[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length < 1 || row.length > 3) return null;
    const checked: NotificationButton[] = [];
    for (const item of row) {
      if (!isObject(item) || typeof item.text !== "string" ||
        !item.text.trim() || item.text.length > 64 || typeof item.url !== "string") return null;
      try {
        const url = new URL(item.url);
        if (url.protocol !== "https:" || url.username || url.password) return null;
        checked.push({ text: item.text, url: url.toString() });
      } catch {
        return null;
      }
    }
    rows.push(checked);
  }
  return rows;
}

/** POST /notifications/send: an authenticated text-only Telegram sender. */
export async function handleNotificationSend(request: Request, env: Env, requireEdit = false): Promise<Response> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Expected application/json" }, 415);
  }
  if (Number(request.headers.get("content-length") || 0) > 16384) {
    return json({ ok: false, error: "Request body too large" }, 413);
  }
  let data: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16384) {
      return json({ ok: false, error: "Request body too large" }, 413);
    }
    data = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!isObject(data)) return json({ ok: false, error: "Expected JSON object" }, 400);

  const body = data.body ?? data.text;
  if (typeof body !== "string" || !body.trim() || body.length > 4096) {
    return json({ ok: false, error: "body must contain 1-4096 characters" }, 422);
  }
  const rawChat = data.chat_id ?? data.chatId ?? env.NOTIFICATION_CHAT_ID ??
    resolveDefaultTelegramChatId(env);
  if (typeof rawChat !== "string" && typeof rawChat !== "number") {
    return json({ ok: false, error: "chat_id is required (or configure NOTIFICATION_CHAT_ID)" }, 422);
  }
  const destination = parseTelegramDestination(rawChat);
  if (!destination) {
    return json({ ok: false, error: "Invalid chat_id (use ID, @channel or ID:topic)" }, 422);
  }
  const requestedThread = data.message_thread_id ?? data.messageThreadId;
  let messageThreadId = destination.messageThreadId;
  if (requestedThread !== undefined && requestedThread !== null) {
    if (typeof requestedThread !== "number" || !Number.isSafeInteger(requestedThread) ||
      requestedThread <= 0 || (messageThreadId !== null && messageThreadId !== requestedThread)) {
      return json({ ok: false, error: "Invalid/conflicting message_thread_id" }, 422);
    }
    messageThreadId = requestedThread;
  }

  const parseMode = data.parse_mode ?? data.parseMode ?? null;
  if (parseMode !== null && parseMode !== "HTML" && parseMode !== "MarkdownV2") {
    return json({ ok: false, error: "parse_mode must be HTML, MarkdownV2, or null" }, 422);
  }
  if (data.disable_notification !== undefined && typeof data.disable_notification !== "boolean") {
    return json({ ok: false, error: "disable_notification must be a boolean" }, 422);
  }
  const buttons = buttonsFrom(data.buttons);
  if (!buttons) return json({ ok: false, error: "Invalid buttons; expected up to 3 rows of HTTPS links" }, 422);
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN", stage: "configuration" }, 500);
  }

  const deleteAfter = data.delete_after_minutes ?? 0;
  if (typeof deleteAfter !== 'number' || !Number.isSafeInteger(deleteAfter) || deleteAfter < 0 || deleteAfter > 43200) {
    return json({ ok: false, error: 'delete_after_minutes must be 0-43200' }, 422);
  }
  const groupKey = data.group_key;
  if (groupKey !== undefined) {
    const eventKey = data.event_key;
    const severity = data.severity;
    const title = data.title;
    if (typeof groupKey !== "string" || !/^[a-zA-Z0-9_:./-]{1,170}$/.test(groupKey) ||
      typeof eventKey !== "string" || !/^[a-zA-Z0-9_:./-]{1,170}$/.test(eventKey) ||
      !["running", "success", "error"].includes(String(severity)) ||
      typeof title !== "string" || !title.trim() || title.length > 160) {
      return json({ ok: false, error: "Invalid group_key, event_key, severity or title" }, 422);
    }
    const receipt = await appendNotificationGroup(env, {
      chatId: destination.chatId, threadId: messageThreadId, groupKey, eventKey,
      title, detail: body, severity: severity as "running" | "success" | "error",
      buttons, deleteAfterMinutes: deleteAfter,
    });
    if (!receipt.ok) return json({ ok: false, error: receipt.description || "Group delivery failed" }, receipt.busy ? 409 : 502);
    if (receipt.messageId) await scheduleNotificationDeletion(env, destination.chatId, receipt.messageId, deleteAfter);
    return json({ ok: true, grouped: true, message_id: receipt.messageId, edited: receipt.edited });
  }
  const messageId = data.message_id ?? data.messageId;
  const notificationKey = data.notification_key ?? data.notificationKey;
  const sequence = data.sequence ?? 0;
  if (messageId !== undefined && messageId !== null &&
      (typeof messageId !== "number" || !Number.isSafeInteger(messageId) || messageId <= 0)) {
    return json({ ok: false, error: "message_id must be a positive integer" }, 422);
  }
  if (requireEdit && (messageId === undefined || messageId === null) && notificationKey === undefined) {
    return json({ ok: false, error: "Edit requires message_id or notification_key" }, 422);
  }
  if (notificationKey !== undefined && !validNotificationKey(notificationKey)) {
    return json({ ok: false, error: "notification_key must be 1-180 safe characters" }, 422);
  }
  if (notificationKey !== undefined && (messageId !== undefined && messageId !== null)) {
    return json({ ok: false, error: "Provide notification_key OR message_id, not both" }, 422);
  }
  if (!validNotificationSequence(sequence)) {
    return json({ ok: false, error: "sequence must be a nonnegative safe integer" }, 422);
  }
  if (notificationKey !== undefined || messageId !== undefined && messageId !== null) {
    const options = {
      chatId: destination.chatId, threadId: messageThreadId,
      text: body, parseMode: parseMode as ParseMode | null, buttons,
      disableNotification: data.disable_notification === true,
    };
    const receipt = notificationKey !== undefined
      ? await deliverMutableNotification(env, {
          ...options, notificationKey, sequence,
        })
      : await editDirectNotification(env, { ...options, messageId: messageId as number });
    if (!receipt.ok) {
      return json({
        ok: false, stage: receipt.busy ? "in_progress" : "telegram",
        error: receipt.description || "Notification update failed",
        telegramStatus: receipt.telegramStatus ?? null,
      }, receipt.busy ? 409 : receipt.description?.includes("migration 0010") ? 503 : 502);
    }
    if (receipt.messageId && deleteAfter) await scheduleNotificationDeletion(env, destination.chatId, receipt.messageId, deleteAfter);
    return json({
      ok: true, chat_id: destination.chatId,
      message_thread_id: messageThreadId, message_id: receipt.messageId,
      edited: receipt.edited, unchanged: receipt.unchanged ?? false,
      stale: receipt.stale ?? false, notification_key: notificationKey ?? null,
    });
  }

  const result = await sendTelegramText({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: destination.chatId,
    messageThreadId,
    text: body,
    parseMode: parseMode as ParseMode | null,
    disableNotification: data.disable_notification === true,
    buttons,
  });
  if (!result.ok) {
    return json({
      ok: false,
      stage: "telegram",
      error: result.description || "Telegram sendMessage failed",
      telegramStatus: result.httpStatus ?? null,
    }, 502);
  }
  if (result.result?.message_id && deleteAfter) await scheduleNotificationDeletion(env, destination.chatId, result.result.message_id, deleteAfter);
  return json({
    ok: true,
    chat_id: String(result.result?.chat?.id ?? destination.chatId),
    message_thread_id: messageThreadId,
    message_id: result.result?.message_id ?? null,
  });
}
