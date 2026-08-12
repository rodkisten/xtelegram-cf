import { authorizeRequest } from "../http/auth";
import { handleOptions, json } from "../http/response";
import { handleBatch } from "../routes/batch";
import { handleHealth } from "../routes/health";
import { handleMediaCheck } from "../routes/media/check";
import { handleMediaQuery } from "../routes/media/query";
import { handleResolve } from "../routes/resolve";
import { handleSend } from "../routes/send";
import type { Env } from "../types";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return handleOptions();
  if (method === "GET" && url.pathname === "/health") return handleHealth();

  const authorizationError = authorizeRequest(request, env);
  if (authorizationError) return authorizationError;

  if (method === "POST" && url.pathname === "/media/check") {
    return handleMediaCheck(request, env);
  }
  if (
    method === "GET" &&
    (url.pathname === "/media" || url.pathname.startsWith("/media/"))
  ) {
    return handleMediaQuery(request, env);
  }
  if (method === "POST" && url.pathname === "/send") {
    return handleSend(request, env);
  }
  if (method === "POST" && url.pathname === "/resolve") {
    return handleResolve(request, env, false);
  }
  if (method === "POST" && url.pathname === "/resolve-and-send") {
    return handleResolve(request, env, true);
  }
  if (method === "POST" && url.pathname === "/batch") {
    return handleBatch(request, env);
  }

  return json({ ok: false, error: "Not found" }, 404);
}
