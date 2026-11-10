import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestDb } from "./helpers/d1";
import type { Env } from "../src/types";
import {
  availableProviders,
  notifyOnePublishedX,
  publisherLimits,
  reserveXPostingBudget,
  runOneDuePublisher,
} from "../src/services/x-publish-pipeline.ts";
import { signedMediaUrl, serveSignedMedia } from "../src/services/x-publish-media.ts";
import { initializeDirectXMedia, finishDirectXMedia } from "../src/services/x-publish-direct.ts";
import type { XRepostItem } from "../src/services/x-repost-queue.ts";

const Q1 = "12345678-abcd-1234-abcd-123456789abc";
const Q2 = "12345678-abcd-1234-abcd-123456789abd";

function fixture(overrides: Record<string, unknown> = {}) {
  const { db, sqlite } = createTestDb();
  const env = {
    RELAY_DB: db,
    X_PUBLISH_ENABLED: "true",
    X_PUBLISH_AUTO_ENABLED: "false",
    X_PUBLISH_MEDIA_SIGNING_KEY: "test-signing-key-that-is-more-than-32-characters-long",
    X_PUBLISH_MEDIA_ORIGIN: "https://xtelegram-cf.migos.club",
    BUFFER_ENABLED: "true",
    BUFFER_API_KEY: "test-buffer-key",
    BUFFER_X_CHANNEL_ID: "test-channel",
    X_REPOST_MEDIA: {
      async get() {
        return {
          size: 4,
          body: new Blob(["mp4!"]).stream(),
          async arrayBuffer() { return new TextEncoder().encode("mp4!").buffer; },
        };
      },
      async head() { return { size: 4 }; },
    },
    ...overrides,
  } as unknown as Env;
  return { db, sqlite, env };
}

async function addVideo(db: D1Database, id = Q1, suffix = "123456") {
  await db.prepare(
    "INSERT INTO x_repost_queue(id,source_key,source_url,caption,media_object_key,scheduled_at) " +
      "VALUES(?,?,?,?,?,?)",
  ).bind(
    id, "x:" + suffix, "https://x.com/author/status/" + suffix,
    "<b>@author</b> #video", "x-repost/" + id + ".mp4",
    Math.floor(Date.now()/1000) - 100,
  ).run();
}

describe("X publisher: shared safe limits and provider selection", () => {
  it("caps configured values at 40/24h, 2/h and min 45-minute spacing", () => {
    const { env, sqlite } = fixture({
      X_PUBLISH_MAX_PER_24H: "999", X_PUBLISH_MAX_PER_HOUR: "99",
      X_PUBLISH_MIN_GAP_SECONDS: "1",
    });
    assert.deepEqual(publisherLimits(env), { day: 40, hour: 2, gap: 2700 });
    sqlite.close();
  });
  it("skips paid fallback until separately enabled", () => {
    const { env, sqlite } = fixture({
      ZERNIO_ENABLED: "true", ZERNIO_API_KEY: "fake",
      ZERNIO_TWITTER_ACCOUNT_ID: "account1234",
      X_API_ENABLED: "true", X_API_USER_ACCESS_TOKEN: "fake",
    });
    assert.deepEqual(availableProviders(env), ["buffer"]);
    (env as any).X_PUBLISH_ENABLE_PAID_FALLBACK = "true";
    assert.deepEqual(availableProviders(env), ["buffer","zernio","x"]);
    sqlite.close();
  });
  it("uses a single 24h and hourly budget shared across all providers", async () => {
    const { env, sqlite, db } = fixture();
    await addVideo(db, Q1);
    await addVideo(db, Q2, "123457");
    assert.equal(await reserveXPostingBudget(env, Q1), true);
    assert.equal(await reserveXPostingBudget(env, Q1), true);
    assert.equal(await reserveXPostingBudget(env, Q2), false);
    sqlite.close();
  });
});

describe("X publisher: signed temporary public media URL", () => {
  it("verifies signature and expiry without exposing Relay bearer token", async () => {
    const { env, db, sqlite } = fixture();
    await addVideo(db);
    const link = await signedMediaUrl(env, Q1);
    assert.ok(link.startsWith("https://xtelegram-cf.migos.club/x/repost/public-media/"));
    assert.ok(!link.includes("test-buffer-key"));
    const good = await serveSignedMedia(new Request(link), env);
    assert.equal(good.status, 200);
    assert.equal(good.headers.get("Content-Type"), "video/mp4");
    const altered = new URL(link);
    altered.searchParams.set("sig", "a".repeat(64));
    assert.equal((await serveSignedMedia(new Request(altered), env)).status, 403);
    altered.searchParams.set("expires", "1");
    assert.equal((await serveSignedMedia(new Request(altered), env)).status, 403);
    sqlite.close();
  });
});

describe("X publisher: automatic Buffer and D1 deduplication", () => {
  it("publishes once and records publication only after provider says sent", async () => {
    const { env, db, sqlite } = fixture();
    await addVideo(db);
    const previous = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(url), "https://api.buffer.com");
      requests++;
      const body = JSON.parse(String(init?.body));
      assert.match(body.query, /mutation RodXCreate/);
      assert.equal(body.variables.input.mode, "shareNow");
      assert.match(body.variables.input.text, /@\/author/);
      assert.match(body.variables.input.assets[0].video.url, /public-media/);
      return Response.json({
        data: { createPost: { post: {
          id: "buffer-post-1", status: "sent",
          externalLink: "https://x.com/author/status/987654321",
        } } },
      });
    }) as typeof fetch;
    try {
      await runOneDuePublisher(env);
      const job = await db.prepare("SELECT * FROM x_publish_jobs WHERE queue_id=?")
        .bind(Q1).first<{ status: string; provider: string; remote_id: string }>();
      assert.equal(job?.provider, "buffer");
      assert.equal(job?.status, "published");
      assert.equal(job?.remote_id, "buffer-post-1");
      const source = await db.prepare("SELECT * FROM x_repost_queue WHERE id=?")
        .bind(Q1).first<{ status: string; post_url: string }>();
      assert.equal(source?.status, "posted");
      assert.equal(source?.post_url, "https://x.com/author/status/987654321");
      await runOneDuePublisher(env);
      assert.equal(requests, 1, "duplicate cron must not create another post");
    } finally {
      globalThis.fetch = previous;
      sqlite.close();
    }
  });
  it("honors HTTP 429 without switching to paid providers", async () => {
    const { env, db, sqlite } = fixture({
      X_PUBLISH_ENABLE_PAID_FALLBACK: "true",
      ZERNIO_ENABLED: "true", ZERNIO_API_KEY: "fake",
      ZERNIO_TWITTER_ACCOUNT_ID: "account1234",
    });
    await addVideo(db);
    const original = globalThis.fetch;
    let buffer = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) !== "https://api.buffer.com") throw new Error("Unexpected fallback");
      buffer++;
      return new Response("{}", { status: 429, headers: { "Retry-After": "3600" } });
    }) as typeof fetch;
    try {
      await runOneDuePublisher(env);
      const job = await db.prepare("SELECT * FROM x_publish_jobs WHERE queue_id=?")
        .bind(Q1).first<{ status: string; tried: string }>();
      assert.equal(job?.status, "ready");
      assert.equal(job?.tried, "");
      await runOneDuePublisher(env);
      assert.equal(buffer, 1);
    } finally {
      globalThis.fetch = original;
      sqlite.close();
    }
  });
});

describe("X publisher: Telegram publication confirmation", () => {
  it("notifies once only after status is posted", async () => {
    const { env, db, sqlite } = fixture({
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      X_PUBLISH_NOTIFY_CHAT_ID: "-10012345678:42",
      X_PUBLISH_NOTIFY_ENABLED: "true",
    });
    await addVideo(db);
    const previous = globalThis.fetch;
    const sent: any[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      assert.match(String(url), /api\.telegram\.org\/bot/);
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 10 } });
    }) as typeof fetch;
    try {
      await notifyOnePublishedX(env);
      assert.equal(sent.length, 0, "a queued video is not yet published");
      await db.prepare(
        "UPDATE x_repost_queue SET status='posted',posted_at=unixepoch(), " +
          "post_url='https://x.com/i/status/999' WHERE id=?",
      ).bind(Q1).run();
      await notifyOnePublishedX(env);
      await notifyOnePublishedX(env);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].message_thread_id, 42);
      assert.match(sent[0].text, /Vídeo publicado no X/);
      const note = await db.prepare("SELECT status FROM x_publish_notifications WHERE queue_id=?")
        .bind(Q1).first<{status:string}>();
      assert.equal(note?.status, "sent");
    } finally {
      globalThis.fetch = previous;
      sqlite.close();
    }
  });
});

describe("X direct API video flow", () => {
  it("uploads media in chunks before creating a tweet", async () => {
    const { env, db, sqlite } = fixture({
      X_API_ENABLED: "true", X_API_USER_ACCESS_TOKEN: "test-user-token",
    });
    await addVideo(db);
    const item = await db.prepare("SELECT * FROM x_repost_queue WHERE id=?")
      .bind(Q1).first<XRepostItem>();
    assert.ok(item);
    const calls: string[] = [];
    const old = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith("/initialize")) {
        return Response.json({ data: { id: "111111" } });
      }
      if (path.endsWith("/append")) return Response.json({});
      if (path.endsWith("/finalize")) return Response.json({ data: { id: "111111" } });
      if (path.includes("?command=STATUS")) {
        return Response.json({ data: { processing_info: { state: "succeeded" } } });
      }
      if (path.endsWith("/2/tweets")) {
        assert.match(String(init?.body), /"media_ids":\["111111"\]/);
        return Response.json({ data: { id: "222222" } }, { status: 201 });
      }
      throw new Error("unexpected provider call");
    }) as typeof fetch;
    try {
      const first = await initializeDirectXMedia(env, item!);
      assert.equal(first.kind, "processing");
      assert.equal(calls.filter(x=>x.includes("/2/tweets")).length, 0);
      if (first.kind !== "processing") return;
      let claimed = 0;
      const second = await finishDirectXMedia(env, first.mediaId, item!, async () => {
        claimed++;
        return true;
      });
      assert.equal(second.kind, "accepted");
      assert.equal(claimed, 1);
      assert.equal(calls.filter(x=>x.endsWith("/2/tweets")).length, 1);
    } finally {
      globalThis.fetch = old;
      sqlite.close();
    }
  });
});
