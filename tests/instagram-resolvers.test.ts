import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  normalizeInstagramMedia,
  resolveEasyDownInstagram,
  resolveGetInSaverInstagram,
  resolveSssInstagramStory,
  supportsSssInstagramStory,
} from "../src/resolvers/instagram.ts";
import type { Env } from "../src/types.ts";

const STORY = "https://www.instagram.com/stories/example.user/4018971762808101215/";
const REEL = "https://www.instagram.com/reel/AbC_de-123/";
const VIDEO = "https://instagram.example-cdn.com/media.mp4";
const IMAGE = "https://instagram.example-cdn.com/media.jpg";

describe("Instagram resolver adapters", () => {
  it("preserves carousel order and does not misclassify thumbnails as carousel items", () => {
    const media = normalizeInstagramMedia({
      data: {
        items: [
          { url: IMAGE, type: "image", thumbnail: "https://instagram.example-cdn.com/cover.jpg" },
          { url: VIDEO, type: "video", width: 720, height: 1280 },
          { url: IMAGE, type: "image" },
        ],
      },
      thumbnail: "https://instagram.example-cdn.com/root-cover.jpg",
    });
    assert.equal(media.length, 2);
    assert.deepEqual(media.map((item) => item.type), ["photo", "video"]);
    assert.deepEqual(media.map((item) => item.index), [0, 1]);
    assert.equal(media[1]?.width, 720);
    assert.equal(media[1]?.variants.length, 1);
  });

  it("rejects unsafe URLs returned by untrusted download providers", () => {
    const media = normalizeInstagramMedia({
      items: [
        { url: "http://127.0.0.1/private", type: "video" },
        { url: "https://169.254.169.254/latest/meta-data", type: "video" },
        { url: "file:///secret", type: "video" },
        { url: "https://user:password@cdn.example-cdn.com/a.mp4", type: "video" },
        { url: VIDEO, type: "video" },
      ],
    });
    assert.equal(media.length, 1);
    assert.equal(media[0]?.url, VIDEO);
  });

  it("does not attempt sssInstagram v2 without validated signing configuration", async () => {
    assert.equal(supportsSssInstagramStory(STORY, {} as Env), false);
    assert.equal(supportsSssInstagramStory(REEL, {
      SSSINSTAGRAM_HMAC_KEY: "test",
      SSSINSTAGRAM_BUILD_TS: "1793186334313",
    } as Env), false);
    await assert.rejects(
      resolveSssInstagramStory(STORY, {} as Env),
      /signing parameters are not configured/,
    );
  });

  it("builds a fresh signed v2 request for Stories and normalizes the response", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      assert.equal(_url, "https://api-wh.sssinstagram.com/api/v2/instagram/story");
      const body = JSON.parse(String(init.body));
      assert.equal(body.url, STORY);
      assert.equal(body._ts, 1793186334313);
      assert.equal(body._tsc, 0);
      assert.equal(body._sv, 2);
      assert.match(body._s, /^[a-f0-9]{64}$/);
      assert.ok(Math.abs(Date.now() - body.ts) < 5_000);
      return Response.json({ data: { medias: [{ url: VIDEO, isVideo: true }] } });
    });
    const media = await resolveSssInstagramStory(STORY, {
      SSSINSTAGRAM_HMAC_KEY: "example-test-key",
      SSSINSTAGRAM_BUILD_TS: "1793186334313",
    } as Env);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(media.media.length, 1);
    assert.equal(media.media[0]?.type, "video");
  });

  it("reads EasyDown's documented nested media contract", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      assert.equal(_url, "https://api.easydown.org/api/v1/platforms/instagram/parse");
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer example-token");
      return Response.json({
        status: 200,
        data: {
          media: {
            title: "Sample Reel", videos: [{ url: VIDEO, quality: "720p" }],
            images: [{ url: IMAGE }],
          },
          platformData: { user: { username: "example.user" } },
        },
      });
    });
    const result = await resolveEasyDownInstagram(REEL, { EASYDOWN_API_KEY: "example-token" } as Env);
    assert.equal(result.media.length, 1, "a reel must never fall back to its cover image");
    assert.equal(result.media[0]?.type, "video");
    assert.equal(result.authorUsername, "@example.user");
  });

  it("selects GetInSaver's story service and preserves mixed carousel items", async (t) => {
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      assert.equal(_url, "https://developers.getinsaver.com/v1/resolve");
      const body = JSON.parse(String(init.body));
      assert.equal(body.service, "instagram-story");
      assert.equal(body.max_results, 1);
      return Response.json({ ok: true, items: [{ url: IMAGE, type: "image" }], metadata: { author: "example.user" } });
    });
    const result = await resolveGetInSaverInstagram(STORY, { GETINSAVER_API_KEY: "example-token" } as Env);
    assert.equal(result.media[0]?.type, "photo");
    assert.equal(result.authorUsername, "@example.user");
  });

  it("raises failures for fallback routing instead of returning empty success", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
    await assert.rejects(
      resolveEasyDownInstagram(REEL, { EASYDOWN_API_KEY: "example-token" } as Env),
      /HTTP 503/,
    );
  });
});
