import { routeRequest } from "./router";
import { cacheXRepostVideo, queueXRepostAfterRelay } from "../services/x-repost-auto-queue";
import { notifyDueXReposts } from "../routes/x-repost";
import { processOneDueZernio, refreshOnePendingZernio } from "../services/zernio-publisher";
import { json } from "../http/response";
import { getErrorMessage } from "../lib/errors";
import {
  debugError,
  debugUrl,
  relayDebug,
  relayTraceId,
  withRelayTrace,
  withRelayTraceResponse,
} from "../lib/debug";
import type { Env } from "../types";
import { withMediaVariants } from "../lib/media-variants-response";

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const traceId = relayTraceId(request);
    const tracedRequest = withRelayTrace(request, traceId);
    const startedAt = Date.now();
    const path = new URL(tracedRequest.url).pathname;
    const candidatePaths = new Set(["/send", "/resolve-and-send", "/media/register"]);
    const mayEnqueue = candidatePaths.has(path) &&
      (tracedRequest.headers.get("Content-Type") || "").includes("application/json");
    // Clone before routing consumes the body. Non-JSON video uploads are never cloned.
    const queueRequest = mayEnqueue ? tracedRequest.clone() : null;
    relayDebug(env, traceId, "request.received", {
      method: tracedRequest.method,
      path: new URL(tracedRequest.url).pathname,
      contentType: tracedRequest.headers.get("Content-Type") || null,
      hasAuthorization: Boolean(tracedRequest.headers.get("Authorization")),
    });
    try {
      const routedResponse = await routeRequest(tracedRequest, env);
      const response = isMediaResponsePath(new URL(tracedRequest.url).pathname)
        ? await withMediaVariants(routedResponse)
        : routedResponse;
      if (queueRequest && response.ok) {
        ctx.waitUntil(
          queueXRepostAfterRelay(queueRequest, response.clone(), env)
            .then(async (item) => {
              if (item) await cacheXRepostVideo(env, item);
            })
            .catch((error) => console.warn("[x-repost] auto enqueue:", error)),
        );
      }
      relayDebug(env, traceId, "request.completed", {
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return withRelayTraceResponse(response, traceId);
    } catch (error) {
      console.error("[media-relay] Unhandled request error", {
        method: tracedRequest.method,
        url: debugUrl(tracedRequest.url),
        error: getErrorMessage(error),
      });
      relayDebug(env, traceId, "request.unhandled-error", {
        durationMs: Date.now() - startedAt,
        error: debugError(error),
      });
      return withRelayTraceResponse(json(
        { ok: false, error: getErrorMessage(error), stage: "unhandled" },
        500,
      ), traceId);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(notifyDueXReposts(env));
    ctx.waitUntil((async () => {
      try {
        await processOneDueZernio(env);
        await refreshOnePendingZernio(env);
      } catch (error) {
        // Fail closed. D1 retains unknown outcomes; never blindly submit twice.
        console.warn("[zernio] scheduled reconciliation unavailable",
          error instanceof Error ? error.name : "error");
      }
    })());
  },
};

function isMediaResponsePath(pathname: string): boolean {
  return pathname === "/send" ||
    pathname === "/resolve" ||
    pathname === "/resolve-and-send" ||
    pathname === "/batch" ||
    pathname === "/media/check" ||
    pathname === "/media/register";
}

export default worker;
