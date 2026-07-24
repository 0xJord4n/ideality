import { describe, expect, test } from "bun:test";

import {
  ensureVmRunning,
  guestWorkspacePath,
  renderLimaConfig,
  requireLimaV2,
  vmCapability,
  vmCommand,
} from "../src/core/vm.js";
import type { ResolvedIdentity, VmProfile } from "../src/domain/config.js";

const resolved: ResolvedIdentity = {
  id: "sample",
  identity: {
    label: "Sample",
    roots: ["/work/sample"],
    tools: {},
  },
  path: "/work/sample/packages/api",
  matchedRoot: "/work/sample",
  isDefault: false,
};

describe("VM adapters", () => {
  test("renders a least-access Lima profile with mapped workspace", () => {
    const profile: VmProfile = {
      driver: "lima",
      cpus: 4,
      memoryMiB: 8192,
      diskGiB: 60,
      vmType: "vz",
      mountType: "virtiofs",
      workspaceTarget: "/workspace",
      mounts: [
        {
          source: "{{root}}",
          target: "/workspace",
          writable: true,
        },
      ],
      network: "private",
    };
    const config = JSON.parse(
      renderLimaConfig("secure", profile, resolved, {
        home: "/home/user",
        networkDns: ["10.64.0.1"],
      }),
    );
    expect(config.cpus).toBe(4);
    expect(config.vmType).toBe("vz");
    expect(config.base).toEqual(["template:_images/ubuntu"]);
    expect(config.user).toEqual({
      name: "ideality",
      home: "/home/ideality",
    });
    expect(config.propagateProxyEnv).toBe(false);
    expect(config.portForwards[0]).toMatchObject({
      ignore: true,
      guestPortRange: [1, 65535],
    });
    expect(config.mounts).toEqual([
      {
        location: "/work/sample",
        mountPoint: "/workspace",
        writable: true,
      },
    ]);
    expect(config.hostResolver.enabled).toBe(false);
    expect(config.dns).toEqual(["10.64.0.1"]);
  });

  test("disables the host resolver for a per-identity VPN override", () => {
    const config = JSON.parse(
      renderLimaConfig("secure", { driver: "lima" }, resolved, {
        home: "/home/user",
        networkRequired: true,
      }),
    );
    expect(config.hostResolver.enabled).toBe(false);
  });

  test("maps a nested host working directory into the guest", () => {
    expect(guestWorkspacePath(resolved, "/workspace")).toBe(
      "/workspace/packages/api",
    );
  });

  test("builds Lima lifecycle and isolated environment commands", () => {
    const profile: VmProfile = { driver: "lima", instance: "secure" };
    expect(vmCommand("sample", profile, "stop")).toEqual([
      "limactl",
      "stop",
      "secure",
    ]);
    expect(
      vmCommand("sample", profile, "exec", {
        workdir: "/workspace",
        command: ["bun", "test"],
      }),
    ).toEqual([
      "limactl",
      "shell",
      "--start",
      "--preserve-env",
      "--workdir",
      "/workspace",
      "secure",
      "bun",
      "test",
    ]);
  });

  test("reports helper and platform requirements honestly", () => {
    expect(
      vmCapability(
        { driver: "apple-vz" },
        { platform: "linux", hasKvm: false, findExecutable: () => null },
      ),
    ).toMatchObject({ available: false, executable: "ideality-vz-helper" });
    expect(
      vmCapability(
        { driver: "firecracker" },
        {
          platform: "linux",
          hasKvm: false,
          findExecutable: () => "/usr/bin/ideality-firecracker-helper",
        },
      ).detail,
    ).toContain("/dev/kvm");
    expect(
      vmCapability(
        { driver: "cloud-hypervisor" },
        {
          platform: "darwin",
          hasKvm: false,
          findExecutable: () => "/usr/bin/ideality-cloud-hypervisor-helper",
        },
      ).detail,
    ).toContain("Linux");
  });

  test("requires Lima 2 for strict environment filtering", async () => {
    await expect(
      requireLimaV2(async () => ({
        exitCode: 0,
        stdout: "limactl version 1.1.0",
        stderr: "",
      })),
    ).rejects.toThrow("Lima 2.0 or newer");
    await expect(
      requireLimaV2(async () => ({
        exitCode: 0,
        stdout: "limactl version 2.0.3",
        stderr: "",
      })),
    ).resolves.toBeUndefined();
  });

  test("creates a missing Lima instance and resumes a stopped instance", async () => {
    const profile: VmProfile = { driver: "lima", instance: "secure" };
    const missingCommands: string[][] = [];
    await ensureVmRunning("sample", profile, "/tmp/lima.yaml", async (command) => {
      missingCommands.push(command);
      if (command[1] === "--version") {
        return { exitCode: 0, stdout: "limactl version 2.0.0", stderr: "" };
      }
      if (command[1] === "list") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    expect(missingCommands.at(-1)).toEqual([
      "limactl",
      "start",
      "--tty=false",
      "--name",
      "secure",
      "/tmp/lima.yaml",
    ]);

    const stoppedCommands: string[][] = [];
    await ensureVmRunning("sample", profile, "/tmp/lima.yaml", async (command) => {
      stoppedCommands.push(command);
      if (command[1] === "--version") {
        return { exitCode: 0, stdout: "limactl version 2.0.0", stderr: "" };
      }
      if (command[1] === "list") {
        return { exitCode: 0, stdout: "Stopped\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    expect(stoppedCommands.at(-1)).toEqual([
      "limactl",
      "start",
      "--tty=false",
      "secure",
    ]);
  });

  test("does not restart a running Lima instance", async () => {
    const commands: string[][] = [];
    await ensureVmRunning(
      "sample",
      { driver: "lima", instance: "secure" },
      "/tmp/lima.yaml",
      async (command) => {
        commands.push(command);
        return command[1] === "--version"
          ? { exitCode: 0, stdout: "limactl version 2.1.0", stderr: "" }
          : { exitCode: 0, stdout: "Running\n", stderr: "" };
      },
    );
    expect(commands).toHaveLength(2);
  });
});
