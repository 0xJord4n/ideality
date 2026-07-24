import { describe, expect, test } from "bun:test";

import {
  BUILTIN_TOOL_MANIFESTS,
  BUILTIN_TOOLS,
} from "../src/adapters/builtins.js";
import {
  ADAPTER_ENVELOPE_VERSION,
  ADAPTER_REGISTRY,
  createAdapterRegistry,
  createToolAdapterEnvelope,
  networkAdapterForProfile,
  secretAdapterForConfig,
  validateAdapterRegistryCompleteness,
  vmAdapterForProfile,
} from "../src/core/adapters.js";
import { applyPlugin } from "../src/core/plugins.js";
import { parsePluginManifest } from "../src/core/plugins.js";
import { createToolProfiles } from "../src/core/starter.js";
import { buildNetworkPlan, networkCapability } from "../src/core/network.js";
import { secretBackendWritable } from "../src/core/secret-backends.js";
import { vmCapability, vmCommand } from "../src/core/vm.js";
import type {
  IdealityConfig,
  NetworkProfile,
  VmProfile,
} from "../src/domain/config.js";

function config(
  secretBackend: IdealityConfig["secretBackend"],
): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    secretBackend,
    identities: {
      sample: { label: "Sample", roots: ["/workspace"], tools: {} },
    },
    tools: {},
  };
}

describe("unified adapter registry", () => {
  test("uses one versioned envelope for every adapter kind", () => {
    expect(ADAPTER_REGISTRY.version).toBe(ADAPTER_ENVELOPE_VERSION);
    expect(Object.keys(ADAPTER_REGISTRY.tools)).toHaveLength(58);
    expect(Object.keys(ADAPTER_REGISTRY.tools).sort()).toEqual(
      Object.keys(BUILTIN_TOOL_MANIFESTS).sort(),
    );
    expect(Object.keys(ADAPTER_REGISTRY.networks).sort()).toEqual([
      "custom",
      "mullvad",
      "openvpn",
      "tailscale",
      "warp",
      "wireguard",
    ]);
    expect(Object.keys(ADAPTER_REGISTRY.vms).sort()).toEqual([
      "apple-vz",
      "cloud-hypervisor",
      "custom",
      "firecracker",
      "lima",
    ]);
    expect(Object.keys(ADAPTER_REGISTRY.secrets).sort()).toEqual([
      "age",
      "bitwarden",
      "dashlane",
      "file",
      "keychain",
      "onepassword",
      "pass",
    ]);
    validateAdapterRegistryCompleteness(ADAPTER_REGISTRY, {
      toolIds: Object.keys(BUILTIN_TOOL_MANIFESTS),
    });
  });

  test("keeps manifests declarative while preserving compiled tool behavior", () => {
    const gh = ADAPTER_REGISTRY.tools.gh!;
    expect(gh.envelopeVersion).toBe(1);
    expect(gh.kind).toBe("tool");
    expect(gh.metadata.lifecycle).toBe("declarative");
    expect(gh.metadata.contributorExecutable).toBe(false);
    expect(gh.contract.manifest).toBe(BUILTIN_TOOL_MANIFESTS.gh);
    expect(gh.contract.definition).toEqual(BUILTIN_TOOLS.gh);

    const plugin = createToolAdapterEnvelope(
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"acme","profile":{"isolation":"process","env":{"ACME_TOKEN":{"from":"secret","key":"{{identity}}/acme"}}}}`,
      ),
      { builtIn: false },
    );
    expect(plugin.metadata.builtIn).toBe(false);
    expect(plugin.metadata.lifecycle).toBe("declarative");
    expect(plugin.metadata.privileges).toEqual(["none"]);
  });

  test("routes network lifecycle through trusted registered adapters", () => {
    const profile: NetworkProfile = {
      driver: "mullvad",
      killSwitch: "required",
      location: { country: "se" },
    };
    const adapter = ADAPTER_REGISTRY.networks.mullvad!;
    expect(adapter.metadata.lifecycle).toBe("trusted-core");
    expect(adapter.metadata.privileges).toContain("host-network");
    expect(adapter.contract.capability(profile)).toEqual(
      networkCapability(profile),
    );
    expect(adapter.contract.plan("private", profile, "up")).toEqual(
      buildNetworkPlan("private", profile, "up"),
    );
  });

  test("labels user-configured custom network adapters as untrusted argv wrappers", () => {
    const profile: NetworkProfile = {
      driver: "custom",
      connect: ["vpnctl", "connect"],
      disconnect: ["vpnctl", "disconnect"],
      status: ["vpnctl", "status"],
      killSwitch: "provider",
    };
    const adapter = networkAdapterForProfile(profile);

    expect(adapter).toBe(ADAPTER_REGISTRY.networks.custom);
    expect(adapter.metadata.trusted).toBe(false);
    expect(adapter.metadata.lifecycle).toBe("user-configured");
    expect(adapter.metadata.privileges).toEqual([
      "host-network",
      "custom-command",
    ]);
    expect(adapter.contract.plan("private", profile, "up")).toEqual([
      {
        description: "Connect custom network",
        command: ["vpnctl", "connect"],
      },
    ]);
  });

  test("routes VM lifecycle through trusted registered adapters with platform metadata", () => {
    const profile: VmProfile = { driver: "firecracker" };
    const adapter = ADAPTER_REGISTRY.vms.firecracker!;
    expect(adapter.metadata.platforms).toEqual(["linux"]);
    expect(adapter.metadata.privileges).toEqual([
      "vm-helper",
      "hardware-virtualization",
    ]);
    expect(
      adapter.contract.capability(profile, {
        platform: "linux",
        hasKvm: false,
        findExecutable: () => "/usr/bin/ideality-firecracker-helper",
      }),
    ).toEqual(
      vmCapability(profile, {
        platform: "linux",
        hasKvm: false,
        findExecutable: () => "/usr/bin/ideality-firecracker-helper",
      }),
    );
    expect(adapter.contract.command("sample", profile, "status")).toEqual(
      vmCommand("sample", profile, "status"),
    );
  });

  test("labels user-configured custom VM adapters as untrusted argv wrappers", () => {
    const profile: VmProfile = {
      driver: "custom",
      start: ["vmctl", "start", "{{vm}}"],
      stop: ["vmctl", "stop", "{{vm}}"],
      status: ["vmctl", "status", "{{vm}}"],
      exec: ["vmctl", "exec", "{{vm}}", "--", "{{command}}"],
    };
    const adapter = vmAdapterForProfile(profile);

    expect(adapter).toBe(ADAPTER_REGISTRY.vms.custom);
    expect(adapter.metadata.trusted).toBe(false);
    expect(adapter.metadata.lifecycle).toBe("user-configured");
    expect(adapter.metadata.privileges).toEqual(["custom-command"]);
    expect(
      adapter.contract.command("sample", profile, "exec", {
        command: ["bun", "test"],
      }),
    ).toEqual(["vmctl", "exec", "sample", "--", "bun", "test"]);
  });

  test("routes secret backend policy through trusted registered adapters", () => {
    const onePassword = ADAPTER_REGISTRY.secrets.onepassword!;
    expect(onePassword.metadata.lifecycle).toBe("trusted-core");
    expect(onePassword.metadata.privileges).toEqual([
      "read-only-secret-store",
      "external-cli",
    ]);
    expect(
      onePassword.contract.executable(config({ type: "onepassword" })),
    ).toBe("op");
    expect(onePassword.contract.writable(config({ type: "onepassword" }))).toBe(
      false,
    );

    const file = ADAPTER_REGISTRY.secrets.file!;
    expect(secretAdapterForConfig(config({ type: "file" }))).toBe(file);
    expect(file.contract.executable(config({ type: "file" }))).toBeNull();
    expect(file.contract.writable(config({ type: "file" }))).toBe(
      secretBackendWritable(config({ type: "file" })),
    );
  });

  test("compiles starter and plugin profiles through tool registry contracts", () => {
    const gerritProfile = createToolProfiles(
      "sample",
      ["gerrit"],
      "/home/sample/.ssh/id_ed25519",
    ).gerrit;
    expect(gerritProfile).toEqual({
      isolation: "process",
      args: ["-i", "/home/sample/.ssh/id_ed25519"],
    });

    const manifest = parsePluginManifest(
      `{"version":1,"name":"acme","executable":"acme","profile":{"isolation":"process","env":{"ACME_TOKEN":{"from":"secret","key":"{{identity}}/acme"}}}}`,
    );
    const next = applyPlugin(config({ type: "file" }), manifest);
    expect(next.tools.acme).toEqual(
      createToolAdapterEnvelope(manifest, {
        builtIn: false,
      }).contract.definition,
    );
    expect(next.identities.sample?.tools.acme).toEqual({
      env: {
        ACME_TOKEN: { from: "secret", key: "{{identity}}/acme" },
      },
    });
  });

  test("rejects invalid envelopes and duplicate registry entries", () => {
    const gh = ADAPTER_REGISTRY.tools.gh!;
    const customNetwork = ADAPTER_REGISTRY.networks.custom!;
    expect(() =>
      createAdapterRegistry([
        gh,
        {
          ...gh,
          metadata: { ...gh.metadata, contributorExecutable: true },
        } as unknown as typeof gh,
      ]),
    ).toThrow("contributor executable code");
    expect(() => createAdapterRegistry([gh, gh])).toThrow("Duplicate tool");
    expect(() =>
      createAdapterRegistry([
        { ...gh, envelopeVersion: 2 } as unknown as typeof gh,
      ]),
    ).toThrow("Unsupported adapter envelopeVersion");
    expect(() =>
      createAdapterRegistry([
        {
          ...customNetwork,
          metadata: { ...customNetwork.metadata, trusted: true },
        },
      ]),
    ).toThrow("cannot be trusted");
  });
});
