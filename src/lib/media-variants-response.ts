export interface PublicMediaVariant {
  url: string;
  mediaUrl: string;
  quality: string | null;
  width: number | null;
  height: number | null;
  contentLength: number | null;
  bitrate: number | null;
  mediaHeaders: Record<string, string>;
}

type VariantLike = {
  url?: unknown;
  mediaUrl?: unknown;
  quality?: unknown;
  width?: unknown;
  height?: unknown;
  contentLength?: unknown;
  content_length?: unknown;
  bitrate?: unknown;
  mediaHeaders?: unknown;
  headers?: unknown;
};

/**
 * Adds a predictable, top-level rendition envelope to every media API JSON
 * response. Nested provider/limit/send structures remain unchanged.
 */
export async function withMediaVariants(
  response: Response,
  seed: unknown[] = [],
): Promise<Response> {
  const contentType = response.headers.get("Content-Type") || "";
  if (!/application\/json/i.test(contentType)) return response;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return response;
  }

  const variants = dedupeVariants([
    ...normalizeVariantList(seed),
    ...collectNestedVariants(payload),
  ]);
  const variantUrls = variants.map((variant) => variant.url);
  const qualityUrls = variants.map((variant) => ({
    quality: variant.quality,
    url: variant.url,
    mediaUrl: variant.mediaUrl,
    width: variant.width,
    height: variant.height,
    contentLength: variant.contentLength,
    bitrate: variant.bitrate,
  }));

  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? {
        ...(payload as Record<string, unknown>),
        variants,
        variantUrls,
        qualityUrls,
      }
    : { ok: response.ok, result: payload, variants, variantUrls, qualityUrls };

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function collectNestedVariants(value: unknown): PublicMediaVariant[] {
  const output: PublicMediaVariant[] = [];
  const visited = new WeakSet<object>();

  const visit = (current: unknown, depth: number) => {
    if (!current || typeof current !== "object" || depth > 12) return;
    if (visited.has(current as object)) return;
    visited.add(current as object);

    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1));
      return;
    }

    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      if ((key === "variants" || key === "mediaVariants") && Array.isArray(nested)) {
        output.push(...normalizeVariantList(nested));
      }
      visit(nested, depth + 1);
    }
  };

  visit(value, 0);
  return dedupeVariants(output);
}

export function normalizeVariantList(value: unknown): PublicMediaVariant[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeVariant).filter((item): item is PublicMediaVariant => Boolean(item));
}

function normalizeVariant(value: unknown): PublicMediaVariant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as VariantLike;
  const rawUrl = record.mediaUrl instanceof URL
    ? record.mediaUrl.href
    : record.url instanceof URL
      ? record.url.href
      : String(record.mediaUrl || record.url || "").trim();
  if (!/^https?:\/\//i.test(rawUrl)) return null;

  return {
    url: rawUrl,
    mediaUrl: rawUrl,
    quality: textOrNull(record.quality),
    width: positiveNumberOrNull(record.width),
    height: positiveNumberOrNull(record.height),
    contentLength: positiveNumberOrNull(record.contentLength ?? record.content_length),
    bitrate: positiveNumberOrNull(record.bitrate),
    mediaHeaders: normalizeHeaders(record.mediaHeaders ?? record.headers),
  };
}

function dedupeVariants(variants: PublicMediaVariant[]): PublicMediaVariant[] {
  const seen = new Set<string>();
  return variants.filter((variant) => {
    if (seen.has(variant.url)) return false;
    seen.add(variant.url);
    return true;
  });
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function positiveNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === null || nested === undefined) continue;
    const text = String(nested).trim();
    if (key.trim() && text) output[key] = text;
  }
  return output;
}

