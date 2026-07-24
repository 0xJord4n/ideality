import { describe, expect, test } from "bun:test";

import {
  resolveExecution,
  summarizeExecution,
} from "../src/core/execution.js";
import type { IdealityConfig, ResolvedIdentity } from "../src/domain/config.js";

function fixture(): {
  config: IdealityConfig;
  resolved: ResolvedIdentity;
} {
  const config: IdealityConfig = {
    version: 1,
    defaultIdentity: "sample",
    networks: {
      private: {
        driver: "wireguard",
        config: { from: "secret", key: "sample/wireguard" },
      },
      host: {
        driver: "mullvad",
      },
    },
    vms: {
      workspace: {
        driver: "lima",
        network: "private",
      },
    },
    identities: {
      sample: {
        label: "Sample",
        roots: ["/workspace"],
        execution: { target: "vm", vm: "workspace" },
        tools: {
          codex: {},
          discord: {
            execution: { target: "host", network: "host" },
          },
        },
      },
    },
    tools: {
      codex: { executable: "codex" },
      discord: { executable: "discord" },
    },
  };
  return {
    config,
    resolved: {
      id: "sample",
      identity: config.identities.sample!,
      path: "/workspace/project",
      matchedRoot: "/workspace",
      isDefault: true,
    },
  };
}

describe("resolveExecution", () => {
  test("inherits the identity VM and its network", () => {
    const { config, resolved } = fixture();

    expect(resolveExecution(config, resolved, "codex")).toMatchObject({
      target: "vm",
      vmId: "workspace",
      networkId: "private",
      source: "identity",
    });
  });

  test("lets a tool override the identity execution target", () => {
    const { config, resolved } = fixture();

    expect(resolveExecution(config, resolved, "discord")).toMatchObject({
      target: "host",
      vmId: null,
      networkId: "host",
      source: "tool",
    });
  });

  test("defaults to the host when no execution target is configured", () => {
    const { config, resolved } = fixture();
    delete resolved.identity.execution;

    expect(resolveExecution(config, resolved, "codex")).toEqual({
      target: "host",
      vmId: null,
      vm: null,
      networkId: null,
      network: null,
      source: "default",
    });
  });

  test("summarizes dispatch without exposing network or VM configuration", () => {
    const { config, resolved } = fixture();
    const execution = resolveExecution(config, resolved, "discord");
    const summary = summarizeExecution(execution);

    expect(summary).toEqual({
      target: "host",
      vmId: null,
      networkId: "host",
      source: "tool",
    });
    expect(JSON.stringify(summary)).not.toContain("config");
  });
});
