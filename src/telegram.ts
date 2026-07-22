import type {
  Env,
  MediaType,
  ParseMode,
  TelegramApiResult,
  TelegramMessage,
} from "./types";

interface TelegramSendBase {
  botToken: string;
  chatId: string;
  caption: string;
  parseMode: ParseMode | null;
  mediaType: MediaType;
}

export async function sendTelegramUrl(
  options: TelegramSendBase & {
    mediaUrl: string;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const payload: Record<string, unknown> = {
    chat_id: options.chatId,
    [field]: options.mediaUrl,
  };

  if (options.mediaType === "video") {
    payload.supports_streaming = true;
  }

  if (options.caption) {
    payload.caption = options.caption;
  }

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  return requestTelegram(options.botToken, method, {
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function sendTelegramUpload(
  options: TelegramSendBase & {
    bytes: Uint8Array;
    filename: string;
    contentType: string;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const form = new FormData();
  const blob = new Blob([options.bytes], {
    type: options.contentType || "application/octet-stream",
  });

  form.set("chat_id", options.chatId);
  form.set(field, blob, options.filename);

  if (options.mediaType === "video") {
    form.set("supports_streaming", "true");
  }

  if (options.caption) {
    form.set("caption", options.caption);
  }

  if (options.parseMode) {
    form.set("parse_mode", options.parseMode);
  }

  return requestTelegram(options.botToken, method, {
    body: form,
  });
}

export function validateEnvironment(env: Env): string | null {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "Missing TELEGRAM_BOT_TOKEN secret";
  }

  if (!env.TELEGRAM_CHAT_ID) {
    return "Missing TELEGRAM_CHAT_ID secret";
  }

  if (!env.RELAY_TOKEN) {
    return "Missing RELAY_TOKEN secret";
  }

  return null;
}

function getTelegramMethod(mediaType: MediaType): {
  method: "sendVideo" | "sendAudio" | "sendDocument";
  field: "video" | "audio" | "document";
} {
  switch (mediaType) {
    case "audio":
      return {
        method: "sendAudio",
        field: "audio",
      };
    case "document":
      return {
        method: "sendDocument",
        field: "document",
      };
    case "video":
    default:
      return {
        method: "sendVideo",
        field: "video",
      };
  }
}

async function requestTelegram<T>(
  botToken: string,
  method: string,
  init: RequestInit,
): Promise<TelegramApiResult<T>> {
  const endpoint = `https://api.telegram.org/bot${botToken}/${method}`;
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      ...init,
    });
  } catch (error) {
    return {
      ok: false,
      description: getErrorMessage(error),
    };
  }

  let result: TelegramApiResult<T>;

  try {
    result = (await response.json()) as TelegramApiResult<T>;
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      description: `Telegram returned HTTP ${response.status}`,
    };
  }

  if (!response.ok || !result.ok) {
    return {
      ...result,
      ok: false,
      httpStatus: response.status,
      description:
        result.description ||
        `Telegram returned HTTP ${response.status}`,
    };
  }

  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
