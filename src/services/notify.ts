export interface NotifyEnv {
  NOTIFY_DEVICE_ID?: string;
  NOTIFY_TOKEN?: string;
  GITHUB_API_TOKEN?: string;
  /** Segredo opcional para autenticar as chamadas vindas do GitHub Actions */
  WORKER_AUTH_TOKEN?: string;
}

const BASE_URL = "https://push.getnotifyapp.com";
const NOTIFY_ICON_URL = "https://raw.githubusercontent.com/rodkisten/xtelegram-cf/refs/heads/main/public/IMG_9928.png";
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ACTIVITY_PATTERN = /^LA[A-Za-z0-9]{6,20}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUN_RE = /^[0-9]{1,20}$/;
const STEP_INDEX_RE = /^[1-9][0-9]{0,2}$/;
const GCP_PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const GCP_REGION_RE = /^[a-z]+-[a-z]+[0-9]$/;

export interface NotifyPayloadInput {
  action: "start" | "step" | "end";
  workflow?: string;
  job?: string;
  step?: string;
  outcome?: string;
  activityId?: string;
  label?: string;
  stepIndex?: string;
  completed?: number | string;
  total?: number | string;
  project?: string;
  region?: string;
  /** Passados pelo workflow no JSON (substituem process.env.GITHUB_*) */
  repository?: string;
  runId?: string;
}

interface LinkButton {
  title: string;
  url: string;
  open: boolean;
}

interface GitHubStep {
  name?: string;
  number?: number;
}

interface GitHubJob {
  id?: number;
  name?: string;
  steps?: GitHubStep[];
}

function getCredentials(env: NotifyEnv): [string, string] | null {
  const device = (env.NOTIFY_DEVICE_ID ?? "").trim();
  const token = (env.NOTIFY_TOKEN ?? "").trim();

  if (!device || !token) return null;
  if (!DEVICE_PATTERN.test(device) || !TOKEN_PATTERN.test(token)) return null;

  return [device, token];
}

async function send(
  endpoint: string,
  device: string,
  token: string,
  payload: Record<string, unknown>,
  options: { extra?: Record<string, string>; method?: string } = {}
): Promise<Record<string, unknown>> {
  const { extra = {}, method = "POST" } = options;
  const pathId = encodeURIComponent(device);
  const query = new URLSearchParams({ token, ...extra }).toString();
  const groupType = typeof payload.groupType === "string" && /^github-[A-Za-z0-9_.-]{1,48}$/.test(payload.groupType)
    ? payload.groupType : "github-actions";
  const target = `${BASE_URL}/${endpoint}/${pathId}?${query}&groupType=${encodeURIComponent(groupType)}&iconUrl=${encodeURIComponent(NOTIFY_ICON_URL)}&timeSensitive=true`;

  const response = await fetch(target, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "xtelegram-github-actions/1",
    },
    body: JSON.stringify(endpoint === "notify-json" ? { iconUrl: NOTIFY_ICON_URL, timeSensitive: true, ...payload } : payload),
    signal: AbortSignal.timeout(7000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = (await response.text()).slice(0, 4096);
  const result: unknown = JSON.parse(text);

  if (typeof result !== "object" || result === null || (result as Record<string, unknown>).success !== true) {
    throw new Error("Notify! did not confirm delivery");
  }

  return result as Record<string, unknown>;
}

function cleanLabel(label: string, maxLen: number): string {
  return label
    .replace(/[\r\n\x00-\x1f]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function shortWorkflow(name: string): string {
  const normalized = name
    .replace(/^[^\p{L}\p{N}_]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const names: Record<string, string> = {
    "artifact cleanup": "Limpeza de artifacts",
    "bootstrap check": "Bootstrap",
    "ci": "CI",
    "cloudflare setup": "Cloudflare Setup",
    "compose": "Compose",
    "architectures": "Arquiteturas",
    "cloudflare worker": "Cloudflare Worker",
    "worker · front + api": "Cloudflare Worker",
    "setup gcp": "Setup GCP",
    "deploy": "Deploy",
    "diagnose cloud run": "Diagnóstico Cloud Run",
    "migrate neon": "Migração Neon",
    "gcp terminal": "Terminal GCP",
    "gcp check": "Validação GCP",
    "icloud setup": "Setup iCloud",
    "icloud validation": "Validação iCloud",
    "cpu models": "Modelos CPU",
    "manifest": "Manifesto",
    "ssh": "SSH",
    "terminal validation": "Validação Terminal",
    "webkit": "WebKit",
    "zip patch": "ZIP Patch",
  };

  const result = names[normalized] ?? (cleanLabel(name.replace(/^[^\p{L}\p{N}_]+/u, "").trim(), 42) || "Workflow");

  return result;
}

function shortStep(name: string): string {
  const source = name
    .replace(/\[[^\]]{1,32}\]/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();

  const known: ReadonlyArray<readonly [string, string]> = [
    ["checkout", "Código"],
    ["source", "Código"],
    ["authenticate", "Login"],
    ["auth", "Login"],
    ["gcloud", "Google Cloud"],
    ["configure", "Config"],
    ["prepare", "Config"],
    ["preflight", "Verificação"],
    ["prerequisites", "Verificação"],
    ["compile", "Build"],
    ["build", "Build"],
    ["image", "Imagem"],
    ["migration", "Neon"],
    ["migrate", "Neon"],
    ["neon", "Neon"],
    ["scheduler", "Agenda"],
    ["cleanup", "Limpeza"],
    ["publish", "Publicação"],
    ["deploy", "Publicação"],
    ["test", "Testes"],
    ["validation", "Validação"],
  ];

  const lowered = name.toLowerCase();
  for (const [key, pretty] of known) {
    if (lowered.includes(key)) return pretty;
  }

  return cleanLabel(source || name, 26);
}

function runContext(repository = "", runId = ""): [string, string, string] {
  if (!REPO_RE.test(repository) || !RUN_RE.test(runId)) {
    return ["", "", ""];
  }
  return [repository, runId, `https://github.com/${repository}/actions/runs/${runId}`];
}

async function githubStepLink(
  env: NotifyEnv,
  repository: string,
  runId: string,
  stepName: string,
  jobKey: string,
  stepIndex = ""
): Promise<string> {
  const [repo, run, fallback] = runContext(repository, runId);
  const token = env.GITHUB_API_TOKEN ?? "";
  if (!token || !fallback) return fallback;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs/${run}/jobs?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "PhotoIntel-Notify",
        },
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!response.ok) return fallback;

    const data = (await response.json()) as { jobs?: GitHubJob[] };
    const jobs = data.jobs;
    if (!Array.isArray(jobs)) return fallback;

    let job: GitHubJob;
    if (jobs.length === 1) {
      const onlyJob = jobs[0];
      if (!onlyJob) return fallback;
      job = onlyJob;
    } else {
      const loweredKey = jobKey.toLowerCase();
      const matching = jobs.filter((item) =>
        String(item.name ?? "").toLowerCase().includes(loweredKey)
      );
      if (matching.length !== 1) return fallback;
      const matchedJob = matching[0];
      if (!matchedJob) return fallback;
      job = matchedJob;
    }

    const jobId = job.id;
    if (typeof jobId !== "number" || !Number.isInteger(jobId) || jobId <= 0) {
      return fallback;
    }

    const url = `${fallback}/job/${jobId}`;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const candidates = steps.filter(
      (step): step is Required<GitHubStep> =>
        step.name === stepName && typeof step.number === "number" && Number.isInteger(step.number)
    );

    if (candidates.length === 1) {
      const onlyStep = candidates[0];
      if (!onlyStep) return url;
      return `${url}#step:${onlyStep.number}:1`;
    }
    if (STEP_INDEX_RE.test(stepIndex)) {
      return `${url}#step:${Number.parseInt(stepIndex, 10)}:1`;
    }
    return url;
  } catch {
    return fallback;
  }
}

function gcpFailureUrl(step: string, project: string, region: string): string {
  if (!GCP_PROJECT_RE.test(project) || !GCP_REGION_RE.test(region)) {
    return "";
  }

  const normalized = step.toLowerCase();
  const base = "https://photos-manage.migos.club/?tab=logs&source=gcp";

  if (normalized.includes("api") || normalized.includes("cloud run")) {
    return `${base}&search=photointel-api`;
  }
  if (normalized.includes("jobs") || normalized.includes("worker")) {
    return `${base}&search=photointel-worker`;
  }
  if (normalized.includes("build")) {
    return "https://photos-manage.migos.club/?tab=deploy";
  }
  return "";
}

function stageCount(value: number | string | undefined, total: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(total, parsed));
}

function stepsVisual(total: number, completed: number): Record<string, number> {
  if (total >= 2 && total <= 20) {
    return { steps: total, step: completed };
  }
  return { progress: Math.round((100 * completed) / total) };
}

function linkButton(url: string, label: string): LinkButton | null {
  if (!url.startsWith("https://")) return null;
  return { title: label, url: url.slice(0, 512), open: true };
}

export async function handleAction(
  input: NotifyPayloadInput,
  env: NotifyEnv,
  device: string,
  token: string
): Promise<{ activityId?: string }> {
  const repoLabel = input.repository?.split("/").pop() || "";
  const workflow = `${repoLabel ? repoLabel + " · " : ""}${shortWorkflow(input.workflow ?? "")}`.slice(0, 65);
  const bannerTitle = cleanLabel(`❌ ${repoLabel || "GitHub"} · ${shortWorkflow(input.workflow ?? "")}`, 40);
  const [, runId, runUrl] = runContext(input.repository, input.runId);
  const parsedTotal =
    typeof input.total === "number" ? input.total : Number.parseInt(String(input.total ?? "1"), 10);
  const total = Math.max(1, Math.min(20, Number.isNaN(parsedTotal) ? 1 : parsedTotal));
  const completed = stageCount(input.completed, total);
  const fraction = `${completed}/${total}`;

  if (input.action === "start") {
    const payload: Record<string, unknown> = {
      title: workflow,
      body: `Iniciando ${cleanLabel(input.job ?? "", 24) || "workflow"} · ${fraction}`,
      symbol: "square.stack.3d.up.fill",
      tint: "#3B82F6",
      trailing: fraction,
      status: "running",
      ...stepsVisual(total, completed),
    };

    const button = linkButton(runUrl, "Ver workflow");
    if (button) payload.button = button;

    const result = await send("live-activity", device, token, payload, { extra: { new: "1" } });
    const activityId = result.activityId;

    if (typeof activityId !== "string" || !ACTIVITY_PATTERN.test(activityId)) {
      throw new Error("Notify! did not return a valid activity ID");
    }

    return { activityId };
  }

  if (input.action === "step") {
    const outcome = (input.outcome ?? "").toLowerCase().trim();
    if (!["running", "success", "failure"].includes(outcome)) {
      return {};
    }

    const stepName = input.step ?? "";
    const jobName = input.job ?? "";
    const label = shortStep(input.label || stepName);
    const failed = outcome === "failure";
    let link = await githubStepLink(
      env,
      input.repository ?? "",
      input.runId ?? "",
      stepName,
      jobName,
      input.stepIndex ?? ""
    );
    let buttonTitle = "Ver step";

    if (failed) {
      // A push must open the failing GitHub run; diagnostic links belong in Manage.
      const message = `Falha: ${label}`;
      const button = linkButton(runUrl || link, "Abrir execução");
      await send("notify-json", device, token, {
        title: bannerTitle,
        text: cleanLabel(`${message} · ${fraction}`, 60),
        groupType: `github-${cleanLabel(repoLabel, 48) || "actions"}`,
        ...(button ? { button } : {}),
      });
    }

    if (input.activityId && ACTIVITY_PATTERN.test(input.activityId)) {
      const payload: Record<string, unknown> = {
        title: workflow,
        body: `${failed ? "❌ " : ""}${label} · ${fraction}`,
        trailing: fraction,
        status: failed ? "failed" : "running",
        ...stepsVisual(total, completed),
      };

      const button = linkButton(link, buttonTitle);
      if (button) payload.button = button;

      await send("live-activity", input.activityId, token, payload);
    }

    return {};
  }

  if (input.action === "end") {
    const outcome = (input.outcome ?? "").toLowerCase().trim();
    const success = outcome === "success";
    const message = success ? "✅ Concluído" : outcome === "cancelled" ? "⚠️ Cancelado" : "❌ Falhou";

    // Workflow completion updates the existing Live Activity only.
    // Do not send an additional push for every successful/cancelled run.

    if (input.activityId && ACTIVITY_PATTERN.test(input.activityId)) {
      const payload: Record<string, unknown> = {
        title: workflow,
        status: success ? "done" : outcome === "cancelled" ? "cancelled" : "failed",
        body: success ? `${message} · ${total}/${total}` : message,
        endsIn: null,
        keepFor: 60,
      };

      if (success) {
        Object.assign(payload, {
          trailing: `${total}/${total}`,
          ...stepsVisual(total, total),
        });
      }

      await send("live-activity", input.activityId, token, payload, { method: "DELETE" });
    }
  }

  return {};
}

/** Shared entry point for authenticated GitHub webhooks. */
export async function sendWorkflowNotify(input: NotifyPayloadInput, env: NotifyEnv): Promise<{ activityId?: string; disabled?: boolean }> {
  const credentials = getCredentials(env);
  if (!credentials) return { disabled: true };
  return handleAction(input, env, ...credentials);
}

export default {
  async fetch(request: Request, env: NotifyEnv): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
    }

    if (env.WORKER_AUTH_TOKEN) {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.WORKER_AUTH_TOKEN}`) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const creds = getCredentials(env);
    if (!creds) {
      // Mantém comportamento best-effort sem quebrar o CI
      return Response.json({ ok: true, disabled: true, activityId: "" });
    }

    try {
      const body = (await request.json()) as NotifyPayloadInput;
      const result = await handleAction(body, env, ...creds);
      return Response.json({ ok: true, ...result });
    } catch (err: unknown) {
      const errName = err instanceof Error ? err.name : "UnknownError";
      console.warn(`Notify! failed (${errName})`);
      // Retorna 200 com activityId vazio para nunca falhar o job no GitHub Actions
      return Response.json({ ok: false, warning: errName, activityId: "" });
    }
  },
};
