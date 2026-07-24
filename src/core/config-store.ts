import { chmod, mkdir, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import type { IdealityConfig } from "../domain/config.js";

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
]);

const toolProfileSchema = z.object({
  enabled: z.boolean().optional(),
  executable: z.string().min(1).optional(),
  isolation: z.enum(["shell", "process"]).optional(),
  env: z.record(valueSourceSchema.nullable()).optional(),
  args: z.array(z.string()).optional(),
});

const identitySchema = z.object({
  label: z.string().min(1),
  roots: z.array(z.string().min(1)).min(1),
  color: z.string().optional(),
  git: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      sshKey: z.string().min(1).optional(),
      signingKey: z.string().min(1).optional(),
      gpgSign: z.boolean().optional(),
    })
    .optional(),
  tools: z.record(toolProfileSchema),
});

const configSchema = z
  .object({
    version: z.literal(1),
    defaultIdentity: z.string().min(1),
    identities: z.record(identitySchema),
    tools: z.record(
      z.object({
        executable: z.string().min(1),
        description: z.string().optional(),
        isolation: z.enum(["shell", "process"]).optional(),
        detect: z.array(z.string().min(1)).optional(),
        auth: z
          .object({
            login: z.array(z.string()).optional(),
            status: z.array(z.string()).optional(),
            logout: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    ),
  })
  .superRefine((config, context) => {
    const safeName = /^[a-z][a-z0-9_-]*$/;
    const safeVariable = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (!config.identities[config.defaultIdentity]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultIdentity"],
        message: `Default identity '${config.defaultIdentity}' does not exist`,
      });
    }
    for (const [id, identity] of Object.entries(config.identities)) {
      if (!safeName.test(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["identities", id],
          message: `Invalid identity ID '${id}'`,
        });
      }
      for (const [index, root] of identity.roots.entries()) {
        if (/[\0\r\n"]/.test(root)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identities", id, "roots", index],
            message: "Directory roots cannot contain NUL, newlines, or quotes",
          });
        }
      }
      for (const [tool, profile] of Object.entries(identity.tools)) {
        if (!config.tools[tool]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identities", id, "tools", tool],
            message: `Tool '${tool}' has no definition`,
          });
        }
        for (const variable of Object.keys(profile.env ?? {})) {
          if (!safeVariable.test(variable)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["identities", id, "tools", tool, "env", variable],
              message: `Invalid environment variable '${variable}'`,
            });
          }
        }
      }
    }
    for (const tool of Object.keys(config.tools)) {
      if (!safeName.test(tool)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tools", tool],
          message: `Invalid tool name '${tool}'`,
        });
      }
    }
  });

export function getIdealityHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.IDEALITY_HOME) {
    return path.resolve(env.IDEALITY_HOME);
  }
  return path.join(path.resolve(env.HOME || os.homedir()), ".ideality");
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.IDEALITY_CONFIG
    ? path.resolve(env.IDEALITY_CONFIG)
    : path.join(getIdealityHome(env), "config.jsonc");
}

export function parseConfig(source: string): IdealityConfig {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const detail = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Invalid JSONC: ${detail}`);
  }

  const result = configSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ideality config: ${detail}`);
  }
  return result.data;
}

export async function loadConfig(
  configPath: string = getConfigPath(),
): Promise<IdealityConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`No ideality config at '${configPath}'. Run 'ideality init'.`);
  }
  return parseConfig(await file.text());
}

export async function saveConfig(
  config: IdealityConfig,
  configPath: string = getConfigPath(),
): Promise<void> {
  const validated = configSchema.parse(config);
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  await Bun.write(temporaryPath, content);
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, configPath);
}
