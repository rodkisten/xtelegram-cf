import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateTelegramMessageLinkFields,
  buildStoredTelegramMessageLinkFields,
  buildTelegramMessageLinkFields,
} from "../src/lib/telegram-message-links.ts";

describe("Telegram message links", () => {
  it("builds public message URLs and deep links", () => {
    const result = buildTelegramMessageLinkFields([{
      requestedChatId: "@rodchannel",
      telegramChatId: -1001234567890,
      messageId: 321,
    }]);

    assert.deepEqual(result, {
      message_id: 321,
      message_url: "https://t.me/rodchannel/321",
      message_deeplink: "tg://resolve?domain=rodchannel&post=321",
      message_ids: [321],
      message_urls: ["https://t.me/rodchannel/321"],
      message_deeplinks: ["tg://resolve?domain=rodchannel&post=321"],
    });
  });

  it("builds private supergroup topic links from Bot API chat ids", () => {
    const result = buildTelegramMessageLinkFields([{
      requestedChatId: "-1001234567890:65",
      telegramChatId: -1001234567890,
      messageId: 987,
    }]);

    assert.equal(result.message_url, "https://t.me/c/1234567890/987?thread=65");
    assert.equal(
      result.message_deeplink,
      "tg://privatepost?channel=1234567890&post=987&thread=65",
    );
  });

  it("marks album item links as single and preserves every id", () => {
    const result = buildTelegramMessageLinkFields([
      {
        requestedChatId: "-1001234567890",
        telegramChatId: -1001234567890,
        messageId: 10,
        single: true,
      },
      {
        requestedChatId: "-1001234567890",
        telegramChatId: -1001234567890,
        messageId: 11,
        single: true,
      },
    ]);

    assert.deepEqual(result.message_ids, [10, 11]);
    assert.deepEqual(result.message_urls, [
      "https://t.me/c/1234567890/10?single",
      "https://t.me/c/1234567890/11?single",
    ]);
  });

  it("reconstructs already-sent links from D1 delivery history", () => {
    const result = buildStoredTelegramMessageLinkFields([{
      channelId: "-1001234567890:42",
      telegramChatId: "-1001234567890",
      messageThreadId: 42,
      firstMessageIds: [100],
      lastMessageIds: [200, 201],
    }]);

    assert.equal(result.message_id, 200);
    assert.equal(result.message_url, "https://t.me/c/1234567890/200?single&thread=42");
    assert.deepEqual(result.message_ids, [200, 201]);
  });

  it("aggregates flat child responses for resolve-and-send and batch", () => {
    const result = aggregateTelegramMessageLinkFields([
      {
        message_id: 1,
        message_url: "https://t.me/c/1/1",
        message_deeplink: "tg://privatepost?channel=1&post=1",
        message_ids: [1, 2],
        message_urls: ["https://t.me/c/1/1", "https://t.me/c/1/2"],
        message_deeplinks: [
          "tg://privatepost?channel=1&post=1",
          "tg://privatepost?channel=1&post=2",
        ],
      },
      {
        message_id: 3,
        message_url: "https://t.me/example/3",
        message_deeplink: "tg://resolve?domain=example&post=3",
        message_ids: [3],
        message_urls: ["https://t.me/example/3"],
        message_deeplinks: ["tg://resolve?domain=example&post=3"],
      },
    ]);

    assert.equal(result.message_id, 1);
    assert.deepEqual(result.message_ids, [1, 2, 3]);
    assert.equal(result.message_urls.length, 3);
    assert.equal(result.message_deeplinks.length, 3);
  });
});
