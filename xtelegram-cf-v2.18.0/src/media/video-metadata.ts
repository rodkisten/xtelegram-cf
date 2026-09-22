/**
 * Lightweight video container metadata extraction for Cloudflare Workers.
 *
 * The relay must not trust Telegram to infer dimensions after receiving a
 * Worker-uploaded video. Supplying the real dimensions prevents Telegram from
 * rendering a video with an incorrect aspect ratio.
 */

import type { VideoMetadata } from "../types";
import { RELAY_LIMITS } from "../config/constants";

export type VideoDimensions = VideoMetadata;

const BOX_HEADER_BYTES = 8;
const EXTENDED_BOX_HEADER_BYTES = 16;
const MP4_FIXED_POINT_SHIFT = 16;
const EBML_ID_MAX_BYTES = 4;
const EBML_SIZE_MAX_BYTES = 8;

/**
 * Extracts the display dimensions from an uploaded video.
 *
 * MP4/MOV is parsed without FFmpeg so the Worker does not need a heavyweight
 * WASM runtime. WebM dimensions are also recognized through EBML track
 * metadata. A null result is deliberately safe: callers must never invent
 * width/height values.
 *
 * @example
 * const metadata = parseVideoDimensions(bytes, "video/mp4");
 * if (metadata) console.log(metadata.width, metadata.height);
 */
export function parseVideoDimensions(
  bytes: Uint8Array,
  contentType = "",
): VideoDimensions | null {
  if (bytes.byteLength < BOX_HEADER_BYTES) return null;

  const normalizedType = String(contentType).toLowerCase();
  if (normalizedType.includes("webm") || normalizedType.includes("matroska")) {
    return parseWebmDimensions(bytes);
  }

  const mp4 = parseMp4Dimensions(bytes);
  if (mp4) return mp4;

  return normalizedType.includes("mp4") || normalizedType.includes("quicktime")
    ? null
    : parseWebmDimensions(bytes);
}


/**
 * CPU/memory-bounded metadata probe for large videos. Most streamable MP4s keep
 * `moov` near the beginning; non-faststart files usually keep it near the end.
 * Avoid scanning a 10-20 MiB body when at most a small head/tail window is needed.
 */
export function parseVideoDimensionsBounded(
  bytes: Uint8Array,
  contentType = "",
): VideoDimensions | null {
  const headBytes = RELAY_LIMITS.videoMetadataProbeHeadBytes;
  const tailBytes = RELAY_LIMITS.videoMetadataProbeTailBytes;

  if (bytes.byteLength <= headBytes + tailBytes) {
    return parseVideoDimensions(bytes, contentType);
  }

  const head = bytes.subarray(0, Math.min(bytes.byteLength, headBytes));
  const fromHead = parseVideoDimensions(head, contentType);
  if (fromHead) return fromHead;

  const normalizedType = String(contentType).toLowerCase();
  if (normalizedType.includes("webm") || normalizedType.includes("matroska")) {
    return null;
  }

  const tailStart = Math.max(0, bytes.byteLength - tailBytes);
  return parseMp4MoovWindow(bytes.subarray(tailStart));
}

/**
 * Blob variant used by multipart uploads. It never materializes the complete
 * File into a second ArrayBuffer, which materially lowers isolate memory.
 */
export async function parseVideoDimensionsFromBlob(
  blob: Blob,
  contentType = "",
): Promise<VideoDimensions | null> {
  const headSize = Math.min(blob.size, RELAY_LIMITS.videoMetadataProbeHeadBytes);
  const head = new Uint8Array(await blob.slice(0, headSize).arrayBuffer());
  const fromHead = parseVideoDimensions(head, contentType);
  if (fromHead) return fromHead;

  const normalizedType = String(contentType).toLowerCase();
  if (
    blob.size <= headSize ||
    normalizedType.includes("webm") ||
    normalizedType.includes("matroska")
  ) {
    return null;
  }

  const tailStart = Math.max(0, blob.size - RELAY_LIMITS.videoMetadataProbeTailBytes);
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  return parseMp4MoovWindow(tail);
}

function parseMp4MoovWindow(windowBytes: Uint8Array): VideoDimensions | null {
  if (windowBytes.byteLength < BOX_HEADER_BYTES) return null;

  // TextDecoder performs the scan in native code and is substantially cheaper
  // than a JavaScript byte-by-byte search across several megabytes.
  const text = new TextDecoder("latin1").decode(windowBytes);
  let typeOffset = text.lastIndexOf("moov");

  while (typeOffset >= 4) {
    const boxStart = typeOffset - 4;
    const view = new DataView(
      windowBytes.buffer,
      windowBytes.byteOffset + boxStart,
      windowBytes.byteLength - boxStart,
    );
    const size32 = view.getUint32(0);
    let headerBytes = BOX_HEADER_BYTES;
    let boxSize = size32;

    if (size32 === 1 && view.byteLength >= EXTENDED_BOX_HEADER_BYTES) {
      const high = view.getUint32(8);
      const low = view.getUint32(12);
      boxSize = high * 2 ** 32 + low;
      headerBytes = EXTENDED_BOX_HEADER_BYTES;
    } else if (size32 === 0) {
      boxSize = view.byteLength;
    }

    if (
      Number.isFinite(boxSize) &&
      boxSize >= headerBytes &&
      boxSize <= view.byteLength
    ) {
      const candidate = windowBytes.subarray(boxStart, boxStart + boxSize);
      const parsed = parseVideoDimensions(candidate, "video/mp4");
      if (parsed) return parsed;
    }

    typeOffset = text.lastIndexOf("moov", typeOffset - 1);
  }

  return null;
}

function parseMp4Dimensions(bytes: Uint8Array): VideoDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let boxCount = 0;

  const walk = (start: number, end: number, depth: number): VideoDimensions | null => {
    if (depth > RELAY_LIMITS.videoMetadataBoxDepthMax) return null;

    let offset = start;
    while (offset + BOX_HEADER_BYTES <= end && boxCount < RELAY_LIMITS.videoMetadataBoxCountMax) {
      boxCount += 1;
      const box = readMp4Box(view, offset, end);
      if (!box) return null;

      if (box.type === "trak") {
        const track = parseMp4VideoTrack(view, box.payloadStart, box.payloadEnd);
        if (track) return track;
      }

      if (box.type === "moov" || box.type === "trak" || box.type === "mdia") {
        const nested = walk(box.payloadStart, box.payloadEnd, depth + 1);
        if (nested) return nested;
      }

      offset = box.end;
    }

    return null;
  };

  return walk(0, bytes.byteLength, 0);
}

function parseMp4VideoTrack(
  view: DataView,
  start: number,
  end: number,
): VideoDimensions | null {
  let offset = start;
  let handlerType: string | null = null;
  let dimensions: VideoDimensions | null = null;

  while (offset + BOX_HEADER_BYTES <= end) {
    const box = readMp4Box(view, offset, end);
    if (!box) return null;

    if (box.type === "mdia") {
      handlerType = findMp4Handler(view, box.payloadStart, box.payloadEnd) || handlerType;
    }

    if (box.type === "tkhd") {
      dimensions = parseTkhd(view, box.payloadStart, box.payloadEnd);
    }

    offset = box.end;
  }

  return handlerType === "vide" ? dimensions : null;
}

function findMp4Handler(view: DataView, start: number, end: number): string | null {
  let offset = start;
  while (offset + BOX_HEADER_BYTES <= end) {
    const box = readMp4Box(view, offset, end);
    if (!box) return null;

    if (box.type === "hdlr") {
      const handlerOffset = box.payloadStart + 8;
      if (handlerOffset + 4 > box.payloadEnd) return null;
      return readAscii(view, handlerOffset, 4);
    }

    offset = box.end;
  }

  return null;
}

function parseTkhd(view: DataView, start: number, end: number): VideoDimensions | null {
  if (start + 4 > end) return null;

  const version = view.getUint8(start);
  const matrixOffset = version === 1 ? 60 : 40;
  const matrixStart = start + matrixOffset;
  const dimensionsStart = matrixStart + 36;
  if (dimensionsStart + 8 > end) return null;

  const rawWidth = view.getUint32(dimensionsStart) / 2 ** MP4_FIXED_POINT_SHIFT;
  const rawHeight = view.getUint32(dimensionsStart + 4) / 2 ** MP4_FIXED_POINT_SHIFT;
  if (!isFinitePositiveDimension(rawWidth) || !isFinitePositiveDimension(rawHeight)) {
    return null;
  }

  const rotation = readMp4Rotation(view, matrixStart, end);
  const rotated = rotation === 90 || rotation === 270;

  return {
    width: Math.round(rotated ? rawHeight : rawWidth),
    height: Math.round(rotated ? rawWidth : rawHeight),
    durationSeconds: null,
    rotation,
  };
}

function readMp4Rotation(
  view: DataView,
  matrixStart: number,
  end: number,
): 0 | 90 | 180 | 270 {
  if (matrixStart + 20 > end) return 0;

  const a = readSignedFixed16(view, matrixStart);
  const b = readSignedFixed16(view, matrixStart + 4);
  const c = readSignedFixed16(view, matrixStart + 12);
  const d = readSignedFixed16(view, matrixStart + 16);

  if (![a, b, c, d].every(Number.isFinite)) return 0;

  /*
   * Real MP4/MOV files do not always store a mathematically perfect quarter
   * turn. Encoders can include tiny fixed-point rounding errors or scale in
   * the transform matrix. Exact equality therefore misses legitimate portrait
   * rotations and makes Telegram render them as landscape.
   */
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  if (scaleX < 0.0001 || scaleY < 0.0001) return 0;

  const normalizedA = a / scaleX;
  const normalizedB = b / scaleX;
  const angle = normalizeDegrees(Math.atan2(normalizedB, normalizedA) * 180 / Math.PI);
  const nearestQuarter = Math.round(angle / 90) * 90;
  const normalizedQuarter = ((nearestQuarter % 360) + 360) % 360;
  const delta = Math.abs(shortestAngleDelta(angle, normalizedQuarter));

  if (delta > 3) return 0;

  if (normalizedQuarter === 90) return 90;
  if (normalizedQuarter === 180) return 180;
  if (normalizedQuarter === 270) return 270;
  return 0;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function shortestAngleDelta(left: number, right: number): number {
  return ((left - right + 540) % 360) - 180;
}

function readSignedFixed16(view: DataView, offset: number): number {
  return view.getInt32(offset) / 2 ** MP4_FIXED_POINT_SHIFT;
}

interface Mp4Box {
  type: string;
  payloadStart: number;
  payloadEnd: number;
  end: number;
}

function readMp4Box(view: DataView, start: number, parentEnd: number): Mp4Box | null {
  if (start + BOX_HEADER_BYTES > parentEnd) return null;

  const size32 = view.getUint32(start);
  const type = readAscii(view, start + 4, 4);
  let headerSize = BOX_HEADER_BYTES;
  let size = size32;

  if (size32 === 1) {
    if (start + EXTENDED_BOX_HEADER_BYTES > parentEnd) return null;
    size = view.getUint32(start + 8) * 2 ** 32 + view.getUint32(start + 12);
    headerSize = EXTENDED_BOX_HEADER_BYTES;
  } else if (size32 === 0) {
    size = parentEnd - start;
  }

  if (!Number.isSafeInteger(size) || size < headerSize) return null;

  const end = start + size;
  if (end > parentEnd || end > view.byteLength) return null;

  return {
    type,
    payloadStart: start + headerSize,
    payloadEnd: end,
    end,
  };
}

function parseWebmDimensions(bytes: Uint8Array): VideoDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks = findEbmlElement(view, 0, bytes.byteLength, 0x1654ae6b);
  if (!tracks) return null;

  const trackEntry = findEbmlElement(view, tracks.start, tracks.end, 0xae);
  if (!trackEntry) return null;

  const video = findEbmlElement(view, trackEntry.start, trackEntry.end, 0xe0);
  if (!video) return null;

  const pixelWidth = readEbmlIntegerElement(view, video.start, video.end, 0xb0);
  const pixelHeight = readEbmlIntegerElement(view, video.start, video.end, 0xba);
  if (!pixelWidth || !pixelHeight) return null;

  /*
   * Matroska/WebM can declare display dimensions separately from encoded pixel
   * dimensions. Telegram needs display geometry, otherwise anamorphic media is
   * visibly squeezed even though PixelWidth/PixelHeight are technically valid.
   */
  const displayWidth = readEbmlIntegerElement(view, video.start, video.end, 0x54b0);
  const displayHeight = readEbmlIntegerElement(view, video.start, video.end, 0x54ba);
  const displayUnit = readEbmlIntegerElementAllowZero(view, video.start, video.end, 0x54b2);

  const useDisplayDimensions =
    displayWidth &&
    displayHeight &&
    (displayUnit == null || displayUnit === 0);

  return {
    width: useDisplayDimensions ? displayWidth : pixelWidth,
    height: useDisplayDimensions ? displayHeight : pixelHeight,
    durationSeconds: null,
    rotation: 0,
  };
}

interface EbmlElementRange {
  start: number;
  end: number;
}

function findEbmlElement(
  view: DataView,
  start: number,
  end: number,
  targetId: number,
): EbmlElementRange | null {
  let offset = start;
  while (offset < end) {
    const id = readEbmlId(view, offset, end);
    if (!id) return null;
    offset += id.length;

    const size = readEbmlSize(view, offset, end);
    if (!size) return null;
    offset += size.length;

    const payloadEnd = offset + size.value;
    if (payloadEnd > end) return null;
    if (id.value === targetId) return { start: offset, end: payloadEnd };

    offset = payloadEnd;
  }
  return null;
}

function readEbmlIntegerElement(
  view: DataView,
  start: number,
  end: number,
  targetId: number,
): number | null {
  const element = findEbmlElement(view, start, end, targetId);
  if (!element) return null;

  const length = element.end - element.start;
  if (length < 1 || length > 4) return null;

  let value = 0;
  for (let index = element.start; index < element.end; index += 1) {
    value = value * 256 + view.getUint8(index);
  }
  return isFinitePositiveDimension(value) ? value : null;
}

function readEbmlIntegerElementAllowZero(
  view: DataView,
  start: number,
  end: number,
  targetId: number,
): number | null {
  const element = findEbmlElement(view, start, end, targetId);
  if (!element) return null;

  const length = element.end - element.start;
  if (length < 1 || length > 4) return null;

  let value = 0;
  for (let index = element.start; index < element.end; index += 1) {
    value = value * 256 + view.getUint8(index);
  }

  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readEbmlId(
  view: DataView,
  offset: number,
  end: number,
): { value: number; length: number } | null {
  if (offset >= end) return null;
  const first = view.getUint8(offset);
  let mask = 0x80;
  let length = 1;

  while (length <= EBML_ID_MAX_BYTES && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > EBML_ID_MAX_BYTES || offset + length > end) return null;

  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + view.getUint8(offset + index);
  }
  return { value, length };
}

function readEbmlSize(
  view: DataView,
  offset: number,
  end: number,
): { value: number; length: number } | null {
  if (offset >= end) return null;
  const first = view.getUint8(offset);
  let mask = 0x80;
  let length = 1;

  while (length <= EBML_SIZE_MAX_BYTES && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > EBML_SIZE_MAX_BYTES || offset + length > end) return null;

  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + view.getUint8(offset + index);
  }
  return { value, length };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index));
  }
  return value;
}

function isFinitePositiveDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= RELAY_LIMITS.telegramVideoDimensionMax;
}
