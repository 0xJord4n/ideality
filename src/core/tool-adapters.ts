import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import type {
  AuthAction,
  GitIdentity,
  ToolDefinition,
  ToolProfile,
  ValueSource,
} from "../domain/config.js";

export const TOOL_ADAPTER_SCHEMA_VERSION = 1;

const SAFE_ID = /^[a-z][a-z0-9_-]*$/;
const SAFE_EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SAFE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ToolAdapterExecutable {
  primary: string;
  alternatives?: string[];
  shim?: boolean;
}

export interface ToolAdapterIsolation {
  scope: "process" | "shell";
  state: "full" | "partial" | "credentials";
}

export interface ToolAdapterIdentityArg {
  fromIdentity: "sshKey" | "signingKey";
  prefix?: string[];
}

export type ToolAdapterArg = string | ToolAdapterIdentityArg;

export interface ToolAdapterProfile {
  env?: Record<string, ValueSource | null>;
  args?: ToolAdapterArg[];
}

export interface ToolAdapterManifest {
  schemaVersion: typeof TOOL_ADAPTER_SCHEMA_VERSION;
  kind: "tool";
  id: string;
  displayName: string;
  description?: string;
  pack: string;
  executable: ToolAdapterExecutable;
  isolation: ToolAdapterIsolation;
  auth?: Partial<Record<AuthAction, string[]>>;
  profile?: ToolAdapterProfile;
}

export interface ToolAdapterIdentity {
  git?: GitIdentity;
}

const valueSourceSchema = z.union([
  z.string(),
  z
    .object({
      from: z.literal("file"),
      path: z.string().min(1),
      optional: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      from: z.literal("env"),
      name: z
        .string()
        .regex(SAFE_VARIABLE, "Invalid environment variable name"),
      optional: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      from: z.literal("secret"),
      key: z.string().min(1),
      optional: z.boolean().optional(),
    })
    .strict(),
]);

const identityArgSchema = z
  .object({
    fromIdentity: z.enum(["sshKey", "signingKey"]),
    prefix: z.array(z.string().min(1)).optional(),
  })
  .strict();

const authCommandSchema = z.array(z.string().min(1)).min(1);

const manifestSchema = z
  .object({
    schemaVersion: z.literal(TOOL_ADAPTER_SCHEMA_VERSION),
    kind: z.literal("tool"),
    id: z.string().max(64).regex(SAFE_ID, "Invalid tool adapter ID"),
    displayName: z.string().min(1),
    description: z.string().min(1).optional(),
    pack: z.string().max(64).regex(SAFE_ID, "Invalid pack ID"),
    executable: z
      .object({
        primary: z
          .string()
          .max(128)
          .regex(SAFE_EXECUTABLE, "Invalid executable name"),
        alternatives: z
          .array(
            z
              .string()
              .max(128)
              .regex(SAFE_EXECUTABLE, "Invalid executable name"),
          )
          .optional(),
        shim: z.boolean().optional(),
      })
      .strict(),
    isolation: z
      .object({
        scope: z.enum(["process", "shell"]).default("process"),
        state: z.enum(["full", "partial", "credentials"]).default("partial"),
      })
      .strict()
      .default({}),
    auth: z
      .object({
        login: authCommandSchema.optional(),
        status: authCommandSchema.optional(),
        logout: authCommandSchema.optional(),
      })
      .strict()
      .optional(),
    profile: z
      .object({
        env: z.record(valueSourceSchema.nullable()).optional(),
        args: z.array(z.union([z.string().min(1), identityArgSchema])).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set([manifest.executable.primary]);
    for (const [index, alias] of (
      manifest.executable.alternatives ?? []
    ).entries()) {
      if (seen.has(alias)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["executable", "alternatives", index],
          message: `Duplicate executable alias '${alias}'`,
        });
      }
      seen.add(alias);
    }
    for (const name of Object.keys(manifest.profile?.env ?? {})) {
      if (!SAFE_VARIABLE.test(name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile", "env", name],
          message: `Invalid environment variable name '${name}'`,
        });
      }
    }
  });

/** Parse a strict tool adapter manifest from JSONC source. */
export function parseToolAdapterManifest(source: string): ToolAdapterManifest {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid tool adapter JSONC: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  if (typeof value === "object" && value !== null && "schemaVersion" in value) {
    const version = (value as { schemaVersion: unknown }).schemaVersion;
    if (version !== TOOL_ADAPTER_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported tool adapter schemaVersion '${String(version)}' (supported: ${TOOL_ADAPTER_SCHEMA_VERSION})`,
      );
    }
  }
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid tool adapter manifest: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/** Compile a manifest into the catalog-level tool definition. */
export function compileToolDefinition(
  manifest: ToolAdapterManifest,
): ToolDefinition {
  return {
    executable: manifest.executable.primary,
    displayName: manifest.displayName,
    ...(manifest.description !== undefined
      ? { description: manifest.description }
      : {}),
    pack: manifest.pack,
    isolation: manifest.isolation.scope,
    stateIsolation: manifest.isolation.state,
    ...(manifest.executable.shim !== undefined
      ? { shim: manifest.executable.shim }
      : {}),
    ...(manifest.executable.alternatives?.length
      ? { detect: [...manifest.executable.alternatives] }
      : {}),
    ...(manifest.auth ? { auth: structuredClone(manifest.auth) } : {}),
  };
}

/** Compile the manifest's default profile for one identity, keeping args as plain strings. */
export function compileToolProfile(
  manifest: ToolAdapterManifest,
  identity: ToolAdapterIdentity = {},
): ToolProfile {
  const profile: ToolProfile = {};
  const env = manifest.profile?.env;
  if (env && Object.keys(env).length > 0) {
    profile.env = structuredClone(env);
  }
  const args = (manifest.profile?.args ?? []).flatMap((entry) =>
    typeof entry === "string" ? [entry] : resolveIdentityArg(entry, identity.git),
  );
  if (args.length > 0) {
    profile.args = args;
  }
  return profile;
}

function resolveIdentityArg(
  arg: ToolAdapterIdentityArg,
  git: GitIdentity | undefined,
): string[] {
  const value = git?.[arg.fromIdentity];
  if (!value) {
    return [];
  }
  return [...(arg.prefix ?? []), value];
}
