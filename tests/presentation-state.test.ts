import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPresentationSnapshot,
  comparePresentationSnapshots,
  mergePresentationSnapshot,
  parsePresentationSnapshot,
  serializePresentationSnapshot,
} from "../src/services/presentation-state.ts";

test("canonicalizes metadata ordering so equivalent payloads compare unchanged", () => {
  const left = buildPresentationSnapshot({
    caption: "Hello",
    parseMode: "HTML",
    metadata: { b: "2", a: "1" },
  });
  const right = buildPresentationSnapshot({
    caption: "Hello",
    parseMode: "HTML",
    metadata: { a: "1", b: "2" },
  });
  assert.equal(serializePresentationSnapshot(left), serializePresentationSnapshot(right));
  assert.equal(comparePresentationSnapshots(left, right).changed, false);
});

test("reports caption, parse mode and metadata differences separately", () => {
  const before = buildPresentationSnapshot({
    caption: "Old",
    parseMode: "HTML",
    metadata: { a: "1", removed: "yes", changed: "old" },
  });
  const after = buildPresentationSnapshot({
    caption: "New",
    parseMode: "MarkdownV2",
    metadata: { a: "1", added: "yes", changed: "new" },
  });
  const diff = comparePresentationSnapshots(before, after);
  assert.equal(diff.changed, true);
  assert.equal(diff.captionChanged, true);
  assert.equal(diff.parseModeChanged, true);
  assert.equal(diff.metadataChanged, true);
  assert.deepEqual(diff.metadataAdded, ["added"]);
  assert.deepEqual(diff.metadataRemoved, ["removed"]);
  assert.deepEqual(diff.metadataChangedKeys, ["changed"]);
});

test("metadata-only patch preserves the existing caption", () => {
  const before = buildPresentationSnapshot({
    caption: "Keep me",
    parseMode: "HTML",
    metadata: { a: "1" },
  });
  const after = mergePresentationSnapshot(before, {
    captionProvided: false,
    metadataProvided: true,
    metadata: { a: "2" },
  });
  assert.equal(after.caption, "Keep me");
  assert.equal(after.parseMode, "HTML");
  assert.deepEqual(after.metadata, { a: "2" });
});

test("caption-only patch preserves the existing metadata", () => {
  const before = buildPresentationSnapshot({
    caption: "Old",
    parseMode: null,
    metadata: { foo: "bar" },
  });
  const after = mergePresentationSnapshot(before, {
    captionProvided: true,
    caption: "New",
    parseMode: null,
    metadataProvided: false,
  });
  assert.equal(after.caption, "New");
  assert.deepEqual(after.metadata, { foo: "bar" });
});

test("serialized presentation snapshots round-trip", () => {
  const snapshot = buildPresentationSnapshot({
    caption: "Caption",
    parseMode: "HTML",
    metadata: { foo: "bar" },
  });
  assert.deepEqual(parsePresentationSnapshot(serializePresentationSnapshot(snapshot)), snapshot);
});
