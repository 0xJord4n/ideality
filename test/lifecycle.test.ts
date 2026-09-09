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

  test("human status reports active VPN and disabled installed tools accurately", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-status-human-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const executable = path.join(home, "sample");
    await Bun.write(executable, "#!/bin/sh\nexit 0\n");
    await Bun.write(
      path.join(idealityHome, "config.jsonc"),
      `${JSON.stringify({
        version: 1,
        defaultIdentity: "default",
        identities: {
          default: {
            label: "Default",
            roots: [home],
            tools: {
              sample: { enabled: false, executable },
            },
          },
        },
        tools: { sample: { executable, isolation: "process" } },
      })}\n`,
    );
    await Bun.write(
      path.join(idealityHome, "runtime", "network-state.json"),
      `${JSON.stringify({
        version: 1,
        profile: "privacy",
        identity: "other",
        driver: "mullvad",
        enforcement: "strict",
        activatedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/index.ts", "status", "-C", home],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: idealityHome,
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("active: privacy (strict)");
    expect(result.stdout.toString()).toContain("disabled");
    expect(result.stdout.toString()).not.toContain("ready");
  });

  test("disable rolls shell changes back when Git removal fails", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-disable-rollback-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const rcPath = path.join(home, ".zshrc");
    const globalConfig = path.join(home, ".gitconfig");
    const source =
      "before\n# >>> ideality >>>\nsource '/tmp/hook'\n# <<< ideality <<<\nafter\n";
    await Bun.write(rcPath, source);
    await Bun.write(globalConfig, "[broken\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/index.ts", "disable", "--rc", rcPath],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: idealityHome,
        GIT_CONFIG_GLOBAL: globalConfig,
        SHELL: "/bin/zsh",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(rcPath).text()).toBe(source);
  });

  test("enable rolls generated files back when Git registration fails", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-enable-rollback-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const rcPath = path.join(home, ".zshrc");
    const globalConfig = path.join(home, ".gitconfig");
    await mkdir(idealityHome, { recursive: true });
    await Bun.write(
      path.join(idealityHome, "config.jsonc"),
      `${JSON.stringify({
        version: 1,
        defaultIdentity: "default",
        identities: { default: { label: "Default", roots: [home], tools: {} } },
        tools: {},
      })}\n`,
    );
    await Bun.write(globalConfig, "[broken\n");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/index.ts", "enable", "--rc", rcPath],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: idealityHome,
        GIT_CONFIG_GLOBAL: globalConfig,
        SHELL: "/bin/zsh",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(rcPath).exists()).toBe(false);
    expect(
      await Bun.file(path.join(idealityHome, "shell", "ideality.zsh")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(
        path.join(idealityHome, "completions", "ideality.zsh"),
      ).exists(),
    ).toBe(false);
  });

  test("disable guidance explains inherited PATH cleanup", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-disable-guidance-"),
    );
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "src/index.ts", "disable", "--no-git"],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: path.join(home, ".ideality"),
        SHELL: "/bin/zsh",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("login shell");
    expect(result.stdout.toString()).toContain("PATH");
    expect(result.stdout.toString()).not.toContain("Open a new zsh session");
  });

  test("init restores prior state when a late integration step fails", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "ideality-init-rollback-"),
    );
    const idealityHome = path.join(home, ".ideality");
    const configPath = path.join(idealityHome, "config.jsonc");
    const rcPath = path.join(home, ".zshrc");
    const globalConfig = path.join(home, ".gitconfig");
    const prior = "prior registry\n";
    await mkdir(idealityHome, { recursive: true });
    await Bun.write(configPath, prior);
    await Bun.write(globalConfig, "[broken\n");
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "run",
        "src/index.ts",
        "init",
        "--non-interactive",
        "--force",
        "--install",
        "--git-name",
        "Example Developer",
        "--git-email",
        "developer@example.com",
        "--root",
        home,
      ],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        ...process.env,
        HOME: home,
        IDEALITY_HOME: idealityHome,
        IDEALITY_CONFIG: configPath,
        GIT_CONFIG_GLOBAL: globalConfig,
        SHELL: "/bin/zsh",
        NO_COLOR: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(await Bun.file(configPath).text()).toBe(prior);
    expect(await Bun.file(rcPath).exists()).toBe(false);
  });
});
