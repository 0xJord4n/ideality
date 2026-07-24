import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

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
    const found = findExecutable(candidate, {
      excludedDirectories: [path.join(getIdealityHome(), "bin")],
    });
    if (found) {
      return found;
    }
  }
  return null;
}

export function findExecutable(
  command: string,
  options: {
    pathValue?: string;
    excludedDirectories?: string[];
  } = {},
): string | null {
  const excluded = new Set(
    (options.excludedDirectories ?? []).map((directory) =>
      path.resolve(directory),
    ),
  );
  const executable = (candidate: string): string | null => {
    const resolved = path.resolve(candidate);
    if (excluded.has(path.dirname(resolved))) return null;
    try {
      accessSync(resolved, constants.X_OK);
      return resolved;
    } catch {
      return null;
    }
  };

  if (command.includes(path.sep)) {
    return executable(command);
  }

  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (options.pathValue ?? process.env.PATH ?? "").split(
    path.delimiter,
  )) {
    if (!directory) continue;
    for (const extension of extensions) {
      const found = executable(path.join(directory, `${command}${extension}`));
      if (found) return found;
    }
  }
  return null;
}
