import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import type {
  AuthAction,
  IdealityConfig,
  ToolDefinition,
  ToolProfile,
} from "../domain/config.js";

const valueSourceSchema = z.union([
  z.string(),
  z.object({
    from: z.literal("file"),
    path: z.string().min(1),
    optional: z.boolean().optional(),
  }),
  z.object({
    from: z.literal("env"),
    name: z.string().min(1),
    optional: z.boolean().optional(),
  }),
  z.object({
    from: z.literal("secret"),
    key: z.string().min(1),
    optional: z.boolean().optional(),
  }),
]);

const authSchema = z
  .object({
    login: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    logout: z.array(z.string()).optional(),
  })
  .optional();

const pluginSchema = z.object({
  version: z.literal(1),
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string().optional(),
  executable: z.string().min(1),
  detect: z.array(z.string().min(1)).optional(),
  auth: authSchema,
  profile: z
    .object({
      enabled: z.boolean().optional(),
      executable: z.string().min(1).optional(),
      isolation: z.literal("process").optional(),
      env: z.record(valueSourceSchema.nullable()).optional(),
      args: z.array(z.string()).optional(),
    })
    .optional(),
});

export interface PluginManifest {
  version: 1;
  name: string;
  description?: string;
  executable: string;
  detect?: string[];
  auth?: Partial<Record<AuthAction, string[]>>;
  profile?: ToolProfile;
}

export function parsePluginManifest(source: string): PluginManifest {
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
  const result = pluginSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid plugin manifest: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export function applyPlugin(
  config: IdealityConfig,
  manifest: PluginManifest,
): IdealityConfig {
  const next = structuredClone(config);
  const definition: ToolDefinition = {
    executable: manifest.executable,
    isolation: "process",
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.detect ? { detect: manifest.detect } : {}),
    ...(manifest.auth ? { auth: manifest.auth } : {}),
  };
  next.tools[manifest.name] = definition;
  for (const identity of Object.values(next.identities)) {
    identity.tools[manifest.name] = structuredClone(
      manifest.profile ?? { isolation: "process" },
    );
  }
  return next;
}

export function pluginDirectory(idealityHome: string): string {
  return path.join(idealityHome, "plugins");
}

export async function writePluginManifest(
  manifest: PluginManifest,
  idealityHome: string,
): Promise<string> {
  const directory = pluginDirectory(idealityHome);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${manifest.name}.jsonc`);
  const temporary = `${target}.${process.pid}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(temporary, 0o600);
  await rename(temporary, target);
  return target;
}

export async function listPluginManifests(
  idealityHome: string,
): Promise<Array<{ file: string; manifest: PluginManifest }>> {
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
