import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTelegramUpdateCandidates,
  mergeChannelRegistryCandidates,
} from "../src/services/channel-registry-utils.ts";

describe("Telegram channel registry", () => {
  it("extracts forum topic names from Telegram API updates", () => {
    const candidates = extractTelegramUpdateCandidates({
      update_id: 123,
      message: {
        message_id: 10,
        date: 1_755_777_600,
        message_thread_id: 65,
        chat: {
          id: -1003991698263,
          type: "supergroup",
          title: "KISTEN SAVED - IMAGES",
        },
        forum_topic_created: {
          name: "Insta HOT",
        },
      },
    });

    assert.deepEqual(candidates, [{
      key: "-1003991698263:65",
      channelId: "-1003991698263",
      messageThreadId: 65,
      name: "Insta HOT",
      title: "KISTEN SAVED - IMAGES",
      username: null,
      source: "telegram_api",
      firstSeenAt: "2025-08-21T12:00:00.000Z",
      lastSeenAt: "2025-08-21T12:00:00.000Z",
    }]);
  });

  it("deduplicates by channel_id:message_thread_id and preserves richer metadata", () => {
    const merged = mergeChannelRegistryCandidates([
      {
        key: "-1003991698263:65",
        channelId: "-1003991698263",
        messageThreadId: 65,
        source: "configured",
      },
      {
        key: "-1003991698263:65",
        channelId: "-1003991698263",
        messageThreadId: 65,
        name: "Insta HOT",
        title: "KISTEN SAVED - IMAGES",
        username: "@kisten",
        source: "telegram_api",
      },
      {
        key: "-1003991698263:65",
        channelId: "-1003991698263",
        messageThreadId: 65,
        title: "Older cached title",
        source: "cached",
      },
    ]);

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0], {
      key: "-1003991698263:65",
      channelId: "-1003991698263",
      messageThreadId: 65,
      name: "Insta HOT",
      title: "KISTEN SAVED - IMAGES",
      username: "@kisten",
      source: "configured",
      sources: ["configured", "telegram_api", "cached"],
      firstSeenAt: null,
      lastSeenAt: null,
    });
  });
});
