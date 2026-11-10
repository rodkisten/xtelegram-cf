import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestDb } from "./helpers/d1";
import {
  getZernioSubmission,
  submitZernioVideo,
} from "../src/services/zernio-publisher.ts";
import type { Env } from "../src/types";

function fixture() {
  const database = createTestDb();
  const queueId = "12345678-abcd-1234-abcd-123456789abc";
  const env = {
    RELAY_DB: database.db,
    ZERNIO_ENABLED: "true",
    ZERNIO_API_KEY: "fake-unit-test-key",
    ZERNIO_TWITTER_ACCOUNT_ID: "account1234",
    X_REPOST_MEDIA: {
      async get() {
        return { size: 4, body: new Blob(["mp4!"]).stream() };
      },
    },
  } as unknown as Env;
  return { ...database, env, queueId };
}

async function queueVideo(db: D1Database, queueId: string): Promise<void> {
  await db.prepare(
    "INSERT INTO x_repost_queue " +
      "(id,source_key,source_url,caption,media_object_key,scheduled_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(queueId, "x:123456", "https://x.com/author/status/123456",
    "<b>@author</b> #video", "x-repost/" + queueId + ".mp4",
    Math.floor(Date.now() / 1000) - 60).run();
}

describe("Zernio D1 idempotency and publishing", () => {
  it("uploads once, creates once, confirms X and never resubmits", async () => {
    const { db, sqlite, env, queueId } = fixture();
    await queueVideo(db, queueId);
    const seen: Array<{ url: string; method: string; key?: string; body?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({
        url,
        method: init?.method || "GET",
        key: new Headers(init?.headers).get("Idempotency-Key") || undefined,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/media/presign")) {
        return Response.json({
          uploadUrl: "https://upload.example.org/part",
          publicUrl: "https://media.zernio.com/temp/unit-test.mp4",
        });
      }
      if (url.startsWith("https://upload.example.org/")) {
        return new Response("", { status: 200 });
      }
      if (url.endsWith("/posts")) {
        return Response.json({
          post: {
            _id: "provider-post-1", status: "published",
            platforms: [{
              platform: "twitter", status: "published",
              platformPostUrl: "https://x.com/test/status/99999",
            }],
          },
        }, { status: 201 });
      }
      throw new Error("unexpected URL");
    }) as typeof fetch;
    try {
      const result = await submitZernioVideo(env, queueId, "twitter");
      assert.equal(result.status, "published");
      assert.equal(result.remote_post_id, "provider-post-1");
      assert.equal(seen.length, 3);
      assert.ok(seen[2].key?.includes(queueId));
      assert.match(seen[2].body || "", /"type":"video"/);
      assert.match(seen[2].body || "", /@\/author/);
      const row = await db.prepare("SELECT status, post_url FROM x_repost_queue WHERE id=?")
        .bind(queueId).first<{ status: string; post_url: string }>();
      assert.equal(row?.status, "posted");
      assert.equal(row?.post_url, "https://x.com/test/status/99999");
      await assert.rejects(() => submitZernioVideo(env, queueId, "twitter"));
      assert.equal(seen.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
      sqlite.close();
    }
  });
  it("keeps an uncertain write quarantined instead of attempting a duplicate", async () => {
    const { db, sqlite, env, queueId } = fixture();
    await queueVideo(db, queueId);
    let posts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/media/presign")) {
        return Response.json({
          uploadUrl: "https://upload.example.org/part",
          publicUrl: "https://media.zernio.com/temp/unit-test.mp4",
        });
      }
      if (url.startsWith("https://upload.example.org/")) return new Response("", { status: 200 });
      if (url.endsWith("/posts")) {
        posts++;
        throw new Error("timeout after provider may have accepted");
      }
      throw new Error("unexpected URL");
    }) as typeof fetch;
    try {
      const first = await submitZernioVideo(env, queueId, "twitter");
      assert.equal(first.status, "uncertain");
      const again = await submitZernioVideo(env, queueId, "twitter");
      assert.equal(again.status, "uncertain");
      assert.equal(posts, 1);
      const row = await getZernioSubmission(env, queueId, "twitter");
      assert.equal(row?.error_code, "network_or_runtime_error");
      assert.equal((await db.prepare("SELECT status FROM x_repost_queue WHERE id=?")
        .bind(queueId).first<{ status: string }>())?.status, "queued");
    } finally {
      globalThis.fetch = originalFetch;
      sqlite.close();
    }
  });
});
