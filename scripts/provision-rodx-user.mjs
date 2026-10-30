#!/usr/bin/env node
/**
 * Run locally, never commit the printed token:
 *   node scripts/provision-rodx-user.mjs <user-id> [label]
 *
 * Then execute the generated SQL with:
 *   npx wrangler d1 execute RELAY_DB --remote --command "<sql>"
 *
 * Use the personal token in RodX's cloud settings, NOT RELAY_TOKEN.
 */
import { randomBytes, createHash } from "node:crypto";

const user = process.argv[2]?.trim();
const label = process.argv[3]?.trim() || user;
if (!user || !/^[a-zA-Z0-9_.:@-]{1,128}$/.test(user)) {
  console.error("Usage: node scripts/provision-rodx-user.mjs <user-id> [label]");
  process.exit(1);
}
const escape = value => "'" + value.replaceAll("'", "''") + "'";
const token = "rodx_" + randomBytes(32).toString("base64url");
const sha = createHash("sha256").update(token).digest("hex");
console.log("Personal token (displayed once):", token);
console.log("Run remotely via Wrangler (copy only the SQL):");
console.log(`INSERT INTO rodx_users(id,label) VALUES(${escape(user)},${escape(label)}) ON CONFLICT(id) DO UPDATE SET label=excluded.label;`);
console.log(`INSERT INTO rodx_tokens(token_sha256,user_id) VALUES('${sha}',${escape(user)});`);
console.log("Store the token in a password manager and rotate the shared relay secrets.");
