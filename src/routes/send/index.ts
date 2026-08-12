import { json } from "../../http/response";
import { validateEnvironment } from "../../telegram";
import type { Env } from "../../types";
import { validateAlbumRequestBody, validateRequestBody } from "../../validation/send";
import { handleJsonAlbumSend } from "./album";
import { handleMultipartSend } from "./multipart";
import { handleSingleSend } from "./single";

export async function handleSend(request: Request, env: Env): Promise<Response> {
  const configurationError = validateEnvironment(env);
  if (configurationError) {
    return json({ ok: false, error: configurationError }, 500);
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    return handleMultipartSend(request, env);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const albumValidation = validateAlbumRequestBody(body);
  if (albumValidation.kind === "invalid") {
    return json({ ok: false, error: albumValidation.error }, 400);
  }
  if (albumValidation.kind === "valid") {
    return handleJsonAlbumSend(albumValidation.value, env);
  }

  const validation = validateRequestBody(body);
  if (!validation.ok) {
    return json({ ok: false, error: validation.error }, 400);
  }

  return handleSingleSend(request, validation.value, env);
}
