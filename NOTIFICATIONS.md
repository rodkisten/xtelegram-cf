# Telegram Notification Sender + GitHub Actions Webhooks

The relay now supports text notifications independently from media uploads.

## Endpoints

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| POST /notifications/send | Authorization: Bearer NOTIFICATION_API_TOKEN | Deliver text to a Telegram chat or forum topic |
| POST /webhooks/github | X-Hub-Signature-256 (GitHub HMAC SHA-256) | Format and send GitHub Actions workflow_run status notifications |

Both return JSON with ok and error details, and preserve X-Relay-Trace-Id response correlation. Never share bot tokens or API secrets in client-side code.

### 1. Configure Cloudflare Worker

    npx wrangler secret put NOTIFICATION_API_TOKEN
    npx wrangler secret put GITHUB_WEBHOOK_SECRET

Use two independent, high-entropy random secrets. The GitHub webhook secret must match the Secret field in GitHub's webhook settings.

Set nonsecret destinations in Wrangler vars:

    NOTIFICATION_CHAT_ID="-1001234567890:73"
    GITHUB_WEBHOOK_CHAT_ID="-1001234567890:73"
    GITHUB_NOTIFY_ACTIONS="completed"

The destination supports numeric IDs, Telegram @channel usernames or -100...:73 for forum topics. For private messages, start the bot (/start) and use your own numeric Telegram chat ID. Bots cannot initiate a private chat before the user opens them.

GITHUB_WEBHOOK_CHAT_ID falls back to NOTIFICATION_CHAT_ID, then the legacy TELEGRAM_CHAT_ID. Set an explicit GitHub destination to avoid notifications in a media-only channel.

Apply the D1 migration BEFORE deployment:

    npm ci
    npm run db:migrate:remote
    npm run typecheck
    npm test
    npx wrangler deploy

Do not place real API tokens in wrangler.toml or GitHub files. Rotate previously committed credentials and replace them with Wrangler secrets.

### 2. Send text via API

    curl --fail-with-body -X POST "https://YOUR-WORKER.example/notifications/send" \
      -H "Authorization: Bearer $NOTIFICATION_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"chat_id":"-1001234567890:73","body":"✅ Build concluído!","parse_mode":"HTML","disable_notification":false,"buttons":[[{"text":"🔎 Abrir run","url":"https://github.com/owner/repo/actions"}]]}'

The JSON object accepts:

- body (required) or text: 1-4096 characters
- chat_id / chatId: optional if NOTIFICATION_CHAT_ID is configured
- message_thread_id / messageThreadId: integer topic ID, optional
- parse_mode / parseMode: HTML or MarkdownV2, default plain text
- disable_notification: optional boolean
- buttons: optional array of up to 3 rows of up to 3 HTTPS URL buttons

Success example:

    { "ok": true, "chat_id": "-1001234567890", "message_thread_id": 73, "message_id": 456 }

Telegram errors return HTTP 502, stage=telegram, and telegramStatus when available. Unauthenticated requests receive HTTP 401.

### 3. Native GitHub webhook setup

For each repository, or at organization level (with the appropriate permissions):

1. Open Settings > Webhooks > Add webhook.
2. Payload URL: https://YOUR-WORKER.example/webhooks/github
3. Content type: application/json
4. Secret: same value as GITHUB_WEBHOOK_SECRET
5. Choose individual events, select Workflow runs, and activate the webhook.

The endpoint verifies GitHub's signature against the raw bytes BEFORE parsing JSON. Unsigned or incorrectly signed requests return 401.

By default, only workflow_run completed notifications are sent, covering success, failure, cancelled, timed_out, action_required, neutral, skipped, stale and startup_failure. For start/queue alerts too, set GITHUB_NOTIFY_ACTIONS="requested,in_progress,completed".

Messages include status emoji, repository, workflow name, run/attempt number, branch, short SHA, actor, and an inline button linking to the GitHub run. A commit button is included when the SHA is available.

Repeated GitHub deliveries of the same X-GitHub-Delivery ID are deduplicated in D1. Failed attempts can retry; abandoned claims become retryable after five minutes. After ambiguous Telegram network failures, a redelivery may still produce a duplicate.

### 4. Alternative: manual notification step inside a GitHub Actions workflow

If native webhooks are unavailable, add NOTIFICATION_API_TOKEN to the repo's Actions secrets and use an optional post-build step:

    - name: Notify Telegram
      if: always()
      continue-on-error: true
      env:
        NOTIFY_TOKEN: ${{ secrets.NOTIFICATION_API_TOKEN }}
        RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        STATUS: ${{ job.status }}
      run: |
        jq -n --arg body "GitHub Actions: $STATUS" \
          --arg url "$RUN_URL" \
          '{body:$body,buttons:[[{text:"🔎 Abrir execução",url:$url}]]}' > notification.json
        curl --fail-with-body --retry 2 \
          -X POST "https://YOUR-WORKER.example/notifications/send" \
          -H "Authorization: Bearer $NOTIFY_TOKEN" \
          -H "Content-Type: application/json" \
          --data-binary @notification.json

Prefer the native webhook for consistent results across all workflow files without editing every workflow YAML.
