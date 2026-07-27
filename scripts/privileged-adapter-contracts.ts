import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import type {
  AdapterRegistry,
  NetworkAdapterEnvelope,
  VmAdapterEnvelope,
} from "../src/core/adapters.js";
import {
  parsePrivilegedAdapterManifest,
  type PrivilegedAdapterManifest,
} from "../src/core/privileged-adapters.js";
import type { SecretReferenceList } from "../src/core/secret-backends.js";
import type {
  NetworkProfile,
  SecretBackendConfig,
  VmProfile,
} from "../src/domain/config.js";
import {
  byteSort,
  issue,
  REPO_ROOT,
  type CatalogIssue,
} from "./catalog-lib.js";
import { behaviorIssue, canonical } from "./privileged-contract-utils.js";
import { checkSecretContract } from "./privileged-secret-contract-harness.js";

export const PRIVILEGED_ADAPTER_DIRECTORY = path.join(
  REPO_ROOT,
  "privileged-adapters",
);
export const PRIVILEGED_ADAPTER_CONTRACT_DIRECTORY = path.join(
  PRIVILEGED_ADAPTER_DIRECTORY,
  "contracts",
);
export const PRIVILEGED_ADAPTER_CONTRACT_VERSION = 1;

interface NetworkContractCase {
  case: string;
  profile: NetworkProfile;
  expected: {
    capability: unknown;
    enforcement: unknown;
    actions: Record<
      "up" | "down" | "status",
      { options?: Record<string, unknown>; steps: unknown[] }
    >;
  };
}

interface VmContractCase {
  case: string;
  profile: VmProfile;
  capabilityOptions: {
    platform: NodeJS.Platform;
    hasKvm: boolean;
    executablePath: string | null;
  };
  expected: {
    capability: unknown;
    actions: Record<
      "start" | "stop" | "status" | "exec",
      { options?: Record<string, unknown>; argv: string[] }
    >;
  };
}

interface SecretContractCase {
  case: string;
  platform: NodeJS.Platform;
  config: SecretBackendConfig;
  expected: {
    executable: string | null;
    writable: boolean;
    operations: {
      read?: {
        key: string;
        result?: string;
        error?: string;
        calls: SecretRunnerCall[];
      };
      write?: {
        key: string;
        value: string;
        error?: string;
        calls: SecretRunnerCall[];
      };
      list?: {
        result: SecretReferenceList;
        calls: SecretRunnerCall[];
      };
      delete?: {
        key: string;
        error?: string;
        calls: SecretRunnerCall[];
      };
    };
  };
}

export interface SecretRunnerCall {
  command: string[];
  input?: string;
  environment?: Record<string, string>;
}

interface ContractBase {
  contractVersion: typeof PRIVILEGED_ADAPTER_CONTRACT_VERSION;
  kind: "privileged-adapter-contract";
  adapterKind: "network" | "vm" | "secret";
  adapter: string;
}

export type PrivilegedAdapterContract =
  | (ContractBase & { adapterKind: "network"; cases: NetworkContractCase[] })
  | (ContractBase & { adapterKind: "vm"; cases: VmContractCase[] })
  | (ContractBase & { adapterKind: "secret"; cases: SecretContractCase[] });

export interface PrivilegedAdapterContractEntry {
  key: string;
  file: string;
  contract: PrivilegedAdapterContract;
}

const SAFE_ID = /^[a-z][a-z0-9_-]*$/;
const record = z.record(z.string(), z.unknown());
const caseName = z.string().max(64).regex(SAFE_ID);
const actionSteps = z
  .object({
    options: record.optional(),
    steps: z.array(z.unknown()),
  })
  .strict();
const actionArgv = z
  .object({
    options: record.optional(),
    argv: z.array(z.string()),
  })
  .strict();
const secretRunnerCall = z
  .object({
    command: z.array(z.string()).min(1),
    input: z.string().optional(),
    environment: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const secretReadExpectation = z
  .object({
    key: z.string().min(1),
    result: z.string().optional(),
    error: z.string().min(1).optional(),
    calls: z.array(secretRunnerCall),
  })
  .strict()
  .superRefine((expectation, context) => {
    if (
      (expectation.result === undefined) ===
      (expectation.error === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Secret read must declare exactly one of result or error",
      });
    }
  });
const secretOperations = z
  .object({
    read: secretReadExpectation.optional(),
    write: z
      .object({
        key: z.string().min(1),
        value: z.string().min(1),
        error: z.string().min(1).optional(),
        calls: z.array(secretRunnerCall),
      })
      .strict()
      .optional(),
    list: z
      .object({
        result: z
          .object({
            backend: z.enum([
              "file",
              "age",
              "keychain",
              "pass",
              "onepassword",
              "bitwarden",
              "dashlane",
            ]),
            supported: z.boolean(),
            writable: z.boolean(),
            references: z.array(z.string()),
          })
          .strict(),
        calls: z.array(secretRunnerCall),
      })
      .strict()
      .optional(),
    delete: z
      .object({
        key: z.string().min(1),
        error: z.string().min(1).optional(),
        calls: z.array(secretRunnerCall),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((operations) => Object.keys(operations).length > 0, {
    message: "Secret contract must cover at least one operation",
  });
const commonContract = {
  contractVersion: z.literal(PRIVILEGED_ADAPTER_CONTRACT_VERSION),
  kind: z.literal("privileged-adapter-contract"),
  adapter: z.string().max(64).regex(SAFE_ID),
};

const contractSchema = z.discriminatedUnion("adapterKind", [
  z
    .object({
      ...commonContract,
      adapterKind: z.literal("network"),
      cases: z
        .array(
          z
            .object({
              case: caseName,
              profile: record,
              expected: z
                .object({
                  capability: z.unknown(),
                  enforcement: z.unknown(),
                  actions: z
                    .object({
                      up: actionSteps,
                      down: actionSteps,
                      status: actionSteps,
                    })
                    .strict(),
                })
                .strict(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      ...commonContract,
      adapterKind: z.literal("vm"),
      cases: z
        .array(
          z
            .object({
              case: caseName,
              profile: record,
              capabilityOptions: z
                .object({
                  platform: z.enum(["darwin", "linux", "win32"]),
                  hasKvm: z.boolean(),
                  executablePath: z.string().min(1).nullable(),
                })
                .strict(),
              expected: z
                .object({
                  capability: z.unknown(),
                  actions: z
                    .object({
                      start: actionArgv,
                      stop: actionArgv,
                      status: actionArgv,
                      exec: actionArgv,
                    })
                    .strict(),
                })
                .strict(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      ...commonContract,
      adapterKind: z.literal("secret"),
      cases: z
        .array(
          z
            .object({
              case: caseName,
              platform: z.enum(["darwin", "linux", "win32"]),
              config: record,
              expected: z
                .object({
                  executable: z.string().min(1).nullable(),
                  writable: z.boolean(),
                  operations: secretOperations,
                })
                .strict(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);

/** Parse a strict privileged-adapter behavior contract. */
export function parsePrivilegedAdapterContract(
  source: string,
): PrivilegedAdapterContract {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid privileged adapter contract JSONC: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  const result = contractSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid privileged adapter contract: ${result.error.issues
        .map((problem) => `${problem.path.join(".")}: ${problem.message}`)
        .join("; ")}`,
    );
  }
  return result.data as PrivilegedAdapterContract;
}

/** Load every privileged contribution manifest from disk. */
export async function loadPrivilegedAdapterManifests(
  directory: string = PRIVILEGED_ADAPTER_DIRECTORY,
): Promise<{ manifests: PrivilegedAdapterManifest[]; issues: CatalogIssue[] }> {
  const manifests: PrivilegedAdapterManifest[] = [];
  const issues: CatalogIssue[] = [];
  if (!existsSync(directory)) return { manifests, issues };
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (entry.isDirectory()) {
      if (entry.name !== "contracts") {
        issues.push(
          issue(
            entry.name,
            `${entry.name}: unexpected directory in privileged-adapters/`,
          ),
        );
      }
      continue;
    }
    if (!entry.name.endsWith(".jsonc")) {
      issues.push(
        issue(
          entry.name,
          `${entry.name}: unexpected file in privileged-adapters/`,
        ),
      );
      continue;
    }
    try {
      const manifest = parsePrivilegedAdapterManifest(
        await Bun.file(path.join(directory, entry.name)).text(),
      );
      const expected = `${manifest.adapterKind}-${manifest.id}.jsonc`;
      if (entry.name !== expected) {
        issues.push(
          issue(
            entry.name,
            `${entry.name}: adapter identity does not match filename (expected ${expected})`,
          ),
        );
      } else {
        manifests.push(manifest);
      }
    } catch (error) {
      issues.push(
        issue(entry.name, `${entry.name}: ${(error as Error).message}`),
      );
    }
  }
  const seen = new Set<string>();
  for (const manifest of manifests) {
    const key = `${manifest.adapterKind}:${manifest.id}`;
    if (seen.has(key)) {
      issues.push(
        issue(
          `${manifest.adapterKind}-${manifest.id}.jsonc`,
          `Duplicate privileged adapter '${key}'`,
        ),
      );
    }
    seen.add(key);
  }
  return { manifests, issues };
}

/** Load every privileged behavior contract from disk. */
export async function loadPrivilegedAdapterContracts(
  directory: string = PRIVILEGED_ADAPTER_CONTRACT_DIRECTORY,
): Promise<{
  contracts: PrivilegedAdapterContractEntry[];
  issues: CatalogIssue[];
}> {
  const contracts: PrivilegedAdapterContractEntry[] = [];
  const issues: CatalogIssue[] = [];
  if (!existsSync(directory)) return { contracts, issues };
  for (const file of byteSort(await readdir(directory))) {
    if (!file.endsWith(".contract.jsonc")) {
      issues.push(
        issue(
          file,
          `${file}: unexpected file in privileged-adapters/contracts/`,
        ),
      );
      continue;
    }
    try {
      const contract = parsePrivilegedAdapterContract(
        await Bun.file(path.join(directory, file)).text(),
      );
      const expected = `${contract.adapterKind}-${contract.adapter}.contract.jsonc`;
      if (file !== expected) {
        issues.push(
          issue(
            file,
            `${file}: contract identity does not match filename (expected ${expected})`,
          ),
        );
      } else {
        contracts.push({
          key: `${contract.adapterKind}:${contract.adapter}`,
          file,
          contract,
        });
      }
    } catch (error) {
      issues.push(issue(file, `${file}: ${(error as Error).message}`));
    }
  }
  return { contracts, issues };
}

function checkNetworkContract(
  envelope: NetworkAdapterEnvelope,
  entry: PrivilegedAdapterContractEntry,
): CatalogIssue[] {
  if (entry.contract.adapterKind !== "network") return [];
  const issues: CatalogIssue[] = [];
  for (const testCase of entry.contract.cases) {
    const capability = envelope.contract.capability(testCase.profile);
    if (canonical(capability) !== canonical(testCase.expected.capability)) {
      issues.push(
        behaviorIssue(
          entry.file,
          `${testCase.case} capability`,
          testCase.expected.capability,
          capability,
        ),
      );
    }
    const enforcement = envelope.contract.enforcement(testCase.profile);
    if (canonical(enforcement) !== canonical(testCase.expected.enforcement)) {
      issues.push(
        behaviorIssue(
          entry.file,
          `${testCase.case} enforcement`,
          testCase.expected.enforcement,
          enforcement,
        ),
      );
    }
    for (const action of ["up", "down", "status"] as const) {
      const expected = testCase.expected.actions[action];
      const actual = envelope.contract.plan(
        "contract",
        testCase.profile,
        action,
        expected.options ?? {},
      );
      if (canonical(expected.steps) !== canonical(actual)) {
        issues.push(
          behaviorIssue(
            entry.file,
            `${testCase.case} ${action} plan`,
            expected.steps,
            actual,
          ),
        );
      }
    }
  }
  return issues;
}

function checkVmContract(
  envelope: VmAdapterEnvelope,
  entry: PrivilegedAdapterContractEntry,
): CatalogIssue[] {
  if (entry.contract.adapterKind !== "vm") return [];
  const issues: CatalogIssue[] = [];
  for (const testCase of entry.contract.cases) {
    const platforms = envelope.contract.manifest.platforms.os;
    if (
      !platforms.some(
        (platform) =>
          platform === "any" ||
          platform === testCase.capabilityOptions.platform,
      )
    ) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: ${testCase.case} uses undeclared platform '${testCase.capabilityOptions.platform}'`,
        ),
      );
    }
    const capability = envelope.contract.capability(testCase.profile, {
      platform: testCase.capabilityOptions.platform,
      hasKvm: testCase.capabilityOptions.hasKvm,
      findExecutable: () => testCase.capabilityOptions.executablePath,
    });
    if (canonical(capability) !== canonical(testCase.expected.capability)) {
      issues.push(
        behaviorIssue(
          entry.file,
          `${testCase.case} capability`,
          testCase.expected.capability,
          capability,
        ),
      );
    }
    for (const action of ["start", "stop", "status", "exec"] as const) {
      const expected = testCase.expected.actions[action];
      const actual = envelope.contract.command(
        "contract",
        testCase.profile,
        action,
        expected.options ?? {},
      );
      if (canonical(expected.argv) !== canonical(actual)) {
        issues.push(
          behaviorIssue(
            entry.file,
            `${testCase.case} ${action} argv`,
            expected.argv,
            actual,
          ),
        );
      }
    }
  }
  return issues;
}

/** Verify completeness and deterministic behavior without privileged host effects. */
export async function checkPrivilegedAdapterContracts(
  manifests: PrivilegedAdapterManifest[],
  contracts: PrivilegedAdapterContractEntry[],
  registry: AdapterRegistry,
): Promise<CatalogIssue[]> {
  const issues: CatalogIssue[] = [];
  const manifestByKey = new Map(
    manifests.map((manifest) => [
      `${manifest.adapterKind}:${manifest.id}`,
      manifest,
    ]),
  );
  const contractByKey = new Map(contracts.map((entry) => [entry.key, entry]));
  for (const manifest of manifests) {
    const key = `${manifest.adapterKind}:${manifest.id}`;
    if (!contractByKey.has(key)) {
      issues.push(
        issue(
          `${manifest.adapterKind}-${manifest.id}.jsonc`,
          `${manifest.adapterKind}-${manifest.id}.jsonc: missing privileged-adapters/contracts/${manifest.adapterKind}-${manifest.id}.contract.jsonc behavior contract`,
        ),
      );
    }
  }
  for (const entry of contracts) {
    const manifest = manifestByKey.get(entry.key);
    if (!manifest) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: no privileged adapter manifest matches`,
        ),
      );
      continue;
    }
    const envelope =
      manifest.adapterKind === "network"
        ? registry.networks[manifest.id]
        : manifest.adapterKind === "vm"
          ? registry.vms[manifest.id]
          : registry.secrets[manifest.id];
    if (!envelope) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: privileged adapter '${entry.key}' is not registered`,
        ),
      );
      continue;
    }
    const registeredManifest = envelope.contract.manifest;
    if (canonical(registeredManifest) !== canonical(manifest)) {
      issues.push(
        behaviorIssue(
          entry.file,
          "registered manifest",
          manifest,
          registeredManifest,
        ),
      );
      continue;
    }
    if (manifest.adapterKind === "network" && envelope.kind === "network") {
      issues.push(...checkNetworkContract(envelope, entry));
    } else if (manifest.adapterKind === "vm" && envelope.kind === "vm") {
      issues.push(...checkVmContract(envelope, entry));
    } else if (
      manifest.adapterKind === "secret" &&
      envelope.kind === "secret"
    ) {
      issues.push(...(await checkSecretContract(envelope, entry)));
    } else {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: adapter kind does not match registry`,
        ),
      );
    }
  }
  return issues;
}
