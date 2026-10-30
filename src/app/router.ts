import { handleRodx } from "../routes/rodx";
import { authorizeRequest } from "../http/auth";
import { handleOptions, json } from "../http/response";
import { handleBatch } from "../routes/batch";
import { handleChannels } from "../routes/channels";
import { handleHealth } from "../routes/health";
import { handleMediaCheck } from "../routes/media/check";
import { handleMediaQuery } from "../routes/media/query";
import { handleMediaRegister } from "../routes/media/register";
import { handleResolve } from "../routes/resolve";
import { handleSend } from "../routes/send";
import { relayDebug, relayTraceId } from "../lib/debug";
import type { Env } from "../types";

export async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const traceId = relayTraceId(request);

  relayDebug(env, traceId, "router.received", { method, path: url.pathname });

  if (method === "OPTIONS") {
    relayDebug(env, traceId, "router.options", {});
    return handleOptions();
  }
  if (method === "GET" && url.pathname === "/health") {
    relayDebug(env, traceId, "router.health", {});
    return handleHealth();
  }
  if (method === "GET" && url.pathname === "/channels") {
    relayDebug(env, traceId, "router.dispatch", { handler: "channels" });
    const authorizationError = authorizeRequest(request, env);
    if (authorizationError) {
      relayDebug(env, traceId, "router.authorization-rejected", { status: authorizationError.status });
      return authorizationError;
    }
    return handleChannels(request, env);
  }

  if (url.pathname.startsWith("/rodx/v1/")) {
    relayDebug(env, traceId, "router.dispatch", { handler: "rodx" });
    return handleRodx(request, env);
  }

  const authorizationError = authorizeRequest(request, env);
  if (authorizationError) {
    relayDebug(env, traceId, "router.authorization-rejected", { status: authorizationError.status });
    return authorizationError;
  }

  if (method === "POST" && url.pathname === "/media/check") {
    relayDebug(env, traceId, "router.dispatch", { handler: "media-check" });
    return handleMediaCheck(request, env);
  }
  if (method === "POST" && url.pathname === "/media/register") {
    relayDebug(env, traceId, "router.dispatch", { handler: "media-register" });
    return handleMediaRegister(request, env);
  }
  if (
    method === "GET" &&
    (url.pathname === "/media" || url.pathname.startsWith("/media/"))
  ) {
    relayDebug(env, traceId, "router.dispatch", { handler: "media-query" });
    return handleMediaQuery(request, env);
  }
  if (method === "POST" && url.pathname === "/send") {
    relayDebug(env, traceId, "router.dispatch", { handler: "send" });
    return handleSend(request, env);
  }
  if (method === "POST" && url.pathname === "/resolve") {
    relayDebug(env, traceId, "router.dispatch", { handler: "resolve" });
    return handleResolve(request, env, false);
  }
  if (method === "POST" && url.pathname === "/resolve-and-send") {
    relayDebug(env, traceId, "router.dispatch", { handler: "resolve-and-send" });
    return handleResolve(request, env, true);
  }
  if (method === "POST" && url.pathname === "/batch") {
    relayDebug(env, traceId, "router.dispatch", { handler: "batch" });
    return handleBatch(request, env);
  }

  relayDebug(env, traceId, "router.not-found", { method, path: url.pathname });
  return json({ ok: false, error: "Not found" }, 404);
}
