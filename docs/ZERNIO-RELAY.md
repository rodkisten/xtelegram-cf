# Zernio publishing from the Relay D1 video queue

The existing Telegram delivery remains unchanged. Successful video deliveries are enqueued in
the existing x_repost_queue, including those sent by iOS Shortcuts. This optional adapter uses
a connected Zernio account to schedule/publish a queued MP4 to X or Instagram.

## Safety

- OFF by default, including cron publication. No automatic costs are enabled.
- The Zernio API key belongs in a Cloudflare Worker **secret**, never in Wrangler vars,
  repository files, browser storage, Shortcuts or userscripts.
- Zernio's X connection can require a payment method and pass through X API fees.
  Do not enable X posting until you agree to the provider's charges.
- The MP4 must be present in the existing private X_REPOST_MEDIA R2 bucket. Zernio
  cannot read private R2 URLs. The Worker uses POST /v1/media/presign followed by a
  streaming PUT of the video, then POST /v1/posts with Idempotency-Key.
- Signed uploads are temporary; the adapter refuses to schedule a post more than six
  days ahead. The D1 queue already spaces video items by approximately 45–75 minutes.
- You need redistribution rights for each source video. This integration does not
  verify that an uploaded video is licensed for reposting.
- Do not retry a timed-out POST /v1/posts blindly. An uncertain outcome is held
  for manual reconciliation to prevent duplicate published videos.

## Setup

1. Review the code and run migrations BEFORE deploying:

       npm run db:migrate:remote

2. Save your existing Zernio key as a Worker secret from your own secure terminal.
   The command prompts for the value without placing it in command-line history:

       npx wrangler secret put ZERNIO_API_KEY

   This command can create a new Worker version/deployment. Do not run it until you
   are prepared to update the deployed Worker.

3. Connect your own X and/or Instagram account in Zernio via its dashboard OAuth.
   List available accounts through the Zernio REST API or the authenticated Relay
   endpoint below. A connected Instagram account must be Business or Creator.

4. Configure ZERNIO_TWITTER_ACCOUNT_ID and/or ZERNIO_INSTAGRAM_ACCOUNT_ID in the
   environment for the exact accounts you intend to use. Set ZERNIO_ENABLED = "true"
   only after checking whether you will incur provider charges.

5. Leave ZERNIO_AUTO_PUBLISH = "false" for the pilot. For cron-based publishing,
   explicitly set it to "true" and choose ZERNIO_AUTO_PLATFORM = "twitter" or
   "instagram". The existing 10-minute cron submits at most one due video per run,
   with no attempt to replay ambiguous provider responses. It also reconciles one
   known scheduled/publishing post per run.

## Authenticated Relay endpoints

All endpoints use the existing Relay bearer authentication. Never expose RELAY_TOKEN
or ZERNIO_API_KEY in a query string or public client bundle.

- GET /x/repost/zernio/status: feature/configuration flags (no credentials)
- GET /x/repost/zernio/accounts: connected X/Instagram account IDs and health fields
- GET /x/repost/zernio/jobs?limit=30: D1 submission states
- POST /x/repost/zernio/submit: { queueId, platform, confirmPublish: true }
- POST /x/repost/zernio/refresh: { queueId, platform }

For a manual, explicitly approved pilot post:

    curl -X POST https://xtelegram-cf.migos.club/x/repost/zernio/submit \
      -H "Authorization: Bearer $RELAY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"queueId":"REPLACE_WITH_D1_UUID","platform":"instagram","confirmPublish":true}'

The queue item must be queued, have a durable MP4 in R2 and have no prior active
submission for that platform. A scheduled Zernio X post blocks Scriptable's manual
claim path for the same item. Instagram submissions do not change the X queue status.

### State model

- preparing / failed_preflight: uploading media before a post creation request
- submitting / uncertain: the POST /v1/posts outcome is not safe to repeat
- scheduled / publishing: provider has accepted the request, not necessarily published
- published: confirmed by the Zernio platform target; X queue becomes posted only
  once the X platform says published
- failed: provider reports failed; examine Zernio before taking manual action

Idempotency-Key is deterministic per D1 queue ID + platform. Zernio documents a
24-hour strong idempotency window; the D1 row remains persistent beyond that
window and avoids automatic resubmission after timeout.

## API documentation

- https://zernio.com/agent-quickstart.md
- https://docs.zernio.com/guides/media-uploads
- https://docs.zernio.com/platforms/twitter/posts
- https://docs.zernio.com/platforms/instagram
- https://docs.zernio.com/changelog (Idempotency-Key, September 25, 2026)

## Deployment notes

The project intentionally retains Wrangler, D1 and R2. No new billed Cloudflare
resource or billing configuration is introduced by this change. The code is inert
until migrations, secret and account configuration are present and ZERNIO_ENABLED
is explicitly true. Run the repository typecheck and test suites before deployment.
