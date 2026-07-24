import { CONFIG_VERSION, type IdealityConfig } from "../domain/config.js";
import {
  createConfigSnapshot,
  getConfigPath,
  parseJsonc,
  readRegistryVersion,
  saveConfig,
  validateConfig,
} from "./config-store.js";

export interface ConfigMigrationStep {
  from: number;
  to: number;
  description: string;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Explicit registry of schema migrations. Version 1 is the only released
 * schema, so the registry is intentionally empty; a future version bump adds
 * a step here (e.g. `{ from: 1, to: 2, ... }`) alongside raising
 * CONFIG_VERSION. Pre-migration snapshots restore through the standard
 * `ideality rollback` path.
 */
export const configMigrations: readonly ConfigMigrationStep[] = [];

export type ConfigMigrationPlan =
  | { status: "current"; version: number }
  | {
      status: "migrate";
      fromVersion: number;
      toVersion: number;
      steps: ConfigMigrationStep[];
    };

export function planConfigMigration(
  value: unknown,
  registry: readonly ConfigMigrationStep[] = configMigrations,
  targetVersion: number = CONFIG_VERSION,
): ConfigMigrationPlan {
  const fromVersion = readRegistryVersion(value);
  if (fromVersion === undefined) {
    throw new Error("Registry has no integer 'version' field");
  }
  if (fromVersion === targetVersion) {
    return { status: "current", version: fromVersion };
  }
  if (fromVersion > targetVersion) {
    throw new Error(
      `Registry version ${fromVersion} is newer than this ideality build supports (${targetVersion}). Upgrade ideality instead of migrating.`,
    );
  }
  const steps: ConfigMigrationStep[] = [];
  let version = fromVersion;
  while (version < targetVersion) {
    const step = registry.find((candidate) => candidate.from === version);
    if (!step) {
      throw new Error(
        `No registered migration from registry version ${version} toward ${targetVersion}`,
      );
    }
    if (step.to <= step.from || step.to > targetVersion) {
      throw new Error(
        `Migration step ${step.from} -> ${step.to} is invalid for target version ${targetVersion}`,
      );
    }
    steps.push(step);
    version = step.to;
  }
  return { status: "migrate", fromVersion, toVersion: targetVersion, steps };
}

/** Apply steps in order; the framework stamps `version` after each step. */
export function applyConfigMigrations(
  value: unknown,
  steps: readonly ConfigMigrationStep[],
): IdealityConfig {
  let migrated = structuredClone(value) as Record<string, unknown>;
  for (const step of steps) {
    migrated = step.migrate(migrated);
    migrated.version = step.to;
  }
  return validateConfig(migrated);
}

export interface ConfigMigrationResult {
  status: "current" | "dry-run" | "migrated";
  fromVersion: number;
  toVersion: number;
  steps: string[];
  snapshot?: string;
}

export async function migrateConfigFile(
  configPath: string = getConfigPath(),
  options: {
    dryRun?: boolean;
    registry?: readonly ConfigMigrationStep[];
  } = {},
): Promise<ConfigMigrationResult> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`No ideality config at '${configPath}'. Run 'ideality init'.`);
  }
  const raw = parseJsonc(await file.text());
  const plan = planConfigMigration(raw, options.registry);
  if (plan.status === "current") {
    return {
      status: "current",
      fromVersion: plan.version,
      toVersion: plan.version,
      steps: [],
    };
  }
  const migrated = applyConfigMigrations(raw, plan.steps);
  const steps = plan.steps.map(
    (step) => `${step.from} -> ${step.to}: ${step.description}`,
  );
  if (options.dryRun) {
    return {
      status: "dry-run",
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      steps,
    };
  }
  const snapshot = await createConfigSnapshot(configPath);
  await saveConfig(migrated, configPath, { snapshot: false });
  return {
    status: "migrated",
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    steps,
    snapshot: snapshot ?? undefined,
  };
}
