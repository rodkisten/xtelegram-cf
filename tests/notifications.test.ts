import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { formatGithubWorkflowRun, verifyGithubSignature } from "../src/lib/github-notifications.ts";
import { handleNotificationSend } from "../src/routes/notifications.ts";
import { handleGithubWebhook } from "../src/routes/github-webhook.ts";
import type { Env } from "../src/types.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function webhookPayload(action = "completed", conclusion = "success") {
  return {
    action,
    repository: { full_name: "rodkisten/example", html_url: "https://github.com/rodkisten/example" },
    workflow_run: {
      id: 123456,
      name: "Deploy <production>",
      run_number: 19,
      run_attempt: 2,
      display_title: "Fix <em>escaping</em>",
      head_branch: "main",
      head_sha: "a".repeat(40),
      conclusion,
      html_url: "https://github.com/rodkisten/example/actions/runs/123456",
      head_commit: { message: "Fix & build <safe>" },
      triggering_actor: { login: "rod" },
    },
  };
}

function signedRequest(payload: object, secret: string, deliveryId = "abcdef12-3456-4789-8765-abcdef123456") {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("https://relay.example/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-GitHub-Event": "workflow_run",
      "X-Hub-Signature-256": "sha256=" + signature,
      "X-GitHub-Delivery": deliveryId,
    },
    body: raw,
  });
}

function fakeDb() {
  const state = new Map<string, string>();
  return {
    state,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const id = String(params[0]);
              if (sql.startsWith("INSERT")) {
                if (state.get(id) === "sent" || state.get(id) === "processing") {
                  return { meta: { changes: 0 } };
                }
                state.set(id, "processing");
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith("UPDATE")) {
                state.set(id, String(params[1]));
                return { meta: { changes: 1 } };
              }
              throw new Error("Unexpected SQL statement");
            },
          };
        },
      };
    },
  };
}

describe("Telegram notification sender", () => {
  it("sends a text body to a forum topic with optional URL buttons", async () => {
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /\/sendMessage$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.chat_id, "-10012345");
      assert.equal(body.message_thread_id, 73);
      assert.equal(body.text, "Build finished!");
      assert.equal(body.parse_mode, "HTML");
      assert.equal(body.link_preview_options.is_disabled, true);
      assert.equal(body.reply_markup.inline_keyboard[0][0].url, "https://github.com/example");
      return Response.json({
        ok: true,
        result: { message_id: 44, chat: { id: -10012345 } },
      });
    };
    const request = new Request("https://relay.example/notifications/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: "-10012345:73",
        body: "Build finished!",
        parse_mode: "HTML",
        buttons: [[{ text: "Open", url: "https://github.com/example" }]],
      }),
    });
    const response = await handleNotificationSend(request, { TELEGRAM_BOT_TOKEN: "test-bot" } as Env);
    assert.equal(response.status, 200);
    const result = await response.json() as Record<string, unknown>;
    assert.equal(result.message_id, 44);
  });

  it("rejects invalid chat ID, unsafe links and oversize bodies before contacting Telegram", async () => {
    globalThis.fetch = async () => { throw new Error("should not call Telegram"); };
    for (const data of [
      { body: "test", chat_id: "invalid id" },
      { body: "test", chat_id: "1234", buttons: [[{ text: "Bad", url: "javascript:alert(1)" }]] },
      { body: "X".repeat(4097), chat_id: "1234" },
    ]) {
      const response = await handleNotificationSend(new Request("https://relay.example/notifications/send", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
      }), { TELEGRAM_BOT_TOKEN: "test-bot" } as Env);
      assert.equal(response.status, 422);
    }
  });
});

describe("GitHub workflow webhook", () => {
  it("validates HMAC-SHA256 over raw bytes", async () => {
    const bytes = new TextEncoder().encode('{"hello":"world"}');
    const signature = createHmac("sha256", "secret").update(bytes).digest("hex");
    assert.equal(await verifyGithubSignature(bytes.buffer, "sha256=" + signature, "secret"), true);
    assert.equal(await verifyGithubSignature(bytes.buffer, "sha256=" + signature, "wrong"), false);
    assert.equal(await verifyGithubSignature(bytes.buffer, "sha1=" + signature, "secret"), false);
  });

  it("HTML-escapes external metadata and includes GitHub buttons", () => {
    const message = formatGithubWorkflowRun(webhookPayload());
    assert.ok(message);
    assert.match(message.text, /✅/);
    assert.match(message.text, /Deploy &lt;production&gt;/);
    assert.match(message.text, /Fix &amp; build &lt;safe&gt;/);
    assert.equal(message.text.includes("<em>"), false);
    assert.match(message.buttons[0][0].url, /actions\/runs\/123456$/);
    assert.match(message.buttons[1][0].url, /commit\/aaaa/);
  });

  it("rejects unsigned requests and does not send notifications", async () => {
    const db = fakeDb();
    let sends = 0;
    globalThis.fetch = async () => { sends++; return Response.json({ ok: true }); };
    const request = signedRequest(webhookPayload(), "secret");
    request.headers.set("X-Hub-Signature-256", "sha256=" + "0".repeat(64));
    const response = await handleGithubWebhook(request, {
      GITHUB_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "bot",
      GITHUB_WEBHOOK_CHAT_ID: "42",
      RELAY_DB: db as unknown as D1Database,
    } as Env);
    assert.equal(response.status, 401);
    assert.equal(sends, 0);
  });

  it("sends once and deduplicates repeated GitHub delivery IDs", async () => {
    const db = fakeDb();
    let sends = 0;
    globalThis.fetch = async (_input, init) => {
      sends++;
      const data = JSON.parse(String(init?.body));
      assert.match(data.text, /✅/);
      assert.equal(data.chat_id, "-1001234");
      assert.equal(data.message_thread_id, 55);
      return Response.json({ ok: true, result: { message_id: 99 } });
    };
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "bot",
      GITHUB_WEBHOOK_CHAT_ID: "-1001234:55",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    const response1 = await handleGithubWebhook(signedRequest(webhookPayload(), "secret"), env);
    const response2 = await handleGithubWebhook(signedRequest(webhookPayload(), "secret"), env);
    assert.equal(response1.status, 200);
    assert.equal(response2.status, 200);
    assert.equal((await response2.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(sends, 1);
    assert.equal(db.state.get("abcdef12-3456-4789-8765-abcdef123456"), "sent");
  });

  it("filters requested/in_progress by default and accepts them if configured", async () => {
    const db = fakeDb();
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "bot",
      GITHUB_WEBHOOK_CHAT_ID: "42",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    const ignored = await handleGithubWebhook(signedRequest(webhookPayload("requested", ""), "secret"), env);
    assert.equal(ignored.status, 202);
    let sends = 0;
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ ok: true, result: { message_id: 2 } });
    };
    const accepted = await handleGithubWebhook(signedRequest(webhookPayload("requested", ""), "secret"), {
      ...env, GITHUB_NOTIFY_ACTIONS: "requested,in_progress,completed",
    });
    assert.equal(accepted.status, 200);
    assert.equal(sends, 1);
  });
});
