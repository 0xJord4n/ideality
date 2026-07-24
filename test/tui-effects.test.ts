import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type ConfigMigrationStep,
  migrateConfigFile,
} from "../src/core/config-migrate.js";
import { loadConfig } from "../src/core/config-store.js";
import type { IdealityConfig } from "../src/domain/config.js";
import {
  applyRollbackSnapshot,
  loadRollbackSnapshots,
  previewRollbackSnapshot,
  saveDraftConfig,
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
});
