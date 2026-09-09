import { describe, expect, test } from "bun:test";
import {
  chmod,
  chown,
  lstat,
  mkdtemp,
  stat,
  symlink,
  utimes,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IdealityConfig } from "../src/domain/config.js";
import {
  collectManagedVariables,
  disableShellIntegration,
  renderShellAssignments,
  renderShellHook,
  shellRcTransactionPaths,
} from "../src/integrations/shell.js";

describe("renderShellAssignments", () => {
  test("quotes values and unsets stale variables for zsh", () => {
    const output = renderShellAssignments(
      {
        IDEALITY_IDENTITY: "personal",
        EXAMPLE_VALUE: "Developer's profile",
      },
      ["OLD_TOKEN"],
      "zsh",
    );

    expect(output).toContain("export EXAMPLE_VALUE='Developer'\\''s profile'");
    expect(output).toContain("unset OLD_TOKEN");
    expect(output).not.toContain("undefined");
  });

  test("does not globally unset variables owned by process-scoped tools", () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "personal",
      identities: {
        personal: {
          label: "Personal",
          roots: ["~/code/personal"],
          tools: {
            gh: { env: { GH_CONFIG_DIR: "~/.config/gh" } },
            editor: { env: { XDG_CONFIG_HOME: "~/.config/editor" } },
          },
        },
      },
      tools: {
        gh: { executable: "gh", isolation: "shell" },
        editor: { executable: "editor", isolation: "process" },
      },
    };

    expect(collectManagedVariables(config)).toEqual([
      "GH_CONFIG_DIR",
      "IDEALITY_IDENTITY",
    ]);
  });

  test("adds the dynamic shim directory without static tool functions", () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "default",
      identities: {
        default: {
          label: "Default",
          roots: ["~/code"],
          tools: { sample: {} },
        },
      },
      tools: {
        sample: {
          executable: "sample",
          isolation: "process",
        },
      },
    };

    const hook = renderShellHook(config, "zsh", "/home/dev/.ideality");

    expect(hook).toContain("export PATH='/home/dev/.ideality/bin':\"$PATH\"");
    expect(hook).not.toContain("sample()");
    expect(hook).toContain("ideality env --shell zsh");
  });
});

describe("disableShellIntegration", () => {
  test("transactions snapshot a symlink target without replacing the symlink", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-transaction-paths-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    const target = path.join(directory, "zshrc-source");
    await Bun.write(target, "export EDITOR=vim\n");
    await symlink(path.basename(target), rcPath);

    expect(await shellRcTransactionPaths(rcPath)).toEqual([
      `${rcPath}.pre-ideality`,
      target,
    ]);
  });

  test("removes only the managed block and preserves the configuration", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-disable-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    await Bun.write(
      rcPath,
      [
        "export EDITOR=vim",
        "",
        "# >>> ideality >>>",
        "source '/home/dev/.ideality/shell/ideality.zsh'",
        "# <<< ideality <<<",
        "",
        "alias ll='ls -la'",
        "",
      ].join("\n"),
    );
    await chmod(rcPath, 0o640);

    const result = await disableShellIntegration(rcPath);
    const content = await Bun.file(rcPath).text();

    expect(result).toEqual({ rcPath, removed: true });
    expect(content).toContain("export EDITOR=vim");
    expect(content).toContain("alias ll='ls -la'");
    expect(content).not.toContain("# >>> ideality >>>");
    expect((await Bun.file(rcPath).stat()).mode & 0o777).toBe(0o640);
  });

  test("is idempotent when the managed block is absent", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-disable-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    await Bun.write(rcPath, "export EDITOR=vim\n");

    const result = await disableShellIntegration(rcPath);

    expect(result).toEqual({ rcPath, removed: false });
    expect(await Bun.file(rcPath).text()).toBe("export EDITOR=vim\n");
  });

  test("preserves a symlinked shell configuration file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-disable-"),
    );
    const target = path.join(directory, "zshrc");
    const rcPath = path.join(directory, ".zshrc");
    await Bun.write(
      target,
      [
        "export EDITOR=vim",
        "# >>> ideality >>>",
        "source '/home/dev/.ideality/shell/ideality.zsh'",
        "# <<< ideality <<<",
        "",
      ].join("\n"),
    );
    await symlink(target, rcPath);

    await disableShellIntegration(rcPath);

    expect((await lstat(rcPath)).isSymbolicLink()).toBe(true);
    expect(await Bun.file(target).text()).toBe("export EDITOR=vim\n\n");
  });

  test.each([
    ["missing end marker", "before\n# >>> ideality >>>\nunrelated\nafter\n"],
    ["missing begin marker", "before\n# <<< ideality <<<\nafter\n"],
    [
      "duplicate marker pairs",
      "before\n# >>> ideality >>>\none\n# <<< ideality <<<\nmiddle\n# >>> ideality >>>\ntwo\n# <<< ideality <<<\nafter\n",
    ],
  ])("fails closed for %s", async (_case, source) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-malformed-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    await Bun.write(rcPath, source);
    await expect(disableShellIntegration(rcPath)).rejects.toThrow(
      "managed block markers",
    );
    expect(await Bun.file(rcPath).text()).toBe(source);
  });

  test("ignores marker text that is not on its own line", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-inline-marker-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    const source = "echo '# >>> ideality >>>'\nexport EDITOR=vim\n";
    await Bun.write(rcPath, source);
    expect(await disableShellIntegration(rcPath)).toEqual({
      rcPath,
      removed: false,
    });
    expect(await Bun.file(rcPath).text()).toBe(source);
  });

  test("preserves timestamps when atomically replacing an rc file", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-metadata-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    await Bun.write(
      rcPath,
      "# >>> ideality >>>\nsource '/tmp/hook'\n# <<< ideality <<<\n",
    );
    const timestamp = new Date("2020-01-02T03:04:05.000Z");
    await utimes(rcPath, timestamp, timestamp);
    await disableShellIntegration(rcPath);
    expect((await stat(rcPath)).mtimeMs).toBe(timestamp.getTime());
  });

  test("refuses to replace an rc file owned by another user", async () => {
    if (process.geteuid?.() !== 0) return;
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shell-owner-"),
    );
    const rcPath = path.join(directory, ".zshrc");
    const source =
      "# >>> ideality >>>\nsource '/tmp/hook'\n# <<< ideality <<<\n";
    await Bun.write(rcPath, source);
    await chown(rcPath, 65534, 65534);
    await expect(disableShellIntegration(rcPath)).rejects.toThrow(
      "owned by another user",
    );
    expect(await Bun.file(rcPath).text()).toBe(source);
  });
});
