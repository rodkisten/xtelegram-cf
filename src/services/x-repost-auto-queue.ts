import type { Env } from "../types";
import { enqueueXRepost, type XRepostItem } from "./x-repost-queue";

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function firstString(...items: unknown[]): string {
  for (const value of items) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

/**
 * Invoked only after Relay's response has been produced. A failed Telegram send never enters
 * the X queue. An explicit x_repost flag or the server's opt-in setting activates the bridge.
 */
export async function queueXRepostAfterRelay(
  originalRequest: Request,
  relayResponse: Response,
  env: Env,
): Promise<XRepostItem | null> {
  if (!relayResponse.ok || relayResponse.status === 207) return null;
  const request = record(await originalRequest.json());
  if (request.x_repost === false) return null;
  if (request.x_repost !== true && env.X_REPOST_AUTO_QUEUE !== "true") return null;

  const result = record(await relayResponse.json());
  if (result.ok === false) return null;

  const channels = record(result.channels);
  const covered = Array.isArray(channels.covered) ? channels.covered.length > 0 : false;
  const hasMessage = Boolean(result.message_id || result.message_url ||
    (Array.isArray(result.message_ids) && result.message_ids.length));
  if (!covered && !hasMessage) return null;

  const resolution = record(result.resolution);
  const media = Array.isArray(resolution.media) ? resolution.media.map(record) : [];
  const video = media.find(item => item.type === "video");
  const sourceUrl = firstString(
    request.sourceUrl, request.url, resolution.sourceUrl,
    request.pageUrl,
  );
  const caption = firstString(request.x_caption, request.caption, resolution.caption, request.text);
  const hashtags = Array.isArray(request.hashtags) || typeof request.hashtags === "string"
    ? request.hashtags as string[] | string : [];
  const videoUrl = firstString(request.x_media_url, video?.url, request.mediaUrl);
  const telegramUrl = firstString(result.message_url, request.telegramMessageUrl);

  try {
    return await enqueueXRepost(env, {
      sourceUrl,
      caption,
      hashtags,
      mediaUrl: videoUrl,
      telegramMessageUrl: telegramUrl,
    });
  } catch (error) {
    // Telegram delivery remains successful even when a separate queue request fails.
    console.warn("[x-repost] auto queue failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Cache a freshly-resolved MP4 if the optional R2 binding exists. CDN links may expire.
 * This helper runs in waitUntil and does not slow down the Telegram response.
 */
export async function cacheXRepostVideo(env: Env, item: XRepostItem): Promise<void> {
  if (!env.X_REPOST_MEDIA || !item.media_url || item.media_object_key) return;
  const source = new URL(item.media_url);
  if (source.protocol !== "https:" || source.hostname !== "video.twimg.com" ||
      !/\.mp4(?:$|[?#])/i.test(source.href)) return;

  try {
    const response = await fetch(item.media_url, { redirect: "follow" });
    if (!response.ok || !response.body) return;
    const bytes = Number(response.headers.get("Content-Length") || 0);
    const mime = response.headers.get("Content-Type") || "";
    if (!bytes || bytes > 80_000_000 || !mime.toLowerCase().startsWith("video/mp4")) return;

    const key = `x-repost/${item.id}.mp4`;
    await env.X_REPOST_MEDIA.put(key, response.body, {
      httpMetadata: { contentType: "video/mp4" },
      customMetadata: { queueId: item.id },
    });
    await env.RELAY_DB.prepare(`
      UPDATE x_repost_queue SET media_object_key = ?, updated_at = unixepoch()
      WHERE id = ? AND status IN ('queued', 'claimed')
    `).bind(key, item.id).run();
  } catch (error) {
    console.warn("[x-repost] optional media cache unavailable:",
      error instanceof Error ? error.message : String(error));
  }
}
