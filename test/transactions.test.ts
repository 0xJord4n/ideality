import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listConfigSnapshots,
  loadConfig,
  restoreConfigSnapshot,
  saveConfig,
} from "../src/core/config-store.js";
import type { IdealityConfig } from "../src/domain/config.js";

function sample(label: string): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    identities: {
      sample: { label, roots: ["/workspace"], tools: {} },
    },
    tools: {},
  };
}

describe("config transactions", () => {
  test("snapshots the old registry and restores it atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-history-"));
    const configPath = path.join(directory, "config.jsonc");
    await saveConfig(sample("Before"), configPath);
    await saveConfig(sample("After"), configPath);
    const snapshots = await listConfigSnapshots(configPath);
    expect(snapshots).toHaveLength(1);
    expect((await restoreConfigSnapshot("latest", configPath)).snapshot).toBe(
      snapshots[0]!,
    );
    expect((await loadConfig(configPath)).identities.sample?.label).toBe("Before");
  });

  test("dry-run validates a snapshot without changing the registry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-dry-"));
    const configPath = path.join(directory, "config.jsonc");
    await saveConfig(sample("Before"), configPath);
    await saveConfig(sample("After"), configPath);
    await restoreConfigSnapshot(undefined, configPath, { dryRun: true });
    expect((await loadConfig(configPath)).identities.sample?.label).toBe("After");
  });
});
