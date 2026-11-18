import { json } from "../http/response";
import { formatGithubWorkflowRun, verifyGithubSignature } from "../lib/github-notifications";
import { parseTelegramDestination, resolveDefaultTelegramChatId } from "../services/channels";
import { deliverMutableNotification } from "../lib/mutable-notifications";
import type { Env } from "../types";
import { sendWorkflowNotify } from "../services/notify";

const MAX_WEBHOOK_BYTES = 512 * 1024;
const DELIVERY_ID_PATTERN = /^[a-f0-9-]{32,64}$/i;

function allowedActions(value?: string): Set<string> {
  const selected = value?.trim() || "requested,in_progress,completed";
  return new Set(selected.split(",").map((item) => item.trim()).filter(Boolean));
}


/** Match GitHub workflow_run.path against newline/comma-separated YAML globs. */
export function workflowPathAllowed(path: string, config?: string): boolean {
  if (!config?.trim()) return true;
  const rules = config.split(/[\n,]+/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  if (!rules.length) return true;
  const includes = rules.filter(s => !s.startsWith("!"));
  const excludes = rules.filter(s => s.startsWith("!")).map(s => s.slice(1).trim());
  const matches = (pattern: string): boolean => {
    if (!pattern || pattern.length > 256 || !/^[\w./*?+-]+$/.test(pattern)) return false;
    let source = "^";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "*" && pattern[i + 1] === "*") {
        source += ".*";
        i++;
        if (pattern[i + 1] === "/") { source += "?"; i++; }
      } else if (ch === "*") source += "[^/]*";
      else if (ch === "?") source += "[^/]";
      else source += ch.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\async function readLimitedBody");
    }
    return new RegExp(source + "$").test(path);
  };
  return (includes.length === 0 || includes.some(matches)) && !excludes.some(matches);
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

  const runForFilter = (payload as Record<string, unknown>).workflow_run;
  const workflowPath = runForFilter && typeof runForFilter === "object" && !Array.isArray(runForFilter)
    ? (runForFilter as Record<string, unknown>).path : undefined;
  if (env.GITHUB_NOTIFY_WORKFLOWS?.trim() &&
      (typeof workflowPath !== "string" || !workflowPathAllowed(workflowPath, env.GITHUB_NOTIFY_WORKFLOWS))) {
    return json({ ok: true, ignored: true, reason: "workflow_path_filtered" }, 202);
  }

  const message = formatGithubWorkflowRun(payload);
  if (!message) return json({ ok: false, error: "Invalid workflow_run fields" }, 422);

  const deliveryId = request.headers.get("X-GitHub-Delivery") || "";
  if (!DELIVERY_ID_PATTERN.test(deliveryId)) {
    return json({ ok: false, error: "Invalid X-GitHub-Delivery" }, 400);
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
    const root = payload as Record<string, unknown>;
    const run = root.workflow_run as Record<string, unknown>;
    const repository = root.repository as Record<string, unknown>;
    const conclusion = String(run.conclusion || "").toLowerCase();
    const failed = action === "completed" && (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure" || conclusion === "action_required");
    const cancelled = action === "completed" && conclusion === "cancelled";
    const repo = String(repository.full_name || "");
    const runId = String(run.id || "");
    const key = "workflow:" + repo + ":" + runId + ":" + String(run.run_attempt || 1);
    const activity = await env.RELAY_DB.prepare(
      "SELECT activity_id FROM github_notify_activities WHERE run_key=?1"
    ).bind(key).first<{ activity_id: string }>();
    let notifyStatus = "skipped";

    if (env.NOTIFY_DEVICE_ID && env.NOTIFY_TOKEN) {
      const notifyInput = {
        action: action === "completed" ? "end" as const : activity?.activity_id ? "step" as const : "start" as const,
        workflow: String(run.name || "GitHub Actions"),
        job: "Workflow",
        step: action === "in_progress" ? "Executando" : "Aguardando",
        outcome: action === "completed" ? (failed ? "failure" : cancelled ? "cancelled" : "success") : "running",
        activityId: activity?.activity_id,
        repository: repo,
        runId,
        completed: action === "completed" ? 1 : 0,
        total: 1,
      };
      try {
      const result = await sendWorkflowNotify(notifyInput, env);
      notifyStatus = result.disabled ? "disabled" : "sent";
      if (result.activityId) {
        await env.RELAY_DB.prepare(
          "INSERT INTO github_notify_activities(run_key, activity_id, updated_at) VALUES(?1,?2,unixepoch()) " +
          "ON CONFLICT(run_key) DO UPDATE SET activity_id=excluded.activity_id,updated_at=unixepoch()"
        ).bind(key, result.activityId).run();
      }
      if (action === "completed") {
        await env.RELAY_DB.prepare("DELETE FROM github_notify_activities WHERE run_key=?1").bind(key).run();
      }
      } catch (notifyError) {
        notifyStatus = "failed";
        console.error("[github-webhook] Notify delivery failed", notifyError instanceof Error ? notifyError.message : String(notifyError));
      }
    }

    let telegramStatus = "skipped";
    if (failed) {
      const rawChat = env.GITHUB_WEBHOOK_CHAT_ID || env.NOTIFICATION_CHAT_ID ||
        resolveDefaultTelegramChatId(env);
      const destination = rawChat ? parseTelegramDestination(rawChat) : null;
      if (!destination || !env.TELEGRAM_BOT_TOKEN) {
        throw new Error("Telegram failure alerts require TELEGRAM_BOT_TOKEN and GITHUB_WEBHOOK_CHAT_ID");
      }
      const attempt = typeof run.run_attempt === "number" && Number.isSafeInteger(run.run_attempt) &&
        run.run_attempt > 0 && run.run_attempt < 1000 ? run.run_attempt : 1;
      const result = await deliverMutableNotification(env, {
        chatId: destination.chatId,
        threadId: destination.messageThreadId,
        notificationKey: key,
        sequence: attempt * 100000 + 99999,
        text: message.text,
        parseMode: "HTML",
        buttons: message.buttons,
      });
      if (!result.ok) throw new Error(result.description || "Telegram rejected the failure alert");
      telegramStatus = "sent";
    }
    await setDeliveryState(env.RELAY_DB, deliveryId, "sent");
    return json({ ok: true, delivery_id: deliveryId, event, action, notify: notifyStatus, telegram: telegramStatus });

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
