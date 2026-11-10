# RodX Relay: Buffer → Zernio → X API for one D1 video queue

The existing Telegram delivery and the original Shortcut/userscript are unchanged.
After successful Telegram delivery, the Relay already enqueues one item in x_repost_queue
(by X status ID) and caches its MP4 in private R2 when possible.

This feature adds a **single X publishing pipeline**:
1. **Buffer** GraphQL, first and preferred.
2. **Zernio**, paid fallback only after a definitive failure and explicit paid opt-in.
3. **X API v2**, final paid fallback with chunked upload and user-context OAuth token.

The feature is OFF by default. Deploying code does not publish posts. The D1 queue,
provider attempts, cooldown, and Telegram receipts remain on Cloudflare.

## Safety and deduplication

- One D1 job per source video. No simultaneous Buffer/Zernio/X submissions.
- Provider order is fixed. If the first provider has **accepted** a post, wait for
  its final status; do not submit it elsewhere. If a create times out or is ambiguous,
  mark uncertain and require manual reconciliation. Never blindly retry.
- HTTP 429 leads to a shared cooldown with Retry-After plus jitter; never treat a
  rate limit as permission to switch providers.
- Only a confirmed no-post result can reach the next provider, and paid fallbacks
  require X_PUBLISH_ENABLE_PAID_FALLBACK=true.
- There is one atomic D1 posting budget for the X account across configured providers.
  The defaults are **20 items / rolling 24h, 2 items/hour, minimum 3600s between
  new attempts**. Code hard-caps the configured values at 40/24h, 2/h and >=2700s.
- The X platform independently limits unverified accounts to 50 original posts per
  day and smaller subintervals. Buffer reports 50/day unverified and 100/day verified.
  The Relay cannot count posts published in the X native app or other systems,
  so keep headroom if you use those as well.
- Attempts count toward the Relay budget even if an upstream rejects them. This
  intentionally sacrifices some throughput to avoid bursts or duplicate publishing.
- This is not permission to repost third-party copyrighted videos. The publisher
  does not check redistribution rights for a downloaded clip.

## Requirements before deployment

1. Apply migration **0013_x_publish_pipeline.sql** (and all prior migrations) before
   deploying code with the new schema:

       npm run db:migrate:remote

   Running remote migrations changes the existing production D1. Review them first.

2. Connect the desired **X account** to Buffer. Obtain the Buffer API key and its
   actual X channel ID (the organization must own the account). Buffer's API keys
   are available even on Free.

3. Store Buffer and signing secrets using Wrangler prompts. They do not belong in
   wrangler.toml, GitHub Actions logs, userscripts or Shortcuts:

       npx wrangler secret put BUFFER_API_KEY
       npx wrangler secret put X_PUBLISH_MEDIA_SIGNING_KEY

   Generate a strong random signing key of at least 32 characters. Rotating it
   expires earlier media links. Be aware Wrangler secret changes can deploy a
   new Worker version. Do not run them until ready for production.

4. Set environment variables (Wrangler vars or a deployment secrets workflow):

       X_PUBLISH_ENABLED=true
       BUFFER_ENABLED=true
       BUFFER_X_CHANNEL_ID=<actual Buffer X channel ID>
       X_PUBLISH_AUTO_ENABLED=false
       X_PUBLISH_NOTIFY_ENABLED=false
       X_PUBLISH_ENABLE_PAID_FALLBACK=false
       X_PUBLISH_MAX_PER_24H=20
       X_PUBLISH_MAX_PER_HOUR=2
       X_PUBLISH_MIN_GAP_SECONDS=3600
       BUFFER_30D_REQUEST_CAP=850

   If your public Worker is not https://xtelegram-cf.migos.club, set
   X_PUBLISH_MEDIA_ORIGIN to your exact HTTPS Worker origin.

5. Pilot ONE due video by calling the authenticated route below with
   confirmPublish=true. After verifying its actual X link, you may set
   X_PUBLISH_AUTO_ENABLED=true to let the existing 10-minute cron publish at
   most one due item per run and reconcile accepted posts. Set
   X_PUBLISH_NOTIFY_ENABLED=true to enable Telegram success receipts.

## Optional paid fallbacks

They never activate automatically just because a key exists.

### Zernio

- Connect X to the Zernio account and configure ZERNIO_TWITTER_ACCOUNT_ID.
- Store ZERNIO_API_KEY as a Worker secret; set ZERNIO_ENABLED=true.
- Enable X_PUBLISH_ENABLE_PAID_FALLBACK=true only after reviewing provider
  charges (Zernio can pass through the X API fee).
- Existing standalone ZERNIO_AUTO_PUBLISH cron is superseded by this single
  pipeline. Do not independently schedule the same video through both flows.

### X API v2

- Obtain an **OAuth 2.0 user-context** access token with tweet.write and
  media.write and sufficient paid API credits. An app-only bearer token cannot
  publish user tweets.
- Store it as the Worker secret X_API_USER_ACCESS_TOKEN.
- Set X_API_ENABLED=true, with the same X_PUBLISH_ENABLE_PAID_FALLBACK=true gate.
- The direct adapter uses INIT → APPEND (4 MB parts) → FINALIZE → STATUS →
  POST /2/tweets and checkpoints the media ID in D1 before attempting post
  creation. It currently accepts MP4 files up to 40 MB to bound Worker work.
- User access tokens can expire; this implementation does not create OAuth consent
  or refresh grants. Manage token rotation outside the Worker.
- Direct X API calls can incur pay-per-use fees. No payments, credits, billing
  settings, account connections or provider subscriptions are changed here.

## Buffer's private-R2 integration

Buffer requires a *public* media URL that remains available until publishing.
The Relay creates a unique HMAC-signed 20-hour link:

    GET /x/repost/public-media/:queueId?expires=...&sig=...

The URL contains no Relay token and gives access only to that one MP4 until the
expiry time. The private R2 bucket is not made public. It uses no-store responses
and only streams media after validating signature and D1 record.

Because the Relay submits only due items using Buffer's shareNow mode, it does not
intentionally queue clips days ahead with expiring links. If Buffer takes longer
than 20 hours to retrieve the video, its upload may fail; treat its final status
as authoritative before considering any provider fallback.

Buffer Free currently offers 1,000 API requests per channel per rolling 30 days,
as well as per-15-minute and per-day limits. The default local allowance of 850
requests/30 days reserves room for other uses. Each publish and status query
counts toward usage; the free plan may support far fewer than 20 videos/day over
a complete month. The local counter cannot see Buffer calls from external tools.

## Telegram publication receipts

When the X queue entry is **confirmed published**, the cron sends a Telegram
message with the original X source, successful provider and published URL.

Receipts are OFF until X_PUBLISH_NOTIFY_ENABLED=true. The migration records an
activation epoch so historical already-posted items do not trigger a backlog of
messages. Recipient order: X_PUBLISH_NOTIFY_CHAT_ID, then TELEGRAM_CHAT_ID, then
NOTIFICATION_CHAT_ID. Accepts a chat ID or chatID:threadID. Each queue ID has one
D1 notification receipt, including Scriptable/manual X publications. Unknown
Telegram responses are quarantined to avoid sending duplicate confirmations.

This is **not** a notification for merely uploading to R2, delivering to
Telegram, or for an accepted-but-still-pending Buffer/Zernio post.

## Authenticated management endpoints

Use the existing RELAY_TOKEN bearer authentication:

- GET /x/repost/publisher/status: enabled flags, provider list, limits, usage,
  Buffer API count and cooldown.
- GET /x/repost/publisher/jobs?limit=30: queued/pending/published/blocked/uncertain.
- POST /x/repost/publisher/run: {"queueId":"D1_UUID","confirmPublish":true}.
  The item must have a durable MP4, be due, and satisfy the shared budget.
- The original GET /x/repost/queue and Scriptable flows still exist.

The route does not accept credentials in URL parameters and never returns API keys.

## References (checked November 2026)

- https://developers.buffer.com/examples/create-video-post.html
- https://developers.buffer.com/guides/hosting-media
- https://developers.buffer.com/guides/posts-and-scheduling.html
- https://buffer.com/pt/api
- https://support.buffer.com/en-us/articles/daily-posting-limits-kJ0JtpsdvD
- https://docs.zernio.com/
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- https://docs.x.com/x-api/posts/create-post
- https://help.x.com/en/rules-and-policies/x-limits
