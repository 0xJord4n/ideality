#!/usr/bin/env bun
// Contributor-facing catalog validator. `--write` regenerates the generated
// documentation blocks instead of reporting them as stale.
import path from "node:path";

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
  `catalog check passed: ${entries.length} manifests, ${packCount} packs, generated docs fresh, editor schema in sync.`,
);
