import type { Env } from "../types";

/**
 * CPU-heavy processing is opt-in. The global flag enables it for every request;
 * `force_cpu=true` enables it only for the current request.
 */
export function resolveCpuHeavyEnabled(
  env: Pick<Env, "ENABLE_CPU_HEAVY">,
  request?: Request | null,
  explicitValue?: unknown,
): boolean {
  if (isTruthyFlag(env.ENABLE_CPU_HEAVY)) return true;
  if (isTruthyFlag(explicitValue)) return true;
  if (!request) return false;

  try {
    const url = new URL(request.url);
    return isTruthyFlag(url.searchParams.get("force_cpu")) ||
      isTruthyFlag(url.searchParams.get("forceCpu"));
  } catch {
    return false;
  }
}

export function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function cpuHeavyRequestValue(record: Record<string, unknown>): unknown {
  return record.force_cpu ?? record.forceCpu;
}
