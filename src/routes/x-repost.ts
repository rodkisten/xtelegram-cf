import type { Env } from "../types";
import { json } from "../http/response";
import {
  claimDueXRepost,
  enqueueXRepost,
  identifyXSource,
  listXReposts,
  repostDb,
  transitionXRepost,
  type XRepostStatus,
} from "../services/x-repost-queue";

const STATUSES = new Set(["queued", "claimed", "posted", "cancelled"]);
const MAX_UPLOAD_BYTES = 80_000_000;

export async function handleXRepost(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();

  try {
    if (path === "/x/repost/queue" && method === "GET") {
      const requested = url.searchParams.get("status");
      if (requested && !STATUSES.has(requested)) return json({ ok: false, error: "Invalid status" }, 400);
      const items = await listXReposts(env, requested as XRepostStatus | null,
        Number(url.searchParams.get("limit") || 30));
      return json({ ok: true, items, count: items.length });
    }

    if (path === "/x/repost/queue" && method === "POST") {
      const payload = await request.json() as Record<string, unknown>;
      const item = await enqueueXRepost(env, {
        sourceUrl: String(payload.sourceUrl || payload.url || ""),
        caption: typeof payload.caption === "string" ? payload.caption : "",
        hashtags: Array.isArray(payload.hashtags) || typeof payload.hashtags === "string"
          ? payload.hashtags as string[] | string : [],
        mediaUrl: typeof payload.mediaUrl === "string" ? payload.mediaUrl : null,
        telegramMessageUrl: typeof payload.telegramMessageUrl === "string"
          ? payload.telegramMessageUrl : null,
        scheduledAt: payload.scheduledAt == null ? null : Number(payload.scheduledAt),
      });
      return json({ ok: true, item }, 200);
    }

    if (path === "/x/repost/claim" && method === "POST") {
      const item = await claimDueXRepost(env);
      return json({ ok: true, item });
    }

    const match = path.match(/^\/x\/repost\/queue\/([A-Za-z0-9-]+)(?:\/(media))?$/);
    if (!match) return json({ ok: false, error: "Route not found" }, 404);
    const id = match[1]!;

    if (match[2] === "media") {
      if (method === "GET") return getXRepostMedia(env, id);
      if (method === "PUT") return putXRepostMedia(request, env, id);
      return json({ ok: false, error: "Unsupported method" }, 405);
    }

    if (method !== "PATCH") return json({ ok: false, error: "Unsupported method" }, 405);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");
    if (!["posted", "release", "cancel", "reschedule"].includes(action)) {
      return json({ ok: false, error: "Invalid action" }, 400);
    }
    const item = await transitionXRepost(
      env,
      id,
      action as "posted" | "release" | "cancel" | "reschedule",
      String(payload.claimToken || ""),
      typeof payload.postUrl === "string" ? payload.postUrl : "",
      payload.scheduledAt == null ? undefined : Number(payload.scheduledAt),
    );
    return item
      ? json({ ok: true, item })
      : json({ ok: false, error: "Item not found or claim token expired" }, 409);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const badRequest = /invalid|require|must|exceed|public|url/i.test(message);
    return json({ ok: false, error: message }, badRequest ? 400 : 500);
  }
}

async function getXRepostMedia(env: Env, id: string): Promise<Response> {
  if (!env.X_REPOST_MEDIA) return json({ ok: false, error: "R2 media binding not configured" }, 503);
  const item = await repostDb(env).prepare("SELECT media_object_key FROM x_repost_queue WHERE id = ?")
    .bind(id).first<{ media_object_key: string | null }>();
  if (!item?.media_object_key) return json({ ok: false, error: "Video not stored in R2" }, 404);

  const object = await env.X_REPOST_MEDIA.get(item.media_object_key);
  if (!object) return json({ ok: false, error: "R2 object missing" }, 404);
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "video/mp4",
      "Content-Disposition": `attachment; filename="x-repost-${id}.mp4"`,
      "Cache-Control": "private, no-store",
      "Content-Length": String(object.size),
    },
  });
}

async function putXRepostMedia(request: Request, env: Env, id: string): Promise<Response> {
  if (!env.X_REPOST_MEDIA) return json({ ok: false, error: "R2 media binding not configured" }, 503);
  const row = await repostDb(env).prepare("SELECT id, status FROM x_repost_queue WHERE id = ?")
    .bind(id).first<{ id: string; status: XRepostStatus }>();
  if (!row || row.status === "posted" || row.status === "cancelled") {
    return json({ ok: false, error: "Queue item cannot accept media" }, 409);
  }

  const bytes = Number(request.headers.get("Content-Length") || 0);
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim() || "";
  if (!bytes || bytes > MAX_UPLOAD_BYTES || contentType !== "video/mp4" || !request.body) {
    return json({ ok: false, error: "Provide MP4 with Content-Length from 1 to 80 MB" }, 413);
  }

  const key = `x-repost/${id}.mp4`;
  await env.X_REPOST_MEDIA.put(key, request.body, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: { queueId: id },
  });
  await repostDb(env).prepare(
    "UPDATE x_repost_queue SET media_object_key = ?, updated_at = unixepoch() WHERE id = ?"
  ).bind(key, id).run();
  return json({ ok: true, stored: true, bytes, id });
}

/** Optional Telegram reminder. Does not publish on X or trigger iOS apps remotely. */
export async function notifyDueXReposts(env: Env): Promise<void> {
  const chatId = String(env.X_REPOST_NOTIFY_CHAT_ID || "").trim();
  if (!chatId || !env.TELEGRAM_BOT_TOKEN) return;

  const now = Math.floor(Date.now() / 1000);
  const rows = (await repostDb(env).prepare(`
    SELECT id, source_url FROM x_repost_queue
    WHERE status = 'queued' AND scheduled_at <= ? AND notified_at IS NULL
    ORDER BY scheduled_at ASC LIMIT 3
  `).bind(now).all<{ id: string; source_url: string }>()).results;

  for (const row of rows) {
    const message = [
      "📅 Vídeo pronto para publicar no X",
      "",
      "Abra o Scriptable e execute Relay X Queue para compartilhar o vídeo e confirmar o post.",
      row.source_url,
    ].join("\n");
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    });
    if (response.ok) {
      await repostDb(env).prepare(`
        UPDATE x_repost_queue SET notified_at = ?, updated_at = ?
        WHERE id = ? AND notified_at IS NULL AND status = 'queued'
      `).bind(now, now, row.id).run();
    } else {
      console.warn("[x-repost] Telegram reminder failed", response.status);
    }
  }
}
