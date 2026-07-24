import { accessSync, constants } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  NetworkDnsConfig,
  ResolvedIdentity,
  VmProfile,
} from "../domain/config.js";
import { renderTemplate } from "./environment.js";
import {
  type ProcessRunner,
  requireSuccessfulProcess,
  runProcess,
} from "./process.js";
import { findExecutable } from "./runtime.js";

export type VmAction = "start" | "stop" | "status" | "exec";

export interface VmCapabilityOptions {
  platform?: NodeJS.Platform;
  hasKvm?: boolean;
  findExecutable?: typeof findExecutable;
}

export interface VmCapability {
  available: boolean;
  executable: string;
  detail: string;
}

export interface VmCommandOptions {
  configPath?: string;
  workdir?: string;
  command?: string[];
}

export interface LimaConfigOptions {
  home: string;
  idealityHome?: string;
  networkDns?: string[];
  networkRequired?: boolean;
}

export function vmCapability(
  profile: VmProfile,
  options: VmCapabilityOptions = {},
): VmCapability {
  const platform = options.platform ?? process.platform;
  const lookup = options.findExecutable ?? findExecutable;
  const hasKvm = options.hasKvm ?? canAccessKvm(platform);
  let executable: string;
  switch (profile.driver) {
    case "lima":
      executable = "limactl";
      break;
    case "apple-vz":
      executable = profile.helper ?? "ideality-vz-helper";
      break;
    case "cloud-hypervisor":
      executable = profile.helper ?? "ideality-cloud-hypervisor-helper";
      break;
    case "firecracker":
      executable = profile.helper ?? "ideality-firecracker-helper";
      break;
    case "custom":
      executable = profile.start[0]!;
      break;
  }
  const installed = Boolean(lookup(executable));

  if (profile.driver === "apple-vz" && platform !== "darwin") {
    return {
      available: false,
      executable,
      detail: "Apple Virtualization.framework requires macOS",
    };
  }
  if (profile.driver === "firecracker" && platform !== "linux") {
    return {
      available: false,
      executable,
      detail: "Firecracker requires a Linux host",
    };
  }
  if (profile.driver === "cloud-hypervisor" && platform !== "linux") {
    return {
      available: false,
      executable,
      detail: "Cloud Hypervisor requires a Linux host",
    };
  }
  if (
    (profile.driver === "firecracker" ||
      profile.driver === "cloud-hypervisor") &&
    !hasKvm
  ) {
    return {
      available: false,
      executable,
      detail: `${profile.driver} requires accessible hardware virtualization at /dev/kvm`,
    };
  }
  return {
    available: installed,
    executable,
    detail: installed
      ? `${profile.driver} backend is available`
      : `required executable '${executable}' is missing`,
  };
}

function canAccessKvm(platform: NodeJS.Platform): boolean {
  if (platform !== "linux") return false;
  try {
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function renderLimaConfig(
  vmId: string,
  profile: Extract<VmProfile, { driver: "lima" }>,
  resolved: ResolvedIdentity,
  options: LimaConfigOptions,
): string {
  const idealityHome =
    options.idealityHome ?? path.join(options.home, ".ideality");
  const workspaceTarget = profile.workspaceTarget ?? "/workspace";
  const mounts = profile.mounts ?? [
    {
      source: "{{root}}",
      target: workspaceTarget,
      writable: true,
    },
  ];
  const config: Record<string, unknown> = {
    minimumLimaVersion: "2.0.0",
    cpus: profile.cpus ?? 4,
    memory: `${profile.memoryMiB ?? 4096}MiB`,
    disk: `${profile.diskGiB ?? 40}GiB`,
    vmType: profile.vmType ?? "auto",
    mountType: profile.mountType ?? "auto",
    vmOpts: {
      vz: {
        rosetta: {
          enabled: profile.rosetta ?? false,
          binfmt: profile.rosetta ?? false,
        },
      },
    },
    video: { display: profile.video ? "vnc" : "none" },
    mounts: mounts.map((mount) => ({
      location: renderTemplate(
        mount.source,
        resolved,
        options.home,
        idealityHome,
      ),
      mountPoint: mount.target,
      writable: mount.writable ?? false,
    })),
    portForwards: [
      {
        guestIP: "0.0.0.0",
        guestIPMustBeZero: false,
        proto: "any",
        guestPortRange: [1, 65535],
        ignore: true,
      },
    ],
    propagateProxyEnv: false,
    hostResolver: {
      enabled:
        (options.networkRequired ?? Boolean(profile.network)) ? false : true,
    },
    ssh: {
      forwardAgent: false,
      loadDotSSHPubKeys: false,
    },
    user: {
      name: "ideality",
      home: profile.guestHome ?? "/home/ideality",
    },
    containerd: {
      system: false,
      user: false,
    },
  };
  if (profile.image) {
    config.images = [{ location: profile.image }];
  } else {
    config.base = ["template:_images/ubuntu"];
  }
  if (options.networkDns?.length) {
    config.dns = options.networkDns;
  }
  if (profile.provision?.length) {
    config.provision = profile.provision.map((script) => ({
      mode: "system",
      script,
    }));
  }
  config.message = `Ideality VM '${vmId}'`;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function networkDnsServers(dns: NetworkDnsConfig | undefined): string[] {
  return typeof dns === "object" ? dns.servers : [];
}

export function guestWorkspacePath(
  resolved: ResolvedIdentity,
  workspaceTarget: string,
): string {
  const root = resolved.matchedRoot ?? resolved.identity.roots[0]!;
  const relative = path.relative(root, resolved.path);
  if (
    !relative ||
    relative === "." ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return workspaceTarget;
  }
  return path.posix.join(workspaceTarget, ...relative.split(path.sep));
}

export function vmCommand(
  vmId: string,
  profile: VmProfile,
  action: VmAction,
  options: VmCommandOptions = {},
): string[] {
  if (profile.driver === "lima") {
    const instance = profile.instance ?? `ideality-${vmId}`;
    if (action === "start") {
      if (!options.configPath) {
        throw new Error("Lima config path is required to start the VM");
      }
      return [
        "limactl",
        "start",
        "--tty=false",
        "--name",
        instance,
        options.configPath,
      ];
    }
    if (action === "stop") return ["limactl", "stop", instance];
    if (action === "status") {
      return ["limactl", "list", instance, "--format", "{{.Status}}"];
    }
    return [
      "limactl",
      "shell",
      "--start",
      "--preserve-env",
      "--workdir",
      options.workdir ?? profile.workspaceTarget ?? "/workspace",
      instance,
      ...(options.command ?? []),
    ];
  }

  if (profile.driver === "custom") {
    const template =
      action === "start"
        ? profile.start
        : action === "stop"
          ? profile.stop
          : action === "status"
            ? profile.status
            : profile.exec;
    return expandCustomCommand(template, vmId, options);
  }

  const helper =
    profile.helper ??
    (profile.driver === "apple-vz"
      ? "ideality-vz-helper"
      : profile.driver === "cloud-hypervisor"
        ? "ideality-cloud-hypervisor-helper"
        : "ideality-firecracker-helper");
  return [
    helper,
    action,
    "--vm",
    vmId,
    ...(options.configPath ? ["--config", options.configPath] : []),
    ...(options.workdir ? ["--workdir", options.workdir] : []),
    ...(options.command?.length ? ["--", ...options.command] : []),
  ];
}

export async function writeVmConfig(
  vmId: string,
  profile: VmProfile,
  resolved: ResolvedIdentity,
  options: LimaConfigOptions & { networkDns?: string[] },
): Promise<string> {
  const idealityHome =
    options.idealityHome ?? path.join(options.home, ".ideality");
  const directory = path.join(idealityHome, "runtime", "vms", vmId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "lima.yaml");
  const content =
    profile.driver === "lima"
      ? renderLimaConfig(vmId, profile, resolved, options)
      : `${JSON.stringify({ vmId, profile }, null, 2)}\n`;
  await Bun.write(file, content);
  await chmod(file, 0o600);
  return file;
}

export async function runVmCommand(
  command: string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    signal?: AbortSignal;
    inherit?: boolean;
    runner?: ProcessRunner;
  } = {},
): Promise<number> {
  const result = await requireSuccessfulProcess(
    command,
    {
      env: options.env,
      cwd: options.cwd,
      signal: options.signal,
      inherit: options.inherit ?? true,
    },
    options.runner ?? runProcess,
  );
  return result.exitCode;
}

export async function ensureVmRunning(
  vmId: string,
  profile: VmProfile,
  configPath: string,
  runner: ProcessRunner = runProcess,
): Promise<void> {
  if (profile.driver === "lima") {
    await requireLimaV2(runner);
    const status = await runner(vmCommand(vmId, profile, "status"));
    if (status.exitCode === 0 && status.stdout.trim().length > 0) {
      if (status.stdout.trim().toLowerCase() === "running") return;
      await requireSuccessfulProcess(
        [
          "limactl",
          "start",
          "--tty=false",
          profile.instance ?? `ideality-${vmId}`,
        ],
        { inherit: true },
        runner,
      );
      return;
    }
  }
  await requireSuccessfulProcess(
    vmCommand(vmId, profile, "start", { configPath }),
    { inherit: true },
    runner,
  );
}

export async function requireLimaV2(
  runner: ProcessRunner = runProcess,
): Promise<void> {
  const result = await runner(["limactl", "--version"]);
  if (result.exitCode !== 0) {
    throw new Error("Unable to determine the installed Lima version");
  }
  const match = result.stdout.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/);
  if (!match || Number(match[1]) < 2) {
    throw new Error(
      "Lima 2.0 or newer is required for strict guest environment filtering",
    );
  }
}

function expandCustomCommand(
  template: string[],
  vmId: string,
  options: VmCommandOptions,
): string[] {
  const command: string[] = [];
  let inserted = false;
  for (const argument of template) {
    if (argument === "{{command}}") {
      command.push(...(options.command ?? []));
      inserted = true;
    } else {
      command.push(
        argument
          .replaceAll("{{vm}}", vmId)
          .replaceAll("{{workdir}}", options.workdir ?? ""),
      );
    }
  }
  if (options.command?.length && !inserted) command.push(...options.command);
  return command;
}
