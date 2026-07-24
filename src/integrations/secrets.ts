import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { expandHome, resolveIdentity } from "../core/resolution.js";
import type { IdealityConfig, ResolvedIdentity } from "../domain/config.js";

export function resolveSecretContext(
  config: IdealityConfig,
  identityId: string,
  home: string,
  sourcePath: string,
  candidatePath?: string,
): ResolvedIdentity {
  const identity = config.identities[identityId];
  if (!identity) {
    throw new Error(`Identity '${identityId}' does not exist`);
  }
  if (sourcePath.includes("{{root}}")) {
    if (!candidatePath) {
      throw new Error(
        `Secret path for '${identityId}' uses {{root}} and requires --path`,
      );
    }
    const resolved = resolveIdentity(config, candidatePath, home);
    if (resolved.id !== identityId || !resolved.matchedRoot) {
      throw new Error(
        `Path '${candidatePath}' is not inside a root owned by '${identityId}'`,
      );
    }
    return resolved;
  }

  const root = expandHome(identity.roots[0]!, home);
  return {
    id: identityId,
    identity,
    path: root,
    matchedRoot: root,
    isDefault: identityId === config.defaultIdentity,
  };
}

export function listSecretContexts(
  config: IdealityConfig,
  identityId: string,
  home: string,
  sourcePath: string,
): ResolvedIdentity[] {
  const identity = config.identities[identityId]!;
  if (!sourcePath.includes("{{root}}")) {
    return [resolveSecretContext(config, identityId, home, sourcePath)];
  }
  return identity.roots.map((configuredRoot) => {
    const root = expandHome(configuredRoot, home);
    return {
      id: identityId,
      identity,
      path: root,
      matchedRoot: root,
      isDefault: identityId === config.defaultIdentity,
    };
  });
}

export async function writeSecret(file: string, value: string): Promise<void> {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Secret value cannot be empty");
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await Bun.write(temporary, `${normalized}\n`);
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}
