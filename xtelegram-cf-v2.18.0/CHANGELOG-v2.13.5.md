# Changelog v2.13.5

## Performance

- Added an edge-level social metadata cache using Cloudflare Cache API so repeated X/Instagram posts can bypass external metadata requests even after Worker isolate churn.
- Kept the existing in-memory social cache and in-flight request deduplication as the first two fast paths before touching the edge cache or public social pages.
- Skipped the media `HEAD` probe when the URL extension or known media type already proves that the resource is not HLS.
- Skipped the media probe for known X/Twitter video CDN URLs because their host/path identifies a direct video resource.
- Resolved HLS video variants and their selected audio rendition concurrently, removing another sequential playlist RTT before segment download.
- Increased the default HLS segment concurrency from 2 to 4 and allowed explicit configuration up to 6, improving latency for multi-segment playlists while retaining the existing media budget.

## Safety

- Edge cache failures are fail-open: cache outages never block media delivery.
- Cached social metadata is structurally validated before it can become a Telegram caption.
- HLS probing remains enabled for opaque URLs where the URL alone cannot distinguish a playlist from direct media.
