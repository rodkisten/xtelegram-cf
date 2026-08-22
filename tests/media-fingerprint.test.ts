import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaFingerprint, compareMediaFingerprints } from "../src/services/media-fingerprint.ts";

const encoder = new TextEncoder();

test("native SHA-256 matches the standard test vector", async () => {
  const result = await buildMediaFingerprint(encoder.encode("abc"));
  assert.equal(
    result.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("bounded fingerprint keeps constant sampling work", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index += 4096) bytes[index] = index & 0xff;
  const result = await buildMediaFingerprint(bytes);

  assert.equal(result.byteLength, bytes.byteLength);
  assert.equal(result.sha256.length, 64);
  assert.equal(result.fingerprintVersion, 2);
  assert.equal(result.fingerprint.length, 128);
  assert.ok(result.sampledBytes <= 8192);
  assert.equal(compareMediaFingerprints(result.fingerprint, result.fingerprint), 1);
});
