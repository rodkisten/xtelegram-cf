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
    file: Blob;
    filename: string;
    contentType: string;
  },
): Promise<TelegramApiResult<TelegramMessage>> {
  const { method, field } = getTelegramMethod(options.mediaType);
  const form = new FormData();

  form.set("chat_id", options.chatId);
  form.set(field, options.file, options.filename);

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

  const rawResponse = await response.text();
  let result: TelegramApiResult<T>;

  try {
    result = rawResponse
      ? (JSON.parse(rawResponse) as TelegramApiResult<T>)
      : ({ ok: response.ok } as TelegramApiResult<T>);
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        `Telegram returned a non-JSON response for ${method}.`,
        `HTTP status: ${response.status} ${response.statusText}`.trim(),
        rawResponse ? `Response body: ${rawResponse.slice(0, 4000)}` : "Response body was empty.",
      ].join(" ") ,
    };
  }

  if (!response.ok || !result.ok) {
    return {
      ...result,
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        result.description || `Telegram rejected ${method}.`,
        `HTTP ${response.status}${result.error_code ? ` / Telegram error ${result.error_code}` : ""}.`,
      ].join(" ") ,
    };
  }

  return {
    ...result,
    httpStatus: response.status,
    requestMethod: method,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
