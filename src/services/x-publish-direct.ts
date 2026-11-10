import type { Env } from "../types";
import type { XRepostItem } from "./x-repost-queue";
import type { ProviderResult } from "./x-publish-buffer";
import { normalizeZernioCaption } from "./zernio-publisher";

export type DirectResult = ProviderResult | { kind: "processing"; mediaId: string };

const ROOT = "https://api.x.com";
const CHUNK = 4 * 1024 * 1024;
const MAX_DIRECT_VIDEO = 40_000_000;

export function directXAvailable(env: Env): boolean {
  // The value must be a user-context OAuth 2.0 access token with tweet.write, media.write.
  // An app-only bearer token cannot publish as a user.
  return env.X_API_ENABLED === "true" && Boolean(env.X_API_USER_ACCESS_TOKEN);
}

async function xRequest(
  env: Env, path: string, method = "GET", body?: BodyInit, mime?: string,
): Promise<{ body?: Record<string, any>; error?: ProviderResult }> {
  if (!env.X_API_USER_ACCESS_TOKEN) {
    return { error: { kind: "rejected", code: "x_access_token_unconfigured" } };
  }
  let response: Response;
  try {
    response = await fetch(ROOT + path, {
      method,
      headers: {
        Authorization: "Bearer " + env.X_API_USER_ACCESS_TOKEN,
        ...(mime ? { "Content-Type": mime } : {}),
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { error: { kind: "uncertain", code: "x_transport_ambiguous" } };
  }
  if (response.status === 429) {
    const reset = Number(response.headers.get("x-rate-limit-reset") || 0);
    const retry = Number(response.headers.get("retry-after") || 0);
    return { error: {
      kind: "rate_limited",
      retrySeconds: Math.max(900, Math.min(86400, retry || (reset - Date.now()/1000) || 3600)),
    } };
  }
  if (!response.ok) {
    const code = "x_http_" + response.status;
    // Non-429 client rejections confirm no successful create. 5xx is ambiguous.
    return { error: response.status >= 500
      ? { kind: "uncertain", code }
      : { kind: "rejected", code } };
  }
  const parsed = await response.json().catch(() => null);
  return { body: parsed && typeof parsed === "object" ? parsed as Record<string, any> : {} };
}

export async function initializeDirectXMedia(
  env: Env, item: XRepostItem,
): Promise<DirectResult> {
  if (!directXAvailable(env)) return { kind: "rejected", code: "x_api_not_configured" };
  if (!env.X_REPOST_MEDIA || !item.media_object_key) {
    return { kind: "rejected", code: "r2_media_unavailable" };
  }
  const object = await env.X_REPOST_MEDIA.head(item.media_object_key);
  if (!object || !object.size || object.size > MAX_DIRECT_VIDEO) {
    return { kind: "rejected", code: "x_direct_video_over_40mb" };
  }
  const start = await xRequest(env, "/2/media/upload/initialize", "POST", JSON.stringify({
    media_type: "video/mp4", total_bytes: object.size, media_category: "tweet_video",
  }), "application/json");
  if (start.error) return start.error;
  const id = String(start.body?.data?.id || "");
  if (!/^\d+$/.test(id)) return { kind: "uncertain", code: "x_media_init_missing_id" };
  // Upload alone cannot publish a Tweet. Each chunk is read from R2 with a bounded range.
  for (let position = 0, index = 0; position < object.size; position += CHUNK, index++) {
    const length = Math.min(CHUNK, object.size - position);
    const section = await env.X_REPOST_MEDIA.get(item.media_object_key, {
      range: { offset: position, length },
    });
    if (!section?.body) return { kind: "rejected", code: "r2_chunk_missing" };
    const bytes = await section.arrayBuffer();
    if (bytes.byteLength !== length) return { kind: "rejected", code: "r2_chunk_truncated" };
    const form = new FormData();
    form.append("segment_index", String(index));
    form.append("media", new Blob([bytes], { type: "video/mp4" }), "chunk.mp4");
    const uploaded = await xRequest(env, "/2/media/upload/" + id + "/append", "POST", form);
    if (uploaded.error) return uploaded.error;
  }
  const done = await xRequest(env, "/2/media/upload/" + id + "/finalize", "POST");
  if (done.error) return done.error;
  // Always checkpoint media_id before trying POST /2/tweets on a later invocation.
  return { kind: "processing", mediaId: id };
}

export async function finishDirectXMedia(
  env: Env,
  mediaId: string,
  item: XRepostItem,
  claimBeforeTweet: () => Promise<boolean>,
): Promise<DirectResult> {
  if (!directXAvailable(env) || !/^\d+$/.test(mediaId)) {
    return { kind: "rejected", code: "x_media_not_configured" };
  }
  const response = await xRequest(
    env, "/2/media/upload?command=STATUS&media_id=" + encodeURIComponent(mediaId),
  );
  if (response.error) return response.error;
  const processing = response.body?.data?.processing_info;
  if (processing && processing.state === "failed") {
    return { kind: "rejected", code: "x_video_processing_failed" };
  }
  if (processing && processing.state !== "succeeded") {
    return { kind: "processing", mediaId };
  }
  if (!(await claimBeforeTweet())) return { kind: "uncertain", code: "tweet_claim_conflict" };
  const posted = await xRequest(env, "/2/tweets", "POST", JSON.stringify({
    text: normalizeZernioCaption(item.caption, "twitter"),
    media: { media_ids: [mediaId] },
  }), "application/json");
  if (posted.error) return posted.error;
  const tweetId = String(posted.body?.data?.id || "");
  if (!/^\d+$/.test(tweetId)) {
    return { kind: "uncertain", code: "x_tweet_response_missing_id" };
  }
  return { kind: "accepted", id: tweetId, status: "published", url: "https://x.com/i/status/" + tweetId };
}
