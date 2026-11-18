import { matchesPatterns, repositoryNotificationRules } from "./github-notify-config";
import type { Env } from "../types";

type Result = { allowed: boolean; reason?: string };
type Run = Record<string, unknown>;
const API = "https://api.github.com";

async function githubJson(url: string, token?: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "xtelegram-github-notify",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("GitHub API HTTP " + response.status);
  return response.json();
}

function filesFromCompare(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const files = (data as { files?: Array<{ filename?: string }> }).files;
  return Array.isArray(files) ? files.map(f => f.filename).filter((p): p is string => typeof p === "string") : [];
}

async function changedFiles(repo: string, run: Run, token?: string): Promise<string[] | null> {
  const base = API + "/repos/" + repo;
  const prs = run.pull_requests;
  if (Array.isArray(prs) && prs.length) {
    const paths = new Set<string>();
    for (const pr of prs.slice(0, 5)) {
      if (!pr || typeof pr !== "object") continue;
      const number = (pr as Record<string, unknown>).number;
      if (typeof number !== "number" || !Number.isSafeInteger(number)) continue;
      for (let page = 1; page <= 10; page++) {
        const items = await githubJson(base + "/pulls/" + number + "/files?per_page=100&page=" + page, token);
        if (!Array.isArray(items)) return null;
        for (const item of items) {
          if (item && typeof item === "object" && typeof item.filename === "string") paths.add(item.filename);
        }
        if (items.length < 100) break;
        if (page === 10) return null;
      }
    }
    return paths.size ? [...paths] : null;
  }
  if (run.event !== "push") return null;
  const sha = run.head_sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) return null;
  const commit = await githubJson(base + "/commits/" + sha, token);
  if (!commit || typeof commit !== "object") return null;
  const parents = (commit as { parents?: Array<{ sha?: string }> }).parents;
  const parent = parents?.[0]?.sha;
  if (!parent || !/^[a-f0-9]{40}$/i.test(parent)) return null;
  const compare = await githubJson(base + "/compare/" + parent + "..." + sha, token);
  const files = filesFromCompare(compare);
  if ((compare as { total_commits?: number }).total_commits && (compare as { total_commits: number }).total_commits > 1) {
    // The event does not contain the push's before SHA. Do not claim a single-commit diff covers the push.
    return null;
  }
  return files.length ? files : null;
}

export async function selectChangedPaths(payload: unknown, env: Env): Promise<Result> {
  if (!payload || typeof payload !== "object") return { allowed: false, reason: "invalid_payload" };
  const root = payload as Record<string, unknown>;
  const repo = (root.repository as Record<string, unknown> | undefined)?.full_name;
  const run = root.workflow_run;
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !run || typeof run !== "object") {
    return { allowed: false, reason: "invalid_repository_or_run" };
  }
  const rules = repositoryNotificationRules(repo);
  if (!rules.changed_paths.length) return { allowed: true };
  const unknown = (): Result => rules.on_unknown_changes === "deny"
    ? { allowed: false, reason: "changed_paths_unavailable" }
    : { allowed: true };
  try {
    const files = await changedFiles(repo, run as Run, env.GITHUB_API_TOKEN || env.GITHUB_ACTIONS_TOKEN);
    if (!files) return unknown();
    return files.some(path => matchesPatterns(path, rules.changed_paths))
      ? { allowed: true } : { allowed: false, reason: "changed_paths_filtered" };
  } catch (error) {
    console.warn("[github-webhook] changed-files lookup unavailable", error instanceof Error ? error.message : String(error));
    return unknown();
  }
}
