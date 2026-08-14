import { routeRequest } from "./router";
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

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const traceId = relayTraceId(request);
    const tracedRequest = withRelayTrace(request, traceId);
    const startedAt = Date.now();
    relayDebug(env, traceId, "request.received", {
      method: tracedRequest.method,
      path: new URL(tracedRequest.url).pathname,
      contentType: tracedRequest.headers.get("Content-Type") || null,
      hasAuthorization: Boolean(tracedRequest.headers.get("Authorization")),
    });
    try {
      const response = await routeRequest(tracedRequest, env);
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
};

export default worker;
