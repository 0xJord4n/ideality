import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import { CONFIG_VERSION, type IdealityConfig } from "../domain/config.js";

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

const secretBackendSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    directory: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("age"),
    directory: z.string().min(1).optional(),
    recipient: z.string().min(1),
    identityFile: z.string().min(1),
  }),
  z.object({
    type: z.literal("keychain"),
    service: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("pass"),
    prefix: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("onepassword") }),
  z.object({
    type: z.literal("bitwarden"),
    appDataDirectory: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("dashlane") }),
]);

const toolProfileSchema = z.object({
  enabled: z.boolean().optional(),
  executable: z.string().min(1).optional(),
  isolation: z.enum(["shell", "process"]).optional(),
  execution: z
    .discriminatedUnion("target", [
      z.object({
        target: z.literal("host"),
        network: z.string().min(1).optional(),
      }),
      z.object({
        target: z.literal("vm"),
        vm: z.string().min(1),
        network: z.string().min(1).optional(),
      }),
    ])
    .optional(),
  env: z.record(valueSourceSchema.nullable()).optional(),
  args: z.array(z.string()).optional(),
});

const executionSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("host"),
    network: z.string().min(1).optional(),
  }),
  z.object({
    target: z.literal("vm"),
    vm: z.string().min(1),
    network: z.string().min(1).optional(),
  }),
]);

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
  execution: executionSchema.optional(),
  tools: z.record(toolProfileSchema),
});

const networkBase = {
  label: z.string().min(1).optional(),
  sudo: z.boolean().optional(),
  killSwitch: z.enum(["required", "provider", "off"]).optional(),
  dns: z
    .union([
      z.enum(["provider", "system"]),
      z.object({
        servers: z.array(z.string().min(1)).min(1),
        search: z.array(z.string().min(1)).optional(),
      }),
    ])
    .optional(),
  ipv6: z.enum(["tunnel", "block"]).optional(),
  lan: z.enum(["deny", "allow"]).optional(),
};

const networkSchema = z.discriminatedUnion("driver", [
  z.object({
    ...networkBase,
    driver: z.literal("wireguard"),
    config: valueSourceSchema,
    executable: z.string().min(1).optional(),
    interface: z.string().min(1).optional(),
  }),
  z.object({
    ...networkBase,
    driver: z.literal("openvpn"),
    config: valueSourceSchema,
    username: valueSourceSchema.optional(),
    password: valueSourceSchema.optional(),
    executable: z.string().min(1).optional(),
    extraArgs: z.array(z.string()).optional(),
  }),
  z.object({
    ...networkBase,
    driver: z.literal("mullvad"),
    executable: z.string().min(1).optional(),
    location: z
      .object({
        country: z.string().min(1).optional(),
        city: z.string().min(1).optional(),
        hostname: z.string().min(1).optional(),
      })
      .optional(),
  }),
  z.object({
    ...networkBase,
    driver: z.literal("tailscale"),
    executable: z.string().min(1).optional(),
    exitNode: z.string().min(1),
    allowLanAccess: z.boolean().optional(),
    acceptRoutes: z.boolean().optional(),
    shieldsUp: z.boolean().optional(),
  }),
  z.object({
    ...networkBase,
    driver: z.literal("warp"),
    executable: z.string().min(1).optional(),
  }),
  z.object({
    ...networkBase,
    driver: z.literal("custom"),
    connect: z.array(z.string()).min(1),
    disconnect: z.array(z.string()).min(1),
    status: z.array(z.string()).min(1),
    env: z.record(valueSourceSchema).optional(),
    verifiedKillSwitch: z.boolean().optional(),
  }),
]);

const vmBase = {
  label: z.string().min(1).optional(),
  cpus: z.number().int().min(1).max(256).optional(),
  memoryMiB: z.number().int().min(256).optional(),
  diskGiB: z.number().int().min(1).optional(),
  image: z.string().min(1).optional(),
  guestHome: z.string().min(1).optional(),
  workspaceTarget: z.string().min(1).optional(),
  mounts: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        writable: z.boolean().optional(),
      }),
    )
    .optional(),
  network: z.string().min(1).optional(),
  video: z.boolean().optional(),
};

const vmSchema = z.discriminatedUnion("driver", [
  z.object({
    ...vmBase,
    driver: z.literal("lima"),
    instance: z.string().min(1).optional(),
    vmType: z.enum(["auto", "vz", "qemu"]).optional(),
    mountType: z
      .enum(["auto", "virtiofs", "9p", "reverse-sshfs"])
      .optional(),
    rosetta: z.boolean().optional(),
    provision: z.array(z.string()).optional(),
  }),
  z.object({
    ...vmBase,
    driver: z.literal("apple-vz"),
    helper: z.string().min(1).optional(),
  }),
  z.object({
    ...vmBase,
    driver: z.literal("cloud-hypervisor"),
    helper: z.string().min(1).optional(),
  }),
  z.object({
    ...vmBase,
    driver: z.literal("firecracker"),
    helper: z.string().min(1).optional(),
  }),
  z.object({
    ...vmBase,
    driver: z.literal("custom"),
    start: z.array(z.string()).min(1),
    stop: z.array(z.string()).min(1),
    status: z.array(z.string()).min(1),
    exec: z.array(z.string()).min(1),
  }),
]);

const configSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    defaultIdentity: z.string().min(1),
    secretBackend: secretBackendSchema.optional(),
    identities: z.record(identitySchema),
    tools: z.record(
      z.object({
        executable: z.string().min(1),
        displayName: z.string().optional(),
        description: z.string().optional(),
        isolation: z.enum(["shell", "process"]).optional(),
        pack: z.string().min(1).optional(),
        stateIsolation: z
          .enum(["full", "partial", "credentials"])
          .optional(),
        shim: z.boolean().optional(),
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
    networks: z.record(networkSchema).optional(),
    vms: z.record(vmSchema).optional(),
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
      validateExecutionReferences(
        identity.execution,
        ["identities", id, "execution"],
        config,
        context,
      );
      for (const [tool, profile] of Object.entries(identity.tools)) {
        if (!config.tools[tool]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identities", id, "tools", tool],
            message: `Tool '${tool}' has no definition`,
          });
        }
        validateExecutionReferences(
          profile.execution,
          ["identities", id, "tools", tool, "execution"],
          config,
          context,
        );
        for (const variable of Object.keys(profile.env ?? {})) {
          if (!safeVariable.test(variable)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["identities", id, "tools", tool, "env", variable],
              message: `Invalid environment variable '${variable}'`,
            });
          }
          const source = profile.env?.[variable];
          const isolation =
            profile.isolation ?? config.tools[tool]?.isolation ?? "shell";
          if (
            source &&
            typeof source !== "string" &&
            source.from === "secret" &&
            isolation !== "process"
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["identities", id, "tools", tool, "env", variable],
              message: "Logical secrets require process isolation",
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
    for (const [network, profile] of Object.entries(config.networks ?? {})) {
      if (!safeName.test(network)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["networks", network],
          message: `Invalid network profile ID '${network}'`,
        });
      }
      if (
        profile.killSwitch === "required" &&
        profile.driver === "custom" &&
        !profile.verifiedKillSwitch
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["networks", network, "verifiedKillSwitch"],
          message:
            "Custom networks with a required kill switch must declare verifiedKillSwitch",
        });
      }
      if (profile.driver === "mullvad" && profile.dns === "system") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["networks", network, "dns"],
          message:
            "Mullvad does not expose system DNS while connected; use provider or custom servers",
        });
      }
    }
    for (const [vm, profile] of Object.entries(config.vms ?? {})) {
      if (!safeName.test(vm)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vms", vm],
          message: `Invalid VM profile ID '${vm}'`,
        });
      }
      if (profile.network && !config.networks?.[profile.network]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vms", vm, "network"],
          message: `Network profile '${profile.network}' does not exist`,
        });
      }
    }
  });

function validateExecutionReferences(
  execution: z.infer<typeof executionSchema> | undefined,
  issuePath: Array<string>,
  config: {
    networks?: Record<string, unknown>;
    vms?: Record<string, unknown>;
  },
  context: z.RefinementCtx,
): void {
  if (!execution) return;
  if (execution.network && !config.networks?.[execution.network]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...issuePath, "network"],
      message: `Network profile '${execution.network}' does not exist`,
    });
  }
  if (execution.target === "vm" && !config.vms?.[execution.vm]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...issuePath, "vm"],
      message: `VM profile '${execution.vm}' does not exist`,
    });
  }
}

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

export function parseJsonc(source: string): unknown {
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
  return value;
}

export function readRegistryVersion(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const version = (value as Record<string, unknown>).version;
  return typeof version === "number" && Number.isInteger(version)
    ? version
    : undefined;
}

export function validateConfig(value: unknown): IdealityConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ideality config: ${detail}`);
  }
  return result.data;
}

export function parseConfig(source: string): IdealityConfig {
  const value = parseJsonc(source);
  const version = readRegistryVersion(value);
  if (version !== undefined && version > CONFIG_VERSION) {
    throw new Error(
      `Registry version ${version} is newer than this ideality build supports (${CONFIG_VERSION}). Upgrade ideality instead of editing the registry.`,
    );
  }
  if (version !== undefined && version < CONFIG_VERSION) {
    throw new Error(
      `Registry version ${version} predates the current schema (${CONFIG_VERSION}). Run 'ideality config migrate'.`,
    );
  }
  return validateConfig(value);
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
  options: { snapshot?: boolean } = {},
): Promise<void> {
  const validated = configSchema.parse(config);
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  await writeConfigContent(content, configPath, options);
}

async function writeConfigContent(
  content: string,
  configPath: string,
  options: { snapshot?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const existing = Bun.file(configPath);
  if (
    options.snapshot !== false &&
    (await existing.exists()) &&
    (await existing.text()) !== content
  ) {
    await createConfigSnapshot(configPath);
  }
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await Bun.write(temporaryPath, content);
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, configPath);
}

export function getHistoryDirectory(
  configPath: string = getConfigPath(),
): string {
  return path.join(path.dirname(configPath), "history");
}

export async function createConfigSnapshot(
  configPath: string = getConfigPath(),
): Promise<string | null> {
  if (!(await Bun.file(configPath).exists())) return null;
  const directory = getHistoryDirectory(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const target = path.join(
    directory,
    `${timestamp}-${randomUUID().slice(0, 8)}.jsonc`,
  );
  await copyFile(configPath, target);
  await chmod(target, 0o600);
  const snapshots = (await readdir(directory))
    .filter((name) => name.endsWith(".jsonc"))
    .sort()
    .reverse();
  await Promise.all(
    snapshots.slice(50).map((name) => rm(path.join(directory, name))),
  );
  return target;
}

export async function listConfigSnapshots(
  configPath: string = getConfigPath(),
): Promise<string[]> {
  try {
    return (await readdir(getHistoryDirectory(configPath)))
      .filter((name) => name.endsWith(".jsonc"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export interface RestoredConfigSnapshot {
  snapshot: string;
  version: number;
  /** Null when the snapshot holds an older schema version than the current build. */
  config: IdealityConfig | null;
}

export async function restoreConfigSnapshot(
  snapshot: string | undefined,
  configPath: string = getConfigPath(),
  options: { dryRun?: boolean } = {},
): Promise<RestoredConfigSnapshot> {
  const snapshots = await listConfigSnapshots(configPath);
  const name = !snapshot || snapshot === "latest" ? snapshots[0] : snapshot;
  if (!name || !snapshots.includes(name)) {
    throw new Error(
      snapshot
        ? `Unknown config snapshot '${snapshot}'`
        : "No config snapshots are available",
    );
  }
  const source = await Bun.file(
    path.join(getHistoryDirectory(configPath), name),
  ).text();
  const version = readRegistryVersion(parseJsonc(source));
  if (version === undefined) {
    throw new Error(`Snapshot '${name}' has no integer 'version' field`);
  }
  if (version > CONFIG_VERSION) {
    throw new Error(
      `Snapshot '${name}' has registry version ${version}, newer than this ideality build supports (${CONFIG_VERSION})`,
    );
  }
  if (version === CONFIG_VERSION) {
    const restored = parseConfig(source);
    if (!options.dryRun) {
      await saveConfig(restored, configPath);
    }
    return { snapshot: name, version, config: restored };
  }
  // Pre-migration snapshot: restore the exact bytes; the current schema cannot
  // validate them, so the caller re-runs 'ideality config migrate' afterwards.
  if (!options.dryRun) {
    await writeConfigContent(source, configPath);
  }
  return { snapshot: name, version, config: null };
}
