import path from "node:path";

import type {
  AuthAction,
  IdealityConfig,
  IdentityConfig,
  ResolvedIdentity,
  ToolDefinition,
  ToolProfile,
} from "../domain/config.js";
import {
  buildChildEnvironment,
  buildEnvironment,
  isSensitiveVariable,
  type ResolvedEnvironment,
} from "./environment.js";
import { runProcess, type ProcessRunner } from "./process.js";
import { expandHome } from "./resolution.js";
import { resolveExecutable } from "./runtime.js";

export function authArguments(
  definition: ToolDefinition,
  action: AuthAction,
): string[] {
  const args = definition.auth?.[action];
  if (!args) {
    throw new Error(
      `Tool '${definition.description ?? definition.executable}' does not support auth ${action}`,
    );
  }
  return [...args];
}

export type AuthHealthState =
  | "logged-in"
  | "expired"
  | "unavailable"
  | "unsupported";

export interface AuthHealthResult {
  identity: string;
  tool: string;
  state: AuthHealthState;
  executable: string | null;
  detail: string;
}

export interface AuthHealthOptions {
  home: string;
  idealityHome?: string;
  timeoutMs?: number;
  runner?: ProcessRunner;
  resolveExecutable?: (tool: string, profileExecutable?: string) => string | null;
}

export const DEFAULT_AUTH_STATUS_TIMEOUT_MS = 10_000;

const DETAIL_LIMIT = 160;

const TOKEN_PATTERNS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b[A-Za-z0-9_-]{32,}\b/g,
] as const;

/** Mask exact secret values and common token shapes in captured output. */
export function redactAuthOutput(
  text: string,
  secretValues: Iterable<string> = [],
): string {
  let output = text;
  for (const value of secretValues) {
    if (value.length >= 4) {
      output = output.replaceAll(value, "<redacted>");
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    output = output.replace(pattern, "<redacted>");
  }
  return output;
}

/** Probe auth status for every configured identity/tool pairing. */
export async function collectAuthHealth(
  config: IdealityConfig,
  options: AuthHealthOptions,
): Promise<AuthHealthResult[]> {
  const idealityHome =
    options.idealityHome ?? path.join(options.home, ".ideality");
  const results: AuthHealthResult[] = [];
  for (const [id, identity] of sortedEntries(config.identities)) {
    const resolved = resolveForHealth(config, id, identity, options.home);
    for (const [tool, profile] of sortedEntries(identity.tools)) {
      if (profile.enabled === false) continue;
      results.push(
        await probeToolAuthHealth(config, resolved, tool, profile, {
          ...options,
          idealityHome,
        }),
      );
    }
  }
  return results;
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function resolveForHealth(
  config: IdealityConfig,
  id: string,
  identity: IdentityConfig,
  home: string,
): ResolvedIdentity {
  const primaryRoot = identity.roots[0]
    ? expandHome(identity.roots[0], home)
    : home;
  return {
    id,
    identity,
    path: primaryRoot,
    matchedRoot: primaryRoot,
    isDefault: id === config.defaultIdentity,
  };
}

async function probeToolAuthHealth(
  config: IdealityConfig,
  resolved: ResolvedIdentity,
  tool: string,
  profile: ToolProfile,
  options: AuthHealthOptions & { idealityHome: string },
): Promise<AuthHealthResult> {
  const base = { identity: resolved.id, tool };
  const definition = config.tools[tool];
  const statusArgs = definition?.auth?.status;
  if (!definition || !statusArgs) {
    return {
      ...base,
      state: "unsupported",
      executable: null,
      detail: "no auth status workflow configured",
    };
  }
  const resolve =
    options.resolveExecutable ??
    ((name: string, profileExecutable?: string) =>
      resolveExecutable(config, name, profileExecutable));
  const executable = resolve(tool, profile.executable);
  if (!executable) {
    return {
      ...base,
      state: "unavailable",
      executable: null,
      detail: `executable '${definition.executable}' is not installed`,
    };
  }
  let environment: ResolvedEnvironment;
  try {
    environment = await buildEnvironment(config, resolved, {
      home: options.home,
      idealityHome: options.idealityHome,
      tool,
    });
  } catch (error) {
    return {
      ...base,
      state: "unavailable",
      executable,
      detail: truncateDetail(
        `environment failed: ${redactAuthOutput(errorMessage(error))}`,
      ),
    };
  }
  const secretValues = environmentSecretValues(environment);
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_STATUS_TIMEOUT_MS;
  const runner = options.runner ?? runProcess;
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = {
    ...base,
    state: "unavailable" as const,
    executable,
    detail: `status probe timed out after ${timeoutMs}ms`,
  };
  try {
    const result = await runner(
      [executable, ...environment.args, ...statusArgs],
      {
        env: buildChildEnvironment(config, environment),
        signal,
      },
    );
    if (signal.aborted) {
      return timedOut;
    }
    const summary = summarizeOutput(result.stdout, result.stderr, secretValues);
    if (result.exitCode === 0) {
      return {
        ...base,
        state: "logged-in",
        executable,
        detail: summary || "authenticated",
      };
    }
    return {
      ...base,
      state: "expired",
      executable,
      detail: summary
        ? `exit ${result.exitCode}: ${summary}`
        : `exit ${result.exitCode}`,
    };
  } catch (error) {
    if (signal.aborted) {
      return timedOut;
    }
    return {
      ...base,
      state: "unavailable",
      executable,
      detail: truncateDetail(
        redactAuthOutput(errorMessage(error), secretValues),
      ),
    };
  }
}

function environmentSecretValues(environment: ResolvedEnvironment): string[] {
  return Object.entries(environment.values)
    .filter(
      ([name, value]) =>
        value.length >= 4 &&
        (environment.redacted[name]?.startsWith("<secret:") ||
          isSensitiveVariable(name)),
    )
    .map(([, value]) => value);
}

function summarizeOutput(
  stdout: string,
  stderr: string,
  secretValues: string[],
): string {
  const firstLine =
    [stdout, stderr]
      .flatMap((chunk) => chunk.split("\n"))
      .map((line) => line.replace(/\u001B\[[0-9;]*m/g, "").trim())
      .find((line) => line.length > 0) ?? "";
  return truncateDetail(redactAuthOutput(firstLine, secretValues));
}

function truncateDetail(text: string): string {
  return text.length > DETAIL_LIMIT
    ? `${text.slice(0, DETAIL_LIMIT - 3)}...`
    : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
