import { describe, expect, test } from "bun:test";

import path from "node:path";

import {
  BUILTIN_TOOL_PACKS,
  BUILTIN_TOOLS,
  DEFAULT_TOOL_PACKS,
  type ToolPack,
} from "../src/adapters/builtins.js";
import { createToolProfiles } from "../src/core/starter.js";
import type { ToolDefinition, ToolProfile } from "../src/domain/config.js";

interface LegacyFixture {
  builtinTools: Record<string, ToolDefinition>;
  builtinToolPacks: Record<string, ToolPack>;
  defaultToolPacks: string[];
  profilesWithSshKey: Record<string, ToolProfile>;
  profilesWithoutSshKey: Record<string, ToolProfile>;
}

const fixture = (await Bun.file(
  path.resolve(import.meta.dir, "fixtures/catalog-legacy.json"),
).json()) as LegacyFixture;

function resolutionCandidates(definition: ToolDefinition): string[] {
  return [...new Set([definition.executable, ...(definition.detect ?? [])])];
}

function withoutDetect(
  definition: ToolDefinition,
): Omit<ToolDefinition, "detect"> {
  const { detect: _detect, ...rest } = definition;
  return rest;
}

// The lock guarantees the legacy catalog survives unchanged; adapters ADDED
// after the migration are allowed on top, so every assertion compares the
// legacy subset rather than exact key sets.
describe("catalog migration regression lock", () => {
  test("keeps every built-in tool definition equivalent to the legacy map", () => {
    for (const id of Object.keys(fixture.builtinTools)) {
      expect(BUILTIN_TOOLS[id]).toBeDefined();
    }
    for (const [id, legacy] of Object.entries(fixture.builtinTools)) {
      const current = BUILTIN_TOOLS[id]!;
      // detect is locked as the executable-resolution candidate list
      // (executable first, then aliases, deduplicated) because manifests may
      // not repeat the primary executable inside alternatives; legacy chrome
      // did, redundantly, and resolution order is identical either way.
      expect(resolutionCandidates(current)).toEqual(
        resolutionCandidates(legacy),
      );
      expect(withoutDetect(current)).toEqual(withoutDetect(legacy));
    }
  });

  test("keeps tool packs and default pack selection identical", () => {
    for (const [id, legacy] of Object.entries(fixture.builtinToolPacks)) {
      const current = BUILTIN_TOOL_PACKS[id]!;
      expect(current.label).toBe(legacy.label);
      expect(current.description).toBe(legacy.description);
      for (const tool of legacy.tools) {
        expect(current.tools).toContain(tool);
      }
    }
    expect(DEFAULT_TOOL_PACKS).toEqual(fixture.defaultToolPacks);
  });

  test("keeps every starter profile identical, including Gerrit SSH keys", () => {
    const withKey = createToolProfiles(
      "sample",
      undefined,
      "/home/sample/.ssh/id_ed25519",
    );
    for (const [id, legacy] of Object.entries(fixture.profilesWithSshKey)) {
      expect(withKey[id]).toEqual(legacy);
    }
    const withoutKey = createToolProfiles("sample");
    for (const [id, legacy] of Object.entries(fixture.profilesWithoutSshKey)) {
      expect(withoutKey[id]).toEqual(legacy);
    }
  });
});
