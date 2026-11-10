import type { Env } from "../types";
import { json } from "../http/response";
import {
  ZernioError,
  getZernioSubmission,
  isZernioEnabled,
  listZernioAccounts,
  refreshZernioSubmission,
  submitZernioVideo,
  type ZernioPlatform,
} from "../services/zernio-publisher";

const allowed = new Set(["twitter", "instagram"]);

function platformOf(value: unknown): ZernioPlatform {
  if (!allowed.has(value as string)) throw new ZernioError("invalid_platform");
  return value as ZernioPlatform;
}

export async function handleZernioRepost(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();
  try {
    if (path === "/x/repost/zernio/status" && method === "GET") {
      return json({
        ok: true,
        configured: Boolean(env.ZERNIO_API_KEY),
        enabled: isZernioEnabled(env),
        automatic: env.ZERNIO_AUTO_PUBLISH === "true",
        autoPlatform: env.ZERNIO_AUTO_PLATFORM || null,
        twitterConfigured: Boolean(env.ZERNIO_TWITTER_ACCOUNT_ID),
        instagramConfigured: Boolean(env.ZERNIO_INSTAGRAM_ACCOUNT_ID),
      });
    }
    if (path === "/x/repost/zernio/accounts" && method === "GET") {
      return json({ ok: true, accounts: await listZernioAccounts(env) });
    }
    if (path === "/x/repost/zernio/jobs" && method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
      const rows = await env.RELAY_DB.prepare(
        "SELECT * FROM x_repost_zernio_submissions ORDER BY updated_at DESC LIMIT ?",
      ).bind(limit).all();
      return json({ ok: true, items: rows.results || [] });
    }
    if (method !== "POST") return json({ ok: false, error: "not_found" }, 404);
    if (path !== "/x/repost/zernio/submit" && path !== "/x/repost/zernio/refresh") {
      return json({ ok: false, error: "not_found" }, 404);
    }
    const payload = await request.json() as Record<string, unknown>;
    const queueId = String(payload.queueId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(queueId)) {
      throw new ZernioError("invalid_queue_id");
    }
    const platform = platformOf(payload.platform);
    if (path.endsWith("/refresh")) {
      return json({ ok: true, item: await refreshZernioSubmission(env, queueId, platform) });
    }
    // The Relay client must deliberately request publication. Never publish on a GET.
    if (payload.confirmPublish !== true) throw new ZernioError("explicit_confirmation_required");
    const item = await submitZernioVideo(env, queueId, platform);
    return json({ ok: true, item, published: item.status === "published" });
  } catch (error) {
    if (error instanceof ZernioError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    // Never echo provider responses or credentials to callers.
    return json({ ok: false, error: "zernio_internal_error" }, 502);
  }
}
