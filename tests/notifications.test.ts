import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { formatGithubWorkflowRun, verifyGithubSignature } from "../src/lib/github-notifications.ts";
import { handleNotificationSend } from "../src/routes/notifications.ts";
import { routeRequest } from "../src/app/router.ts";
import { handleGithubWebhook } from "../src/routes/github-webhook.ts";
import { matchesPatterns, selectGithubWorkflow, repositoryNotificationRules } from "../src/lib/github-notify-config.ts";
import { selectChangedPaths } from "../src/lib/github-notify-changes.ts";
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
      path: ".github/workflows/deploy.yml",
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

  it("sends failed workflows to Telegram once and deduplicates deliveries", async () => {
    const db = fakeDb();
    let sends = 0;
    globalThis.fetch = async (_input, init) => {
      sends++;
      const data = JSON.parse(String(init?.body));
      assert.match(data.text, /❌/);
      return Response.json({ ok: true, result: { message_id: 99 } });
    };
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "bot",
      GITHUB_WEBHOOK_CHAT_ID: "-1001234:55",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    const request = () => signedRequest(webhookPayload("completed", "failure"), "secret");
    assert.equal((await handleGithubWebhook(request(), env)).status, 200);
    const repeated = await handleGithubWebhook(request(), env);
    assert.equal((await repeated.json() as { duplicate: boolean }).duplicate, true);
    assert.equal(sends, 1);
  });

  it("never sends successful, requested, or in-progress workflows to Telegram", async () => {
    const db = fakeDb();
    let sends = 0;
    globalThis.fetch = async () => { sends++; throw new Error("unexpected send"); };
    const env = { GITHUB_WEBHOOK_SECRET: "secret", RELAY_DB: db as unknown as D1Database } as Env;
    for (const [index, action] of ["requested", "in_progress", "completed"].entries()) {
      const request = signedRequest(webhookPayload(action, action === "completed" ? "success" : ""),
        "secret", `abcdef1${index}-3456-4789-8765-abcdef123456`);
      const response = await handleGithubWebhook(request, env);
      assert.equal(response.status, 200);
    }
    assert.equal(sends, 0);
  });

  it("uses the custom Notify icon and time-sensitive priority for successful workflows", async () => {
    const db = fakeDb();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.includes("/live-activity/")) {
        return Response.json({ success: true, activityId: "LA12345678" });
      }
      return Response.json({ success: true });
    };
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      NOTIFY_DEVICE_ID: "device123",
      NOTIFY_TOKEN: "token12345678",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    const started = await handleGithubWebhook(
      signedRequest(webhookPayload("requested", ""), "secret"), env
    );
    assert.equal(started.status, 200);
    const completed = await handleGithubWebhook(
      signedRequest(webhookPayload("completed", "success"), "secret",
        "abcdef12-3456-4789-8765-abcdef123457"), env
    );
    assert.equal(completed.status, 200);
    assert.ok(requests.length >= 2);
    assert.ok(requests.every(({ url }) => url.includes("timeSensitive=true")));
    assert.ok(requests.every(({ url }) => url.includes("IMG_9928.png")));
    assert.equal(requests.some(({ url }) => url.includes("api.telegram.org")), false);
  });

  it("keeps a failed Notify delivery retryable without sending successful workflows to Telegram", async () => {
    const db = fakeDb();
    let attempts = 0;
    globalThis.fetch = async (input) => {
      if (String(input).includes("api.telegram.org")) throw new Error("Telegram must not receive success alerts");
      attempts++;
      if (attempts === 1) return Response.json({ success: false });
      return Response.json({ success: true, activityId: "LA12345678" });
    };
    const env = {
      GITHUB_WEBHOOK_SECRET: "secret",
      NOTIFY_DEVICE_ID: "device123",
      NOTIFY_TOKEN: "token12345678",
      RELAY_DB: db as unknown as D1Database,
    } as Env;
    const request = () => signedRequest(webhookPayload("requested", ""), "secret");
    const failed = await handleGithubWebhook(request(), env);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json() as { retryable: boolean }).retryable, true);
    const retry = await handleGithubWebhook(request(), env);
    assert.equal(retry.status, 200);
    assert.equal(attempts, 2);
  });

  it("filters actions when configured", async () => {
    const db = fakeDb();
    const response = await handleGithubWebhook(
      signedRequest(webhookPayload("in_progress", ""), "secret"),
      { GITHUB_WEBHOOK_SECRET: "secret", GITHUB_NOTIFY_ACTIONS: "completed",
        RELAY_DB: db as unknown as D1Database } as Env,
    );
    assert.equal(response.status, 202);
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

describe("Repository-scoped YAML notification routing", () => {
  it("uses separate workflow and changed-path rules for each repository", () => {
    assert.ok(repositoryNotificationRules("rodkisten/photointel").changed_paths.includes("infra/**"));
    assert.ok(repositoryNotificationRules("rodkisten/userscripts-cf").changed_paths.includes("runtime/**"));
    assert.equal(repositoryNotificationRules("rodkisten/shell").changed_paths.includes("infra/**"), false);
    assert.equal(selectGithubWorkflow({
      repository: { full_name: "rodkisten/photointel" },
      workflow_run: { path: ".github/workflows/deploy.yml" },
    }).allowed, true);
    assert.equal(selectGithubWorkflow({
      repository: { full_name: "rodkisten/photointel" },
      workflow_run: { path: ".github/workflows/repair-lockfile.yml" },
    }).allowed, false);
  });

  it("handles positive, negative, recursive and exact file globs", () => {
    assert.equal(matchesPatterns("src/deep/file.ts", ["src/**"]), true);
    assert.equal(matchesPatterns("src/deep/file.md", ["src/**", "!**/*.md"]), false);
    assert.equal(matchesPatterns("src/a.ts", ["packages/**"]), false);
    assert.equal(matchesPatterns("wrangler.toml", ["wrangler.toml"]), true);
  });

  it("filters PR files using GitHub API with repository-specific paths", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/repos\/rodkisten\/userscripts-cf\/pulls\/12\/files/);
      return Response.json([{ filename: "runtime/context.ts" }]);
    };
    const payload = {
      repository: { full_name: "rodkisten/userscripts-cf" },
      workflow_run: { pull_requests: [{ number: 12 }], event: "pull_request" },
    };
    assert.equal((await selectChangedPaths(payload, {} as Env)).allowed, true);
    globalThis.fetch = async () => Response.json([{ filename: "README.md" }]);
    const ignored = await selectChangedPaths(payload, {} as Env);
    assert.equal(ignored.allowed, false);
    assert.equal(ignored.reason, "changed_paths_filtered");
  });

  it("allows unknown changed paths per YAML policy", async () => {
    const result = await selectChangedPaths({
      repository: { full_name: "rodkisten/photointel" },
      workflow_run: { event: "workflow_dispatch", pull_requests: [] },
    }, {} as Env);
    assert.equal(result.allowed, true);
  });
});
