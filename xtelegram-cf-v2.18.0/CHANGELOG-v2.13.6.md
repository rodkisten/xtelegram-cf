# Changelog v2.13.6

## Video aspect-ratio protection

- Added lightweight MP4/MOV container parsing for the real video display
  dimensions.
- Added WebM/Matroska track dimension detection.
- Added MP4 rotation-matrix handling so 90/270-degree sources expose their
  display orientation correctly.
- Worker-owned video uploads now send explicit Telegram `width` and `height`
  metadata instead of relying on Telegram to infer the geometry.
- HLS output is inspected after remuxing; the selected HLS variant resolution is
  used only as a safe fallback when the final container does not expose its
  dimensions directly.
- Album `sendMediaGroup` uploads and ordered `sendVideo` fallbacks preserve the
  same dimensions as single-media delivery.
- Multipart file uploads are inspected before any Telegram side effect.
- Added a fail-safe that refuses to send a video when its real dimensions cannot
  be determined, avoiding arbitrary 16:9 metadata that can squash portrait media.
- Video Worker-upload preference is now provider-agnostic for all video media
  that fit the configured Worker upload budget.

## Tests

- Added Node's built-in test coverage for MP4 dimensions, rotated MP4 display
  dimensions, and malformed media safety.
- `npm run typecheck` passes.
- `npm run test` passes.
