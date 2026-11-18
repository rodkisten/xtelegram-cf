import configYaml from "../../config/github-notify.yaml";
import YAML from "yaml";

type Rules = { workflows: string[]; changed_paths: string[]; on_unknown_changes: string };
type Config = { defaults: Rules; repositories: Record<string, Rules> };

/** Parse the versioned YAML using a real YAML parser and validate its schema. */
export function readConfig(source: string): Config {
  const raw: unknown = YAML.parse(source, { uniqueKeys: true, strict: true });
  const object = (value: unknown, label: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be a mapping");
    return value as Record<string, unknown>;
  };
  const root = object(raw, "GitHub notification config");
  if (root.version !== 1) throw new Error("Unsupported GitHub notification config version");
  const normalize = (value: unknown, label: string): Rules => {
    const rule = object(value, label);
    const patterns = (key: "workflows" | "changed_paths"): string[] => {
      const list = rule[key];
      if (!Array.isArray(list) || !list.every(item => typeof item === "string" && item.length > 0)) {
        throw new Error(label + "." + key + " must be a list of nonempty strings");
      }
      return list;
    };
    const policy = rule.on_unknown_changes;
    if (policy !== "allow" && policy !== "deny") throw new Error(label + ".on_unknown_changes must be allow or deny");
    return { workflows: patterns("workflows"), changed_paths: patterns("changed_paths"), on_unknown_changes: policy };
  };
  const repos = object(root.repositories, "repositories");
  const repositories: Record<string, Rules> = Object.create(null);
  for (const [name, value] of Object.entries(repos)) {
    if (!/^[\\w.-]+\\/[\\w.-]+$/.test(name)) throw new Error("Invalid repository: " + name);
    repositories[name] = normalize(value, "repositories." + name);
  }
  return { defaults: normalize(root.defaults, "defaults"), repositories };
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
