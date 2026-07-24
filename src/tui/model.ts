import type { SelectOption } from "@opentui/core";
import { resolveExecution } from "../core/execution.js";
import type { IdealityConfig } from "../domain/config.js";

export interface DashboardTool {
  name: string;
  executable: string;
  isolation: "shell" | "process";
  configured: boolean;
  enabled: boolean;
  installed: boolean;
  variables: number;
  arguments: number;
  target: "host" | "vm";
  vm: string | null;
  network: string | null;
}

export interface DashboardModel {
  identities: SelectOption[];
  selected: {
    id: string;
    label: string;
    color: string;
    isDefault: boolean;
    roots: string[];
    git: { name: string; email: string; sshKey?: string } | null;
    tools: DashboardTool[];
    execution: {
      target: "host" | "vm";
      vm: string | null;
      network: string | null;
    };
  };
}

export function buildDashboardModel(
  config: IdealityConfig,
  selectedId: string,
  executableExists: (executable: string) => boolean = (executable) =>
    Boolean(Bun.which(executable)),
): DashboardModel {
  const id = config.identities[selectedId]
    ? selectedId
    : config.defaultIdentity;
  const selected = config.identities[id]!;
  const resolved = {
    id,
    identity: selected,
    path: selected.roots[0]!,
    matchedRoot: selected.roots[0]!,
    isDefault: id === config.defaultIdentity,
  };
  const execution = resolveExecution(config, resolved);

  return {
    identities: Object.entries(config.identities).map(
      ([identityId, identity]) => ({
        name: `${identityId === config.defaultIdentity ? "* " : "  "}${identity.label}`,
        description: identity.roots.join(", "),
        value: identityId,
      }),
    ),
    selected: {
      id,
      label: selected.label,
      color: selected.color ?? "#22d3ee",
      isDefault: id === config.defaultIdentity,
      roots: selected.roots,
      git: selected.git ?? null,
      execution: {
        target: execution.target,
        vm: execution.vmId,
        network: execution.networkId,
      },
      tools: Object.entries(config.tools).map(([name, definition]) => {
        const profile = selected.tools[name];
        const candidates = [
          profile?.executable,
          definition.executable,
          ...(definition.detect ?? []),
        ].filter((value): value is string => Boolean(value));
        const toolExecution = resolveExecution(config, resolved, name);
        return {
          name,
          executable: candidates[0] ?? definition.executable,
          isolation: profile?.isolation ?? definition.isolation ?? "shell",
          configured: Boolean(profile),
          enabled: profile?.enabled !== false,
          installed: candidates.some(executableExists),
          variables: Object.keys(profile?.env ?? {}).length,
          arguments: profile?.args?.length ?? 0,
          target: toolExecution.target,
          vm: toolExecution.vmId,
          network: toolExecution.networkId,
        };
      }),
    },
  };
}
