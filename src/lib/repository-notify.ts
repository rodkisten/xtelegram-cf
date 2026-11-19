import YAML from "yaml";
import { escapeTelegramHtml } from "./github-notifications";

const REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const EVENTS = new Set(["workflow_started", "workflow_success", "workflow_failure", "workflow_recovered", "deploy_failed", "job_failed"]);
export type RepositoryNotify = {
  events?: string[];
  template?: string;
  grouping?: "window" | "run" | "none";
  windowSeconds?: number;
  updateMode?: "edit" | "new";
  retentionMinutes?: { running?: number; success?: number; error?: number };
};
const fields = new Set(["events", "template", "grouping", "windowSeconds", "updateMode", "retentionMinutes"]);

export function parseRepositoryNotify(source: string): RepositoryNotify {
  if (new TextEncoder().encode(source).length > 32768) throw new Error("notify.yml exceeds 32 KiB");
  const data: unknown = YAML.parse(source, { strict: true, uniqueKeys: true });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("notify.yml must be a mapping");
  const root = data as Record<string, unknown>;
  if (root.version !== 1 || Object.keys(root).some(key => key !== "version" && key !== "notifications"))
    throw new Error("Unsupported notify.yml schema");
  const settings = root.notifications;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Missing notifications mapping");
  const config = settings as Record<string, unknown>;
  if (Object.keys(config).some(key => !fields.has(key))) throw new Error("Unknown notification setting");
  if (config.events !== undefined && (!Array.isArray(config.events) || config.events.some(x => typeof x !== "string" || !EVENTS.has(x))))
    throw new Error("Invalid notification events");
  if (config.template !== undefined && (typeof config.template !== "string" || !config.template.trim() || config.template.length > 3500))
    throw new Error("Invalid notification template");
  if (config.grouping !== undefined && !["window", "run", "none"].includes(String(config.grouping))) throw new Error("Invalid grouping");
  if (config.windowSeconds !== undefined && ![5, 10, 15, 30].includes(Number(config.windowSeconds))) throw new Error("Invalid windowSeconds");
  if (config.updateMode !== undefined && !["edit", "new"].includes(String(config.updateMode))) throw new Error("Invalid updateMode");
  if (config.retentionMinutes !== undefined) {
    const retention = config.retentionMinutes;
    if (!retention || typeof retention !== "object" || Array.isArray(retention)) throw new Error("Invalid retentionMinutes");
    for (const [key, value] of Object.entries(retention)) {
      if (!["running", "success", "error"].includes(key) || !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 43200)
        throw new Error("Invalid retentionMinutes." + key);
    }
  }
  return config as RepositoryNotify;
}

/** Reads the default-branch policy. No webhook-supplied ref can select untrusted YAML. */
export async function loadRepositoryNotify(repository: string, token?: string): Promise<RepositoryNotify | null> {
  if (!REPOSITORY.test(repository)) throw new Error("Invalid repository");
  const response = await fetch("https://api.github.com/repos/" + repository + "/contents/notify.yml", {
    headers: {
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "xtelegram-repository-notify",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(7000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("GitHub notify.yml HTTP " + response.status);
  return parseRepositoryNotify(await response.text());
}

export function repositoryEvent(action: string, conclusion: string): string | null {
  if (action === "requested" || action === "in_progress") return "workflow_started";
  if (action !== "completed") return null;
  return ["failure", "timed_out", "startup_failure", "action_required"].includes(conclusion)
    ? "workflow_failure" : conclusion === "success" ? "workflow_success" : null;
}

export function renderRepositoryTemplate(template: string, values: Record<string, string>): string {
  // Escape every untrusted field before embedding into Telegram HTML.
  return template.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key: string) =>
    escapeTelegramHtml(values[key] ?? ""));
}
