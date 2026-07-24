import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  type AuthHealthOptions,
  type AuthHealthResult,
  collectAuthHealth,
} from "../core/auth.js";
import {
  type SecretReferenceList,
  deleteSecretValue,
  listSecretReferences,
  writeSecretValue,
} from "../core/secret-backends.js";
import {
  listConfigSnapshots,
  loadConfig,
  restoreConfigSnapshot,
  saveConfig,
} from "../core/config-store.js";
import {
  applyPlugin,
  listPluginManifests,
  parsePluginManifest,
  removePluginManifest,
  writePluginManifest,
} from "../core/plugins.js";
import { checkProjectPolicy, type PolicyCheckResult } from "../core/policy.js";
import { findProjectRoot } from "../core/project-config.js";
import type { IdealityConfig } from "../domain/config.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import { installGitIntegration } from "../integrations/git.js";
import { installShims } from "../integrations/shims.js";
import type { PluginAdminEntry } from "./state.js";

export interface TuiIntegrationTargets {
  home: string;
  idealityHome: string;
}

export interface PluginAdminEffectHooks {
  loadConfig?: typeof loadConfig;
  saveConfig?: typeof saveConfig;
  listPluginManifests?: typeof listPluginManifests;
  writePluginManifest?: typeof writePluginManifest;
  removePluginManifest?: typeof removePluginManifest;
  installShims?: typeof installShims;
  syncInstalledCompletions?: typeof syncInstalledCompletions;
}

interface ManifestSnapshot {
  file: string;
  source: string;
}

function pluginEffectHooks(
  hooks: PluginAdminEffectHooks = {},
): Required<PluginAdminEffectHooks> {
  return {
    loadConfig,
    saveConfig,
    listPluginManifests,
    writePluginManifest,
    removePluginManifest,
    installShims,
    syncInstalledCompletions,
    ...hooks,
  };
}

async function readManifestSnapshot(
  file: string | null,
): Promise<ManifestSnapshot | null> {
  if (!file) return null;
  return { file, source: await Bun.file(file).text() };
}

async function restoreManifestSnapshot(
  snapshot: ManifestSnapshot,
): Promise<void> {
  await mkdir(path.dirname(snapshot.file), { recursive: true, mode: 0o700 });
  await Bun.write(snapshot.file, snapshot.source);
  await chmod(snapshot.file, 0o600);
}

async function rollbackPluginTransaction(
  steps: Array<() => Promise<void>>,
): Promise<void> {
  for (const step of steps.reverse()) {
    try {
      await step();
    } catch {
      // Preserve the original failure; rollback is best-effort compensation.
    }
  }
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

function redactedPluginEnv(
  manifest: Awaited<ReturnType<typeof parsePluginManifest>>,
): string[] {
  return Object.entries(manifest.profile?.env ?? {})
    .map(([name, source]) => {
      if (typeof source === "string") return `${name}=<literal>`;
      if (!source) return `${name}=<unset>`;
      if (source.from === "secret") return `${name}=<secret:reference>`;
      if (source.from === "file") return `${name}=<file:reference>`;
      if (source.from === "env") return `${name}=<env:${source.name}>`;
      return `${name}=<source>`;
    })
    .sort();
}

/** Load canonical installed plugin manifests with redacted metadata only. */
export async function loadPluginAdmin(
  idealityHome: string,
  config: IdealityConfig,
): Promise<PluginAdminEntry[]> {
  return (await listPluginManifests(idealityHome)).map(
    ({ file, manifest }) => ({
      id: manifest.id,
      displayName: manifest.displayName,
      description: manifest.description ?? null,
      executable: manifest.executable.primary,
      file,
      active: Boolean(config.tools[manifest.id]),
      profileCount: Object.values(config.identities).filter(
        (identity) => identity.tools[manifest.id],
      ).length,
      env: redactedPluginEnv(manifest),
      args: manifest.profile?.args?.length ?? 0,
    }),
  );
}

/** Validate, install, persist, and refresh plugin integrations. */
export async function installPluginPath(
  manifestPath: string,
  configPath: string,
  integration: TuiIntegrationTargets,
  hooks?: PluginAdminEffectHooks,
): Promise<{ config: IdealityConfig }> {
  const ops = pluginEffectHooks(hooks);
  const manifest = parsePluginManifest(await Bun.file(manifestPath).text());
  const config = await ops.loadConfig(configPath);
  const installed = await ops.listPluginManifests(integration.idealityHome);
  const existingEntry =
    installed.find((entry) => entry.manifest.id === manifest.id) ?? null;
  const previousManifest = await readManifestSnapshot(
    existingEntry?.file ?? null,
  );
  if (config.tools[manifest.id] && !existingEntry) {
    throw new Error(
      `Tool '${manifest.id}' already exists and is not an installed plugin`,
    );
  }
  const next = applyPlugin(config, manifest);
  const rollback: Array<() => Promise<void>> = [];
  try {
    await ops.saveConfig(next, configPath);
    rollback.push(() => ops.saveConfig(config, configPath));

    await ops.writePluginManifest(manifest, integration.idealityHome);
    rollback.push(async () => {
      if (previousManifest) await restoreManifestSnapshot(previousManifest);
      else
        await ops.removePluginManifest(manifest.id, integration.idealityHome);
    });

    await ops.installShims(next, integration.idealityHome);
    rollback.push(async () => {
      await ops.installShims(config, integration.idealityHome);
    });

    await ops.syncInstalledCompletions(next, integration.idealityHome);
  } catch (error) {
    await rollbackPluginTransaction(rollback);
    await ops
      .syncInstalledCompletions(config, integration.idealityHome)
      .catch(() => undefined);
    throw error;
  }
  return { config: next };
}

/** Remove an installed plugin and refresh affected integrations. */
export async function removeInstalledPlugin(
  id: string,
  configPath: string,
  integration: TuiIntegrationTargets,
  hooks?: PluginAdminEffectHooks,
): Promise<{ config: IdealityConfig }> {
  const ops = pluginEffectHooks(hooks);
  const installed = await ops.listPluginManifests(integration.idealityHome);
  const installedEntry = installed.find((entry) => entry.manifest.id === id);
  if (!installedEntry) {
    throw new Error(`Plugin '${id}' is not installed`);
  }
  const previousManifest = await readManifestSnapshot(installedEntry.file);
  if (!previousManifest) {
    throw new Error(`Plugin '${id}' manifest could not be read`);
  }
  const config = await ops.loadConfig(configPath);
  const next = structuredClone(config);
  delete next.tools[id];
  for (const identity of Object.values(next.identities)) {
    delete identity.tools[id];
  }
  const rollback: Array<() => Promise<void>> = [];
  try {
    await ops.saveConfig(next, configPath);
    rollback.push(() => ops.saveConfig(config, configPath));

    await ops.removePluginManifest(id, integration.idealityHome);
    rollback.push(() => restoreManifestSnapshot(previousManifest));

    await ops.installShims(next, integration.idealityHome);
    rollback.push(async () => {
      await ops.installShims(config, integration.idealityHome);
    });

    await ops.syncInstalledCompletions(next, integration.idealityHome);
  } catch (error) {
    await rollbackPluginTransaction(rollback);
    await ops
      .syncInstalledCompletions(config, integration.idealityHome)
      .catch(() => undefined);
    throw error;
  }
  return { config: next };
}

/** Load backend-owned secret references without values. */
export async function loadSecretAdmin(
  config: IdealityConfig,
  integration: TuiIntegrationTargets,
): Promise<SecretReferenceList> {
  return listSecretReferences(
    config,
    integration.home,
    integration.idealityHome,
  );
}

/** Write a secret value without returning it to reducer state. */
export async function writeTuiSecret(
  key: string,
  value: string,
  configPath: string,
  integration: TuiIntegrationTargets,
): Promise<void> {
  await writeSecretValue(
    await loadConfig(configPath),
    key,
    value,
    integration.home,
    integration.idealityHome,
  );
}

/** Delete a secret reference after the reducer has recorded explicit confirmation. */
export async function deleteTuiSecret(
  key: string,
  configPath: string,
  integration: TuiIntegrationTargets,
): Promise<void> {
  await deleteSecretValue(
    await loadConfig(configPath),
    key,
    integration.home,
    integration.idealityHome,
  );
}
