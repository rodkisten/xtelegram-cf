import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSocialDeliveryContent } from "../src/services/social-metadata.ts";

describe("social caption invariant", () => {
  it("uses resolver metadata for YouTube without a second metadata fetch", async () => {
    const result = await resolveSocialDeliveryContent(
      {
        provider: "youtube",
        sourceUrl: "https://youtu.be/abcdefghijk",
        pageUrl: null,
        caption: "",
        captionExplicit: false,
        parseMode: null,
        metadata: {
          socialResolvedCaption: "A title",
          socialAuthorName: "Creator",
        },
      },
      {} as any,
    );

    assert.equal(result.parseMode, "HTML");
    assert.match(result.caption, /YouTube/);
    assert.match(result.caption, /Creator/);
    assert.match(result.caption, /A title/);
    assert.match(result.caption, /Origem/);
  });

  it("falls back to the original source URL for generic media", async () => {
    const result = await resolveSocialDeliveryContent(
      {
        provider: "generic",
        sourceUrl: "https://example.com/post/123",
        pageUrl: null,
        caption: "",
        captionExplicit: false,
        parseMode: null,
        metadata: null,
      },
      {} as any,
    );

    assert.equal(result.caption, "https://example.com/post/123");
    assert.equal(result.parseMode, null);
  });
});
