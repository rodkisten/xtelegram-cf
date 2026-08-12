export function cloneAuthorizedJsonRequest(request: Request, body: unknown): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);

  return new Request(new URL("/send", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });
}
