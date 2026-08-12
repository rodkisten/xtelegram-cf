import type { Env } from "../types";
import { json } from "./response";

export function authorizeRequest(request: Request, env: Env): Response | null {
  const expectedToken = String(env.RELAY_TOKEN || "").trim();
  if (!expectedToken) {
    return json(
      {
        ok: false,
        error: "Missing RELAY_TOKEN secret",
        stage: "configuration",
      },
      500,
    );
  }

  if (isAuthorized(request, expectedToken)) return null;

  return json(
    {
      ok: false,
      error: "Unauthorized",
      stage: "authorization",
      details: {
        expectedScheme: "Authorization: Bearer <RELAY_TOKEN>",
        authorizationHeaderPresent: Boolean(request.headers.get("Authorization")),
      },
    },
    401,
  );
}

export function isAuthorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return false;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;

  return safeTokenEqual(match[1].trim(), expectedToken);
}

export function safeTokenEqual(left: string, right: string): boolean {
  const a = String(left);
  const b = String(right);
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < maxLength; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    difference |= aCode ^ bCode;
  }

  return difference === 0;
}
