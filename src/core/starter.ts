import {
  BUILTIN_TOOL_MANIFESTS,
  BUILTIN_TOOLS,
  DEFAULT_TOOL_PACKS,
  toolsInPacks,
} from "../adapters/builtins.js";
import type {
  GitIdentity,
  IdealityConfig,
  ToolProfile,
  ValueSource,
} from "../domain/config.js";
import {
  compileToolProfile,
  type ToolAdapterIdentity,
  type ToolAdapterManifest,
} from "./tool-adapters.js";

function fillIdentity(text: string, identity: string): string {
  return text.replaceAll("{{identity}}", identity);
}

function fillValueSource(
  value: ValueSource | null,
  identity: string,
): ValueSource | null {
  if (typeof value === "string") {
    return fillIdentity(value, identity);
  }
  if (value !== null && value.from === "file") {
    return { ...value, path: fillIdentity(value.path, identity) };
  }
  // Secret keys keep their {{identity}} template; it is resolved against the
  // active identity when the environment is materialized.
  return value;
}

function instantiateManifest(
  manifest: ToolAdapterManifest,
  identity: string,
): ToolAdapterManifest {
  const profile = manifest.profile;
  if (!profile) {
    return manifest;
  }
  return {
    ...manifest,
    profile: {
      ...(profile.env
        ? {
            env: Object.fromEntries(
              Object.entries(profile.env).map(([name, value]) => [
                name,
                fillValueSource(value, identity),
              ]),
            ),
          }
        : {}),
      ...(profile.args
        ? {
            args: profile.args.map((argument) =>
              typeof argument === "string"
                ? fillIdentity(argument, identity)
                : argument,
            ),
          }
        : {}),
    },
  };
}

export function createToolProfiles(
  identity: string,
  selectedTools: string[] = Object.keys(BUILTIN_TOOLS),
  sshKey?: string,
): Record<string, ToolProfile> {
  // Only the SSH key is consulted for identity-derived manifest arguments.
  const adapterIdentity: ToolAdapterIdentity = sshKey
    ? { git: { name: identity, email: "", sshKey } }
    : {};
  return Object.fromEntries(
    selectedTools
      .filter((name) => BUILTIN_TOOL_MANIFESTS[name] !== undefined)
      .map((name): [string, ToolProfile] => [
        name,
        {
          isolation: "process",
          ...compileToolProfile(
            instantiateManifest(BUILTIN_TOOL_MANIFESTS[name]!, identity),
            adapterIdentity,
          ),
        },
      ]),
  );
}

export function createStarterConfig(options: {
  id: string;
  label: string;
  root: string;
  git: GitIdentity;
  tools?: string[];
}): IdealityConfig {
  const selectedTools = options.tools ?? toolsInPacks(DEFAULT_TOOL_PACKS);
  return {
    version: 1,
    defaultIdentity: options.id,
    secretBackend: { type: "file" },
    identities: {
      [options.id]: {
        label: options.label,
        roots: [options.root],
        color: "#22d3ee",
        git: options.git,
        tools: createToolProfiles(
          options.id,
          selectedTools,
          options.git.sshKey,
        ),
      },
    },
    tools: structuredClone(BUILTIN_TOOLS),
  };
}
