import type { Env } from "../types";
import { json } from "../http/response";

const PREFIX = "/x/repost/public-media/";
const encoder = new TextEncoder();
const TTL_SECONDS = 20 * 3600;

function idFromPath(path: string): string | null {
  const id = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : "";
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id : null;
}

async function hmac(env: Env): Promise<CryptoKey> {
  const secret = env.X_PUBLISH_MEDIA_SIGNING_KEY || "";
  if (secret.length < 32) throw new Error("signed_media_not_configured");
  return crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

function toHex(data: ArrayBuffer): string {
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, "0")).join("");
}

export async function signedMediaUrl(
  env: Env,
  queueId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const origin = (env.X_PUBLISH_MEDIA_ORIGIN || "https://xtelegram-cf.migos.club").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(origin) || !idFromPath(PREFIX + queueId)) {
    throw new Error("invalid_media_origin");
  }
  const expires = now + TTL_SECONDS;
  const signature = toHex(await crypto.subtle.sign(
    "HMAC", await hmac(env), encoder.encode(queueId + "." + expires),
  ));
  return origin + PREFIX + queueId + "?expires=" + expires + "&sig=" + signature;
}

export async function serveSignedMedia(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false }, 405);
  }
  const url = new URL(request.url);
  const id = idFromPath(url.pathname);
  const expires = Number(url.searchParams.get("expires"));
  const sig = url.searchParams.get("sig") || "";
  const now = Math.floor(Date.now() / 1000);
  if (!id || !Number.isSafeInteger(expires) ||
      expires <= now || expires > now + TTL_SECONDS ||
      !/^[0-9a-f]{64}$/i.test(sig)) return json({ ok: false }, 403);
  try {
    const supplied = new Uint8Array(sig.match(/../g)!.map(v => parseInt(v, 16)));
    if (!(await crypto.subtle.verify("HMAC", await hmac(env), supplied, encoder.encode(id + "." + expires)))) {
      return json({ ok: false }, 403);
    }
    // Don't reveal content for arbitrary object keys. Only use D1-issued paths.
    const row = await env.RELAY_DB.prepare(
      "SELECT media_object_key FROM x_repost_queue WHERE id = ? AND status IN ('queued', 'posted')",
    ).bind(id).first<{ media_object_key: string | null }>();
    if (!row?.media_object_key || !env.X_REPOST_MEDIA) return json({ ok: false }, 404);
    const object = await env.X_REPOST_MEDIA.get(row.media_object_key);
    if (!object?.body || !object.size || object.size > 80_000_000) {
      return json({ ok: false }, 404);
    }
    return new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(object.size),
        "Content-Disposition": 'inline; filename="video.mp4"',
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ ok: false }, 503);
  }
}
