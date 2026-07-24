import { describe, expect, test } from "bun:test";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkCatalogEntries,
  checkRegistryCompleteness,
  checkSchemaSync,
  computeDocsUpdates,
  loadCatalog,
  loadRegistry,
  manifestVariableName,
  registerManifestImport,
  renderCatalogSummary,
  renderManifestTemplate,
  renderToolPackMatrix,
  replaceGeneratedBlock,
  REPO_ROOT,
} from "../scripts/catalog-lib.js";
import { parseToolAdapterManifest } from "../src/core/tool-adapters.js";

function withTempCatalog(
  files: Record<string, string>,
  run: (directory: string) => Promise<void> | void,
): Promise<void> | void {
  const directory = mkdtempSync(path.join(tmpdir(), "catalog-tooling-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), content);
  }
  const cleanup = (): void => rmSync(directory, { recursive: true, force: true });
  try {
    const result = run(directory);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function manifestSource(
  id: string,
  overrides: Partial<{ pack: string; primary: string; alternatives: string[] }> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "tool",
    id,
    displayName: `${id} tool`,
    pack: overrides.pack ?? "essentials",
    executable: {
      primary: overrides.primary ?? id,
      ...(overrides.alternatives ? { alternatives: overrides.alternatives } : {}),
    },
  });
}

describe("manifest scaffolding", () => {
  test("renders a deterministic minimal manifest byte for byte", () => {
    const rendered = renderManifestTemplate({
      id: "acme",
      displayName: "Acme CLI",
      pack: "deployment",
    });
    expect(rendered).toBe(`// Acme CLI - built-in tool adapter manifest.
{
  "schemaVersion": 1,
  "kind": "tool",
  "id": "acme",
  "displayName": "Acme CLI",
  "pack": "deployment",
  "executable": {
    "primary": "acme"
  },
  "isolation": {
    "scope": "process",
    "state": "partial"
  }
  // Optional blocks - uncomment to use (add a comma after "isolation" first):
  // "auth": { "login": ["login"], "status": ["whoami"], "logout": ["logout"] },
  // "profile": {
  //   "env": { "ACME_CONFIG_DIR": "{{idealityHome}}/profiles/{{identity}}/acme" }
  // }
}
`);
    expect(
      renderManifestTemplate({ id: "acme", displayName: "Acme CLI", pack: "deployment" }),
    ).toBe(rendered);
  });

  test("scaffolded manifests parse strictly with the runtime parser", () => {
    const rendered = renderManifestTemplate({
      id: "kiro-cli2",
      displayName: "Kiro CLI 2",
      pack: "ai",
      executable: "kiro2",
      description: "Second Kiro command line",
      alternatives: ["kiro2-cli"],
      shim: false,
      isolationScope: "process",
      isolationState: "credentials",
    });
    const manifest = parseToolAdapterManifest(rendered);
    expect(manifest.id).toBe("kiro-cli2");
    expect(manifest.description).toBe("Second Kiro command line");
    expect(manifest.executable).toEqual({
      primary: "kiro2",
      alternatives: ["kiro2-cli"],
      shim: false,
    });
    expect(manifest.isolation).toEqual({ scope: "process", state: "credentials" });
  });

  test("derives registry variable names from adapter IDs", () => {
    expect(manifestVariableName("gh")).toBe("ghManifest");
    expect(manifestVariableName("kiro-cli")).toBe("kiroCliManifest");
    expect(manifestVariableName("a_b-c")).toBe("aBCManifest");
  });

  test("registers a new manifest import and source entry in builtins.ts", async () => {
    const source = await Bun.file(
      path.join(REPO_ROOT, "src/adapters/builtins.ts"),
    ).text();
    const updated = registerManifestImport(source, "acme");
    expect(updated).toContain(
      'import acmeManifest from "../../catalog/acme.jsonc" with { type: "text" };',
    );
    expect(updated).toMatch(/ {2}acmeManifest,\n\];/);
    expect(() => registerManifestImport(updated, "acme")).toThrow(
      /already registered/,
    );
  });

  test("rejects builtins sources without the expected anchors", () => {
    expect(() => registerManifestImport("export {};\n", "acme")).toThrow(
      /Could not find/,
    );
  });
});

describe("catalog checks", () => {
  test("flags filename/ID mismatches, unknown packs, and duplicate executables", async () => {
    await withTempCatalog(
      {
        "alpha.jsonc": manifestSource("alpha"),
        "beta.jsonc": manifestSource("mismatch"),
        "gamma.jsonc": manifestSource("gamma", { pack: "unknown-pack" }),
        "delta.jsonc": manifestSource("delta", { alternatives: ["alpha"] }),
        "broken.jsonc": "{ not valid",
        "stray.txt": "not a manifest",
      },
      async (directory) => {
        const { entries, issues } = await loadCatalog(directory);
        const loadMessages = issues.map((issue) => issue.message).join("\n");
        expect(loadMessages).toContain("broken.jsonc");
        expect(loadMessages).toContain("stray.txt");

        const checkIssues = checkCatalogEntries(entries, ["essentials"]);
        const messages = checkIssues.map((issue) => issue.message).join("\n");
        expect(messages).toContain("beta.jsonc");
        expect(messages).toContain("mismatch");
        expect(messages).toContain("unknown-pack");
        expect(messages).toContain("'alpha'");
        expect(messages).not.toContain("alpha.jsonc: ");
      },
    );
  });

  test("flags catalog files missing from the registry and vice versa", () => {
    const registered = parseToolAdapterManifest(manifestSource("alpha"));
    const unregistered = parseToolAdapterManifest(manifestSource("beta"));
    const issues = checkRegistryCompleteness(
      [
        { id: "alpha", file: "catalog/alpha.jsonc", manifest: registered },
        { id: "beta", file: "catalog/beta.jsonc", manifest: unregistered },
      ],
      { alpha: registered, ghost: registered },
    );
    const messages = issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain("not registered");
    expect(messages).toContain("ghost");
  });

  test("accepts the shipped catalog, registry, and editor schema", async () => {
    const { registry, issue } = await loadRegistry();
    expect(issue).toBeUndefined();
    if (!registry) throw new Error("registry failed to load");
    const { entries, issues } = await loadCatalog();
    expect(issues).toEqual([]);
    expect(
      checkCatalogEntries(entries, Object.keys(registry.packs)),
    ).toEqual([]);
    expect(checkRegistryCompleteness(entries, registry.manifests)).toEqual([]);
    expect(await checkSchemaSync()).toEqual([]);
  });
});

describe("docs generation", () => {
  const packs = {
    essentials: { label: "Developer essentials", description: "Everyday tools" },
  };

  test("renders the tool-pack matrix deterministically from catalog data", () => {
    const entries = [
      {
        id: "beta",
        file: "catalog/beta.jsonc",
        manifest: parseToolAdapterManifest(manifestSource("beta")),
      },
      {
        id: "alpha",
        file: "catalog/alpha.jsonc",
        manifest: parseToolAdapterManifest(manifestSource("alpha")),
      },
    ];
    const matrix = renderToolPackMatrix(entries, packs);
    expect(matrix).toContain("| Pack | Adapters (isolation grade) |");
    expect(matrix).toContain("| Developer essentials | `alpha` (partial), `beta` (partial) |");
    const summary = renderCatalogSummary(entries, packs);
    expect(summary).toContain("2 adapters across 1 selectable pack");
    expect(summary).toContain("- **Developer essentials**: `alpha`, `beta`");
  });

  test("replaces only the content between generation markers", () => {
    const content = [
      "before",
      "<!-- generated:sample:begin -->",
      "old body",
      "<!-- generated:sample:end -->",
      "after",
    ].join("\n");
    const updated = replaceGeneratedBlock(content, "sample", "new body");
    expect(updated).toContain("before\n<!-- generated:sample:begin -->\nnew body\n<!-- generated:sample:end -->\nafter");
    expect(updated).not.toContain("old body");
    expect(() => replaceGeneratedBlock("no markers", "sample", "x")).toThrow(
      /generated:sample/,
    );
  });

  test("shipped docs are fresh against the generated blocks", async () => {
    const updates = await computeDocsUpdates();
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.updated).toBe(update.current);
    }
  });
});

describe("catalog-check command", () => {
  test("passes on the shipped repository", async () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", path.join(REPO_ROOT, "scripts/catalog-check.ts")],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(output).toContain("catalog check passed");
    expect(result.exitCode).toBe(0);
  });
});
