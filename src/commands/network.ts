import os from "node:os";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { resolveExecution } from "../core/execution.js";
import { redactConfig } from "../core/environment.js";
import { findNetworkConfigFiles } from "../core/file-search.js";
import { deriveIdentityId } from "../core/identity-id.js";
import {
  activateNetwork,
  deactivateNetwork,
  networkStatus,
} from "../core/network-manager.js";
import {
  loadActiveNetwork,
  networkCapability,
} from "../core/network.js";
import { loadRuntime } from "../core/runtime.js";
import type {
  NetworkProfile,
  ValueSource,
} from "../domain/config.js";
import { printJson, requirePositional } from "./shared.js";

type NetworkDriver = NetworkProfile["driver"];
type FileChoice = { kind: "file"; path: string } | { kind: "manual" };

function parseSource(value: string): ValueSource {
  if (value.startsWith("file:")) {
    return { from: "file", path: value.slice(5) };
  }
  if (value.startsWith("env:")) {
    return { from: "env", name: value.slice(4) };
  }
  if (value.startsWith("secret:")) {
    return { from: "secret", key: value.slice(7) };
  }
  return value.startsWith("value:") ? value.slice(6) : value;
}

function parseDns(value: string): "provider" | { servers: string[] } {
  if (value === "provider") return "provider";
  const servers = value
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (servers.length === 0) {
    throw new Error("--dns must be 'provider' or a comma-separated server list");
  }
  return { servers };
}

function parseCommand(value: string | undefined, name: string): string[] {
  if (!value) throw new Error(`--${name} is required for a custom network`);
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`--${name} must be a JSON array of command arguments`);
  }
  return parsed;
}

async function selectedProfile(
  candidatePath: string,
  identity: string | undefined,
  explicit: string | undefined,
): Promise<{
  runtime: Awaited<ReturnType<typeof loadRuntime>>;
  profileId: string;
}> {
  const runtime = await loadRuntime(candidatePath, identity);
  const profileId =
    explicit ?? resolveExecution(runtime.config, runtime.resolved).networkId;
  if (!profileId) {
    throw new Error(
      "No network is selected for this identity; pass a profile ID",
    );
  }
  return { runtime, profileId };
}

const operationOptions = {
  path: option(z.string().default(process.cwd()), {
    short: "C",
    description: "Path used for identity resolution",
  }),
  identity: option(z.string().optional(), {
    short: "i",
    description: "Override folder-based selection",
  }),
  "allow-unverified": option(z.boolean().default(false), {
    description: "Explicitly permit a tunnel without verified leak prevention",
    argumentKind: "flag",
  }),
  "dry-run": option(z.boolean().default(false), {
    description: "Print commands without executing them",
    argumentKind: "flag",
  }),
};

const networkCommand = defineGroup({
  name: "network",
  alias: "vpn",
  description: "Manage enforced VPN and network profiles",
  commands: [
    defineCommand({
      name: "list",
      description: "List network profiles",
      handler: async ({ colors }) => {
        const config = await loadConfig();
        const active = await loadActiveNetwork(getIdealityHome());
        for (const [id, profile] of Object.entries(config.networks ?? {})) {
          const capability = networkCapability(profile);
          const marker =
            active?.profile === id ? colors.green("*") : " ";
          console.log(
            `${marker} ${id.padEnd(18)} ${profile.driver.padEnd(10)} ${(profile.killSwitch ?? "required").padEnd(9)} ${capability.detail}`,
          );
        }
      },
    }),
    defineCommand({
      name: "show",
      description: "Show one network profile",
      handler: async ({ positional }) => {
        const id = requirePositional(positional, 0, "network profile");
        const profile = redactConfig(await loadConfig()).networks?.[id];
        if (!profile) throw new Error(`Network profile '${id}' does not exist`);
        printJson({ id, ...profile });
      },
    }),
    defineCommand({
      name: "add",
      description: "Create a VPN profile with an interactive wizard or flags",
      options: {
        id: option(z.string().optional(), {
          description: "Override the automatically derived profile ID",
        }),
        label: option(z.string().optional(), {
          description: "Display label",
        }),
        driver: option(
          z.enum(["mullvad", "wireguard", "openvpn", "custom"]).optional(),
          { description: "VPN driver" },
        ),
        config: option(z.string().optional(), {
          description: "Config source: file:path, secret:key, env:NAME, or value:text",
        }),
        username: option(z.string().optional(), {
          description: "OpenVPN username source",
        }),
        password: option(z.string().optional(), {
          description: "OpenVPN password source",
        }),
        country: option(z.string().optional(), {
          description: "Mullvad relay country",
        }),
        city: option(z.string().optional(), {
          description: "Mullvad relay city",
        }),
        hostname: option(z.string().optional(), {
          description: "Mullvad relay hostname",
        }),
        dns: option(z.string().default("provider"), {
          description: "Mullvad DNS: provider or comma-separated server list",
        }),
        ipv6: option(z.enum(["tunnel", "block"]).default("tunnel"), {
          description: "Mullvad IPv6 policy",
        }),
        lan: option(z.enum(["deny", "allow"]).default("deny"), {
          description: "Mullvad local-network policy",
        }),
        "kill-switch": option(
          z.enum(["required", "provider", "off"]).default("required"),
          { description: "Required enforcement level" },
        ),
        connect: option(z.string().optional(), {
          description: "Custom connect command as a JSON string array",
        }),
        disconnect: option(z.string().optional(), {
          description: "Custom disconnect command as a JSON string array",
        }),
        status: option(z.string().optional(), {
          description: "Custom status command as a JSON string array",
        }),
        "verified-kill-switch": option(z.boolean().default(false), {
          description: "Attest that the custom adapter enforces a kill switch",
          argumentKind: "flag",
        }),
        sudo: option(z.boolean().default(false), {
          description: "Run WireGuard/OpenVPN provider commands through sudo",
          argumentKind: "flag",
        }),
        "non-interactive": option(z.boolean().default(false), {
          description: "Never prompt",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Show the profile without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, prompt, terminal, colors }) => {
        const config = await loadConfig();
        const interactive = terminal.isInteractive && !flags["non-interactive"];
        let label = flags.label ?? "Private network";
        let driver = flags.driver;
        let configSource = flags.config;
        let killSwitch = flags["kill-switch"];
        let username = flags.username;
        let password = flags.password;
        let country = flags.country;
        let city = flags.city;
        let hostname = flags.hostname;
        let dns = flags.dns;
        let ipv6 = flags.ipv6;
        let lan = flags.lan;
        let connect = flags.connect;
        let disconnect = flags.disconnect;
        let status = flags.status;
        let verifiedKillSwitch = flags["verified-kill-switch"];
        let useSudo = flags.sudo;
        if (interactive) {
          prompt.intro("IDEALITY  /  NETWORK");
          label = await prompt.text("Profile label", {
            default: label,
            validate: (value) => value.length > 0 || "Label is required",
          });
          driver = await prompt.select<NetworkDriver>("VPN provider", {
            default: driver ?? "mullvad",
            options: [
              { label: "Mullvad", value: "mullvad", hint: "verified lockdown mode" },
              { label: "WireGuard", value: "wireguard", hint: "requires OS helper for strict mode" },
              { label: "OpenVPN", value: "openvpn", hint: "requires OS helper for strict mode" },
              { label: "Custom adapter", value: "custom" },
            ],
          });
          if (driver === "wireguard" || driver === "openvpn") {
            const files = await findNetworkConfigFiles(os.homedir(), process.cwd());
            const result = await prompt.filter<FileChoice>("VPN configuration", {
              options: [
                ...files.map((file) => ({
                  label: file,
                  value: { kind: "file", path: file } as const,
                })),
                { label: "Enter another source", value: { kind: "manual" } as const },
              ],
              placeholder: "Type to fuzzy search configuration files",
              fuzzy: true,
              limit: 12,
              height: 10,
            });
            const choice = Array.isArray(result) ? result[0] : result;
            configSource =
              choice?.kind === "file"
                ? `file:${choice.path}`
                : await prompt.text("Config source", {
                    default: configSource ?? "secret:vpn/config",
                  });
            killSwitch = await prompt.select<
              "required" | "provider" | "off"
            >("Leak prevention", {
              default: "provider",
              options: [
                {
                  label: "Provider or OS enforced",
                  value: "provider",
                  hint: "tunnel status is checked before every launch",
                },
                {
                  label: "Require verified kill switch",
                  value: "required",
                  hint: "fails closed until an OS helper is installed",
                },
                {
                  label: "Tunnel only",
                  value: "off",
                  hint: "no leak-prevention claim",
                },
              ],
            });
            useSudo = await prompt.confirm(
              "Run provider commands through sudo?",
              { default: useSudo },
            );
            if (
              driver === "openvpn" &&
              (await prompt.confirm("Does this profile use username/password authentication?", {
                default: Boolean(username || password),
              }))
            ) {
              username = await prompt.text("Username source", {
                default: username ?? "secret:vpn/username",
              });
              password = await prompt.text("Password source", {
                default: password ?? "secret:vpn/password",
              });
            }
          } else if (driver === "mullvad") {
            killSwitch = await prompt.select<
              "required" | "provider" | "off"
            >("Leak prevention", {
              default: killSwitch,
              options: [
                {
                  label: "Require Mullvad Lockdown mode",
                  value: "required",
                },
                {
                  label: "Trust Mullvad kill switch",
                  value: "provider",
                },
                { label: "No enforcement", value: "off" },
              ],
            });
            if (
              await prompt.confirm("Select a relay location?", {
                default: Boolean(country || city || hostname),
              })
            ) {
              country = await prompt.text("Country code", {
                default: country ?? "",
              });
              city = await prompt.text("City code (optional)", {
                default: city ?? "",
              });
              hostname = await prompt.text("Hostname (optional)", {
                default: hostname ?? "",
              });
            }
            const dnsMode = await prompt.select<"provider" | "custom">(
              "Tunnel DNS",
              {
                default: dns === "provider" ? "provider" : "custom",
                options: [
                  { label: "Mullvad DNS", value: "provider" },
                  { label: "Custom DNS servers", value: "custom" },
                ],
              },
            );
            dns =
              dnsMode === "provider"
                ? "provider"
                : await prompt.text("DNS servers (comma-separated)", {
                    default: dns === "provider" ? "" : dns,
                    validate: (value) => {
                      try {
                        parseDns(value);
                        return true;
                      } catch (error) {
                        return (error as Error).message;
                      }
                    },
                  });
            ipv6 = await prompt.select<"tunnel" | "block">("IPv6", {
              default: ipv6,
              options: [
                { label: "Tunnel IPv6", value: "tunnel" },
                { label: "Block IPv6", value: "block" },
              ],
            });
            lan = await prompt.select<"deny" | "allow">("Local network", {
              default: lan,
              options: [
                { label: "Deny LAN access", value: "deny" },
                { label: "Allow LAN access", value: "allow" },
              ],
            });
          } else {
            connect = await prompt.text("Connect command (JSON array)", {
              default: connect ?? '["vpn-helper","connect"]',
              validate: (value) => {
                try {
                  parseCommand(value, "connect");
                  return true;
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              },
            });
            disconnect = await prompt.text("Disconnect command (JSON array)", {
              default: disconnect ?? '["vpn-helper","disconnect"]',
              validate: (value) => {
                try {
                  parseCommand(value, "disconnect");
                  return true;
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              },
            });
            status = await prompt.text("Status command (JSON array)", {
              default: status ?? '["vpn-helper","status"]',
              validate: (value) => {
                try {
                  parseCommand(value, "status");
                  return true;
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              },
            });
            verifiedKillSwitch = await prompt.confirm(
              "Does this adapter independently enforce and verify a kill switch?",
              { default: verifiedKillSwitch },
            );
            killSwitch = await prompt.select<
              "required" | "provider" | "off"
            >("Leak prevention", {
              default: verifiedKillSwitch ? "required" : "provider",
              options: [
                {
                  label: "Require verified adapter",
                  value: "required",
                  hint: "requires the attestation above",
                },
                {
                  label: "Trust custom provider setup",
                  value: "provider",
                },
                { label: "No enforcement", value: "off" },
              ],
            });
          }
        }
        if (!driver) throw new Error("--driver is required in non-interactive mode");
        const id =
          flags.id ??
          deriveIdentityId(label, Object.keys(config.networks ?? {}));
        let profile: NetworkProfile;
        if (driver === "mullvad") {
          profile = {
            driver,
            label,
            killSwitch,
            dns: parseDns(dns),
            ipv6,
            lan,
            location:
              country || city || hostname
                ? {
                    country: country || undefined,
                    city: city || undefined,
                    hostname: hostname || undefined,
                  }
                : undefined,
          };
        } else if (driver === "wireguard") {
          if (!configSource) throw new Error("WireGuard requires --config");
          profile = {
            driver,
            label,
            sudo: useSudo,
            killSwitch,
            config: parseSource(configSource),
          };
        } else if (driver === "openvpn") {
          if (!configSource) throw new Error("OpenVPN requires --config");
          profile = {
            driver,
            label,
            sudo: useSudo,
            killSwitch,
            config: parseSource(configSource),
            username: username ? parseSource(username) : undefined,
            password: password ? parseSource(password) : undefined,
          };
        } else {
          profile = {
            driver,
            label,
            sudo: useSudo,
            killSwitch,
            connect: parseCommand(connect, "connect"),
            disconnect: parseCommand(disconnect, "disconnect"),
            status: parseCommand(status, "status"),
            verifiedKillSwitch,
          };
        }
        if (config.networks?.[id]) {
          throw new Error(`Network profile '${id}' already exists`);
        }
        if (interactive) {
          prompt.note(
            `${label} (${id})\nDriver: ${driver}\nKill switch: ${profile.killSwitch}`,
            "Review",
          );
          if (!(await prompt.confirm("Create this network profile?", { default: true }))) {
            prompt.cancel("No files were changed.");
            return;
          }
        }
        (config.networks ??= {})[id] = profile;
        if (flags["dry-run"]) {
          printJson({
            id,
            ...redactConfig({
              version: 1,
              defaultIdentity: "temporary",
              identities: {
                temporary: {
                  label: "Temporary",
                  roots: ["."],
                  tools: {},
                },
              },
              tools: {},
              networks: { [id]: profile },
            }).networks![id],
          });
        } else {
          await saveConfig(config);
          console.log(colors.green(`Created network profile '${id}'`));
        }
      },
    }),
    defineCommand({
      name: "bind",
      description: "Require a network for an identity or one tool",
      options: {
        tool: option(z.string().optional(), {
          description: "Apply only to this tool",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const networkId = requirePositional(positional, 1, "network profile");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity) throw new Error(`Identity '${identityId}' does not exist`);
        if (!config.networks?.[networkId]) {
          throw new Error(`Network profile '${networkId}' does not exist`);
        }
        const execution = { target: "host" as const, network: networkId };
        if (flags.tool) {
          if (!config.tools[flags.tool]) throw new Error(`Tool '${flags.tool}' does not exist`);
          (identity.tools[flags.tool] ??= {}).execution = execution;
        } else {
          identity.execution = execution;
        }
        await saveConfig(config);
        console.log(
          colors.green(
            `Bound ${flags.tool ? `${identityId}/${flags.tool}` : identityId} to network '${networkId}'`,
          ),
        );
      },
    }),
    defineCommand({
      name: "up",
      description: "Connect the selected network and acquire the host lease",
      options: {
        ...operationOptions,
        replace: option(z.boolean().default(false), {
          description: "Disconnect the active profile before switching",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags }) => {
        const { runtime, profileId } = await selectedProfile(
          flags.path,
          flags.identity,
          positional[0],
        );
        printJson(
          await activateNetwork({
            ...runtime,
            profileId,
            allowUnverified: flags["allow-unverified"],
            replace: flags.replace,
            dryRun: flags["dry-run"],
          }),
        );
      },
    }),
    defineCommand({
      name: "down",
      description: "Disconnect a network; Mullvad lockdown remains unless released",
      options: {
        ...operationOptions,
        release: option(z.boolean().default(false), {
          description: "Also disable provider lockdown",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags }) => {
        const active = await loadActiveNetwork(getIdealityHome());
        const { runtime, profileId } = await selectedProfile(
          flags.path,
          flags.identity,
          positional[0] ?? active?.profile,
        );
        printJson(
          await deactivateNetwork({
            ...runtime,
            profileId,
            release: flags.release,
            dryRun: flags["dry-run"],
          }),
        );
      },
    }),
    defineCommand({
      name: "status",
      description: "Check provider and Ideality lease status",
      options: operationOptions,
      handler: async ({ positional, flags }) => {
        const active = await loadActiveNetwork(getIdealityHome());
        const { runtime, profileId } = await selectedProfile(
          flags.path,
          flags.identity,
          positional[0] ?? active?.profile,
        );
        printJson(
          await networkStatus({
            ...runtime,
            profileId,
            dryRun: flags["dry-run"],
          }),
        );
      },
    }),
    defineCommand({
      name: "remove",
      description: "Remove an unused network profile",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Confirm removal",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        if (!flags.force) throw new Error("Network removal requires --force");
        const id = requirePositional(positional, 0, "network profile");
        const config = await loadConfig();
        if (!config.networks?.[id]) {
          throw new Error(`Network profile '${id}' does not exist`);
        }
        const referenced =
          Object.values(config.identities).some(
            (identity) =>
              identity.execution?.network === id ||
              Object.values(identity.tools).some(
                (tool) => tool.execution?.network === id,
              ),
          ) ||
          Object.values(config.vms ?? {}).some((vm) => vm.network === id);
        if (referenced) throw new Error(`Network profile '${id}' is still referenced`);
        delete config.networks[id];
        await saveConfig(config);
        console.log(colors.green(`Removed network profile '${id}'`));
      },
    }),
  ],
});

export default networkCommand;
