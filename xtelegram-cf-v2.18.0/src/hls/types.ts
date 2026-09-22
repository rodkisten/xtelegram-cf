export interface HlsResolution {
  width: number;
  height: number;
  label: string;
}

export interface HlsByteRange {
  length: number;
  offset: number | null;
}

export interface HlsKey {
  method: string;
  uri: string | null;
  iv: Uint8Array | null;
  keyFormat: string | null;
  keyFormatVersions: string | null;
}

export interface HlsInitMap {
  uri: string;
  byteRange: HlsByteRange | null;
}

export interface HlsPart {
  uri: string;
  duration: number | null;
  independent: boolean;
  gap: boolean;
  byteRange: HlsByteRange | null;
}

export interface HlsSegment {
  uri: string;
  duration: number | null;
  title: string;
  byteRange: HlsByteRange | null;
  map: HlsInitMap | null;
  key: HlsKey | null;
  keys: HlsKey[];
  mediaSequenceNumber: number;
  gap: boolean;
  discontinuity: boolean;
  programDateTime: string | null;
  parts: HlsPart[];
}

export interface HlsVariant {
  uri: string;
  bandwidth: number;
  averageBandwidth: number;
  score: number;
  resolution: HlsResolution | null;
  frameRate: number;
  codecs: string;
  videoRange: string;
  audioGroup: string | null;
  videoGroup: string | null;
  subtitlesGroup: string | null;
  closedCaptionsGroup: string | null;
}

export interface HlsRendition {
  type: string;
  groupId: string;
  name: string;
  uri: string | null;
  language: string | null;
  default: boolean;
  autoselect: boolean;
  forced: boolean;
  channels: string | null;
}

export interface HlsPlaylistBase {
  url: string;
  rawText: string;
  version: number | null;
  independentSegments: boolean;
  endList: boolean;
  variables: Record<string, string>;
}

export interface HlsMasterPlaylist extends HlsPlaylistBase {
  kind: "master";
  variants: HlsVariant[];
  renditions: HlsRendition[];
}

export interface HlsMediaPlaylist extends HlsPlaylistBase {
  kind: "media";
  mediaSequence: number;
  targetDuration: number | null;
  playlistType: string | null;
  segments: HlsSegment[];
  trailingParts: HlsPart[];
}

export type HlsPlaylist = HlsMasterPlaylist | HlsMediaPlaylist;

export interface HlsResolvedRendition {
  rendition: HlsRendition;
  playlist: HlsMediaPlaylist;
}

export interface HlsResolvedSource {
  root: HlsPlaylist;
  chain: HlsPlaylist[];
  selectedVariant: HlsVariant | null;
  mediaPlaylist: HlsMediaPlaylist;
  audio: HlsResolvedRendition | null;
}

export interface HlsFetchOptions {
  headers?: HeadersInit;
  signal?: AbortSignal;
}
