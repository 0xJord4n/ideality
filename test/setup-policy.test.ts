import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import setupCommand from "../src/commands/setup.js";
import type { IdealityConfig } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function config(): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    identities: {
      sample: {
        label: "Sample",
        roots: ["/workspace"],
        tools: {
          gh: {},
          custom: {},
        },
      },
    },
    tools: {
      gh: { executable: "gh", isolation: "process" },
      custom: { executable: "custom-cli", isolation: "process" },
    },
  };
}

async function withIsolatedState<T>(fn: () => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ideality-setup-policy-"));
  temporaryDirectories.push(root);
  const previousConfig = process.env.IDEALITY_CONFIG;
  const previousHome = process.env.IDEALITY_HOME;
  const previousGitConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.IDEALITY_CONFIG = path.join(root, "home", "config.jsonc");
  process.env.IDEALITY_HOME = path.join(root, "home");
  process.env.GIT_CONFIG_GLOBAL = path.join(root, "home", ".gitconfig");
  await mkdir(path.dirname(process.env.IDEALITY_CONFIG), { recursive: true });
  await Bun.write(process.env.IDEALITY_CONFIG, `${JSON.stringify(config())}\n`);
  try {
    return await fn();
  } finally {
    if (previousConfig === undefined) {
      delete process.env.IDEALITY_CONFIG;
    } else {
      process.env.IDEALITY_CONFIG = previousConfig;
    }
    if (previousHome === undefined) {
      delete process.env.IDEALITY_HOME;
    } else {
      process.env.IDEALITY_HOME = previousHome;
    }
    if (previousGitConfig === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previousGitConfig;
    }
  }
}

async function projectWithPolicy(policy: string): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ideality-policy-project-"),
  );
  temporaryDirectories.push(root);
  await mkdir(path.join(root, ".ideality"), { recursive: true });
  await mkdir(path.join(root, ".git"));
  await Bun.write(path.join(root, ".ideality", "policy.jsonc"), policy);
  return root;
}

interface SetupContext {
  flags: Record<string, string | boolean | undefined>;
  terminal: { isInteractive: boolean };
  prompt: Record<string, never>;
  spinner: () => null;
  colors: { green: (text: string) => string; cyan: (text: string) => string };
}

async function runSetup(flags: SetupContext["flags"]): Promise<void> {
  const handler = setupCommand.handler as unknown as (
    context: SetupContext,
  ) => Promise<void>;
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    await handler({
      flags,
      terminal: { isInteractive: false },
      prompt: {},
      spinner: () => null,
      colors: { green: (text) => text, cyan: (text) => text },
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function defaultFlags(projectRoot: string): SetupContext["flags"] {
  return {
    path: projectRoot,
    identity: "sample",
    tools: "custom",
    project: true,
    "local-only": false,
    advanced: false,
    "requirements-only": false,
    vm: undefined,
    network: undefined,
    "non-interactive": true,
    yes: true,
    "dry-run": true,
  };
}

describe("setup policy enforcement", () => {
  test("validates present team policies during dry-run before reporting changes", async () => {
    await withIsolatedState(async () => {
      const projectRoot = await projectWithPolicy(`{
        "version": 1,
        "tools": { "permitted": ["gh"] }
      }`);

      await expect(runSetup(defaultFlags(projectRoot))).rejects.toThrow(
        "Project setup violates team policy",
      );
    });
  });

  test("blocks policy violations before writing local or project config", async () => {
    await withIsolatedState(async () => {
      const projectRoot = await projectWithPolicy(`{
        "version": 1,
        "tools": { "permitted": ["gh"] }
      }`);

      await expect(
        runSetup({ ...defaultFlags(projectRoot), "dry-run": false }),
      ).rejects.toThrow("tools/custom");

      expect(
        await Bun.file(
          path.join(projectRoot, ".ideality", "project.jsonc"),
        ).exists(),
      ).toBe(false);
      expect(await Bun.file(process.env.IDEALITY_CONFIG!).text()).not.toContain(
        projectRoot,
      );
    });
  });

  test("keeps setup dry-run behavior unchanged when no policy is present", async () => {
    await withIsolatedState(async () => {
      const projectRoot = await mkdtemp(
        path.join(os.tmpdir(), "ideality-no-policy-project-"),
      );
      temporaryDirectories.push(projectRoot);
      await mkdir(path.join(projectRoot, ".git"));

      await expect(
        runSetup(defaultFlags(projectRoot)),
      ).resolves.toBeUndefined();
    });
  });

  test("allows an explicitly named one-invocation policy override", async () => {
    await withIsolatedState(async () => {
      const projectRoot = await projectWithPolicy(`{
        "version": 1,
        "tools": { "permitted": ["gh"] }
      }`);

      await expect(
        runSetup({
          ...defaultFlags(projectRoot),
          "allow-policy-violations": true,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
