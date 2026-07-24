import { DEFAULT_TOOL_PACKS, toolsInPacks } from "../adapters/builtins.js";
import type {
  GitIdentity,
  IdealityConfig,
  ToolProfile,
  ValueSource,
} from "../domain/config.js";
import { ADAPTER_REGISTRY, toolAdapterForId } from "./adapters.js";
import type {
  ToolAdapterIdentity,
  ToolAdapterManifest,
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
  selectedTools: string[] = Object.keys(ADAPTER_REGISTRY.tools),
  sshKey?: string,
): Record<string, ToolProfile> {
  // Only the SSH key is consulted for identity-derived manifest arguments.
  const adapterIdentity: ToolAdapterIdentity = sshKey
    ? { git: { name: identity, email: "", sshKey } }
    : {};
  return Object.fromEntries(
    selectedTools
      .filter((name) => ADAPTER_REGISTRY.tools[name] !== undefined)
      .map((name): [string, ToolProfile] => {
        const adapter = toolAdapterForId(name);
        return [
          name,
          {
            isolation: "process",
            ...adapter.contract.compileProfile(
              adapterIdentity,
              instantiateManifest(adapter.contract.manifest, identity),
            ),
          },
        ];
      }),
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
    tools: Object.fromEntries(
      Object.entries(ADAPTER_REGISTRY.tools).map(([id, adapter]) => [
        id,
        structuredClone(adapter.contract.definition),
      ]),
    ),
  };
}
