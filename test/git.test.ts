import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IdealityConfig } from "../src/domain/config.js";
import {
  disableGitIntegration,
  renderGitIncludes,
} from "../src/integrations/git.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "personal",
  identities: {
    personal: {
      label: "Personal",
      roots: ["~/code/personal"],
      git: {
        name: "Example Developer",
        email: "developer@example.com",
        sshKey: "~/.ideality/ssh/personal",
      },
      tools: {},
    },
  },
  tools: {},
};

describe("renderGitIncludes", () => {
  test("renders an includeIf entry and identity file without shell interpolation", () => {
    const rendered = renderGitIncludes(
      config,
      "/home/dev",
      "/home/dev/.ideality",
    );

    expect(rendered.includes).toContain(
      '[includeIf "gitdir:/home/dev/code/personal/"]',
    );
    expect(rendered.includes).toContain(
      `path = "/home/dev/.ideality/git/personal.gitconfig"`,
    );
    expect(rendered.identities.personal).toContain(
      `name = "Example Developer"`,
    );
    expect(rendered.identities.personal).toContain(
      `email = "developer@example.com"`,
    );
    expect(rendered.identities.personal).toContain(
      `sshCommand = "ssh -i '/home/dev/.ideality/ssh/personal' -o IdentitiesOnly=yes"`,
    );
  });

  test("quotes Git values and SSH key paths with special characters", async () => {
    const special = structuredClone(config);
    special.identities.personal!.git!.name = "Example # Developer";
    special.identities.personal!.git!.sshKey = "/tmp/key with space";
    const rendered = renderGitIncludes(
      special,
      "/home/dev",
      "/home/dev/.ideality",
    );
    const directory = await mkdtemp(path.join(os.tmpdir(), "ideality-git-"));
    const file = path.join(directory, "identity.gitconfig");
    await Bun.write(file, rendered.identities.personal!);

    const name = Bun.spawnSync([
      "git",
      "config",
      "--file",
      file,
      "--get",
      "user.name",
    ]);
    const ssh = Bun.spawnSync([
      "git",
      "config",
      "--file",
      file,
      "--get",
      "core.sshCommand",
    ]);

    expect(name.stdout.toString().trim()).toBe("Example # Developer");
    expect(ssh.stdout.toString().trim()).toBe(
      "ssh -i '/tmp/key with space' -o IdentitiesOnly=yes",
    );
  });
});

describe("disableGitIntegration", () => {
  test("unregisters only Ideality's global include and is idempotent", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-git-disable-"),
    );
    const idealityHome = path.join(directory, ".ideality");
    const globalConfig = path.join(directory, ".gitconfig");
    const managed = path.join(idealityHome, "git", "includes.gitconfig");
    const unrelated = path.join(directory, "team.gitconfig");
    const environment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
    };
    await Bun.write(
      globalConfig,
      [
        "[include]",
        `\tpath = ${managed}`,
        "[include]",
        `\tpath = ${unrelated}`,
        "",
      ].join("\n"),
    );

    expect(await disableGitIntegration(idealityHome, { environment })).toEqual({
      configPath: managed,
      removed: true,
    });
    expect(await disableGitIntegration(idealityHome, { environment })).toEqual({
      configPath: managed,
      removed: false,
    });

    const remaining = Bun.spawnSync({
      cmd: ["git", "config", "--global", "--get-all", "include.path"],
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(remaining.stdout.toString().trim()).toBe(unrelated);
  });

  test("fails instead of treating Git inspection errors as disabled", async () => {
    await expect(
      disableGitIntegration("/home/dev/.ideality", {
        executable: "/bin/sh",
      }),
    ).rejects.toThrow("Failed to inspect global Git config");
  });

  test("unregisters an equivalent normalized include path", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-git-normalized-disable-"),
    );
    const idealityHome = path.join(directory, ".ideality");
    const globalConfig = path.join(directory, ".gitconfig");
    const managed = path.join(idealityHome, "git", "includes.gitconfig");
    const equivalent = `${path.join(idealityHome, "git")}/../git/includes.gitconfig`;
    const environment = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig };
    await Bun.write(globalConfig, `[include]\n\tpath = ${equivalent}\n`);
    expect(await disableGitIntegration(idealityHome, { environment })).toEqual({
      configPath: managed,
      removed: true,
    });
    expect(await Bun.file(globalConfig).text()).not.toContain(equivalent);
  });
});
