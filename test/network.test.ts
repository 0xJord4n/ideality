import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  buildNetworkPlan,
  clearActiveNetwork,
  loadActiveNetwork,
  networkCapability,
  saveActiveNetwork,
} from "../src/core/network.js";
import type { NetworkProfile } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
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
    expect(
      buildNetworkPlan("private", profile, "status"),
    ).toEqual([
      {
        description: "Read custom network status",
        command: ["private-vpn", "status"],
      },
    ]);
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
});
