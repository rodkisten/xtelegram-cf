# Generic Telegram Media Relay v2

Cloudflare Worker written in TypeScript with a native HLS pipeline.

## What changed

The old Worker only resolved an HLS master playlist to the best media playlist and returned HTTP 422 when the result still contained segments.

The new pipeline is:

1. Validate and probe the public media URL.
2. Resolve HLS master/media playlists recursively.
3. Select the best remux-friendly variant.
4. Resolve alternate audio renditions when present.
5. Download media segments with bounded concurrency.
6. Respect `EXT-X-BYTERANGE` and `EXT-X-MAP`.
7. Decode standard HLS `AES-128` with Web Crypto when `KEYFORMAT` is `identity`.
8. Assemble existing fMP4/CMAF streams.
9. Transmux MPEG-TS to fragmented MP4 with `mux.js` using `remux: true`.
10. Upload the resulting media to Telegram with `multipart/form-data`.

Direct files small enough for Telegram's remote URL fetch path are still sent by URL to avoid unnecessary buffering.

## Files

- `src/index.ts`: Worker routes, authentication, request validation, and response formatting.
- `src/media.ts`: direct-file versus HLS preparation pipeline.
- `src/hls/parser.ts`: typed M3U8 parser.
- `src/hls/resolver.ts`: recursive HLS resolver and variant/rendition selection.
- `src/hls/decoder.ts`: AES-128 HLS decoder using Web Crypto.
- `src/hls/downloader.ts`: range-aware concurrent segment downloader.
- `src/hls/remuxer.ts`: fMP4 assembly and MPEG-TS to fMP4 transmux/remux.
- `src/telegram.ts`: Telegram URL and multipart upload transports.
- `src/lib/http.ts`: public URL validation, redirect validation, and HTTP helpers.

## Install

```bash
pnpm install
pnpm typecheck
```

## Secrets

```bash
pnpm wrangler secret put TELEGRAM_BOT_TOKEN
pnpm wrangler secret put TELEGRAM_CHAT_ID
pnpm wrangler secret put RELAY_TOKEN
```

## Optional Worker variables

`MAX_MEDIA_BYTES`

Default: `32000000`.

Controls the maximum amount of media buffered for a single relay request. The code hard-caps this value at `49000000`.

`HLS_CONCURRENCY`

Default: `4`.

Controls simultaneous HLS resource downloads. Values are clamped between 1 and 8.

## Deploy

```bash
pnpm deploy
```

## API

The existing API remains compatible:

```http
POST /send
Authorization: Bearer <RELAY_TOKEN>
Content-Type: application/json
```

Example:

```json
{
  "mediaUrl": "https://example.com/master.m3u8",
  "sourceUrl": "https://example.com/post/123",
  "caption": "Example",
  "parseMode": "HTML",
  "mediaType": "video",
  "mediaHeaders": {
    "Referer": "https://example.com/"
  },
  "metadata": {
    "provider": "generic"
  }
}
```

## Supported HLS behavior

- Nested master playlists.
- `EXT-X-STREAM-INF`.
- `AVERAGE-BANDWIDTH`, `BANDWIDTH`, `RESOLUTION`, `FRAME-RATE`, `SCORE`, and codec metadata.
- `EXT-X-MEDIA` alternate audio renditions.
- `EXT-X-DEFINE` variables with `NAME`/`VALUE`, `IMPORT`, and `QUERYPARAM`.
- `EXTINF`.
- `EXT-X-MEDIA-SEQUENCE`.
- `EXT-X-BYTERANGE`, including implicit offsets for consecutive full segments using the same URI.
- `EXT-X-KEY` with `METHOD=AES-128` and identity key format.
- Default AES-128 IV derivation from the media sequence number.
- `EXT-X-MAP` init segments.
- `EXT-X-GAP`.
- `EXT-X-DISCONTINUITY` metadata.
- `EXT-X-PROGRAM-DATE-TIME` metadata.
- `EXT-X-PART` parsing and trailing-part fallback for LL-HLS snapshots.
- Live playlists are treated as snapshots of the currently listed media.

## Remux behavior

### MPEG-TS

MPEG-TS media is fed through `mux.js`'s MP4 transmuxer with remuxing enabled, producing fragmented MP4 suitable for the Telegram video upload path.

### Existing fMP4/CMAF

For a single multiplexed track, the Worker keeps the initialization segment followed by the media fragments.

### Separate audio/video renditions

The lightweight Worker remuxer supports separate renditions when both tracks are MPEG-TS and `mux.js` can combine them. Independent fMP4 audio/video renditions require track-table/sample-level MP4 muxing and are rejected with an explicit error instead of generating a corrupt MP4.

## Encryption limits

Supported:

- `METHOD=AES-128`
- `KEYFORMAT=identity` or omitted

Not treated as generic decryptable HLS:

- `SAMPLE-AES`
- FairPlay
- Widevine
- PlayReady
- DRM-specific key formats

## Memory note

This implementation intentionally uses a conservative default media budget because HLS assembly and transmuxing can temporarily hold input and output buffers at the same time. For large videos, a storage-backed architecture using R2 plus a dedicated media processing service is safer than raising the in-memory limit aggressively.
