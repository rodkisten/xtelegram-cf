import muxjs from "mux.js";
import type { DownloadedTrack, HlsDownloadResult } from "./downloader";

export interface RemuxedMedia {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  mediaType: "video" | "audio" | "document";
  remuxed: boolean;
}

export class HlsRemuxError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HlsRemuxError";
  }
}

export class HlsRemuxer {
  remux(download: HlsDownloadResult, baseName = "media"): RemuxedMedia {
    const { video, audio } = download;

    if (audio) {
      return this.remuxSeparateTracks(video, audio, baseName);
    }

    return this.finalizeSingleTrack(video, baseName);
  }

  private finalizeSingleTrack(track: DownloadedTrack, baseName: string): RemuxedMedia {
    if (track.container === "fmp4") {
      if (track.hasMultipleInitSegments) {
        throw new HlsRemuxError(
          "The HLS stream changes its fMP4 initialization segment and cannot be flattened safely by the lightweight Worker remuxer",
        );
      }

      return {
        bytes: concatUint8Arrays([
          ...track.initSegments,
          ...track.mediaUnits,
        ]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: track.kind === "audio" ? "audio" : "video",
        remuxed: false,
      };
    }

    if (track.container === "mpegts") {
      return {
        bytes: this.transmuxTransportStreams([track.mediaUnits]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: "video",
        remuxed: true,
      };
    }

    if (track.container === "aac" && track.kind === "audio") {
      return {
        bytes: concatUint8Arrays(track.mediaUnits),
        filename: `${sanitizeFilename(baseName)}.aac`,
        contentType: "audio/aac",
        mediaType: "document",
        remuxed: false,
      };
    }

    return {
      bytes: concatUint8Arrays([
        ...track.initSegments,
        ...track.mediaUnits,
      ]),
      filename: `${sanitizeFilename(baseName)}.${track.extension}`,
      contentType: track.mimeType,
      mediaType: "document",
      remuxed: false,
    };
  }

  private remuxSeparateTracks(
    video: DownloadedTrack,
    audio: DownloadedTrack,
    baseName: string,
  ): RemuxedMedia {
    if (
      video.container === "mpegts" &&
      audio.container === "mpegts"
    ) {
      return {
        bytes: this.transmuxTransportStreams([
          video.mediaUnits,
          audio.mediaUnits,
        ]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: "video",
        remuxed: true,
      };
    }

    throw new HlsRemuxError(
      "The selected HLS variant uses separate audio/video tracks that are not both MPEG-TS. This Worker can transmux muxed TS and paired TS renditions, but does not rewrite independent fMP4 moov track tables.",
      {
        videoContainer: video.container,
        audioContainer: audio.container,
      },
    );
  }

  private transmuxTransportStreams(trackUnits: Uint8Array[][]): Uint8Array {
    const transmuxer = new muxjs.mp4.Transmuxer({
      remux: true,
      keepOriginalTimestamps: false,
    });
    const initSegments: Uint8Array[] = [];
    const mediaSegments: Uint8Array[] = [];
    const types = new Set<string>();

    transmuxer.on("data", (segment) => {
      if (segment.type) {
        types.add(segment.type);
      }

      if (segment.initSegment?.byteLength) {
        initSegments.push(segment.initSegment);
      }

      if (segment.data?.byteLength) {
        mediaSegments.push(segment.data);
      }
    });

    const maximumUnits = Math.max(...trackUnits.map((units) => units.length));

    for (let index = 0; index < maximumUnits; index += 1) {
      for (const units of trackUnits) {
        const unit = units[index];

        if (unit) {
          transmuxer.push(unit);
        }
      }
    }

    transmuxer.flush();
    transmuxer.dispose?.();

    if (!mediaSegments.length) {
      throw new HlsRemuxError("mux.js produced no fMP4 media segments");
    }

    const firstInit = initSegments[0];

    if (!firstInit) {
      throw new HlsRemuxError("mux.js produced no fMP4 initialization segment");
    }

    return concatUint8Arrays([
      firstInit,
      ...mediaSegments,
    ]);
  }
}

export function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function sanitizeFilename(value: string): string {
  return (
    String(value || "media")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "media"
  );
}
