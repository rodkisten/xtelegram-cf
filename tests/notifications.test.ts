import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { formatGithubWorkflowRun, verifyGithubSignature } from "../src/lib/github-notifications.ts";
import { handleNotificationSend } from "../src/routes/notifications.ts";
import { routeRequest } from "../src/app/router.ts";
import { handleGithubWebhook } from "../src/routes/github-webhook.ts";
import type { Env } from "../src/types.ts";
import { createTestDb } from "./helpers/d1.ts";

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
  const { db, sqlite } = createTestDb();
  return { ...db, state: new Map<string, string>(), sqlite };
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
    assert.equal(db.sqlite.prepare(
      "SELECT state FROM github_notification_deliveries WHERE delivery_id=?"
    ).get("abcdef12-3456-4789-8765-abcdef123456")?.state, "sent");
  });

  it("accepts requested/in_progress by default and filters them when configured", async () => {
    const db = fakeDb();
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "bot",
      GITHUB_WEBHOOK_CHAT_ID: "42",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    let sends = 0;
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ ok: true, result: { message_id: 2 } });
    };
    const accepted = await handleGithubWebhook(signedRequest(webhookPayload("requested", ""), "secret"), env);
    assert.equal(accepted.status, 200);
    assert.equal(sends, 1);

    const filtered = await handleGithubWebhook(signedRequest(webhookPayload("in_progress", ""), "secret",
      "bcdefa12-3456-4789-8765-abcdef123456"), {
      ...env, GITHUB_NOTIFY_ACTIONS: "completed",
    });
    assert.equal(filtered.status, 202);
    assert.equal(sends, 1);
  });
});

describe("Notification Studio HTML page", () => {
  it("serves the composer on both /notifications URLs without exposing Worker secrets", async () => {
    const env = {
      RELAY_TOKEN: "secret-relay-token",
      NOTIFICATION_API_TOKEN: "secret-notification-token",
      TELEGRAM_BOT_TOKEN: "secret-bot-token",
    } as Env;
    for (const path of ["/notifications", "/notifications/"]) {
      const response = await routeRequest(new Request("https://relay.example" + path), env);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/html/);
      assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
      const page = await response.text();
      assert.match(page, /Telegram para iOS/);
      assert.match(page, /\/notifications\/send/);
      assert.match(page, /generated-code/);
      assert.match(page, /Copiar código/);
      assert.match(page, /Markdown/);
      const moduleScript = page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
      assert.ok(moduleScript);
      assert.doesNotThrow(() => new Function(moduleScript));
      assert.doesNotMatch(page, /secret-relay-token|secret-notification-token|secret-bot-token/);
    }
  });

  it("keeps POST /notifications/send private even though the editor is public", async () => {
    const response = await routeRequest(new Request("https://relay.example/notifications/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Hello", chat_id: "123" }),
    }), { NOTIFICATION_API_TOKEN: "private-token" } as Env);
    assert.equal(response.status, 401);
  });
});
