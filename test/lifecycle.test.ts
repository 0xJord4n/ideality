import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderShim } from "../src/integrations/shims.js";

describe("integration lifecycle commands", () => {
  test("previews a reversible disable without requiring configuration", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-disable-command-"),
    );
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/index.ts", "disable", "--dry-run"],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: path.join(home, ".ideality"),
        SHELL: "/usr/bin/fish",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      shell: {
        type: "fish",
        rc: path.join(home, ".config", "fish", "config.fish"),
      },
      git: path.join(home, ".ideality", "git", "includes.gitconfig"),
      preserved: [
        "audit",
        "bin",
        "completions",
        "config.jsonc",
        "git",
        "history",
        "plugins",
        "profiles",
        "runtime",
        "secrets",
        "shell",
        "ssh",
      ].map((entry) => path.join(home, ".ideality", entry)),
    });
    expect(result.stderr.toString()).toBe("");
  });

  test("disables and re-enables shell and Git integrations end to end", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-lifecycle-command-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const rcPath = path.join(home, ".config", "fish", "config.fish");
    const globalConfig = path.join(home, ".gitconfig");
    const managedGit = path.join(idealityHome, "git", "includes.gitconfig");
    const unrelatedGit = path.join(home, "team.gitconfig");
    await mkdir(path.dirname(rcPath), { recursive: true });
    await mkdir(idealityHome, { recursive: true });
    await mkdir(path.join(idealityHome, "completions"), {
      recursive: true,
    });
    await mkdir(path.join(idealityHome, "git"), { recursive: true });
    await mkdir(path.join(idealityHome, "shell"), { recursive: true });
    await Bun.write(
      path.join(idealityHome, "completions", "ideality.fish"),
      "stale completion\n",
    );
    await Bun.write(managedGit, "# stale git config\n");
    await Bun.write(
      path.join(idealityHome, "shell", "ideality.fish"),
      "stale shell hook\n",
    );
    await Bun.write(
      rcPath,
      [
        "set -gx EDITOR vim",
        "# >>> ideality >>>",
        `source '${path.join(idealityHome, "shell", "ideality.fish")}'`,
        "# <<< ideality <<<",
        "",
      ].join("\n"),
    );
    await Bun.write(
      globalConfig,
      [
        "[include]",
        `\tpath = ${managedGit}`,
        "[include]",
        `\tpath = ${unrelatedGit}`,
        "",
      ].join("\n"),
    );
    await Bun.write(
      path.join(idealityHome, "config.jsonc"),
      `${JSON.stringify(
        {
          version: 1,
          defaultIdentity: "default",
          identities: {
            default: {
              label: "Default",
              roots: [home],
              git: {
                name: "Example Developer",
                email: "developer@example.com",
              },
              tools: { sample: {} },
            },
          },
          tools: {
            sample: {
              executable: "sample",
              isolation: "process",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const environment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      HOME: home,
      IDEALITY_HOME: idealityHome,
      SHELL: "/usr/bin/fish",
    };
    const command = (name: "disable" | "enable", ...args: string[]) =>
      Bun.spawnSync({
        cmd: [process.execPath, "run", "src/index.ts", name, ...args],
        cwd: path.resolve(import.meta.dir, ".."),
        env: environment,
        stdout: "pipe",
        stderr: "pipe",
      });

    const disabled = command("disable");
    expect(disabled.exitCode).toBe(0);
    expect(await Bun.file(rcPath).text()).not.toContain("# >>> ideality >>>");
    const afterDisable = Bun.spawnSync({
      cmd: ["git", "config", "--global", "--get-all", "include.path"],
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(afterDisable.stdout.toString().trim()).toBe(unrelatedGit);
    expect(await Bun.file(managedGit).text()).toBe("# stale git config\n");
    expect(
      await Bun.file(
        path.join(idealityHome, "completions", "ideality.fish"),
      ).text(),
    ).toBe("stale completion\n");
    expect(
      await Bun.file(path.join(idealityHome, "shell", "ideality.fish")).text(),
    ).toBe("stale shell hook\n");

    const disabledAgain = command("disable");
    expect(disabledAgain.exitCode).toBe(0);
    expect(disabledAgain.stdout.toString()).toContain(
      "Shell integration already disabled",
    );
    expect(disabledAgain.stdout.toString()).toContain(
      "Git routing already disabled",
    );

    const enablePreview = command("enable", "--dry-run");
    expect(enablePreview.exitCode).toBe(0);
    expect(JSON.parse(enablePreview.stdout.toString())).toEqual({
      shims: path.join(idealityHome, "bin"),
      shell: { type: "fish", rc: rcPath },
      git: managedGit,
      tools: ["sample"],
    });
    expect(await Bun.file(rcPath).text()).not.toContain("# >>> ideality >>>");
    expect(await Bun.file(managedGit).text()).toBe("# stale git config\n");

    const enabled = command("enable");
    expect(enabled.exitCode).toBe(0);
    expect(enabled.stderr.toString()).toBe("");
    expect(await Bun.file(rcPath).text()).toContain("# >>> ideality >>>");
    expect(
      await Bun.file(
        path.join(idealityHome, "completions", "ideality.fish"),
      ).text(),
    ).toContain("sample");
    expect(
      await Bun.file(path.join(idealityHome, "shell", "ideality.fish")).text(),
    ).toContain("ideality env --shell fish");
    expect(await Bun.file(managedGit).text()).toContain(
      `${path.join(idealityHome, "git", "default.gitconfig")}`,
    );
    expect(
      await Bun.file(path.join(idealityHome, "bin", "sample")).text(),
    ).toBe(renderShim("sample"));
    const afterEnable = Bun.spawnSync({
      cmd: ["git", "config", "--global", "--get-all", "include.path"],
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(afterEnable.stdout.toString().trim().split("\n")).toEqual([
      unrelatedGit,
      managedGit,
    ]);
  }, 20_000);
});
