import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import { SAFE_ID } from "./tool-adapters.js";

export const PRIVILEGED_ADAPTER_SCHEMA_VERSION = 1;
export const PRIVILEGED_ADAPTER_SIGNING_IDENTITY =
  "https://github.com/0xJord4n/ideality/.github/workflows/release.yml@refs/tags/v*";
export const PRIVILEGED_ADAPTER_SIGNING_ISSUER =
  "https://token.actions.githubusercontent.com";

export const ADAPTER_PLATFORMS = ["any", "darwin", "linux", "win32"] as const;
export const ADAPTER_ARCHITECTURES = ["any", "x64", "arm64"] as const;
export const ADAPTER_PRIVILEGES = [
  "external-cli",
  "host-network",
  "provider-killswitch",
  "sudo",
  "vm-helper",
  "hardware-virtualization",
  "secret-store",
  "read-only-secret-store",
  "custom-command",
] as const;

export type PrivilegedAdapterKind = "network" | "vm" | "secret";
export type AdapterPlatform = (typeof ADAPTER_PLATFORMS)[number];
export type AdapterPrivilege = (typeof ADAPTER_PRIVILEGES)[number];

const SAFE_EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SAFE_CONTACT = /^[^\s]+@[^\s]+$/;

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

const stringSet = <T extends readonly [string, ...string[]]>(
  values: T,
  label: string,
  minimum: number = 0,
) =>
  z
    .array(z.enum(values))
    .min(minimum)
    .superRefine((entries, context) => {
      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        if (seen.has(entry)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `Duplicate ${label} '${entry}'`,
          });
        }
        seen.add(entry);
      }
    });

const platformsSchema = z
  .object({
    os: stringSet(ADAPTER_PLATFORMS, "operating system", 1),
    arch: stringSet(ADAPTER_ARCHITECTURES, "architecture", 1),
    executables: z
      .array(
        z.string().max(128).regex(SAFE_EXECUTABLE, "Invalid executable name"),
      )
      .superRefine((entries, context) => {
        const seen = new Set<string>();
        for (const [index, entry] of entries.entries()) {
          if (seen.has(entry)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: `Duplicate executable '${entry}'`,
            });
          }
          seen.add(entry);
        }
      }),
  })
  .strict();

const permissionsSchema = z
  .object({
    privileges: stringSet(ADAPTER_PRIVILEGES, "privilege", 1),
    filesystem: stringSet(
      [
        "config-read",
        "config-write",
        "runtime-state",
        "secret-read",
        "secret-write",
      ] as const,
      "filesystem permission",
    ),
    network: stringSet(
      ["host-control", "provider-api", "guest-control"] as const,
      "network permission",
    ),
    secrets: stringSet(
      ["read", "write", "list", "delete"] as const,
      "secret permission",
    ),
  })
  .strict();

const provenanceSchema = z
  .object({
    repository: z.string().url(),
    license: z.string().min(1).max(64),
    maintainers: z.array(z.string().regex(SAFE_CONTACT)).min(1),
  })
  .strict();

const signingSchema = z
  .object({
    mode: z.literal("release-bundle"),
    identity: z.literal(PRIVILEGED_ADAPTER_SIGNING_IDENTITY),
    issuer: z.literal(PRIVILEGED_ADAPTER_SIGNING_ISSUER),
  })
  .strict();

const commonManifestSchema = z.object({
  schemaVersion: z.literal(PRIVILEGED_ADAPTER_SCHEMA_VERSION),
  kind: z.literal("privileged-adapter"),
  id: z.string().max(64).regex(SAFE_ID, "Invalid privileged adapter ID"),
  displayName: z.string().min(1).max(128),
  description: z.string().min(1).max(512),
  platforms: platformsSchema,
  permissions: permissionsSchema,
  implementation: z
    .object({
      type: z.enum(["trusted-core", "user-configured"]),
    })
    .strict(),
  provenance: provenanceSchema,
  signing: signingSchema,
});

const manifestSchema = z
  .discriminatedUnion("adapterKind", [
    commonManifestSchema
      .extend({
        adapterKind: z.literal("network"),
        capability: z
          .object({
            name: z.literal("network-lifecycle"),
            operations: z.tuple([
              z.literal("up"),
              z.literal("down"),
              z.literal("status"),
            ]),
          })
          .strict(),
      })
      .strict(),
    commonManifestSchema
      .extend({
        adapterKind: z.literal("vm"),
        capability: z
          .object({
            name: z.literal("vm-lifecycle"),
            operations: z.tuple([
              z.literal("start"),
              z.literal("stop"),
              z.literal("status"),
              z.literal("exec"),
            ]),
          })
          .strict(),
      })
      .strict(),
    commonManifestSchema
      .extend({
        adapterKind: z.literal("secret"),
        capability: z
          .object({
            name: z.literal("secret-backend"),
            operations: stringSet(
              ["read", "write", "list", "delete"] as const,
              "secret operation",
              1,
            ),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((manifest, context) => {
    const hasCustomCommands =
      manifest.permissions.privileges.includes("custom-command");
    if (
      (manifest.implementation.type === "user-configured") !==
      hasCustomCommands
    ) {
      context.addIssue({
        code: "custom",
        path: ["implementation", "type"],
        message:
          "user-configured implementations must declare custom-command privilege, and trusted-core implementations must not",
      });
    }
    if (
      manifest.adapterKind === "network" &&
      !manifest.permissions.network.includes("host-control")
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "network"],
        message: "Network adapters must declare host-control permission",
      });
    }
    if (
      manifest.adapterKind === "vm" &&
      !manifest.permissions.network.includes("guest-control")
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "network"],
        message: "VM adapters must declare guest-control permission",
      });
    }
    if (
      manifest.adapterKind === "secret" &&
      !sameStringSet(
        manifest.capability.operations,
        manifest.permissions.secrets,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissions", "secrets"],
        message:
          "Secret permissions must exactly match declared secret operations",
      });
    }
    const requiresExecutable =
      manifest.implementation.type === "trusted-core" &&
      (manifest.adapterKind === "network" ||
        manifest.adapterKind === "vm" ||
        manifest.permissions.privileges.includes("external-cli"));
    if (requiresExecutable && manifest.platforms.executables.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["platforms", "executables"],
        message:
          "Trusted command-backed adapters must declare their executable requirements",
      });
    }
  });

export type PrivilegedAdapterManifest = z.infer<typeof manifestSchema>;
export type NetworkAdapterManifest = Extract<
  PrivilegedAdapterManifest,
  { adapterKind: "network" }
>;
export type VmAdapterManifest = Extract<
  PrivilegedAdapterManifest,
  { adapterKind: "vm" }
>;
export type SecretAdapterManifest = Extract<
  PrivilegedAdapterManifest,
  { adapterKind: "secret" }
>;

/** Parse a strict, signed privileged-adapter contribution manifest. */
export function parsePrivilegedAdapterManifest(
  source: string,
): PrivilegedAdapterManifest {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid privileged adapter JSONC: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid privileged adapter manifest: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
