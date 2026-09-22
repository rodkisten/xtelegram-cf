/**
 * CPU-bounded media content identity primitives for Cloudflare Workers.
 *
 * Exact SHA-256 is delegated to the Workers runtime through Web Crypto instead
 * of implementing the SHA compression loop in JavaScript. The near-duplicate
 * fingerprint is deliberately sampled with a hard work budget so its CPU cost
 * does not grow linearly with a 10 MB, 50 MB, or larger video.
 */

const HEX = "0123456789abcdef";
const FINGERPRINT_VERSION = 2;
const HISTOGRAM_BINS = 64;
const MAX_FINGERPRINT_SAMPLES = 2_048;
const MAX_SAMPLES_PER_CHUNK = 32;

export interface MediaContentFingerprint {
  sha256: string | null;
  fingerprint: string;
  fingerprintVersion: number;
  byteLength: number;
  sampledBytes: number;
}

/**
 * Incremental content identity for network bodies. SHA-256 is computed by the
 * native Workers DigestStream; only a tiny deterministic sample is inspected in
 * JavaScript for the robustness hint.
 */
export class MediaFingerprintAccumulator {
  private readonly digestStream: DigestStream | null;
  private readonly writer: WritableStreamDefaultWriter<BufferSource> | null;
  private readonly sampler = new BoundedFingerprintSampler();
  private byteLength = 0;
  private finalized: Promise<MediaContentFingerprint> | null = null;

  constructor(computeExactHash = true) {
    if (computeExactHash) {
      const DigestStreamCtor = (crypto as Crypto & { DigestStream: typeof DigestStream }).DigestStream;
      this.digestStream = new DigestStreamCtor("SHA-256");
      this.writer = this.digestStream.getWriter();
    } else {
      this.digestStream = null;
      this.writer = null;
    }
  }

  async update(chunk: Uint8Array): Promise<this> {
    if (this.finalized) throw new Error("MediaFingerprintAccumulator is already finalized.");
    if (!chunk.byteLength) return this;

    this.byteLength += chunk.byteLength;
    this.sampler.update(chunk);
    if (this.writer) await this.writer.write(asBufferSource(chunk));
    return this;
  }

  digest(): Promise<MediaContentFingerprint> {
    if (!this.finalized) {
      this.finalized = (async () => {
        let sha256: string | null = null;
        if (this.writer && this.digestStream) {
          await this.writer.close();
          const digest = await this.digestStream.digest;
          sha256 = bytesToHex(new Uint8Array(digest));
        }
        return {
          sha256,
          fingerprint: this.sampler.digest(),
          fingerprintVersion: FINGERPRINT_VERSION,
          byteLength: this.byteLength,
          sampledBytes: this.sampler.sampleCount,
        };
      })();
    }
    return this.finalized;
  }
}

/**
 * Fast path for media that is already buffered (for example remuxed HLS). The
 * runtime's native SubtleCrypto implementation avoids a second JavaScript pass
 * over every byte.
 */
export async function buildMediaFingerprint(
  bytes: Uint8Array,
  computeExactHash = true,
): Promise<MediaContentFingerprint> {
  const sampler = new BoundedFingerprintSampler();
  sampler.update(bytes);
  const digest = computeExactHash ? await crypto.subtle.digest("SHA-256", asBufferSource(bytes)) : null;
  return {
    sha256: digest ? bytesToHex(new Uint8Array(digest)) : null,
    fingerprint: sampler.digest(),
    fingerprintVersion: FINGERPRINT_VERSION,
    byteLength: bytes.byteLength,
    sampledBytes: sampler.sampleCount,
  };
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  // Ordinary Worker chunks need no copy. Web Crypto cannot consume shared memory.
  return bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

/**
 * Compares two bounded byte-distribution hints. This is intentionally only a
 * conservative near-duplicate heuristic; it is not a frame-decoding pHash.
 */
export function compareMediaFingerprints(left: string, right: string): number {
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  if (!a.length || a.length !== b.length) return 0;

  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    distance += Math.abs(a[index]! - b[index]!);
  }
  return 1 - distance / (a.length * 255);
}

/**
 * Reads at most MAX_FINGERPRINT_SAMPLES bytes total. Each incoming network
 * chunk contributes at most MAX_SAMPLES_PER_CHUNK evenly-spaced samples, so
 * one giant chunk cannot consume the entire budget at once.
 */
class BoundedFingerprintSampler {
  private readonly histogram = new Uint32Array(HISTOGRAM_BINS);
  private sampled = 0;

  get sampleCount(): number {
    return this.sampled;
  }

  update(chunk: Uint8Array): void {
    const remaining = MAX_FINGERPRINT_SAMPLES - this.sampled;
    if (remaining <= 0 || !chunk.byteLength) return;

    const samples = Math.min(remaining, MAX_SAMPLES_PER_CHUNK, chunk.byteLength);
    const stride = chunk.byteLength / samples;

    for (let index = 0; index < samples; index += 1) {
      const position = Math.min(chunk.byteLength - 1, Math.floor((index + 0.5) * stride));
      this.histogram[chunk[position]! >>> 2]! += 1;
    }
    this.sampled += samples;
  }

  digest(): string {
    if (!this.sampled) return "";

    let max = 1;
    for (const count of this.histogram) max = Math.max(max, count);

    const normalized = new Uint8Array(HISTOGRAM_BINS);
    for (let index = 0; index < HISTOGRAM_BINS; index += 1) {
      normalized[index] = Math.min(255, Math.round((this.histogram[index]! / max) * 255));
    }
    return bytesToHex(normalized);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  const output = new Array<string>(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    output[index] = HEX[value >>> 4]! + HEX[value & 0x0f]!;
  }
  return output.join("");
}

function hexToBytes(value: string): Uint8Array {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    return new Uint8Array(0);
  }

  const output = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}
