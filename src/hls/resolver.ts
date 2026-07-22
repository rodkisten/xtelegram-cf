import { fetchPublic, getBaseContentType, normalizePublicHttpUrl } from "../lib/http";
import { compareHlsVariants, parseHlsPlaylist } from "./parser";
import type {
  HlsFetchOptions,
  HlsMasterPlaylist,
  HlsMediaPlaylist,
  HlsPlaylist,
  HlsRendition,
  HlsResolvedRendition,
  HlsResolvedSource,
  HlsVariant,
} from "./types";

const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

export interface HlsResolverOptions {
  maxDepth?: number;
  maxPlaylistBytes?: number;
  headers?: HeadersInit;
  preferredAudioLanguage?: string | null;
  preferSelfContained?: boolean;
}

export interface ProbeResult {
  url: string;
  contentType: string;
  contentLength: number | null;
  isPlaylist: boolean;
}

export class HlsResolver {
  readonly maxDepth: number;
  readonly maxPlaylistBytes: number;
  readonly headers: HeadersInit;
  readonly preferredAudioLanguage: string | null;
  readonly preferSelfContained: boolean;

  constructor(options: HlsResolverOptions = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 8);
    this.maxPlaylistBytes = Math.max(1024, options.maxPlaylistBytes ?? 2 * 1024 * 1024);
    this.headers = options.headers || {};
    this.preferredAudioLanguage = options.preferredAudioLanguage || null;
    this.preferSelfContained = options.preferSelfContained ?? true;
  }

  async probe(url: string | URL, options: HlsFetchOptions = {}): Promise<ProbeResult> {
    const normalized = normalizePublicHttpUrl(url instanceof URL ? url.href : String(url));

    if (!normalized) {
      throw new Error("Resolved media URL is not allowed");
    }

    try {
      const response = await fetchPublic(normalized, {
        method: "HEAD",
        headers: this.mergeHeaders(options.headers),
        signal: options.signal,
      });
      const contentType = getBaseContentType(response.headers.get("content-type"));
      const contentLengthHeader = Number(response.headers.get("content-length"));
      const finalUrl = response.url || normalized.href;

      return {
        url: finalUrl,
        contentType,
        contentLength: Number.isFinite(contentLengthHeader) && contentLengthHeader >= 0
          ? contentLengthHeader
          : null,
        isPlaylist: HLS_CONTENT_TYPES.has(contentType) || looksLikeHlsUrl(finalUrl),
      };
    } catch {
      return {
        url: normalized.href,
        contentType: "",
        contentLength: null,
        isPlaylist: looksLikeHlsUrl(normalized.href),
      };
    }
  }

  async resolve(url: string | URL, options: HlsFetchOptions = {}): Promise<HlsResolvedSource> {
    const visited = new Set<string>();
    const chain: HlsPlaylist[] = [];
    const root = await this.resolvePlaylist(
      url instanceof URL ? url.href : String(url),
      0,
      visited,
      chain,
      new Map(),
      options,
    );

    if (root.playlist.kind !== "media") {
      throw new Error("HLS resolver did not reach a media playlist");
    }

    const audio = root.selectedVariant
      ? await this.resolveAudioRendition(
          root.masterPlaylist,
          root.selectedVariant,
          root.variables,
          options,
        )
      : null;

    return {
      root: chain[0] || root.playlist,
      chain,
      selectedVariant: root.selectedVariant,
      mediaPlaylist: root.playlist,
      audio,
    };
  }

  private async resolvePlaylist(
    url: string,
    depth: number,
    visited: Set<string>,
    chain: HlsPlaylist[],
    inheritedVariables: ReadonlyMap<string, string>,
    options: HlsFetchOptions,
  ): Promise<{
    playlist: HlsMediaPlaylist;
    selectedVariant: HlsVariant | null;
    masterPlaylist: HlsMasterPlaylist | null;
    variables: ReadonlyMap<string, string>;
  }> {
    if (depth > this.maxDepth) {
      throw new Error("Too many nested HLS playlists");
    }

    const normalized = normalizePublicHttpUrl(url);

    if (!normalized) {
      throw new Error("HLS playlist URL is not allowed");
    }

    if (visited.has(normalized.href)) {
      throw new Error("Circular HLS playlist reference detected");
    }

    visited.add(normalized.href);

    const fetched = await this.fetchPlaylist(normalized.href, options);
    const parsed = parseHlsPlaylist(
      fetched.text,
      fetched.url,
      inheritedVariables,
    );

    chain.push(parsed);
    const variables = new Map(Object.entries(parsed.variables));

    if (parsed.kind === "media") {
      return {
        playlist: parsed,
        selectedVariant: null,
        masterPlaylist: null,
        variables,
      };
    }

    const variants = this.orderVariants(parsed.variants);
    let lastError: unknown = null;

    for (const variant of variants) {
      const candidateChain = [...chain];

      try {
        const nested = await this.resolvePlaylist(
          variant.uri,
          depth + 1,
          new Set(visited),
          candidateChain,
          variables,
          options,
        );

        chain.splice(0, chain.length, ...candidateChain);

        return {
          ...nested,
          selectedVariant: variant,
          masterPlaylist: parsed,
          variables,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("No usable HLS variant was found");
  }

  private async resolveAudioRendition(
    master: HlsMasterPlaylist | null,
    variant: HlsVariant,
    inheritedVariables: ReadonlyMap<string, string>,
    options: HlsFetchOptions,
  ): Promise<HlsResolvedRendition | null> {
    if (!master || !variant.audioGroup) {
      return null;
    }

    const candidates = master.renditions
      .filter((rendition) => {
        return (
          rendition.type === "AUDIO" &&
          rendition.groupId === variant.audioGroup &&
          Boolean(rendition.uri)
        );
      })
      .sort((left, right) => this.compareRenditions(left, right));

    const selected = candidates[0];

    if (!selected?.uri) {
      return null;
    }

    const chain: HlsPlaylist[] = [];
    const resolved = await this.resolvePlaylist(
      selected.uri,
      0,
      new Set(),
      chain,
      inheritedVariables,
      options,
    );

    return {
      rendition: selected,
      playlist: resolved.playlist,
    };
  }

  private orderVariants(variants: HlsVariant[]): HlsVariant[] {
    const sorted = [...variants].sort(compareHlsVariants);

    if (!this.preferSelfContained) {
      return sorted;
    }

    const selfContained = sorted.filter((variant) => !variant.audioGroup);

    return selfContained.length > 0
      ? [...selfContained, ...sorted.filter((variant) => variant.audioGroup)]
      : sorted;
  }

  private compareRenditions(left: HlsRendition, right: HlsRendition): number {
    const preferredLanguage = this.preferredAudioLanguage?.toLowerCase();
    const leftLanguageMatch = preferredLanguage && left.language?.toLowerCase() === preferredLanguage ? 1 : 0;
    const rightLanguageMatch = preferredLanguage && right.language?.toLowerCase() === preferredLanguage ? 1 : 0;

    if (rightLanguageMatch !== leftLanguageMatch) {
      return rightLanguageMatch - leftLanguageMatch;
    }

    if (right.default !== left.default) {
      return Number(right.default) - Number(left.default);
    }

    if (right.autoselect !== left.autoselect) {
      return Number(right.autoselect) - Number(left.autoselect);
    }

    return left.name.localeCompare(right.name);
  }

  private async fetchPlaylist(
    url: string,
    options: HlsFetchOptions,
  ): Promise<{ url: string; text: string }> {
    const headers = new Headers(this.mergeHeaders(options.headers));
    headers.set(
      "Accept",
      "application/vnd.apple.mpegurl, application/x-mpegurl, audio/mpegurl, text/plain;q=0.9, */*;q=0.1",
    );

    const response = await fetchPublic(url, {
      method: "GET",
      headers,
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading HLS playlist`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);

    if (contentLength > this.maxPlaylistBytes) {
      throw new Error("HLS playlist exceeds the relay size limit");
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > this.maxPlaylistBytes) {
      throw new Error("HLS playlist exceeds the relay size limit");
    }

    const text = new TextDecoder().decode(bytes);

    if (!text.trimStart().startsWith("#EXTM3U")) {
      throw new Error("The media URL did not return a valid HLS playlist");
    }

    return {
      url: response.url || url,
      text,
    };
  }

  private mergeHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(this.headers);

    if (extra) {
      new Headers(extra).forEach((value, name) => {
        headers.set(name, value);
      });
    }

    return headers;
  }
}

export function looksLikeHlsUrl(value: string | URL): boolean {
  const url = value instanceof URL ? value.href : String(value);

  return /\.m3u8(?:$|[?#])/i.test(url);
}
