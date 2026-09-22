import { findStoredMedia, getStoredMedia, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import type { Env } from "../../types";

export async function handleMediaQuery(request: Request, env: Env): Promise<Response> {
  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const url = new URL(request.url);
  let pathKey = "";
  if (url.pathname.startsWith("/media/")) {
    try {
      pathKey = decodeURIComponent(url.pathname.slice("/media/".length));
    } catch {
      return json({ ok: false, error: "Invalid percent-encoding in media key" }, 400);
    }
  }

  const key = pathKey || url.searchParams.get("key") || "";
  try {
    if (key) {
      const record = await getStoredMedia(db, key);
      return record
        ? json({ ok: true, ...record })
        : json({ ok: false, error: "Media not found", key }, 404);
    }

    const limitValue = Number(url.searchParams.get("limit") || 25);
    const items = await findStoredMedia(db, {
      provider: url.searchParams.get("provider"),
      mediaId: url.searchParams.get("mediaId"),
      sourceUrl: url.searchParams.get("sourceUrl"),
      limit: Number.isFinite(limitValue) ? limitValue : 25,
    });
    return json({ ok: true, count: items.length, items });
  } catch (error) {
    return json(
      { ok: false, error: getErrorMessage(error), stage: "database-query" },
      500,
    );
  }
}
