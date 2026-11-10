import type { Env } from "../types";
import { json } from "../http/response";
import {
  publisherStats,
  runOneDuePublisher,
} from "../services/x-publish-pipeline";

export async function handleXPublisher(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/$/, "");
  try {
    if (path === "/x/repost/publisher/status" && method === "GET") {
      return json({ ok: true, ...(await publisherStats(env)) });
    }
    if (path === "/x/repost/publisher/jobs" && method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      const rows = await env.RELAY_DB.prepare(
        "SELECT queue_id,provider,status,tried,remote_id,post_url,error_code," +
          "next_attempt_at,created_at,updated_at FROM x_publish_jobs " +
          "ORDER BY updated_at DESC LIMIT ?",
      ).bind(limit).all();
      return json({ ok: true, items: rows.results || [] });
    }
    if (path === "/x/repost/publisher/run" && method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      if (body.confirmPublish !== true) {
        return json({ ok: false, error: "explicit_confirmation_required" }, 400);
      }
      if (env.X_PUBLISH_ENABLED !== "true") {
        return json({ ok: false, error: "publisher_disabled" }, 503);
      }
      const id = String(body.queueId || "").trim();
      if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ ok: false, error: "invalid_queue_id" }, 400);
      await runOneDuePublisher(env, id);
      const job = await env.RELAY_DB.prepare(
        "SELECT queue_id,provider,status,tried,remote_id,post_url,error_code," +
          "next_attempt_at FROM x_publish_jobs WHERE queue_id=?",
      ).bind(id).first();
      return json({ ok: true, job: job || null });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch {
    return json({ ok: false, error: "publisher_unavailable" }, 503);
  }
}
