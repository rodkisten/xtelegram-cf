import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTestDb } from "./helpers/d1";
import { handleRodx } from "../src/routes/rodx";

const base = "https://relay.test/rodx/v1/";
const secret = (s: string) => "rodx_" + s.repeat(43);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function req(path: string, token: string, method = "GET", body?: unknown) {
  return new Request(base + path, { method, headers: {
    Authorization: "Bearer " + token, "Content-Type": "application/json"
  }, body: body == null ? undefined : JSON.stringify(body) });
}
async function read(response: Response) { return { status: response.status, data: await response.json() as any }; }

test("RodX D1 sync isolates principals and X accounts, enforces revisions", async () => {
  const { db, sqlite } = createTestDb();
  const alice = secret("a"), bob = secret("b");
  sqlite.prepare("INSERT INTO rodx_users(id,label) VALUES(?,?)").run("a", "Alice");
  sqlite.prepare("INSERT INTO rodx_users(id,label) VALUES(?,?)").run("b", "Bob");
  sqlite.prepare("INSERT INTO rodx_tokens(token_sha256,user_id) VALUES(?,?)").run(hash(alice), "a");
  sqlite.prepare("INSERT INTO rodx_tokens(token_sha256,user_id) VALUES(?,?)").run(hash(bob), "b");
  const env = { RELAY_DB: db } as any;
  async function call(path: string, token: string, method = "GET", body?: unknown) {
    return read(await handleRodx(req(path, token, method, body), env));
  }
  assert.equal((await call("me", "12345678")).status, 401);
  assert.equal((await call("me", alice)).data.user.id, "a");
  const payload = { searches: [{ id: "a1", query: "#foo" }], presets: [], visual: { density: 1 }, selectionList: [] };
  assert.equal((await call("snapshot", alice, "PUT", { account: "uid-100", baseRevision: 0, data: payload })).data.revision, 1);
  assert.equal((await call("snapshot?account=uid-100", alice)).data.data.searches[0].query, "#foo");
  assert.equal((await call("snapshot?account=uid-100", bob)).data.revision, 0);
  assert.equal((await call("snapshot?account=uid-200", alice)).data.revision, 0);
  assert.equal((await call("snapshot", alice, "PUT", { account: "uid-100", baseRevision: 0, data: payload })).status, 409);
  assert.equal((await call("snapshot", alice, "PUT", { account: "uid-100", baseRevision: 1, data: payload })).data.revision, 2);
  const entry = { query: "#foo", firstUsed: 1000, lastUsed: 2000, count: 2 };
  assert.equal((await call("history", alice, "POST", { account: "uid-100", entries: [entry] })).data.accepted, 1);
  await call("history", alice, "POST", { account: "uid-100", entries: [entry] });
  assert.equal((await call("history?account=uid-100", alice)).data.entries[0].count, 2);
  assert.equal((await call("history?account=uid-100", bob)).data.entries.length, 0);
  assert.equal((await call("seen", alice, "POST", { account: "uid-100", entries: [{ id: "123456789012345", at: 1000 }] })).data.accepted, 1);
  assert.equal((await call("seen?account=uid-100", alice)).data.entries[0].id, "123456789012345");
  assert.equal((await call("seen?account=uid-100", bob)).data.entries.length, 0);
  sqlite.close();
});
