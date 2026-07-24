import { describe, expect, test } from "bun:test";

import { readdirSync } from "node:fs";
import path from "node:path";

import {
  BUILTIN_TOOL_MANIFESTS,
  BUILTIN_TOOL_PACKS,
  BUILTIN_TOOLS,
} from "../src/adapters/builtins.js";
import { parseToolAdapterManifest } from "../src/core/tool-adapters.js";

const catalogDirectory = path.resolve(import.meta.dir, "../catalog");

describe("catalog manifests", () => {
  test("ships exactly one manifest file per built-in tool", () => {
    // Behavior contracts live in the contracts/ subdirectory; manifests are
    // the only files directly inside catalog/.
    const files = readdirSync(catalogDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    expect(files).toEqual(
      Object.keys(BUILTIN_TOOLS)
        .map((id) => `${id}.jsonc`)
        .sort(),
    );
  });

  test("parses every manifest strictly and round-trips it into the registry", async () => {
    for (const id of Object.keys(BUILTIN_TOOLS)) {
      const source = await Bun.file(
        path.join(catalogDirectory, `${id}.jsonc`),
      ).text();
      const manifest = parseToolAdapterManifest(source);
      expect(manifest.id).toBe(id);
      expect(BUILTIN_TOOL_MANIFESTS[id]).toEqual(manifest);
    }
  });

  test("derives tool definitions and packs from the manifests", () => {
    expect(Object.keys(BUILTIN_TOOL_MANIFESTS)).toEqual(
      Object.keys(BUILTIN_TOOLS),
    );
    for (const [id, manifest] of Object.entries(BUILTIN_TOOL_MANIFESTS)) {
      const definition = BUILTIN_TOOLS[id]!;
      expect(definition.description).toBe(manifest.displayName);
      expect(definition.executable).toBe(manifest.executable.primary);
      expect(definition.pack).toBe(manifest.pack);
      expect(definition.isolation).toBe(manifest.isolation.scope);
      expect(definition.stateIsolation).toBe(manifest.isolation.state);
      expect(BUILTIN_TOOL_PACKS[manifest.pack]?.tools).toContain(id);
    }
  });

  test("represents Gerrit's SSH key as an identity-derived argument", () => {
    expect(BUILTIN_TOOL_MANIFESTS.gerrit?.profile?.args).toEqual([
      { fromIdentity: "sshKey", prefix: ["-i"] },
    ]);
  });
});
