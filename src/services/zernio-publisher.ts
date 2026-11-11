import type { Env } from "../types";
import { identifyXSource, repostDb, sanitizeRepostCaption, type XRepostItem } from "./x-repost-queue";

export type ZernioPlatform = "twitter" | "instagram";
export type ZernioState =
  | "preparing" | "failed_preflight" | "submitting" | "uncertain"
  | "scheduled" | "publishing" | "published" | "failed";

export interface ZernioSubmission {
  queue_id: string;
  platform: ZernioPlatform;
  account_id: string;
  idempotency_key: string;
  status: ZernioState;
  remote_post_id: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
}

interface ZernioPost {
  _id?: string;
  status?: string;
  platforms?: Array<{ platform?: string; status?: string; platformPostUrl?: string }>;
}

export class ZernioError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "ZernioError";
  }
}

const BASE = "https://zernio.com/api/v1";
const MAX_R2_BYTES = 80_000_000;
const SIX_DAYS = 6 * 24 * 3600;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeCode(value: unknown): string {
  return stringField(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 70) || "request_failed";
}

/**
 * All publisher adapters share the same caption policy, including queued legacy items.
 * Credits stay in the literal @/user format for both X and Instagram.
 */
export function normalizeZernioCaption(source: string, platform: ZernioPlatform): string {
  return sanitizeRepostCaption(source, [], platform === "instagram" ? 2200 : 280);
}

export function zernioIdempotencyKey(queueId: string, platform: ZernioPlatform): string {
  if (!/^[0-9a-f-]{36}$/i.test(queueId) || !["twitter", "instagram"].includes(platform)) {
    throw new ZernioError("invalid_queue_id");
  }
  return "rodx-" + queueId + "-" + platform;
}

export function buildZernioPost(
  caption: string,
  publicUrl: string,
  platform: ZernioPlatform,
  accountId: string,
  scheduledAt: number,
  now: number,
): Record<string, unknown> {
  if (!/^https:\/\//i.test(publicUrl)) throw new ZernioError("invalid_media_url");
  const base: Record<string, unknown> = {
    content: normalizeZernioCaption(caption, platform),
    mediaItems: [{ url: publicUrl, type: "video" }],
    platforms: [{ platform, accountId }],
  };
  if (scheduledAt > now + 120) {
    base.scheduledFor = new Date(scheduledAt * 1000).toISOString();
    base.timezone = "UTC";
  } else {
    base.publishNow = true;
  }
  return base;
}

export function isZernioEnabled(env: Env): boolean {
  return env.ZERNIO_ENABLED === "true" && Boolean(env.ZERNIO_API_KEY);
}

function configuredAccount(env: Env, platform: ZernioPlatform): string {
  const id = platform === "twitter"
    ? env.ZERNIO_TWITTER_ACCOUNT_ID : env.ZERNIO_INSTAGRAM_ACCOUNT_ID;
  if (!id || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    throw new ZernioError("zernio_account_not_configured", 409);
  }
  return id;
}

async function zernioRequest(
  env: Env,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string } = {},
): Promise<Record<string, unknown>> {
  if (!env.ZERNIO_API_KEY) throw new ZernioError("zernio_key_not_configured", 503);
  const response = await fetch(BASE + path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + env.ZERNIO_API_KEY,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  // Never include response headers, request headers, upstream bodies or credentials in thrown errors.
  const body = record(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw new ZernioError(
      "zernio_http_" + response.status + "_" + safeCode(body.code),
      response.status,
    );
  }
  return body;
}

export async function listZernioAccounts(env: Env): Promise<Array<Record<string, unknown>>> {
  const payload = await zernioRequest(env, "/accounts");
  return (Array.isArray(payload.accounts) ? payload.accounts : [])
    .map(record)
    .filter(item => item.platform === "twitter" || item.platform === "instagram")
    .map(item => ({
      id: stringField(item._id),
      platform: item.platform,
      username: stringField(item.username),
      active: item.isActive === true,
      needsReconnection: item.needsReconnection === true,
    }));
}

export async function getZernioSubmission(
  env: Env,
  queueId: string,
  platform: ZernioPlatform,
): Promise<ZernioSubmission | null> {
  return await repostDb(env).prepare(
    "SELECT * FROM x_repost_zernio_submissions WHERE queue_id = ? AND platform = ?",
  ).bind(queueId, platform).first<ZernioSubmission>();
}

async function updateSubmission(
  env: Env,
  queueId: string,
  platform: ZernioPlatform,
  status: ZernioState,
  remoteId: string | null = null,
  postUrl: string | null = null,
  error: string | null = null,
): Promise<void> {
  await repostDb(env).prepare(
    "UPDATE x_repost_zernio_submissions SET status = ?, remote_post_id = COALESCE(?, remote_post_id), " +
      "platform_post_url = COALESCE(?, platform_post_url), error_code = ?, updated_at = unixepoch() " +
      "WHERE queue_id = ? AND platform = ?",
  ).bind(status, remoteId, postUrl, error, queueId, platform).run();
}

function classifyPost(post: ZernioPost, platform: ZernioPlatform): {
  state: ZernioState; postUrl: string | null;
} {
  const target = post.platforms?.find(entry => entry.platform === platform);
  const status = target?.status || post.status || "";
  const state: ZernioState = status === "published" ? "published"
    : status === "failed" || status === "cancelled" ? "failed"
    : status === "scheduled" ? "scheduled"
    : "publishing";
  const url = target?.platformPostUrl || null;
  const safeUrl = url && /^https:\/\//i.test(url) ? url : null;
  return { state, postUrl: safeUrl };
}

async function applyPostResult(
  env: Env,
  item: XRepostItem,
  platform: ZernioPlatform,
  post: ZernioPost,
): Promise<ZernioSubmission | null> {
  const remoteId = stringField(post._id);
  const result = classifyPost(post, platform);
  await updateSubmission(env, item.id, platform, result.state, remoteId || null, result.postUrl);
  if (platform === "twitter" && result.state === "published") {
    const validUrl = result.postUrl && identifyXSource(result.postUrl)
      ? result.postUrl : null;
    // A Zernio job is not a published X post until its platform status says published.
    await repostDb(env).prepare(
      "UPDATE x_repost_queue SET status = 'posted', posted_at = unixepoch(), " +
        "post_url = ?, claim_token = NULL, lease_until = 0, updated_at = unixepoch() " +
        "WHERE id = ? AND status = 'queued'",
    ).bind(validUrl, item.id).run();
  }
  return getZernioSubmission(env, item.id, platform);
}

export async function submitZernioVideo(
  env: Env,
  queueId: string,
  platform: ZernioPlatform,
): Promise<ZernioSubmission> {
  if (!isZernioEnabled(env)) throw new ZernioError("zernio_disabled", 503);
  if (platform !== "twitter" && platform !== "instagram") {
    throw new ZernioError("invalid_platform");
  }
  const accountId = configuredAccount(env, platform);
  const item = await repostDb(env).prepare(
    "SELECT * FROM x_repost_queue WHERE id = ?",
  ).bind(queueId).first<XRepostItem>();
  if (!item) throw new ZernioError("queue_item_not_found", 404);
  if (platform === "twitter") {
    const pipeline = await repostDb(env).prepare(
      "SELECT provider, status FROM x_publish_jobs WHERE queue_id = ?",
    ).bind(item.id).first<{ provider: string | null; status: string }>();
    if (pipeline && !(pipeline.provider === "zernio" && pipeline.status === "submitting")) {
      throw new ZernioError("managed_by_x_publisher_pipeline", 409);
    }
  }
  // Publishing to Instagram must remain possible after the X repost was confirmed.
  if (item.status !== "queued" && !(platform === "instagram" && item.status === "posted")) {
    throw new ZernioError("queue_item_not_available", 409);
  }
  if (!env.X_REPOST_MEDIA || !item.media_object_key) {
    throw new ZernioError("r2_video_not_ready", 409);
  }
  const now = Math.floor(Date.now() / 1000);
  if (item.scheduled_at > now + SIX_DAYS) {
    throw new ZernioError("schedule_exceeds_media_retention", 409);
  }
  const caption = normalizeZernioCaption(item.caption, platform);
  const media = await env.X_REPOST_MEDIA.get(item.media_object_key);
  if (!media?.body || media.size <= 0 || media.size > MAX_R2_BYTES) {
    throw new ZernioError("r2_video_missing_or_oversized", 409);
  }
  const idempotencyKey = zernioIdempotencyKey(item.id, platform);
  const db = repostDb(env);
  const inserted = await db.prepare(
    "INSERT INTO x_repost_zernio_submissions " +
      "(queue_id, platform, account_id, idempotency_key, status) " +
      "VALUES (?, ?, ?, ?, 'preparing') ON CONFLICT(queue_id, platform) DO NOTHING",
  ).bind(item.id, platform, accountId, idempotencyKey).run();

  if (!inserted.meta.changes) {
    const existing = await getZernioSubmission(env, item.id, platform);
    if (!existing) throw new ZernioError("submission_conflict", 409);
    if (existing.status !== "failed_preflight") return existing;
    // Only preflight failures can be retried. No upstream POST /posts was attempted.
    const claimed = await db.prepare(
      "UPDATE x_repost_zernio_submissions SET status = 'preparing', " +
        "error_code = NULL, updated_at = unixepoch() " +
        "WHERE queue_id = ? AND platform = ? AND status = 'failed_preflight'",
    ).bind(item.id, platform).run();
    if (!claimed.meta.changes) return (await getZernioSubmission(env, item.id, platform))!;
  }

  let postStarted = false;
  try {
    const presign = await zernioRequest(env, "/media/presign", {
      method: "POST",
      body: { filename: "rodx-" + item.id + ".mp4", contentType: "video/mp4", size: media.size },
    });
    const uploadUrl = stringField(presign.uploadUrl);
    const publicUrl = stringField(presign.publicUrl);
    if (!uploadUrl.startsWith("https://") || !publicUrl.startsWith("https://")) {
      throw new ZernioError("invalid_presigned_upload");
    }
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4" },
      body: media.body,
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) throw new ZernioError("media_upload_failed_" + upload.status, 502);
    // Mark the D1 record BEFORE creating a post. A timeout must not create a duplicate.
    await updateSubmission(env, item.id, platform, "submitting");
    postStarted = true;
    const result = await zernioRequest(env, "/posts", {
      method: "POST",
      idempotencyKey,
      body: buildZernioPost(caption, publicUrl, platform, accountId, item.scheduled_at, now),
    });
    const post = record(result.post) as ZernioPost;
    if (!stringField(post._id)) throw new ZernioError("post_response_missing_id", 502);
    return (await applyPostResult(env, item, platform, post))!;
  } catch (error) {
    // Unknown outcomes are NEVER retried automatically, even with the 24h idempotency window.
    await updateSubmission(
      env, item.id, platform, postStarted ? "uncertain" : "failed_preflight",
      null, null, error instanceof ZernioError ? error.code : "network_or_runtime_error",
    );
    return (await getZernioSubmission(env, item.id, platform))!;
  }
}

export async function refreshZernioSubmission(
  env: Env, queueId: string, platform: ZernioPlatform,
): Promise<ZernioSubmission> {
  const existing = await getZernioSubmission(env, queueId, platform);
  if (!existing) throw new ZernioError("submission_not_found", 404);
  if (!existing.remote_post_id) return existing;
  const result = await zernioRequest(env, "/posts/" + encodeURIComponent(existing.remote_post_id));
  const item = await repostDb(env).prepare(
    "SELECT * FROM x_repost_queue WHERE id = ?",
  ).bind(queueId).first<XRepostItem>();
  if (!item) throw new ZernioError("queue_item_not_found", 404);
  return (await applyPostResult(env, item, platform, record(result.post) as ZernioPost))!;
}

export async function processOneDueZernio(env: Env): Promise<void> {
  if (!isZernioEnabled(env) || env.ZERNIO_AUTO_PUBLISH !== "true") return;
  const platform = env.ZERNIO_AUTO_PLATFORM;
  if (platform !== "twitter" && platform !== "instagram") return;
  configuredAccount(env, platform);
  const item = await repostDb(env).prepare(
    "SELECT q.id FROM x_repost_queue q " +
      "WHERE q.status = 'queued' AND q.scheduled_at <= unixepoch() " +
      "AND q.media_object_key IS NOT NULL " +
      "AND NOT EXISTS (SELECT 1 FROM x_repost_zernio_submissions z " +
      "WHERE z.queue_id = q.id AND z.platform = ?) " +
      "ORDER BY q.scheduled_at ASC LIMIT 1",
  ).bind(platform).first<{ id: string }>();
  if (item) await submitZernioVideo(env, item.id, platform);
}

export async function refreshOnePendingZernio(env: Env): Promise<void> {
  if (!isZernioEnabled(env)) return;
  const row = await repostDb(env).prepare(
    "SELECT queue_id, platform FROM x_repost_zernio_submissions " +
      "WHERE status IN ('scheduled', 'publishing') AND remote_post_id IS NOT NULL " +
      "AND updated_at < unixepoch() - 300 ORDER BY updated_at ASC LIMIT 1",
  ).first<{ queue_id: string; platform: ZernioPlatform }>();
  if (row) await refreshZernioSubmission(env, row.queue_id, row.platform);
}
