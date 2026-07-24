#!/usr/bin/env bun
// Contributor-facing catalog validator. `--write` regenerates the generated
// documentation blocks instead of reporting them as stale.
import path from "node:path";

import {
  ADAPTER_REGISTRY,
  validateAdapterRegistryCompleteness,
} from "../src/core/adapters.js";
import {
  checkCatalogSafety,
  checkContracts,
  loadContracts,
} from "./catalog-contracts.js";
import {
  checkCatalogEntries,
  checkRegistryCompleteness,
  checkSchemaSync,
  computeDocsUpdates,
  loadCatalog,
  loadRegistry,
  REPO_ROOT,
  type CatalogIssue,
} from "./catalog-lib.js";

const writeMode = process.argv.includes("--write");
const issues: CatalogIssue[] = [];

const { registry, issue: registryIssue } = await loadRegistry();
if (registryIssue) {
  issues.push(registryIssue);
}

const { entries, issues: loadIssues } = await loadCatalog();
issues.push(...loadIssues);
issues.push(
  ...checkCatalogEntries(entries, registry && Object.keys(registry.packs)),
);
if (registry) {
  issues.push(...checkRegistryCompleteness(entries, registry.manifests));
  try {
    validateAdapterRegistryCompleteness(ADAPTER_REGISTRY, {
      toolIds: entries.map((entry) => entry.id),
    });
  } catch (error) {
    issues.push({
      file: "src/core/adapters.ts",
      message: `src/core/adapters.ts: ${(error as Error).message}`,
    });
  }
  try {
    for (const update of await computeDocsUpdates()) {
      if (update.updated === update.current) continue;
      if (writeMode) {
        await Bun.write(path.join(REPO_ROOT, update.file), update.updated);
        console.log(`updated ${update.file} (generated:${update.block})`);
      } else {
        issues.push({
          file: update.file,
          message: `${update.file}: stale generated '${update.block}' block; run \`bun run catalog:docs\``,
        });
      }
    }
  } catch (error) {
    issues.push({
      file: "docs",
      message: `docs generation failed: ${(error as Error).message}`,
    });
  }
}
issues.push(...(await checkSchemaSync()));

const { contracts, issues: contractIssues } = await loadContracts();
issues.push(...contractIssues);
issues.push(...checkContracts(entries, contracts));
issues.push(...checkCatalogSafety(entries));

if (issues.length > 0) {
  for (const problem of issues) {
    console.error(`error: ${problem.message}`);
  }
  console.error(
    `\ncatalog check failed with ${issues.length} problem${issues.length === 1 ? "" : "s"}.`,
  );
  process.exit(1);
}

const packCount = registry ? Object.keys(registry.packs).length : 0;
console.log(
  `catalog check passed: ${entries.length} manifests, ${packCount} packs, ${contracts.length} behavior contracts, safety invariants hold, generated docs fresh, editor schema in sync.`,
);
