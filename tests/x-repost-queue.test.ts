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

  it("keeps existing @/user credits but removes active mentions and links", () => {
    const caption = transformXRepostCaption(
      "Créditos: @/author @normal\nAbrir no X: https://x.com/foo/status/123\n" +
        "Outro link: www.example.com/abc e t.co/xyz\n#Video #dorkis10",
    );
    assert.ok(caption.includes("@/author"));
    assert.ok(!caption.includes("@normal"));
    assert.ok(!/abrir\s+no\s+x/i.test(caption));
    assert.ok(!caption.includes("https://"));
    assert.ok(!caption.includes("www."));
    assert.ok(!caption.includes("t.co"));
    assert.ok(caption.includes("#Video"));
    assert.ok(caption.endsWith("#dorkis10"));
    assert.equal((caption.match(/#dorkis10/gi) || []).length, 1);
  });

  it("removes Telegram HTML, Markdown URLs, emails and normal mentions", () => {
    const caption = transformXRepostCaption(
      "<b>@/credits</b><br>[Abrir no X](https://x.com/p/123) " +
      "mail@example.com @someone #Tag",
    );
    assert.ok(caption.includes("@/credits"));
    assert.ok(caption.includes("#Tag"));
    assert.ok(!caption.includes("<b>"));
    assert.ok(!caption.includes("mail@example.com"));
    assert.ok(!caption.includes("Abrir no X"));
    assert.ok(!caption.includes("https://"));
    assert.ok(!caption.includes("@someone"));
  });

  it("appends only missing optional hashtags and always one final #dorkis10", () => {
    const caption = transformXRepostCaption(
      "@/creator #Video #DORKIS10",
      ["#video", "#edit", "edit", "dorkis10", "🏖️"],
    );
    assert.equal(caption, "@/creator #Video\n\n#edit #dorkis10");
    assert.equal(transformXRepostCaption(caption), caption, "cleaning must be idempotent");
  });

  it("always emits the default tag for an empty or link-only caption", () => {
    assert.equal(transformXRepostCaption(""), "#dorkis10");
    assert.equal(transformXRepostCaption("Abrir no X https://x.com/foo/status/1"), "#dorkis10");
  });

  it("caps body length without truncating the final default hashtag", () => {
    const caption = transformXRepostCaption("a".repeat(350), ["#video"]);
    assert.ok(Array.from(caption).length <= 280);
    assert.ok(caption.endsWith("#dorkis10"));
    assert.ok(caption.includes("#video"));
    assert.equal((caption.match(/#dorkis10/gi) || []).length, 1);
  });
});
