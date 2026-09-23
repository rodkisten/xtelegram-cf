import { json } from "../../http/response";
import { validateEnvironment } from "../../telegram";
import type { Env } from "../../types";
import { validateAlbumRequestBody, validateRequestBody } from "../../validation/send";
import { handleJsonAlbumSend } from "./album";
import { handleMultipartSend } from "./multipart";
import { handleSingleSend } from "./single";
import { relayDebug, relayTraceId } from "../../lib/debug";
import { cpuHeavyRequestValue, resolveCpuHeavyEnabled } from "../../lib/cpu-policy";
import { withMediaVariants } from "../../lib/media-variants-response";

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
    return withMediaVariants(response);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    relayDebug(env, traceId, "send.invalid-json", { contentType });
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const cpuHeavyEnabled = resolveCpuHeavyEnabled(env, request, cpuHeavyRequestValue(bodyRecord));

  const albumValidation = validateAlbumRequestBody(body);
  if (albumValidation.kind === "invalid") {
    relayDebug(env, traceId, "send.album-invalid", { error: albumValidation.error });
    return json({ ok: false, error: albumValidation.error }, 400);
  }
  if (albumValidation.kind === "valid") {
    albumValidation.value.forceCpu = albumValidation.value.forceCpu || cpuHeavyEnabled;
    relayDebug(env, traceId, "send.album-validated", {
      itemCount: albumValidation.value.items.length,
      provider: albumValidation.value.provider || null,
      channelCount: albumValidation.value.channels.length,
      force: albumValidation.value.force,
      forceCpu: albumValidation.value.forceCpu,
    });
    const response = await handleJsonAlbumSend(albumValidation.value, env, traceId);
    relayDebug(env, traceId, "send.album-completed", { status: response.status });
    return withMediaVariants(
      response,
      albumValidation.value.items.flatMap((item) => [
        {
          mediaUrl: item.mediaUrl,
          quality: item.metadata?.resolvedQuality || null,
          width: item.metadata?.resolvedWidth || null,
          height: item.metadata?.resolvedHeight || null,
          contentLength: item.metadata?.resolvedContentLength || null,
          bitrate: item.metadata?.resolvedBitrate || null,
          mediaHeaders: item.mediaHeaders,
        },
        ...item.mediaVariants,
      ]),
    );
  }
  const validation = validateRequestBody(body);
  if (!validation.ok) {
    relayDebug(env, traceId, "send.single-invalid", { error: validation.error });
    return json({ ok: false, error: validation.error }, 400);
  }

  validation.value.forceCpu = validation.value.forceCpu || cpuHeavyEnabled;

  relayDebug(env, traceId, "send.single-validated", {
    provider: validation.value.provider || null,
    mediaType: validation.value.mediaType || null,
    mediaUrl: validation.value.mediaUrl.href,
    sourceUrl: validation.value.sourceUrl || null,
    channelCount: validation.value.channels.length,
    force: validation.value.force,
    forceCpu: validation.value.forceCpu,
  });
  const response = await handleSingleSend(request, validation.value, env);
  relayDebug(env, traceId, "send.single-completed", { status: response.status });
  return withMediaVariants(response, [
    {
      mediaUrl: validation.value.mediaUrl,
      quality: validation.value.metadata?.resolvedQuality || null,
      width: validation.value.metadata?.resolvedWidth || null,
      height: validation.value.metadata?.resolvedHeight || null,
      contentLength: validation.value.metadata?.resolvedContentLength || null,
      bitrate: validation.value.metadata?.resolvedBitrate || null,
      mediaHeaders: validation.value.mediaHeaders,
    },
    ...validation.value.mediaVariants,
  ]);
}
