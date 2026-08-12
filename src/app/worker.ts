import { routeRequest } from "./router";
import { json } from "../http/response";
import { getErrorMessage } from "../lib/errors";
import type { Env } from "../types";

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error("[media-relay] Unhandled request error", {
        method: request.method,
        url: request.url,
        error: getErrorMessage(error),
      });
      return json(
        { ok: false, error: getErrorMessage(error), stage: "unhandled" },
        500,
      );
    }
  },
};

export default worker;
