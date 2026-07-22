const MAX_REDIRECTS = 5;

export function normalizePublicHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (isBlockedHostname(url.hostname)) {
    return null;
  }

  return url;
}

export function normalizeOptionalSourceUrl(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }

  const url = normalizePublicHttpUrl(String(value));

  return url?.href ?? null;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1).map(Number);

  if (parts.some((part) => part < 0 || part > 255)) {
    return true;
  }

  const [a = 0, b = 0] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168 ||
    a >= 224
  );
}

export async function fetchPublic(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  let current =
    input instanceof URL
      ? normalizePublicHttpUrl(input.href)
      : normalizePublicHttpUrl(String(input));

  if (!current) {
    throw new Error("The requested URL is not a public HTTP(S) URL");
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current.href, {
      ...init,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");

    if (!location) {
      return response;
    }

    const next = normalizePublicHttpUrl(new URL(location, current).href);

    if (!next) {
      throw new Error("A media redirect pointed to a blocked or invalid URL");
    }

    current = next;
  }

  throw new Error("Too many media redirects");
}

export function getBaseContentType(value: string | null | undefined): string {
  return String(value || "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() || "";
}

export function getFileExtension(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,8})$/i);

    return match?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

export function resolvePublicRelativeUrl(value: string, baseUrl: string): string | null {
  try {
    return normalizePublicHttpUrl(new URL(value, baseUrl).href)?.href ?? null;
  } catch {
    return null;
  }
}
