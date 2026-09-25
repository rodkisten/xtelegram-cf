import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { DeliveryHistoryRecord } from "../src/db.ts";
import { copyStoredTelegramDeliveries } from "../src/services/telegram-forward.ts";
import { validateRequestBody } from "../src/validation/send.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stored(overrides: Partial<DeliveryHistoryRecord> = {}): DeliveryHistoryRecord {
  return {
    channelId: "-1003991698263:65",
    telegramChatId: "-1003991698263",
    messageThreadId: 65,
    telegramChatTitle: "Archive",
    firstMessageIds: [100],
    lastMessageIds: [200],
    sendCount: 2,
    firstSentAt: "2026-09-01T00:00:00.000Z",
    lastSentAt: "2026-09-02T00:00:00.000Z",
    presentationJson: null,
    presentationUpdatedAt: null,
    ...overrides,
  };
}

describe("force=forward Telegram copy flow", () => {
  it("normalizes force=forward without changing force=true resend semantics", () => {
    const forwarded = validateRequestBody({
      mediaUrl: "https://example.test/video.mp4",
      mediaType: "video",
      channel: "-1003991698263:65",
      force: "forward",
    });
    assert.equal(forwarded.ok, true);
    if (!forwarded.ok) return;
    assert.equal(forwarded.value.force, true);
    assert.equal(forwarded.value.forceMode, "forward");

    const resent = validateRequestBody({
      mediaUrl: "https://example.test/video.mp4",
      mediaType: "video",
      channel: "-1003991698263:65",
      force: true,
    });
    assert.equal(resent.ok, true);
    if (!resent.ok) return;
    assert.equal(resent.value.force, true);
    assert.equal(resent.value.forceMode, "resend");
  });

  it("copies one stored message with the current caption and topic", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      assert.match(url, /\/copyMessage$/);
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.chat_id, "-1003991698263");
      assert.equal(body.message_thread_id, 65);
      assert.equal(body.from_chat_id, "-1003991698263");
      assert.equal(body.message_id, 200);
      assert.equal(body.caption, "Caption atual");
      assert.equal(body.parse_mode, "HTML");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 300 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const [result] = await copyStoredTelegramDeliveries({
      botToken: "test",
      channels: ["-1003991698263:65"],
      storedDeliveries: [stored()],
      caption: "Caption atual",
      parseMode: "HTML",
    });

    assert.equal(result?.ok, true);
    assert.deepEqual(result?.sourceMessageIds, [200]);
    assert.deepEqual(result?.messageIds, [300]);
    assert.equal(result?.method, "copyMessage");
    assert.equal(result?.captionApplied, true);
  });

  it("preserves an album with copyMessages and applies the current caption to the new first message", async () => {
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = url.split("/").pop() || "";
      methods.push(method);
      const body = JSON.parse(String(init?.body || "{}"));

      if (method === "copyMessages") {
        assert.deepEqual(body.message_ids, [201, 202, 203]);
        assert.equal(body.remove_caption, true);
        assert.equal(body.message_thread_id, 65);
        return new Response(JSON.stringify({
          ok: true,
          result: [{ message_id: 401 }, { message_id: 402 }, { message_id: 403 }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }

      assert.equal(method, "editMessageCaption");
      assert.equal(body.message_id, 401);
      assert.equal(body.caption, "Legenda nova do álbum");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 401 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const [result] = await copyStoredTelegramDeliveries({
      botToken: "test",
      channels: ["-1003991698263:65"],
      storedDeliveries: [stored({ lastMessageIds: [203, 201, 202] })],
      caption: "Legenda nova do álbum",
      parseMode: null,
    });

    assert.deepEqual(methods, ["copyMessages", "editMessageCaption"]);
    assert.equal(result?.ok, true);
    assert.deepEqual(result?.sourceMessageIds, [201, 202, 203]);
    assert.deepEqual(result?.messageIds, [401, 402, 403]);
    assert.equal(result?.method, "copyMessages+editMessageCaption");
  });

  it("does not silently fall back to a media re-upload when no stored source exists", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("unexpected Telegram request");
    };

    const [result] = await copyStoredTelegramDeliveries({
      botToken: "test",
      channels: ["-1003991698263:65"],
      storedDeliveries: [],
      caption: "Caption atual",
      parseMode: null,
    });

    assert.equal(calls, 0);
    assert.equal(result?.ok, false);
    assert.equal(result?.httpStatus, 409);
    assert.deepEqual(result?.messageIds, []);
  });
});
