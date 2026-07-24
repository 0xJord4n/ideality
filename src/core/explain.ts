import path from "node:path";

import type { IdealityConfig, ResolvedIdentity } from "../domain/config.js";
import { buildEnvironment, type EnvironmentOptions } from "./environment.js";
import { type ResolvedExecution, resolveExecution } from "./execution.js";

export interface ToolExplanation {
  identity: string;
  label: string;
  path: string;
  matchedRoot: string | null;
  fallback: boolean;
  tool: string;
  executable: string | null;
  shim: string;
  intercepted: boolean;
  isolation: "shell" | "process";
  arguments: string[];
  environment: Record<string, string>;
  unset: string[];
  execution: {
    target: ResolvedExecution["target"];
    source: ResolvedExecution["source"];
    vm: string | null;
    network: string | null;
  };
}

export async function explainTool(
  config: IdealityConfig,
  resolved: ResolvedIdentity,
  options: EnvironmentOptions & {
    tool: string;
    executable: string | null;
    intercepted?: boolean;
  },
): Promise<ToolExplanation> {
  const profile = resolved.identity.tools[options.tool];
  if (!profile || profile.enabled === false) {
    throw new Error(
      `Tool '${options.tool}' is not configured for '${resolved.id}'`,
    );
  }
  const environment = await buildEnvironment(config, resolved, options);
  const execution = resolveExecution(config, resolved, options.tool);
  const idealityHome =
    options.idealityHome ?? path.join(options.home, ".ideality");
  return {
    identity: resolved.id,
    label: resolved.identity.label,
    path: resolved.path,
    matchedRoot: resolved.matchedRoot,
    fallback: resolved.matchedRoot === null,
    tool: options.tool,
    executable: options.executable,
    shim: path.join(idealityHome, "bin", options.tool),
    intercepted: options.intercepted ?? true,
    isolation:
      profile.isolation ?? config.tools[options.tool]?.isolation ?? "process",
    arguments: environment.args,
    environment: environment.redacted,
    unset: environment.unset,
    execution: {
      target: execution.target,
      source: execution.source,
      vm: execution.vmId,
      network: execution.networkId,
    },
  };
}
