import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import {
  buildChildEnvironment,
  buildEnvironment,
} from "../core/environment.js";
import { resolveExecution } from "../core/execution.js";
import { ensureNetwork } from "../core/network-manager.js";
import { runProcess } from "../core/process.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import {
  ensureVmRunning,
  guestWorkspacePath,
  networkDnsServers,
  vmCapability,
  vmCommand,
  writeVmConfig,
} from "../core/vm.js";
import { commandArguments, requirePositional } from "./shared.js";

const runCommand = defineCommand({
  name: "run",
  alias: "x",
  description: "Run a tool inside its selected identity",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Override folder-based selection",
    }),
    "allow-unverified": option(z.boolean().default(false), {
      description: "Permit a configured VPN without verified leak prevention",
      argumentKind: "flag",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    const tool = requirePositional(positional, 0, "tool name");
    const runtime = await loadRuntime(flags.path, flags.identity);
    const profile = runtime.resolved.identity.tools[tool];
    if (!profile || profile.enabled === false) {
      throw new Error(
        `Tool '${tool}' is not configured for '${runtime.resolved.id}'`,
      );
    }
    const execution = resolveExecution(runtime.config, runtime.resolved, tool);
    if (execution.networkId) {
      await ensureNetwork({
        ...runtime,
        profileId: execution.networkId,
        allowUnverified: flags["allow-unverified"],
      });
    }
    const userArgs = commandArguments(positional, 1);
    if (execution.target === "vm") {
      const vmId = execution.vmId!;
      const vm = execution.vm!;
      const capability = vmCapability(vm);
      if (!capability.available) throw new Error(capability.detail);
      const workspaceTarget = vm.workspaceTarget ?? "/workspace";
      const guestHome = vm.guestHome ?? "/home/ideality";
      const guestRoot = guestWorkspacePath(
        {
          ...runtime.resolved,
          path: runtime.resolved.matchedRoot ?? runtime.resolved.path,
        },
        workspaceTarget,
      );
      const guestCwd = guestWorkspacePath(
        runtime.resolved,
        workspaceTarget,
      );
      const environment = await buildEnvironment(
        runtime.config,
        runtime.resolved,
        {
          home: runtime.home,
          idealityHome: runtime.idealityHome,
          targetHome: guestHome,
          targetIdealityHome: `${guestHome}/.ideality`,
          targetRoot: guestRoot,
          tool,
        },
      );
      const executable =
        profile.executable ?? runtime.config.tools[tool]?.executable;
      if (!executable) {
        throw new Error(`Executable for tool '${tool}' is not configured`);
      }
      const configPath = await writeVmConfig(
        vmId,
        vm,
        runtime.resolved,
        {
          home: runtime.home,
          idealityHome: runtime.idealityHome,
          networkDns: networkDnsServers(execution.network?.dns),
          networkRequired: Boolean(execution.networkId),
        },
      );
      await ensureVmRunning(vmId, vm, configPath);
      const hostEnv: Record<string, string> = {};
      for (const name of [
        "HOME",
        "PATH",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "LIMA_HOME",
        "SSH_AUTH_SOCK",
      ]) {
        const value = process.env[name];
        if (value !== undefined) hostEnv[name] = value;
      }
      Object.assign(hostEnv, environment.values, {
        LIMA_SHELLENV_BLOCK: "*",
        LIMA_SHELLENV_ALLOW: Object.keys(environment.values).join(","),
      });
      for (const name of environment.unset) delete hostEnv[name];
      const result = await runProcess(
        vmCommand(vmId, vm, "exec", {
          workdir: guestCwd,
          command: [executable, ...environment.args, ...userArgs],
        }),
        {
          env: hostEnv,
          inherit: true,
          signal,
        },
      );
      process.exitCode = result.exitCode;
      return;
    }
    const environment = await buildEnvironment(runtime.config, runtime.resolved, {
      home: runtime.home,
      idealityHome: runtime.idealityHome,
      tool,
    });
    const executable = resolveExecutable(
      runtime.config,
      tool,
      profile?.executable,
    );
    if (!executable) {
      throw new Error(`Executable for tool '${tool}' is not installed`);
    }
    const childEnv = buildChildEnvironment(runtime.config, environment);
    const child = Bun.spawn([executable, ...environment.args, ...userArgs], {
      cwd: flags.path,
      env: childEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      signal,
    });
    process.exitCode = await child.exited;
  },
});

export default runCommand;
