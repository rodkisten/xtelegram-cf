import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sendTelegramMediaGroupUrl,
  sendTelegramUrl,
} from "../src/telegram.ts";

describe("Telegram video geometry gate", () => {
  it("refuses a single video without width/height before making a Bot API request", async () => {
    const result = await sendTelegramUrl({
      botToken: "not-used",
      chatId: "1",
      caption: "",
      parseMode: null,
      mediaType: "video",
      mediaUrl: "https://example.com/video.mp4",
      videoMetadata: null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 422);
    assert.match(result.description || "", /width\/height/i);
  });

  it("refuses a media group when any video lacks width/height", async () => {
    const result = await sendTelegramMediaGroupUrl({
      botToken: "not-used",
      chatId: "1",
      caption: "",
      parseMode: null,
      items: [
        {
          mediaUrl: "https://example.com/video.mp4",
          mediaType: "video",
          videoMetadata: null,
        },
        {
          mediaUrl: "https://example.com/photo.jpg",
          mediaType: "photo",
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 422);
    assert.match(result.description || "", /missing valid width\/height/i);
  });
});
