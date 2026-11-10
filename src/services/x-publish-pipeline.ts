import type { Env } from "../types";
import { createBufferVideo, checkBufferPost, bufferAvailable, type ProviderResult } from "./x-publish-buffer";
import { directXAvailable, initializeDirectXMedia, finishDirectXMedia } from "./x-publish-direct";
import {
  isZernioEnabled,
  refreshZernioSubmission,
  submitZernioVideo,
} from "./zernio-publisher";
import type { XRepostItem } from "./x-repost-queue";

export type XProvider = "buffer" | "zernio" | "x";
type JobStatus = "ready" | "submitting" | "pending" | "media_processing" |
  "published" | "uncertain" | "blocked";

interface Job {
  queue_id: string;
  provider: XProvider | null;
  status: JobStatus;
  tried: string;
  remote_id: string | null;
  media_id: string | null;
  media_ready: number;
  post_url: string | null;
  error_code: string | null;
  next_attempt_at: number;
  updated_at: number;
}

const PROVIDERS: XProvider[] = ["buffer", "zernio", "x"];
const MAX_DAILY = 40;
const MAX_HOURLY = 2;
const MIN_GAP = 2700;

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

export function publisherLimits(env: Env) {
  return {
    day: bounded(env.X_PUBLISH_MAX_PER_24H, 20, 1, MAX_DAILY),
    hour: bounded(env.X_PUBLISH_MAX_PER_HOUR, 2, 1, MAX_HOURLY),
    gap: bounded(env.X_PUBLISH_MIN_GAP_SECONDS, 3600, MIN_GAP, 86400),
  };
}

export function availableProviders(env: Env): XProvider[] {
  return PROVIDERS.filter(provider => provider === "buffer" ? bufferAvailable(env)
    : provider === "zernio"
      ? env.X_PUBLISH_ENABLE_PAID_FALLBACK === "true" &&
        isZernioEnabled(env) && Boolean(env.ZERNIO_TWITTER_ACCOUNT_ID)
      : env.X_PUBLISH_ENABLE_PAID_FALLBACK === "true" && directXAvailable(env));
}

function nextRetry(seconds: number): number {
  // Scheduled checks already run at 10-minute intervals. Add positive jitter.
  return Math.floor(Date.now() / 1000) + Math.max(600, Math.floor(seconds)) +
    Math.floor(Math.random() * 181);
}

export async function publisherStats(env: Env): Promise<Record<string, unknown>> {
  const db = env.RELAY_DB;
  const limits = publisherLimits(env);
  const usage = await db.prepare(
    "SELECT " +
      "(SELECT COUNT(*) FROM x_publish_slots WHERE account_key='x-primary' AND " +
        "reserved_at>unixepoch()-86400) + " +
      "(SELECT COUNT(*) FROM x_repost_queue q WHERE q.status='posted' AND " +
        "q.posted_at>unixepoch()-86400 AND NOT EXISTS " +
        "(SELECT 1 FROM x_publish_slots s WHERE s.queue_id=q.id)) AS day, " +
      "(SELECT COUNT(*) FROM x_publish_slots WHERE account_key='x-primary' AND " +
        "reserved_at>unixepoch()-3600) + " +
      "(SELECT COUNT(*) FROM x_repost_queue q WHERE q.status='posted' AND " +
        "q.posted_at>unixepoch()-3600 AND NOT EXISTS " +
        "(SELECT 1 FROM x_publish_slots s WHERE s.queue_id=q.id)) AS hour",
  ).first<{ day: number | null; hour: number | null }>();
  const control = await db.prepare(
    "SELECT cooldown_until FROM x_publish_control WHERE id = 1",
  ).first<{ cooldown_until: number }>();
  const buffer = await db.prepare(
    "SELECT count(*) AS count FROM x_publish_buffer_calls WHERE created_at >= unixepoch()-2592000",
  ).first<{ count: number }>();
  return {
    enabled: env.X_PUBLISH_ENABLED === "true",
    automatic: env.X_PUBLISH_AUTO_ENABLED === "true",
    order: PROVIDERS,
    availableProviders: availableProviders(env),
    allowPaidFallback: env.X_PUBLISH_ENABLE_PAID_FALLBACK === "true",
    limits,
    usedLast24h: usage?.day || 0,
    usedLastHour: usage?.hour || 0,
    bufferCallsLast30d: buffer?.count || 0,
    cooldownUntil: control?.cooldown_until || 0,
  };
}

/**
 * One durable budget slot per source video, regardless of provider.
 * The single INSERT...SELECT protects against concurrent Cron/manual requests
 * for different videos. It cannot count posts created outside this Relay.
 */
export async function reserveXPostingBudget(env: Env, queueId: string): Promise<boolean> {
  const db = env.RELAY_DB;
  const prior = await db.prepare(
    "SELECT queue_id FROM x_publish_slots WHERE queue_id = ?",
  ).bind(queueId).first();
  if (prior) return true;
  const limits = publisherLimits(env);
  const inserted = await db.prepare(
    "INSERT OR IGNORE INTO x_publish_slots(queue_id,account_key,reserved_at) " +
      "SELECT ?, 'x-primary', unixepoch() " +
      "WHERE ((SELECT COUNT(*) FROM x_publish_slots WHERE account_key='x-primary' " +
        "AND reserved_at > unixepoch()-86400) + " +
        "(SELECT COUNT(*) FROM x_repost_queue q WHERE q.status='posted' " +
        "AND q.posted_at>unixepoch()-86400 AND NOT EXISTS " +
        "(SELECT 1 FROM x_publish_slots s WHERE s.queue_id=q.id))) < ? " +
      "AND ((SELECT COUNT(*) FROM x_publish_slots WHERE account_key='x-primary' " +
        "AND reserved_at > unixepoch()-3600) + " +
        "(SELECT COUNT(*) FROM x_repost_queue q WHERE q.status='posted' " +
        "AND q.posted_at>unixepoch()-3600 AND NOT EXISTS " +
        "(SELECT 1 FROM x_publish_slots s WHERE s.queue_id=q.id))) < ? " +
      "AND MAX(" +
        "(SELECT COALESCE(MAX(reserved_at),0) FROM x_publish_slots " +
        "WHERE account_key='x-primary')," +
        "(SELECT COALESCE(MAX(posted_at),0) FROM x_repost_queue q WHERE q.status='posted' " +
          "AND NOT EXISTS (SELECT 1 FROM x_publish_slots s WHERE s.queue_id=q.id))" +
        ") <= unixepoch()-? " +
      "AND (SELECT cooldown_until FROM x_publish_control WHERE id=1) <= unixepoch()",
  ).bind(queueId, limits.day, limits.hour, limits.gap).run();
  return (inserted.meta.changes || 0) === 1;
}

async function applyCooldown(env: Env, seconds: number): Promise<void> {
  const until = nextRetry(Math.min(86400, Math.max(900, seconds)));
  await env.RELAY_DB.prepare(
    "UPDATE x_publish_control SET cooldown_until = MAX(cooldown_until, ?), " +
      "updated_at = unixepoch() WHERE id=1",
  ).bind(until).run();
}

async function updateJob(
  env: Env, id: string, status: JobStatus,
  options: { provider?: XProvider; remoteId?: string; mediaId?: string;
    url?: string; error?: string; nextAt?: number; mediaReady?: boolean } = {},
): Promise<void> {
  await env.RELAY_DB.prepare(
    "UPDATE x_publish_jobs SET status=?, " +
      "provider=COALESCE(?,provider), remote_id=COALESCE(?,remote_id), " +
      "media_id=COALESCE(?,media_id), media_ready=COALESCE(?,media_ready), " +
      "post_url=COALESCE(?,post_url), " +
      "error_code=?, next_attempt_at=?, updated_at=unixepoch() WHERE queue_id=?",
  ).bind(
    status, options.provider || null, options.remoteId || null, options.mediaId || null,
    options.mediaReady === undefined ? null : options.mediaReady ? 1 : 0,
    options.url || null, options.error || null, options.nextAt || 0, id,
  ).run();
}

export async function markXPublished(
  env: Env, id: string, provider: XProvider, url: string | undefined,
): Promise<void> {
  const normalizedUrl = url && /^https:\/\/(?:x\.com|twitter\.com)\/(?:[A-Za-z0-9_]+|i)\/status\/\d+/i.test(url)
    ? url : null;
  const changed = await env.RELAY_DB.prepare(
    "UPDATE x_repost_queue SET status='posted', posted_at=unixepoch(), " +
      "post_url=COALESCE(?,post_url), claimed_at=NULL, claim_token=NULL, lease_until=0, " +
      "updated_at=unixepoch() WHERE id=? AND status='queued'",
  ).bind(normalizedUrl, id).run();
  // Zernio may already have marked the X queue row posted before this callback.
  const alreadyPosted = (changed.meta.changes || 0) > 0 || await env.RELAY_DB.prepare(
    "SELECT id FROM x_repost_queue WHERE id=? AND status='posted'",
  ).bind(id).first();
  if (alreadyPosted) {
    await updateJob(env, id, "published", { provider, url: normalizedUrl || undefined });
  }
}

async function storeProviderResult(
  env: Env, item: XRepostItem, provider: XProvider, result: ProviderResult,
): Promise<void> {
  if (result.kind === "accepted") {
    await updateJob(env, item.id, result.status === "published" ? "published" : "pending", {
      provider, remoteId: result.id, url: result.url,
    });
    if (result.status === "published") {
      await markXPublished(env, item.id, provider, result.url);
    }
    return;
  }
  if (result.kind === "rate_limited") {
    // Explicit HTTP 429 confirms no accepted creation. Retry the SAME provider
    // only after cooldown, never hop to another provider to evade X limits.
    await applyCooldown(env, result.retrySeconds);
    await env.RELAY_DB.prepare(
      "UPDATE x_publish_jobs SET tried=?,updated_at=unixepoch() WHERE queue_id=?",
    ).bind(
      (await env.RELAY_DB.prepare("SELECT tried FROM x_publish_jobs WHERE queue_id=?")
        .bind(item.id).first<{ tried: string }>())?.tried
        .split(",").filter(p => p && p !== provider).join(",") || "",
      item.id,
    ).run();
    await updateJob(env, item.id, "ready", {
      provider, error: "provider_rate_limited", nextAt: nextRetry(result.retrySeconds),
    });
    return;
  }
  if (result.kind === "uncertain") {
    // A POST may have been accepted upstream: no automatic replay or cross-provider fallback.
    await updateJob(env, item.id, "uncertain", { provider, error: result.code });
    return;
  }
  // A provider's explicit rejection means no published post. Use the next provider
  // only after a positive delay and only when paid fallback is enabled.
  await updateJob(env, item.id, "ready", {
    provider, error: result.code, nextAt: nextRetry(600),
  });
}

async function reserveJob(
  env: Env, id: string, provider: XProvider, tried: string,
): Promise<boolean> {
  const all = new Set(tried.split(",").filter(Boolean));
  all.add(provider);
  const row = await env.RELAY_DB.prepare(
    "UPDATE x_publish_jobs SET status='submitting', provider=?, tried=?, error_code=NULL, " +
      "updated_at=unixepoch() WHERE queue_id=? AND status='ready' AND next_attempt_at<=unixepoch()",
  ).bind(provider, Array.from(all).join(","), id).run();
  return (row.meta.changes || 0) > 0;
}

async function dueItem(
  env: Env,
  queueId?: string,
): Promise<XRepostItem | null> {
  return env.RELAY_DB.prepare(
    "SELECT q.* FROM x_repost_queue q " +
    "LEFT JOIN x_publish_jobs j ON j.queue_id=q.id " +
    "WHERE q.status='queued' AND q.scheduled_at<=unixepoch() " +
    "AND q.media_object_key IS NOT NULL " +
    "AND (j.queue_id IS NULL OR (j.status='ready' AND j.next_attempt_at<=unixepoch())) " +
    "AND NOT EXISTS (SELECT 1 FROM x_repost_zernio_submissions z " +
      "WHERE z.queue_id=q.id AND z.platform='twitter' " +
      "AND z.status NOT IN ('failed_preflight','failed')) " +
    (queueId ? "AND q.id=? " : "") +
    "ORDER BY q.scheduled_at ASC LIMIT 1",
  ).bind(...(queueId ? [queueId] : [])).first<XRepostItem>();
}

/**
 * Called once per 10-minute cron, and optionally for explicit manual runs.
 * Never submits an item unless feature gate, due date, budget, and R2 are ready.
 */
export async function runOneDuePublisher(env: Env, queueId?: string): Promise<void> {
  if (env.X_PUBLISH_ENABLED !== "true") return;
  const item = await dueItem(env, queueId);
  if (!item) return;
  const providers = availableProviders(env);
  if (!providers.length) return;

  await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO x_publish_jobs(queue_id,status) VALUES (?,'ready')",
  ).bind(item.id).run();
  const job = await env.RELAY_DB.prepare(
    "SELECT * FROM x_publish_jobs WHERE queue_id=?",
  ).bind(item.id).first<Job>();
  if (!job || job.status !== "ready" || job.next_attempt_at > Math.floor(Date.now()/1000)) return;

  const tried = new Set(job.tried.split(",").filter(Boolean));
  const next = providers.find(p => !tried.has(p));
  if (!next) {
    await updateJob(env, item.id, "blocked", { error: "all_configured_providers_failed" });
    return;
  }

  if (!(await reserveXPostingBudget(env, item.id))) {
    await updateJob(env, item.id, "ready", {
      error: "posting_budget_or_cooldown", nextAt: nextRetry(900),
    });
    return;
  }
  if (!(await reserveJob(env, item.id, next, job.tried))) return;

  try {
    if (next === "buffer") {
      await storeProviderResult(env, item, next, await createBufferVideo(env, item));
    } else if (next === "zernio") {
      const result = await submitZernioVideo(env, item.id, "twitter");
      if (result.status === "published") {
        await markXPublished(env, item.id, next, result.platform_post_url || undefined);
      } else if (result.status === "scheduled" || result.status === "publishing") {
        await updateJob(env, item.id, "pending", {
          provider: next, remoteId: result.remote_post_id || undefined,
        });
      } else if ((result.status === "failed" && !result.platform_post_url) ||
          result.status === "failed_preflight") {
        await updateJob(env, item.id, "ready", {
          provider: next, error: result.error_code || "zernio_preflight", nextAt: nextRetry(600),
        });
      } else {
        await updateJob(env, item.id, "uncertain", {
          provider: next, error: result.error_code || result.status,
        });
      }
    } else {
      const result = await initializeDirectXMedia(env, item);
      if (result.kind === "processing") {
        await updateJob(env, item.id, "media_processing", {
          provider: next, mediaId: result.mediaId, mediaReady: Boolean(result.ready),
          nextAt: nextRetry(600),
        });
      } else {
        await storeProviderResult(env, item, next, result);
      }
    }
  } catch {
    // Fail closed: state 'submitting' is intentionally not retried after an exception.
    await updateJob(env, item.id, "uncertain", { provider: next, error: "provider_runtime_uncertain" });
  }
}

async function pendingJob(env: Env): Promise<Job | null> {
  return env.RELAY_DB.prepare(
    "SELECT * FROM x_publish_jobs WHERE " +
      "(status IN ('pending','media_processing') AND updated_at<=unixepoch()-900 " +
      "AND next_attempt_at<=unixepoch()) " +
      "ORDER BY updated_at ASC LIMIT 1",
  ).first<Job>();
}

export async function reconcileOnePublisher(env: Env): Promise<void> {
  if (env.X_PUBLISH_ENABLED !== "true") return;
  const job = await pendingJob(env);
  if (!job || !job.provider) return;
  const item = await env.RELAY_DB.prepare(
    "SELECT * FROM x_repost_queue WHERE id=?",
  ).bind(job.queue_id).first<XRepostItem>();
  if (!item || item.status === "cancelled") return;
  try {
    if (job.provider === "buffer" && job.remote_id) {
      const result = await checkBufferPost(env, job.remote_id);
      if (result.kind === "accepted") {
        if (result.status === "published") {
          await markXPublished(env, item.id, "buffer", result.url);
        } else {
          await updateJob(env, item.id, "pending", { provider: "buffer" });
        }
      } else if (result.kind === "rejected") {
        await storeProviderResult(env, item, "buffer", result);
      } else if (result.kind === "rate_limited") {
        await applyCooldown(env, result.retrySeconds);
        await updateJob(env, item.id, "pending", { error: "buffer_poll_limited" });
      } else {
        // Don't switch providers on ambiguous read errors.
        await updateJob(env, item.id, "pending", { error: result.code });
      }
    } else if (job.provider === "zernio") {
      const result = await refreshZernioSubmission(env, item.id, "twitter");
      if (result.status === "published") {
        await markXPublished(env, item.id, "zernio", result.platform_post_url || undefined);
      } else if (result.status === "failed") {
        await updateJob(env, item.id, "ready", {
          error: "zernio_confirmed_failure", nextAt: nextRetry(600),
        });
      } else {
        await updateJob(env, item.id, "pending", { provider: "zernio" });
      }
    } else if (job.provider === "x" && job.status === "media_processing" && job.media_id) {
      const result = await finishDirectXMedia(env, job.media_id, item, async () => {
        const claimed = await env.RELAY_DB.prepare(
          "UPDATE x_publish_jobs SET status='submitting', updated_at=unixepoch() " +
            "WHERE queue_id=? AND status='media_processing'",
        ).bind(item.id).run();
        return (claimed.meta.changes || 0) > 0;
      }, Boolean(job.media_ready));
      if (result.kind === "processing") {
        await updateJob(env, item.id, "media_processing", { nextAt: nextRetry(600) });
      } else if (result.kind === "rate_limited") {
        // Media was already uploaded: do not reinitialize it after a status/tweet 429.
        await applyCooldown(env, result.retrySeconds);
        await updateJob(env, item.id, "media_processing", {
          error: "x_media_rate_limited", nextAt: nextRetry(result.retrySeconds),
        });
      } else {
        await storeProviderResult(env, item, "x", result);
      }
    }
  } catch {
    // Non-GET upstream write may have succeeded; do not re-submit automatically.
    if (job.status === "media_processing") {
      await updateJob(env, item.id, "uncertain", { error: "x_processing_uncertain" });
    } else {
      await updateJob(env, item.id, "pending", { error: "provider_poll_unavailable" });
    }
  }
}

function targetChat(env: Env): { chat: string; topic?: number } | null {
  const setting = env.X_PUBLISH_NOTIFY_CHAT_ID || env.TELEGRAM_CHAT_ID ||
    env.NOTIFICATION_CHAT_ID || "";
  const match = setting.match(/^(-?\d+)(?::(\d+))?$/);
  if (!match) return null;
  return { chat: match[1]!, ...(match[2] ? { topic: Number(match[2]) } : {}) };
}

/**
 * Sends one Telegram notification for each confirmed successful X publication,
 * including manually confirmed Scriptable posts and older Zernio jobs.
 */
export async function notifyOnePublishedX(env: Env): Promise<void> {
  if (env.X_PUBLISH_NOTIFY_ENABLED !== "true") return;
  const target = targetChat(env);
  if (!env.TELEGRAM_BOT_TOKEN || !target) return;
  const row = await env.RELAY_DB.prepare(
    "SELECT q.id, q.source_url, q.post_url, j.provider FROM x_repost_queue q " +
      "LEFT JOIN x_publish_jobs j ON j.queue_id=q.id " +
      "WHERE q.status='posted' AND q.posted_at >= " +
      "(SELECT started_at FROM x_publish_notification_epoch WHERE id=1) " +
      "AND NOT EXISTS (SELECT 1 FROM x_publish_notifications n WHERE n.queue_id=q.id) " +
      "ORDER BY q.posted_at DESC LIMIT 1",
  ).first<{ id: string; source_url: string; post_url: string | null; provider: string | null }>();
  if (!row) return;
  const claimed = await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO x_publish_notifications(queue_id,status,provider) VALUES (?,'sending',?)",
  ).bind(row.id, row.provider || "manual").run();
  if (!claimed.meta.changes) return;
  const message = [
    "🎬 Vídeo publicado no X!",
    "",
    "Provedor: " + (row.provider || "publicação manual"),
    row.post_url || "Publicação confirmada (link não informado).",
    "",
    "Fonte: " + row.source_url,
  ].join("\n");

  try {
    const res = await fetch("https://api.telegram.org/bot" +
      env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.chat,
        ...(target.topic ? { message_thread_id: target.topic } : {}),
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const telegramResult = res.ok ? await res.json().catch(() => null) as { ok?: boolean } | null : null;
    await env.RELAY_DB.prepare(
      "UPDATE x_publish_notifications SET status=?,updated_at=unixepoch() WHERE queue_id=?",
    ).bind(res.ok && telegramResult?.ok === true ? "sent" : "uncertain", row.id).run();
  } catch {
    // Unknown Telegram delivery outcome: never risk spamming the same notification.
    await env.RELAY_DB.prepare(
      "UPDATE x_publish_notifications SET status='uncertain',updated_at=unixepoch() WHERE queue_id=?",
    ).bind(row.id).run();
  }
}
