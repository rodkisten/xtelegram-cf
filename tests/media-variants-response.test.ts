import assert from "node:assert/strict";
import test from "node:test";
import {
  collectNestedVariants,
  withMediaVariants,
} from "../src/lib/media-variants-response.ts";

test("collects every nested rendition and exposes its direct URL and quality", () => {
  const payload = {
    resolution: {
      media: [{
        variants: [
          { url: "https://cdn.example/1080x1920/high.mp4", quality: "1080x1920",
            width: 1080, height: 1920, contentLength: 700_000_000 },
          { url: "https://cdn.example/720x1280/medium.mp4", quality: "720x1280",
            width: 720, height: 1280, contentLength: 190_000_000 },
        ],
      }],
    },
    deliveries: [{ result: { clientFallback: { variants: [
      { mediaUrl: "https://cdn.example/320x568/small.mp4", quality: "320x568",
        width: 320, height: 568, contentLength: 52_000_000 },
    ] } } }],
  };

  const variants = collectNestedVariants(payload);
  assert.deepEqual(variants.map((item) => item.quality), [
    "1080x1920", "720x1280", "320x568",
  ]);
  assert.ok(variants.every((item) => item.url === item.mediaUrl));
});

test("decorates successful send responses with seeded direct variants", async () => {
  const response = new Response(JSON.stringify({ ok: true, message: "sent" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  const decorated = await withMediaVariants(response, [
    { mediaUrl: new URL("https://cdn.example/480x852/video.mp4"), quality: "480x852",
      width: 480, height: 852, contentLength: 98_000_000 },
  ]);
  const body = await decorated.json() as any;

  assert.equal(body.ok, true);
  assert.deepEqual(body.variantUrls, ["https://cdn.example/480x852/video.mp4"]);
  assert.equal(body.qualityUrls[0].quality, "480x852");
  assert.equal(body.variants[0].contentLength, 98_000_000);
});

test("always returns empty variant arrays when no rendition is known", async () => {
  const response = new Response(JSON.stringify({ ok: false, error: "invalid" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  const body = await (await withMediaVariants(response)).json() as any;
  assert.deepEqual(body.variants, []);
  assert.deepEqual(body.variantUrls, []);
  assert.deepEqual(body.qualityUrls, []);
});

