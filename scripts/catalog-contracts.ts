// Adapter behavior contracts: declarative, versioned expectations that lock an
// adapter's observable compiled behavior (detection order, auth argv, profile
// env/args, secret redaction set) without running any third-party executable.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import { authArguments } from "../src/core/auth.js";
import { isSensitiveVariable } from "../src/core/environment.js";
import {
  compileToolDefinition,
  compileToolProfile,
  parseToolAdapterManifest,
  SAFE_EXECUTABLE,
  SAFE_ID,
  SAFE_VARIABLE,
  type ToolAdapterIdentity,
} from "../src/core/tool-adapters.js";
import type { AuthAction } from "../src/domain/config.js";
import {
  byteSort,
  CATALOG_DIRECTORY,
  issue,
  renderManifestTemplate,
  type CatalogEntry,
  type CatalogIssue,
  type ScaffoldOptions,
} from "./catalog-lib.js";

export const CONTRACTS_DIRECTORY = path.join(CATALOG_DIRECTORY, "contracts");

export const TOOL_ADAPTER_CONTRACT_VERSION = 1;

const AUTH_ACTIONS = ["login", "status", "logout"] as const;

export interface ToolAdapterContractIdentity {
  sshKey?: string;
  signingKey?: string;
}

export interface ToolAdapterContractCase {
  case: string;
  identity?: ToolAdapterContractIdentity;
  env?: Record<string, unknown>;
  args?: string[];
}

export interface ToolAdapterContract {
  contractVersion: typeof TOOL_ADAPTER_CONTRACT_VERSION;
  kind: "tool-contract";
  tool: string;
  detection: string[];
  auth?: Partial<Record<AuthAction, string[]>>;
  profiles: ToolAdapterContractCase[];
  redactions: string[];
}

export interface ContractEntry {
  tool: string;
  file: string;
  contract: ToolAdapterContract;
}

const contractArgvSchema = z.array(z.string().min(1)).min(1);

const contractCaseSchema = z
  .object({
    case: z.string().max(64).regex(SAFE_ID, "Invalid contract case name"),
    identity: z
      .object({
        sshKey: z.string().min(1).optional(),
        signingKey: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    env: z.record(z.unknown()).optional(),
    args: z.array(z.string().min(1)).optional(),
  })
  .strict();

const contractSchema = z
  .object({
    contractVersion: z.literal(TOOL_ADAPTER_CONTRACT_VERSION),
    kind: z.literal("tool-contract"),
    tool: z.string().max(64).regex(SAFE_ID, "Invalid tool adapter ID"),
    detection: z
      .array(
        z.string().max(128).regex(SAFE_EXECUTABLE, "Invalid executable name"),
      )
      .min(1),
    auth: z
      .object({
        login: contractArgvSchema.optional(),
        status: contractArgvSchema.optional(),
        logout: contractArgvSchema.optional(),
      })
      .strict()
      .optional(),
    profiles: z.array(contractCaseSchema).min(1),
    redactions: z.array(
      z.string().regex(SAFE_VARIABLE, "Invalid environment variable name"),
    ),
  })
  .strict()
  .superRefine((contract, context) => {
    const duplicate = (
      values: string[],
      pathName: string,
      label: string,
    ): void => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [pathName, index],
            message: `Duplicate ${label} '${value}'`,
          });
        }
        seen.add(value);
      }
    };
    duplicate(contract.detection, "detection", "detection candidate");
    duplicate(contract.redactions, "redactions", "redaction");
    duplicate(
      contract.profiles.map((profile) => profile.case),
      "profiles",
      "contract case",
    );
    for (const [index, profile] of contract.profiles.entries()) {
      for (const name of Object.keys(profile.env ?? {})) {
        if (!SAFE_VARIABLE.test(name)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["profiles", index, "env", name],
            message: `Invalid environment variable name '${name}'`,
          });
        }
      }
    }
  });

/** Parse a strict adapter behavior contract from JSONC source. */
export function parseToolAdapterContract(source: string): ToolAdapterContract {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid tool adapter contract JSONC: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value
  ) {
    const version = (value as { contractVersion: unknown }).contractVersion;
    if (version !== TOOL_ADAPTER_CONTRACT_VERSION) {
      throw new Error(
        `Unsupported tool adapter contractVersion '${String(version)}' (supported: ${TOOL_ADAPTER_CONTRACT_VERSION})`,
      );
    }
  }
  const result = contractSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid tool adapter contract: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Parse every behavior contract; failures become issues instead of throws. */
export async function loadContracts(
  directory: string = CONTRACTS_DIRECTORY,
): Promise<{ contracts: ContractEntry[]; issues: CatalogIssue[] }> {
  const contracts: ContractEntry[] = [];
  const issues: CatalogIssue[] = [];
  if (!existsSync(directory)) {
    return { contracts, issues };
  }
  for (const file of byteSort(await readdir(directory))) {
    if (!file.endsWith(".contract.jsonc")) {
      issues.push(
        issue(
          file,
          `${file}: unexpected file in catalog/contracts/ (only .contract.jsonc files are allowed)`,
        ),
      );
      continue;
    }
    const source = await Bun.file(path.join(directory, file)).text();
    try {
      const contract = parseToolAdapterContract(source);
      const expected = `${contract.tool}.contract.jsonc`;
      if (file !== expected) {
        issues.push(
          issue(
            file,
            `${file}: contract tool '${contract.tool}' does not match the filename (expected ${expected})`,
          ),
        );
        continue;
      }
      contracts.push({ tool: contract.tool, file, contract });
    } catch (error) {
      issues.push(issue(file, `${file}: ${(error as Error).message}`));
    }
  }
  return { contracts, issues };
}

function checkContractBehavior(
  entry: CatalogEntry,
  contractEntry: ContractEntry,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const { contract, file } = contractEntry;
  const manifest = entry.manifest;
  const definition = compileToolDefinition(manifest);
  const drift = (what: string, expected: unknown, actual: unknown): void => {
    issues.push(
      issue(
        file,
        `${file}: ${what} contract ${canonical(expected)} does not match compiled behavior ${canonical(actual)}`,
      ),
    );
  };

  const candidates = [
    ...new Set([definition.executable, ...(definition.detect ?? [])]),
  ];
  if (canonical(contract.detection) !== canonical(candidates)) {
    drift("detection", contract.detection, candidates);
  }

  const manifestActions = AUTH_ACTIONS.filter(
    (action) => manifest.auth?.[action] !== undefined,
  );
  const contractActions = AUTH_ACTIONS.filter(
    (action) => contract.auth?.[action] !== undefined,
  );
  if (manifestActions.length === 0 && contract.auth !== undefined) {
    issues.push(
      issue(
        file,
        `${file}: the manifest does not declare auth; remove the auth contract`,
      ),
    );
  } else if (canonical(contractActions) !== canonical(manifestActions)) {
    issues.push(
      issue(
        file,
        `${file}: auth contract covers [${contractActions.join(", ")}] but the manifest declares [${manifestActions.join(", ")}]`,
      ),
    );
  } else {
    for (const action of manifestActions) {
      const expectedArgv = contract.auth?.[action] ?? [];
      const actualArgv = [
        definition.executable,
        ...authArguments(definition, action),
      ];
      if (canonical(expectedArgv) !== canonical(actualArgv)) {
        drift(`auth ${action} argv`, expectedArgv, actualArgv);
      }
    }
  }

  for (const profileCase of contract.profiles) {
    const identity: ToolAdapterIdentity = profileCase.identity
      ? {
          git: {
            name: "Contract Case",
            email: "contract@example.invalid",
            ...profileCase.identity,
          },
        }
      : {};
    const compiled = compileToolProfile(manifest, identity);
    const actual = { env: compiled.env ?? {}, args: compiled.args ?? [] };
    const expected = {
      env: profileCase.env ?? {},
      args: profileCase.args ?? [],
    };
    if (canonical(expected) !== canonical(actual)) {
      issues.push(
        issue(
          file,
          `${file}: profile case '${profileCase.case}' expects ${canonical(expected)} but the manifest compiles to ${canonical(actual)}`,
        ),
      );
    }
  }

  const identityFields = new Set<"sshKey" | "signingKey">();
  for (const argument of manifest.profile?.args ?? []) {
    if (typeof argument !== "string") {
      identityFields.add(argument.fromIdentity);
    }
  }
  for (const field of identityFields) {
    const emits = contract.profiles.some(
      (profileCase) => profileCase.identity?.[field] !== undefined,
    );
    const omits = contract.profiles.some(
      (profileCase) => profileCase.identity?.[field] === undefined,
    );
    if (!emits || !omits) {
      issues.push(
        issue(
          file,
          `${file}: identity-derived argument '${field}' needs one profile case where the identity provides it and one where it is omitted`,
        ),
      );
    }
  }

  const secretBearing = byteSort(
    Object.entries(manifest.profile?.env ?? {})
      .filter(
        ([name, source]) =>
          source !== null &&
          (typeof source !== "string" || isSensitiveVariable(name)),
      )
      .map(([name]) => name),
  );
  const declared = byteSort(contract.redactions);
  if (canonical(declared) !== canonical(secretBearing)) {
    issues.push(
      issue(
        file,
        `${file}: redactions contract ${canonical(declared)} does not match the secret-bearing env set ${canonical(secretBearing)}`,
      ),
    );
  }
  return issues;
}

/** Verify every behavior contract against its manifest's compiled behavior. */
export function checkContracts(
  entries: CatalogEntry[],
  contracts: ContractEntry[],
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const contractsById = new Set(contracts.map((entry) => entry.tool));
  for (const entry of entries) {
    if (!contractsById.has(entry.id)) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: missing catalog/contracts/${entry.id}.contract.jsonc behavior contract`,
        ),
      );
    }
  }
  for (const contractEntry of contracts) {
    const entry = byId.get(contractEntry.tool);
    if (!entry) {
      issues.push(
        issue(
          contractEntry.file,
          `${contractEntry.file}: no catalog/${contractEntry.tool}.jsonc manifest matches this contract`,
        ),
      );
      continue;
    }
    issues.push(...checkContractBehavior(entry, contractEntry));
  }
  return issues;
}

/** Contract-independent safety invariants enforced for every manifest. */
export function checkCatalogSafety(entries: CatalogEntry[]): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const entry of entries) {
    const scope = entry.manifest.isolation.scope;
    for (const [name, source] of Object.entries(
      entry.manifest.profile?.env ?? {},
    )) {
      if (source === null) {
        continue;
      }
      if (typeof source === "string") {
        if (isSensitiveVariable(name)) {
          issues.push(
            issue(
              entry.file,
              `${entry.file}: profile.env.${name} is a sensitive-named variable with a literal value; use a secret, env, or file source`,
            ),
          );
        }
        continue;
      }
      if (source.from === "secret") {
        if (scope === "shell") {
          issues.push(
            issue(
              entry.file,
              `${entry.file}: profile.env.${name} resolves a secret in a shell-scoped adapter; secrets must stay process-scoped`,
            ),
          );
        }
        if (!source.key.includes("{{identity}}")) {
          issues.push(
            issue(
              entry.file,
              `${entry.file}: profile.env.${name} secret key '${source.key}' must be scoped per identity with {{identity}}`,
            ),
          );
        }
      }
    }
  }
  return issues;
}

/** Render a deterministic behavior contract stub for scaffolding. */
export function renderContractTemplate(options: ScaffoldOptions): string {
  const detection = [
    options.executable ?? options.id,
    ...(options.alternatives ?? []),
  ];
  const lines = [
    `// ${options.displayName} - adapter behavior contract.`,
    `// catalog:check compiles catalog/${options.id}.jsonc and fails when these`,
    "// expectations drift; keep the contract in lockstep with the manifest.",
    "{",
    '  "contractVersion": 1,',
    '  "kind": "tool-contract",',
    `  "tool": ${JSON.stringify(options.id)},`,
    `  "detection": ${JSON.stringify(detection)},`,
    '  "profiles": [',
    "    // Expected compiled profile per identity shape; omitted env/args mean empty.",
    '    { "case": "default" }',
    "  ],",
    '  "redactions": []',
    "}",
    "",
  ];
  const rendered = lines.join("\n");
  const contract = parseToolAdapterContract(rendered);
  const manifest = parseToolAdapterManifest(renderManifestTemplate(options));
  const problems = checkContracts(
    [{ id: manifest.id, file: `${manifest.id}.jsonc`, manifest }],
    [
      {
        tool: contract.tool,
        file: `${contract.tool}.contract.jsonc`,
        contract,
      },
    ],
  );
  if (problems.length > 0) {
    throw new Error(
      `Rendered contract does not match the scaffolded manifest: ${problems
        .map((problem) => problem.message)
        .join("; ")}`,
    );
  }
  return rendered;
}
