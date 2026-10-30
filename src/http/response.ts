const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "X-Relay-Trace-Id",
  "Access-Control-Max-Age": "86400",
};

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}
