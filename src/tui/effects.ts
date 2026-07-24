import {
  type AuthHealthOptions,
  type AuthHealthResult,
  collectAuthHealth,
} from "../core/auth.js";
import {
  listConfigSnapshots,
  restoreConfigSnapshot,
  saveConfig,
} from "../core/config-store.js";
import { checkProjectPolicy, type PolicyCheckResult } from "../core/policy.js";
import { findProjectRoot } from "../core/project-config.js";
import type { IdealityConfig } from "../domain/config.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import { installGitIntegration } from "../integrations/git.js";
import { installShims } from "../integrations/shims.js";

export interface TuiIntegrationTargets {
  home: string;
  idealityHome: string;
}

function requireDashboardSnapshot(
  restored: Awaited<ReturnType<typeof restoreConfigSnapshot>>,
): { snapshot: string; config: IdealityConfig } {
  if (!restored.config) {
    throw new Error(
      `Snapshot '${restored.snapshot}' uses registry version ${restored.version} and cannot be managed in the dashboard. Run 'ideality rollback ${restored.snapshot}', then 'ideality config migrate' and 'ideality install'.`,
    );
  }
  return { snapshot: restored.snapshot, config: restored.config };
}

async function syncIntegrations(
  config: IdealityConfig,
  targets: TuiIntegrationTargets,
): Promise<void> {
  await installShims(config, targets.idealityHome);
  await installGitIntegration(config, targets.home, targets.idealityHome);
  await syncInstalledCompletions(config, targets.idealityHome);
}

/** Atomically persist the staged draft, snapshotting the previous config. */
export async function saveDraftConfig(
  draft: IdealityConfig,
  configPath: string,
  integration?: TuiIntegrationTargets,
): Promise<void> {
  await saveConfig(draft, configPath);
  if (integration) {
    await syncIntegrations(draft, integration);
  }
}

/** List rollback snapshots, newest first. */
export async function loadRollbackSnapshots(
  configPath: string,
): Promise<string[]> {
  return listConfigSnapshots(configPath);
}

/** Load a snapshot's config without touching the active registry. */
export async function previewRollbackSnapshot(
  snapshot: string,
  configPath: string,
): Promise<{ snapshot: string; config: IdealityConfig }> {
  return requireDashboardSnapshot(
    await restoreConfigSnapshot(snapshot, configPath, { dryRun: true }),
  );
}

/** Restore a snapshot through the transactional config store. */
export async function applyRollbackSnapshot(
  snapshot: string,
  configPath: string,
  integration?: TuiIntegrationTargets,
): Promise<{ snapshot: string; config: IdealityConfig }> {
  const restored = requireDashboardSnapshot(
    await restoreConfigSnapshot(snapshot, configPath, { dryRun: true }),
  );
  await saveConfig(restored.config, configPath);
  if (integration) {
    await syncIntegrations(restored.config, integration);
  }
  return restored;
}

/** Probe redacted auth health for every enabled identity/tool pairing. */
export async function probeAuthHealth(
  config: IdealityConfig,
  options: AuthHealthOptions,
): Promise<AuthHealthResult[]> {
  return collectAuthHealth(config, options);
}

/** Evaluate the team policy for the project containing `projectPath`. */
export async function loadPolicyStatus(
  projectPath: string,
): Promise<PolicyCheckResult> {
  return checkProjectPolicy(await findProjectRoot(projectPath));
}
