# RodX personal cloud sync (D1)

This is an **opt-in** extension of the existing Telegram relay. Media routes continue
to use `RELAY_TOKEN`; /rodx/v1/* uses a **separate per-person bearer key**.

## Deployment

1. Run `npm run db:migrate:remote` after reviewing the new migration.
2. Run `node scripts/provision-rodx-user.mjs USER_ID "User name"`.
3. Execute both printed statements with `npx wrangler d1 execute RELAY_DB --remote --command "SQL"`.
4. Enter the personal `rodx_...` token in the userscript's cloud-sync configuration.
5. Deploy the Worker after the migration. Do not deploy without the D1 tables.

Never store real tokens in git. The current repo's wrangler.toml contains historical
`RELAY_TOKEN` and `TELEGRAM_BOT_TOKEN` values. **Rotate them**, remove them
from the tracked file, and set them using `wrangler secret put`. A legacy shared
media token must never authorize access to private RodX account data.

## API

All routes require `Authorization: Bearer rodx_...` and return JSON.
The authenticated principal is resolved from a SHA-256 token digest in D1.
The account parameter identifies an X profile *within that principal* and
cannot grant access to another user's data.

- `GET /rodx/v1/me`: identity test.
- `GET /rodx/v1/snapshot?account=uid-...`: full searches, presets, visual
  settings and saved selections; responds with revision 0 on first access.
- `PUT /rodx/v1/snapshot`: `{account,baseRevision,data}`.
  Server uses compare-and-swap; HTTP 409 includes the latest remote revision
  and snapshot for merge/retry. No silent overwrite.
- `GET /rodx/v1/history?account=uid-...&limit=100&offset=0`: paginated.
- `POST /rodx/v1/history`: `{account,entries:[{query,sort,source,firstUsed,lastUsed,count}]}`;
  idempotent merge by query SHA-256.
- `DELETE /rodx/v1/history?account=...&hash=...`: one query;
  omit hash to clear the account's history.
- `GET /rodx/v1/seen?account=...&since=...&limit=500`: seen tweets.
- `POST /rodx/v1/seen`: `{account,entries:[{id,at}]}`, idempotent.

Snapshot size limit 900 KB; history and seen batches max 100 entries. Do not
sync Telegram/media tokens as user preferences. Existing local storage remains
a fallback when the cloud is unavailable.

This PR adds the schema and server routes, **not an automatic Cloudflare deployment**.
