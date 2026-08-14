import type { Env } from "../types";

export const RELAY_TRACE_HEADER = "X-Relay-Trace-Id";

const DEBUG_PREFIX = "[media-relay:debug]";
const SENSITIVE_KEY = /(?:authorization|token|cookie|secret|password|api[_-]?key|signature|sig|expires?|credential)/i;
const URL_KEY = /(?:url|uri|href)$/i;

/**
 * Debug logging is deliberately opt-in. Set RELAY_DEBUG=true in the Worker
 * environment to emit a structured line for each meaningful pipeline step.
 * URLs are stripped of query strings and secrets are always redacted.
 */
export function relayDebugEnabled(env: Env): boolean {
  return ["1", "true", "yes", "on", "debug"].includes(
    String(env.RELAY_DEBUG || "").trim().toLowerCase(),
  );
}

export function createRelayTraceId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function relayTraceId(request: Request): string {
  const candidate = String(request.headers.get(RELAY_TRACE_HEADER) || "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(candidate) ? candidate : createRelayTraceId();
}

export function withRelayTrace(request: Request, traceId: string): Request {
  if (request.headers.get(RELAY_TRACE_HEADER) === traceId) return request;
  const headers = new Headers(request.headers);
  headers.set(RELAY_TRACE_HEADER, traceId);
  return new Request(request, { headers });
}

export function withRelayTraceResponse(response: Response, traceId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(RELAY_TRACE_HEADER, traceId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function relayDebug(
  env: Env,
  traceId: string,
  step: string,
  details: Record<string, unknown> = {},
): void {
  if (!relayDebugEnabled(env)) return;
  try {
    const safeDetails = sanitizeDebugValue(details) as Record<string, unknown>;
    console.log(
      DEBUG_PREFIX,
      JSON.stringify({
        at: new Date().toISOString(),
        traceId,
        step,
        ...safeDetails,
      }),
    );
  } catch {
    // Logging must never alter a delivery outcome.
  }
}

export function debugUrl(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname}${truncate(url.pathname, 180)}`;
  } catch {
    return truncate(raw.replace(/[?#].*$/, ""), 180) || null;
  }
}

export function debugError(error: unknown): string {
  if (error instanceof Error) return truncate(error.message || error.name, 420);
  return truncate(String(error || "Unknown error"), 420);
}

export function debugChannelSummary(value: unknown): Record<string, number> {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const size = (key: string) => Array.isArray(source[key]) ? (source[key] as unknown[]).length : 0;
  return {
    requested: size("requested"),
    attempted: size("attempted"),
    inserted: size("inserted"),
    covered: size("covered"),
    notSent: size("notSent"),
  };
}

function sanitizeDebugValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncate(value, 500);
  if (depth > 4) return "[depth-limited]";

  if (Array.isArray(value)) {
    return value.slice(0, 24).map((entry) => sanitizeDebugValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = "[redacted]";
      } else if (URL_KEY.test(key) && typeof entry === "string") {
        output[key] = debugUrl(entry);
      } else {
        output[key] = sanitizeDebugValue(entry, depth + 1);
      }
    }
    return output;
  }

  return truncate(String(value), 300);
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…`;
}
