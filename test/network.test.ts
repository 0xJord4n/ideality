import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildNetworkPlan,
  clearActiveNetwork,
  loadActiveNetwork,
  networkCapability,
  saveActiveNetwork,
  type ActiveNetworkState,
} from "../src/core/network.js";
import type { NetworkProfile } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("network adapters", () => {
  test("enables Mullvad lockdown before connecting", () => {
    const profile: NetworkProfile = {
      driver: "mullvad",
      killSwitch: "required",
      location: { country: "se", city: "sto" },
    };

    expect(networkCapability(profile)).toMatchObject({
      executable: "mullvad",
      strictKillSwitch: true,
    });
    expect(buildNetworkPlan("private", profile, "up")).toEqual([
      {
        description: "Enable Mullvad lockdown mode",
        command: ["mullvad", "lockdown-mode", "set", "on"],
      },
      {
        description: "Select Mullvad relay location",
        command: ["mullvad", "relay", "set", "location", "se", "sto"],
      },
      {
        description: "Connect Mullvad",
        command: ["mullvad", "connect"],
      },
      {
        description: "Read Mullvad status",
        command: ["mullvad", "status"],
        verifyConnection: { provider: "mullvad" },
      },
    ]);
  });

  test("does not claim generic WireGuard has a verified host kill switch", () => {
    const profile: NetworkProfile = {
      driver: "wireguard",
      config: { from: "secret", key: "sample/wireguard" },
      killSwitch: "required",
    };

    expect(networkCapability(profile)).toMatchObject({
      executable: "wg-quick",
      strictKillSwitch: false,
    });
    expect(() =>
      buildNetworkPlan("private", profile, "up", {
        configPath: "/runtime/private.conf",
      }),
    ).toThrow("requires a verified kill switch");
    expect(
      buildNetworkPlan("private", profile, "up", {
        allowUnverified: true,
        configPath: "/runtime/private.conf",
      }),
    ).toEqual([
      {
        description: "Start WireGuard profile private",
        command: ["wg-quick", "up", "/runtime/private.conf"],
      },
    ]);
  });

  test("requires custom strict adapters to attest their enforcement", () => {
    const profile: NetworkProfile = {
      driver: "custom",
      connect: ["private-vpn", "start"],
      disconnect: ["private-vpn", "stop"],
      status: ["private-vpn", "status"],
      killSwitch: "provider",
    };

    expect(networkCapability(profile).strictKillSwitch).toBe(false);
    expect(buildNetworkPlan("private", profile, "status")).toEqual([
      {
        description: "Read custom network status",
        command: ["private-vpn", "status"],
      },
    ]);
  });

  test("routes Tailscale through an explicit exit node without overstating enforcement", () => {
    const profile: NetworkProfile = {
      driver: "tailscale",
      exitNode: "exit.example.net",
      allowLanAccess: false,
      acceptRoutes: true,
      shieldsUp: true,
      killSwitch: "provider",
    };

    expect(networkCapability(profile)).toMatchObject({
      executable: "tailscale",
      strictKillSwitch: false,
    });
    expect(buildNetworkPlan("tailnet", profile, "up")).toEqual([
      {
        description: "Connect Tailscale through exit node exit.example.net",
        command: [
          "tailscale",
          "up",
          "--exit-node=exit.example.net",
          "--exit-node-allow-lan-access=false",
          "--accept-routes=true",
          "--shields-up=true",
        ],
      },
      {
        description: "Read Tailscale status",
        command: ["tailscale", "status", "--json"],
        verifyConnection: {
          provider: "tailscale",
          exitNode: "exit.example.net",
        },
      },
    ]);
  });

  test("connects WARP and requires an external layer for strict mode", () => {
    const profile: NetworkProfile = {
      driver: "warp",
      killSwitch: "provider",
    };

    expect(networkCapability(profile)).toMatchObject({
      executable: "warp-cli",
      strictKillSwitch: false,
    });
    expect(buildNetworkPlan("warp", profile, "up")).toEqual([
      {
        description: "Connect Cloudflare WARP",
        command: ["warp-cli", "connect"],
      },
      {
        description: "Read Cloudflare WARP status",
        command: ["warp-cli", "status"],
        verifyConnection: { provider: "warp" },
      },
    ]);
    expect(() =>
      buildNetworkPlan(
        "strict-warp",
        {
          ...profile,
          killSwitch: "required",
        },
        "up",
      ),
    ).toThrow("requires a verified kill switch");
  });
});

describe("active network lease", () => {
  test("persists only non-secret network state with locked permissions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    temporaryDirectories.push(home);
    await saveActiveNetwork(home, {
      version: 1,
      profile: "private",
      identity: "sample",
      driver: "wireguard",
      enforcement: "unverified",
      activatedAt: "2026-07-24T10:00:00.000Z",
    });

    expect(await loadActiveNetwork(home)).toEqual({
      version: 1,
      profile: "private",
      identity: "sample",
      driver: "wireguard",
      enforcement: "unverified",
      activatedAt: "2026-07-24T10:00:00.000Z",
    });
    const statePath = path.join(home, "runtime", "network-state.json");
    expect((await stat(statePath)).mode & 0o777).toBe(0o600);
    expect(await readFile(statePath, "utf8")).not.toContain("private-key");

    await clearActiveNetwork(home);
    expect(await loadActiveNetwork(home)).toBeNull();
  });

  test("keeps concurrent atomic writes isolated", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-network-"));
    temporaryDirectories.push(home);
    const states: ActiveNetworkState[] = Array.from(
      { length: 32 },
      (_, index) => ({
        version: 1 as const,
        profile: `private-${index}`,
        identity: "sample",
        driver: "wireguard" as const,
        enforcement: "unverified" as const,
        activatedAt: `2026-07-24T10:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );

    await Promise.all(states.map((state) => saveActiveNetwork(home, state)));

    const active = await loadActiveNetwork(home);
    expect(active).not.toBeNull();
    expect(states).toContainEqual(active!);
    expect(await readdir(path.join(home, "runtime"))).toEqual([
      "network-state.json",
    ]);
  });
});
