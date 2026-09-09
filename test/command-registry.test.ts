import { describe, expect, test } from "bun:test";
import { defineCommand } from "@bunli/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  commandsForInvocation,
  IDEALITY_COMMAND_REGISTRY,
  type LazyCommandRegistration,
} from "../src/command-registry.js";

function registrations() {
  const loaded: string[] = [];
  const registry: LazyCommandRegistration[] = ["status", "env", "tui"].map(
    (name) => ({
      name,
      description: `${name} description`,
      aliases: name === "status" ? ["whoami", "current"] : [],
      load: async () => {
        loaded.push(name);
        return defineCommand({
          name,
          description: `${name} description`,
          handler: async () => {},
        });
      },
    }),
  );
  return { loaded, registry };
}

describe("commandsForInvocation", () => {
  test("loads only the selected top-level command", async () => {
    const { loaded, registry } = registrations();

    const commands = await commandsForInvocation(
      ["--format", "json", "status", "--json"],
      registry,
    );

    expect(commands.map((command) => command.name)).toEqual(["status"]);
    expect(loaded).toEqual(["status"]);
  });

  test("resolves aliases without loading unrelated commands", async () => {
    const { loaded, registry } = registrations();

    const commands = await commandsForInvocation(["whoami"], registry);

    expect(commands.map((command) => command.name)).toEqual(["status"]);
    expect(loaded).toEqual(["status"]);
  });

  test("does not load commands for the version fast path", async () => {
    const { loaded, registry } = registrations();

    expect(
      await commandsForInvocation(["status", "--version"], registry),
    ).toEqual([]);
    expect(loaded).toEqual([]);
  });

  test("uses lightweight metadata for root help without loading handlers", async () => {
    for (const argv of [[], ["--help"]]) {
      const { loaded, registry } = registrations();
      const commands = await commandsForInvocation(argv, registry);
      expect(commands.map((command) => command.name)).toEqual([
        "status",
        "env",
        "tui",
      ]);
      expect(commands.map((command) => command.description)).toEqual([
        "status description",
        "env description",
        "tui description",
      ]);
      expect(loaded).toEqual([]);
    }
  });

  test("loads complete commands for generated manifests", async () => {
    for (const argv of [["--llms"], ["--llms-full"]]) {
      const { loaded, registry } = registrations();
      await commandsForInvocation(argv, registry);
      expect(loaded).toEqual(["status", "env", "tui"]);
    }
  });

  test("uses metadata for unknown-command suggestions", async () => {
    const { loaded, registry } = registrations();

    await commandsForInvocation(["statsu"], registry);

    expect(loaded).toEqual([]);
  });

  test("keeps lightweight metadata aligned with command modules", async () => {
    for (const registration of IDEALITY_COMMAND_REGISTRY) {
      const command = await registration.load();
      expect({
        name: registration.name,
        description: registration.description,
        aliases: registration.aliases,
      }).toEqual({
        name: command.name,
        description: command.description,
        aliases:
          typeof command.alias === "string"
            ? [command.alias]
            : (command.alias ?? []),
      });
    }
  });
});

describe("non-TUI startup boundary", () => {
  test.each([
    { label: "version", args: ["--version"] },
    { label: "root help", args: ["--help"] },
    { label: "command help", args: ["status", "--help"] },
  ])("does not evaluate TUI dependencies for $label", ({ args }) => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        resolve(import.meta.dir, "fixtures/block-tui-dependencies.ts"),
        resolve(import.meta.dir, "../src/index.ts"),
        ...args,
      ],
      {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
        stdout: "ignore",
        stderr: "pipe",
      },
    );

    expect(result.stderr.toString()).not.toContain(
      "Unexpected TUI dependency evaluation",
    );
    expect(result.exitCode).toBe(0);
  });

  test("loads TUI dependencies only when the TUI command is selected", () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        resolve(import.meta.dir, "fixtures/block-tui-dependencies.ts"),
        resolve(import.meta.dir, "../src/index.ts"),
        "tui",
        "--help",
      ],
      {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, CI: "1", NO_COLOR: "1" },
        stdout: "ignore",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "Unexpected TUI dependency evaluation",
    );
  });

  test("does not evaluate TUI dependencies for normal commands", async () => {
    const home = await mkdtemp(resolve(tmpdir(), "ideality-lazy-startup-"));
    const preload = resolve(
      import.meta.dir,
      "fixtures/block-tui-dependencies.ts",
    );
    const entrypoint = resolve(import.meta.dir, "../src/index.ts");
    const env = {
      ...process.env,
      CI: "1",
      HOME: home,
      IDEALITY_HOME: resolve(home, ".ideality"),
      NO_COLOR: "1",
    };
    try {
      for (const args of [
        [
          "init",
          "--non-interactive",
          "--git-name",
          "Lazy Test",
          "--git-email",
          "lazy@example.com",
          "--force",
        ],
        ["status", "--json"],
        ["env", "--json"],
      ]) {
        const result = Bun.spawnSync(
          [process.execPath, "--preload", preload, entrypoint, ...args],
          { cwd: home, env, stdout: "ignore", stderr: "pipe" },
        );
        expect(result.stderr.toString()).not.toContain(
          "Unexpected TUI dependency evaluation",
        );
        expect(result.exitCode).toBe(0);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
