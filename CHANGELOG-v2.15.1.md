# v2.15.1

## CPU safety

- Large Worker-owned media no longer pays for an exact SHA-256 pass. Exact hashing is kept for files up to 8 MiB; larger files retain the fixed-budget v2 robustness fingerprint and the normal provider/media identity.
- Streamed direct downloads no longer copy each network chunk once before copying into the final Telegram upload buffer.
- MPEG-TS HLS is guarded before `mux.js`: inputs above 12 MiB or 72 total audio/video segments return a controlled `hls_cpu_budget` fallback instead of risking an `exceededCpu` isolate termination.
- fMP4 HLS is not blocked by the CPU guard because the relay only concatenates its initialization/media fragments and does not transmux the full stream.
- Quality-size probing concurrency was reduced from 4 to 2 and HLS download concurrency from 4 to 3 to smooth bursts and memory/CPU pressure without changing the quality ladder.
- The quality ladder, Telegram size ceilings, captions, width/height invariants, D1 logical dedupe and bounded near-duplicate fingerprint remain enabled.

## Cloudflare note

Cloudflare cannot catch an isolate termination after the CPU limit is exceeded, so the expensive pure-JS HLS path is now rejected proactively while a resolved media URL is still available for the existing client fallback.
