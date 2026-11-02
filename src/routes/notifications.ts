import { json } from "../http/response";
import { parseTelegramDestination, resolveDefaultTelegramChatId } from "../services/channels";
import { sendTelegramText } from "../telegram";
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
export async function handleNotificationSend(request: Request, env: Env): Promise<Response> {
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
  return json({
    ok: true,
    chat_id: String(result.result?.chat?.id ?? destination.chatId),
    message_thread_id: messageThreadId,
    message_id: result.result?.message_id ?? null,
  });
}
