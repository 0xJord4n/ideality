import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  activateNetwork,
  deactivateNetwork,
} from "../src/core/network-manager.js";
import { loadActiveNetwork } from "../src/core/network.js";
import type {
  IdealityConfig,
  ResolvedIdentity,
} from "../src/domain/config.js";

let temporary: string | undefined;

afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("network lifecycle", () => {
  test("leases a verified adapter and never persists its environment", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: {
          label: "Sample",
          roots: [temporary],
          tools: {},
        },
      },
      tools: {},
      networks: {
        private: {
          driver: "custom",
          connect: ["sh", "-c", "true"],
          disconnect: ["sh", "-c", "true"],
          status: ["sh", "-c", "true"],
          env: { VPN_TOKEN: "do-not-persist" },
          killSwitch: "required",
          verifiedKillSwitch: true,
        },
      },
    };
    const resolved: ResolvedIdentity = {
      id: "sample",
      identity: config.identities.sample!,
      path: temporary,
      matchedRoot: temporary,
      isDefault: true,
    };
    const commands: string[][] = [];
    const runner = async (command: string[]) => {
      commands.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    await activateNetwork({
      config,
      resolved,
      profileId: "private",
      home: temporary,
      idealityHome: temporary,
      runner,
    });
    expect(commands).toEqual([["sh", "-c", "true"]]);
    const active = await loadActiveNetwork(temporary);
    expect(active).toMatchObject({
      profile: "private",
      identity: "sample",
      enforcement: "strict",
    });
    expect(JSON.stringify(active)).not.toContain("do-not-persist");

    await deactivateNetwork({
      config,
      resolved,
      profileId: "private",
      home: temporary,
      idealityHome: temporary,
      runner,
    });
    expect(await loadActiveNetwork(temporary)).toBeNull();
  });

  test("serializes concurrent activation into one provider connection", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: {
          label: "Sample",
          roots: [temporary],
          tools: {},
        },
      },
      tools: {},
      networks: {
        private: {
          driver: "custom",
          connect: ["sh", "-c", "true"],
          disconnect: ["sh", "-c", "true"],
          status: ["sh", "-c", "true"],
          killSwitch: "required",
          verifiedKillSwitch: true,
        },
      },
    };
    const resolved: ResolvedIdentity = {
      id: "sample",
      identity: config.identities.sample!,
      path: temporary,
      matchedRoot: temporary,
      isDefault: true,
    };
    let connections = 0;
    const runner = async () => {
      connections += 1;
      await Bun.sleep(25);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const options = {
      config,
      resolved,
      profileId: "private",
      home: temporary,
      idealityHome: temporary,
      runner,
    };
    await Promise.all([activateNetwork(options), activateNetwork(options)]);
    expect(connections).toBe(1);
  });

  test("does not lease WARP when the status command reports disconnected", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const { config, resolved } = providerFixture(temporary, {
      driver: "warp",
      executable: "true",
      killSwitch: "provider",
    });

    await expect(
      activateNetwork({
        config,
        resolved,
        profileId: "private",
        home: temporary,
        idealityHome: temporary,
        quiet: true,
        runner: async (command) => ({
          exitCode: 0,
          stdout: command[1] === "status"
            ? "Status update: Disconnected\n"
            : "",
          stderr: "",
        }),
      }),
    ).rejects.toThrow("Cloudflare WARP is not connected");
    expect(await loadActiveNetwork(temporary)).toBeNull();
  });

  test("leases WARP only after connected status is confirmed", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const { config, resolved } = providerFixture(temporary, {
      driver: "warp",
      executable: "true",
      killSwitch: "provider",
    });

    await activateNetwork({
      config,
      resolved,
      profileId: "private",
      home: temporary,
      idealityHome: temporary,
      quiet: true,
      runner: async (command) => ({
        exitCode: 0,
        stdout: command[1] === "status"
          ? "Status update: Connected\n"
          : "",
        stderr: "",
      }),
    });

    expect(await loadActiveNetwork(temporary)).toMatchObject({
      profile: "private",
      driver: "warp",
      enforcement: "provider",
    });
  });

  test("requires a running Tailscale backend with an active exit node", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const { config, resolved } = providerFixture(temporary, {
      driver: "tailscale",
      executable: "true",
      exitNode: "exit.example.net",
      killSwitch: "provider",
    });

    await expect(
      activateNetwork({
        config,
        resolved,
        profileId: "private",
        home: temporary,
        idealityHome: temporary,
        quiet: true,
        runner: async (command) => ({
          exitCode: 0,
          stdout: command[1] === "status"
            ? JSON.stringify({ BackendState: "Running" })
            : "",
          stderr: "",
        }),
      }),
    ).rejects.toThrow(
      "Tailscale is not connected through exit node 'exit.example.net'",
    );
    expect(await loadActiveNetwork(temporary)).toBeNull();
  });

  test("rejects an offline Tailscale exit node", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const { config, resolved } = providerFixture(temporary, {
      driver: "tailscale",
      executable: "true",
      exitNode: "exit.example.net",
      killSwitch: "provider",
    });

    await expect(
      activateNetwork({
        config,
        resolved,
        profileId: "private",
        home: temporary,
        idealityHome: temporary,
        quiet: true,
        runner: async (command) => ({
          exitCode: 0,
          stdout: command[1] === "status"
            ? JSON.stringify({
                BackendState: "Running",
                ExitNodeStatus: { ID: "node-id", Online: false },
              })
            : "",
          stderr: "",
        }),
      }),
    ).rejects.toThrow(
      "Tailscale is not connected through exit node 'exit.example.net'",
    );
    expect(await loadActiveNetwork(temporary)).toBeNull();
  });

  test("leases Tailscale after confirming an online exit node", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    const { config, resolved } = providerFixture(temporary, {
      driver: "tailscale",
      executable: "true",
      exitNode: "exit.example.net",
      killSwitch: "provider",
    });

    await activateNetwork({
      config,
      resolved,
      profileId: "private",
      home: temporary,
      idealityHome: temporary,
      quiet: true,
      runner: async (command) => ({
        exitCode: 0,
        stdout: command[1] === "status"
          ? JSON.stringify({
              BackendState: "Running",
              ExitNodeStatus: { ID: "node-id", Online: true },
            })
          : "",
        stderr: "",
      }),
    });

    expect(await loadActiveNetwork(temporary)).toMatchObject({
      profile: "private",
      driver: "tailscale",
      enforcement: "provider",
    });
  });
});

function providerFixture(
  root: string,
  profile: NonNullable<IdealityConfig["networks"]>[string],
): { config: IdealityConfig; resolved: ResolvedIdentity } {
  const config: IdealityConfig = {
    version: 1,
    defaultIdentity: "sample",
    identities: {
      sample: {
        label: "Sample",
        roots: [root],
        tools: {},
      },
    },
    tools: {},
    networks: { private: profile },
  };
  return {
    config,
    resolved: {
      id: "sample",
      identity: config.identities.sample!,
      path: root,
      matchedRoot: root,
      isDefault: true,
    },
  };
}
