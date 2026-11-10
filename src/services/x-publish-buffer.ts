import type { Env } from "../types";
import { signedMediaUrl } from "./x-publish-media";
import { normalizeZernioCaption } from "./zernio-publisher";
import type { XRepostItem } from "./x-repost-queue";

export type ProviderResult =
  | { kind: "accepted"; id: string; status: "pending" | "published"; url?: string }
  | { kind: "rejected"; code: string }
  | { kind: "rate_limited"; retrySeconds: number }
  | { kind: "uncertain"; code: string };

export function bufferAvailable(env: Env): boolean {
  return env.BUFFER_ENABLED === "true" && Boolean(env.BUFFER_API_KEY && env.BUFFER_X_CHANNEL_ID);
}

const CREATE = [
  "mutation RodXCreate($input: CreatePostInput!) {",
  "  createPost(input: $input) {",
  "    ... on PostActionSuccess { post { id status externalLink } }",
  "    ... on MutationError { message }",
  "  }",
  "}",
].join("\n");

const GET = "query RodXPost($input: PostInput!) { post(input: $input) { id status externalLink } }";

export function bufferCreateInput(item: XRepostItem, mediaUrl: string) {
  return {
    text: normalizeZernioCaption(item.caption, "twitter"),
    channelId: "",
    schedulingType: "automatic",
    mode: "shareNow",
    assets: [{ video: { url: mediaUrl } }],
  };
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1800;
  const n = Number(header);
  if (Number.isFinite(n)) return Math.max(60, Math.min(86400, Math.ceil(n)));
  const secs = (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(secs) ? Math.max(60, Math.min(86400, Math.ceil(secs))) : 1800;
}

async function consumeBufferBudget(env: Env): Promise<boolean> {
  const cap = Math.max(10, Math.min(950, Number(env.BUFFER_30D_REQUEST_CAP || 850) || 850));
  const row = await env.RELAY_DB.prepare(
    "INSERT INTO x_publish_buffer_calls(created_at) SELECT unixepoch() " +
      "WHERE (SELECT COUNT(*) FROM x_publish_buffer_calls " +
      "WHERE created_at >= unixepoch() - 2592000) < ? RETURNING id",
  ).bind(cap).first<{ id: number }>();
  return Boolean(row);
}

async function bufferRequest(
  env: Env, query: string, variables: unknown,
): Promise<{ result?: Record<string, unknown>; error?: ProviderResult }> {
  if (!env.BUFFER_API_KEY) return { error: { kind: "rejected", code: "buffer_not_configured" } };
  if (!(await consumeBufferBudget(env))) {
    return { error: { kind: "rate_limited", retrySeconds: 86400 } };
  }
  let response: Response;
  try {
    response = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.BUFFER_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { error: { kind: "uncertain", code: "buffer_transport_ambiguous" } };
  }
  if (response.status === 429) {
    return { error: { kind: "rate_limited", retrySeconds: parseRetryAfter(response.headers.get("Retry-After")) } };
  }
  if (!response.ok) {
    return { error: { kind: "uncertain", code: "buffer_http_" + response.status } };
  }
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || !data.data || data.errors) {
    return { error: { kind: "uncertain", code: "buffer_graphql_error" } };
  }
  return { result: data.data as Record<string, unknown> };
}

export async function createBufferVideo(env: Env, item: XRepostItem): Promise<ProviderResult> {
  if (!bufferAvailable(env)) return { kind: "rejected", code: "buffer_not_configured" };
  if (!item.media_object_key) return { kind: "rejected", code: "r2_video_not_ready" };
  let url: string;
  try {
    url = await signedMediaUrl(env, item.id);
  } catch {
    return { kind: "rejected", code: "signed_media_not_configured" };
  }
  const input = { ...bufferCreateInput(item, url), channelId: env.BUFFER_X_CHANNEL_ID };
  const { result, error } = await bufferRequest(env, CREATE, { input });
  if (error) return error;
  const action = result?.createPost as Record<string, unknown> | undefined;
  if (action?.post && typeof action.post === "object") {
    const post = action.post as Record<string, unknown>;
    if (typeof post.id !== "string" || !post.id) {
      return { kind: "uncertain", code: "buffer_missing_post_id" };
    }
    return {
      kind: "accepted",
      id: post.id,
      status: post.status === "sent" ? "published" : "pending",
      ...(typeof post.externalLink === "string" ? { url: post.externalLink } : {}),
    };
  }
  // GraphQL MutationError guarantees no PostActionSuccess payload was created.
  if (typeof action?.message === "string") {
    // Some mutation errors are limits, not media failures; do not evade those
    // limits by falling back to the next provider.
    return /rate|limit|quota|too many|daily/i.test(action.message)
      ? { kind: "rate_limited", retrySeconds: 7200 }
      : { kind: "rejected", code: "buffer_mutation_rejected" };
  }
  return { kind: "uncertain", code: "buffer_unknown_create_result" };
}

export async function checkBufferPost(
  env: Env, id: string,
): Promise<ProviderResult> {
  const { result, error } = await bufferRequest(env, GET, { input: { id } });
  if (error) return error;
  const post = result?.post as Record<string, unknown> | undefined;
  if (!post || typeof post.id !== "string") {
    return { kind: "uncertain", code: "buffer_missing_post" };
  }
  const status = String(post.status || "").toLowerCase();
  if (status === "error") return { kind: "rejected", code: "buffer_confirmed_error" };
  return {
    kind: "accepted",
    id: post.id,
    status: status === "sent" ? "published" : "pending",
    ...(typeof post.externalLink === "string" ? { url: post.externalLink } : {}),
  };
}
