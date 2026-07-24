import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import type { IdealityConfig } from "../domain/config.js";
import { createToolAdapterEnvelope } from "./adapters.js";
import {
  parseToolAdapterManifest,
  TOOL_ADAPTER_SCHEMA_VERSION,
  type ToolAdapterManifest,
} from "./tool-adapters.js";

/** Pack assigned to translated version-1 plugins; mirrors the `tool list` fallback label. */
export const PLUGIN_PACK = "custom";

const legacyAuthSchema = z
  .object({
    login: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    logout: z.array(z.string()).optional(),
  })
  .strict();

const legacyPluginSchema = z
  .object({
    version: z.literal(1),
    name: z.string(),
    description: z.string().optional(),
    executable: z.string(),
    detect: z.array(z.string()).optional(),
    auth: legacyAuthSchema.optional(),
    profile: z
      .object({
        enabled: z.boolean().optional(),
        executable: z.string().optional(),
        isolation: z.literal("process").optional(),
        env: z.record(z.unknown()).optional(),
        args: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    // `enabled: true` is the implicit default everywhere, so only `false` is untranslatable.
    if (manifest.profile?.enabled === false) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "enabled"],
        message:
          "Cannot be translated to a tool adapter manifest; plugins always install enabled",
      });
    }
    if (manifest.profile?.executable !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "executable"],
        message:
          "Cannot be translated to a tool adapter manifest; set the top-level executable instead",
      });
    }
  });

type LegacyPluginManifest = z.infer<typeof legacyPluginSchema>;

function translateLegacyPlugin(
  legacy: LegacyPluginManifest,
): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  const env = legacy.profile?.env ?? {};
  if (Object.keys(env).length > 0) {
    profile.env = env;
  }
  if (legacy.profile?.args?.length) {
    profile.args = legacy.profile.args;
  }
  return {
    schemaVersion: TOOL_ADAPTER_SCHEMA_VERSION,
    kind: "tool",
    id: legacy.name,
    displayName: legacy.name,
    ...(legacy.description !== undefined
      ? { description: legacy.description }
      : {}),
    pack: PLUGIN_PACK,
    executable: {
      primary: legacy.executable,
      ...(legacy.detect?.length ? { alternatives: legacy.detect } : {}),
    },
    ...(legacy.auth && Object.keys(legacy.auth).length > 0
      ? { auth: legacy.auth }
      : {}),
    ...(Object.keys(profile).length > 0 ? { profile } : {}),
  };
}

function rebrandAdapterError(message: string): string {
  const remapped = message
    .replace(/^Invalid tool adapter manifest: /, "")
    .split("; ")
    .map((segment) =>
      segment
        .replace(/^id: /, "name: ")
        .replace(/^executable\.primary: /, "executable: ")
        .replace(/^executable\.alternatives\./, "detect."),
    )
    .join("; ");
  return `Invalid plugin manifest: ${remapped}`;
}

function parseTranslatedLegacy(value: unknown): ToolAdapterManifest {
  const result = legacyPluginSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid plugin manifest: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  try {
    return parseToolAdapterManifest(
      JSON.stringify(translateLegacyPlugin(result.data)),
    );
  } catch (error) {
    throw new Error(rebrandAdapterError((error as Error).message));
  }
}

function assertProcessScoped(manifest: ToolAdapterManifest): void {
  if (manifest.isolation.scope !== "process") {
    throw new Error(
      "Invalid plugin manifest: isolation.scope: plugins must use process isolation; shell scope would export plugin state through shell hooks",
    );
  }
}

/**
 * Parse a plugin manifest into the canonical tool adapter shape, accepting the
 * version-1 plugin format through a lossless translation.
 */
export function parsePluginManifest(source: string): ToolAdapterManifest {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid plugin JSONC: ${errors
        .map((error) => printParseErrorCode(error.error))
        .join(", ")}`,
    );
  }
  const isLegacy =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "version" in value &&
    !("schemaVersion" in value);
  const manifest = isLegacy
    ? parseTranslatedLegacy(value)
    : parseToolAdapterManifest(source);
  assertProcessScoped(manifest);
  return manifest;
}

/** Register the compiled tool definition and per-identity default profiles. */
export function applyPlugin(
  config: IdealityConfig,
  manifest: ToolAdapterManifest,
): IdealityConfig {
  const next = structuredClone(config);
  const adapter = createToolAdapterEnvelope(manifest, { builtIn: false });
  next.tools[manifest.id] = adapter.contract.definition;
  for (const identity of Object.values(next.identities)) {
    identity.tools[manifest.id] = adapter.contract.compileProfile({
      git: identity.git,
    });
  }
  return next;
}

export function pluginDirectory(idealityHome: string): string {
  return path.join(idealityHome, "plugins");
}

export async function writePluginManifest(
  manifest: ToolAdapterManifest,
  idealityHome: string,
): Promise<string> {
  const directory = pluginDirectory(idealityHome);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${manifest.id}.jsonc`);
  const temporary = `${target}.${process.pid}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  return target;
}

export async function listPluginManifests(
  idealityHome: string,
): Promise<Array<{ file: string; manifest: ToolAdapterManifest }>> {
  const directory = pluginDirectory(idealityHome);
  try {
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".jsonc"))
      .sort();
    return Promise.all(
      files.map(async (file) => ({
        file: path.join(directory, file),
        manifest: parsePluginManifest(
          await Bun.file(path.join(directory, file)).text(),
        ),
      })),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

export async function removePluginManifest(
  name: string,
  idealityHome: string,
): Promise<void> {
  await rm(path.join(pluginDirectory(idealityHome), `${name}.jsonc`), {
    force: true,
  });
}
