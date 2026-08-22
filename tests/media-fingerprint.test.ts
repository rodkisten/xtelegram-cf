import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaFingerprintAccumulator,
  StreamingSha256,
  compareMediaFingerprints,
} from "../src/services/media-fingerprint.ts";

const encoder = new TextEncoder();

test("StreamingSha256 matches the standard SHA-256 test vector", () => {
  const hasher = new StreamingSha256();
  hasher.update(encoder.encode("a"));
  hasher.update(encoder.encode("bc"));
  assert.equal(
    hasher.digestHex(),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("MediaFingerprintAccumulator hashes and fingerprints one pass of media bytes", () => {
  const accumulator = new MediaFingerprintAccumulator();
  accumulator.update(new Uint8Array([0, 1, 2, 3]));
  accumulator.update(new Uint8Array([4, 5, 6, 7]));
  const result = accumulator.digest();

  assert.equal(result.byteLength, 8);
  assert.equal(result.sha256.length, 64);
  assert.equal(result.fingerprintVersion, 1);
  assert.equal(result.fingerprint.length, 128);
  assert.equal(compareMediaFingerprints(result.fingerprint, result.fingerprint), 1);
});
