import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createTestDb } from "./helpers/d1.ts";
import { handleNotificationSend } from "../src/routes/notifications.ts";
import { routeRequest } from "../src/app/router.ts";
import type { Env } from "../src/types.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture() {
  const { db, sqlite } = createTestDb();
  const env = {
    RELAY_DB: db as D1Database,
    TELEGRAM_BOT_TOKEN: "bot",
    NOTIFICATION_API_TOKEN: "my-token",
    NOTIFICATION_CHAT_ID: "-100123:73",
  } as Env;
  return { env, sqlite };
}
function send(env: Env, body: Record<string, unknown>, path = "/notifications/send") {
  return routeRequest(new Request("https://relay.example" + path, {
    method: "POST",
    headers: { "Authorization": "Bearer my-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
}

describe("Edit-in-place Telegram notifications", () => {
  it("creates once then edits same message on every progress update", async () => {
    const { env, sqlite } = fixture();
    const calls: { endpoint: string; body: Record<string, any> }[] = [];
    globalThis.fetch = async (url, init) => {
      const endpoint = String(url);
      const body = JSON.parse(String(init?.body));
      calls.push({ endpoint, body });
      return Response.json({ ok: true, result: {
        message_id: 551, chat: { id: -100123 },
      } });
    };
    for (let i = 0; i < 3; i++) {
      const response = await send(env, {
        notification_key: "workflow:rodkisten/photointel:123", sequence: 100001 + i,
        body: "Progress " + i, parse_mode: "HTML",
        buttons: [[{ text: "Logs", url: "https://github.com/rodkisten/photointel" }]],
      });
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal(calls.length, 3);
    assert.equal(calls[0].endpoint.endsWith("/sendMessage"), true);
    assert.equal(calls[1].endpoint.endsWith("/editMessageText"), true);
    assert.equal(calls[2].endpoint.endsWith("/editMessageText"), true);
    assert.equal(calls[2].body.message_id, 551);
    assert.equal(calls[2].body.message_thread_id, undefined);
    assert.equal(calls[2].body.chat_id, "-100123");
    const saved = sqlite.prepare("SELECT message_id, sequence FROM notification_messages").get() as {
      message_id: number; sequence: number;
    };
    assert.equal(saved.message_id, 551);
    assert.equal(saved.sequence, 100003);
  });

  it("ignores stale events and does not regress completed status", async () => {
    const { env } = fixture();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ ok: true, result: { message_id: 99 } });
    };
    assert.equal((await send(env, { notification_key: "batch:1", sequence: 20, body: "Done" })).status, 200);
    const ignored = await send(env, { notification_key: "batch:1", sequence: 10, body: "Running" });
    assert.equal(ignored.status, 200);
    assert.equal((await ignored.json() as { stale: boolean }).stale, true);
    assert.equal(calls, 1);
  });

  it("edits explicitly by message_id and clears old buttons", async () => {
    const { env, sqlite } = fixture();
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /editMessageText$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.message_id, 77);
      assert.deepEqual(body.reply_markup.inline_keyboard, []);
      return Response.json({ ok: true, result: { message_id: 77 } });
    };
    const result = await send(env, { body: "Fixed", message_id: 77 }, "/notifications/edit");
    assert.equal(result.status, 200);
    assert.equal((await result.json() as { edited: boolean }).edited, true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_messages").get()?.count, 0);
  });

  it("handles Telegram no-op edits and retries without duplicate sends", async () => {
    const { env } = fixture();
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      return String(url).includes("/editMessageText")
        ? Response.json({ ok: false, error_code: 400, description: "Bad Request: message is not modified" }, { status: 400 })
        : Response.json({ ok: true, result: { message_id: 11 } });
    };
    await send(env, { notification_key: "batch:2", sequence: 1, body: "Test" });
    const response = await send(env, { notification_key: "batch:2", sequence: 2, body: "Test" });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { unchanged: boolean }).unchanged, true);
    assert.equal(calls, 2);
  });

  it("replaces a Telegram message only when Telegram confirms it is missing", async () => {
    const { env } = fixture();
    const endpoints: string[] = [];
    globalThis.fetch = async (url) => {
      endpoints.push(String(url));
      if (endpoints.length === 2) {
        return Response.json({ ok: false, error_code: 400,
          description: "Bad Request: message to edit not found" }, { status: 400 });
      }
      return Response.json({ ok: true, result: { message_id: endpoints.length === 1 ? 111 : 222 } });
    };
    for (let i = 1; i <= 2; i++) {
      const response = await send(env, { notification_key: "batch:3", sequence: i, body: "State " + i });
      assert.equal(response.status, 200);
    }
    assert.equal(endpoints.length, 3);
    assert.match(endpoints[2], /sendMessage$/);
    const third = await send(env, { notification_key: "batch:3", sequence: 3, body: "Final" });
    assert.equal(third.status, 200);
    assert.match(endpoints[3], /editMessageText$/);
  });

  it("keeps previous message when Telegram rejects transient edit", async () => {
    const { env, sqlite } = fixture();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1
        ? Response.json({ ok: true, result: { message_id: 11 } })
        : Response.json({ ok: false, description: "Too Many Requests", error_code: 429 }, { status: 429 });
    };
    await send(env, { notification_key: "batch:4", sequence: 1, body: "Started" });
    const failed = await send(env, { notification_key: "batch:4", sequence: 2, body: "Running" });
    assert.equal(failed.status, 502);
    assert.equal(calls, 2);
    assert.equal(sqlite.prepare("SELECT message_id FROM notification_messages").get()?.message_id, 11);
  });

  it("rejects unauthenticated edits and invalid keys", async () => {
    const { env } = fixture();
    const unauthorized = await routeRequest(new Request("https://relay.example/notifications/edit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Hello", message_id: 1 }),
    }), env);
    assert.equal(unauthorized.status, 401);
    const missing = await send(env, { body: "Hello" }, "/notifications/edit");
    assert.equal(missing.status, 422);
    const invalid = await send(env, { body: "hello", notification_key: "../space bad" });
    assert.equal(invalid.status, 422);
  });
});
