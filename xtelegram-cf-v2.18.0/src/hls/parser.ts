import { resolvePublicRelativeUrl } from "../lib/http";
import type {
  HlsByteRange,
  HlsInitMap,
  HlsKey,
  HlsMasterPlaylist,
  HlsMediaPlaylist,
  HlsPart,
  HlsPlaylist,
  HlsRendition,
  HlsResolution,
  HlsSegment,
  HlsVariant,
} from "./types";

const VARIABLE_REFERENCE_RE = /\{\$([A-Za-z0-9_-]+)\}/g;

export function parseHlsAttributeList(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let current = "";
  let quoted = false;
  let escaped = false;
  const chunks: string[] = [];

  for (const character of String(input || "")) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }

    if (character === "," && !quoted) {
      chunks.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  if (current) {
    chunks.push(current);
  }

  for (const chunk of chunks) {
    const separator = chunk.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const name = chunk.slice(0, separator).trim().toUpperCase();
    let value = chunk.slice(separator + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    attributes[name] = value;
  }

  return attributes;
}

function substituteVariables(value: string, variables: Map<string, string>): string {
  return String(value).replace(VARIABLE_REFERENCE_RE, (_match, name: string) => {
    return variables.get(name) ?? _match;
  });
}

function parseResolution(value: string | undefined): HlsResolution | null {
  const match = String(value || "").match(/^(\d+)x(\d+)$/i);

  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  return {
    width,
    height,
    label: `${width}x${height}`,
  };
}

function parseByteRange(value: string | undefined): HlsByteRange | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d+)(?:@(\d+))?$/);

  if (!match) {
    return null;
  }

  return {
    length: Number(match[1]),
    offset: match[2] == null ? null : Number(match[2]),
  };
}

function parseIv(value: string | undefined): Uint8Array | null {
  if (!value) {
    return null;
  }

  const hex = value.replace(/^0x/i, "").padStart(32, "0");

  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(16);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

function resolveUri(
  value: string | undefined,
  playlistUrl: string,
  variables: Map<string, string>,
): string | null {
  if (!value) {
    return null;
  }

  return resolvePublicRelativeUrl(substituteVariables(value, variables), playlistUrl);
}

function applyDefine(
  attributes: Record<string, string>,
  variables: Map<string, string>,
  inherited: ReadonlyMap<string, string>,
  playlistUrl: string,
): void {
  const name = attributes.NAME;
  const value = attributes.VALUE;
  const importedName = attributes.IMPORT;
  const queryParam = attributes.QUERYPARAM;

  if (name && value != null) {
    variables.set(name, substituteVariables(value, variables));
    return;
  }

  if (importedName && inherited.has(importedName)) {
    variables.set(importedName, inherited.get(importedName) || "");
    return;
  }

  if (queryParam) {
    const url = new URL(playlistUrl);
    const queryValue = url.searchParams.get(queryParam);

    if (queryValue != null) {
      variables.set(queryParam, queryValue);
    }
  }
}

function selectIdentityKey(keys: Map<string, HlsKey>): HlsKey | null {
  return keys.get("identity") ?? [...keys.values()][0] ?? null;
}

function createKey(
  attributes: Record<string, string>,
  playlistUrl: string,
  variables: Map<string, string>,
): HlsKey {
  return {
    method: String(attributes.METHOD || "NONE").toUpperCase(),
    uri: resolveUri(attributes.URI, playlistUrl, variables),
    iv: parseIv(attributes.IV),
    keyFormat: attributes.KEYFORMAT || null,
    keyFormatVersions: attributes.KEYFORMATVERSIONS || null,
  };
}

function createMap(
  attributes: Record<string, string>,
  playlistUrl: string,
  variables: Map<string, string>,
): HlsInitMap | null {
  const uri = resolveUri(attributes.URI, playlistUrl, variables);

  if (!uri) {
    return null;
  }

  return {
    uri,
    byteRange: parseByteRange(attributes.BYTERANGE),
  };
}

function createPart(
  attributes: Record<string, string>,
  playlistUrl: string,
  variables: Map<string, string>,
): HlsPart | null {
  const uri = resolveUri(attributes.URI, playlistUrl, variables);

  if (!uri) {
    return null;
  }

  return {
    uri,
    duration: Number.isFinite(Number(attributes.DURATION))
      ? Number(attributes.DURATION)
      : null,
    independent: attributes.INDEPENDENT === "YES",
    gap: attributes.GAP === "YES",
    byteRange: parseByteRange(attributes.BYTERANGE),
  };
}

function inferImplicitRange(
  byteRange: HlsByteRange | null,
  uri: string,
  previousSegment: HlsSegment | undefined,
): HlsByteRange | null {
  if (!byteRange || byteRange.offset != null) {
    return byteRange;
  }

  if (
    previousSegment?.uri === uri &&
    previousSegment.byteRange?.offset != null
  ) {
    return {
      length: byteRange.length,
      offset:
        previousSegment.byteRange.offset +
        previousSegment.byteRange.length,
    };
  }

  return byteRange;
}

export function parseHlsPlaylist(
  text: string,
  playlistUrl: string,
  inheritedVariables: ReadonlyMap<string, string> = new Map(),
): HlsPlaylist {
  const rawText = String(text);
  const lines = rawText.split(/\r?\n/).map((line) => line.trim());

  if (!lines.some((line) => line === "#EXTM3U")) {
    throw new Error("Invalid HLS playlist: missing #EXTM3U");
  }

  const variables = new Map(inheritedVariables);
  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  const segments: HlsSegment[] = [];
  const trailingParts: HlsPart[] = [];
  const activeKeys = new Map<string, HlsKey>();
  let version: number | null = null;
  let independentSegments = false;
  let endList = false;
  let mediaSequence = 0;
  let targetDuration: number | null = null;
  let playlistType: string | null = null;
  let currentMap: HlsInitMap | null = null;
  let pendingByteRange: HlsByteRange | null = null;
  let pendingDuration: number | null = null;
  let pendingTitle = "";
  let pendingGap = false;
  let pendingDiscontinuity = false;
  let pendingProgramDateTime: string | null = null;
  let pendingParts: HlsPart[] = [];
  let pendingVariant: Record<string, string> | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line) {
      continue;
    }

    if (!line.startsWith("#")) {
      const uri = resolveUri(line, playlistUrl, variables);

      if (!uri) {
        pendingVariant = null;
        continue;
      }

      if (pendingVariant) {
        const resolution = parseResolution(pendingVariant.RESOLUTION);

        variants.push({
          uri,
          bandwidth: Number(pendingVariant.BANDWIDTH || 0),
          averageBandwidth: Number(pendingVariant["AVERAGE-BANDWIDTH"] || 0),
          score: Number(pendingVariant.SCORE || 0),
          resolution,
          frameRate: Number(pendingVariant["FRAME-RATE"] || 0),
          codecs: pendingVariant.CODECS || "",
          videoRange: pendingVariant["VIDEO-RANGE"] || "",
          audioGroup: pendingVariant.AUDIO || null,
          videoGroup: pendingVariant.VIDEO || null,
          subtitlesGroup: pendingVariant.SUBTITLES || null,
          closedCaptionsGroup: pendingVariant["CLOSED-CAPTIONS"] || null,
        });
        pendingVariant = null;
        continue;
      }

      const previous = segments.at(-1);
      const byteRange = inferImplicitRange(pendingByteRange, uri, previous);
      const segment: HlsSegment = {
        uri,
        duration: pendingDuration,
        title: pendingTitle,
        byteRange,
        map: currentMap,
        key: selectIdentityKey(activeKeys),
        keys: [...activeKeys.values()],
        mediaSequenceNumber: mediaSequence + segments.length,
        gap: pendingGap,
        discontinuity: pendingDiscontinuity,
        programDateTime: pendingProgramDateTime,
        parts: pendingParts,
      };

      segments.push(segment);
      pendingByteRange = null;
      pendingDuration = null;
      pendingTitle = "";
      pendingGap = false;
      pendingDiscontinuity = false;
      pendingProgramDateTime = null;
      pendingParts = [];
      continue;
    }

    const separator = line.indexOf(":");
    const tag = (separator === -1 ? line.slice(1) : line.slice(1, separator)).toUpperCase();
    const value = separator === -1 ? "" : line.slice(separator + 1);

    switch (tag) {
      case "EXT-X-VERSION":
        version = Number(value) || null;
        break;

      case "EXT-X-INDEPENDENT-SEGMENTS":
        independentSegments = true;
        break;

      case "EXT-X-ENDLIST":
        endList = true;
        break;

      case "EXT-X-MEDIA-SEQUENCE":
        mediaSequence = Number(value) || 0;
        break;

      case "EXT-X-TARGETDURATION":
        targetDuration = Number(value) || null;
        break;

      case "EXT-X-PLAYLIST-TYPE":
        playlistType = value || null;
        break;

      case "EXT-X-DEFINE":
        applyDefine(
          parseHlsAttributeList(value),
          variables,
          inheritedVariables,
          playlistUrl,
        );
        break;

      case "EXT-X-STREAM-INF":
        pendingVariant = parseHlsAttributeList(value);
        break;

      case "EXT-X-I-FRAME-STREAM-INF": {
        const attributes = parseHlsAttributeList(value);
        const uri = resolveUri(attributes.URI, playlistUrl, variables);

        if (uri) {
          variants.push({
            uri,
            bandwidth: Number(attributes.BANDWIDTH || 0),
            averageBandwidth: Number(attributes["AVERAGE-BANDWIDTH"] || 0),
            score: Number(attributes.SCORE || 0),
            resolution: parseResolution(attributes.RESOLUTION),
            frameRate: Number(attributes["FRAME-RATE"] || 0),
            codecs: attributes.CODECS || "",
            videoRange: attributes["VIDEO-RANGE"] || "",
            audioGroup: attributes.AUDIO || null,
            videoGroup: attributes.VIDEO || null,
            subtitlesGroup: attributes.SUBTITLES || null,
            closedCaptionsGroup: attributes["CLOSED-CAPTIONS"] || null,
          });
        }
        break;
      }

      case "EXT-X-MEDIA": {
        const attributes = parseHlsAttributeList(value);
        const groupId = attributes["GROUP-ID"] || "";
        const name = attributes.NAME || "";

        if (!groupId || !name) {
          break;
        }

        renditions.push({
          type: String(attributes.TYPE || "").toUpperCase(),
          groupId,
          name,
          uri: resolveUri(attributes.URI, playlistUrl, variables),
          language: attributes.LANGUAGE || null,
          default: attributes.DEFAULT === "YES",
          autoselect: attributes.AUTOSELECT === "YES",
          forced: attributes.FORCED === "YES",
          channels: attributes.CHANNELS || null,
        });
        break;
      }

      case "EXTINF": {
        const comma = value.indexOf(",");
        const durationValue = comma === -1 ? value : value.slice(0, comma);
        pendingDuration = Number.isFinite(Number(durationValue))
          ? Number(durationValue)
          : null;
        pendingTitle = comma === -1 ? "" : value.slice(comma + 1);
        break;
      }

      case "EXT-X-BYTERANGE":
        pendingByteRange = parseByteRange(value);
        break;

      case "EXT-X-DISCONTINUITY":
        pendingDiscontinuity = true;
        break;

      case "EXT-X-PROGRAM-DATE-TIME":
        pendingProgramDateTime = value || null;
        break;

      case "EXT-X-GAP":
        pendingGap = true;
        break;

      case "EXT-X-KEY": {
        const key = createKey(parseHlsAttributeList(value), playlistUrl, variables);
        const identity = key.keyFormat || "identity";

        if (key.method === "NONE") {
          if (identity === "identity") {
            activeKeys.clear();
          } else {
            activeKeys.delete(identity);
          }
        } else {
          activeKeys.set(identity, key);
        }
        break;
      }

      case "EXT-X-MAP":
        currentMap = createMap(parseHlsAttributeList(value), playlistUrl, variables);
        break;

      case "EXT-X-PART": {
        const part = createPart(parseHlsAttributeList(value), playlistUrl, variables);

        if (part) {
          pendingParts.push(part);
        }
        break;
      }

      default:
        break;
    }
  }

  const variablesObject = Object.fromEntries(variables.entries());

  if (variants.length > 0) {
    const master: HlsMasterPlaylist = {
      kind: "master",
      url: playlistUrl,
      rawText,
      version,
      independentSegments,
      endList,
      variables: variablesObject,
      variants,
      renditions,
    };

    return master;
  }

  trailingParts.push(...pendingParts);

  const media: HlsMediaPlaylist = {
    kind: "media",
    url: playlistUrl,
    rawText,
    version,
    independentSegments,
    endList,
    variables: variablesObject,
    mediaSequence,
    targetDuration,
    playlistType,
    segments,
    trailingParts,
  };

  return media;
}

export function compareHlsVariants(left: HlsVariant, right: HlsVariant): number {
  const scoreDifference = right.score - left.score;

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  const rightPixels =
    (right.resolution?.width || 0) *
    (right.resolution?.height || 0);
  const leftPixels =
    (left.resolution?.width || 0) *
    (left.resolution?.height || 0);

  if (rightPixels !== leftPixels) {
    return rightPixels - leftPixels;
  }

  if (right.frameRate !== left.frameRate) {
    return right.frameRate - left.frameRate;
  }

  const rightBandwidth = right.averageBandwidth || right.bandwidth;
  const leftBandwidth = left.averageBandwidth || left.bandwidth;

  return rightBandwidth - leftBandwidth;
}
