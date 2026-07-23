import os from "node:os";

import type { IdealityConfig, ResolvedIdentity } from "../domain/config.js";
import { getIdealityHome, loadConfig } from "./config-store.js";
import { resolveIdentity } from "./resolution.js";

export interface RuntimeContext {
  config: IdealityConfig;
  resolved: ResolvedIdentity;
  home: string;
  idealityHome: string;
}

export async function loadRuntime(
  candidatePath: string,
  identityId?: string,
): Promise<RuntimeContext> {
  const config = await loadConfig();
  const home = os.homedir();
  const idealityHome = getIdealityHome();
  if (!identityId) {
    return {
      config,
      idealityHome,
      resolved: resolveIdentity(config, candidatePath, home),
      home,
    };
  }

  const identity = config.identities[identityId];
  if (!identity) {
    throw new Error(`Identity '${identityId}' does not exist`);
  }
  return {
    config,
    home,
    idealityHome,
    resolved: {
      id: identityId,
      identity,
      path: candidatePath,
      matchedRoot: null,
      isDefault: identityId === config.defaultIdentity,
    },
  };
}

export function resolveExecutable(
  config: IdealityConfig,
  tool: string,
  profileExecutable?: string,
): string | null {
  const definition = config.tools[tool];
  const candidates = [
    profileExecutable,
    definition?.executable,
    ...(definition?.detect ?? []),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const found = Bun.which(candidate);
    if (found) {
      return found;
    }
  }
  return candidates[0] ?? null;
}
