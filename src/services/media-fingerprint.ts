/**
 * Streaming media identity primitives used by the relay's duplicate detector.
 *
 * The SHA-256 implementation is incremental because Cloudflare Workers expose
 * WebCrypto's digest operation as a whole-buffer API. Keeping the hasher
 * incremental avoids creating another full-size copy of an already-buffered
 * upload and also lets download code hash each network chunk as it arrives.
 */

const SHA256_INITIAL_HASH = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
]);

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = "0123456789abcdef";
const FINGERPRINT_VERSION = 1;
const HISTOGRAM_BINS = 64;
const FINGERPRINT_CHUNK_BYTES = 1_048_576;

export interface MediaContentFingerprint {
  sha256: string;
  fingerprint: string;
  fingerprintVersion: number;
  byteLength: number;
}

/**
 * Incrementally computes SHA-256 while retaining only one 64-byte working
 * block and the 256-byte compression schedule in memory.
 *
 * @example
 * const hasher = new StreamingSha256();
 * hasher.update(new TextEncoder().encode("hello"));
 * const digest = hasher.digestHex();
 * // "2cf24dba5fb0a30e..."
 */
export class StreamingSha256 {
  private readonly state = new Uint32Array(SHA256_INITIAL_HASH);
  private readonly schedule = new Uint32Array(64);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private bytesHashed = 0;
  private finalized = false;

  /**
   * Feeds arbitrary-sized input into the SHA-256 compression function without
   * allocating a second copy of the caller's media buffer.
   *
   * @example
   * hasher.update(chunk);
   * // The chunk is consumed; no digest is produced yet.
   */
  update(input: Uint8Array): this {
    if (this.finalized) throw new Error("StreamingSha256 cannot be updated after digest().");
    if (!input.byteLength) return this;

    this.bytesHashed += input.byteLength;
    let offset = 0;

    if (this.blockLength) {
      const needed = 64 - this.blockLength;
      const copied = Math.min(needed, input.byteLength);
      this.block.set(input.subarray(0, copied), this.blockLength);
      this.blockLength += copied;
      offset += copied;
      if (this.blockLength === 64) {
        this.compress(this.block);
        this.blockLength = 0;
      }
    }

    while (offset + 64 <= input.byteLength) {
      this.compress(input.subarray(offset, offset + 64));
      offset += 64;
    }

    if (offset < input.byteLength) {
      this.block.set(input.subarray(offset), 0);
      this.blockLength = input.byteLength - offset;
    }

    return this;
  }

  /**
   * Finalizes the hash and returns its 32-byte digest. Finalization is cached
   * so repeated digest calls are deterministic and do not mutate the state a
   * second time.
   *
   * @example
   * const digest = hasher.digest();
   * // Uint8Array(32)
   */
  digest(): Uint8Array {
    if (!this.finalized) {
      const bitLengthLow = (this.bytesHashed * 8) >>> 0;
      const bitLengthHigh = Math.floor(this.bytesHashed / 0x20000000) >>> 0;
      const padded = new Uint8Array(128);
      padded.set(this.block.subarray(0, this.blockLength));
      padded[this.blockLength] = 0x80;

      const paddingLength = this.blockLength < 56 ? 64 : 128;
      const view = new DataView(padded.buffer);
      view.setUint32(paddingLength - 8, bitLengthHigh);
      view.setUint32(paddingLength - 4, bitLengthLow);

      this.compress(padded.subarray(0, 64));
      if (paddingLength === 128) this.compress(padded.subarray(64, 128));
      this.finalized = true;
    }

    const output = new Uint8Array(32);
    const view = new DataView(output.buffer);
    for (let index = 0; index < this.state.length; index += 1) {
      view.setUint32(index * 4, this.state[index]!);
    }
    return output;
  }

  /**
   * Returns the finalized SHA-256 digest as lowercase hexadecimal text, which
   * is compact and directly indexable in D1.
   *
   * @example
   * hasher.digestHex();
   * // "2cf24dba5fb0a30e..."
   */
  digestHex(): string {
    return bytesToHex(this.digest());
  }

  /**
   * Compresses one 512-bit SHA-256 block into the running hash state.
   *
   * @example
   * // Internal operation invoked by update() and digest().
   */
  private compress(block: Uint8Array): void {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    for (let index = 0; index < 16; index += 1) {
      this.schedule[index] = view.getUint32(index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const valueA = this.schedule[index - 15]!;
      const valueB = this.schedule[index - 2]!;
      this.schedule[index] = add32(
        smallSigma1(valueB),
        this.schedule[index - 7]!,
        smallSigma0(valueA),
        this.schedule[index - 16]!,
      );
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;

    for (let index = 0; index < 64; index += 1) {
      const temp1 = add32(h, bigSigma1(e), choose(e, f, g), SHA256_K[index]!, this.schedule[index]!);
      const temp2 = add32(bigSigma0(a), majority(a, b, c));
      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    this.state[0] = add32(this.state[0]!, a);
    this.state[1] = add32(this.state[1]!, b);
    this.state[2] = add32(this.state[2]!, c);
    this.state[3] = add32(this.state[3]!, d);
    this.state[4] = add32(this.state[4]!, e);
    this.state[5] = add32(this.state[5]!, f);
    this.state[6] = add32(this.state[6]!, g);
    this.state[7] = add32(this.state[7]!, h);
  }
}

/**
 * Builds a compact robustness-oriented fingerprint alongside SHA-256. It uses
 * a 64-bin byte-distribution signature, which is intentionally cheap and does
 * not require decoding H.264/VP9/AV1 frames in a Worker. It is therefore a
 * conservative near-duplicate hint, not a true frame-level perceptual hash.
 *
 * @example
 * const fingerprint = buildMediaFingerprint(bytes);
 * // { sha256, fingerprint, fingerprintVersion: 1, byteLength: bytes.length }
 */
export function buildMediaFingerprint(bytes: Uint8Array): MediaContentFingerprint {
  const accumulator = new MediaFingerprintAccumulator();
  for (let offset = 0; offset < bytes.byteLength; offset += FINGERPRINT_CHUNK_BYTES) {
    accumulator.update(bytes.subarray(offset, Math.min(offset + FINGERPRINT_CHUNK_BYTES, bytes.byteLength)));
  }
  return accumulator.digest();
}

/**
 * Incrementally tracks the fingerprint features while the network body is read.
 * This keeps hashing and fingerprinting on the same pass over the media bytes.
 */
export class MediaFingerprintAccumulator {
  private readonly sha256 = new StreamingSha256();
  private readonly histogram = new Float64Array(HISTOGRAM_BINS);
  private byteLength = 0;

  /**
   * Consumes a media chunk and updates both exact and robustness-oriented
   * content identity state.
   *
   * @example
   * accumulator.update(chunk);
   * // Hash state and histogram now include `chunk`.
   */
  update(chunk: Uint8Array): this {
    this.sha256.update(chunk);
    this.byteLength += chunk.byteLength;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      this.histogram[chunk[index]! >>> 2]! += 1;
    }
    return this;
  }

  /**
   * Finalizes the combined content identity without retaining the original
   * media bytes in the fingerprint object.
   *
   * @example
   * accumulator.digest();
   * // { sha256: "...", fingerprint: "...", fingerprintVersion: 1, byteLength: 1234 }
   */
  digest(): MediaContentFingerprint {
    const histogram = this.histogram;
    const max = Math.max(1, ...histogram);
    const normalized = new Uint8Array(HISTOGRAM_BINS);
    for (let index = 0; index < HISTOGRAM_BINS; index += 1) {
      normalized[index] = Math.min(255, Math.round((histogram[index]! / max) * 255));
    }

    return {
      sha256: this.sha256.digestHex(),
      fingerprint: bytesToHex(normalized),
      fingerprintVersion: FINGERPRINT_VERSION,
      byteLength: this.byteLength,
    };
  }
}

/**
 * Compares two robustness fingerprints using normalized L1 distance. A score
 * of 1 means identical distributions; lower values are increasingly different.
 *
 * @example
 * compareMediaFingerprints("00ff", "00ff");
 * // 1
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
 * Converts binary data into lowercase hexadecimal without allocating one
 * string per byte.
 */
function bytesToHex(bytes: Uint8Array): string {
  const output = new Array<string>(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    output[index] = HEX[value >>> 4]! + HEX[value & 0x0f]!;
  }
  return output.join("");
}

/** Converts an even-length hexadecimal fingerprint into bytes for comparison. */
function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return new Uint8Array();
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

/** Adds unsigned 32-bit operands with the wraparound semantics required by SHA-256. */
function add32(...values: number[]): number {
  let result = 0;
  for (const value of values) result = (result + value) >>> 0;
  return result;
}

/** Implements SHA-256's choose function. */
function choose(x: number, y: number, z: number): number {
  return ((x & y) ^ (~x & z)) >>> 0;
}

/** Implements SHA-256's majority function. */
function majority(x: number, y: number, z: number): number {
  return ((x & y) ^ (x & z) ^ (y & z)) >>> 0;
}

/** Implements the large Sigma-0 transform. */
function bigSigma0(value: number): number {
  return (rotr(value, 2) ^ rotr(value, 13) ^ rotr(value, 22)) >>> 0;
}

/** Implements the large Sigma-1 transform. */
function bigSigma1(value: number): number {
  return (rotr(value, 6) ^ rotr(value, 11) ^ rotr(value, 25)) >>> 0;
}

/** Implements the small Sigma-0 transform. */
function smallSigma0(value: number): number {
  return (rotr(value, 7) ^ rotr(value, 18) ^ (value >>> 3)) >>> 0;
}

/** Implements the small Sigma-1 transform. */
function smallSigma1(value: number): number {
  return (rotr(value, 17) ^ rotr(value, 19) ^ (value >>> 10)) >>> 0;
}

/** Performs a JavaScript-safe unsigned right rotation. */
function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
