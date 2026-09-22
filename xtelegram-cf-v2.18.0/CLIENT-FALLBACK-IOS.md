# iOS / a-Shell client fallback

When `/send` or `/resolve-and-send` cannot safely finish a video inside Cloudflare, the relay returns `clientFallback` instead of forcing the large media through the Worker.

The normal client flow is:

```text
social URL
  -> Relay resolves media + quality ladder
  -> normal Telegram send if safe
  -> controlled clientFallback when necessary
  -> a-Shell downloads/remuxes/compresses directly from the resolved CDN URL
  -> iOS Shortcut uploads the resulting file directly to Telegram Bot API
  -> Scriptable POSTs the successful Telegram result to /media/register
  -> D1 history/dedupe is reconciled
```

## Relevant environment variable

```toml
CLIENT_COMPRESS_TARGET_BYTES = "47000000"
```

This is deliberately below the hosted Bot API multipart limit so hardware encoder/container overhead has room.

## Example fallback response

```json
{
  "ok": false,
  "limitExceeded": true,
  "clientFallback": {
    "available": true,
    "action": "download_prepare_and_upload",
    "url": "https://cdn.example/video.mp4",
    "downloadHeaders": {
      "Referer": "https://example.com/"
    },
    "targetBytes": 47000000,
    "registerEndpoint": "/media/register",
    "variants": [
      {
        "mediaUrl": "https://cdn.example/1080.mp4",
        "quality": "1080p",
        "contentLength": 81000000,
        "width": 1920,
        "height": 1080
      },
      {
        "mediaUrl": "https://cdn.example/720.mp4",
        "quality": "720p",
        "contentLength": 53000000,
        "width": 1280,
        "height": 720
      }
    ],
    "context": {
      "provider": "twitter",
      "mediaKey": "twitter:123",
      "sourceUrl": "https://x.com/user/status/123",
      "caption": "...",
      "channels": ["-100123:65"]
    }
  }
}
```

## POST /media/register

This endpoint is protected by the normal Relay bearer token. It receives the Telegram message that was already uploaded directly by the iPhone and writes it into the same `media` + `media_deliveries` tables used by `/send`.

```json
{
  "provider": "twitter",
  "mediaKey": "twitter:123",
  "sourceUrl": "https://x.com/user/status/123",
  "resolvedMediaUrl": "https://cdn.example/720.mp4",
  "mediaType": "video",
  "caption": "...",
  "channel": "-100123:65",
  "telegramChatId": "-100123",
  "messageThreadId": 65,
  "messageId": 999,
  "telegramFileId": "BAAC...",
  "telegramFileUniqueId": "AgAD...",
  "mediaByteLength": 46500000,
  "mediaWidth": 1280,
  "mediaHeight": 720,
  "compression": {
    "targetBytes": 47000000,
    "outputBytes": 46500000,
    "encoder": "h264_videotoolbox"
  }
}
```

Calling registration again with the same media/channel/message id returns success without incrementing delivery history again.
