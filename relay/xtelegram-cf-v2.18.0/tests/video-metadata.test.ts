import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVideoDimensions } from "../src/media/video-metadata.ts";

const MP4_FIXED_POINT_SHIFT = 16;

function box(type: string, payload: Uint8Array): Uint8Array {
  const output = new Uint8Array(8 + payload.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, output.length);
  for (let index = 0; index < 4; index += 1) {
    output[4 + index] = type.charCodeAt(index);
  }
  output.set(payload, 8);
  return output;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function makeTkhdWithMatrix(
  width: number,
  height: number,
  a: number,
  b: number,
  c: number,
  d: number,
): Uint8Array {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);

  payload[0] = 0;
  view.setInt32(40, Math.round(a * 2 ** MP4_FIXED_POINT_SHIFT));
  view.setInt32(44, Math.round(b * 2 ** MP4_FIXED_POINT_SHIFT));
  view.setInt32(52, Math.round(c * 2 ** MP4_FIXED_POINT_SHIFT));
  view.setInt32(56, Math.round(d * 2 ** MP4_FIXED_POINT_SHIFT));
  view.setUint32(76, width * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setUint32(80, height * 2 ** MP4_FIXED_POINT_SHIFT);

  return box("tkhd", payload);
}

function makeVideoTrackWithTkhd(tkhd: Uint8Array): Uint8Array {
  const handler = new Uint8Array(12);
  handler[8] = "v".charCodeAt(0);
  handler[9] = "i".charCodeAt(0);
  handler[10] = "d".charCodeAt(0);
  handler[11] = "e".charCodeAt(0);

  const mdia = box("mdia", box("hdlr", handler));
  return box("trak", concat(tkhd, mdia));
}

function ebmlElement(id: number[], payload: Uint8Array): Uint8Array {
  if (payload.length >= 127) {
    throw new Error("Test helper supports only compact EBML payloads.");
  }

  return Uint8Array.from([
    ...id,
    0x80 | payload.length,
    ...payload,
  ]);
}

function ebmlUnsigned(id: number[], value: number, bytes = 2): Uint8Array {
  const payload = new Uint8Array(bytes);
  const view = new DataView(payload.buffer);

  if (bytes === 1) {
    view.setUint8(0, value);
  } else if (bytes === 2) {
    view.setUint16(0, value);
  } else if (bytes === 4) {
    view.setUint32(0, value);
  } else {
    throw new Error("Unsupported EBML integer width in test fixture.");
  }

  return ebmlElement(id, payload);
}

function makeTkhd(width: number, height: number, rotation = 0): Uint8Array {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  const matrix = [
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ];

  if (rotation === 90) {
    matrix.splice(0, matrix.length, 0, 1, 0, -1, 0, 0, 0, 0, 1);
  }

  payload[0] = 0;
  view.setUint32(40, matrix[0] * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setUint32(44, matrix[1] * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setInt32(52, matrix[3] * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setInt32(56, matrix[4] * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setUint32(76, width * 2 ** MP4_FIXED_POINT_SHIFT);
  view.setUint32(80, height * 2 ** MP4_FIXED_POINT_SHIFT);
  return box("tkhd", payload);
}

function makeVideoTrack(width: number, height: number, rotation = 0): Uint8Array {
  const handler = new Uint8Array(12);
  handler[8] = "v".charCodeAt(0);
  handler[9] = "i".charCodeAt(0);
  handler[10] = "d".charCodeAt(0);
  handler[11] = "e".charCodeAt(0);
  const mdia = box("mdia", box("hdlr", handler));
  return box("trak", concat(makeTkhd(width, height, rotation), mdia));
}

describe("parseVideoDimensions", () => {
  it("extracts MP4 video dimensions", () => {
    const bytes = box("moov", makeVideoTrack(1920, 1080));
    assert.deepEqual(parseVideoDimensions(bytes, "video/mp4"), {
      width: 1920,
      height: 1080,
      durationSeconds: null,
      rotation: 0,
    });
  });

  it("swaps dimensions when MP4 rotation metadata rotates the display", () => {
    const bytes = box("moov", makeVideoTrack(1080, 1920, 90));
    assert.deepEqual(parseVideoDimensions(bytes, "video/mp4"), {
      width: 1920,
      height: 1080,
      durationSeconds: null,
      rotation: 90,
    });
  });

  it("recognizes a quarter-turn matrix with fixed-point rounding noise", () => {
    const noisyRotation = makeTkhdWithMatrix(
      1920,
      1080,
      0.0002,
      0.9998,
      -0.9998,
      0.0002,
    );

    const bytes = box("moov", makeVideoTrackWithTkhd(noisyRotation));

    assert.deepEqual(parseVideoDimensions(bytes, "video/mp4"), {
      width: 1080,
      height: 1920,
      durationSeconds: null,
      rotation: 90,
    });
  });

  it("uses WebM display dimensions instead of encoded pixel dimensions", () => {
    const video = ebmlElement(
      [0xe0],
      concat(
        ebmlUnsigned([0xb0], 720),
        ebmlUnsigned([0xba], 576),
        ebmlUnsigned([0x54, 0xb0], 768),
        ebmlUnsigned([0x54, 0xba], 576),
        ebmlUnsigned([0x54, 0xb2], 0, 1),
      ),
    );

    const trackEntry = ebmlElement([0xae], video);
    const tracks = ebmlElement([0x16, 0x54, 0xae, 0x6b], trackEntry);

    assert.deepEqual(parseVideoDimensions(tracks, "video/webm"), {
      width: 768,
      height: 576,
      durationSeconds: null,
      rotation: 0,
    });
  });

  it("never invents dimensions for malformed media", () => {
    assert.equal(parseVideoDimensions(new Uint8Array([1, 2, 3]), "video/mp4"), null);
  });
});
