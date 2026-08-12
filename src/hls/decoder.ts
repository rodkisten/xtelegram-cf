import type { HlsKey } from "./types";

export interface HlsDecodeContext {
  key: HlsKey;
  mediaSequenceNumber: number;
  encryptedBytes: Uint8Array;
  loadKey: (uri: string) => Promise<Uint8Array>;
}

export class HlsDecodeError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HlsDecodeError";
  }
}

export class HlsAes128Decoder {
  private readonly keyCache = new Map<string, Uint8Array>();

  async decode(context: HlsDecodeContext): Promise<Uint8Array> {
    const { key, encryptedBytes, mediaSequenceNumber, loadKey } = context;

    if (!key || key.method === "NONE") {
      return encryptedBytes;
    }

    if (key.method !== "AES-128") {
      throw new HlsDecodeError(
        `Unsupported HLS encryption method: ${key.method || "unknown"}`,
        {
          method: key.method,
          keyFormat: key.keyFormat,
        },
      );
    }

    if (key.keyFormat && key.keyFormat !== "identity") {
      throw new HlsDecodeError(
        `Unsupported HLS KEYFORMAT for direct decryption: ${key.keyFormat}`,
        {
          keyFormat: key.keyFormat,
        },
      );
    }

    if (!key.uri) {
      throw new HlsDecodeError("AES-128 EXT-X-KEY has no URI");
    }

    let keyBytes = this.keyCache.get(key.uri);

    if (!keyBytes) {
      keyBytes = await loadKey(key.uri);

      if (keyBytes.byteLength !== 16) {
        throw new HlsDecodeError(
          `AES-128 key must be exactly 16 bytes, got ${keyBytes.byteLength}`,
          {
            keyUri: key.uri,
          },
        );
      }

      this.keyCache.set(key.uri, keyBytes);
    }

    const iv = key.iv || deriveHlsAes128Iv(mediaSequenceNumber);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toWebCryptoArrayBuffer(keyBytes),
      { name: "AES-CBC" },
      false,
      ["decrypt"],
    );

    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-CBC",
          iv: toWebCryptoArrayBuffer(iv),
        },
        cryptoKey,
        toWebCryptoArrayBuffer(encryptedBytes),
      );

      return new Uint8Array(decrypted);
    } catch (error) {
      throw new HlsDecodeError(
        "Failed to decrypt AES-128 HLS media unit",
        {
          cause: error instanceof Error ? error.message : String(error),
          keyUri: key.uri,
          mediaSequenceNumber,
        },
      );
    }
  }
}

/**
 * WebCrypto's DOM typings intentionally reject views backed by a
 * SharedArrayBuffer. HLS bytes normally come from an ArrayBuffer, so preserve
 * that zero-copy fast path; copy only sliced/shared views into an ArrayBuffer.
 */
function toWebCryptoArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }

  const copy = new Uint8Array(byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function deriveHlsAes128Iv(mediaSequenceNumber: number): Uint8Array {
  let value = BigInt(Math.max(0, mediaSequenceNumber));
  const iv = new Uint8Array(16);

  for (let index = 15; index >= 0 && value > 0n; index -= 1) {
    iv[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  return iv;
}
