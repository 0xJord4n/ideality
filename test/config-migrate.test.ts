import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  migrateConfigFile,
  planConfigMigration,
  type ConfigMigrationStep,
} from "../src/core/config-migrate.js";
import {
  getHistoryDirectory,
  listConfigSnapshots,
  loadConfig,
  restoreConfigSnapshot,
} from "../src/core/config-store.js";

const currentConfig = {
  version: 1,
  defaultIdentity: "sample",
  identities: {
    sample: { label: "Sample", roots: ["/workspace"], tools: {} },
  },
  tools: {},
};

const legacyConfig = {
  version: 0,
  identities: {
    sample: { label: "Sample", roots: ["/workspace"], tools: {} },
  },
  tools: {},
};

const legacyRegistry: readonly ConfigMigrationStep[] = [
  {
    from: 0,
    to: 1,
    description: "add defaultIdentity",
    migrate: (config) => ({ ...config, defaultIdentity: "sample" }),
  },
];

async function writeConfig(value: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-migrate-"));
  const configPath = path.join(directory, "config.jsonc");
  await Bun.write(configPath, `${JSON.stringify(value, null, 2)}\n`);
  return configPath;
}

describe("config migration planning", () => {
  test("reports an already-current registry", () => {
    expect(planConfigMigration(currentConfig)).toEqual({
      status: "current",
      version: 1,
    });
  });

  test("fails clearly on a future registry version", () => {
    expect(() => planConfigMigration({ ...currentConfig, version: 2 })).toThrow(
      "Registry version 2 is newer than this ideality build supports (1)",
    );
  });

  test("fails clearly when no migration step is registered", () => {
    expect(() => planConfigMigration(legacyConfig)).toThrow(
      "No registered migration from registry version 0 toward 1",
    );
  });

  test("fails clearly when the registry lacks a version field", () => {
    expect(() => planConfigMigration({ identities: {} })).toThrow(
      "Registry has no integer 'version' field",
    );
  });
});

describe("config migrate", () => {
  test("dry-run reports the plan without touching the registry", async () => {
    const configPath = await writeConfig(legacyConfig);
    const before = await Bun.file(configPath).text();
    const result = await migrateConfigFile(configPath, {
      dryRun: true,
      registry: legacyRegistry,
    });
    expect(result.status).toBe("dry-run");
    expect(result.steps).toEqual(["0 -> 1: add defaultIdentity"]);
    expect(await Bun.file(configPath).text()).toBe(before);
    expect(await listConfigSnapshots(configPath)).toHaveLength(0);
  });

  test("migrates, validates, and snapshots the pre-migration registry", async () => {
    const configPath = await writeConfig(legacyConfig);
    const before = await Bun.file(configPath).text();
    const result = await migrateConfigFile(configPath, {
      registry: legacyRegistry,
    });
    expect(result.status).toBe("migrated");
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    const migrated = await loadConfig(configPath);
    expect(migrated.version).toBe(1);
    expect(migrated.defaultIdentity).toBe("sample");
    const snapshots = await listConfigSnapshots(configPath);
    expect(snapshots).toHaveLength(1);
    expect(result.snapshot).toBe(
      path.join(getHistoryDirectory(configPath), snapshots[0]!),
    );
    expect(await Bun.file(result.snapshot!).text()).toBe(before);
  });

  test("is a no-op on an already-current registry", async () => {
    const configPath = await writeConfig(currentConfig);
    const result = await migrateConfigFile(configPath, {
      registry: legacyRegistry,
    });
    expect(result.status).toBe("current");
    expect(await listConfigSnapshots(configPath)).toHaveLength(0);
  });
});

describe("rollback of pre-migration snapshots", () => {
  test("migrate then rollback restores the exact pre-migration bytes", async () => {
    const configPath = await writeConfig(legacyConfig);
    const before = await Bun.file(configPath).text();
    await migrateConfigFile(configPath, { registry: legacyRegistry });
    const restored = await restoreConfigSnapshot("latest", configPath);
    expect(restored.version).toBe(0);
    expect(restored.config).toBeNull();
    expect(await Bun.file(configPath).text()).toBe(before);
    expect(await listConfigSnapshots(configPath)).toHaveLength(2);
  });

  test("dry-run leaves the migrated registry and snapshots untouched", async () => {
    const configPath = await writeConfig(legacyConfig);
    await migrateConfigFile(configPath, { registry: legacyRegistry });
    const migrated = await Bun.file(configPath).text();
    const restored = await restoreConfigSnapshot("latest", configPath, {
      dryRun: true,
    });
    expect(restored.version).toBe(0);
    expect(restored.config).toBeNull();
    expect(await Bun.file(configPath).text()).toBe(migrated);
    expect(await listConfigSnapshots(configPath)).toHaveLength(1);
  });

  test("rejects restoring a snapshot newer than the supported version", async () => {
    const configPath = await writeConfig(currentConfig);
    const history = getHistoryDirectory(configPath);
    const name = "2099-01-01T00-00-00.000Z-deadbeef.jsonc";
    await Bun.write(
      path.join(history, name),
      `${JSON.stringify({ ...currentConfig, version: 2 }, null, 2)}\n`,
    );
    await expect(restoreConfigSnapshot(name, configPath)).rejects.toThrow(
      "newer than this ideality build supports (1)",
    );
  });
});

describe("versioned registry loading", () => {
  test("loadConfig fails clearly on a future version", async () => {
    const configPath = await writeConfig({ ...currentConfig, version: 2 });
    await expect(loadConfig(configPath)).rejects.toThrow(
      "newer than this ideality build supports (1)",
    );
  });

  test("loadConfig points older versions at 'ideality config migrate'", async () => {
    const configPath = await writeConfig(legacyConfig);
    await expect(loadConfig(configPath)).rejects.toThrow(
      "Run 'ideality config migrate'",
    );
  });
});
