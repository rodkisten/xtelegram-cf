import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identifyXSource, transformXRepostCaption } from "../src/services/x-repost-queue.ts";

describe("X repost queue caption and source identity", () => {
  it("uses one key for the same X status across hosts and tracking parameters", () => {
    assert.deepEqual(
      identifyXSource("https://twitter.com/example/status/123456?s=20"),
      { key: "x:123456", url: "https://x.com/example/status/123456" },
    );
    assert.equal(identifyXSource("https://x.com/i/status/123456")?.key, "x:123456");
    assert.equal(identifyXSource("https://example.com/user/status/123"), null);
  });

  it("turns handles into literal credits but preserves tags, URLs, emails and existing credits", () => {
    assert.equal(
      transformXRepostCaption("Créditos: @creator e @amigo\n#video #viral\nmail@domain.com @/done"),
      "Créditos: @/creator e @/amigo\n#video #viral\nmail@domain.com @/done",
    );
  });

  it("appends only missing normalized hashtags", () => {
    assert.equal(
      transformXRepostCaption("@creator #Video", ["#video", "#edit", "edit", "🏖️"]),
      "@/creator #Video\n\n#edit",
    );
  });

  it("does not overflow the basic character cap when adding tags", () => {
    const caption = transformXRepostCaption("a".repeat(350), ["#video"]);
    assert.ok(Array.from(caption).length <= 280);
    assert.ok(caption.endsWith("#video"));
  });
});
