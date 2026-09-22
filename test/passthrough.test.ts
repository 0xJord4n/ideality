import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { IdealityConfig } from "../src/domain/config.js";
import { unmatchedMode } from "../src/core/resolution.js";

interface CliContext {
  home: string;
  idealityHome: string;
  configPath: string;
  project: string;
  elsewhere: string;
  bin: string;
}

function baseConfig(home: string, bin: string): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "work",
    identities: {
      work: {
        label: "Work",
        roots: [path.join(home, "project")],
        tools: {
          probe: {},
        },
      },
    },
    tools: {
      probe: {
        executable: path.join(bin, "probe"),
      },
    },
  };
}

async function setup(overrides?: Partial<IdealityConfig>): Promise<CliContext> {
  const home = await mkdtemp(path.join(os.tmpdir(), "ideality-pass-"));
  const idealityHome = path.join(home, ".ideality");
  const configPath = path.join(idealityHome, "config.jsonc");
  const project = path.join(home, "project");
  const elsewhere = path.join(home, "elsewhere");
  const bin = path.join(home, "bin");
  await mkdir(project, { recursive: true });
  await mkdir(elsewhere, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(idealityHome, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({ ...baseConfig(home, bin), ...overrides })}\n`,
  );
  await writeFile(
    path.join(bin, "probe"),
    `#!/bin/sh\necho "AMBIENT=\${PROBE_MARKER:-missing}"\necho "IDENTITY=\${IDEALITY_IDENTITY:-none}"\n`,
    { mode: 0o755 },
  );
  return { home, idealityHome, configPath, project, elsewhere, bin };
}

function runCli(
  context: CliContext,
  args: string[],
  extraEnv: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      PATH: `${context.bin}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: context.home,
      IDEALITY_HOME: context.idealityHome,
      IDEALITY_CONFIG: context.configPath,
      NO_COLOR: "1",
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("unmatched directory passthrough", () => {
  test("unmatchedMode defaults to passthrough", () => {
    const config = baseConfig("/tmp/home", "/tmp/home/bin");
    expect(unmatchedMode(config)).toBe("passthrough");
    expect(
      unmatchedMode({ ...config, routing: { unmatched: "default" } }),
    ).toBe("default");
  });

  test("run execs the real binary with ambient env outside bound roots", async () => {
    const context = await setup();
    const result = runCli(context, ["run", "-C", context.elsewhere, "probe"], {
      PROBE_MARKER: "hello",
      IDEALITY_IDENTITY: "stale",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AMBIENT=hello");
    expect(result.stdout).toContain("IDENTITY=none");
  });

  test("run still applies the identity inside bound roots", async () => {
    const context = await setup();
    const result = runCli(context, ["run", "-C", context.project, "probe"], {
      PROBE_MARKER: "hello",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("AMBIENT=hello");
    expect(result.stdout).toContain("IDENTITY=work");
  });

  test("explicit --identity overrides passthrough outside bound roots", async () => {
    const context = await setup();
    const result = runCli(
      context,
      ["run", "-C", context.elsewhere, "--identity", "work", "probe"],
      { PROBE_MARKER: "hello" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("IDENTITY=work");
  });

  test("routing.unmatched=default restores the default identity fallback", async () => {
    const context = await setup({ routing: { unmatched: "default" } });
    const result = runCli(context, ["run", "-C", context.elsewhere, "probe"], {
      PROBE_MARKER: "hello",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("IDENTITY=work");
  });

  test("env shell output only unsets managed variables outside bound roots", async () => {
    const context = await setup();
    const result = runCli(context, [
      "env",
      "--shell",
      "bash",
      "-C",
      context.elsewhere,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("unset IDEALITY_IDENTITY");
    expect(result.stdout).not.toContain("IDEALITY_IDENTITY=");
  });

  test("status reports passthrough outside bound roots", async () => {
    const context = await setup();
    const result = runCli(context, [
      "status",
      "--json",
      "-C",
      context.elsewhere,
    ]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      identity: string | null;
      passthrough: boolean;
    };
    expect(output.identity).toBeNull();
    expect(output.passthrough).toBe(true);
  });

  test("explain reports passthrough outside bound roots", async () => {
    const context = await setup();
    const result = runCli(context, [
      "explain",
      "probe",
      "--json",
      "-C",
      context.elsewhere,
    ]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as {
      identity: string | null;
      passthrough: boolean;
      executable: string | null;
    };
    expect(output.passthrough).toBe(true);
    expect(output.identity).toBeNull();
    expect(output.executable).toBe(path.join(context.bin, "probe"));
  });
});
