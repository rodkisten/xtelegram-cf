import { json } from "../http/response";
import type { Env } from "../types";

type Callback = {
  id?: string;
  from?: { id?: number };
  data?: string;
  message?: { message_id?: number; chat?: { id?: number } };
};
type Update = { callback_query?: Callback };

async function answer(env: Env, id: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text, show_alert: true }),
  });
}

/**
 * Telegram webhook callback for failed GitHub Actions notifications.
 * Requires Telegram's secret header AND an explicit Telegram user allowlist.
 * Never accepts a repository name or arbitrary GitHub URL from the callback.
 */
export async function handleTelegramGithubCallback(request: Request, env: Env): Promise<Response> {
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !env.GITHUB_RERUN_ALLOWED_USER_IDS || !env.GITHUB_ACTIONS_TOKEN) {
    return json({ ok: false, error: "Rerun integration not configured" }, 503);
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const raw = await request.text();
  if (raw.length > 8192) return json({ ok: false }, 413);
  let update: Update;
  try { update = JSON.parse(raw) as Update; }
  catch { return json({ ok: false }, 400); }
  const callback = update.callback_query;
  const match = /^ghrerun:([1-9][0-9]{0,15})$/.exec(callback?.data ?? "");
  if (!callback?.id || !match) return json({ ok: true, ignored: true });
  const allowed = new Set(env.GITHUB_RERUN_ALLOWED_USER_IDS.split(",").map(s => s.trim()));
  if (!callback.from?.id || !allowed.has(String(callback.from.id))) {
    await answer(env, callback.id, "Você não tem permissão para executar workflows.");
    return json({ ok: true });
  }
  const chatId = callback.message?.chat?.id;
  const messageId = callback.message?.message_id;
  if (!chatId || !messageId) {
    await answer(env, callback.id, "Mensagem original indisponível.");
    return json({ ok: true });
  }

  // The Telegram message must be a Relay-owned notification for exactly this run.
  const rows = await env.RELAY_DB.prepare(
    "SELECT notification_key FROM notification_messages " +
    "WHERE chat_id=?1 AND message_id=?2 AND notification_key LIKE 'workflow:%' LIMIT 1"
  ).bind(String(chatId), messageId).first<{ notification_key: string }>();
  const key = rows?.notification_key;
  const suffix = ":" + match[1];
  if (!key?.endsWith(suffix)) {
    await answer(env, callback.id, "Esta execução não pertence à notificação.");
    return json({ ok: true });
  }
  const repo = key.slice("workflow:".length, -suffix.length);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return json({ ok: false, error: "Invalid repository" }, 400);
  }

  // Atomic claim prevents double-taps and simultaneous callbacks.
  const claimed = await env.RELAY_DB.prepare(
    "INSERT OR IGNORE INTO github_rerun_requests (run_id, repository, user_id, status) " +
    "VALUES (?1, ?2, ?3, 'processing')"
  ).bind(match[1], repo, String(callback.from.id)).run();
  if (!(claimed.meta.changes ?? 0)) {
    await answer(env, callback.id, "Uma nova execução já foi solicitada.");
    return json({ ok: true, duplicate: true });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${match[1]}/rerun`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "xtelegram-cf",
        },
      }
    );
    if (response.status !== 201) {
      await env.RELAY_DB.prepare(
        "UPDATE github_rerun_requests SET status='failed' WHERE run_id=?1"
      ).bind(match[1]).run();
      await answer(env, callback.id, `GitHub recusou a execução (HTTP ${response.status}).`);
      return json({ ok: true, github_status: response.status });
    }
    await env.RELAY_DB.prepare(
      "UPDATE github_rerun_requests SET status='requested' WHERE run_id=?1"
    ).bind(match[1]).run();
    await answer(env, callback.id, "🔄 Nova tentativa solicitada ao GitHub!");
    return json({ ok: true, rerun: true });
  } catch (error) {
    // Do not automatically retry an ambiguous GitHub network failure.
    await env.RELAY_DB.prepare(
      "UPDATE github_rerun_requests SET status='unknown' WHERE run_id=?1"
    ).bind(match[1]).run();
    await answer(env, callback.id, "Não foi possível confirmar o pedido. Confira o GitHub Actions.");
    return json({ ok: true, uncertain: true });
  }
}
