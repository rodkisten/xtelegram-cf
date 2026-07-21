import {
  Container,
  getRandom,
} from "@cloudflare/containers";

const MAX_PLAYLIST_DEPTH = 8;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_CHANNELS = 8;
const MAX_CAPTION_LENGTH = 1000;
const MAX_TELEGRAM_VIDEO_BYTES = 49_000_000;
const FFMPEG_POOL_SIZE = 3;
const FFMPEG_TIMEOUT_MS = 15 * 60_000;
const TELEGRAM_TIMEOUT_MS = 3 * 60_000;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

const ALLOWED_PARSE_MODES = new Set([
  "HTML",
  "MarkdownV2",
]);

interface Env {
  FFMPEG_CONTAINER: DurableObjectNamespace<FfmpegContainer>;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  RELAY_TOKEN: string;
}

interface MediaHeaders {
  [key: string]: string;
}

interface MediaMetadata {
  [key: string]: string;
}

interface Resolution {
  width: number;
  height: number;
  label: string;
}

interface HlsVariant {
  url: string;
  bitrate: number;
  peakBitrate: number;
  resolution: Resolution | null;
  width: number;
  height: number;
  codecs: string;
  audioGroup: string;
}

interface HlsAudioRendition {
  groupId: string;
  name: string;
  url: string | null;
  isDefault: boolean;
  autoSelect: boolean;
}

interface HlsMasterPlaylist {
  type: "master";
  variants: HlsVariant[];
  audioRenditions: HlsAudioRendition[];
}

interface HlsMediaPlaylist {
  type: "media";
}

type ParsedHlsPlaylist =
  | HlsMasterPlaylist
  | HlsMediaPlaylist;

interface MediaResolutionState {
  depth: number;
  visited: Set<string>;
  headers: MediaHeaders;
  hlsHint: boolean;
}

interface ResolvedMediaSource {
  videoUrl: string;
  audioUrl: string | null;
  contentType: string;
  sourceKind: "file" | "hls";
  selectedBitrate: number | null;
  selectedResolution: string | null;
  playlistDepth: number;
}

interface ValidatedInput {
  mediaUrl: URL;
  sourceUrl: string | null;
  frameUrl: string | null;
  provider: string;
  title: string;
  text: string;
  caption: string;
  parseMode: "HTML" | "MarkdownV2" | null;
  mediaHeaders: MediaHeaders;
  metadata: MediaMetadata | null;
  channels: string[];
  hlsHint: boolean;
}

interface ValidationSuccess {
  ok: true;
  value: ValidatedInput;
}

interface ValidationFailure {
  ok: false;
  error: string;
}

type ValidationResult =
  | ValidationSuccess
  | ValidationFailure;

interface ContainerJob {
  videoUrl: string;
  audioUrl: string | null;
  headers: MediaHeaders;
  channels: string[];
  caption: string;
  parseMode: "HTML" | "MarkdownV2" | null;
  sourceKind: "file" | "hls";
  selectedBitrate: number | null;
  selectedResolution: string | null;
  provider: string;
}

interface TelegramUploadResult {
  ok: boolean;
  chatId: string;
  messageId: number | null;
  description: string | null;
  response: unknown;
}

interface ContainerJobResult {
  ok: boolean;
  outputBytes: number;
  durationSeconds: number | null;
  videoBitrate: number | null;
  uploads: TelegramUploadResult[];
}

interface ProcessOutput {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
}

interface ProcessLike {
  kill(): void;
  output(): Promise<ProcessOutput>;
}

export class FfmpegContainer extends Container<Env> {
  sleepAfter = "5m";
  enableInternet = true;

  async transcodeAndSend(
    job: ContainerJob,
  ): Promise<ContainerJobResult> {
    if (!this.ctx.container.running) {
      await this.start();
    }

    const jobId = crypto.randomUUID().replace(/-/g, "");
    const outputPath = `/tmp/aio-${jobId}.mp4`;

    try {
      const durationSeconds = await this.probeDuration(job);
      let videoBitrate = calculateVideoBitrate(durationSeconds);

      await this.transcodeToMp4(
        job,
        outputPath,
        videoBitrate,
      );

      let outputBytes = await this.getFileSize(outputPath);

      for (
        let attempt = 0;
        outputBytes > MAX_TELEGRAM_VIDEO_BYTES &&
        attempt < 2;
        attempt += 1
      ) {
        const baseBitrate =
          videoBitrate ||
          2_000_000;
        const ratio =
          MAX_TELEGRAM_VIDEO_BYTES /
          outputBytes;

        videoBitrate = Math.max(
          100_000,
          Math.floor(
            baseBitrate *
            ratio *
            0.88,
          ),
        );

        await this.transcodeToMp4(
          job,
          outputPath,
          videoBitrate,
        );

        outputBytes =
          await this.getFileSize(
            outputPath,
          );
      }

      if (
        outputBytes >
        MAX_TELEGRAM_VIDEO_BYTES
      ) {
        throw new Error(
          [
            "FFmpeg could not compress the MP4 below the Telegram limit.",
            `Output bytes: ${outputBytes}.`,
          ].join(" "),
        );
      }

      const uploads = [];

      for (const chatId of job.channels) {
        const result = await this.uploadVideoToTelegram(
          outputPath,
          chatId,
          job.caption,
          job.parseMode,
        );

        uploads.push(result);
      }

      return {
        ok: uploads.every((item) => item.ok),
        outputBytes,
        durationSeconds,
        videoBitrate,
        uploads,
      };
    } finally {
      await this.removeFile(outputPath);
    }
  }

  private buildInputHeaderArgs(
    headers: MediaHeaders,
  ): string[] {
    const lines = Object.entries(headers)
      .map(([key, value]) => {
        return `${key}: ${value}`;
      })
      .join("\r\n");

    return lines
      ? ["-headers", `${lines}\r\n`]
      : [];
  }

  private async probeDuration(
    job: ContainerJob,
  ): Promise<number | null> {
    const args = [
      "ffprobe",
      "-v",
      "error",
      ...this.buildInputHeaderArgs(job.headers),
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      job.videoUrl,
    ];

    const output = await this.runProcess(
      args,
      90_000,
    );

    if (output.exitCode !== 0) {
      return null;
    }

    const value = Number(
      new TextDecoder().decode(output.stdout).trim(),
    );

    return Number.isFinite(value) && value > 0
      ? value
      : null;
  }

  private async transcodeToMp4(
    job: ContainerJob,
    outputPath: string,
    videoBitrate: number | null,
  ): Promise<void> {
    const args = [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      ...this.buildInputHeaderArgs(job.headers),
      "-i",
      job.videoUrl,
    ];

    if (job.audioUrl) {
      args.push(
        ...this.buildInputHeaderArgs(job.headers),
        "-i",
        job.audioUrl,
      );
    }

    args.push(
      "-map",
      "0:v:0?",
      "-map",
      job.audioUrl
        ? "1:a:0?"
        : "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
    );

    if (videoBitrate) {
      args.push(
        "-b:v",
        String(videoBitrate),
        "-maxrate",
        String(
          Math.floor(videoBitrate * 1.15),
        ),
        "-bufsize",
        String(videoBitrate * 2),
      );
    } else {
      args.push(
        "-crf",
        "22",
      );
    }

    args.push(
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-max_muxing_queue_size",
      "4096",
      outputPath,
    );

    const output = await this.runProcess(
      args,
      FFMPEG_TIMEOUT_MS,
    );

    if (output.exitCode === 0) {
      return;
    }

    const stderr = new TextDecoder().decode(
      output.stderr,
    );

    throw new Error(
      [
        "FFmpeg failed to produce the final MP4.",
        stderr.trim() || `Exit code ${output.exitCode}.`,
      ].join(" "),
    );
  }

  private async getFileSize(
    path: string,
  ): Promise<number> {
    const output = await this.runProcess(
      [
        "stat",
        "-c",
        "%s",
        path,
      ],
      10_000,
    );

    if (output.exitCode !== 0) {
      throw new Error(
        "Could not determine the final MP4 size.",
      );
    }

    const value = Number(
      new TextDecoder().decode(output.stdout).trim(),
    );

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        "FFmpeg produced an empty or invalid MP4 file.",
      );
    }

    return value;
  }

  private async uploadVideoToTelegram(
    path: string,
    chatId: string,
    caption: string,
    parseMode: "HTML" | "MarkdownV2" | null,
  ): Promise<TelegramUploadResult> {
    const endpoint =
      "https://api.telegram.org/bot" +
      `${this.env.TELEGRAM_BOT_TOKEN}/sendVideo`;

    const args = [
      "curl",
      "--silent",
      "--show-error",
      "--request",
      "POST",
      endpoint,
      "--form-string",
      `chat_id=${chatId}`,
      "--form",
      `video=@${path};type=video/mp4;filename=video.mp4`,
      "--form-string",
      "supports_streaming=true",
    ];

    if (caption) {
      args.push(
        "--form-string",
        `caption=${caption}`,
      );
    }

    if (parseMode) {
      args.push(
        "--form-string",
        `parse_mode=${parseMode}`,
      );
    }

    const output = await this.runProcess(
      args,
      TELEGRAM_TIMEOUT_MS,
    );
    const raw = new TextDecoder().decode(
      output.stdout,
    );
    let response: any = null;

    try {
      response = JSON.parse(raw);
    } catch {
      response = {
        ok: false,
        description:
          raw.trim() ||
          new TextDecoder().decode(output.stderr).trim(),
      };
    }

    return {
      ok:
        output.exitCode === 0 &&
        Boolean(response?.ok),
      chatId,
      messageId:
        response?.result?.message_id ?? null,
      description:
        response?.description ?? null,
      response,
    };
  }

  private async removeFile(
    path: string,
  ): Promise<void> {
    try {
      await this.runProcess(
        [
          "rm",
          "-f",
          path,
        ],
        10_000,
      );
    } catch {
      // Cleanup failure must not hide the original result.
    }
  }

  private async runProcess(
    args: string[],
    timeoutMs: number,
  ): Promise<ProcessOutput> {
    const process = (
      await this.ctx.container.exec(args)
    ) as unknown as ProcessLike;
    const timer = setTimeout(() => {
      process.kill();
    }, timeoutMs);

    try {
      return await process.output();
    } finally {
      clearTimeout(timer);
    }
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return handleHealth();
    }

    if (
      request.method === "POST" &&
      url.pathname === "/send"
    ) {
      return handleSend(
        request,
        env,
      );
    }

    return json(
      {
        ok: false,
        error: "Not found",
      },
      404,
    );
  },
};

function handleHealth(): Response {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    status: "online",
    ffmpeg: "container",
    timestamp: new Date().toISOString(),
  });
}

async function handleSend(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError =
    validateEnvironment(env);

  if (configurationError) {
    return json(
      {
        ok: false,
        error: configurationError,
      },
      500,
    );
  }

  if (!isAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized",
      },
      401,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid JSON body",
      },
      400,
    );
  }

  const validation = validateRequestBody(
    body,
    env,
  );

  if (!validation.ok) {
    return json(
      {
        ok: false,
        error: validation.error,
      },
      400,
    );
  }

  const input = validation.value;
  let resolved: ResolvedMediaSource;

  try {
    resolved = await resolveMediaSource(
      input.mediaUrl,
      {
        depth: 0,
        visited: new Set(),
        headers: input.mediaHeaders,
        hlsHint: input.hlsHint,
      },
    );
  } catch (error) {
    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "resolve-media",
        source: {
          inputUrl: input.mediaUrl.href,
          sourceUrl: input.sourceUrl,
          frameUrl: input.frameUrl,
        },
        provider: input.provider,
        metadata: input.metadata,
      },
      422,
    );
  }

  console.log(
    "[media-relay] Processing media with FFmpeg",
    {
      inputUrl: input.mediaUrl.href,
      resolvedVideoUrl: resolved.videoUrl,
      resolvedAudioUrl: resolved.audioUrl,
      sourceUrl: input.sourceUrl,
      provider: input.provider,
      channels: input.channels,
      selectedBitrate:
        resolved.selectedBitrate,
      selectedResolution:
        resolved.selectedResolution,
      metadata: input.metadata,
    },
  );

  try {
    const container = await getRandom(
      env.FFMPEG_CONTAINER,
      FFMPEG_POOL_SIZE,
    );

    const result =
      await container.transcodeAndSend({
        videoUrl: resolved.videoUrl,
        audioUrl: resolved.audioUrl,
        headers: input.mediaHeaders,
        channels: input.channels,
        caption: input.caption,
        parseMode: input.parseMode,
        sourceKind: resolved.sourceKind,
        selectedBitrate:
          resolved.selectedBitrate,
        selectedResolution:
          resolved.selectedResolution,
        provider: input.provider,
      });

    const successCount = result.uploads.filter(
      (item) => item.ok,
    ).length;

    return json(
      {
        ok: result.ok,
        message: result.ok
          ? "Media converted to MP4 and sent to Telegram"
          : "MP4 was created, but one or more uploads failed",
        source: {
          inputUrl: input.mediaUrl.href,
          videoUrl: resolved.videoUrl,
          audioUrl: resolved.audioUrl,
          sourceUrl: input.sourceUrl,
          frameUrl: input.frameUrl,
        },
        resolution: {
          selectedBitrate:
            resolved.selectedBitrate,
          selectedResolution:
            resolved.selectedResolution,
          playlistDepth:
            resolved.playlistDepth,
          sourceKind:
            resolved.sourceKind,
        },
        ffmpeg: {
          outputBytes: result.outputBytes,
          durationSeconds:
            result.durationSeconds,
          videoBitrate:
            result.videoBitrate,
        },
        telegram: {
          channels: input.channels,
          successCount,
          failureCount:
            result.uploads.length -
            successCount,
          uploads: result.uploads,
        },
        provider: input.provider,
        metadata: input.metadata,
      },
      result.ok ? 200 : 502,
    );
  } catch (error) {
    console.error(
      "[media-relay] FFmpeg pipeline failed",
      {
        error: getErrorMessage(error),
        inputUrl: input.mediaUrl.href,
        provider: input.provider,
      },
    );

    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "ffmpeg",
        source: {
          inputUrl: input.mediaUrl.href,
          videoUrl: resolved.videoUrl,
          audioUrl: resolved.audioUrl,
          sourceUrl: input.sourceUrl,
          frameUrl: input.frameUrl,
        },
        resolution: {
          selectedBitrate:
            resolved.selectedBitrate,
          selectedResolution:
            resolved.selectedResolution,
          playlistDepth:
            resolved.playlistDepth,
          sourceKind:
            resolved.sourceKind,
        },
        provider: input.provider,
        metadata: input.metadata,
      },
      502,
    );
  }
}

function validateEnvironment(
  env: Env,
): string | null {
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

function isAuthorized(
  request: Request,
  env: Env,
): boolean {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization) {
    return false;
  }

  const match = authorization.match(
    /^Bearer\s+(.+)$/i,
  );

  if (!match) {
    return false;
  }

  return safeTokenEqual(
    match[1].trim(),
    String(env.RELAY_TOKEN),
  );
}

function safeTokenEqual(
  left: string,
  right: string,
): boolean {
  const a = String(left);
  const b = String(right);
  const maxLength = Math.max(
    a.length,
    b.length,
  );
  let difference =
    a.length ^ b.length;

  for (
    let index = 0;
    index < maxLength;
    index += 1
  ) {
    const aCode =
      index < a.length
        ? a.charCodeAt(index)
        : 0;
    const bCode =
      index < b.length
        ? b.charCodeAt(index)
        : 0;

    difference |=
      aCode ^ bCode;
  }

  return difference === 0;
}

function validateRequestBody(
  body: unknown,
  env: Env,
): ValidationResult {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return {
      ok: false,
      error:
        "Request body must be an object",
    };
  }

  const value =
    body as Record<string, unknown>;
  const rawMediaUrl =
    value.mediaUrl ??
    value.videoUrl ??
    value.fileUrl ??
    value.url;
  const mediaUrl =
    normalizePublicHttpUrl(rawMediaUrl);

  if (!mediaUrl) {
    return {
      ok: false,
      error:
        "Invalid mediaUrl or videoUrl",
    };
  }

  const sourceUrl =
    normalizeOptionalSourceUrl(
      value.sourceUrl ??
      value.pageUrl ??
      value.tweetUrl,
    );
  const frameUrl =
    normalizeOptionalSourceUrl(
      value.frameUrl,
    );
  const provider =
    normalizeSmallString(
      value.provider ??
      getNestedValue(
        value,
        "metadata",
        "platform",
      ) ??
      "generic",
      100,
    );
  const title =
    normalizeSmallString(
      value.title,
      500,
    );
  const text =
    normalizeSmallString(
      value.text,
      4000,
    );
  const requestedParseMode =
    normalizeParseMode(
      value.parseMode,
    );

  if (
    value.parseMode &&
    !requestedParseMode
  ) {
    return {
      ok: false,
      error:
        "Invalid parseMode. Allowed values: " +
        "HTML, MarkdownV2",
    };
  }

  const rawCaption =
    normalizeCaption(value.caption);
  const generatedCaption =
    rawCaption ||
    buildDefaultCaption({
      provider,
      title,
      text,
      sourceUrl,
    });
  const parseMode =
    requestedParseMode ||
    (
      rawCaption
        ? null
        : "HTML"
    );
  const channels =
    normalizeChannels(
      value.channel,
      value.channels,
      env.TELEGRAM_CHAT_ID,
    );

  if (!channels.length) {
    return {
      ok: false,
      error:
        "No valid Telegram channel was provided",
    };
  }

  const metadata =
    normalizeMetadata(value.metadata);
  const resolutionKind =
    metadata?.resolutionKind || "";
  const hlsHint =
    resolutionKind === "hls" ||
    looksLikeHlsUrl(mediaUrl);

  return {
    ok: true,
    value: {
      mediaUrl,
      sourceUrl,
      frameUrl,
      provider,
      title,
      text,
      caption:
        truncateCaption(generatedCaption),
      parseMode,
      mediaHeaders:
        normalizeMediaHeaders(
          value.mediaHeaders,
        ),
      metadata,
      channels,
      hlsHint,
    },
  };
}

function normalizeChannels(
  channel: unknown,
  channels: unknown,
  defaultChannel: string,
): string[] {
  const values = [];

  if (Array.isArray(channels)) {
    values.push(...channels);
  }

  if (channel != null) {
    values.push(channel);
  }

  if (!values.length) {
    values.push(defaultChannel);
  }

  return [
    ...new Set(
      values
        .map(normalizeChannel)
        .filter(
          (value): value is string =>
            Boolean(value),
        ),
    ),
  ].slice(0, MAX_CHANNELS);
}

function normalizeChannel(
  value: unknown,
): string | null {
  if (value == null) {
    return null;
  }

  const channel =
    String(value).trim();

  if (
    /^-?\d{1,30}$/.test(channel) ||
    /^@[A-Za-z0-9_]{5,64}$/.test(
      channel,
    )
  ) {
    return channel;
  }

  return null;
}

function normalizePublicHttpUrl(
  value: unknown,
): URL | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    return null;
  }

  if (isBlockedHostname(url.hostname)) {
    return null;
  }

  return url;
}

function normalizeOptionalSourceUrl(
  value: unknown,
): string | null {
  if (
    value == null ||
    value === ""
  ) {
    return null;
  }

  try {
    const url =
      new URL(String(value));

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function isBlockedHostname(
  hostname: string,
): boolean {
  const host =
    String(hostname).toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (
    host === "::1" ||
    host === "[::1]"
  ) {
    return true;
  }

  const ipv4 = host.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );

  if (!ipv4) {
    return false;
  }

  const parts =
    ipv4.slice(1).map(Number);

  if (
    parts.some(
      (part) =>
        part < 0 ||
        part > 255,
    )
  ) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (
      a === 169 &&
      b === 254
    ) ||
    (
      a === 172 &&
      b >= 16 &&
      b <= 31
    ) ||
    (
      a === 192 &&
      b === 168
    )
  );
}

function normalizeCaption(
  value: unknown,
): string {
  if (value == null) {
    return "";
  }

  return typeof value === "string"
    ? value.trim()
    : String(value);
}

function truncateCaption(
  value: string,
): string {
  if (
    value.length <=
    MAX_CAPTION_LENGTH
  ) {
    return value;
  }

  return value.slice(
    0,
    MAX_CAPTION_LENGTH,
  );
}

function normalizeParseMode(
  value: unknown,
): "HTML" | "MarkdownV2" | null {
  if (!value) {
    return null;
  }

  const normalized =
    String(value);

  return ALLOWED_PARSE_MODES.has(
    normalized,
  )
    ? normalized as
      | "HTML"
      | "MarkdownV2"
    : null;
}

function normalizeSmallString(
  value: unknown,
  maxLength: number,
): string {
  if (value == null) {
    return "";
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

function normalizeMediaHeaders(
  value: unknown,
): MediaHeaders {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  const allowed = new Set([
    "accept",
    "accept-language",
    "authorization",
    "cookie",
    "origin",
    "referer",
    "user-agent",
  ]);
  const headers: MediaHeaders = {};

  for (
    const [key, rawValue]
    of Object.entries(value)
  ) {
    const normalizedKey =
      String(key).toLowerCase();

    if (
      !allowed.has(normalizedKey) ||
      rawValue == null
    ) {
      continue;
    }

    headers[key] =
      String(rawValue)
        .replace(/[\r\n]+/g, " ")
        .slice(0, 4096);
  }

  return headers;
}

function normalizeMetadata(
  value: unknown,
): MediaMetadata | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  const metadata: MediaMetadata = {};

  for (
    const [key, rawValue]
    of Object.entries(value)
  ) {
    if (rawValue == null) {
      continue;
    }

    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      metadata[
        String(key).slice(0, 100)
      ] = String(rawValue).slice(
        0,
        2000,
      );
    }
  }

  return metadata;
}

function getNestedValue(
  value: Record<string, unknown>,
  parent: string,
  child: string,
): unknown {
  const parentValue =
    value[parent];

  if (
    !parentValue ||
    typeof parentValue !== "object" ||
    Array.isArray(parentValue)
  ) {
    return null;
  }

  return (
    parentValue as
      Record<string, unknown>
  )[child];
}

function buildDefaultCaption(
  options: {
    provider: string;
    title: string;
    text: string;
    sourceUrl: string | null;
  },
): string {
  const parts = [];

  if (options.title) {
    parts.push(
      escapeTelegramHtml(
        options.title,
      ),
    );
  }

  if (options.text) {
    parts.push(
      escapeTelegramHtml(
        options.text,
      ),
    );
  }

  if (options.sourceUrl) {
    const safeUrl =
      escapeTelegramHtmlAttribute(
        options.sourceUrl,
      );
    const label =
      getUrlHostname(
        options.sourceUrl,
      ) ||
      options.provider ||
      "source";

    parts.push(
      `<a href="${safeUrl}">` +
      `${escapeTelegramHtml(label)}` +
      "</a>",
    );
  } else if (
    options.provider
  ) {
    parts.push(
      escapeTelegramHtml(
        options.provider,
      ),
    );
  }

  return parts.join("\n\n");
}

function escapeTelegramHtml(
  value: unknown,
): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(
  value: unknown,
): string {
  return escapeTelegramHtml(value)
    .replace(/"/g, "&quot;");
}

function getUrlHostname(
  value: string,
): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

async function resolveMediaSource(
  inputUrl: URL,
  state: MediaResolutionState,
): Promise<ResolvedMediaSource> {
  if (
    state.depth >
    MAX_PLAYLIST_DEPTH
  ) {
    throw new Error(
      "Too many nested HLS playlists",
    );
  }

  const normalizedUrl =
    normalizePublicHttpUrl(
      inputUrl.href,
    );

  if (!normalizedUrl) {
    throw new Error(
      "Resolved media URL is not allowed",
    );
  }

  if (
    state.visited.has(
      normalizedUrl.href,
    )
  ) {
    throw new Error(
      "Circular HLS playlist reference detected",
    );
  }

  state.visited.add(
    normalizedUrl.href,
  );

  const shouldProbe =
    !state.hlsHint &&
    !looksLikeHlsUrl(
      normalizedUrl,
    );

  if (shouldProbe) {
    const probe =
      await probeMediaUrl(
        normalizedUrl,
        state.headers,
      );

    if (!probe.isPlaylist) {
      return {
        videoUrl: probe.url,
        audioUrl: null,
        contentType:
          probe.contentType,
        sourceKind: "file",
        selectedBitrate: null,
        selectedResolution: null,
        playlistDepth:
          state.depth,
      };
    }

    return resolveHlsUrl(
      new URL(probe.url),
      {
        ...state,
        hlsHint: true,
      },
    );
  }

  return resolveHlsUrl(
    normalizedUrl,
    state,
  );
}

async function probeMediaUrl(
  url: URL,
  headers: MediaHeaders,
): Promise<{
  url: string;
  contentType: string;
  isPlaylist: boolean;
}> {
  try {
    const response =
      await fetch(url.href, {
        method: "HEAD",
        headers,
        redirect: "follow",
      });
    const contentType =
      getBaseContentType(
        response.headers.get(
          "content-type",
        ),
      );
    const finalUrl =
      response.url ||
      url.href;

    return {
      url: finalUrl,
      contentType,
      isPlaylist:
        HLS_CONTENT_TYPES.has(
          contentType,
        ) ||
        looksLikeHlsUrl(
          finalUrl,
        ),
    };
  } catch {
    return {
      url: url.href,
      contentType: "",
      isPlaylist:
        looksLikeHlsUrl(url),
    };
  }
}

async function resolveHlsUrl(
  url: URL,
  state: MediaResolutionState,
): Promise<ResolvedMediaSource> {
  const playlist =
    await fetchHlsPlaylist(
      url,
      state.headers,
    );
  const parsed =
    parseHlsPlaylist(
      playlist.text,
      playlist.url,
    );

  if (
    parsed.type === "media"
  ) {
    return {
      videoUrl: playlist.url,
      audioUrl: null,
      contentType:
        "application/vnd.apple.mpegurl",
      sourceKind: "hls",
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth:
        state.depth,
    };
  }

  const variants =
    [...parsed.variants]
      .sort(compareHlsVariants);
  let lastError: unknown = null;

  for (const variant of variants) {
    try {
      const resolved =
        await resolveMediaSource(
          new URL(variant.url),
          {
            depth:
              state.depth + 1,
            visited:
              new Set(state.visited),
            headers:
              state.headers,
            hlsHint:
              looksLikeHlsUrl(
                variant.url,
              ),
          },
        );
      const audio =
        selectAudioRendition(
          parsed.audioRenditions,
          variant.audioGroup,
        );

      return {
        ...resolved,
        audioUrl:
          resolved.audioUrl ||
          audio?.url ||
          null,
        selectedBitrate:
          variant.bitrate ||
          resolved.selectedBitrate,
        selectedResolution:
          variant.resolution?.label ||
          resolved.selectedResolution,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error(
      "No usable HLS variant was found",
    )
  );
}

async function fetchHlsPlaylist(
  url: URL,
  headers: MediaHeaders,
): Promise<{
  url: string;
  text: string;
}> {
  const response =
    await fetch(url.href, {
      method: "GET",
      headers: {
        Accept:
          "application/vnd.apple.mpegurl, " +
          "application/x-mpegurl, " +
          "text/plain",
        ...headers,
      },
      redirect: "follow",
    });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ` +
      "while loading HLS playlist",
    );
  }

  const contentLength =
    Number(
      response.headers.get(
        "content-length",
      ),
    ) || 0;

  if (
    contentLength >
    MAX_PLAYLIST_BYTES
  ) {
    throw new Error(
      "HLS playlist exceeds the relay size limit",
    );
  }

  const text =
    await response.text();
  const encoded =
    new TextEncoder().encode(text);

  if (
    encoded.byteLength >
    MAX_PLAYLIST_BYTES
  ) {
    throw new Error(
      "HLS playlist exceeds the relay size limit",
    );
  }

  if (
    !text
      .trimStart()
      .startsWith("#EXTM3U")
  ) {
    throw new Error(
      "The media URL did not return a valid HLS playlist",
    );
  }

  return {
    url:
      response.url ||
      url.href,
    text,
  };
}

function parseHlsPlaylist(
  text: string,
  playlistUrl: string,
): ParsedHlsPlaylist {
  const lines =
    String(text)
      .split(/\r?\n/)
      .map(
        (line) =>
          line.trim(),
      )
      .filter(Boolean);
  const variants: HlsVariant[] = [];
  const audioRenditions:
    HlsAudioRendition[] = [];

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const line =
      lines[index];

    if (
      line.startsWith(
        "#EXT-X-MEDIA:",
      )
    ) {
      const attributes =
        parseHlsAttributes(
          line.slice(
            "#EXT-X-MEDIA:"
              .length,
          ),
        );

      if (
        attributes.TYPE ===
        "AUDIO"
      ) {
        audioRenditions.push({
          groupId:
            attributes["GROUP-ID"] ||
            "",
          name:
            attributes.NAME ||
            "",
          url:
            attributes.URI
              ? resolveRelativeUrl(
                  attributes.URI,
                  playlistUrl,
                )
              : null,
          isDefault:
            attributes.DEFAULT ===
            "YES",
          autoSelect:
            attributes.AUTOSELECT ===
            "YES",
        });
      }

      continue;
    }

    if (
      !line.startsWith(
        "#EXT-X-STREAM-INF:",
      )
    ) {
      continue;
    }

    const attributes =
      parseHlsAttributes(
        line.slice(
          "#EXT-X-STREAM-INF:"
            .length,
        ),
      );
    let uri: string | null = null;

    for (
      let next = index + 1;
      next < lines.length;
      next += 1
    ) {
      if (
        !lines[next]
          .startsWith("#")
      ) {
        uri =
          resolveRelativeUrl(
            lines[next],
            playlistUrl,
          );
        break;
      }
    }

    if (!uri) {
      continue;
    }

    const resolution =
      parseResolution(
        attributes.RESOLUTION,
      );
    const averageBandwidth =
      Number(
        attributes[
          "AVERAGE-BANDWIDTH"
        ] || 0,
      );
    const bandwidth =
      Number(
        attributes.BANDWIDTH ||
        0,
      );

    variants.push({
      url: uri,
      bitrate:
        averageBandwidth ||
        bandwidth ||
        0,
      peakBitrate:
        bandwidth ||
        averageBandwidth ||
        0,
      resolution,
      width:
        resolution?.width ||
        0,
      height:
        resolution?.height ||
        0,
      codecs:
        attributes.CODECS ||
        "",
      audioGroup:
        attributes.AUDIO ||
        "",
    });
  }

  if (variants.length) {
    return {
      type: "master",
      variants,
      audioRenditions,
    };
  }

  return {
    type: "media",
  };
}

function parseHlsAttributes(
  value: string,
): Record<string, string> {
  const attributes:
    Record<string, string> = {};
  const expression =
    /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null =
    null;

  while (
    (
      match =
        expression.exec(
          String(value),
        )
    )
  ) {
    let attributeValue =
      match[2].trim();

    if (
      attributeValue
        .startsWith('"') &&
      attributeValue
        .endsWith('"')
    ) {
      attributeValue =
        attributeValue.slice(
          1,
          -1,
        );
    }

    attributes[
      match[1].toUpperCase()
    ] = attributeValue;
  }

  return attributes;
}

function parseResolution(
  value: string | undefined,
): Resolution | null {
  const match =
    String(value || "")
      .match(
        /^(\d+)x(\d+)$/i,
      );

  if (!match) {
    return null;
  }

  return {
    width:
      Number(match[1]),
    height:
      Number(match[2]),
    label:
      `${match[1]}x${match[2]}`,
  };
}

function compareHlsVariants(
  left: HlsVariant,
  right: HlsVariant,
): number {
  const bitrateDifference =
    Number(right.bitrate) -
    Number(left.bitrate);

  if (bitrateDifference) {
    return bitrateDifference;
  }

  const rightPixels =
    Number(right.width) *
    Number(right.height);
  const leftPixels =
    Number(left.width) *
    Number(left.height);
  const pixelDifference =
    rightPixels -
    leftPixels;

  if (pixelDifference) {
    return pixelDifference;
  }

  return (
    Number(right.peakBitrate) -
    Number(left.peakBitrate)
  );
}

function selectAudioRendition(
  renditions: HlsAudioRendition[],
  groupId: string,
): HlsAudioRendition | null {
  if (!groupId) {
    return null;
  }

  const matches =
    renditions.filter(
      (item) =>
        item.groupId === groupId &&
        item.url,
    );

  return (
    matches.find(
      (item) =>
        item.isDefault,
    ) ||
    matches.find(
      (item) =>
        item.autoSelect,
    ) ||
    matches[0] ||
    null
  );
}

function resolveRelativeUrl(
  value: string,
  baseUrl: string,
): string | null {
  try {
    const url =
      new URL(
        String(value),
        baseUrl,
      );

    return (
      normalizePublicHttpUrl(
        url.href,
      )?.href ||
      null
    );
  } catch {
    return null;
  }
}

function looksLikeHlsUrl(
  value: URL | string,
): boolean {
  const url =
    value instanceof URL
      ? value
      : new URL(String(value));

  return /\.m3u8(?:$|[?#])/i.test(
    url.href,
  );
}

function getBaseContentType(
  value: string | null,
): string {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function calculateVideoBitrate(
  durationSeconds: number | null,
): number | null {
  if (
    !durationSeconds ||
    durationSeconds <= 0
  ) {
    return null;
  }

  const targetBytes =
    MAX_TELEGRAM_VIDEO_BYTES *
    0.92;
  const targetBits =
    targetBytes * 8;
  const totalBitrate =
    Math.floor(
      targetBits /
      durationSeconds,
    );
  const audioBitrate =
    128_000;
  const videoBitrate =
    totalBitrate -
    audioBitrate;

  return Math.max(
    120_000,
    Math.min(
      12_000_000,
      videoBitrate,
    ),
  );
}

function getErrorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function handleOptions(): Response {
  return new Response(
    null,
    {
      status: 204,
      headers: CORS_HEADERS,
    },
  );
}

function json(
  value: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(
      value,
      null,
      2,
    ),
    {
      status,
      headers: {
        ...JSON_HEADERS,
        ...CORS_HEADERS,
        "Cache-Control":
          "no-store",
      },
    },
  );
}
