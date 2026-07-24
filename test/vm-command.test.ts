import { afterEach, describe, expect, mock, test } from "bun:test";

import { vmAdapterCommand } from "../src/core/adapters.js";
import { runProcess } from "../src/core/process.js";
import type {
  IdealityConfig,
  ResolvedIdentity,
  VmProfile,
} from "../src/domain/config.js";

const customVm: VmProfile = {
  driver: "custom",
  start: ["true", "start", "{{config}}"],
  stop: ["true", "stop"],
  status: ["true", "status"],
  exec: ["true", "exec", "{{vm}}", "--", "{{command}}"],
  workspaceTarget: "/guest",
};

const resolved: ResolvedIdentity = {
  id: "sample",
  identity: {
    label: "Sample",
    roots: ["/workspace"],
    tools: {},
  },
  path: "/workspace/project",
  matchedRoot: "/workspace",
  isDefault: true,
};

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "sample",
  identities: {
    sample: resolved.identity,
  },
  tools: {},
  vms: {
    workspace: customVm,
  },
};

afterEach(() => {
  mock.restore();
});

describe("vm command", () => {
  test("preflights exec through the registry VM command builder", async () => {
    let preflightRunner: unknown;
    let preflightCommandBuilder: unknown;
    const executedCommands: string[][] = [];

    mock.module("../src/core/runtime.js", () => ({
      loadRuntime: async () => ({
        config,
        resolved,
        home: "/home/dev",
        idealityHome: "/home/dev/.ideality",
      }),
    }));
    mock.module("../src/core/vm.js", () => ({
      ensureVmRunning: async (
        _vmId: string,
        _profile: VmProfile,
        _configPath: string,
        runner?: unknown,
        commandBuilder?: unknown,
      ) => {
        preflightRunner = runner;
        preflightCommandBuilder = commandBuilder;
      },
      guestWorkspacePath: () => "/guest/project",
      networkDnsServers: () => [],
      runVmCommand: async (command: string[]) => {
        executedCommands.push(command);
        return 0;
      },
      writeVmConfig: async () => "/runtime/workspace.json",
    }));

    const { default: vmCommandGroup } = await import("../src/commands/vm.js");
    const execCommand = vmCommandGroup.commands.find(
      (command: { name: string }) => command.name === "exec",
    );
    if (!execCommand) throw new Error("vm exec command is not registered");

    await (
      execCommand.handler as unknown as (context: {
        positional: string[];
        flags: { path: string; identity?: string };
        signal?: AbortSignal;
      }) => Promise<void>
    )({
      positional: ["workspace", "bun", "test"],
      flags: { path: "/workspace/project", identity: "sample" },
    });

    expect(preflightRunner).toBe(runProcess);
    expect(preflightCommandBuilder).toBe(vmAdapterCommand);
    expect(executedCommands).toEqual([
      ["true", "exec", "workspace", "--", "bun", "test"],
    ]);
  });
});
