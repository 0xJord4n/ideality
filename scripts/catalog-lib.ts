import { readdir } from "node:fs/promises";
import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import {
  parseToolAdapterManifest,
  TOOL_ADAPTER_SCHEMA_VERSION,
  type ToolAdapterManifest,
} from "../src/core/tool-adapters.js";
import type { ToolPack } from "../src/adapters/builtins.js";

export const REPO_ROOT = path.resolve(import.meta.dir, "..");
export const CATALOG_DIRECTORY = path.join(REPO_ROOT, "catalog");
export const BUILTINS_FILE = path.join(REPO_ROOT, "src/adapters/builtins.ts");
export const SCHEMA_FILE = path.join(
  REPO_ROOT,
  "schemas/tool-adapter.v1.schema.json",
);
export const EDITOR_SETTINGS_FILE = path.join(
  REPO_ROOT,
  ".vscode/settings.json",
);
export const TOOL_ADAPTERS_FILE = path.join(
  REPO_ROOT,
  "src/core/tool-adapters.ts",
);

export interface CatalogEntry {
  id: string;
  file: string;
  manifest: ToolAdapterManifest;
}

export interface CatalogIssue {
  file: string;
  message: string;
}

export interface PackMeta {
  label: string;
  description: string;
}

export interface RegistryData {
  manifests: Record<string, ToolAdapterManifest>;
  packs: Record<string, ToolPack>;
}

export interface ScaffoldOptions {
  id: string;
  displayName: string;
  pack: string;
  executable?: string;
  description?: string;
  alternatives?: string[];
  shim?: boolean;
  isolationScope?: "process" | "shell";
  isolationState?: "full" | "partial" | "credentials";
}

export interface DocsUpdate {
  file: string;
  block: string;
  current: string;
  updated: string;
}

/** Build one catalog issue for a file. */
export function issue(file: string, message: string): CatalogIssue {
  return { file, message };
}

/** Sort strings by byte order, locale-independently. */
export function byteSort(values: string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Registry variable name used in builtins.ts for one adapter ID. */
export function manifestVariableName(id: string): string {
  const [head, ...rest] = id.split(/[-_]/);
  const camel =
    (head ?? "") +
    rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return `${camel}Manifest`;
}

function indentBlock(json: string): string {
  return json
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");
}

/** Render a deterministic catalog manifest for scaffolding; throws on invalid inputs. */
export function renderManifestTemplate(options: ScaffoldOptions): string {
  const executable: Record<string, unknown> = {
    primary: options.executable ?? options.id,
  };
  if (options.alternatives?.length) {
    executable.alternatives = options.alternatives;
  }
  if (options.shim !== undefined) {
    executable.shim = options.shim;
  }
  const isolation = {
    scope: options.isolationScope ?? "process",
    state: options.isolationState ?? "partial",
  };
  const envName = `${options.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_CONFIG_DIR`;
  const lines = [
    `// ${options.displayName} - built-in tool adapter manifest.`,
    "{",
    '  "schemaVersion": 1,',
    '  "kind": "tool",',
    `  "id": ${JSON.stringify(options.id)},`,
    `  "displayName": ${JSON.stringify(options.displayName)},`,
    ...(options.description !== undefined
      ? [`  "description": ${JSON.stringify(options.description)},`]
      : []),
    `  "pack": ${JSON.stringify(options.pack)},`,
    `  "executable": ${indentBlock(JSON.stringify(executable, null, 2))},`,
    `  "isolation": ${indentBlock(JSON.stringify(isolation, null, 2))}`,
    '  // Optional blocks - uncomment to use (add a comma after "isolation" first):',
    '  // "auth": { "login": ["login"], "status": ["whoami"], "logout": ["logout"] },',
    '  // "profile": {',
    `  //   "env": { "${envName}": "{{idealityHome}}/profiles/{{identity}}/${options.id}" }`,
    "  // }",
    "}",
    "",
  ];
  const rendered = lines.join("\n");
  const manifest = parseToolAdapterManifest(rendered);
  if (manifest.id !== options.id) {
    throw new Error(
      `Rendered manifest ID '${manifest.id}' does not match '${options.id}'`,
    );
  }
  return rendered;
}

const MANIFEST_IMPORT_PATTERN =
  /^import \w+ from "\.\.\/\.\.\/catalog\/[^"]+\.jsonc" with \{ type: "text" \};$/gm;
const MANIFEST_SOURCES_ANCHOR = "const MANIFEST_SOURCES: readonly string[] = [";

/** Insert the import and MANIFEST_SOURCES entry for one adapter into builtins.ts source. */
export function registerManifestImport(source: string, id: string): string {
  const importPath = `../../catalog/${id}.jsonc`;
  const variable = manifestVariableName(id);
  if (
    source.includes(`"${importPath}"`) ||
    new RegExp(`\\b${variable}\\b`).test(source)
  ) {
    throw new Error(
      `Tool adapter '${id}' is already registered in builtins.ts`,
    );
  }
  const imports = [...source.matchAll(MANIFEST_IMPORT_PATTERN)];
  const lastImport = imports.at(-1);
  if (lastImport?.index === undefined) {
    throw new Error("Could not find the catalog import block in builtins.ts");
  }
  const importEnd = lastImport.index + lastImport[0].length;
  const importLine = `\nimport ${variable} from "${importPath}" with { type: "text" };`;
  let updated =
    source.slice(0, importEnd) + importLine + source.slice(importEnd);
  const anchorIndex = updated.indexOf(MANIFEST_SOURCES_ANCHOR);
  if (anchorIndex === -1) {
    throw new Error("Could not find MANIFEST_SOURCES in builtins.ts");
  }
  const closeIndex = updated.indexOf("\n];", anchorIndex);
  if (closeIndex === -1) {
    throw new Error(
      "Could not find the end of MANIFEST_SOURCES in builtins.ts",
    );
  }
  updated =
    updated.slice(0, closeIndex) +
    `\n  ${variable},` +
    updated.slice(closeIndex);
  return updated;
}

/** Parse every catalog manifest; parse failures become issues instead of throws. */
export async function loadCatalog(
  directory: string = CATALOG_DIRECTORY,
): Promise<{ entries: CatalogEntry[]; issues: CatalogIssue[] }> {
  const entries: CatalogEntry[] = [];
  const issues: CatalogIssue[] = [];
  const dirents = (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  for (const dirent of dirents) {
    const file = dirent.name;
    if (dirent.isDirectory()) {
      if (file !== "contracts") {
        issues.push(
          issue(
            file,
            `${file}: unexpected directory in catalog/ (only contracts/ is allowed)`,
          ),
        );
      }
      continue;
    }
    if (!file.endsWith(".jsonc")) {
      issues.push(
        issue(
          file,
          `${file}: unexpected file in catalog/ (only .jsonc manifests are allowed)`,
        ),
      );
      continue;
    }
    const source = await Bun.file(path.join(directory, file)).text();
    try {
      const manifest = parseToolAdapterManifest(source);
      entries.push({ id: manifest.id, file, manifest });
    } catch (error) {
      issues.push(issue(file, `${file}: ${(error as Error).message}`));
    }
  }
  return { entries, issues };
}

/** Cross-manifest invariants: filename/ID match, unique IDs and executables, known packs. */
export function checkCatalogEntries(
  entries: CatalogEntry[],
  knownPacks?: string[],
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const idOwners = new Map<string, string>();
  const executableOwners = new Map<string, string>();
  for (const entry of entries) {
    const expected = `${entry.id}.jsonc`;
    if (entry.file !== expected) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: manifest ID '${entry.id}' does not match the filename (expected ${expected})`,
        ),
      );
    }
    const idOwner = idOwners.get(entry.id);
    if (idOwner) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: duplicate tool ID '${entry.id}' (also in ${idOwner})`,
        ),
      );
    } else {
      idOwners.set(entry.id, entry.file);
    }
    if (knownPacks && !knownPacks.includes(entry.manifest.pack)) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: pack '${entry.manifest.pack}' is not a known tool pack (known: ${byteSort(knownPacks).join(", ")})`,
        ),
      );
    }
    for (const name of [
      entry.manifest.executable.primary,
      ...(entry.manifest.executable.alternatives ?? []),
    ]) {
      const owner = executableOwners.get(name);
      if (owner && owner !== entry.id) {
        issues.push(
          issue(
            entry.file,
            `${entry.file}: executable alias '${name}' is already claimed by '${owner}'`,
          ),
        );
      } else {
        executableOwners.set(name, entry.id);
      }
    }
  }
  return issues;
}

/** Verify catalog files and the builtins registry cover exactly the same adapters. */
export function checkRegistryCompleteness(
  entries: CatalogEntry[],
  registry: Record<string, ToolAdapterManifest>,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const entryIds = new Set(entries.map((entry) => entry.id));
  for (const entry of entries) {
    const registered = registry[entry.id];
    if (!registered) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: not registered in src/adapters/builtins.ts (run \`bun run catalog:new\` or add the import and MANIFEST_SOURCES entry)`,
        ),
      );
      continue;
    }
    if (JSON.stringify(registered) !== JSON.stringify(entry.manifest)) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: registry copy in src/adapters/builtins.ts differs from the catalog file`,
        ),
      );
    }
  }
  for (const id of Object.keys(registry)) {
    if (!entryIds.has(id)) {
      issues.push(
        issue(
          "src/adapters/builtins.ts",
          `src/adapters/builtins.ts: tool '${id}' is registered but catalog/${id}.jsonc was not loaded`,
        ),
      );
    }
  }
  return issues;
}

/** Load the compiled registry; a module-load failure becomes an issue instead of a throw. */
export async function loadRegistry(): Promise<{
  registry?: RegistryData;
  issue?: CatalogIssue;
}> {
  try {
    const module = await import("../src/adapters/builtins.js");
    return {
      registry: {
        manifests: module.BUILTIN_TOOL_MANIFESTS,
        packs: module.BUILTIN_TOOL_PACKS,
      },
    };
  } catch (error) {
    return {
      issue: issue(
        "src/adapters/builtins.ts",
        `src/adapters/builtins.ts: failed to load: ${(error as Error).message}`,
      ),
    };
  }
}

function get(value: unknown, ...keys: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function extractRegex(source: string, name: string): string | undefined {
  return new RegExp(`const ${name} = /(.+)/;`).exec(source)?.[1];
}

function extractEnum(source: string, field: string): string[] | undefined {
  const match = new RegExp(`${field}: z\\.enum\\(\\[([^\\]]*)\\]\\)`).exec(
    source,
  );
  if (!match?.[1]) return undefined;
  return match[1].split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
}

function sameList(a: unknown, b: string[]): boolean {
  return (
    Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i])
  );
}

const EDITOR_SCHEMA_MAPPINGS = [
  {
    fileMatch: "/catalog/*.jsonc",
    url: "./schemas/tool-adapter.v1.schema.json",
  },
  {
    fileMatch: "/catalog/contracts/*.contract.jsonc",
    url: "./schemas/tool-adapter-contract.v1.schema.json",
  },
] as const;

/** Verify contributors receive schema validation for every catalog document. */
export function checkEditorSchemaMappings(
  settings: unknown,
  file = path.relative(REPO_ROOT, EDITOR_SETTINGS_FILE),
): CatalogIssue[] {
  const schemas = get(settings, "json.schemas");
  const mappings = Array.isArray(schemas) ? schemas : [];
  return EDITOR_SCHEMA_MAPPINGS.flatMap((expected) => {
    const found = mappings.some(
      (mapping) =>
        get(mapping, "url") === expected.url &&
        Array.isArray(get(mapping, "fileMatch")) &&
        (get(mapping, "fileMatch") as unknown[]).includes(expected.fileMatch),
    );
    return found
      ? []
      : [
          issue(
            file,
            `${file}: missing JSON schema mapping '${expected.url}' for '${expected.fileMatch}'`,
          ),
        ];
  });
}

/** Verify the editor JSON schema has not drifted from the runtime zod parser. */
export async function checkSchemaSync(): Promise<CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const schemaFile = path.relative(REPO_ROOT, SCHEMA_FILE);
  const schema: unknown = JSON.parse(await Bun.file(SCHEMA_FILE).text());
  const runtime = await Bun.file(TOOL_ADAPTERS_FILE).text();

  const drift = (what: string, expected: unknown, actual: unknown): void => {
    issues.push(
      issue(
        schemaFile,
        `${schemaFile}: ${what} drifted from src/core/tool-adapters.ts (runtime ${JSON.stringify(expected)} vs schema ${JSON.stringify(actual)})`,
      ),
    );
  };
  const extraction = (what: string): void => {
    issues.push(
      issue(
        schemaFile,
        `${schemaFile}: could not locate ${what} in src/core/tool-adapters.ts; update scripts/catalog-lib.ts`,
      ),
    );
  };

  const patterns: Array<[string, string, Array<string | number>]> = [
    ["SAFE_ID", "id pattern", ["properties", "id", "pattern"]],
    ["SAFE_ID", "pack pattern", ["properties", "pack", "pattern"]],
    [
      "SAFE_EXECUTABLE",
      "executable pattern",
      ["$defs", "executableName", "pattern"],
    ],
    [
      "SAFE_VARIABLE",
      "profile env name pattern",
      [
        "properties",
        "profile",
        "properties",
        "env",
        "propertyNames",
        "pattern",
      ],
    ],
  ];
  for (const [constant, what, schemaPath] of patterns) {
    const expected = extractRegex(runtime, constant);
    if (!expected) {
      extraction(constant);
      continue;
    }
    const actual = get(schema, ...schemaPath);
    if (actual !== expected) drift(what, expected, actual);
  }

  const envSource = (
    get(schema, "$defs", "valueSource", "oneOf") as unknown[] | undefined
  )?.find(
    (candidate) => get(candidate, "properties", "from", "const") === "env",
  );
  const variablePattern = extractRegex(runtime, "SAFE_VARIABLE");
  if (variablePattern) {
    const actual = get(envSource, "properties", "name", "pattern");
    if (actual !== variablePattern) {
      drift("value source env name pattern", variablePattern, actual);
    }
  }

  const version = get(schema, "properties", "schemaVersion", "const");
  if (version !== TOOL_ADAPTER_SCHEMA_VERSION) {
    drift("schemaVersion const", TOOL_ADAPTER_SCHEMA_VERSION, version);
  }

  const enums: Array<[string, string, Array<string | number>]> = [
    [
      "scope",
      "isolation scope enum",
      ["properties", "isolation", "properties", "scope", "enum"],
    ],
    [
      "state",
      "isolation state enum",
      ["properties", "isolation", "properties", "state", "enum"],
    ],
    [
      "fromIdentity",
      "identity argument enum",
      ["$defs", "identityArg", "properties", "fromIdentity", "enum"],
    ],
  ];
  for (const [field, what, schemaPath] of enums) {
    const expected = extractEnum(runtime, field);
    if (!expected) {
      extraction(`${field} enum`);
      continue;
    }
    const actual = get(schema, ...schemaPath);
    if (!sameList(actual, expected)) drift(what, expected, actual);
  }

  const authKeys = Object.keys(
    (get(schema, "properties", "auth", "properties") as
      | Record<string, unknown>
      | undefined) ?? {},
  );
  if (!sameList(authKeys, ["login", "status", "logout"])) {
    drift("auth actions", ["login", "status", "logout"], authKeys);
  }

  const editorFile = path.relative(REPO_ROOT, EDITOR_SETTINGS_FILE);
  const editorErrors: ParseError[] = [];
  const editorSettings: unknown = parse(
    await Bun.file(EDITOR_SETTINGS_FILE).text(),
    editorErrors,
    { allowTrailingComma: true, disallowComments: false },
  );
  if (editorErrors.length > 0) {
    issues.push(
      issue(
        editorFile,
        `${editorFile}: invalid JSONC: ${editorErrors
          .map((error) => printParseErrorCode(error.error))
          .join(", ")}`,
      ),
    );
  } else {
    issues.push(...checkEditorSchemaMappings(editorSettings, editorFile));
  }
  return issues;
}

function packTools(entries: CatalogEntry[], packId: string): CatalogEntry[] {
  return entries
    .filter((entry) => entry.manifest.pack === packId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Render the docs/tool-packs.md matrix body from catalog data. */
export function renderToolPackMatrix(
  entries: CatalogEntry[],
  packs: Record<string, PackMeta>,
): string {
  const lines = [
    "Generated from `catalog/*.jsonc` by `bun run catalog:docs`; do not edit between the markers.",
    "",
    "| Pack | Adapters (isolation grade) |",
    "| --- | --- |",
  ];
  for (const [packId, meta] of Object.entries(packs)) {
    const tools = packTools(entries, packId);
    if (tools.length === 0) continue;
    const cells = tools
      .map((entry) => `\`${entry.id}\` (${entry.manifest.isolation.state})`)
      .join(", ");
    lines.push(`| ${meta.label} | ${cells} |`);
  }
  return lines.join("\n");
}

/** Render the README catalog summary body from catalog data. */
export function renderCatalogSummary(
  entries: CatalogEntry[],
  packs: Record<string, PackMeta>,
): string {
  const populated = Object.entries(packs).filter(
    ([packId]) => packTools(entries, packId).length > 0,
  );
  const adapters = `${entries.length} adapter${entries.length === 1 ? "" : "s"}`;
  const packCount = `${populated.length} selectable pack${populated.length === 1 ? "" : "s"}`;
  const lines = [
    `The built-in catalog ships ${adapters} across ${packCount}:`,
    "",
  ];
  for (const [packId, meta] of populated) {
    const ids = packTools(entries, packId)
      .map((entry) => `\`${entry.id}\``)
      .join(", ");
    lines.push(`- **${meta.label}**: ${ids}`);
  }
  return lines.join("\n");
}

/** Replace the body between `<!-- generated:<block>:begin/end -->` markers. */
export function replaceGeneratedBlock(
  content: string,
  block: string,
  body: string,
): string {
  const begin = `<!-- generated:${block}:begin -->`;
  const end = `<!-- generated:${block}:end -->`;
  const beginIndex = content.indexOf(begin);
  const endIndex = content.indexOf(end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`Missing generated:${block} markers`);
  }
  return `${content.slice(0, beginIndex + begin.length)}\n${body}\n${content.slice(endIndex)}`;
}

/** Compute the generated documentation blocks against the current files. */
export async function computeDocsUpdates(): Promise<DocsUpdate[]> {
  const { registry, issue: registryIssue } = await loadRegistry();
  if (!registry) {
    throw new Error(registryIssue?.message ?? "registry unavailable");
  }
  const { entries } = await loadCatalog();
  const packs: Record<string, PackMeta> = Object.fromEntries(
    Object.entries(registry.packs).map(([id, pack]) => [
      id,
      { label: pack.label, description: pack.description },
    ]),
  );
  const targets = [
    {
      file: "docs/tool-packs.md",
      block: "tool-pack-matrix",
      body: renderToolPackMatrix(entries, packs),
    },
    {
      file: "README.md",
      block: "catalog-summary",
      body: renderCatalogSummary(entries, packs),
    },
  ];
  return Promise.all(
    targets.map(async (target) => {
      const current = await Bun.file(path.join(REPO_ROOT, target.file)).text();
      return {
        file: target.file,
        block: target.block,
        current,
        updated: replaceGeneratedBlock(current, target.block, target.body),
      };
    }),
  );
}
