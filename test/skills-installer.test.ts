import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  buildSkillsInstallCommand,
  IDEALITY_SKILLS_SOURCE,
  installAgentSkills,
  resolveSkillsRunner,
} from "../src/core/agent-skills.js";
import type { ProcessRunner } from "../src/core/process.js";

describe("Vercel Skills installer", () => {
  test("prefers bunx and falls back to npx when runner selection is automatic", () => {
    const bunxFirst = (command: string): string | null =>
      command === "bunx" ? "/usr/local/bin/bunx" : "/usr/local/bin/npx";
    const npxOnly = (command: string): string | null =>
      command === "npx" ? "/usr/bin/npx" : null;

    expect(resolveSkillsRunner("auto", bunxFirst)).toEqual({
      executable: "/usr/local/bin/bunx",
      runner: "bunx",
    });
    expect(resolveSkillsRunner("auto", npxOnly)).toEqual({
      executable: "/usr/bin/npx",
      runner: "npx",
    });
  });

  test("fails clearly when the requested package runner is unavailable", () => {
    expect(() => resolveSkillsRunner("bunx", () => null)).toThrow(
      "bunx is not installed",
    );
    expect(() => resolveSkillsRunner("auto", () => null)).toThrow(
      "Install Bun (bunx) or Node.js (npx)",
    );
  });

  test("builds an argv-only Vercel Skills command with explicit selections", () => {
    expect(
      buildSkillsInstallCommand(
        {
          agents: ["codex", "claude-code"],
          copy: true,
          global: true,
          skills: ["ideality-getting-started", "ideality-troubleshooting"],
          yes: true,
        },
        { executable: "/usr/bin/npx", runner: "npx" },
      ),
    ).toEqual([
      "/usr/bin/npx",
      "skills",
      "add",
      IDEALITY_SKILLS_SOURCE,
      "--skill",
      "ideality-getting-started",
      "--skill",
      "ideality-troubleshooting",
      "--agent",
      "codex",
      "--agent",
      "claude-code",
      "--global",
      "--copy",
      "--yes",
    ]);
  });

  test("supports listing and installing every skill through bunx", () => {
    expect(
      buildSkillsInstallCommand(
        { list: true },
        { executable: "/usr/local/bin/bunx", runner: "bunx" },
      ),
    ).toEqual([
      "/usr/local/bin/bunx",
      "skills",
      "add",
      IDEALITY_SKILLS_SOURCE,
      "--list",
    ]);
    expect(
      buildSkillsInstallCommand(
        { all: true },
        { executable: "/usr/local/bin/bunx", runner: "bunx" },
      ),
    ).toEqual([
      "/usr/local/bin/bunx",
      "skills",
      "add",
      IDEALITY_SKILLS_SOURCE,
      "--all",
    ]);
  });

  test("executes without a shell and propagates installer failures", async () => {
    const commands: string[][] = [];
    const runner: ProcessRunner = async (command, options) => {
      commands.push(command);
      expect(options?.inherit).toBe(true);
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const result = await installAgentSkills(
      { runner: "npx", skills: ["ideality-identities"] },
      {
        findExecutable: () => "/usr/bin/npx",
        runProcess: runner,
      },
    );
    expect(result.command).toEqual([
      "/usr/bin/npx",
      "skills",
      "add",
      IDEALITY_SKILLS_SOURCE,
      "--skill",
      "ideality-identities",
    ]);
    expect(commands).toEqual([result.command]);

    await expect(
      installAgentSkills(
        { runner: "npx" },
        {
          findExecutable: () => "/usr/bin/npx",
          runProcess: async () => ({
            exitCode: 9,
            stdout: "",
            stderr: "installer failed",
          }),
        },
      ),
    ).rejects.toThrow("Vercel Skills installer exited with code 9");
  });

  test("dry-run resolves and returns argv without executing", async () => {
    let executed = false;
    const result = await installAgentSkills(
      { dryRun: true, list: true, runner: "bunx" },
      {
        findExecutable: () => "/usr/bin/bunx",
        runProcess: async () => {
          executed = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );
    expect(result.executed).toBe(false);
    expect(result.command).toEqual([
      "/usr/bin/bunx",
      "skills",
      "add",
      IDEALITY_SKILLS_SOURCE,
      "--list",
    ]);
    expect(executed).toBe(false);
  });

  test("CLI preserves repeated skill and agent selections", () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        path.join(repoRoot, "src/index.ts"),
        "skills",
        "install",
        "--runner",
        "bunx",
        "--skill",
        "ideality-getting-started",
        "--skill",
        "ideality-troubleshooting",
        "--agent",
        "codex",
        "--agent",
        "claude-code",
        "--dry-run",
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(result.exitCode).toBe(0);
    expect(output).toContain(
      '"--skill" "ideality-getting-started" "--skill" "ideality-troubleshooting"',
    );
    expect(output).toContain('"--agent" "codex" "--agent" "claude-code"');
  });
});
