import { fetchPublic } from "../lib/http";
import { HlsAes128Decoder } from "./decoder";
import type {
  HlsByteRange,
  HlsInitMap,
  HlsKey,
  HlsMediaPlaylist,
  HlsPart,
  HlsResolvedSource,
  HlsSegment,
} from "./types";

export interface HlsDownloaderOptions {
  headers?: HeadersInit;
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  maxMediaBytes?: number;
}

export type DownloadContainer = "fmp4" | "mpegts" | "aac" | "unknown";

export interface DownloadedTrack {
  kind: "video" | "audio";
  playlist: HlsMediaPlaylist;
  initSegments: Uint8Array[];
  mediaUnits: Uint8Array[];
  container: DownloadContainer;
  mimeType: string;
  extension: string;
  size: number;
  encrypted: boolean;
  segmentCount: number;
  hasMultipleInitSegments: boolean;
}

export interface HlsDownloadResult {
  resolved: HlsResolvedSource;
  video: DownloadedTrack;
  audio: DownloadedTrack | null;
  liveSnapshot: boolean;
}

interface DownloadUnit {
  uri: string;
  byteRange: HlsByteRange | null;
  map: HlsInitMap | null;
  key: HlsKey | null;
  mediaSequenceNumber: number;
  gap: boolean;
}

export class HlsDownloadError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HlsDownloadError";
  }
}

class MediaBudget {
  private used = 0;

  constructor(readonly maximum: number) {}

  add(byteLength: number): void {
    this.used += byteLength;

    if (this.used > this.maximum) {
      throw new HlsDownloadError(
        `HLS media exceeds the configured in-memory limit of ${this.maximum} bytes`,
        {
          maximum: this.maximum,
          used: this.used,
        },
      );
    }
  }

  get value(): number {
    return this.used;
  }
}

export class HlsDownloader {
  private readonly headers: HeadersInit;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly maxMediaBytes: number;
  private readonly resourceCache = new Map<string, Promise<Uint8Array> | Uint8Array>();
  private readonly decoder = new HlsAes128Decoder();

  constructor(options: HlsDownloaderOptions = {}) {
    this.headers = options.headers || {};
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 350);
    this.maxMediaBytes = Math.max(1_000_000, options.maxMediaBytes ?? 32_000_000);
  }

  async download(
    resolved: HlsResolvedSource,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: {
        completed: number;
        total: number;
        loadedBytes: number;
        ratio: number;
      }) => void;
    } = {},
  ): Promise<HlsDownloadResult> {
    const budget = new MediaBudget(this.maxMediaBytes);
    // Video and audio renditions are independent once the resolver has selected
    // their playlists. Download them concurrently so total HLS latency is close
    // to the slower track instead of the sum of both track download times.
    const [video, audio] = await Promise.all([
      this.downloadPlaylist(
        resolved.mediaPlaylist,
        "video",
        budget,
        options,
      ),
      resolved.audio
        ? this.downloadPlaylist(
            resolved.audio.playlist,
            "audio",
            budget,
            options,
          )
        : Promise.resolve<DownloadedTrack | null>(null),
    ]);

    return {
      resolved,
      video,
      audio,
      liveSnapshot:
        !resolved.mediaPlaylist.endList ||
        Boolean(resolved.audio && !resolved.audio.playlist.endList),
    };
  }

  private async downloadPlaylist(
    playlist: HlsMediaPlaylist,
    kind: "video" | "audio",
    budget: MediaBudget,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: {
        completed: number;
        total: number;
        loadedBytes: number;
        ratio: number;
      }) => void;
    },
  ): Promise<DownloadedTrack> {
    const units = this.buildUnits(playlist);

    if (!units.length) {
      throw new HlsDownloadError("Media playlist contains no downloadable units", {
        url: playlist.url,
      });
    }

    const mapCache = new Map<string, Uint8Array>();
    const initSegments: Uint8Array[] = [];
    const initIdentities: string[] = [];
    let completed = 0;
    let loadedBytes = 0;

    const mediaUnits = await this.mapConcurrent(
      units,
      this.concurrency,
      async (unit) => {
        options.signal?.throwIfAborted?.();

        if (unit.map?.uri) {
          const mapIdentity = this.resourceIdentity(unit.map.uri, unit.map.byteRange);

          if (!mapCache.has(mapIdentity)) {
            const mapBytes = await this.fetchResource(unit.map.uri, {
              byteRange: unit.map.byteRange,
              signal: options.signal,
              cache: true,
            });
            mapCache.set(mapIdentity, mapBytes);
          }
        }

        let bytes = await this.fetchResource(unit.uri, {
          byteRange: unit.byteRange,
          signal: options.signal,
          cache: false,
        });

        if (unit.key) {
          bytes = await this.decryptUnit(bytes, unit, options.signal);
        }

        budget.add(bytes.byteLength);
        loadedBytes += bytes.byteLength;
        completed += 1;
        options.onProgress?.({
          completed,
          total: units.length,
          loadedBytes,
          ratio: completed / units.length,
        });

        return bytes;
      },
    );

    for (const unit of units) {
      if (!unit.map?.uri) {
        continue;
      }

      const identity = this.resourceIdentity(unit.map.uri, unit.map.byteRange);

      if (initIdentities.at(-1) === identity) {
        continue;
      }

      const bytes = mapCache.get(identity);

      if (bytes) {
        budget.add(bytes.byteLength);
        initSegments.push(bytes);
        initIdentities.push(identity);
      }
    }

    const container = detectContainer(
      initSegments[0] || mediaUnits[0] || new Uint8Array(),
      playlist,
    );
    const mimeType = inferMimeType(container, kind);
    const extension = inferExtension(container, kind);

    return {
      kind,
      playlist,
      initSegments,
      mediaUnits,
      container,
      mimeType,
      extension,
      size:
        mediaUnits.reduce((sum, bytes) => sum + bytes.byteLength, 0) +
        initSegments.reduce((sum, bytes) => sum + bytes.byteLength, 0),
      encrypted: units.some((unit) => Boolean(unit.key)),
      segmentCount: mediaUnits.length,
      hasMultipleInitSegments: initSegments.length > 1,
    };
  }

  private buildUnits(playlist: HlsMediaPlaylist): DownloadUnit[] {
    const segmentUnits = playlist.segments
      .filter((segment) => segment.uri && !segment.gap)
      .map((segment) => this.segmentToUnit(segment));

    if (segmentUnits.length > 0) {
      return segmentUnits;
    }

    return playlist.trailingParts
      .filter((part) => part.uri && !part.gap)
      .map((part, index) => this.partToUnit(
        part,
        playlist.mediaSequence + index,
      ));
  }

  private segmentToUnit(segment: HlsSegment): DownloadUnit {
    return {
      uri: segment.uri,
      byteRange: segment.byteRange,
      map: segment.map,
      key: this.selectDecryptableKey(segment.keys, segment.key),
      mediaSequenceNumber: segment.mediaSequenceNumber,
      gap: segment.gap,
    };
  }

  private partToUnit(part: HlsPart, mediaSequenceNumber: number): DownloadUnit {
    return {
      uri: part.uri,
      byteRange: part.byteRange,
      map: null,
      key: null,
      mediaSequenceNumber,
      gap: part.gap,
    };
  }

  private selectDecryptableKey(keys: HlsKey[], fallback: HlsKey | null): HlsKey | null {
    const candidates = keys.length > 0 ? keys : fallback ? [fallback] : [];

    return (
      candidates.find((key) => !key.keyFormat || key.keyFormat === "identity") ||
      candidates[0] ||
      null
    );
  }

  private async decryptUnit(
    bytes: Uint8Array,
    unit: DownloadUnit,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (!unit.key) {
      return bytes;
    }

    return this.decoder.decode({
      key: unit.key,
      encryptedBytes: bytes,
      mediaSequenceNumber: unit.mediaSequenceNumber,
      loadKey: (uri) => {
        return this.fetchResource(uri, {
          signal,
          cache: true,
        });
      },
    });
  }

  private async fetchResource(
    url: string,
    options: {
      byteRange?: HlsByteRange | null;
      signal?: AbortSignal;
      cache: boolean;
    },
  ): Promise<Uint8Array> {
    const identity = this.resourceIdentity(url, options.byteRange || null);

    if (options.cache && this.resourceCache.has(identity)) {
      return await this.resourceCache.get(identity)!;
    }

    const promise = this.retry(async () => {
      const headers = new Headers(this.headers);
      const byteRange = options.byteRange;

      if (
        byteRange &&
        byteRange.offset != null &&
        Number.isFinite(byteRange.offset) &&
        Number.isFinite(byteRange.length)
      ) {
        headers.set(
          "Range",
          `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`,
        );
      }

      const response = await fetchPublic(url, {
        method: "GET",
        headers,
        signal: options.signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new HlsDownloadError(
          `HTTP ${response.status} while downloading HLS resource`,
          {
            url,
          },
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    }, options.signal);

    if (options.cache) {
      this.resourceCache.set(identity, promise);
    }

    try {
      const bytes = await promise;

      if (options.cache) {
        this.resourceCache.set(identity, bytes);
      }

      return bytes;
    } catch (error) {
      if (options.cache) {
        this.resourceCache.delete(identity);
      }

      throw error;
    }
  }

  private async retry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      signal?.throwIfAborted?.();

      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }

        if (attempt >= this.retries) {
          throw error;
        }

        await sleep(this.retryDelayMs * 2 ** attempt, signal);
      }
    }

    throw lastError;
  }

  private resourceIdentity(url: string, byteRange: HlsByteRange | null): string {
    return byteRange
      ? `${url}#${byteRange.offset ?? ""}:${byteRange.length}`
      : url;
  }

  private async mapConcurrent<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const runner = async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        if (index >= items.length) {
          return;
        }

        results[index] = await worker(items[index]!, index);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runner(),
      ),
    );

    return results;
  }
}

function detectContainer(bytes: Uint8Array, playlist: HlsMediaPlaylist): DownloadContainer {
  if (playlist.segments.some((segment) => Boolean(segment.map?.uri))) {
    return "fmp4";
  }

  if (looksLikeTransportStream(bytes)) {
    return "mpegts";
  }

  const signature = new TextDecoder("latin1").decode(bytes.slice(0, 12));

  if (/ftyp|styp|moof/.test(signature)) {
    return "fmp4";
  }

  if (playlist.segments.some((segment) => /\.aac(?:$|[?#])/i.test(segment.uri))) {
    return "aac";
  }

  return "unknown";
}

function looksLikeTransportStream(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 188 * 3) {
    return false;
  }

  return (
    bytes[0] === 0x47 &&
    bytes[188] === 0x47 &&
    bytes[376] === 0x47
  );
}

function inferMimeType(container: DownloadContainer, kind: "video" | "audio"): string {
  switch (container) {
    case "fmp4":
      return kind === "audio" ? "audio/mp4" : "video/mp4";
    case "mpegts":
      return "video/mp2t";
    case "aac":
      return "audio/aac";
    default:
      return "application/octet-stream";
  }
}

function inferExtension(container: DownloadContainer, kind: "video" | "audio"): string {
  switch (container) {
    case "fmp4":
      return kind === "audio" ? "m4a" : "mp4";
    case "mpegts":
      return "ts";
    case "aac":
      return "aac";
    default:
      return "bin";
  }
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);

    const abort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}
