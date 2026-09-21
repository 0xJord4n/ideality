import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDoctor } from "../src/core/doctor.js";
import {
  clearLocalGitIdentity,
  resolveEffectiveGitIdentity,
} from "../src/integrations/git.js";
import type { IdealityConfig } from "../src/domain/config.js";

describe("doctor", () => {
  test("recognizes an existing identity root directory", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-"));
    const root = path.join(home, "code", "personal");
    await mkdir(root, { recursive: true });
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "personal",
      identities: {
        personal: {
          label: "Personal",
          roots: ["~/code/personal"],
          tools: {},
        },
      },
      tools: {},
    };

    const checks = await runDoctor(config, home);

    expect(checks).toContainEqual({
      status: "pass",
      subject: root,
      message: "owned by personal",
    });
  });

  test("resolves secret files under a custom ideality home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-home-"));
    const idealityHome = await mkdtemp(
      path.join(os.tmpdir(), "ideality-doctor-state-"),
    );
    const root = path.join(home, "code", "sample");
    const secret = path.join(idealityHome, "secrets", "sample", "token");
    await mkdir(root, { recursive: true });
    await mkdir(path.dirname(secret), { recursive: true });
    await Bun.write(secret, "value");
    await chmod(secret, 0o600);
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: {
          label: "Sample",
          roots: [root],
          tools: {
            demo: {
              env: {
                DEMO_TOKEN: {
                  from: "file",
                  path: "{{idealityHome}}/secrets/{{identity}}/token",
                },
              },
            },
          },
        },
      },
      tools: {
        demo: { executable: "missing-demo-executable" },
      },
    };

    const checks = await runDoctor(config, home, idealityHome);

    expect(checks).toContainEqual({
      status: "pass",
      subject: "sample/demo:DEMO_TOKEN",
      message: "secret file present (600)",
    });
  });

  test("fails when canonical roots owned by different identities overlap", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-overlap-"),
    );
    const canonicalHome = path.join(temporaryDirectory, "canonical-home");
    const home = path.join(temporaryDirectory, "linked-home");
    await mkdir(canonicalHome);
    await symlink(canonicalHome, home, "dir");
    const parent = path.join(home, "code", "sample");
    const child = path.join(parent, "nested");
    await mkdir(child, { recursive: true });
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "first",
      identities: {
        first: { label: "First", roots: [parent], tools: {} },
        second: { label: "Second", roots: [child], tools: {} },
      },
      tools: {},
    };
    const checks = await runDoctor(config, home, path.join(home, ".ideality"));
    const canonicalParent = await realpath(parent);
    const canonicalChild = await realpath(child);
    expect(checks).toContainEqual({
      status: "fail",
      subject: "first/second:roots",
      message: `canonical roots overlap: ${canonicalParent} and ${canonicalChild}`,
    });
  });

  test("warns when the shim directory is shadowed by an earlier PATH entry", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-path-"));
    const idealityHome = path.join(home, ".ideality");
    const earlier = path.join(home, "earlier");
    const root = path.join(home, "code");
    await mkdir(root, { recursive: true });
    await mkdir(earlier, { recursive: true });
    await mkdir(path.join(idealityHome, "bin"), { recursive: true });
    await Bun.write(path.join(earlier, "sample"), "#!/bin/sh\nexit 0\n");
    await chmod(path.join(earlier, "sample"), 0o755);
    await Bun.write(
      path.join(idealityHome, "bin", "sample"),
      "#!/bin/sh\nexit 0\n",
    );
    await chmod(path.join(idealityHome, "bin", "sample"), 0o755);
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: { label: "Sample", roots: [root], tools: { sample: {} } },
      },
      tools: { sample: { executable: "sample" } },
    };
    const previousPath = process.env.PATH;
    process.env.PATH = `${earlier}${path.delimiter}${path.join(idealityHome, "bin")}`;
    try {
      const checks = await runDoctor(config, home, idealityHome);
      expect(checks).toContainEqual({
        status: "warn",
        subject: "shim-path",
        message: `${path.join(idealityHome, "bin")} is shadowed by ${earlier} in PATH; re-source the shell hook so shims come first (ideality install)`,
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("fails when a repo-local Git author overrides the identity profile", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-git-"));
    const idealityHome = path.join(home, ".ideality");
    const repo = path.join(home, "repo");
    await mkdir(path.join(idealityHome, "git"), { recursive: true });
    const globalConfig = path.join(home, ".gitconfig");
    const managed = path.join(idealityHome, "git", "includes.gitconfig");
    const identityFile = path.join(idealityHome, "git", "sample.gitconfig");
    await Bun.write(
      identityFile,
      '[user]\n\tname = "Profile User"\n\temail = "profile@example.com"\n',
    );
    await Bun.write(
      managed,
      `# Generated by ideality. Do not edit.\n\n[includeIf "gitdir:${repo}/"]\n\tpath = "${identityFile}"\n`,
    );
    await Bun.write(globalConfig, `[include]\n\tpath = ${managed}\n`);
    const environment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: path.join(home, "empty.gitconfig"),
    };
    await Bun.write(environment.GIT_CONFIG_SYSTEM!, "");
    const init = Bun.spawnSync({
      cmd: ["git", "init", repo],
      env: environment,
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(init.exitCode).toBe(0);
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: {
          label: "Sample",
          roots: [repo],
          git: { name: "Profile User", email: "profile@example.com" },
          tools: {},
        },
      },
      tools: {},
    };

    const clean = resolveEffectiveGitIdentity(repo, { environment });
    expect(clean.overridden).toBe(false);
    expect(clean.name?.value).toBe("Profile User");

    Bun.spawnSync({
      cmd: ["git", "-C", repo, "config", "user.name", "Local User"],
      env: environment,
      stdout: "ignore",
      stderr: "ignore",
    });
    const dirty = resolveEffectiveGitIdentity(repo, { environment });
    expect(dirty.overridden).toBe(true);
    expect(dirty.name?.value).toBe("Local User");

    const cleared = clearLocalGitIdentity(repo, { environment });
    expect(cleared.cleared).toEqual(["user.name (local:file:.git/config)"]);
    const repaired = resolveEffectiveGitIdentity(repo, { environment });
    expect(repaired.overridden).toBe(false);
    expect(repaired.name?.value).toBe("Profile User");

    const previousCwd = process.cwd();
    process.chdir(repo);
    try {
      const checks = await runDoctor(config, home, idealityHome, {
        gitEnvironment: environment as Record<string, string | undefined>,
      });
      expect(
        checks.find((check) => check.subject === "git:identity")?.status,
      ).toBe("pass");
    } finally {
      process.chdir(previousCwd);
    }
  });
});
