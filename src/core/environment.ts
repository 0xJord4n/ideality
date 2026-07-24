import { readFile as nodeReadFile } from "node:fs/promises";
import path from "node:path";

import type {
  IdealityConfig,
  ResolvedIdentity,
  ToolProfile,
  ValueSource,
} from "../domain/config.js";
import { expandHome } from "./resolution.js";
import { readSecretValue } from "./secret-backends.js";

export interface EnvironmentOptions {
  home: string;
  idealityHome?: string;
  tool?: string;
  baseEnv?: Record<string, string | undefined>;
  readFile?: (path: string) => Promise<string>;
  readSecret?: typeof readSecretValue;
}

export interface ResolvedEnvironment {
  values: Record<string, string>;
  redacted: Record<string, string>;
  unset: string[];
  tool: string | null;
  executable: string | null;
  args: string[];
}

export function renderTemplate(
  value: string,
  resolved: ResolvedIdentity,
  home: string,
  idealityHome: string = path.join(home, ".ideality"),
): string {
  const rendered = value
    .replaceAll("{{identity}}", resolved.id)
    .replaceAll("{{home}}", home)
    .replaceAll("{{root}}", resolved.matchedRoot ?? resolved.path)
    .replaceAll("{{idealityHome}}", idealityHome);
  return rendered === "~" || rendered.startsWith("~/")
    ? expandHome(rendered, home)
    : rendered;
}

async function resolveSource(
  config: IdealityConfig,
  source: ValueSource,
  resolved: ResolvedIdentity,
  options: Required<Pick<EnvironmentOptions, "home" | "idealityHome" | "readFile">> &
    Pick<EnvironmentOptions, "baseEnv" | "readSecret">,
): Promise<{ value: string | null; display: string }> {
  if (typeof source === "string") {
    const value = renderTemplate(
      source,
      resolved,
      options.home,
      options.idealityHome,
    );
    return { value, display: value };
  }

  if (source.from === "env") {
    const value = options.baseEnv?.[source.name] ?? process.env[source.name];
    if (value === undefined) {
      if (source.optional) {
        return { value: null, display: "<unset:env>" };
      }
      throw new Error(`Required environment variable '${source.name}' is not set`);
    }
    return { value, display: "<secret:env>" };
  }

  if (source.from === "secret") {
    try {
      const key = renderTemplate(
        source.key,
        resolved,
        options.home,
        options.idealityHome,
      );
      const value = await (options.readSecret ?? readSecretValue)(
        config,
        key,
        options.home,
        options.idealityHome,
      );
      if (!value && !source.optional) {
        throw new Error(`Secret '${key}' is empty`);
      }
      return {
        value: value || null,
        display: value
          ? `<secret:${config.secretBackend?.type ?? "file"}>`
          : "<unset:secret>",
      };
    } catch (error) {
      if (source.optional) {
        return { value: null, display: "<unset:secret>" };
      }
      throw error;
    }
  }

  const file = renderTemplate(
    source.path,
    resolved,
    options.home,
    options.idealityHome,
  );
  try {
    const value = (await options.readFile(file)).trim();
    if (!value && !source.optional) {
      throw new Error(`Secret file '${file}' is empty`);
    }
    return {
      value: value || null,
      display: value ? "<secret:file>" : "<unset:file>",
    };
  } catch (error) {
    if (source.optional) {
      return { value: null, display: "<unset:file>" };
    }
    throw error;
  }
}

function toolProfiles(
  config: IdealityConfig,
  resolved: ResolvedIdentity,
  selectedTool?: string,
): Array<[string, ToolProfile]> {
  if (selectedTool) {
    const profile = resolved.identity.tools[selectedTool];
    if (!profile || profile.enabled === false) {
      throw new Error(`Tool '${selectedTool}' is not configured for '${resolved.id}'`);
    }
    return [[selectedTool, profile]];
  }

  return Object.entries(resolved.identity.tools).filter(([name, profile]) => {
    const definition = config.tools[name];
    const isolation = profile.isolation ?? definition?.isolation ?? "shell";
    return profile.enabled !== false && isolation === "shell";
  });
}

export async function buildEnvironment(
  config: IdealityConfig,
  resolved: ResolvedIdentity,
  options: EnvironmentOptions,
): Promise<ResolvedEnvironment> {
  const values: Record<string, string> = { IDEALITY_IDENTITY: resolved.id };
  const redacted: Record<string, string> = { IDEALITY_IDENTITY: resolved.id };
  const unset = new Set<string>();
  const readFile = options.readFile ?? ((file: string) => nodeReadFile(file, "utf8"));
  const idealityHome =
    options.idealityHome ?? path.join(options.home, ".ideality");
  const profiles = toolProfiles(config, resolved, options.tool);

  for (const [, profile] of profiles) {
    for (const [name, source] of Object.entries(profile.env ?? {})) {
      if (source === null) {
        unset.add(name);
        delete values[name];
        delete redacted[name];
        continue;
      }

      const result = await resolveSource(config, source, resolved, {
        home: options.home,
        idealityHome,
        baseEnv: options.baseEnv,
        readFile,
        readSecret: options.readSecret,
      });
      if (result.value === null) {
        unset.add(name);
        delete values[name];
      } else {
        unset.delete(name);
        values[name] = result.value;
      }
      redacted[name] =
        typeof source === "string" && isSensitiveVariable(name)
          ? "<secret:literal>"
          : result.display;
    }
  }

  const selectedProfile = options.tool
    ? resolved.identity.tools[options.tool]
    : undefined;
  const definition = options.tool ? config.tools[options.tool] : undefined;

  return {
    values,
    redacted,
    unset: [...unset].sort(),
    tool: options.tool ?? null,
    executable: selectedProfile?.executable ?? definition?.executable ?? null,
    args: (selectedProfile?.args ?? []).map((arg) =>
      renderTemplate(arg, resolved, options.home, idealityHome),
    ),
  };
}

export function isSensitiveVariable(name: string): boolean {
  return /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(name);
}

export function redactConfig(config: IdealityConfig): IdealityConfig {
  const redacted = structuredClone(config);
  for (const identity of Object.values(redacted.identities)) {
    for (const profile of Object.values(identity.tools)) {
      for (const [name, source] of Object.entries(profile.env ?? {})) {
        if (typeof source === "string" && isSensitiveVariable(name)) {
          profile.env![name] = "<secret:literal>";
        }
      }
    }
  }
  return redacted;
}

export function buildChildEnvironment(
  config: IdealityConfig,
  selected: ResolvedEnvironment,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      child[name] = value;
    }
  }

  const managedVariables = new Set<string>(["IDEALITY_IDENTITY"]);
  for (const identity of Object.values(config.identities)) {
    for (const profile of Object.values(identity.tools)) {
      for (const name of Object.keys(profile.env ?? {})) {
        managedVariables.add(name);
      }
    }
  }
  for (const name of managedVariables) {
    delete child[name];
  }
  Object.assign(child, selected.values);
  for (const name of selected.unset) {
    delete child[name];
  }
  return child;
}
