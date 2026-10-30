import type { Env } from "../types";
import { json } from "../http/response";

/**
 * /rodx/v1: independent, principal-scoped browser synchronization.
 * NEVER authorize with RELAY_TOKEN or a client-supplied @handle.
 * Every query includes the principal derived from a dedicated bearer key.
 */
type Principal = { id: string; label: string };
const MAX_SNAPSHOT_BYTES = 900_000;
const MAX_BATCH = 100;
const NAME = /^[\p{L}\p{N}_.:@-]{1,128}$/u;

function failure(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}
function accountId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!NAME.test(id)) throw new Error("Invalid account identifier");
  return id;
}
async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function principal(request: Request, env: Env): Promise<Principal | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match?.[1] || match[1].length < 24 || match[1].length > 256) return null;
  const hash = await digest(match[1]);
  const result = await env.RELAY_DB.prepare(
    `SELECT u.id, u.label FROM rodx_tokens t
     JOIN rodx_users u ON u.id = t.user_id
     WHERE t.token_sha256 = ?1 AND t.revoked_at IS NULL`
  ).bind(hash).first<Principal>();
  return result ?? null;
}
async function bodyJSON(request: Request, max = MAX_SNAPSHOT_BYTES): Promise<any> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > max) throw new Error("Request body too large");
  try { return JSON.parse(raw); }
  catch { throw new Error("Malformed JSON"); }
}
function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}
function validSnapshot(value: any): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Array.isArray(value.searches) && Array.isArray(value.presets)
    && (value.visual == null || typeof value.visual === "object")
    && value.searches.length <= 2000 && value.presets.length <= 2000);
}

export async function handleRodx(request: Request, env: Env): Promise<Response> {
  const actor = await principal(request, env);
  if (!actor) return failure("A personal RodX access key is required", 401);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;
  if (path === "/rodx/v1/me" && method === "GET") {
    return json({ ok: true, user: actor });
  }
  try {
    const input = method === "GET" || method === "DELETE" ? null : await bodyJSON(request);
    const account = accountId(input?.account ?? url.searchParams.get("account"));
    if (path === "/rodx/v1/snapshot") {
      const getCurrent = () => env.RELAY_DB.prepare(
        "SELECT revision, data_json, updated_at FROM rodx_snapshots WHERE user_id=?1 AND account=?2"
      ).bind(actor.id, account).first<{ revision: number; data_json: string; updated_at: number }>();
      if (method === "GET") {
        const current = await getCurrent();
        return json({ ok: true, account, revision: current?.revision ?? 0,
          data: current ? JSON.parse(current.data_json) : null, updatedAt: current?.updated_at ?? null });
      }
      if (method === "PUT") {
        if (!validSnapshot(input?.data)) return failure("Invalid snapshot schema");
        const base = int(input.baseRevision, -1, -1, 2147483647);
        if (base < 0) return failure("baseRevision is required");
        const data = JSON.stringify(input.data);
        if (new TextEncoder().encode(data).byteLength > MAX_SNAPSHOT_BYTES)
          return failure("Snapshot exceeds 900 KB", 413);
        let changes = 0;
        if (base === 0) {
          const result = await env.RELAY_DB.prepare(
            `INSERT INTO rodx_snapshots(user_id,account,revision,data_json)
             VALUES(?1,?2,1,?3) ON CONFLICT(user_id,account) DO NOTHING`
          ).bind(actor.id, account, data).run();
          changes = result.meta.changes ?? 0;
        } else {
          const result = await env.RELAY_DB.prepare(
            `UPDATE rodx_snapshots SET revision=revision+1,data_json=?1,updated_at=unixepoch()
             WHERE user_id=?2 AND account=?3 AND revision=?4`
          ).bind(data, actor.id, account, base).run();
          changes = result.meta.changes ?? 0;
        }
        if (!changes) {
          const current = await getCurrent();
          return json({ ok: false, error: "revision_conflict", account,
            revision: current?.revision ?? 0, data: current ? JSON.parse(current.data_json) : null }, 409);
        }
        const saved = await getCurrent();
        return json({ ok: true, account, revision: saved?.revision ?? base + 1 });
      }
    }
    if (path === "/rodx/v1/history") {
      if (method === "GET") {
        const limit = int(url.searchParams.get("limit"), 100, 1, 500);
        const offset = int(url.searchParams.get("offset"), 0, 0, 1000000);
        const rows = await env.RELAY_DB.prepare(
          `SELECT query_sha256 AS hash,query,sort,source,first_used AS firstUsed,
           last_used AS lastUsed,use_count AS count FROM rodx_history
           WHERE user_id=?1 AND account=?2 ORDER BY last_used DESC LIMIT ?3 OFFSET ?4`
        ).bind(actor.id, account, limit + 1, offset).all();
        const values = rows.results || [];
        return json({ ok: true, account, entries: values.slice(0, limit),
          hasMore: values.length > limit, nextOffset: offset + Math.min(values.length, limit) });
      }
      if (method === "POST") {
        if (!Array.isArray(input.entries) || input.entries.length > MAX_BATCH) return failure("Expected up to 100 entries");
        let accepted = 0;
        for (const item of input.entries) {
          const query = String(item?.query ?? "").trim().replace(/\s+/gu, " ").slice(0, 4000);
          if (!query) continue;
          const hash = await digest(query);
          const now = Date.now();
          const first = int(item.firstUsed, now, 0, 9000000000000000);
          const last = int(item.lastUsed, now, 0, 9000000000000000);
          await env.RELAY_DB.prepare(
            `INSERT INTO rodx_history(user_id,account,query_sha256,query,sort,source,first_used,last_used,use_count)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(user_id,account,query_sha256) DO UPDATE SET
               last_used=MAX(rodx_history.last_used,excluded.last_used),
               first_used=MIN(rodx_history.first_used,excluded.first_used),
               use_count=MAX(rodx_history.use_count,excluded.use_count),
               sort=CASE WHEN excluded.last_used>=rodx_history.last_used THEN excluded.sort ELSE rodx_history.sort END,
               source=CASE WHEN excluded.last_used>=rodx_history.last_used THEN excluded.source ELSE rodx_history.source END`
          ).bind(actor.id, account, hash, query, String(item.sort ?? "top").slice(0, 20),
            String(item.source ?? "search").slice(0, 30), first, last,
            int(item.count, 1, 1, 100000000)).run();
          accepted++;
        }
        return json({ ok: true, accepted });
      }
      if (method === "DELETE") {
        const hash = url.searchParams.get("hash");
        const result = hash
          ? await env.RELAY_DB.prepare(
            "DELETE FROM rodx_history WHERE user_id=?1 AND account=?2 AND query_sha256=?3"
          ).bind(actor.id, account, hash).run()
          : await env.RELAY_DB.prepare(
            "DELETE FROM rodx_history WHERE user_id=?1 AND account=?2"
          ).bind(actor.id, account).run();
        return json({ ok: true, deleted: result.meta.changes ?? 0 });
      }
    }
    if (path === "/rodx/v1/seen") {
      if (method === "GET") {
        const since = int(url.searchParams.get("since"), 0, 0, 9000000000000000);
        const limit = int(url.searchParams.get("limit"), 500, 1, 1000);
        const offset = int(url.searchParams.get("offset"), 0, 0, 1000000);
        const rows = await env.RELAY_DB.prepare(
          `SELECT tweet_id AS id,seen_at AS at FROM rodx_seen
           WHERE user_id=?1 AND account=?2 AND seen_at>=?3
           ORDER BY seen_at ASC, tweet_id ASC LIMIT ?4 OFFSET ?5`
        ).bind(actor.id, account, since, limit, offset).all();
        return json({ ok: true, account, entries: rows.results ?? [] });
      }
      if (method === "POST") {
        if (!Array.isArray(input.entries) || input.entries.length > MAX_BATCH) return failure("Expected up to 100 entries");
        let accepted = 0;
        for (const item of input.entries) {
          const tweet = String(item?.id ?? "");
          if (!/^\d{4,24}$/.test(tweet)) continue;
          const at = int(item.at, Date.now(), 0, 9000000000000000);
          await env.RELAY_DB.prepare(
            `INSERT INTO rodx_seen(user_id,account,tweet_id,seen_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(user_id,account,tweet_id) DO UPDATE SET
             seen_at=MAX(rodx_seen.seen_at,excluded.seen_at)`
          ).bind(actor.id, account, tweet, at).run();
          accepted++;
        }
        return json({ ok: true, accepted });
      }
    }
    return failure("Method or path not found", 404);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Invalid request", 400);
  }
}
