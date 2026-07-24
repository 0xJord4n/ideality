import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type ConfigMigrationStep,
  migrateConfigFile,
} from "../src/core/config-migrate.js";
import { loadConfig } from "../src/core/config-store.js";
import type { IdealityConfig } from "../src/domain/config.js";
import {
  installCompletion,
  renderCompletion,
  syncInstalledCompletions,
  type CompletionShell,
} from "../src/integrations/completion.js";
import { installShims } from "../src/integrations/shims.js";
import {
  applyRollbackSnapshot,
  deleteTuiSecret,
  installPluginPath,
  loadPluginAdmin,
  loadSecretAdmin,
  loadRollbackSnapshots,
  previewRollbackSnapshot,
  removeInstalledPlugin,
  saveDraftConfig,
  writeTuiSecret,
} from "../src/tui/effects.js";
import {
  canApplyRollback,
  createTuiState,
  isDirty,
  tuiReducer,
} from "../src/tui/state.js";

function sample(): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "personal",
    identities: {
      personal: {
        label: "Personal",
        roots: ["~/code/personal"],
        tools: { gh: {} },
      },
    },
    tools: { gh: { executable: "gh" } },
  };
}

function pluginManifest(id = "acme"): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "tool",
    id,
    displayName: "Acme",
    description: "Deploy CLI",
    pack: "custom",
    executable: { primary: "acme" },
    isolation: { scope: "process", state: "partial" },
    profile: {
      env: {
        ACME_TOKEN: { from: "secret", key: "{{identity}}/acme" },
      },
      args: ["--profile", "{{identity}}"],
    },
  });
}

type TreeSnapshot = Record<string, string>;

const COMPLETION_SHELLS: CompletionShell[] = ["zsh", "bash", "fish"];

async function readDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const files: TreeSnapshot = {};
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readDirectoryEntries(directory);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        await visit(file, relative);
      } else if (entry.isFile()) {
        files[relative] = await Bun.file(file).text();
      }
    }
  }
  await visit(root, "");
  return files;
}

async function installIntegrationFiles(
  config: IdealityConfig,
  idealityHome: string,
): Promise<void> {
  await installShims(config, idealityHome);
  const values = {
    identities: Object.keys(config.identities).sort(),
    tools: Object.keys(config.tools).sort(),
  };
  for (const shell of COMPLETION_SHELLS) {
    await installCompletion(
      shell,
      renderCompletion(shell, values),
      idealityHome,
    );
  }
}

const legacyRegistry: readonly ConfigMigrationStep[] = [
  {
    from: 0,
    to: 1,
    description: "add defaultIdentity",
    migrate: (config) => ({ ...config, defaultIdentity: "personal" }),
  },
];

describe("tui staged save and rollback round trip", () => {
  test("stages, saves atomically with history, previews and restores", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    await saveDraftConfig(sample(), configPath);

    let state = createTuiState(await loadConfig(configPath), "personal");
    state = tuiReducer(state, { type: "focus-next-pane" });
    state = tuiReducer(state, { type: "toggle-tool" });
    expect(isDirty(state)).toBe(true);

    await saveDraftConfig(state.draft, configPath);
    state = tuiReducer(state, { type: "save-succeeded", config: state.draft });
    expect(isDirty(state)).toBe(false);
    expect(
      (await loadConfig(configPath)).identities.personal?.tools.gh?.enabled,
    ).toBe(false);

    const snapshots = await loadRollbackSnapshots(configPath);
    expect(snapshots).toHaveLength(1);
    state = tuiReducer(state, { type: "open-screen", screen: "rollback" });
    state = tuiReducer(state, { type: "rollback-loaded", snapshots });

    const preview = await previewRollbackSnapshot(snapshots[0]!, configPath);
    state = tuiReducer(state, { type: "rollback-previewed", ...preview });
    expect(state.rollback.preview?.diff.length).toBeGreaterThan(0);
    expect(
      (await loadConfig(configPath)).identities.personal?.tools.gh?.enabled,
    ).toBe(false);
    expect(canApplyRollback(state)).toEqual({ ok: true });

    const restored = await applyRollbackSnapshot(preview.snapshot, configPath);
    state = tuiReducer(state, { type: "rollback-applied", ...restored });
    expect(state.screen).toBe("dashboard");
    expect(isDirty(state)).toBe(false);
    expect(
      (await loadConfig(configPath)).identities.personal?.tools.gh?.enabled,
    ).toBeUndefined();
  });

  test("rejects saving a draft that fails schema validation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const broken = sample();
    broken.defaultIdentity = "ghost";
    await expect(saveDraftConfig(broken, configPath)).rejects.toThrow(
      "does not exist",
    );
  });

  test("rejects historical-schema snapshots without changing the active registry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const legacy = { ...sample(), version: 0, defaultIdentity: undefined };
    await Bun.write(configPath, `${JSON.stringify(legacy, null, 2)}\n`);
    await migrateConfigFile(configPath, { registry: legacyRegistry });

    await expect(previewRollbackSnapshot("latest", configPath)).rejects.toThrow(
      "ideality rollback",
    );
    await expect(applyRollbackSnapshot("latest", configPath)).rejects.toThrow(
      "ideality rollback",
    );
    expect((await loadConfig(configPath)).version).toBe(1);
  });

  test("installs and removes plugins through transactional TUI effects", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    const manifestPath = path.join(directory, "acme.jsonc");
    await saveDraftConfig(sample(), configPath);
    await Bun.write(manifestPath, pluginManifest());

    const installed = await installPluginPath(manifestPath, configPath, {
      home: directory,
      idealityHome,
    });
    expect(installed.config.tools.acme?.executable).toBe("acme");
    expect(
      await Bun.file(path.join(idealityHome, "plugins/acme.jsonc")).exists(),
    ).toBe(true);

    const listed = await loadPluginAdmin(idealityHome, installed.config);
    expect(listed).toEqual([
      {
        id: "acme",
        displayName: "Acme",
        description: "Deploy CLI",
        executable: "acme",
        file: path.join(idealityHome, "plugins/acme.jsonc"),
        active: true,
        profileCount: 1,
        env: ["ACME_TOKEN=<secret:reference>"],
        args: 2,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("{{identity}}/acme");

    const removed = await removeInstalledPlugin("acme", configPath, {
      home: directory,
      idealityHome,
    });
    expect(removed.config.tools.acme).toBeUndefined();
    expect(
      await Bun.file(path.join(idealityHome, "plugins/acme.jsonc")).exists(),
    ).toBe(false);
  });

  test("rolls plugin install back when integration refresh fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    const manifestPath = path.join(directory, "acme.jsonc");
    await saveDraftConfig(sample(), configPath);
    await Bun.write(manifestPath, pluginManifest());

    await expect(
      installPluginPath(
        manifestPath,
        configPath,
        { home: directory, idealityHome },
        {
          installShims: async () => {
            throw new Error("shim refresh failed");
          },
        },
      ),
    ).rejects.toThrow("shim refresh failed");

    expect((await loadConfig(configPath)).tools.acme).toBeUndefined();
    expect(
      await Bun.file(path.join(idealityHome, "plugins/acme.jsonc")).exists(),
    ).toBe(false);
  });

  test("rolls plugin removal back when integration refresh fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    const manifestPath = path.join(directory, "acme.jsonc");
    await saveDraftConfig(sample(), configPath);
    await Bun.write(manifestPath, pluginManifest());
    await installPluginPath(manifestPath, configPath, {
      home: directory,
      idealityHome,
    });

    await expect(
      removeInstalledPlugin(
        "acme",
        configPath,
        { home: directory, idealityHome },
        {
          installShims: async () => {
            throw new Error("shim refresh failed");
          },
        },
      ),
    ).rejects.toThrow("shim refresh failed");

    expect((await loadConfig(configPath)).tools.acme?.executable).toBe("acme");
    expect(
      await Bun.file(path.join(idealityHome, "plugins/acme.jsonc")).exists(),
    ).toBe(true);
  });

  test("restores config, manifest absence, shims, and completions when plugin install completion sync fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    const manifestPath = path.join(directory, "acme.jsonc");
    const config = sample();
    await saveDraftConfig(config, configPath);
    await Bun.write(manifestPath, pluginManifest());
    await installIntegrationFiles(config, idealityHome);

    const beforeConfig = await Bun.file(configPath).text();
    const beforePlugins = await snapshotTree(
      path.join(idealityHome, "plugins"),
    );
    const beforeShims = await snapshotTree(path.join(idealityHome, "bin"));
    const beforeCompletions = await snapshotTree(
      path.join(idealityHome, "completions"),
    );

    await expect(
      installPluginPath(
        manifestPath,
        configPath,
        { home: directory, idealityHome },
        {
          syncInstalledCompletions: async (next, home) => {
            await syncInstalledCompletions(next, home);
            throw new Error("completion sync failed");
          },
        },
      ),
    ).rejects.toThrow("completion sync failed");

    expect(await Bun.file(configPath).text()).toBe(beforeConfig);
    expect(await snapshotTree(path.join(idealityHome, "plugins"))).toEqual(
      beforePlugins,
    );
    expect(await snapshotTree(path.join(idealityHome, "bin"))).toEqual(
      beforeShims,
    );
    expect(await snapshotTree(path.join(idealityHome, "completions"))).toEqual(
      beforeCompletions,
    );
  });

  test("restores config, installed manifest, shims, and completions when plugin removal completion sync fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    const manifestPath = path.join(directory, "acme.jsonc");
    await saveDraftConfig(sample(), configPath);
    await Bun.write(manifestPath, pluginManifest());
    await installIntegrationFiles(await loadConfig(configPath), idealityHome);
    const installed = await installPluginPath(manifestPath, configPath, {
      home: directory,
      idealityHome,
    });

    const beforeConfig = await Bun.file(configPath).text();
    const beforePlugins = await snapshotTree(
      path.join(idealityHome, "plugins"),
    );
    const beforeShims = await snapshotTree(path.join(idealityHome, "bin"));
    const beforeCompletions = await snapshotTree(
      path.join(idealityHome, "completions"),
    );
    expect(installed.config.tools.acme?.executable).toBe("acme");

    await expect(
      removeInstalledPlugin(
        "acme",
        configPath,
        { home: directory, idealityHome },
        {
          syncInstalledCompletions: async (next, home) => {
            await syncInstalledCompletions(next, home);
            throw new Error("completion sync failed");
          },
        },
      ),
    ).rejects.toThrow("completion sync failed");

    expect(await Bun.file(configPath).text()).toBe(beforeConfig);
    expect(await snapshotTree(path.join(idealityHome, "plugins"))).toEqual(
      beforePlugins,
    );
    expect(await snapshotTree(path.join(idealityHome, "bin"))).toEqual(
      beforeShims,
    );
    expect(await snapshotTree(path.join(idealityHome, "completions"))).toEqual(
      beforeCompletions,
    );
  });

  test("loads, writes, and deletes TUI secrets without returning values", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-tui-"));
    const configPath = path.join(directory, "config.jsonc");
    const idealityHome = path.join(directory, ".ideality");
    await saveDraftConfig(sample(), configPath);

    await writeTuiSecret("personal/acme", "private-value", configPath, {
      home: directory,
      idealityHome,
    });
    const listed = await loadSecretAdmin(await loadConfig(configPath), {
      home: directory,
      idealityHome,
    });
    expect(listed).toEqual({
      backend: "file",
      supported: true,
      writable: true,
      references: ["personal/acme"],
    });
    expect(JSON.stringify(listed)).not.toContain("private-value");

    await deleteTuiSecret("personal/acme", configPath, {
      home: directory,
      idealityHome,
    });
    expect(
      await Bun.file(path.join(idealityHome, "secrets/personal/acme")).exists(),
    ).toBe(false);
  });
});
