import { json } from "../http/response";
import { formatGithubWorkflowRun, verifyGithubSignature } from "../lib/github-notifications";
import { parseTelegramDestination, resolveDefaultTelegramChatId } from "../services/channels";
import { sendTelegramText } from "../telegram";
import type { Env } from "../types";

const MAX_WEBHOOK_BYTES = 512 * 1024;
const DELIVERY_ID_PATTERN = /^[a-f0-9-]{32,64}$/i;

function allowedActions(value?: string): Set<string> {
  const selected = value?.trim() || "completed";
  return new Set(selected.split(",").map((item) => item.trim()).filter(Boolean));
}

async function readLimitedBody(request: Request): Promise<ArrayBuffer | null> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_WEBHOOK_BYTES) return null;
  // GitHub workflow_run payloads are small; bound the actual bytes too.
  const bytes = await request.arrayBuffer();
  return bytes.byteLength <= MAX_WEBHOOK_BYTES ? bytes : null;
}

async function claimDelivery(db: D1Database, deliveryId: string): Promise<boolean> {
  // A redelivery of a successful webhook is a no-op. Failed deliveries may retry;
  // abandoned processing claims become retryable after five minutes.
  const result = await db.prepare(
    "INSERT INTO github_notification_deliveries (delivery_id, state, updated_at) " +
    "VALUES (?1, 'processing', unixepoch()) " +
    "ON CONFLICT(delivery_id) DO UPDATE SET state='processing', updated_at=unixepoch() " +
    "WHERE state='failed' OR (state='processing' AND updated_at < unixepoch() - 300)"
  ).bind(deliveryId).run();
  return (result.meta.changes ?? 0) > 0;
}

async function setDeliveryState(
  db: D1Database,
  deliveryId: string,
  state: "sent" | "failed",
): Promise<void> {
  await db.prepare(
    "UPDATE github_notification_deliveries SET state=?2, updated_at=unixepoch() WHERE delivery_id=?1"
  ).bind(deliveryId, state).run();
}

/** POST /webhooks/github: GitHub's native workflow_run webhook, SHA-256 signed. */
export async function handleGithubWebhook(request: Request, env: Env): Promise<Response> {
  const secret = String(env.GITHUB_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    return json({ ok: false, error: "Missing GITHUB_WEBHOOK_SECRET", stage: "configuration" }, 500);
  }

  const body = await readLimitedBody(request);
  if (!body) return json({ ok: false, error: "Webhook payload too large" }, 413);
  if (!await verifyGithubSignature(body, request.headers.get("X-Hub-Signature-256"), secret)) {
    return json({ ok: false, error: "Invalid GitHub webhook signature" }, 401);
  }

  const event = request.headers.get("X-GitHub-Event") || "";
  if (event === "ping") return json({ ok: true, event: "ping" });
  if (event !== "workflow_run") {
    return json({ ok: true, ignored: true, reason: "unsupported_event", event }, 202);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ ok: false, error: "Invalid GitHub JSON payload" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ ok: false, error: "Invalid workflow_run payload" }, 400);
  }
  const action = (payload as Record<string, unknown>).action;
  if (typeof action !== "string" || !allowedActions(env.GITHUB_NOTIFY_ACTIONS).has(action)) {
    return json({ ok: true, ignored: true, reason: "action_filtered", action }, 202);
  }

  const message = formatGithubWorkflowRun(payload);
  if (!message) return json({ ok: false, error: "Invalid workflow_run fields" }, 422);

  const deliveryId = request.headers.get("X-GitHub-Delivery") || "";
  if (!DELIVERY_ID_PATTERN.test(deliveryId)) {
    return json({ ok: false, error: "Invalid X-GitHub-Delivery" }, 400);
  }
  const rawChat = env.GITHUB_WEBHOOK_CHAT_ID || env.NOTIFICATION_CHAT_ID ||
    resolveDefaultTelegramChatId(env);
  const destination = rawChat ? parseTelegramDestination(rawChat) : null;
  if (!destination || !env.TELEGRAM_BOT_TOKEN) {
    return json({
      ok: false,
      error: "Configure TELEGRAM_BOT_TOKEN and GITHUB_WEBHOOK_CHAT_ID (or NOTIFICATION_CHAT_ID)",
      stage: "configuration",
    }, 500);
  }

  let claimed: boolean;
  try {
    claimed = await claimDelivery(env.RELAY_DB, deliveryId);
  } catch {
    return json({
      ok: false,
      error: "Webhook delivery registry unavailable; apply D1 migration 0009",
      stage: "storage",
    }, 503);
  }
  if (!claimed) return json({ ok: true, duplicate: true, delivery_id: deliveryId });

  try {
    const result = await sendTelegramText({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: destination.chatId,
      messageThreadId: destination.messageThreadId,
      text: message.text,
      parseMode: "HTML",
      buttons: message.buttons,
    });
    if (!result.ok) {
      await setDeliveryState(env.RELAY_DB, deliveryId, "failed");
      return json({
        ok: false,
        stage: "telegram",
        error: result.description || "Telegram rejected the message",
        telegramStatus: result.httpStatus ?? null,
        delivery_id: deliveryId,
      }, 502);
    }
    await setDeliveryState(env.RELAY_DB, deliveryId, "sent");
    return json({
      ok: true,
      delivery_id: deliveryId,
      event,
      action,
      message_id: result.result?.message_id ?? null,
    });
  } catch (error) {
    // A network failure can have an ambiguous outcome; re-delivery is
    // at-least-once, not exactly-once.
    try { await setDeliveryState(env.RELAY_DB, deliveryId, "failed"); } catch {}
    console.error("[github-webhook] delivery failed", {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "Failed to deliver GitHub notification", stage: "delivery" }, 502);
  }
}
