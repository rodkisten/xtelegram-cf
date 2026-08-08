# Generic Telegram Media Relay v2.2

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
npm install
npm run typecheck
```

## Secrets

Required:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put RELAY_TOKEN
```

Optional default destination:

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

`TELEGRAM_CHAT_ID` is now only a fallback. When the request contains `channel` or `channels`, those request values take priority.

## Optional Worker variables

`MAX_MEDIA_BYTES`

Default: `32000000`.

Controls the maximum amount of media buffered for a single relay request. The code hard-caps this value at `49000000`.

`HLS_CONCURRENCY`

Default: `4`.

Controls simultaneous HLS resource downloads. Values are clamped between 1 and 8.

## Deploy

```bash
npm run deploy
```

## Fixing an out-of-sync npm lock file

Cloudflare uses `npm ci` when a `package-lock.json` is committed. `npm ci` intentionally fails when `package.json` contains dependencies that are missing from the lock file.

If the repository still contains the old lock file from before `mux.js` was added, regenerate and commit it once:

```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
git add package.json package-lock.json
git commit -m "chore: sync npm lockfile"
```

After that, Cloudflare can run `npm ci` normally. Do not keep the stale lock file.

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
  "channel": "-1001234567890",
  "mediaHeaders": {
    "Referer": "https://example.com/"
  },
  "metadata": {
    "provider": "generic"
  }
}
```


### Dynamic Telegram destinations

The Worker accepts the same fields already produced by the userscript.

Send to one channel:

```json
{
  "mediaUrl": "https://example.com/video.mp4",
  "channel": "-1001234567890"
}
```

Send to multiple channels:

```json
{
  "mediaUrl": "https://example.com/master.m3u8",
  "channels": [
    "-1001234567890",
    "-1009876543210",
    "@my_public_channel"
  ]
}
```

When both `channel` and `channels` are present, the Worker merges and de-duplicates them. When neither is present, it falls back to `TELEGRAM_CHAT_ID`. The media is resolved/downloaded/remuxed once, then delivered to each requested destination sequentially.


## Photo and carousel support

The same `/send` endpoint now accepts photos as first-class Telegram media. Set `mediaType` to `photo` and send `mediaUrl` or `photoUrl`. The Worker routes the request through Telegram `sendPhoto`, including multipart uploads when the caller already has the image bytes.

Single photo:

```json
{
  "mediaUrl": "https://pbs.twimg.com/media/example.jpg?format=jpg&name=orig",
  "photoUrl": "https://pbs.twimg.com/media/example.jpg?format=jpg&name=orig",
  "mediaType": "photo",
  "title": "@author",
  "text": "Full tweet text",
  "pageUrl": "https://x.com/author/status/123",
  "caption": "<b>@author</b>\n\nFull tweet text\n\n<a href=\"https://x.com/author/status/123\">x.com</a>",
  "parseMode": "HTML",
  "channels": ["-1001234567890"]
}
```

Photo/video carousel or album:

```json
{
  "mediaItems": [
    { "mediaUrl": "https://example.com/1.jpg", "mediaType": "photo" },
    { "mediaUrl": "https://example.com/2.jpg", "mediaType": "photo" },
    { "mediaUrl": "https://example.com/3.mp4", "mediaType": "video" }
  ],
  "provider": "instagram",
  "title": "Instagram",
  "text": "Full Instagram post/caption text",
  "pageUrl": "https://www.instagram.com/p/example/",
  "caption": "<b>Instagram</b>\n\nFull Instagram post/caption text\n\n<a href=\"https://www.instagram.com/p/example/\">instagram.com</a>",
  "parseMode": "HTML",
  "channels": ["-1001234567890"]
}
```

Album requests accept 2-100 direct HTTP(S) photo/video items. The Worker splits them into Telegram `sendMediaGroup` batches of at most 10 items and places the post caption on the first item of the first batch. HLS/DASH items remain on the single-media path so they can be prepared/remuxed first.

For compatibility with the All-in-One Video Downloader userscript, the old item-by-item payload still works. The Worker also accepts `photoUrl` as an alias for `mediaUrl`. If `caption` is omitted, the Worker builds a plain-text caption from `title`, `text`, and `pageUrl`.

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


## Multipart file forwarding

`POST /send` also accepts `multipart/form-data`. This is the preferred mode when the caller already has the final MP4 bytes, such as the All-in-One Video Downloader userscript.

The Worker accepts:

- `payload`: JSON string with the same metadata used by the JSON API.
- `file`: one or more media files, including photos. The field may be repeated.
- `files`: optional repeated file field. Any non-empty multipart `File` field is accepted.
- `audioFile`: optional separate audio track. It is forwarded with `sendAudio`.
- Image uploads (`image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif`) are forwarded with `sendPhoto`.

A single MP4:

```js
const form = new FormData();
form.append("payload", JSON.stringify({
  channels: ["-1001234567890"],
  caption: "<b>Example</b>",
  parseMode: "HTML",
  mediaType: "video",
  sourceUrl: "https://example.com/post/123",
}));
form.append("file", videoBlob, "video.mp4");

await fetch("https://your-worker.example/send", {
  method: "POST",
  headers: {
    Authorization: "Bearer <RELAY_TOKEN>",
  },
  body: form,
});
```

Multiple MP4 files:

```js
const form = new FormData();
form.append("payload", JSON.stringify({
  channels: ["-1001234567890", "-1009876543210"],
  caption: "Multiple videos",
  mediaType: "video",
}));

for (const file of videoFiles) {
  form.append("file", file, file.name);
}

await fetch("https://your-worker.example/send", {
  method: "POST",
  headers: {
    Authorization: "Bearer <RELAY_TOKEN>",
  },
  body: form,
});
```

The files are forwarded sequentially to each requested Telegram destination. This avoids duplicating several large multipart bodies in Worker memory at once.

The userscript payload is accepted directly:

```text
payload = JSON string
file = prepared video Blob
 audioFile = optional prepared audio Blob
```

When a `file` is already present, the Worker does not fetch `mediaUrl` again. It forwards the uploaded bytes directly to Telegram. `mediaUrl`, `videoUrl`, `sourceUrl`, `pageUrl`, `frameUrl`, `title`, `text`, and `metadata` remain available as descriptive payload metadata.

### Verbose error responses

Errors now identify the failing stage, such as:

- `authorization`
- `parse-multipart`
- `parse-payload`
- `validate-channels`
- `validate-payload`
- `validate-files`
- `prepare-media`
- `telegram`
- `telegram-forward`

Multipart responses include a per-file and per-channel delivery list with the Telegram method, HTTP status, Telegram error code, description, response parameters, and raw response body when available.

A multi-file request can return HTTP `207` when only part of the delivery matrix succeeds. A complete Telegram failure returns `502`.

## Efficient large-media architecture

This Worker is optimized to keep memory usage predictable inside the Cloudflare Workers runtime.

### Recommended client behavior

For local files, especially from an iOS Shortcut or Safari Downloads automation, send exactly one file per `POST /send` request and wait for the response before sending the next file.

```text
file-1.mp4 -> POST /send -> wait for response
file-2.mp4 -> POST /send -> wait for response
file-3.mp4 -> POST /send -> wait for response
```

Avoid sending many large files concurrently. Cloudflare Workers isolates share a 128 MB memory ceiling, so sequential delivery is substantially safer than concurrent buffering.

### Multipart forwarding

Uploaded `File` objects are forwarded directly to Telegram through `FormData`. The Worker no longer converts each incoming file through `arrayBuffer() -> Uint8Array -> Blob`, avoiding a full extra in-memory copy of every uploaded file.

Multiple repeated `file` fields remain supported for convenience, but the Worker enforces a combined multipart forwarding budget. For large batches, one file per request is strongly recommended.

Optional environment variables:

- `MAX_MEDIA_BYTES`: maximum size of one uploaded/direct-buffered file. Hard-capped by the Worker implementation.
- `MULTIPART_MAX_TOTAL_BYTES`: maximum combined size of files accepted in one multipart request. Defaults to a conservative budget derived from `MAX_MEDIA_BYTES`.
- `HLS_MAX_MEDIA_BYTES`: separate and intentionally smaller in-memory budget for HLS download/remux. Default: 16 MB. Hard cap: 24 MB.
- `HLS_CONCURRENCY`: HLS segment download concurrency. Default: 2. Maximum: 4.

### HLS

HLS remuxing still requires in-memory segment and mux buffers because `mux.js` produces an in-memory MP4 result. For this reason HLS has a separate, smaller memory budget and lower default concurrency. Large HLS assets should be muxed on the client/device or by a dedicated media-processing service rather than inside this Worker.

### Processing strategy

```text
Direct public URL small enough for Telegram remote fetch
  -> Worker sends URL to Telegram

Direct public URL that must be uploaded
  -> Worker downloads within the configured bounded buffer
  -> Worker uploads to Telegram

Local MP4/File
  -> multipart POST
  -> File forwarded directly without arrayBuffer duplication

HLS
  -> resolve playlist
  -> bounded segment download
  -> bounded in-memory remux
  -> upload to Telegram
```

The Worker intentionally prefers predictable memory use over accepting arbitrarily large HLS mux jobs.
