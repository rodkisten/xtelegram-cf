import type { Env } from "../types";
import { handleSend } from "../routes/send";
import { json } from "../http/response";
import { cloneAuthorizedJsonRequest } from "../http/internal-request";

type Payload = Record<string, unknown>;
const HOUR = 3_600_000;
const MAX_ATTEMPTS = 24;
const RETRY_HEADER = "x-relay-retry-queue";

function hasResolvedMedia(body: Payload): boolean {
  const direct = typeof body.mediaUrl === "string" && /^https?:\/\//i.test(body.mediaUrl);
  const album = Array.isArray(body.mediaItems) && body.mediaItems.length > 0 &&
    body.mediaItems.every((item) => item && typeof item === "object" &&
      typeof (item as Payload).mediaUrl === "string" &&
      /^https?:\/\//i.test((item as Payload).mediaUrl as string));
  return direct || album;
}

function isVideo(body: Payload): boolean {
  return body.mediaType === "video" ||
    (Array.isArray(body.mediaItems) && body.mediaItems.some((item) =>
      item && typeof item === "object" && (item as Payload).mediaType === "video"));
}

async function fingerprint(body: Payload): Promise<string> {
  const normalized = JSON.stringify(body);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function failureIsAmbiguous(result: Payload, status: number): boolean {
  if (status >= 500 || status === 408 || status === 409) return true;
  const channels = result.channels as Payload | undefined;
  const notSent = Array.isArray(channels?.notSent) ? channels.notSent : [];
  return notSent.some((item) => {
    const failure = item as Payload;
    const code = Number(failure.httpStatus || 0);
    return !code || code >= 500 || code === 408;
  });
}

async function queueFailure(env: Env, body: Payload, result: Payload, status: number): Promise<string> {
  const id = await fingerprint(body);
  const now = Date.now();
  await env.RELAY_DB.prepare(
    `INSERT INTO resolved_video_retry
      (id, payload_json, last_result_json, status, attempts, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_result_json = excluded.last_result_json,
        updated_at = excluded.updated_at,
        status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
        next_attempt_at = CASE WHEN status = 'completed' THEN next_attempt_at ELSE excluded.next_attempt_at END`,
  ).bind(id, JSON.stringify(body), JSON.stringify({ status, result }).slice(0, 16000),
    now + HOUR, now, now).run();
  return id;
}

/** Only genuinely resolved video media is eligible. Never mask resolver errors. */
export async function sendWithRecovery(request: Request, env: Env): Promise<Response> {
  if (request.headers.get(RETRY_HEADER) === "1") return handleSend(request, env);
  const raw = await request.clone().json().catch(() => null);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Payload : null;
  const response = await handleSend(request, env);
  if (!body || !hasResolvedMedia(body) || !isVideo(body) || response.status < 400 && response.status !== 207) {
    return response;
  }
  const result = await response.clone().json().catch(() => ({})) as Payload;
  // Do not automatically replay ambiguous writes: Telegram may have accepted them.
  if (failureIsAmbiguous(result, response.status)) return response;
  try {
    const id = await queueFailure(env, body, result, response.status);
    return json({
      ok: true,
      queued: true,
      retryId: id,
      status: "pending",
      nextRetryInSeconds: 3600,
      message: "Video media resolved; delivery queued for automatic recovery",
      originalStatus: response.status,
      channels: result.channels ?? null,
    }, 202);
  } catch (error) {
    console.error("[video-retry] persistence failed", error instanceof Error ? error.message : "unknown");
    return response;
  }
}

export async function processResolvedVideoRetry(env: Env): Promise<void> {
  const now = Date.now();
  const records = await env.RELAY_DB.prepare(
    "SELECT id, payload_json, attempts FROM resolved_video_retry WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 5",
  ).bind(now).all<{ id: string; payload_json: string; attempts: number }>();
  for (const item of records.results || []) {
    const claimed = await env.RELAY_DB.prepare(
      "UPDATE resolved_video_retry SET status = 'processing', lease_until = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND next_attempt_at <= ?",
    ).bind(now + 300_000, now, item.id, now).run();
    if (claimed.meta.changes !== 1) continue;
    try {
      const body = JSON.parse(item.payload_json) as Payload;
      const request = cloneAuthorizedJsonRequest(
        new Request("https://relay.internal/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", [RETRY_HEADER]: "1" },
        }), body);
      const response = await handleSend(request, env);
      const result = await response.clone().json().catch(() => ({})) as Payload;
      const attempts = item.attempts + 1;
      const ambiguous = failureIsAmbiguous(result, response.status);
      const done = response.ok && response.status !== 207;
      const status = done ? "completed" : ambiguous ? "needs_review" :
        attempts >= MAX_ATTEMPTS ? "dead_letter" : "pending";
      await env.RELAY_DB.prepare(
        "UPDATE resolved_video_retry SET status = ?, attempts = ?, last_result_json = ?, next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'processing'",
      ).bind(status, attempts, JSON.stringify({ status: response.status, result }).slice(0, 16000),
        now + HOUR, Date.now(), item.id).run();
    } catch (error) {
      await env.RELAY_DB.prepare(
        "UPDATE resolved_video_retry SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?, lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'processing'",
      ).bind(now + HOUR, Date.now(), item.id).run();
      console.warn("[video-retry] retry failed", item.id, error instanceof Error ? error.message : "unknown");
    }
  }
}

export async function recoverExpiredVideoLeases(env: Env): Promise<void> {
  await env.RELAY_DB.prepare(
    "UPDATE resolved_video_retry SET status = 'needs_review', lease_until = NULL, updated_at = ? WHERE status = 'processing' AND lease_until < ?",
  ).bind(Date.now(), Date.now()).run();
}
