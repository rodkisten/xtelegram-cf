declare module "mux.js" {
  export interface TransmuxerData {
    type?: "combined" | "audio" | "video" | string;
    data: Uint8Array;
    initSegment: Uint8Array;
    captions?: unknown[];
    captionStreams?: Record<string, unknown>;
    metadata?: unknown[];
  }

  export interface TransmuxerOptions {
    baseMediaDecodeTime?: number;
    keepOriginalTimestamps?: boolean;
    remux?: boolean;
  }

  export class Transmuxer {
    constructor(options?: TransmuxerOptions);
    on(event: "data", listener: (segment: TransmuxerData) => void): void;
    on(event: "done", listener: () => void): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    push(data: Uint8Array): void;
    flush(): void;
    reset?(): void;
    dispose?(): void;
  }

  const muxjs: {
    mp4: {
      Transmuxer: typeof Transmuxer;
    };
  };

  export default muxjs;
}
