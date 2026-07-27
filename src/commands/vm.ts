import os from "node:os";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import { vmAdapterCapability, vmAdapterCommand } from "../core/adapters.js";
import { recordAuditEvent } from "../core/audit-history.js";
import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { findIdentityDirectories } from "../core/file-search.js";
import { deriveIdentityId } from "../core/identity-id.js";
import { ensureNetwork } from "../core/network-manager.js";
import { runProcess } from "../core/process.js";
import { loadRuntime } from "../core/runtime.js";
import {
  ensureVmRunning,
  guestWorkspacePath,
  networkDnsServers,
  runVmCommand,
  writeVmConfig,
} from "../core/vm.js";
import type { VmProfile } from "../domain/config.js";
import { commandArguments, printJson, requirePositional } from "./shared.js";

type VmDriver = VmProfile["driver"];
type DirectoryChoice = { kind: "directory"; path: string } | { kind: "manual" };

function parseCommand(value: string | undefined, name: string): string[] {
  if (!value) throw new Error(`--${name} is required for a custom VM`);
  return parseStringArray(value, name);
}

function parseStringArray(value: string, name: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`--${name} must be a non-empty JSON string array`);
  }
  return parsed;
}

async function prepareVm(
  vmId: string,
  candidatePath: string,
  identityId?: string,
  enforceNetwork: boolean = true,
): Promise<{
  runtime: Awaited<ReturnType<typeof loadRuntime>>;
  profile: VmProfile;
  configPath: string;
}> {
  const runtime = await loadRuntime(candidatePath, identityId);
  const profile = runtime.config.vms?.[vmId];
  if (!profile) throw new Error(`VM profile '${vmId}' does not exist`);
  const capability = vmAdapterCapability(profile);
  if (!capability.available) throw new Error(capability.detail);
  if (profile.network && enforceNetwork) {
    await ensureNetwork({
      ...runtime,
      profileId: profile.network,
    });
  }
  const network = profile.network
    ? runtime.config.networks?.[profile.network]
    : undefined;
  const configPath = await writeVmConfig(vmId, profile, runtime.resolved, {
    home: runtime.home,
    idealityHome: runtime.idealityHome,
    networkDns: networkDnsServers(network?.dns),
    networkRequired: Boolean(profile.network),
  });
  return { runtime, profile, configPath };
}

async function startPreparedVm(
  vmId: string,
  profile: VmProfile,
  configPath: string,
): Promise<void> {
  await ensureVmRunning(
    vmId,
    profile,
    configPath,
    runProcess,
    vmAdapterCommand,
  );
}

const runtimeOptions = {
  path: option(z.string().default(process.cwd()), {
    short: "C",
    description: "Path used for identity resolution",
  }),
  identity: option(z.string().optional(), {
    short: "i",
    description: "Override folder-based selection",
  }),
};

const vmCommandGroup = defineGroup({
  name: "vm",
  description: "Manage isolated execution machines",
  commands: [
    defineCommand({
      name: "list",
      description: "List VM profiles and backend availability",
      handler: async ({ colors }) => {
        for (const [id, profile] of Object.entries(
          (await loadConfig()).vms ?? {},
        )) {
          const capability = vmAdapterCapability(profile);
          console.log(
            `${id.padEnd(18)} ${profile.driver.padEnd(18)} ${
              capability.available
                ? colors.green("ready")
                : colors.yellow("missing")
            }  ${capability.detail}`,
          );
        }
      },
    }),
    defineCommand({
      name: "show",
      description: "Show one VM profile",
      handler: async ({ positional }) => {
        const id = requirePositional(positional, 0, "VM profile");
        const profile = (await loadConfig()).vms?.[id];
        if (!profile) throw new Error(`VM profile '${id}' does not exist`);
        printJson({ id, capability: vmAdapterCapability(profile), ...profile });
      },
    }),
    defineCommand({
      name: "add",
      description: "Create a VM profile with an interactive wizard or flags",
      options: {
        id: option(z.string().optional(), {
          description: "Override the automatically derived profile ID",
        }),
        label: option(z.string().optional(), {
          description: "Display label",
        }),
        driver: option(
          z
            .enum([
              "lima",
              "apple-vz",
              "cloud-hypervisor",
              "firecracker",
              "custom",
            ])
            .optional(),
          { description: "VM backend" },
        ),
        cpus: option(z.coerce.number().int().min(1).default(4), {
          description: "Virtual CPUs",
        }),
        memory: option(z.coerce.number().int().min(256).default(4096), {
          description: "Memory in MiB",
        }),
        disk: option(z.coerce.number().int().min(1).default(40), {
          description: "Disk in GiB",
        }),
        image: option(z.string().optional(), {
          description: "Guest image URL or backend image reference",
        }),
        provision: option(z.string().optional(), {
          description:
            "Lima system provisioning scripts as a JSON string array",
        }),
        instance: option(z.string().optional(), {
          description: "Backend instance name",
        }),
        "vm-type": option(z.enum(["auto", "vz", "qemu"]).optional(), {
          description: "Lima virtualization driver",
        }),
        "mount-type": option(
          z.enum(["auto", "virtiofs", "9p", "reverse-sshfs"]).optional(),
          { description: "Lima filesystem transport" },
        ),
        rosetta: option(z.boolean().default(false), {
          description: "Enable Rosetta in an Apple VZ guest",
          argumentKind: "flag",
        }),
        video: option(z.boolean().default(false), {
          description: "Enable backend video output",
          argumentKind: "flag",
        }),
        "guest-home": option(z.string().default("/home/ideality"), {
          description: "Guest home used for path templates",
        }),
        mount: option(z.string().optional(), {
          description: "Host workspace mount source",
        }),
        "workspace-target": option(z.string().default("/workspace"), {
          description: "Guest workspace path",
        }),
        network: option(z.string().optional(), {
          description: "Host-enforced network profile",
        }),
        helper: option(z.string().optional(), {
          description: "Backend helper executable",
        }),
        start: option(z.string().optional(), {
          description: "Custom start command as a JSON string array",
        }),
        stop: option(z.string().optional(), {
          description: "Custom stop command as a JSON string array",
        }),
        status: option(z.string().optional(), {
          description: "Custom status command as a JSON string array",
        }),
        exec: option(z.string().optional(), {
          description: "Custom exec command as a JSON string array",
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
        let label = flags.label ?? "Isolated workspace";
        let driver = flags.driver;
        let mount = flags.mount;
        let network = flags.network;
        let cpus = flags.cpus;
        let memory = flags.memory;
        let disk = flags.disk;
        let image = flags.image;
        let provision = flags.provision;
        let helper = flags.helper;
        let start = flags.start;
        let stop = flags.stop;
        let status = flags.status;
        let exec = flags.exec;
        let video = flags.video;
        if (interactive) {
          prompt.intro("IDEALITY  /  VIRTUAL MACHINE");
          label = await prompt.text("Profile label", {
            default: flags.label ?? "",
            placeholder: "Isolated workspace",
            validate: (value) => value.length > 0 || "Label is required",
          });
          driver = await prompt.select<VmDriver>("Virtualization backend", {
            default: driver ?? "lima",
            options: [
              { label: "Lima", value: "lima", hint: "macOS VZ or Linux QEMU" },
              {
                label: "Apple Virtualization",
                value: "apple-vz",
                hint: "helper required",
              },
              {
                label: "Cloud Hypervisor",
                value: "cloud-hypervisor",
                hint: "helper required",
              },
              {
                label: "Firecracker",
                value: "firecracker",
                hint: "Linux + /dev/kvm + helper",
              },
              { label: "Custom adapter", value: "custom" },
            ],
          });
          const numberInput = async (
            message: string,
            current: number,
            minimum: number,
          ): Promise<number> =>
            Number(
              await prompt.text(message, {
                default: String(current),
                validate: (value) => {
                  const parsed = Number(value);
                  return (
                    (Number.isInteger(parsed) && parsed >= minimum) ||
                    `Enter an integer of at least ${minimum}`
                  );
                },
              }),
            );
          cpus = await numberInput("Virtual CPUs", cpus, 1);
          memory = await numberInput("Memory (MiB)", memory, 256);
          disk = await numberInput("Disk (GiB)", disk, 1);
          if (
            await prompt.confirm("Use a custom guest image?", {
              default: Boolean(image),
            })
          ) {
            image = await prompt.text("Guest image", {
              default: image ?? "",
              validate: (value) => value.length > 0 || "Image is required",
            });
          }
          const directories = await findIdentityDirectories(os.homedir());
          const selected = await prompt.filter<DirectoryChoice>(
            "Workspace mount",
            {
              options: [
                {
                  label: "Resolve the active project root at runtime",
                  value: { kind: "directory", path: "{{root}}" },
                },
                ...directories.map((directory) => ({
                  label: directory,
                  value: { kind: "directory", path: directory } as const,
                })),
                {
                  label: "Enter another path",
                  value: { kind: "manual" } as const,
                },
              ],
              placeholder: "Type to fuzzy search directories",
              fuzzy: true,
              limit: 12,
              height: 10,
            },
          );
          const choice = Array.isArray(selected) ? selected[0] : selected;
          mount =
            choice?.kind === "directory"
              ? choice.path
              : await prompt.text("Host mount path", {
                  default: mount ?? "{{root}}",
                });
          if (Object.keys(config.networks ?? {}).length > 0) {
            network = await prompt.select<string | undefined>(
              "Host-enforced VPN",
              {
                default: network,
                options: [
                  { label: "No VPN requirement", value: undefined },
                  ...Object.entries(config.networks ?? {}).map(
                    ([id, profile]) => ({
                      label: profile.label ?? id,
                      value: id,
                      hint: `${profile.driver} / ${profile.killSwitch ?? "required"}`,
                    }),
                  ),
                ],
              },
            );
          }
          video = await prompt.confirm("Enable VM video output?", {
            default: video,
          });
          if (
            driver === "lima" &&
            (await prompt.confirm(
              "Add idempotent guest provisioning scripts?",
              {
                default: Boolean(provision),
              },
            ))
          ) {
            provision = await prompt.text("Provision scripts (JSON array)", {
              default: provision ?? '["#!/bin/sh\\nset -eu\\napt-get update"]',
              validate: (value) => {
                try {
                  parseStringArray(value, "provision");
                  return true;
                } catch (error) {
                  return (error as Error).message;
                }
              },
            });
          } else if (driver === "custom") {
            start = await prompt.text("Start command (JSON array)", {
              default: start ?? '["vm-helper","start","{{vm}}"]',
            });
            stop = await prompt.text("Stop command (JSON array)", {
              default: stop ?? '["vm-helper","stop","{{vm}}"]',
            });
            status = await prompt.text("Status command (JSON array)", {
              default: status ?? '["vm-helper","status","{{vm}}"]',
            });
            exec = await prompt.text("Exec command (JSON array)", {
              default:
                exec ??
                '["vm-helper","exec","{{vm}}","--workdir","{{workdir}}","--","{{command}}"]',
            });
          } else if (driver !== "lima") {
            helper = await prompt.text("Backend helper executable", {
              default:
                helper ??
                (driver === "apple-vz"
                  ? "ideality-vz-helper"
                  : driver === "cloud-hypervisor"
                    ? "ideality-cloud-hypervisor-helper"
                    : "ideality-firecracker-helper"),
            });
          }
        }
        if (!driver)
          throw new Error("--driver is required in non-interactive mode");
        const id =
          flags.id ?? deriveIdentityId(label, Object.keys(config.vms ?? {}));
        const common = {
          label,
          cpus,
          memoryMiB: memory,
          diskGiB: disk,
          image,
          guestHome: flags["guest-home"],
          workspaceTarget: flags["workspace-target"],
          mounts: [
            {
              source: mount ?? "{{root}}",
              target: flags["workspace-target"],
              writable: true,
            },
          ],
          network,
          video,
        };
        let profile: VmProfile;
        if (driver === "lima") {
          profile = {
            ...common,
            driver,
            instance: flags.instance,
            vmType:
              flags["vm-type"] ??
              (process.platform === "darwin" ? "vz" : "qemu"),
            mountType:
              flags["mount-type"] ??
              (process.platform === "darwin" ? "virtiofs" : "9p"),
            rosetta: flags.rosetta,
            provision: provision
              ? parseStringArray(provision, "provision")
              : undefined,
          };
        } else if (driver === "custom") {
          profile = {
            ...common,
            driver,
            start: parseCommand(start, "start"),
            stop: parseCommand(stop, "stop"),
            status: parseCommand(status, "status"),
            exec: parseCommand(exec, "exec"),
          };
        } else {
          profile = { ...common, driver, helper };
        }
        if (config.vms?.[id])
          throw new Error(`VM profile '${id}' already exists`);
        if (interactive) {
          prompt.note(
            `${label} (${id})\nBackend: ${driver}\nWorkspace: ${common.mounts[0]!.source} -> ${common.workspaceTarget}\nVPN: ${network ?? "none"}`,
            "Review",
          );
          if (
            !(await prompt.confirm("Create this VM profile?", {
              default: true,
            }))
          ) {
            prompt.cancel("No files were changed.");
            return;
          }
        }
        (config.vms ??= {})[id] = profile;
        if (flags["dry-run"]) {
          printJson({ id, ...profile });
        } else {
          await saveConfig(config);
          await recordAuditEvent(config, getIdealityHome(), {
            eventType: "vm.added",
            payload: {
              vm: id,
              driver,
              network,
              dryRun: false,
            },
          });
          console.log(colors.green(`Created VM profile '${id}'`));
        }
      },
    }),
    defineCommand({
      name: "bind",
      description:
        "Route an identity or one tool through a VM and optional VPN",
      options: {
        tool: option(z.string().optional(), {
          description: "Apply only to this tool",
        }),
        network: option(z.string().optional(), {
          description: "Override the VM network profile",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const vmId = requirePositional(positional, 1, "VM profile");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity)
          throw new Error(`Identity '${identityId}' does not exist`);
        if (!config.vms?.[vmId])
          throw new Error(`VM profile '${vmId}' does not exist`);
        if (flags.network && !config.networks?.[flags.network]) {
          throw new Error(`Network profile '${flags.network}' does not exist`);
        }
        const execution = {
          target: "vm" as const,
          vm: vmId,
          network: flags.network,
        };
        if (flags.tool) {
          if (!config.tools[flags.tool])
            throw new Error(`Tool '${flags.tool}' does not exist`);
          (identity.tools[flags.tool] ??= {}).execution = execution;
        } else {
          identity.execution = execution;
        }
        await saveConfig(config);
        await recordAuditEvent(config, getIdealityHome(), {
          eventType: "vm.bound",
          payload: {
            identity: identityId,
            tool: flags.tool,
            vm: vmId,
            network: flags.network,
          },
        });
        console.log(
          colors.green(
            `Bound ${flags.tool ? `${identityId}/${flags.tool}` : identityId} to VM '${vmId}'`,
          ),
        );
      },
    }),
    defineCommand({
      name: "unbind",
      description: "Return an identity or one tool to host execution",
      options: {
        tool: option(z.string().optional(), {
          description: "Apply only to this tool",
        }),
        network: option(z.string().optional(), {
          description: "Keep a host network requirement",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity)
          throw new Error(`Identity '${identityId}' does not exist`);
        if (flags.network && !config.networks?.[flags.network]) {
          throw new Error(`Network profile '${flags.network}' does not exist`);
        }
        if (flags.tool) {
          if (!config.tools[flags.tool])
            throw new Error(`Tool '${flags.tool}' does not exist`);
          (identity.tools[flags.tool] ??= {}).execution = {
            target: "host",
            network: flags.network,
          };
        } else if (flags.network) {
          identity.execution = {
            target: "host",
            network: flags.network,
          };
        } else {
          delete identity.execution;
        }
        await saveConfig(config);
        await recordAuditEvent(config, getIdealityHome(), {
          eventType: "vm.unbound",
          payload: {
            identity: identityId,
            tool: flags.tool,
            network: flags.network,
          },
        });
        console.log(
          colors.green(
            `Returned ${flags.tool ? `${identityId}/${flags.tool}` : identityId} to host execution`,
          ),
        );
      },
    }),
    defineCommand({
      name: "start",
      description: "Start a VM after enforcing its network",
      options: runtimeOptions,
      handler: async ({ positional, flags, colors }) => {
        const vmId = requirePositional(positional, 0, "VM profile");
        const prepared = await prepareVm(vmId, flags.path, flags.identity);
        await startPreparedVm(vmId, prepared.profile, prepared.configPath);
        await recordAuditEvent(
          prepared.runtime.config,
          prepared.runtime.idealityHome,
          {
            eventType: "vm.started",
            payload: {
              identity: prepared.runtime.resolved.id,
              vm: vmId,
              network: prepared.profile.network,
              action: "start",
            },
          },
        );
        console.log(colors.green(`Started VM '${vmId}'`));
      },
    }),
    defineCommand({
      name: "stop",
      description: "Stop a VM",
      options: runtimeOptions,
      handler: async ({ positional, flags, colors }) => {
        const vmId = requirePositional(positional, 0, "VM profile");
        const prepared = await prepareVm(
          vmId,
          flags.path,
          flags.identity,
          false,
        );
        await runVmCommand(vmAdapterCommand(vmId, prepared.profile, "stop"));
        await recordAuditEvent(
          prepared.runtime.config,
          prepared.runtime.idealityHome,
          {
            eventType: "vm.stopped",
            payload: {
              identity: prepared.runtime.resolved.id,
              vm: vmId,
              network: prepared.profile.network,
              action: "stop",
            },
          },
        );
        console.log(colors.green(`Stopped VM '${vmId}'`));
      },
    }),
    defineCommand({
      name: "status",
      description: "Read VM backend status",
      options: runtimeOptions,
      handler: async ({ positional, flags }) => {
        const vmId = requirePositional(positional, 0, "VM profile");
        const prepared = await prepareVm(
          vmId,
          flags.path,
          flags.identity,
          false,
        );
        const result = await runProcess(
          vmAdapterCommand(vmId, prepared.profile, "status"),
          {
            inherit: true,
          },
        );
        process.exitCode = result.exitCode;
        await recordAuditEvent(
          prepared.runtime.config,
          prepared.runtime.idealityHome,
          {
            eventType: "vm.status",
            payload: {
              identity: prepared.runtime.resolved.id,
              vm: vmId,
              network: prepared.profile.network,
              action: "status",
            },
          },
        );
      },
    }),
    defineCommand({
      name: "exec",
      description: "Execute a command in a VM",
      options: runtimeOptions,
      handler: async ({ positional, flags, signal }) => {
        const vmId = requirePositional(positional, 0, "VM profile");
        const prepared = await prepareVm(vmId, flags.path, flags.identity);
        const command = commandArguments(positional, 1);
        if (command.length === 0)
          throw new Error("VM exec requires a command after --");
        await ensureVmRunning(
          vmId,
          prepared.profile,
          prepared.configPath,
          runProcess,
          vmAdapterCommand,
        );
        const workspace = prepared.profile.workspaceTarget ?? "/workspace";
        const env = {
          HOME: process.env.HOME ?? os.homedir(),
          PATH: process.env.PATH ?? "",
          IDEALITY_IDENTITY: prepared.runtime.resolved.id,
          LIMA_SHELLENV_BLOCK: "*",
          LIMA_SHELLENV_ALLOW: "IDEALITY_IDENTITY",
        };
        await runVmCommand(
          vmAdapterCommand(vmId, prepared.profile, "exec", {
            workdir: guestWorkspacePath(prepared.runtime.resolved, workspace),
            command,
          }),
          { env, signal },
        );
        await recordAuditEvent(
          prepared.runtime.config,
          prepared.runtime.idealityHome,
          {
            eventType: "vm.exec",
            payload: {
              identity: prepared.runtime.resolved.id,
              vm: vmId,
              network: prepared.profile.network,
              action: "exec",
            },
          },
        );
      },
    }),
    defineCommand({
      name: "remove",
      description: "Remove an unused VM profile without deleting backend disks",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Confirm removal",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        if (!flags.force) throw new Error("VM removal requires --force");
        const id = requirePositional(positional, 0, "VM profile");
        const config = await loadConfig();
        if (!config.vms?.[id])
          throw new Error(`VM profile '${id}' does not exist`);
        const referenced = Object.values(config.identities).some(
          (identity) =>
            (identity.execution?.target === "vm" &&
              identity.execution.vm === id) ||
            Object.values(identity.tools).some(
              (tool) =>
                tool.execution?.target === "vm" && tool.execution.vm === id,
            ),
        );
        if (referenced)
          throw new Error(`VM profile '${id}' is still referenced`);
        delete config.vms[id];
        await saveConfig(config);
        await recordAuditEvent(config, getIdealityHome(), {
          eventType: "config.changed",
          payload: { action: "vm.remove", scope: id, status: "ok" },
        });
        console.log(colors.green(`Removed VM profile '${id}'`));
      },
    }),
  ],
});

export default vmCommandGroup;
