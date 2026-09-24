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
} = {}): SocialResolution {
  const mediaUrl = options.mediaUrl || "https://cdn.example.test/video.mp4";
  const type = options.type || "video";
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
      width: 1080,
      height: 1920,
      thumbnail: options.thumbnail ?? null,
      contentLength: null,
      bitrate: null,
      mediaHeaders: {},
      variants: [{
        url: mediaUrl,
        type,
        quality: "1080p",
        width: 1080,
        height: 1920,
        thumbnail: options.thumbnail ?? null,
        contentLength: null,
        bitrate: null,
        mediaHeaders: {},
      }],
    }],
  };
}

describe("thumbnail response", () => {
  it("encodes a resolver thumbnail as raw Base64", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(bytes.byteLength),
      },
    });

    const result = await buildSocialThumbnailResponse(
      resolution({ thumbnail: "https://pbs.twimg.com/media/example.jpg" }),
      env(),
    );

    assert.equal(result.thumbnail_included, true);
    assert.equal(result.thumbnail_mime_type, "image/jpeg");
    assert.equal(result.thumbnail_bytes, 4);
    assert.equal(result.thumbnail_base64, "/9j/2Q==");
    assert.equal(result.thumbnail_source, "resolver_thumbnail");
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
      },
    ]);

    assert.equal(result.thumbnail_url, "https://example.test/thumb.jpg");
    assert.equal(result.thumbnail_base64, "YWJj");
    assert.equal(result.thumbnail_bytes, 3);
  });
});
