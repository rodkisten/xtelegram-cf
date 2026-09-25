import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  buildSocialThumbnailResponse,
  firstSocialThumbnailUrl,
  firstThumbnailResponseFields,
} from "../src/lib/thumbnail-response.ts";
import type { Env } from "../src/types.ts";
import type { SocialResolution } from "../src/social.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function env(overrides: Partial<Env> = {}): Env {
  return {
    RELAY_DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: "test",
    RELAY_TOKEN: "test",
    ...overrides,
  };
}

function resolution(options: {
  thumbnail?: string | null;
  type?: "video" | "photo" | "audio";
  mediaUrl?: string;
  width?: number;
  height?: number;
} = {}): SocialResolution {
  const mediaUrl = options.mediaUrl || "https://cdn.example.test/video.mp4";
  const type = options.type || "video";
  const width = options.width || 1080;
  const height = options.height || 1920;
  return {
    source: "twitter",
    sourceUrl: "https://x.com/rod/status/123456789",
    resolver: "test",
    title: null,
    caption: null,
    authorName: null,
    authorUsername: null,
    attempts: [],
    media: [{
      index: 0,
      url: mediaUrl,
      type,
      quality: "1080p",
      width,
      height,
      thumbnail: options.thumbnail ?? null,
      contentLength: null,
      bitrate: null,
      mediaHeaders: {},
      variants: [{
        url: mediaUrl,
        type,
        quality: "1080p",
        width,
        height,
        thumbnail: options.thumbnail ?? null,
        contentLength: null,
        bitrate: null,
        mediaHeaders: {},
      }],
    }],
  };
}

function pngBytes(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out.set([0x00, 0x00, 0x00, 0x0d], 8);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  out[16] = (width >>> 24) & 0xff;
  out[17] = (width >>> 16) & 0xff;
  out[18] = (width >>> 8) & 0xff;
  out[19] = width & 0xff;
  out[20] = (height >>> 24) & 0xff;
  out[21] = (height >>> 16) & 0xff;
  out[22] = (height >>> 8) & 0xff;
  out[23] = height & 0xff;
  out.set([0x08, 0x02, 0x00, 0x00, 0x00], 24);
  out.set([0x00, 0x00, 0x00, 0x00], 29);
  return out;
}

describe("thumbnail response", () => {
  it("encodes a resolver thumbnail as raw Base64", async () => {
    const bytes = pngBytes(320, 180);
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.byteLength),
      },
    });

    const result = await buildSocialThumbnailResponse(
      resolution({ thumbnail: "https://pbs.twimg.com/media/example.png", width: 1280, height: 720 }),
      env(),
    );

    assert.equal(result.thumbnail_included, true);
    assert.equal(result.thumbnail_mime_type, "image/png");
    assert.equal(result.thumbnail_bytes, bytes.byteLength);
    assert.equal(result.thumbnail_base64, Buffer.from(bytes).toString("base64"));
    assert.equal(result.thumbnail_source, "resolver_thumbnail");
    assert.equal(result.thumbnail_width, 320);
    assert.equal(result.thumbnail_height, 180);
    assert.equal(result.thumbnail_source_width, 1280);
    assert.equal(result.thumbnail_source_height, 720);
    assert.equal(result.thumbnail_resized, true);
  });

  it("passes the requested resize width to the thumbnail fetch", async () => {
    const calls: number[] = [];
    globalThis.fetch = async (_input, init) => {
      const width = Number((init as RequestInit & { cf?: { image?: { width?: number } } })?.cf?.image?.width || 0);
      calls.push(width);
      const bytes = pngBytes(width || 160, 90);
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(bytes.byteLength),
        },
      });
    };

    const result = await buildSocialThumbnailResponse(
      resolution({ thumbnail: "https://pbs.twimg.com/media/example.png", width: 1280, height: 720 }),
      env(),
      { maxWidth: 160 },
    );

    assert.equal(calls[0], 160);
    assert.equal(result.thumbnail_width, 160);
    assert.equal(result.thumbnail_height, 90);
    assert.equal(result.thumbnail_resized, true);
  });

  it("uses a photo itself when no dedicated thumbnail exists", () => {
    const result = firstSocialThumbnailUrl(resolution({
      type: "photo",
      mediaUrl: "https://pbs.twimg.com/media/photo.jpg",
    }));

    assert.equal(result, "https://pbs.twimg.com/media/photo.jpg");
  });

  it("keeps the URL but skips Base64 when disabled", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(new Uint8Array([1]));
    };

    const result = await buildSocialThumbnailResponse(
      resolution({ thumbnail: "https://pbs.twimg.com/media/example.jpg" }),
      env(),
      { includeBase64: false },
    );

    assert.equal(fetchCalls, 0);
    assert.equal(result.thumbnail_included, false);
    assert.equal(result.thumbnail_base64, null);
    assert.equal(result.thumbnail_url, "https://pbs.twimg.com/media/example.jpg");
  });

  it("does not buffer a thumbnail whose declared size exceeds the limit", async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": "999999",
      },
    });

    const result = await buildSocialThumbnailResponse(
      resolution({ thumbnail: "https://pbs.twimg.com/media/example.jpg" }),
      env(),
      { maxBytes: 32 },
    );

    assert.equal(result.thumbnail_included, false);
    assert.equal(result.thumbnail_base64, null);
    assert.equal(result.thumbnail_error, "thumbnail_too_large");
  });

  it("extracts the first top-level thumbnail for batch aggregation", () => {
    const result = firstThumbnailResponseFields([
      { ok: true },
      {
        thumbnail_url: "https://example.test/thumb.jpg",
        thumbnail_base64: "YWJj",
        thumbnail_mime_type: "image/jpeg",
        thumbnail_bytes: 3,
        thumbnail_source: "resolver_thumbnail",
        thumbnail_included: true,
        thumbnail_width: 160,
        thumbnail_height: 90,
        thumbnail_source_width: 1280,
        thumbnail_source_height: 720,
        thumbnail_resized: true,
      },
    ]);

    assert.equal(result.thumbnail_url, "https://example.test/thumb.jpg");
    assert.equal(result.thumbnail_base64, "YWJj");
    assert.equal(result.thumbnail_bytes, 3);
    assert.equal(result.thumbnail_width, 160);
    assert.equal(result.thumbnail_resized, true);
  });
});
