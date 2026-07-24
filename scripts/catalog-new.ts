#!/usr/bin/env bun
// Deterministic scaffolder for new built-in tool adapters. Writes the catalog
// manifest, registers it in src/adapters/builtins.ts, and regenerates the
// generated documentation blocks.
import { existsSync } from "node:fs";
import path from "node:path";

import {
  BUILTINS_FILE,
  CATALOG_DIRECTORY,
  checkCatalogEntries,
  computeDocsUpdates,
  loadCatalog,
  loadRegistry,
  registerManifestImport,
  renderManifestTemplate,
  REPO_ROOT,
  type ScaffoldOptions,
} from "./catalog-lib.js";
import { parseToolAdapterManifest } from "../src/core/tool-adapters.js";

const USAGE = `Usage: bun run catalog:new <id> --display-name <name> --pack <pack> [options]

Options:
  --display-name <name>  Human-readable tool name, e.g. "Acme CLI" (required)
  --pack <pack>          Tool pack the adapter belongs to (required)
  --executable <name>    Executable resolved on PATH (default: <id>)
  --description <text>   Longer help text for the adapter
  --alias <name>         Alternative executable name (repeatable)
  --shim | --no-shim     Force the universal shim on or off
  --scope <value>        Isolation scope: process | shell (default: process)
  --state <value>        Isolation state: full | partial | credentials (default: partial)
  --dry-run              Print the manifest and planned changes without writing

Example:
  bun run catalog:new acme --display-name "Acme CLI" --pack deployment --state credentials`;

function fail(message: string): never {
  console.error(`error: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArguments(argv: string[]): ScaffoldOptions & { dryRun: boolean } {
  let id: string | undefined;
  let dryRun = false;
  const options: Partial<ScaffoldOptions> = {};
  const aliases: string[] = [];
  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${flag} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    switch (argument) {
      case "--display-name":
        options.displayName = takeValue(argument, index);
        index += 1;
        break;
      case "--pack":
        options.pack = takeValue(argument, index);
        index += 1;
        break;
      case "--executable":
        options.executable = takeValue(argument, index);
        index += 1;
        break;
      case "--description":
        options.description = takeValue(argument, index);
        index += 1;
        break;
      case "--alias":
        aliases.push(takeValue(argument, index));
        index += 1;
        break;
      case "--shim":
        options.shim = true;
        break;
      case "--no-shim":
        options.shim = false;
        break;
      case "--scope": {
        const value = takeValue(argument, index);
        if (value !== "process" && value !== "shell") {
          fail(`--scope must be process or shell, got '${value}'`);
        }
        options.isolationScope = value;
        index += 1;
        break;
      }
      case "--state": {
        const value = takeValue(argument, index);
        if (
          value !== "full" &&
          value !== "partial" &&
          value !== "credentials"
        ) {
          fail(`--state must be full, partial, or credentials, got '${value}'`);
        }
        options.isolationState = value;
        index += 1;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (argument.startsWith("--")) fail(`unknown option '${argument}'`);
        if (id !== undefined) fail(`unexpected argument '${argument}'`);
        id = argument;
    }
  }
  if (!id) fail("missing <id>");
  if (!options.displayName) fail("missing --display-name");
  if (!options.pack) fail("missing --pack");
  if (aliases.length > 0) options.alternatives = aliases;
  return { ...options, id, dryRun } as ScaffoldOptions & { dryRun: boolean };
}

const { dryRun, ...scaffold } = parseArguments(process.argv.slice(2));

const { registry, issue: registryIssue } = await loadRegistry();
if (!registry) {
  fail(
    `cannot scaffold while the registry is broken - fix this first:\n${registryIssue?.message ?? "unknown registry failure"}`,
  );
}
const knownPacks = Object.keys(registry.packs);
if (!knownPacks.includes(scaffold.pack)) {
  fail(
    `unknown pack '${scaffold.pack}' (known: ${knownPacks.sort().join(", ")}). New packs need a PACK_DETAILS entry in src/adapters/builtins.ts; propose one in your PR description.`,
  );
}
if (registry.manifests[scaffold.id]) {
  fail(`tool adapter '${scaffold.id}' already exists`);
}
const manifestPath = path.join(CATALOG_DIRECTORY, `${scaffold.id}.jsonc`);
if (existsSync(manifestPath)) {
  fail(`catalog/${scaffold.id}.jsonc already exists`);
}

let rendered: string;
try {
  rendered = renderManifestTemplate(scaffold);
} catch (error) {
  fail((error as Error).message);
}

const { entries, issues: loadIssues } = await loadCatalog();
const issues = [
  ...loadIssues,
  ...checkCatalogEntries(
    [
      ...entries,
      {
        id: scaffold.id,
        file: `${scaffold.id}.jsonc`,
        manifest: parseToolAdapterManifest(rendered),
      },
    ],
    knownPacks,
  ),
];
if (issues.length > 0) {
  for (const problem of issues) console.error(`error: ${problem.message}`);
  process.exit(1);
}

const builtinsSource = await Bun.file(BUILTINS_FILE).text();
const updatedBuiltins = registerManifestImport(builtinsSource, scaffold.id);

if (dryRun) {
  console.log(`would create catalog/${scaffold.id}.jsonc:\n`);
  console.log(rendered);
  console.log(
    "would update src/adapters/builtins.ts, docs/tool-packs.md, README.md",
  );
  process.exit(0);
}

await Bun.write(manifestPath, rendered);
await Bun.write(BUILTINS_FILE, updatedBuiltins);
console.log(`created catalog/${scaffold.id}.jsonc`);
console.log("updated src/adapters/builtins.ts");
for (const update of await computeDocsUpdates()) {
  if (update.updated === update.current) continue;
  await Bun.write(path.join(REPO_ROOT, update.file), update.updated);
  console.log(`updated ${update.file} (generated:${update.block})`);
}

console.log(`
Next steps:
  1. Edit catalog/${scaffold.id}.jsonc - add auth commands and profile env/args.
     Your editor validates it against schemas/tool-adapter.v1.schema.json
     (wired up in .vscode/settings.json).
  2. bun run catalog:check
  3. bun test
  4. Open a PR - see CONTRIBUTING.md for the catalog PR checklist.`);
