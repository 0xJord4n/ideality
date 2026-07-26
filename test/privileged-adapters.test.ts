import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS,
  BUILTIN_PRIVILEGED_ADAPTERS,
} from "../src/adapters/privileged-builtins.js";
import { ADAPTER_REGISTRY } from "../src/core/adapters.js";
import {
  parsePrivilegedAdapterManifest,
  PRIVILEGED_ADAPTER_SIGNING_IDENTITY,
  PRIVILEGED_ADAPTER_SIGNING_ISSUER,
  type PrivilegedAdapterManifest,
} from "../src/core/privileged-adapters.js";
import {
  checkPrivilegedAdapterContracts,
  loadPrivilegedAdapterContracts,
  loadPrivilegedAdapterManifests,
  parsePrivilegedAdapterContract,
} from "../scripts/privileged-adapter-contracts.js";

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "privileged-adapter",
    adapterKind: "network",
    id: "acme",
    displayName: "Acme Network",
    description: "Reviewed Acme network lifecycle integration",
    capability: {
      name: "network-lifecycle",
      operations: ["up", "down", "status"],
    },
    platforms: {
      os: ["linux"],
      arch: ["x64"],
      executables: ["acme"],
    },
    permissions: {
      privileges: ["host-network"],
      filesystem: ["runtime-state"],
      network: ["host-control"],
      secrets: [],
    },
    implementation: {
      type: "trusted-core",
    },
    provenance: {
      repository: "https://github.com/example/acme",
      license: "MIT",
      maintainers: ["acme@example.invalid"],
    },
    signing: {
      mode: "release-bundle",
      identity: PRIVILEGED_ADAPTER_SIGNING_IDENTITY,
      issuer: PRIVILEGED_ADAPTER_SIGNING_ISSUER,
    },
  };
}

describe("privileged adapter contribution format", () => {
  test("parses a strict signed manifest and rejects undeclared capabilities", () => {
    const manifest = parsePrivilegedAdapterManifest(
      JSON.stringify(validManifest()),
    );
    expect(manifest.id).toBe("acme");
    expect(manifest.capability.operations).toEqual(["up", "down", "status"]);

    expect(() =>
      parsePrivilegedAdapterManifest(
        JSON.stringify({ ...validManifest(), contributorCode: "./adapter.ts" }),
      ),
    ).toThrow("Unrecognized key");

    const missingOperation = validManifest();
    missingOperation.capability = {
      name: "network-lifecycle",
      operations: ["up", "down"],
    };
    expect(() =>
      parsePrivilegedAdapterManifest(JSON.stringify(missingOperation)),
    ).toThrow("operations");

    const unsignedByRelease = validManifest();
    unsignedByRelease.signing = {
      mode: "release-bundle",
      identity:
        "https://github.com/example/acme/.github/workflows/release.yml@refs/tags/v*",
      issuer: PRIVILEGED_ADAPTER_SIGNING_ISSUER,
    };
    expect(() =>
      parsePrivilegedAdapterManifest(JSON.stringify(unsignedByRelease)),
    ).toThrow("signing.identity");

    const reorderedSecretPermissions = validManifest();
    reorderedSecretPermissions.adapterKind = "secret";
    reorderedSecretPermissions.capability = {
      name: "secret-backend",
      operations: ["read", "write"],
    };
    reorderedSecretPermissions.platforms = {
      os: ["any"],
      arch: ["any"],
      executables: [],
    };
    reorderedSecretPermissions.permissions = {
      privileges: ["secret-store"],
      filesystem: ["secret-read", "secret-write"],
      network: [],
      secrets: ["write", "read"],
    };
    expect(() =>
      parsePrivilegedAdapterManifest(
        JSON.stringify(reorderedSecretPermissions),
      ),
    ).not.toThrow();
  });

  test("loads every shipped manifest into the runtime registry", async () => {
    const { manifests, issues } = await loadPrivilegedAdapterManifests();
    expect(issues).toEqual([]);
    expect(manifests).toHaveLength(18);
    expect(BUILTIN_PRIVILEGED_ADAPTERS).toHaveLength(18);

    const byKey = new Map(
      manifests.map((manifest) => [
        `${manifest.adapterKind}:${manifest.id}`,
        manifest,
      ]),
    );
    for (const manifest of BUILTIN_PRIVILEGED_ADAPTERS) {
      expect(byKey.get(`${manifest.adapterKind}:${manifest.id}`)).toEqual(
        manifest,
      );
      const envelope =
        ADAPTER_REGISTRY[
          manifest.adapterKind === "network"
            ? "networks"
            : manifest.adapterKind === "vm"
              ? "vms"
              : "secrets"
        ][manifest.id];
      expect(envelope?.metadata.displayName).toBe(manifest.displayName);
      expect(envelope?.metadata.platforms).toEqual(manifest.platforms.os);
      expect(envelope?.metadata.privileges).toEqual(
        manifest.permissions.privileges,
      );
    }

    expect(
      Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.network),
    ).toHaveLength(6);
    expect(Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.vm)).toHaveLength(
      5,
    );
    expect(
      Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.secret),
    ).toHaveLength(7);
  });

  test("requires and verifies behavior contracts for every shipped manifest", async () => {
    const { manifests, issues: manifestIssues } =
      await loadPrivilegedAdapterManifests();
    const { contracts, issues: contractIssues } =
      await loadPrivilegedAdapterContracts();
    expect(manifestIssues).toEqual([]);
    expect(contractIssues).toEqual([]);
    expect(contracts).toHaveLength(manifests.length);
    expect(
      await checkPrivilegedAdapterContracts(
        manifests,
        contracts,
        ADAPTER_REGISTRY,
      ),
    ).toEqual([]);
  });

  test("rejects secret contracts without operation behavior expectations", () => {
    expect(() =>
      parsePrivilegedAdapterContract(
        JSON.stringify({
          contractVersion: 1,
          kind: "privileged-adapter-contract",
          adapterKind: "secret",
          adapter: "file",
          cases: [
            {
              case: "default",
              platform: "linux",
              config: { type: "file" },
              expected: { executable: null, writable: true },
            },
          ],
        }),
      ),
    ).toThrow("operations");
  });

  test("reports missing contracts and observable behavior drift", async () => {
    const manifest = BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.secret.file;
    expect(
      (
        await checkPrivilegedAdapterContracts([manifest], [], ADAPTER_REGISTRY)
      ).map((issue) => issue.message),
    ).toEqual([
      "secret-file.jsonc: missing privileged-adapters/contracts/secret-file.contract.jsonc behavior contract",
    ]);

    const contract = parsePrivilegedAdapterContract(
      JSON.stringify({
        contractVersion: 1,
        kind: "privileged-adapter-contract",
        adapterKind: "secret",
        adapter: "file",
        cases: [
          {
            case: "default",
            platform: "linux",
            config: { type: "file" },
            expected: {
              executable: "not-file",
              writable: true,
              operations: {
                read: {
                  key: "contract/token",
                  result: "contract-secret",
                  calls: [],
                },
                write: {
                  key: "contract/token",
                  value: "contract-secret",
                  calls: [],
                },
                list: {
                  result: {
                    backend: "file",
                    supported: true,
                    writable: true,
                    references: ["contract/token"],
                  },
                  calls: [],
                },
                delete: { key: "contract/token", calls: [] },
              },
            },
          },
        ],
      }),
    );
    expect(
      (
        await checkPrivilegedAdapterContracts(
          [manifest],
          [
            {
              key: "secret:file",
              file: "secret-file.contract.jsonc",
              contract,
            },
          ],
          ADAPTER_REGISTRY,
        )
      ).some((issue) => issue.message.includes("executable")),
    ).toBe(true);
  });

  test("keeps manifest types discriminated by adapter kind", () => {
    const manifest: PrivilegedAdapterManifest =
      BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.network.wireguard;
    expect(manifest.adapterKind).toBe("network");
    expect(manifest.capability.name).toBe("network-lifecycle");
  });

  test("ships editor schemas for the strict privileged format", async () => {
    const manifestSchema = JSON.parse(
      await Bun.file(
        path.resolve(
          import.meta.dir,
          "../schemas/privileged-adapter.v1.schema.json",
        ),
      ).text(),
    ) as {
      properties: {
        implementation: { required: string[] };
        provenance: { required: string[] };
      };
      allOf: unknown[];
    };
    const contractSchema = JSON.parse(
      await Bun.file(
        path.resolve(
          import.meta.dir,
          "../schemas/privileged-adapter-contract.v1.schema.json",
        ),
      ).text(),
    ) as {
      $defs: {
        secretOperations: { minProperties: number };
        secretCase: {
          properties: {
            expected: { required: string[] };
          };
        };
      };
    };

    expect(manifestSchema.properties.implementation.required).toEqual(["type"]);
    expect(manifestSchema.properties.provenance.required).toEqual([
      "repository",
      "license",
      "maintainers",
    ]);
    const refinements = JSON.stringify(manifestSchema.allOf);
    for (const invariant of [
      "host-control",
      "guest-control",
      "custom-command",
      "external-cli",
    ]) {
      expect(refinements).toContain(invariant);
    }
    expect(contractSchema.$defs.secretOperations.minProperties).toBe(1);
    expect(
      contractSchema.$defs.secretCase.properties.expected.required,
    ).toContain("operations");
  });
});
