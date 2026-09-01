# CPU safety in v2.15.1

The relay now avoids the two CPU-heavy operations that scale with large media: full-file cryptographic hashing and pure-JavaScript MPEG-TS transmuxing.

## Direct media

- Exact SHA-256 is computed only up to 8 MiB.
- Larger files keep the bounded v2 near-duplicate fingerprint (maximum 8,192 sampled bytes) and the normal provider/media identity.
- Stream chunks are retained directly and copied only once into the final contiguous Telegram upload buffer.

## HLS

- fMP4 remains supported at the normal size limit because it only requires fragment concatenation.
- MPEG-TS transmux is allowed up to 12 MiB and 72 total audio/video segments.
- Larger MPEG-TS workloads return the controlled `hls_cpu_budget` fallback before `mux.js` can exhaust the isolate CPU budget.
- Obvious `.ts` playlists above the segment budget are rejected before downloading all segments.

## Concurrency

- Quality probes: 2.
- HLS per-track concurrency: 3. Video + audio can therefore use at most six concurrent media fetches in that phase.

## Cloudflare CPU limit

On Workers Paid, Cloudflare currently allows configuring `limits.cpu_ms` up to 300,000 ms. This release deliberately does not force a paid-only CPU limit in `wrangler.toml`; the code is optimized first. If the account is Paid and legitimate requests still need more than the default 30 seconds, add:

```toml
[limits]
cpu_ms = 120_000
```

Do this only after reviewing invocation CPU metrics because a higher limit can also increase CPU billing.
