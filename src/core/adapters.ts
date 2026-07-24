import { BUILTIN_TOOL_MANIFESTS, BUILTIN_TOOLS } from "../adapters/builtins.js";
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
  type SecretBackendType,
  secretBackendExecutable,
  secretBackendWritable,
} from "./secret-backends.js";
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
export type AdapterPlatform = "any" | "darwin" | "linux" | "win32";
export type AdapterLifecycle =
  | "declarative"
  | "trusted-core"
  | "user-configured";
export type AdapterPrivilege =
  | "none"
  | "external-cli"
  | "host-network"
  | "provider-killswitch"
  | "sudo"
  | "vm-helper"
  | "hardware-virtualization"
  | "secret-store"
  | "read-only-secret-store"
  | "custom-command";

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
  executable(config: IdealityConfig): string | null;
  writable(config: IdealityConfig): boolean;
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

function createNetworkAdapterEnvelope(options: {
  id: NetworkProfile["driver"];
  displayName: string;
  description: string;
  platforms: readonly AdapterPlatform[];
  privileges: readonly AdapterPrivilege[];
  trusted?: boolean;
  lifecycle?: AdapterLifecycle;
}): NetworkAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "network",
    id: options.id,
    capability: "network-lifecycle",
    metadata: {
      displayName: options.displayName,
      description: options.description,
      platforms: options.platforms,
      privileges: options.privileges,
      builtIn: true,
      trusted: options.trusted ?? true,
      lifecycle: options.lifecycle ?? "trusted-core",
      contributorExecutable: false,
    },
    contract: {
      schemaVersion: 1,
      driver: options.id,
      capability(profile: NetworkProfile): NetworkCapability {
        assertNetworkDriver(options.id, profile);
        return networkCapability(profile);
      },
      enforcement(
        profile: NetworkProfile,
        allowUnverified?: boolean,
      ): "strict" | "provider" | "off" | "unverified" {
        assertNetworkDriver(options.id, profile);
        return networkEnforcement(profile, allowUnverified);
      },
      plan(
        profileId: string,
        profile: NetworkProfile,
        action: NetworkAction,
        planOptions: NetworkPlanOptions = {},
      ): NetworkCommandStep[] {
        assertNetworkDriver(options.id, profile);
        return buildNetworkPlan(profileId, profile, action, planOptions);
      },
    },
  };
}

function createVmAdapterEnvelope(options: {
  id: VmProfile["driver"];
  displayName: string;
  description: string;
  platforms: readonly AdapterPlatform[];
  privileges: readonly AdapterPrivilege[];
  trusted?: boolean;
  lifecycle?: AdapterLifecycle;
}): VmAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "vm",
    id: options.id,
    capability: "vm-lifecycle",
    metadata: {
      displayName: options.displayName,
      description: options.description,
      platforms: options.platforms,
      privileges: options.privileges,
      builtIn: true,
      trusted: options.trusted ?? true,
      lifecycle: options.lifecycle ?? "trusted-core",
      contributorExecutable: false,
    },
    contract: {
      schemaVersion: 1,
      driver: options.id,
      capability(profile: VmProfile, capabilityOptions?: VmCapabilityOptions) {
        assertVmDriver(options.id, profile);
        return vmCapability(profile, capabilityOptions);
      },
      command(
        vmId: string,
        profile: VmProfile,
        action: VmAction,
        commandOptions: VmCommandOptions = {},
      ) {
        assertVmDriver(options.id, profile);
        return vmCommand(vmId, profile, action, commandOptions);
      },
    },
  };
}

function createSecretAdapterEnvelope(options: {
  id: SecretBackendType;
  displayName: string;
  description: string;
  platforms: readonly AdapterPlatform[];
  privileges: readonly AdapterPrivilege[];
}): SecretAdapterEnvelope {
  return {
    envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    kind: "secret",
    id: options.id,
    capability: "secret-backend",
    metadata: {
      displayName: options.displayName,
      description: options.description,
      platforms: options.platforms,
      privileges: options.privileges,
      builtIn: true,
      trusted: true,
      lifecycle: "trusted-core",
      contributorExecutable: false,
    },
    contract: {
      schemaVersion: 1,
      type: options.id,
      executable(config: IdealityConfig): string | null {
        assertSecretBackend(options.id, config);
        return secretBackendExecutable(config);
      },
      writable(config: IdealityConfig): boolean {
        assertSecretBackend(options.id, config);
        return secretBackendWritable(config);
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
  assertSameSet("network", Object.keys(registry.networks), [
    "wireguard",
    "openvpn",
    "mullvad",
    "tailscale",
    "warp",
    "custom",
  ]);
  assertSameSet("VM", Object.keys(registry.vms), [
    "lima",
    "apple-vz",
    "cloud-hypervisor",
    "firecracker",
    "custom",
  ]);
  assertSameSet("secret", Object.keys(registry.secrets), [
    "file",
    "age",
    "keychain",
    "pass",
    "onepassword",
    "bitwarden",
    "dashlane",
  ]);
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
  createNetworkAdapterEnvelope({
    id: "wireguard",
    displayName: "WireGuard",
    description: "wg-quick network profile lifecycle",
    platforms: ["linux", "darwin"],
    privileges: ["host-network", "sudo"],
  }),
  createNetworkAdapterEnvelope({
    id: "openvpn",
    displayName: "OpenVPN",
    description: "OpenVPN daemon network profile lifecycle",
    platforms: ["linux", "darwin"],
    privileges: ["host-network", "sudo"],
  }),
  createNetworkAdapterEnvelope({
    id: "mullvad",
    displayName: "Mullvad",
    description: "Mullvad CLI lifecycle with lockdown-mode support",
    platforms: ["linux", "darwin", "win32"],
    privileges: ["host-network", "provider-killswitch"],
  }),
  createNetworkAdapterEnvelope({
    id: "tailscale",
    displayName: "Tailscale",
    description: "Tailscale exit-node lifecycle",
    platforms: ["linux", "darwin", "win32"],
    privileges: ["host-network"],
  }),
  createNetworkAdapterEnvelope({
    id: "warp",
    displayName: "Cloudflare WARP",
    description: "Cloudflare WARP CLI lifecycle",
    platforms: ["linux", "darwin", "win32"],
    privileges: ["host-network"],
  }),
  createNetworkAdapterEnvelope({
    id: "custom",
    displayName: "Custom network",
    description: "User-configured argv-only network lifecycle",
    platforms: ["any"],
    privileges: ["host-network", "custom-command"],
    trusted: false,
    lifecycle: "user-configured",
  }),
  createVmAdapterEnvelope({
    id: "lima",
    displayName: "Lima",
    description: "Lima VM lifecycle with strict guest environment filtering",
    platforms: ["linux", "darwin"],
    privileges: ["external-cli"],
  }),
  createVmAdapterEnvelope({
    id: "apple-vz",
    displayName: "Apple Virtualization",
    description: "Trusted Apple Virtualization helper lifecycle",
    platforms: ["darwin"],
    privileges: ["vm-helper"],
  }),
  createVmAdapterEnvelope({
    id: "cloud-hypervisor",
    displayName: "Cloud Hypervisor",
    description: "Trusted Cloud Hypervisor helper lifecycle",
    platforms: ["linux"],
    privileges: ["vm-helper", "hardware-virtualization"],
  }),
  createVmAdapterEnvelope({
    id: "firecracker",
    displayName: "Firecracker",
    description: "Trusted Firecracker helper lifecycle",
    platforms: ["linux"],
    privileges: ["vm-helper", "hardware-virtualization"],
  }),
  createVmAdapterEnvelope({
    id: "custom",
    displayName: "Custom VM",
    description: "User-configured argv-only VM lifecycle",
    platforms: ["any"],
    privileges: ["custom-command"],
    trusted: false,
    lifecycle: "user-configured",
  }),
  createSecretAdapterEnvelope({
    id: "file",
    displayName: "File secrets",
    description: "Local encrypted-at-rest-by-permissions file backend",
    platforms: ["any"],
    privileges: ["secret-store"],
  }),
  createSecretAdapterEnvelope({
    id: "age",
    displayName: "age",
    description: "age-encrypted file secret backend",
    platforms: ["any"],
    privileges: ["secret-store", "external-cli"],
  }),
  createSecretAdapterEnvelope({
    id: "keychain",
    displayName: "OS keychain",
    description: "macOS Keychain or libsecret backend",
    platforms: ["linux", "darwin"],
    privileges: ["secret-store"],
  }),
  createSecretAdapterEnvelope({
    id: "pass",
    displayName: "pass",
    description: "pass password-store backend",
    platforms: ["any"],
    privileges: ["secret-store", "external-cli"],
  }),
  createSecretAdapterEnvelope({
    id: "onepassword",
    displayName: "1Password",
    description: "1Password CLI read-only reference backend",
    platforms: ["any"],
    privileges: ["read-only-secret-store", "external-cli"],
  }),
  createSecretAdapterEnvelope({
    id: "bitwarden",
    displayName: "Bitwarden",
    description: "Bitwarden CLI read-only reference backend",
    platforms: ["any"],
    privileges: ["read-only-secret-store", "external-cli"],
  }),
  createSecretAdapterEnvelope({
    id: "dashlane",
    displayName: "Dashlane",
    description: "Dashlane CLI read-only reference backend",
    platforms: ["any"],
    privileges: ["read-only-secret-store", "external-cli"],
  }),
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
      envelope.contract.driver !== envelope.id)
  ) {
    throw new Error(`Network adapter '${envelope.id}' has an invalid contract`);
  }
  if (
    envelope.kind === "vm" &&
    (!["trusted-core", "user-configured"].includes(
      envelope.metadata.lifecycle,
    ) ||
      envelope.contract.driver !== envelope.id)
  ) {
    throw new Error(`VM adapter '${envelope.id}' has an invalid contract`);
  }
  if (
    envelope.kind === "secret" &&
    (envelope.metadata.lifecycle !== "trusted-core" ||
      envelope.contract.type !== envelope.id)
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
