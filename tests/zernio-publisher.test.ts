import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildZernioPost,
  normalizeZernioCaption,
  zernioIdempotencyKey,
} from "../src/services/zernio-publisher.ts";

describe("Zernio video publisher", () => {
  it("removes Telegram HTML, decodes entities and preserves X literal credits", () => {
    assert.equal(
      normalizeZernioCaption("<b>@author</b><br>Public cum &amp; fun <a href='https://x.com'>Abrir</a>", "twitter"),
      "@/author\nPublic cum & fun Abrir",
    );
  });
  it("returns normal mentions on Instagram, preserving hashtags", () => {
    assert.equal(normalizeZernioCaption("@/author #video", "instagram"), "@author #video");
  });
  it("builds deterministic stable idempotency keys", () => {
    const id = "12345678-abcd-1234-abcd-123456789abc";
    assert.equal(zernioIdempotencyKey(id, "twitter"), zernioIdempotencyKey(id, "twitter"));
    assert.notEqual(zernioIdempotencyKey(id, "twitter"), zernioIdempotencyKey(id, "instagram"));
  });
  it("schedules future content and publishes due content immediately", () => {
    const parameters = ["hello", "https://media.zernio.com/test.mp4", "twitter", "account1234"] as const;
    const scheduled = buildZernioPost(...parameters, 5000, 1000);
    assert.deepEqual(scheduled.mediaItems, [{ url: "https://media.zernio.com/test.mp4", type: "video" }]);
    assert.equal(scheduled.timezone, "UTC");
    assert.ok(!("publishNow" in scheduled));
    const immediate = buildZernioPost(...parameters, 1000, 1000);
    assert.equal(immediate.publishNow, true);
  });
  it("fails closed for caption length and insecure media URLs", () => {
    assert.throws(() => normalizeZernioCaption("x".repeat(281), "twitter"));
    assert.throws(() => buildZernioPost("hi", "http://example.com/1.mp4", "twitter", "account1234", 0, 0));
  });
});
