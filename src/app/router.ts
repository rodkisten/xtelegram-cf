import { handleRodx } from "../routes/rodx";
import { handleGithubWebhook } from "../routes/github-webhook";
import { handleNotificationSend } from "../routes/notifications";
import { handleNotificationsPage } from "../routes/notifications-page";
import { authorizeRequest, isAuthorized } from "../http/auth";
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
  if (method === "GET" && (url.pathname === "/notifications" || url.pathname === "/notifications/")) {
    return handleNotificationsPage();
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

  if (method === "POST" && url.pathname === "/webhooks/github") {
    relayDebug(env, traceId, "router.dispatch", { handler: "github-webhook" });
    return handleGithubWebhook(request, env);
  }

  if (method === "GET" && url.pathname === "/notifications/capabilities") {
    const token = String(env.NOTIFICATION_API_TOKEN || "").trim();
    if (!token) return json({ ok: false, error: "Missing NOTIFICATION_API_TOKEN", stage: "configuration" }, 500);
    if (!isAuthorized(request, token)) {
      return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
    }
    return json({
      ok: true, version: "editable-v1",
      features: ["send", "edit_message_id", "upsert_notification_key", "sequence"],
      storage: "D1",
    });
  }

  if (method === "POST" && (url.pathname === "/notifications/send" || url.pathname === "/notifications/edit")) {
    const token = String(env.NOTIFICATION_API_TOKEN || "").trim();
    if (!token) return json({ ok: false, error: "Missing NOTIFICATION_API_TOKEN", stage: "configuration" }, 500);
    if (!isAuthorized(request, token)) {
      return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
    }
    relayDebug(env, traceId, "router.dispatch", { handler: "notification-send" });
    return handleNotificationSend(request, env, url.pathname === "/notifications/edit");
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
