import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SecretAdapterEnvelope } from "../src/core/adapters.js";
import type { SecretCommandRunner } from "../src/core/secret-backends.js";
import type {
  IdealityConfig,
  SecretBackendConfig,
} from "../src/domain/config.js";
import { issue, type CatalogIssue } from "./catalog-lib.js";
import type {
  PrivilegedAdapterContractEntry,
  SecretRunnerCall,
} from "./privileged-adapter-contracts.js";
import { behaviorIssue, canonical } from "./privileged-contract-utils.js";

function configForSecretBackend(
  secretBackend: SecretBackendConfig,
): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "contract",
    secretBackend,
    identities: {
      contract: {
        label: "Contract",
        roots: ["/contract"],
        tools: {},
      },
    },
    tools: {},
  };
}

function normalizeContractString(
  value: string,
  home: string,
  idealityHome: string,
): string {
  if (value.startsWith(idealityHome)) {
    return `{{idealityHome}}${value.slice(idealityHome.length)}`;
  }
  if (value.startsWith(home)) {
    return `{{home}}${value.slice(home.length)}`;
  }
  return value;
}

function normalizeRunnerCalls(
  calls: SecretRunnerCall[],
  home: string,
  idealityHome: string,
): SecretRunnerCall[] {
  return calls.map((call) => ({
    command: call.command.map((value) =>
      normalizeContractString(value, home, idealityHome),
    ),
    ...(call.input === undefined ? {} : { input: call.input }),
    ...(call.environment === undefined
      ? {}
      : {
          environment: Object.fromEntries(
            Object.entries(call.environment).map(([name, value]) => [
              name,
              normalizeContractString(value, home, idealityHome),
            ]),
          ),
        }),
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exercise every declared secret operation without touching a real provider. */
export async function checkSecretContract(
  envelope: SecretAdapterEnvelope,
  entry: PrivilegedAdapterContractEntry,
): Promise<CatalogIssue[]> {
  if (entry.contract.adapterKind !== "secret") return [];
  const issues: CatalogIssue[] = [];
  for (const testCase of entry.contract.cases) {
    const platforms = envelope.contract.manifest.platforms.os;
    if (
      !platforms.some(
        (platform) => platform === "any" || platform === testCase.platform,
      )
    ) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: ${testCase.case} uses undeclared platform '${testCase.platform}'`,
        ),
      );
    }
    const config = configForSecretBackend(testCase.config);
    const actualMetadata = {
      executable: envelope.contract.executable(config, testCase.platform),
      writable: envelope.contract.writable(config, testCase.platform),
    };
    const expectedMetadata = {
      executable: testCase.expected.executable,
      writable: testCase.expected.writable,
    };
    if (canonical(expectedMetadata) !== canonical(actualMetadata)) {
      issues.push(
        behaviorIssue(
          entry.file,
          `${testCase.case} executable and writability`,
          expectedMetadata,
          actualMetadata,
        ),
      );
    }
    const declaredOperations = [
      ...envelope.contract.manifest.capability.operations,
    ]
      .sort()
      .join(",");
    const contractedOperations = Object.keys(testCase.expected.operations)
      .sort()
      .join(",");
    if (contractedOperations !== declaredOperations) {
      issues.push(
        issue(
          entry.file,
          `${entry.file}: ${testCase.case} operation coverage [${contractedOperations}] does not match declared capabilities [${declaredOperations}]`,
        ),
      );
      continue;
    }

    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-privileged-contract-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const calls: SecretRunnerCall[] = [];
    const runner: SecretCommandRunner = async (command, input, environment) => {
      calls.push({
        command: [...command],
        ...(input === undefined ? {} : { input }),
        ...(environment === undefined
          ? {}
          : { environment: { ...environment } }),
      });
      const stdout =
        command[1] === "--encrypt"
          ? "encrypted-contract-secret"
          : "contract-secret\n";
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode(stdout),
        stderr: "",
      };
    };
    const operationActual = (): { calls: SecretRunnerCall[] } => ({
      calls: normalizeRunnerCalls(calls, home, idealityHome),
    });
    const resetCalls = (): void => {
      calls.length = 0;
    };

    try {
      const write = testCase.expected.operations.write;
      if (write) {
        resetCalls();
        const actual: {
          error?: string;
          calls: SecretRunnerCall[];
        } = { calls: [] };
        try {
          await envelope.contract.write(
            config,
            write.key,
            write.value,
            home,
            idealityHome,
            runner,
            testCase.platform,
          );
        } catch (error) {
          actual.error = errorMessage(error);
        }
        actual.calls = operationActual().calls;
        if (
          canonical(write) !==
          canonical({ ...actual, key: write.key, value: write.value })
        ) {
          issues.push(
            behaviorIssue(
              entry.file,
              `${testCase.case} write behavior`,
              write,
              { ...actual, key: write.key, value: write.value },
            ),
          );
        }
      }

      const read = testCase.expected.operations.read;
      if (read) {
        resetCalls();
        const actual: {
          result?: string;
          error?: string;
          calls: SecretRunnerCall[];
        } = { calls: [] };
        try {
          actual.result = await envelope.contract.read(
            config,
            read.key,
            home,
            idealityHome,
            runner,
            testCase.platform,
          );
        } catch (error) {
          actual.error = errorMessage(error);
        }
        actual.calls = operationActual().calls;
        if (canonical(read) !== canonical({ ...actual, key: read.key })) {
          issues.push(
            behaviorIssue(entry.file, `${testCase.case} read behavior`, read, {
              ...actual,
              key: read.key,
            }),
          );
        }
      }

      const list = testCase.expected.operations.list;
      if (list) {
        resetCalls();
        const actual = {
          result: await envelope.contract.list(
            config,
            home,
            idealityHome,
            testCase.platform,
          ),
          calls: operationActual().calls,
        };
        if (canonical(list) !== canonical(actual)) {
          issues.push(
            behaviorIssue(
              entry.file,
              `${testCase.case} list behavior`,
              list,
              actual,
            ),
          );
        }
      }

      const deleteExpectation = testCase.expected.operations.delete;
      if (deleteExpectation) {
        resetCalls();
        const actual: {
          error?: string;
          calls: SecretRunnerCall[];
        } = { calls: [] };
        try {
          await envelope.contract.delete(
            config,
            deleteExpectation.key,
            home,
            idealityHome,
            runner,
            testCase.platform,
          );
        } catch (error) {
          actual.error = errorMessage(error);
        }
        actual.calls = operationActual().calls;
        if (
          canonical(deleteExpectation) !==
          canonical({ ...actual, key: deleteExpectation.key })
        ) {
          issues.push(
            behaviorIssue(
              entry.file,
              `${testCase.case} delete behavior`,
              deleteExpectation,
              { ...actual, key: deleteExpectation.key },
            ),
          );
        }
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
  return issues;
}
