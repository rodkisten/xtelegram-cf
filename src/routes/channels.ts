import { json } from "../http/response";
import { buildChannelRegistry } from "../services/channel-registry";
import { getErrorMessage } from "../lib/errors";
import { relayDebug, relayTraceId } from "../lib/debug";
import type { Env } from "../types";

/**
 * Returns the unified Telegram channel/topic registry used by Shortcuts and
 * other relay clients.
 *
 * @example
 * GET /channels
 * Output: `{ ok: true, channels: [...], count: 7, metadata: {...} }`
 */
export async function handleChannels(
  request: Request,
  env: Env,
): Promise<Response> {
  const traceId = relayTraceId(request);

  try {
    const registry = await buildChannelRegistry(env);

    relayDebug(env, traceId, "channels.completed", {
      count: registry.count,
      telegramApi: registry.metadata.telegramApi,
    });

    return json(registry);
  } catch (error) {
    relayDebug(env, traceId, "channels.failed", {
      error: getErrorMessage(error),
    });

    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "channels",
        channels: [],
        count: 0,
      },
      500,
    );
  }
}
