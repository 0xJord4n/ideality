#!/usr/bin/env bun
import { ADAPTER_REGISTRY } from "../src/core/adapters.js";
import {
  checkPrivilegedAdapterContracts,
  loadPrivilegedAdapterContracts,
  loadPrivilegedAdapterManifests,
} from "./privileged-adapter-contracts.js";

const { manifests, issues: manifestIssues } =
  await loadPrivilegedAdapterManifests();
const { contracts, issues: contractIssues } =
  await loadPrivilegedAdapterContracts();
const issues = [
  ...manifestIssues,
  ...contractIssues,
  ...(await checkPrivilegedAdapterContracts(
    manifests,
    contracts,
    ADAPTER_REGISTRY,
  )),
];

if (issues.length > 0) {
  for (const problem of issues) {
    console.error(`error: ${problem.message}`);
  }
  console.error(
    `\nprivileged adapter check failed with ${issues.length} problem${issues.length === 1 ? "" : "s"}.`,
  );
  process.exit(1);
}

console.log(
  `privileged adapter check passed: ${manifests.length} release-signing-bound manifests, ${contracts.length} behavior contracts, runtime registry complete.`,
);
