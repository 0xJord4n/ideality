import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import initCommand from "../src/commands/init.js";

const repoRoot = path.resolve(import.meta.dir, "..");

describe("ideality init", () => {
  test("uses the current directory as the first identity root", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "ideality-init-"));
    const idealityHome = path.join(project, ".test-ideality-home");
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        path.join(repoRoot, "src", "index.ts"),
        "init",
        "--non-interactive",
        "--dry-run",
        "--git-name",
        "Example Developer",
        "--git-email",
        "developer@example.com",
      ],
      cwd: project,
      env: {
        ...process.env,
        HOME: project,
        IDEALITY_HOME: idealityHome,
        IDEALITY_CONFIG: path.join(idealityHome, "config.jsonc"),
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout.toString()) as {
      config: {
        defaultIdentity: string;
        identities: Record<string, { roots: string[] }>;
      };
    };
    expect(
      output.config.identities[output.config.defaultIdentity]?.roots,
    ).toEqual([project]);
  });

  test("keeps recommended setup short and asks for missing Git identity", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "ideality-init-"));
    const originalEnvironment = {
      HOME: process.env.HOME,
      IDEALITY_CONFIG: process.env.IDEALITY_CONFIG,
      IDEALITY_HOME: process.env.IDEALITY_HOME,
    };
    process.env.HOME = project;
    process.env.IDEALITY_HOME = path.join(project, ".ideality");
    process.env.IDEALITY_CONFIG = path.join(
      process.env.IDEALITY_HOME,
      "config.jsonc",
    );

    const textPrompts: string[] = [];
    const selectPrompts: string[] = [];
    const reviewNotes: string[] = [];
    const log = spyOn(console, "log").mockImplementation(() => {});
    const gitConfig = spyOn(Bun, "spawnSync").mockImplementation(
      () =>
        ({
          exitCode: 1,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
        }) as never,
    );
    try {
      await initCommand.handler!({
        flags: {
          id: undefined,
          label: "Default",
          root: undefined,
          "git-name": undefined,
          "git-email": undefined,
          "ssh-key": undefined,
          "generate-ssh": false,
          packs: undefined,
          tools: undefined,
          install: false,
          shell: "zsh",
          "no-shell": false,
          "no-git": false,
          interactive: true,
          "non-interactive": false,
          force: false,
          "dry-run": true,
        },
        terminal: { isInteractive: true },
        prompt: {
          intro: () => {},
          note: (message: string, title?: string) => {
            if (title === "Review") reviewNotes.push(message);
          },
          text: async (label: string, options: { default?: string } = {}) => {
            textPrompts.push(label);
            if (label === "Git author name") return "Example Developer";
            if (label === "Git author email") return "developer@example.com";
            return options.default ?? "";
          },
          select: async (label: string) => {
            selectPrompts.push(label);
            return "recommended";
          },
          multiselect: async () => {
            throw new Error(
              "Recommended setup must not open tool or integration selectors",
            );
          },
          filter: async () => {
            throw new Error(
              "Recommended setup must not open the SSH key selector",
            );
          },
          confirm: async () => true,
          cancel: () => {},
        },
        spinner: () => {
          throw new Error("Dry-run must not start a spinner");
        },
        colors: {},
      } as never);
    } finally {
      gitConfig.mockRestore();
      log.mockRestore();
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(textPrompts).toEqual([
      "Identity name",
      "Folder for this identity",
      "Git author name",
      "Git author email",
    ]);
    expect(selectPrompts).toEqual(["Setup"]);
    expect(reviewNotes).toHaveLength(1);
    expect(reviewNotes[0]).toContain("Automatic switching: enabled");
    expect(reviewNotes[0]).not.toContain("SSH:");
    expect(reviewNotes[0]).not.toContain("Packs:");
    expect(reviewNotes[0]).not.toContain("Tools:");
    expect(reviewNotes[0]).not.toContain("Integrations:");
  });

  test("keeps detailed choices available through advanced setup", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "ideality-init-"));
    const originalEnvironment = {
      HOME: process.env.HOME,
      IDEALITY_CONFIG: process.env.IDEALITY_CONFIG,
      IDEALITY_HOME: process.env.IDEALITY_HOME,
    };
    process.env.HOME = project;
    process.env.IDEALITY_HOME = path.join(project, ".ideality");
    process.env.IDEALITY_CONFIG = path.join(
      process.env.IDEALITY_HOME,
      "config.jsonc",
    );

    const selectPrompts: string[] = [];
    const multiselectPrompts: string[] = [];
    const reviewNotes: string[] = [];
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await initCommand.handler!({
        flags: {
          id: undefined,
          label: "Work",
          root: undefined,
          "git-name": "Example Developer",
          "git-email": "developer@example.com",
          "ssh-key": undefined,
          "generate-ssh": false,
          packs: undefined,
          tools: undefined,
          install: false,
          shell: "zsh",
          "no-shell": false,
          "no-git": false,
          interactive: true,
          "non-interactive": false,
          force: false,
          "dry-run": true,
        },
        terminal: { isInteractive: true },
        prompt: {
          intro: () => {},
          note: (message: string, title?: string) => {
            if (title === "Review") reviewNotes.push(message);
          },
          text: async (label: string, options: { default?: string } = {}) => {
            if (label === "Git author name") return "Example Developer";
            if (label === "Git author email") return "developer@example.com";
            return options.default ?? "";
          },
          select: async (label: string) => {
            selectPrompts.push(label);
            if (label === "Setup") return "advanced";
            if (label === "SSH authentication") return "agent";
            if (label === "Shell") return "zsh";
            throw new Error(`Unexpected select prompt: ${label}`);
          },
          multiselect: async (label: string) => {
            multiselectPrompts.push(label);
            if (label === "Tool packs") return ["essentials"];
            if (label === "Tools enabled for this identity") return ["gh"];
            if (label === "Install integrations") return ["shell", "git"];
            throw new Error(`Unexpected multiselect prompt: ${label}`);
          },
          filter: async () => {
            throw new Error("SSH agent mode must not open the key selector");
          },
          confirm: async () => true,
          cancel: () => {},
        },
        spinner: () => {
          throw new Error("Dry-run must not start a spinner");
        },
        colors: {},
      } as never);
    } finally {
      log.mockRestore();
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(selectPrompts).toEqual(["Setup", "SSH authentication", "Shell"]);
    expect(multiselectPrompts).toEqual([
      "Tool packs",
      "Tools enabled for this identity",
      "Install integrations",
    ]);
    expect(reviewNotes).toHaveLength(1);
    expect(reviewNotes[0]).toContain("SSH:  agent");
    expect(reviewNotes[0]).toContain("Packs: essentials");
    expect(reviewNotes[0]).toContain("Tools: gh");
    expect(reviewNotes[0]).toContain("Integrations: shell, git");
  });
});
