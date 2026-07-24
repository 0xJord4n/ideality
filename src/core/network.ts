import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { NetworkProfile } from "../domain/config.js";

export type NetworkAction = "up" | "down" | "status";

export interface NetworkCommandStep {
  description: string;
  command: string[];
  env?: Record<string, string>;
}

export interface NetworkCapability {
  executable: string;
  strictKillSwitch: boolean;
  detail: string;
}

export interface NetworkPlanOptions {
  allowUnverified?: boolean;
  configPath?: string;
  authPath?: string;
  pidPath?: string;
  release?: boolean;
}

export interface ActiveNetworkState {
  version: 1;
  profile: string;
  identity: string;
  driver: NetworkProfile["driver"];
  enforcement: "strict" | "provider" | "off" | "unverified";
  activatedAt: string;
}

export function networkCapability(
  profile: NetworkProfile,
): NetworkCapability {
  switch (profile.driver) {
    case "mullvad":
      return {
        executable: profile.executable ?? "mullvad",
        strictKillSwitch: true,
        detail: "Mullvad lockdown mode",
      };
    case "wireguard":
      return {
        executable: profile.executable ?? "wg-quick",
        strictKillSwitch: false,
        detail: "wg-quick does not provide independently verified host enforcement",
      };
    case "openvpn":
      return {
        executable: profile.executable ?? "openvpn",
        strictKillSwitch: false,
        detail: "OpenVPN requires an operating-system kill-switch helper",
      };
    case "custom":
      return {
        executable: profile.connect[0]!,
        strictKillSwitch: profile.verifiedKillSwitch === true,
        detail: profile.verifiedKillSwitch
          ? "custom adapter attests a verified kill switch"
          : "custom adapter enforcement is unverified",
      };
  }
}

export function networkEnforcement(
  profile: NetworkProfile,
  allowUnverified: boolean = false,
): ActiveNetworkState["enforcement"] {
  const configured = profile.killSwitch ?? "required";
  const capability = networkCapability(profile);
  if (configured === "required") {
    if (capability.strictKillSwitch) return "strict";
    if (allowUnverified) return "unverified";
    throw new Error(
      `${profile.driver} requires a verified kill switch, but ${capability.detail}. Install the Ideality network helper or pass --allow-unverified explicitly`,
    );
  }
  return configured;
}

export function buildNetworkPlan(
  profileId: string,
  profile: NetworkProfile,
  action: NetworkAction,
  options: NetworkPlanOptions = {},
): NetworkCommandStep[] {
  if (action === "up") {
    networkEnforcement(profile, options.allowUnverified);
  }
  const executable = networkCapability(profile).executable;

  switch (profile.driver) {
    case "mullvad":
      return mullvadPlan(profile, executable, action, options.release);
    case "wireguard": {
      const prefix = profile.sudo ? ["sudo"] : [];
      return [
        {
          description: `${action === "up" ? "Start" : action === "down" ? "Stop" : "Read"} WireGuard profile ${profileId}`,
          command:
            action === "status"
              ? [...prefix, "wg", "show", profile.interface ?? "all"]
              : [
                  ...prefix,
                  executable,
                  action,
                  requireRuntimePath(
                    options.configPath,
                    "WireGuard configuration",
                  ),
                ],
        },
      ];
    }
    case "openvpn": {
      const prefix = profile.sudo ? ["sudo"] : [];
      if (action === "status") {
        return [
          {
            description: `Read OpenVPN profile ${profileId} status`,
            command: [
              "sh",
              "-c",
              `test -s ${shellQuote(requireRuntimePath(options.pidPath, "OpenVPN PID file"))} && ${profile.sudo ? "sudo " : ""}kill -0 "$(cat ${shellQuote(options.pidPath!)})"`,
            ],
          },
        ];
      }
      if (action === "down") {
        const pidPath = requireRuntimePath(
          options.pidPath,
          "OpenVPN PID file",
        );
        return [
          {
            description: `Stop OpenVPN profile ${profileId}`,
            command: [
              "sh",
              "-c",
              `test -s ${shellQuote(pidPath)} && ${profile.sudo ? "sudo " : ""}kill "$(cat ${shellQuote(pidPath)})"`,
            ],
          },
        ];
      }
      const configPath = requireRuntimePath(
        options.configPath,
        "OpenVPN configuration",
      );
      const pidPath = requireRuntimePath(options.pidPath, "OpenVPN PID file");
      const command = [
        ...prefix,
        executable,
        "--config",
        configPath,
        "--writepid",
        pidPath,
        "--daemon",
        `ideality-${profileId}`,
        "--auth-nocache",
        ...(options.authPath
          ? ["--auth-user-pass", options.authPath]
          : []),
        ...(profile.extraArgs ?? []),
      ];
      return [
        {
          description: `Start OpenVPN profile ${profileId}`,
          command,
        },
      ];
    }
    case "custom":
      return [
        {
          description:
            action === "up"
              ? "Connect custom network"
              : action === "down"
                ? "Disconnect custom network"
                : "Read custom network status",
          command:
            action === "up"
              ? [...profile.connect]
              : action === "down"
                ? [...profile.disconnect]
                : [...profile.status],
        },
      ];
  }
}

function mullvadPlan(
  profile: Extract<NetworkProfile, { driver: "mullvad" }>,
  executable: string,
  action: NetworkAction,
  release: boolean = false,
): NetworkCommandStep[] {
  if (action === "status") {
    return [
      {
        description: "Read Mullvad status",
        command: [executable, "status"],
      },
    ];
  }
  if (action === "down") {
    return [
      {
        description: "Disconnect Mullvad",
        command: [executable, "disconnect"],
      },
      ...(release
        ? [
            {
              description: "Release Mullvad lockdown mode",
              command: [executable, "lockdown-mode", "set", "off"],
            },
          ]
        : []),
    ];
  }

  const steps: NetworkCommandStep[] = [];
  if ((profile.killSwitch ?? "required") !== "off") {
    steps.push({
      description: "Enable Mullvad lockdown mode",
      command: [executable, "lockdown-mode", "set", "on"],
    });
  }
  if (profile.lan) {
    steps.push({
      description: `${profile.lan === "allow" ? "Allow" : "Block"} LAN access`,
      command: [
        executable,
        "lan",
        "set",
        profile.lan === "allow" ? "allow" : "block",
      ],
    });
  }
  if (profile.ipv6) {
    steps.push({
      description: `${profile.ipv6 === "tunnel" ? "Enable" : "Disable"} in-tunnel IPv6`,
      command: [
        executable,
        "tunnel",
        "set",
        "ipv6",
        profile.ipv6 === "tunnel" ? "on" : "off",
      ],
    });
  }
  if (profile.dns === "provider") {
    steps.push({
      description: "Use Mullvad DNS",
      command: [executable, "dns", "set", "default"],
    });
  } else if (typeof profile.dns === "object") {
    steps.push({
      description: "Set custom tunnel DNS",
      command: [
        executable,
        "dns",
        "set",
        "custom",
        ...profile.dns.servers,
      ],
    });
  }
  if (profile.location) {
    const location = [
      profile.location.country,
      profile.location.city,
      profile.location.hostname,
    ].filter((value): value is string => Boolean(value));
    if (location.length > 0) {
      steps.push({
        description: "Select Mullvad relay location",
        command: [executable, "relay", "set", "location", ...location],
      });
    }
  }
  steps.push(
    {
      description: "Connect Mullvad",
      command: [executable, "connect"],
    },
    {
      description: "Read Mullvad status",
      command: [executable, "status"],
    },
  );
  return steps;
}

function requireRuntimePath(
  value: string | undefined,
  subject: string,
): string {
  if (!value) throw new Error(`${subject} path is required`);
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function getActiveNetworkPath(idealityHome: string): string {
  return path.join(idealityHome, "runtime", "network-state.json");
}

export async function loadActiveNetwork(
  idealityHome: string,
): Promise<ActiveNetworkState | null> {
  const file = Bun.file(getActiveNetworkPath(idealityHome));
  if (!(await file.exists())) return null;
  const value: unknown = await file.json();
  if (!isActiveNetworkState(value)) {
    throw new Error("Active network state is invalid");
  }
  return value;
}

export async function saveActiveNetwork(
  idealityHome: string,
  state: ActiveNetworkState,
): Promise<void> {
  const file = getActiveNetworkPath(idealityHome);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export async function clearActiveNetwork(
  idealityHome: string,
): Promise<void> {
  await rm(getActiveNetworkPath(idealityHome), { force: true });
}

function isActiveNetworkState(value: unknown): value is ActiveNetworkState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ActiveNetworkState>;
  return (
    state.version === 1 &&
    typeof state.profile === "string" &&
    typeof state.identity === "string" &&
    ["wireguard", "openvpn", "mullvad", "custom"].includes(
      state.driver ?? "",
    ) &&
    ["strict", "provider", "off", "unverified"].includes(
      state.enforcement ?? "",
    ) &&
    typeof state.activatedAt === "string"
  );
}
