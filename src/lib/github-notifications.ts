export interface NotificationButton {
  text: string;
  url: string;
}

export interface NotificationMessage {
  text: string;
  buttons: NotificationButton[][];
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function text(value: unknown, max = 180): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : "";
}

export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Never trust URLs from webhook payloads, even when HTML escaping them. */
function githubUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" &&
      !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusInfo(action: string, conclusion: string): { icon: string; title: string } {
  if (action === "requested") return { icon: "📥", title: "Workflow solicitado" };
  if (action === "in_progress") return { icon: "🔄", title: "Workflow em execução" };
  const statuses: Record<string, { icon: string; title: string }> = {
    success: { icon: "✅", title: "Workflow: sucesso" },
    failure: { icon: "❌", title: "Workflow falhou" },
    cancelled: { icon: "🛑", title: "Workflow cancelado" },
    timed_out: { icon: "⏱️", title: "Workflow excedeu o tempo" },
    action_required: { icon: "⚠️", title: "Workflow exige atenção" },
    neutral: { icon: "⚪", title: "Workflow concluído (neutro)" },
    skipped: { icon: "⏭️", title: "Workflow ignorado" },
    stale: { icon: "⌛", title: "Workflow obsoleto" },
    startup_failure: { icon: "🚨", title: "Workflow não iniciou" },
  };
  return statuses[conclusion] ?? { icon: "ℹ️", title: "Workflow concluído" };
}

export function formatGithubWorkflowRun(payload: unknown): NotificationMessage | null {
  const root = record(payload);
  const action = text(root.action, 40);
  if (!["requested", "in_progress", "completed"].includes(action)) return null;

  const run = record(root.workflow_run);
  const repository = record(root.repository);
  const fullName = text(repository.full_name, 180);
  const id = run.id;
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName) || typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  const repoUrl = githubUrl(repository.html_url) ?? "https://github.com/" + fullName;
  const runUrl = githubUrl(run.html_url) ?? repoUrl + "/actions/runs/" + id;
  const branch = text(run.head_branch, 100);
  const sha = text(run.head_sha, 50);
  const commit = record(run.head_commit);
  const subject = text(commit.message, 160);
  const actor = record(run.triggering_actor ?? run.actor);
  const actorName = text(actor.login, 50);
  const workflow = text(run.name, 130) || "GitHub Actions";
  const displayTitle = text(run.display_title, 150);
  const attempt = Number(run.run_attempt);
  const runNumber = Number(run.run_number);
  const conclusion = text(run.conclusion, 40);
  const { icon, title } = statusInfo(action, conclusion);

  const lines = [
    icon + " <b>" + escapeTelegramHtml(title) + ":" + escapeTelegramHtml(workflow) + "</b>",
    "",
   // "📦 <b>" + escapeTelegramHtml(fullName) + "</b>",
      (Number.isSafeInteger(runNumber) && runNumber > 0 ? "  #" + runNumber : "") +
      (Number.isSafeInteger(attempt) && attempt > 1 ? " · tentativa " + attempt : ""),
  ];
  if (displayTitle && displayTitle !== workflow) lines.push("📝 " + escapeTelegramHtml(displayTitle));
  if (branch) lines.push("", "🌿 <b>Branch:</b> <code>" + escapeTelegramHtml(branch) + "</code>");
  if (sha) lines.push("🔖 <b>Commit:</b> <code>" + escapeTelegramHtml(sha.slice(0, 10)) + "</code>");
  if (subject && subject !== displayTitle) lines.push("💬 <blockquote>" + escapeTelegramHtml(subject) + "</blockquote>");
  if (actorName) lines.push("👤 <b>Por:</b> " + escapeTelegramHtml(actorName));
  if (action === "completed" && conclusion) {
    lines.push("", "📌 <b>Resultado:</b> " + escapeTelegramHtml(conclusion));
  }

  const buttons: NotificationButton[][] = [[
    { text: " 🔎 Abrir execução ", url: runUrl },
    { text: " 📁 Repositório ", url: repoUrl },
  ]];
  if (sha && /^[a-f0-9]{40}$/i.test(sha)) {
    buttons.push([{ text: " 🔖 Ver commit ", url: repoUrl + "/commit/" + sha }]);
  }
  return { text: lines.join("\n"), buttons };
}

/** Verify GitHub's sha256= signature using the original request bytes. */
export async function verifyGithubSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader ?? "");
  if (!match || !secret) return false;
  const signatureBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    signatureBytes[i] = Number.parseInt(match[1]!.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, rawBody);
}
