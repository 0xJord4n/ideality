import { describe, expect, test } from "bun:test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkCatalogSafety,
  checkContracts,
  loadContracts,
  parseToolAdapterContract,
  renderContractTemplate,
  type ContractEntry,
} from "../scripts/catalog-contracts.js";
import {
  checkCatalogEntries,
  checkEditorSchemaMappings,
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
  type CatalogEntry,
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
  const cleanup = (): void =>
    rmSync(directory, { recursive: true, force: true });
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
  overrides: Partial<{
    pack: string;
    primary: string;
    alternatives: string[];
    isolation: unknown;
    auth: unknown;
    profile: unknown;
  }> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "tool",
    id,
    displayName: `${id} tool`,
    pack: overrides.pack ?? "essentials",
    executable: {
      primary: overrides.primary ?? id,
      ...(overrides.alternatives
        ? { alternatives: overrides.alternatives }
        : {}),
    },
    ...(overrides.isolation !== undefined
      ? { isolation: overrides.isolation }
      : {}),
    ...(overrides.auth !== undefined ? { auth: overrides.auth } : {}),
    ...(overrides.profile !== undefined ? { profile: overrides.profile } : {}),
  });
}

function catalogEntry(
  id: string,
  overrides: Parameters<typeof manifestSource>[1] = {},
): CatalogEntry {
  return {
    id,
    file: `${id}.jsonc`,
    manifest: parseToolAdapterManifest(manifestSource(id, overrides)),
  };
}

function contractSource(
  tool: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    contractVersion: 1,
    kind: "tool-contract",
    tool,
    detection: [tool],
    profiles: [{ case: "default" }],
    redactions: [],
    ...overrides,
  });
}

function contractEntry(
  tool: string,
  overrides: Record<string, unknown> = {},
): ContractEntry {
  return {
    tool,
    file: `${tool}.contract.jsonc`,
    contract: parseToolAdapterContract(contractSource(tool, overrides)),
  };
}

function issueMessages(issues: Array<{ message: string }>): string {
  return issues.map((issue) => issue.message).join("\n");
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
      renderManifestTemplate({
        id: "acme",
        displayName: "Acme CLI",
        pack: "deployment",
      }),
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
    expect(manifest.isolation).toEqual({
      scope: "process",
      state: "credentials",
    });
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
  test("requires editor schema mappings for manifests and behavior contracts", () => {
    const issues = checkEditorSchemaMappings({
      "json.schemas": [
        {
          fileMatch: ["/catalog/*.jsonc"],
          url: "./schemas/tool-adapter.v1.schema.json",
        },
      ],
    });

    expect(issues).toEqual([
      {
        file: ".vscode/settings.json",
        message:
          ".vscode/settings.json: missing JSON schema mapping './schemas/tool-adapter-contract.v1.schema.json' for '/catalog/contracts/*.contract.jsonc'",
      },
    ]);
  });

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
    expect(checkCatalogEntries(entries, Object.keys(registry.packs))).toEqual(
      [],
    );
    expect(checkRegistryCompleteness(entries, registry.manifests)).toEqual([]);
    expect(await checkSchemaSync()).toEqual([]);
  });
});

describe("docs generation", () => {
  const packs = {
    essentials: {
      label: "Developer essentials",
      description: "Everyday tools",
    },
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
    expect(matrix).toContain(
      "| Developer essentials | `alpha` (partial), `beta` (partial) |",
    );
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
    expect(updated).toContain(
      "before\n<!-- generated:sample:begin -->\nnew body\n<!-- generated:sample:end -->\nafter",
    );
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

describe("adapter behavior contracts", () => {
  test("parses a strict contract and rejects unknown fields, versions, and kinds", () => {
    const contract = parseToolAdapterContract(contractSource("gh"));
    expect(contract.tool).toBe("gh");
    expect(contract.detection).toEqual(["gh"]);

    expect(() =>
      parseToolAdapterContract(contractSource("gh", { hooks: ["rm -rf /"] })),
    ).toThrow("Invalid tool adapter contract");
    expect(() =>
      parseToolAdapterContract(contractSource("gh", { contractVersion: 2 })),
    ).toThrow("contractVersion");
    expect(() =>
      parseToolAdapterContract(contractSource("gh", { kind: "tool" })),
    ).toThrow("Invalid tool adapter contract");
    expect(() =>
      parseToolAdapterContract(contractSource("gh", { profiles: [] })),
    ).toThrow("Invalid tool adapter contract");
    expect(() =>
      parseToolAdapterContract(
        contractSource("gh", {
          profiles: [{ case: "default" }, { case: "default" }],
        }),
      ),
    ).toThrow("Duplicate contract case");
    expect(() =>
      parseToolAdapterContract(
        contractSource("gh", { redactions: ["GH_TOKEN", "GH_TOKEN"] }),
      ),
    ).toThrow("Duplicate redaction");
    expect(() => parseToolAdapterContract(`{"contractVersion": 1,,}`)).toThrow(
      "Invalid tool adapter contract JSONC",
    );
  });

  test("accepts a contract that locks detection, auth argv, and env compilation", () => {
    const entry = catalogEntry("gh", {
      alternatives: ["gh-insiders"],
      auth: { login: ["auth", "login"], status: ["auth", "status"] },
      profile: {
        env: { GH_CONFIG_DIR: "{{idealityHome}}/profiles/{{identity}}/gh" },
      },
    });
    const contract = contractEntry("gh", {
      detection: ["gh", "gh-insiders"],
      auth: {
        login: ["gh", "auth", "login"],
        status: ["gh", "auth", "status"],
      },
      profiles: [
        {
          case: "default",
          env: { GH_CONFIG_DIR: "{{idealityHome}}/profiles/{{identity}}/gh" },
        },
      ],
    });
    expect(checkContracts([entry], [contract])).toEqual([]);
  });

  test("flags detection drift with an expected-versus-actual message", () => {
    const entry = catalogEntry("gh", { alternatives: ["gh-insiders"] });
    const issues = checkContracts([entry], [contractEntry("gh")]);
    const messages = issueMessages(issues);
    expect(messages).toContain("gh.contract.jsonc");
    expect(messages).toContain("detection");
    expect(messages).toContain('"gh-insiders"');
  });

  test("flags auth drift in argv, coverage, and direction", () => {
    const entry = catalogEntry("gh", {
      auth: { login: ["auth", "login"], status: ["auth", "status"] },
    });

    const wrongArgv = checkContracts(
      [entry],
      [
        contractEntry("gh", {
          auth: {
            login: ["gh", "login"],
            status: ["gh", "auth", "status"],
          },
        }),
      ],
    );
    expect(issueMessages(wrongArgv)).toContain("auth login");
    expect(issueMessages(wrongArgv)).toContain('"auth","login"');

    const missingAction = checkContracts(
      [entry],
      [contractEntry("gh", { auth: { login: ["gh", "auth", "login"] } })],
    );
    expect(issueMessages(missingAction)).toContain("status");

    const uncontractedAuth = checkContracts([entry], [contractEntry("gh")]);
    expect(issueMessages(uncontractedAuth)).toContain("auth");

    const phantomAuth = checkContracts(
      [catalogEntry("gh")],
      [contractEntry("gh", { auth: { login: ["gh", "auth", "login"] } })],
    );
    expect(issueMessages(phantomAuth)).toContain("does not declare auth");
  });

  test("locks identity-derived arguments through emit and omit cases", () => {
    const entry = catalogEntry("gerrit", {
      primary: "ssh",
      profile: { args: [{ fromIdentity: "sshKey", prefix: ["-i"] }] },
    });
    const covered = contractEntry("gerrit", {
      detection: ["ssh"],
      profiles: [
        { case: "default" },
        {
          case: "with-ssh-key",
          identity: { sshKey: "/home/contract/.ssh/id_ed25519" },
          args: ["-i", "/home/contract/.ssh/id_ed25519"],
        },
      ],
    });
    expect(checkContracts([entry], [covered])).toEqual([]);

    const missingEmit = contractEntry("gerrit", {
      detection: ["ssh"],
      profiles: [{ case: "default" }],
    });
    expect(issueMessages(checkContracts([entry], [missingEmit]))).toContain(
      "sshKey",
    );

    const wrongArgs = contractEntry("gerrit", {
      detection: ["ssh"],
      profiles: [
        { case: "default" },
        {
          case: "with-ssh-key",
          identity: { sshKey: "/home/contract/.ssh/id_ed25519" },
          args: ["-i", "/somewhere/else"],
        },
      ],
    });
    expect(issueMessages(checkContracts([entry], [wrongArgs]))).toContain(
      "with-ssh-key",
    );
  });

  test("flags profile env drift against the compiled default profile", () => {
    const entry = catalogEntry("aws", {
      profile: { env: { AWS_CONFIG_FILE: "{{idealityHome}}/aws/config" } },
    });
    const issues = checkContracts(
      [entry],
      [contractEntry("aws", { profiles: [{ case: "default" }] })],
    );
    const messages = issueMessages(issues);
    expect(messages).toContain("default");
    expect(messages).toContain("AWS_CONFIG_FILE");
  });

  test("locks the secret-bearing redaction set in both directions", () => {
    const entry = catalogEntry("stripe", {
      profile: {
        env: {
          STRIPE_API_KEY: {
            from: "secret",
            key: "{{identity}}/stripe-api-key",
            optional: true,
          },
          XDG_CONFIG_HOME: "{{idealityHome}}/stripe/config",
        },
      },
    });
    const declared = contractEntry("stripe", {
      profiles: [
        {
          case: "default",
          env: {
            STRIPE_API_KEY: {
              from: "secret",
              key: "{{identity}}/stripe-api-key",
              optional: true,
            },
            XDG_CONFIG_HOME: "{{idealityHome}}/stripe/config",
          },
        },
      ],
      redactions: ["STRIPE_API_KEY"],
    });
    expect(checkContracts([entry], [declared])).toEqual([]);

    const undeclared = contractEntry("stripe", {
      profiles: declared.contract.profiles,
      redactions: [],
    });
    expect(issueMessages(checkContracts([entry], [undeclared]))).toContain(
      "STRIPE_API_KEY",
    );

    const phantom = contractEntry("stripe", {
      profiles: declared.contract.profiles,
      redactions: ["STRIPE_API_KEY", "XDG_CONFIG_HOME"],
    });
    expect(issueMessages(checkContracts([entry], [phantom]))).toContain(
      "XDG_CONFIG_HOME",
    );
  });

  test("flags contracts whose tool has no catalog manifest", () => {
    const issues = checkContracts([], [contractEntry("ghost")]);
    expect(issueMessages(issues)).toContain("ghost");
    expect(issueMessages(issues)).toContain("no catalog");
  });

  test("enforces universal safety invariants across all manifests", () => {
    expect(checkCatalogSafety([catalogEntry("clean")])).toEqual([]);

    const literalSecret = catalogEntry("leaky", {
      profile: { env: { LEAKY_API_TOKEN: "ghp_committed_credential" } },
    });
    expect(issueMessages(checkCatalogSafety([literalSecret]))).toContain(
      "LEAKY_API_TOKEN",
    );

    const shellSecret = catalogEntry("shelly", {
      isolation: { scope: "shell", state: "partial" },
      profile: {
        env: {
          SHELLY_HOME: {
            from: "secret",
            key: "{{identity}}/shelly",
            optional: true,
          },
        },
      },
    });
    expect(issueMessages(checkCatalogSafety([shellSecret]))).toContain("shell");

    const sharedSecret = catalogEntry("shared", {
      profile: {
        env: {
          SHARED_HOME: { from: "secret", key: "global-key", optional: true },
        },
      },
    });
    expect(issueMessages(checkCatalogSafety([sharedSecret]))).toContain(
      "{{identity}}",
    );
  });

  test("renders a deterministic contract stub that matches the scaffolded manifest", () => {
    const rendered = renderContractTemplate({
      id: "acme",
      displayName: "Acme CLI",
      pack: "deployment",
    });
    expect(rendered).toBe(
      renderContractTemplate({
        id: "acme",
        displayName: "Acme CLI",
        pack: "deployment",
      }),
    );
    const contract = parseToolAdapterContract(rendered);
    expect(contract.tool).toBe("acme");
    expect(contract.detection).toEqual(["acme"]);

    const manifest = parseToolAdapterManifest(
      renderManifestTemplate({
        id: "acme",
        displayName: "Acme CLI",
        pack: "deployment",
      }),
    );
    expect(
      checkContracts(
        [{ id: "acme", file: "acme.jsonc", manifest }],
        [{ tool: "acme", file: "acme.contract.jsonc", contract }],
      ),
    ).toEqual([]);

    const aliased = parseToolAdapterContract(
      renderContractTemplate({
        id: "acme",
        displayName: "Acme CLI",
        pack: "deployment",
        executable: "acme-cli",
        alternatives: ["acme2"],
      }),
    );
    expect(aliased.detection).toEqual(["acme-cli", "acme2"]);
  });

  test("loadContracts flags stray files, filename mismatches, and parse failures", async () => {
    await withTempCatalog(
      {
        "gh.contract.jsonc": contractSource("gh"),
        "mismatch.contract.jsonc": contractSource("other"),
        "broken.contract.jsonc": "{ not valid",
        "stray.txt": "not a contract",
      },
      async (directory) => {
        const { contracts, issues } = await loadContracts(directory);
        expect(contracts.map((entry) => entry.tool)).toEqual(["gh"]);
        const messages = issueMessages(issues);
        expect(messages).toContain("mismatch.contract.jsonc");
        expect(messages).toContain("broken.contract.jsonc");
        expect(messages).toContain("stray.txt");
      },
    );
  });

  test("loadCatalog tolerates the contracts directory but flags others", async () => {
    await withTempCatalog(
      { "alpha.jsonc": manifestSource("alpha") },
      async (directory) => {
        mkdirSync(path.join(directory, "contracts"));
        mkdirSync(path.join(directory, "unexpected"));
        const { entries, issues } = await loadCatalog(directory);
        expect(entries.map((entry) => entry.id)).toEqual(["alpha"]);
        expect(issues.map((problem) => problem.file)).toEqual(["unexpected"]);
        expect(issueMessages(issues)).toContain("unexpected directory");
      },
    );
  });

  test("ships a JSON Schema that mirrors the strict contract format", async () => {
    const schema = JSON.parse(
      await Bun.file(
        path.join(REPO_ROOT, "schemas/tool-adapter-contract.v1.schema.json"),
      ).text(),
    ) as {
      properties: {
        contractVersion: { const: number };
        kind: { const: string };
      };
      additionalProperties: boolean;
      required: string[];
    };
    expect(schema.properties.contractVersion.const).toBe(1);
    expect(schema.properties.kind.const).toBe("tool-contract");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "contractVersion",
        "kind",
        "tool",
        "detection",
        "profiles",
        "redactions",
      ]),
    );
  });

  test("accepts the shipped contracts against the shipped catalog", async () => {
    const { entries, issues: catalogIssues } = await loadCatalog();
    expect(catalogIssues).toEqual([]);
    const { contracts, issues } = await loadContracts();
    expect(issues).toEqual([]);
    expect(contracts.length).toBeGreaterThanOrEqual(5);
    expect(checkContracts(entries, contracts)).toEqual([]);
    expect(checkCatalogSafety(entries)).toEqual([]);
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
    expect(output).toContain("behavior contract");
    expect(result.exitCode).toBe(0);
  });

  test("catalog:new scaffolds a behavior contract alongside the manifest", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        path.join(REPO_ROOT, "scripts/catalog-new.ts"),
        "zzz-contract-probe",
        "--display-name",
        "Contract Probe",
        "--pack",
        "essentials",
        "--dry-run",
      ],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(output).toContain(
      "catalog/contracts/zzz-contract-probe.contract.jsonc",
    );
    expect(output).toContain('"kind": "tool-contract"');
    expect(result.exitCode).toBe(0);
  });
});
