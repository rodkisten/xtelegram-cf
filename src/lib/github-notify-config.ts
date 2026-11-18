import configYaml from "../../config/github-notify.yaml";

type Rules = { workflows: string[]; changed_paths: string[]; on_unknown_changes: string };
type Config = { defaults: Rules; repositories: Record<string, Rules> };

/** Restricted YAML reader for this checked-in, data-only routing format. */
function readConfig(source: string): Config {
  const config: Config = {
    defaults: { workflows: [], changed_paths: [], on_unknown_changes: "allow" },
    repositories: {},
  };
  let section = "";
  let repo = "";
  let field: keyof Rules | "" = "";
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const spaces = line.length - line.trimStart().length;
    const value = line.trim();
    if (spaces === 0) {
      section = value.replace(/:$/, "");
      repo = "";
      field = "";
    } else if (section === "repositories" && spaces === 2 && value.endsWith(":")) {
      repo = value.slice(0, -1);
      config.repositories[repo] = { workflows: [], changed_paths: [], on_unknown_changes: "allow" };
      field = "";
    } else {
      const target = section === "defaults" ? config.defaults : config.repositories[repo];
      if (!target) continue;
      if ((section === "defaults" && spaces === 2) || (section === "repositories" && spaces === 4)) {
        const colon = value.indexOf(":");
        if (colon < 0) continue;
        const key = value.slice(0, colon);
        if (key !== "workflows" && key !== "changed_paths" && key !== "on_unknown_changes") continue;
        field = key;
        const scalar = value.slice(colon + 1).trim();
        if (key === "on_unknown_changes") target.on_unknown_changes = scalar;
      } else if (field && field !== "on_unknown_changes" && value.startsWith("- ")) {
        const item = value.slice(2).trim().replace(/^["']|["']$/g, "");
        if (item) target[field].push(item);
      }
    }
  }
  return config;
}

const config = readConfig(configYaml);

function matchesPath(path: string, pattern: string): boolean {
  if (!pattern || pattern.length > 256 || !/^[\w./*?+-]+$/.test(pattern)) return false;
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { regex += "(?:.*/)?"; i++; }
      else regex += ".*";
    } else if (c === "*") regex += "[^/]*";
    else if (c === "?") regex += "[^/]";
    else regex += (c === "." || c === "+" ? "\\" + c : c);
  }
  return new RegExp(regex + "$").test(path);
}

export function matchesPatterns(path: string, patterns: string[]): boolean {
  const positive = patterns.filter(p => !p.startsWith("!"));
  const negative = patterns.filter(p => p.startsWith("!")).map(p => p.slice(1));
  return (positive.length === 0 || positive.some(p => matchesPath(path, p))) &&
    !negative.some(p => matchesPath(path, p));
}

export function selectGithubWorkflow(payload: unknown): { allowed: boolean; reason?: string } {
  if (!payload || typeof payload !== "object") return { allowed: false, reason: "invalid_payload" };
  const root = payload as Record<string, unknown>;
  const repo = root.repository as Record<string, unknown> | undefined;
  const run = root.workflow_run as Record<string, unknown> | undefined;
  const name = typeof repo?.full_name === "string" ? repo.full_name : "";
  const path = typeof run?.path === "string" ? run.path : "";
  const rules = config.repositories[name] ?? config.defaults;
  if (!path || !matchesPatterns(path, rules.workflows)) {
    return { allowed: false, reason: "workflow_path_filtered" };
  }
  return { allowed: true };
}

export function repositoryNotificationRules(repository: string): Rules {
  return config.repositories[repository] ?? config.defaults;
}
