import assert from "node:assert/strict";
import test from "node:test";

import {
  appendHashtagsToCaption,
  normalizeHashtags,
  TELEGRAM_CAPTION_MAX_CHARS,
} from "../src/lib/hashtags.ts";

test("normalizes, prefixes and deduplicates hashtags", () => {
  const result = normalizeHashtags(["rod", "#Video", "video", "front-end"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, ["rod", "Video", "front_end"]);
});

test("accepts a whitespace/comma separated hashtag string", () => {
  const result = normalizeHashtags("#one two, três");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, ["one", "two", "três"]);
});

test("appends hashtags after an existing caption", () => {
  const result = appendHashtagsToCaption("Caption", ["one", "two"], null);
  assert.equal(result.caption, "Caption\\n\\n#one #two".replace(/\\n/g, "\n"));
  assert.equal(result.parseMode, null);
});

test("escapes hashtags under MarkdownV2", () => {
  const result = appendHashtagsToCaption("Caption", ["front_end"], "MarkdownV2");
  assert.equal(result.caption, "Caption\n\n\\#front\\_end");
  assert.equal(result.parseMode, "MarkdownV2");
});

test("preserves all hashtags by shortening the base caption first", () => {
  const tags = ["one", "two", "three"];
  const result = appendHashtagsToCaption("x".repeat(2000), tags, null);
  assert.ok(result.caption.endsWith("#one #two #three"));
  assert.ok(result.caption.length <= TELEGRAM_CAPTION_MAX_CHARS);
});
