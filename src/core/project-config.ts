import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  ExecutionTarget,
  IdealityConfig,
  NetworkProfile,
  ToolProfile,
  VmProfile,
} from "../domain/config.js";
import { loadConfig, saveConfig } from "./config-store.js";

export const PROJECT_DIRECTORY = ".ideality";
export const PROJECT_CONFIG_FILE = "project.jsonc";

export function getProjectConfigPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_DIRECTORY, PROJECT_CONFIG_FILE);
}

async function pathExists(candidate: string): Promise<boolean> {
  return Boolean(await stat(candidate).catch(() => null));
}

export async function findProjectRoot(candidatePath: string): Promise<string> {
  let current = path.resolve(candidatePath);
  const info = await stat(current).catch(() => null);
  if (!info) {
    throw new Error(`Project path '${candidatePath}' does not exist`);
  }
  if (!info.isDirectory()) current = path.dirname(current);
  const startingDirectory = current;

  while (true) {
    if (
      (await Bun.file(getProjectConfigPath(current)).exists()) ||
      (await pathExists(path.join(current, ".git")))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return startingDirectory;
    current = parent;
  }
}

export async function loadProjectConfig(
  projectRoot: string,
): Promise<IdealityConfig | null> {
  const configPath = getProjectConfigPath(projectRoot);
  return (await Bun.file(configPath).exists()) ? loadConfig(configPath) : null;
}

export async function saveProjectConfig(
  projectRoot: string,
  config: IdealityConfig,
): Promise<string> {
  const configPath = getProjectConfigPath(projectRoot);
  await saveConfig(config, configPath, { snapshot: false });
  return configPath;
}

export function createProjectConfig(
  config: IdealityConfig,
  identityId: string,
  selectedTools: string[],
  options: { requirementsOnly?: boolean } = {},
): IdealityConfig {
  const identity = config.identities[identityId];
  if (!identity) throw new Error(`Identity '${identityId}' does not exist`);
  const tools = [...new Set(selectedTools)].sort();
  if (tools.length === 0) {
    throw new Error("Select at least one tool");
  }
  for (const tool of tools) {
    if (!config.tools[tool]) {
      throw new Error(`Tool '${tool}' does not exist`);
    }
  }

  const profiles: Record<string, ToolProfile> = {};
  for (const tool of tools) {
    profiles[tool] = {
      ...structuredClone(identity.tools[tool] ?? {}),
      enabled: true,
    };
  }

  const project: IdealityConfig = {
    version: 1,
    defaultIdentity: identityId,
    ...(!options.requirementsOnly && config.secretBackend
      ? { secretBackend: structuredClone(config.secretBackend) }
      : {}),
    identities: {
      [identityId]: options.requirementsOnly
        ? {
            label: identity.label,
            roots: ["."],
            color: identity.color,
            tools: Object.fromEntries(
              tools.map((tool) => [tool, { enabled: true }]),
            ),
          }
        : {
            ...structuredClone(identity),
            roots: ["."],
            tools: profiles,
          },
    },
    tools: Object.fromEntries(
      tools.map((tool) => [tool, structuredClone(config.tools[tool]!)]),
    ),
  };
  if (!options.requirementsOnly) {
    const vmIds = new Set<string>();
    const networkIds = new Set<string>();
    collectExecutionReferences(identity.execution, vmIds, networkIds);
    for (const tool of tools) {
      collectExecutionReferences(
        identity.tools[tool]?.execution,
        vmIds,
        networkIds,
      );
    }

    const vms: Record<string, VmProfile> = {};
    for (const vmId of vmIds) {
      const vm = config.vms?.[vmId];
      if (!vm) continue;
      vms[vmId] = structuredClone(vm);
      if (vm.network) networkIds.add(vm.network);
    }
    const networks: Record<string, NetworkProfile> = {};
    for (const networkId of networkIds) {
      const network = config.networks?.[networkId];
      if (network) networks[networkId] = structuredClone(network);
    }
    if (Object.keys(vms).length > 0) project.vms = vms;
    if (Object.keys(networks).length > 0) project.networks = networks;
  }
  return project;
}

function collectExecutionReferences(
  execution: ExecutionTarget | undefined,
  vmIds: Set<string>,
  networkIds: Set<string>,
): void {
  if (!execution) return;
  if (execution.target === "vm") vmIds.add(execution.vm);
  if (execution.network) networkIds.add(execution.network);
}

export function applyProjectConfig(
  localConfig: IdealityConfig,
  projectConfig: IdealityConfig,
  projectRoot: string,
  targetIdentityId: string = projectConfig.defaultIdentity,
): IdealityConfig {
  const source = projectConfig.identities[projectConfig.defaultIdentity];
  if (!source) {
    throw new Error(
      `Project identity '${projectConfig.defaultIdentity}' does not exist`,
    );
  }
  const next = structuredClone(localConfig);
  Object.assign(next.tools, structuredClone(projectConfig.tools));
  if (projectConfig.networks) {
    next.networks = {
      ...(next.networks ?? {}),
      ...structuredClone(projectConfig.networks),
    };
  }
  if (projectConfig.vms) {
    next.vms = {
      ...(next.vms ?? {}),
      ...structuredClone(projectConfig.vms),
    };
  }
  if (projectConfig.secretBackend) {
    next.secretBackend = structuredClone(projectConfig.secretBackend);
  }

  const existing = next.identities[targetIdentityId];
  if (existing) {
    existing.roots = [
      ...new Set([...existing.roots, path.resolve(projectRoot)]),
    ];
    if (source.execution) {
      existing.execution = structuredClone(source.execution);
    }
    for (const [tool, profile] of Object.entries(source.tools)) {
      existing.tools[tool] = {
        ...structuredClone(existing.tools[tool] ?? {}),
        ...structuredClone(profile),
        enabled: true,
      };
    }
  } else {
    next.identities[targetIdentityId] = {
      ...structuredClone(source),
      roots: [path.resolve(projectRoot)],
      tools: Object.fromEntries(
        Object.entries(source.tools).map(([tool, profile]) => [
          tool,
          { ...structuredClone(profile), enabled: true },
        ]),
      ),
    };
  }
  return next;
}
