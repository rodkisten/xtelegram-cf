import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeliveryConflict,
  getAlreadySentDeliveryDetails,
  type DeliveryPlan,
} from "../src/services/delivery-plan.ts";

/**
 * Builds the smallest delivery plan needed to exercise duplicate formatting.
 * Keeping this fixture local makes the test independent from D1 and Telegram.
 */
function createDuplicatePlan(): DeliveryPlan {
  return {
    db: {} as D1Database,
    identity: {
      key: "twitter:123",
      provider: "twitter",
      providerMediaId: "123",
      canonicalUrl: "https://x.com/example/status/123",
      legacyKeys: [],
    },
    claim: {
      requestId: "request-1",
      requested: ["-1001", "-1002"],
      acquired: [],
      alreadySent: ["-1001"],
      inProgress: [],
      alreadySentDeliveries: [
        {
          channelId: "-1001",
          telegramChatId: "-1001",
          messageThreadId: 65,
          telegramChatTitle: "KISTEN SAVED - IMAGES",
          firstMessageIds: [42],
          lastMessageIds: [84],
          presentationJson: null,
          presentationUpdatedAt: null,
          sendCount: 2,
          firstSentAt: "2026-08-20T10:00:00.000Z",
          lastSentAt: "2026-08-21T10:00:00.000Z",
        },
      ],
      queryCount: 4,
    },
    requestedChannels: ["-1001", "-1002"],
    channelsToSend: [],
    skippedContentDuplicates: [],
    contentDuplicates: [],
    skippedAlreadySent: [{ channelId: "-1001", reason: "already_sent" }],
    skippedInProgress: [],
    identityAliasQueries: 0,
    releaseChannels: new Set(),
    force: false,
  };
}

describe("Telegram duplicate delivery details", () => {
  it("returns the existing channel and Telegram message IDs", () => {
    const plan = createDuplicatePlan();
    assert.deepEqual(getAlreadySentDeliveryDetails(plan), [
      {
        message_id: 84,
        message_url: "https://t.me/c/1/84?thread=65",
        message_deeplink: "tg://privatepost?channel=1&post=84&thread=65",
        message_ids: [84],
        message_urls: ["https://t.me/c/1/84?thread=65"],
        message_deeplinks: ["tg://privatepost?channel=1&post=84&thread=65"],
        channelId: "-1001",
        telegramChatId: "-1001",
        messageThreadId: 65,
        telegramChatTitle: "KISTEN SAVED - IMAGES",
        messageIds: [84],
        firstMessageIds: [42],
        lastMessageIds: [84],
        sendCount: 2,
        firstSentAt: "2026-08-20T10:00:00.000Z",
        lastSentAt: "2026-08-21T10:00:00.000Z",
      },
    ]);
  });

  it("includes duplicate details in the 409 conflict payload", () => {
    const conflict = buildDeliveryConflict(createDuplicatePlan());

    assert.deepEqual(conflict.duplicates, [
      {
        message_id: 84,
        message_url: "https://t.me/c/1/84?thread=65",
        message_deeplink: "tg://privatepost?channel=1&post=84&thread=65",
        message_ids: [84],
        message_urls: ["https://t.me/c/1/84?thread=65"],
        message_deeplinks: ["tg://privatepost?channel=1&post=84&thread=65"],
        channelId: "-1001",
        telegramChatId: "-1001",
        messageThreadId: 65,
        telegramChatTitle: "KISTEN SAVED - IMAGES",
        messageIds: [84],
        firstMessageIds: [42],
        lastMessageIds: [84],
        sendCount: 2,
        firstSentAt: "2026-08-20T10:00:00.000Z",
        lastSentAt: "2026-08-21T10:00:00.000Z",
      },
    ]);
    assert.equal(conflict.message_id, 84);
    assert.equal(conflict.message_url, "https://t.me/c/1/84?thread=65");
    assert.equal(conflict.message_deeplink, "tg://privatepost?channel=1&post=84&thread=65");
  });
});
