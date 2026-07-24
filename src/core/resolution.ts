import path from "node:path";

import type { IdealityConfig, ResolvedIdentity } from "../domain/config.js";

export function expandHome(value: string, home: string): string {
  if (value === "~") {
    return home;
  }
  if (value.startsWith("~/")) {
    return path.join(home, value.slice(2));
  }
  return path.resolve(value);
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolveIdentity(
  config: IdealityConfig,
  candidatePath: string,
  home: string,
): ResolvedIdentity {
  const absolutePath = path.resolve(candidatePath);
  const matches = Object.entries(config.identities)
    .flatMap(([id, identity]) =>
      identity.roots.map((root) => ({
        id,
        identity,
        root: expandHome(root, home),
      })),
    )
    .filter((entry) => containsPath(entry.root, absolutePath))
    .sort((left, right) => right.root.length - left.root.length);

  const match = matches[0];
  if (match) {
    return {
      id: match.id,
      identity: match.identity,
      path: absolutePath,
      matchedRoot: match.root,
      isDefault: false,
    };
  }

  const identity = config.identities[config.defaultIdentity];
  if (!identity) {
    throw new Error(
      `Default identity '${config.defaultIdentity}' does not exist`,
    );
  }

  return {
    id: config.defaultIdentity,
    identity,
    path: absolutePath,
    matchedRoot: null,
    isDefault: true,
  };
}
