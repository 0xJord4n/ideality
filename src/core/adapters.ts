import { BUILTIN_TOOL_MANIFESTS, BUILTIN_TOOLS } from "../adapters/builtins.js";
import { BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS } from "../adapters/privileged-builtins.js";
import type {
  IdealityConfig,
  NetworkProfile,
  ToolDefinition,
  ToolProfile,
  VmProfile,
} from "../domain/config.js";
import {
  type NetworkAction,
  type NetworkCapability,
  type NetworkCommandStep,
  type NetworkPlanOptions,
  buildNetworkPlan,
  networkCapability,
  networkEnforcement,
} from "./network.js";
import {
  deleteSecretValue,
  listSecretReferences,
  readSecretValue,
  type SecretBackendType,
  type SecretCommandRunner,
  type SecretReferenceList,
  secretBackendExecutable,
  secretBackendWritable,
  writeSecretValue,
} from "./secret-backends.js";
import type {
  AdapterPlatform,
  AdapterPrivilege as PrivilegedAdapterPrivilege,
  NetworkAdapterManifest,
  PrivilegedAdapterManifest,
  SecretAdapterManifest,
  VmAdapterManifest,
} from "./privileged-adapters.js";
import {
  compileToolDefinition,
  compileToolProfile,
  SAFE_ID,
  type ToolAdapterIdentity,
  type ToolAdapterManifest,
} from "./tool-adapters.js";
import {
  type VmAction,
  type VmCapability,
  type VmCapabilityOptions,
  type VmCommandOptions,
  vmCapability,
  vmCommand,
} from "./vm.js";

export const ADAPTER_ENVELOPE_VERSION = 1;

export type AdapterKind = "tool" | "network" | "vm" | "secret";
export type AdapterLifecycle =
  | "declarative"
  | "trusted-core"
  | "user-configured";
export type { AdapterPlatform };
export type AdapterPrivilege = "none" | PrivilegedAdapterPrivilege;

export interface AdapterMetadata {
  displayName: string;
  description: string;
  platforms: readonly AdapterPlatform[];
  privileges: readonly AdapterPrivilege[];
  builtIn: boolean;
  trusted: boolean;
  lifecycle: AdapterLifecycle;
  contributorExecutable: false;
}

export interface AdapterEnvelope<
  TKind extends AdapterKind,
  TCapability extends string,
  TContract,
> {
  envelopeVersion: typeof ADAPTER_ENVELOPE_VERSION;
  kind: TKind;
  id: string;
  capability: TCapability;
  metadata: AdapterMetadata;
  contract: TContract;
}

export interface ToolAdapterContract {
  schemaVersion: 1;
  manifest: ToolAdapterManifest;
  definition: ToolDefinition;
  compileProfile(
    identity?: ToolAdapterIdentity,
    manifestOverride?: ToolAdapterManifest,
  ): ToolProfile;
}

export type ToolAdapterEnvelope = AdapterEnvelope<
  "tool",
  "tool-execution",
  ToolAdapterContract
>;

export interface NetworkAdapterContract {
  schemaVersion: 1;
  driver: NetworkProfile["driver"];
  manifest: NetworkAdapterManifest;
  capability(profile: NetworkProfile): NetworkCapability;
  enforcement(
    profile: NetworkProfile,
    allowUnverified?: boolean,
  ): "strict" | "provider" | "off" | "unverified";
  plan(
    profileId: string,
    profile: NetworkProfile,
    action: NetworkAction,
    options?: NetworkPlanOptions,
  ): NetworkCommandStep[];
}

export type NetworkAdapterEnvelope = AdapterEnvelope<
  "network",
  "network-lifecycle",
  NetworkAdapterContract
>;

export interface VmAdapterContract {
  schemaVersion: 1;
  driver: VmProfile["driver"];
  manifest: VmAdapterManifest;
  capability(profile: VmProfile, options?: VmCapabilityOptions): VmCapability;
  command(
    vmId: string,
    profile: VmProfile,
    action: VmAction,
    options?: VmCommandOptions,
  ): string[];
}

export type VmAdapterEnvelope = AdapterEnvelope<
  "vm",
  "vm-lifecycle",
  VmAdapterContract
>;

export interface SecretAdapterContract {
  schemaVersion: 1;
  type: SecretBackendType;
  manifest: SecretAdapterManifest;
  executable(config: IdealityConfig, platform?: NodeJS.Platform): string | null;
  writable(config: IdealityConfig, platform?: NodeJS.Platform): boolean;
  read(
    config: IdealityConfig,
    key: string,
    home: string,
    idealityHome: string,
    runner?: SecretCommandRunner,
    platform?: NodeJS.Platform,
  ): Promise<string>;
  write(
    config: IdealityConfig,
    key: string,
    value: string,
    home: string,
    idealityHome: string,
    runner?: SecretCommandRunner,
    platform?: NodeJS.Platform,
  ): Promise<void>;
  list(
    config: IdealityConfig,
    home: string,
    idealityHome: string,
    platform?: NodeJS.Platform,
  ): Promise<SecretReferenceList>;
  delete(
    config: IdealityConfig,
    key: string,
    home: string,
    idealityHome: string,
    runner?: SecretCommandRunner,
    platform?: NodeJS.Platform,
  ): Promise<void>;
}

export type SecretAdapterEnvelope = AdapterEnvelope<
  "secret",
  "secret-backend",
  SecretAdapterContract
>;

export type AnyAdapterEnvelope =
  | ToolAdapterEnvelope
  | NetworkAdapterEnvelope
  | VmAdapterEnvelope
  | SecretAdapterEnvelope;

export interface AdapterRegistry {
  version: typeof ADAPTER_ENVELOPE_VERSION;
  tools: Record<string, ToolAdapterEnvelope>;
  networks: Record<string, NetworkAdapterEnvelope>;
  vms: Record<string, VmAdapterEnvelope>;
  secrets: Record<string, SecretAdapterEnvelope>;
}

export function createToolAdapterEnvelope(
  manifest: ToolAdapterManifest,
  options: {
    builtIn?: boolean;
    definition?: ToolDefinition;
  } = {},
): ToolAdapterEnvelope {
  const definition = options.definition ?? compileToolDefinition(manifest);
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "tool",
    id: manifest.id,
    capability: "tool-execution",
    metadata: {
      displayName: manifest.displayName,
      description: manifest.description ?? manifest.displayName,
      platforms: ["any"],
      privileges: ["none"],
      builtIn: options.builtIn ?? true,
      trusted: true,
      lifecycle: "declarative",
      contributorExecutable: false,
    },
    contract: {
      schemaVersion: 1,
      manifest,
      definition,
      compileProfile(
        identity: ToolAdapterIdentity = {},
        manifestOverride: ToolAdapterManifest = manifest,
      ) {
        return compileToolProfile(manifestOverride, identity);
      },
    },
  };
}

function metadataFromPrivilegedManifest(
  manifest: PrivilegedAdapterManifest,
): AdapterMetadata {
  const trusted = manifest.implementation.type === "trusted-core";
  return {
    displayName: manifest.displayName,
    description: manifest.description,
    platforms: manifest.platforms.os,
    privileges: manifest.permissions.privileges,
    builtIn: true,
    trusted,
    lifecycle: trusted ? "trusted-core" : "user-configured",
    contributorExecutable: false,
  };
}

/** Bind a reviewed network manifest to Ideality's trusted core implementation. */
export function defineNetworkAdapter(
  manifest: NetworkAdapterManifest,
): NetworkAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "network",
    id: manifest.id,
    capability: "network-lifecycle",
    metadata: metadataFromPrivilegedManifest(manifest),
    contract: {
      schemaVersion: 1,
      driver: manifest.id as NetworkProfile["driver"],
      manifest,
      capability(profile: NetworkProfile): NetworkCapability {
        assertNetworkDriver(manifest.id as NetworkProfile["driver"], profile);
        return networkCapability(profile);
      },
      enforcement(
        profile: NetworkProfile,
        allowUnverified?: boolean,
      ): "strict" | "provider" | "off" | "unverified" {
        assertNetworkDriver(manifest.id as NetworkProfile["driver"], profile);
        return networkEnforcement(profile, allowUnverified);
      },
      plan(
        profileId: string,
        profile: NetworkProfile,
        action: NetworkAction,
        planOptions: NetworkPlanOptions = {},
      ): NetworkCommandStep[] {
        assertNetworkDriver(manifest.id as NetworkProfile["driver"], profile);
        return buildNetworkPlan(profileId, profile, action, planOptions);
      },
    },
  };
}

/** Bind a reviewed VM manifest to Ideality's trusted core implementation. */
export function defineVmAdapter(
  manifest: VmAdapterManifest,
): VmAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "vm",
    id: manifest.id,
    capability: "vm-lifecycle",
    metadata: metadataFromPrivilegedManifest(manifest),
    contract: {
      schemaVersion: 1,
      driver: manifest.id as VmProfile["driver"],
      manifest,
      capability(profile: VmProfile, capabilityOptions?: VmCapabilityOptions) {
        assertVmDriver(manifest.id as VmProfile["driver"], profile);
        return vmCapability(profile, capabilityOptions);
      },
      command(
        vmId: string,
        profile: VmProfile,
        action: VmAction,
        commandOptions: VmCommandOptions = {},
      ) {
        assertVmDriver(manifest.id as VmProfile["driver"], profile);
        return vmCommand(vmId, profile, action, commandOptions);
      },
    },
  };
}

/** Bind a reviewed secret manifest to Ideality's trusted core implementation. */
export function defineSecretAdapter(
  manifest: SecretAdapterManifest,
): SecretAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "secret",
    id: manifest.id,
    capability: "secret-backend",
    metadata: metadataFromPrivilegedManifest(manifest),
    contract: {
      schemaVersion: 1,
      type: manifest.id as SecretBackendType,
      manifest,
      executable(
        config: IdealityConfig,
        platform?: NodeJS.Platform,
      ): string | null {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return secretBackendExecutable(config, platform);
      },
      writable(config: IdealityConfig, platform?: NodeJS.Platform): boolean {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return secretBackendWritable(config, platform);
      },
      read(
        config: IdealityConfig,
        key: string,
        home: string,
        idealityHome: string,
        runner?: SecretCommandRunner,
        platform?: NodeJS.Platform,
      ): Promise<string> {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return readSecretValue(
          config,
          key,
          home,
          idealityHome,
          runner,
          platform,
        );
      },
      write(
        config: IdealityConfig,
        key: string,
        value: string,
        home: string,
        idealityHome: string,
        runner?: SecretCommandRunner,
        platform?: NodeJS.Platform,
      ): Promise<void> {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return writeSecretValue(
          config,
          key,
          value,
          home,
          idealityHome,
          runner,
          platform,
        );
      },
      list(
        config: IdealityConfig,
        home: string,
        idealityHome: string,
        platform?: NodeJS.Platform,
      ): Promise<SecretReferenceList> {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return listSecretReferences(config, home, idealityHome, platform);
      },
      delete(
        config: IdealityConfig,
        key: string,
        home: string,
        idealityHome: string,
        runner?: SecretCommandRunner,
        platform?: NodeJS.Platform,
      ): Promise<void> {
        assertSecretBackend(manifest.id as SecretBackendType, config);
        return deleteSecretValue(
          config,
          key,
          home,
          idealityHome,
          runner,
          platform,
        );
      },
    },
  };
}

export function createAdapterRegistry(
  envelopes: readonly AnyAdapterEnvelope[],
): AdapterRegistry {
  const registry: AdapterRegistry = {
    version: ADAPTER_ENVELOPE_VERSION,
    tools: {},
    networks: {},
    vms: {},
    secrets: {},
  };
  for (const envelope of envelopes) {
    validateAdapterEnvelope(envelope);
    const bucket = bucketFor(registry, envelope);
    if (bucket[envelope.id]) {
      throw new Error(`Duplicate ${envelope.kind} adapter '${envelope.id}'`);
    }
    bucket[envelope.id] = envelope as never;
  }
  return registry;
}

export function validateAdapterRegistryCompleteness(
  registry: AdapterRegistry,
  expected: { toolIds: readonly string[] },
): void {
  if (registry.version !== ADAPTER_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported adapter registry version '${registry.version}'`,
    );
  }
  assertSameSet("tool", Object.keys(registry.tools), expected.toolIds);
  assertSameSet(
    "network",
    Object.keys(registry.networks),
    Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.network),
  );
  assertSameSet(
    "VM",
    Object.keys(registry.vms),
    Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.vm),
  );
  assertSameSet(
    "secret",
    Object.keys(registry.secrets),
    Object.keys(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.secret),
  );
}

export function toolAdapterForId(
  id: string,
  registry: AdapterRegistry = ADAPTER_REGISTRY,
): ToolAdapterEnvelope {
  const adapter = registry.tools[id];
  if (!adapter) throw new Error(`Tool adapter '${id}' is not registered`);
  return adapter;
}

export function networkAdapterForProfile(
  profile: NetworkProfile,
  registry: AdapterRegistry = ADAPTER_REGISTRY,
): NetworkAdapterEnvelope {
  const adapter = registry.networks[profile.driver];
  if (!adapter) {
    throw new Error(`Network adapter '${profile.driver}' is not registered`);
  }
  return adapter;
}

export function networkAdapterCapability(
  profile: NetworkProfile,
): NetworkCapability {
  return networkAdapterForProfile(profile).contract.capability(profile);
}

export function networkAdapterEnforcement(
  profile: NetworkProfile,
  allowUnverified?: boolean,
): "strict" | "provider" | "off" | "unverified" {
  return networkAdapterForProfile(profile).contract.enforcement(
    profile,
    allowUnverified,
  );
}

export function networkAdapterPlan(
  profileId: string,
  profile: NetworkProfile,
  action: NetworkAction,
  options: NetworkPlanOptions = {},
): NetworkCommandStep[] {
  return networkAdapterForProfile(profile).contract.plan(
    profileId,
    profile,
    action,
    options,
  );
}

export function vmAdapterForProfile(
  profile: VmProfile,
  registry: AdapterRegistry = ADAPTER_REGISTRY,
): VmAdapterEnvelope {
  const adapter = registry.vms[profile.driver];
  if (!adapter) {
    throw new Error(`VM adapter '${profile.driver}' is not registered`);
  }
  return adapter;
}

export function vmAdapterCapability(
  profile: VmProfile,
  options?: VmCapabilityOptions,
): VmCapability {
  return vmAdapterForProfile(profile).contract.capability(profile, options);
}

export function vmAdapterCommand(
  vmId: string,
  profile: VmProfile,
  action: VmAction,
  options: VmCommandOptions = {},
): string[] {
  return vmAdapterForProfile(profile).contract.command(
    vmId,
    profile,
    action,
    options,
  );
}

export function secretAdapterForConfig(
  config: IdealityConfig,
  registry: AdapterRegistry = ADAPTER_REGISTRY,
): SecretAdapterEnvelope {
  const type = config.secretBackend?.type ?? "file";
  const adapter = registry.secrets[type];
  if (!adapter) throw new Error(`Secret adapter '${type}' is not registered`);
  return adapter;
}

export function secretAdapterExecutable(config: IdealityConfig): string | null {
  return secretAdapterForConfig(config).contract.executable(config);
}

export function secretAdapterWritable(config: IdealityConfig): boolean {
  return secretAdapterForConfig(config).contract.writable(config);
}

export const ADAPTER_REGISTRY = createAdapterRegistry([
  ...Object.values(BUILTIN_TOOL_MANIFESTS).map((manifest) =>
    createToolAdapterEnvelope(manifest, {
      builtIn: true,
      definition: BUILTIN_TOOLS[manifest.id],
    }),
  ),
  ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.network).map(
    defineNetworkAdapter,
  ),
  ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.vm).map(
    defineVmAdapter,
  ),
  ...Object.values(BUILTIN_PRIVILEGED_ADAPTER_MANIFESTS.secret).map(
    defineSecretAdapter,
  ),
]);

validateAdapterRegistryCompleteness(ADAPTER_REGISTRY, {
  toolIds: Object.keys(BUILTIN_TOOL_MANIFESTS),
});

function validateAdapterEnvelope(envelope: AnyAdapterEnvelope): void {
  if (envelope.envelopeVersion !== ADAPTER_ENVELOPE_VERSION) {
    throw new Error(
      `Unsupported adapter envelopeVersion '${envelope.envelopeVersion}'`,
    );
  }
  if (!SAFE_ID.test(envelope.id)) {
    throw new Error(`Invalid ${envelope.kind} adapter ID '${envelope.id}'`);
  }
  if (envelope.metadata.contributorExecutable !== false) {
    throw new Error(
      `${envelope.kind} adapter '${envelope.id}' must not register contributor executable code`,
    );
  }
  if (envelope.metadata.platforms.length === 0) {
    throw new Error(
      `${envelope.kind} adapter '${envelope.id}' must declare platform metadata`,
    );
  }
  if (envelope.metadata.privileges.length === 0) {
    throw new Error(
      `${envelope.kind} adapter '${envelope.id}' must declare privilege metadata`,
    );
  }
  if (
    envelope.metadata.lifecycle === "user-configured" &&
    envelope.metadata.trusted
  ) {
    throw new Error(
      `${envelope.kind} adapter '${envelope.id}' cannot be trusted when it runs user-configured commands`,
    );
  }
  if (
    envelope.kind === "tool" &&
    (envelope.metadata.lifecycle !== "declarative" ||
      envelope.contract.manifest.id !== envelope.id)
  ) {
    throw new Error(`Tool adapter '${envelope.id}' has an invalid contract`);
  }
  if (
    envelope.kind === "network" &&
    (!["trusted-core", "user-configured"].includes(
      envelope.metadata.lifecycle,
    ) ||
      envelope.contract.driver !== envelope.id ||
      envelope.contract.manifest.adapterKind !== "network" ||
      envelope.contract.manifest.id !== envelope.id)
  ) {
    throw new Error(`Network adapter '${envelope.id}' has an invalid contract`);
  }
  if (
    envelope.kind === "vm" &&
    (!["trusted-core", "user-configured"].includes(
      envelope.metadata.lifecycle,
    ) ||
      envelope.contract.driver !== envelope.id ||
      envelope.contract.manifest.adapterKind !== "vm" ||
      envelope.contract.manifest.id !== envelope.id)
  ) {
    throw new Error(`VM adapter '${envelope.id}' has an invalid contract`);
  }
  if (
    envelope.kind === "secret" &&
    (envelope.metadata.lifecycle !== "trusted-core" ||
      envelope.contract.type !== envelope.id ||
      envelope.contract.manifest.adapterKind !== "secret" ||
      envelope.contract.manifest.id !== envelope.id)
  ) {
    throw new Error(`Secret adapter '${envelope.id}' has an invalid contract`);
  }
}

function bucketFor(
  registry: AdapterRegistry,
  envelope: AnyAdapterEnvelope,
):
  | Record<string, ToolAdapterEnvelope>
  | Record<string, NetworkAdapterEnvelope>
  | Record<string, VmAdapterEnvelope>
  | Record<string, SecretAdapterEnvelope> {
  switch (envelope.kind) {
    case "tool":
      return registry.tools;
    case "network":
      return registry.networks;
    case "vm":
      return registry.vms;
    case "secret":
      return registry.secrets;
  }
}

function assertNetworkDriver(
  driver: NetworkProfile["driver"],
  profile: NetworkProfile,
): void {
  if (profile.driver !== driver) {
    throw new Error(
      `Network adapter '${driver}' cannot handle '${profile.driver}' profiles`,
    );
  }
}

function assertVmDriver(driver: VmProfile["driver"], profile: VmProfile): void {
  if (profile.driver !== driver) {
    throw new Error(
      `VM adapter '${driver}' cannot handle '${profile.driver}' profiles`,
    );
  }
}

function assertSecretBackend(
  type: SecretBackendType,
  config: IdealityConfig,
): void {
  const selected = config.secretBackend?.type ?? "file";
  if (selected !== type) {
    throw new Error(
      `Secret adapter '${type}' cannot handle '${selected}' backends`,
    );
  }
}

function assertSameSet(
  label: string,
  actualValues: readonly string[],
  expectedValues: readonly string[],
): void {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `Incomplete ${label} adapter registry: expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
    );
  }
}
