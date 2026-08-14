import { json } from "../../http/response";
import { validateEnvironment } from "../../telegram";
import type { Env } from "../../types";
import { validateAlbumRequestBody, validateRequestBody } from "../../validation/send";
import { handleJsonAlbumSend } from "./album";
import { handleMultipartSend } from "./multipart";
import { handleSingleSend } from "./single";
import { relayDebug, relayTraceId } from "../../lib/debug";

export async function handleSend(request: Request, env: Env): Promise<Response> {
  const traceId = relayTraceId(request);
  const configurationError = validateEnvironment(env);
  if (configurationError) {
    relayDebug(env, traceId, "send.configuration-invalid", { error: configurationError });
    return json({ ok: false, error: configurationError }, 500);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    relayDebug(env, traceId, "send.multipart.received", { contentType });
    const response = await handleMultipartSend(request, env);
    relayDebug(env, traceId, "send.multipart.completed", { status: response.status });
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    relayDebug(env, traceId, "send.invalid-json", { contentType });
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const albumValidation = validateAlbumRequestBody(body);
  if (albumValidation.kind === "invalid") {
    relayDebug(env, traceId, "send.album-invalid", { error: albumValidation.error });
    return json({ ok: false, error: albumValidation.error }, 400);
  }
  if (albumValidation.kind === "valid") {
    relayDebug(env, traceId, "send.album-validated", {
      itemCount: albumValidation.value.items.length,
      provider: albumValidation.value.provider || null,
      channelCount: albumValidation.value.channels.length,
      force: albumValidation.value.force,
    });
    const response = await handleJsonAlbumSend(albumValidation.value, env, traceId);
    relayDebug(env, traceId, "send.album-completed", { status: response.status });
    return response;
  }

  const validation = validateRequestBody(body);
  if (!validation.ok) {
    relayDebug(env, traceId, "send.single-invalid", { error: validation.error });
    return json({ ok: false, error: validation.error }, 400);
  }

  relayDebug(env, traceId, "send.single-validated", {
    provider: validation.value.provider || null,
    mediaType: validation.value.mediaType || null,
    mediaUrl: validation.value.mediaUrl.href,
    sourceUrl: validation.value.sourceUrl || null,
    channelCount: validation.value.channels.length,
    force: validation.value.force,
  });
  const response = await handleSingleSend(request, validation.value, env);
  relayDebug(env, traceId, "send.single-completed", { status: response.status });
  return response;
}
