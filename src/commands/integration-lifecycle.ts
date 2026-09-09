import os from "node:os";
import path from "node:path";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { snapshotPaths } from "../core/file-transaction.js";
import {
  installCompletion,
  renderCompletion,
} from "../integrations/completion.js";
import { installGitIntegration } from "../integrations/git.js";
import {
  installShellIntegration,
  type SupportedShell,
} from "../integrations/shell.js";
import { installShims } from "../integrations/shims.js";

export interface IntegrationFlags {
  shell: SupportedShell;
  rc?: string;
  "no-shell": boolean;
  "no-git": boolean;
  "dry-run": boolean;
}

export interface IntegrationColors {
  green(value: string): string;
}

export function detectedShell(): SupportedShell {
  const executable = process.env.SHELL ?? "";
  if (executable.endsWith("/bash")) return "bash";
  if (executable.endsWith("/fish")) return "fish";
  return "zsh";
}

export function defaultRc(shell: SupportedShell, home: string): string {
  if (shell === "fish") {
    return path.join(home, ".config", "fish", "config.fish");
  }
  return path.join(home, shell === "bash" ? ".bashrc" : ".zshrc");
}

export async function enableIntegrations(
  flags: IntegrationFlags,
  colors: IntegrationColors,
): Promise<void> {
  const config = await loadConfig();
  const home = os.homedir();
  const idealityHome = getIdealityHome();
  if (flags["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          shims: path.join(idealityHome, "bin"),
          shell: flags["no-shell"]
            ? null
            : {
                type: flags.shell,
                rc: flags.rc ?? defaultRc(flags.shell, home),
              },
          git: flags["no-git"]
            ? null
            : path.join(idealityHome, "git", "includes.gitconfig"),
          tools: Object.keys(config.tools).sort(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const rcPath = flags.rc ?? defaultRc(flags.shell, home);
  const transaction = await snapshotPaths([
    path.join(idealityHome, "bin"),
    path.join(idealityHome, "completions"),
    path.join(idealityHome, "shell"),
    path.join(idealityHome, "git"),
    ...(!flags["no-shell"] ? [rcPath] : []),
  ]);
  try {
    const shims = await installShims(config, idealityHome);
    console.log(
      colors.green(`Tool shims: ${shims.directory} (${shims.tools.length})`),
    );
    if (!flags["no-shell"]) {
      const completion = await installCompletion(
        flags.shell,
        renderCompletion(flags.shell, {
          identities: Object.keys(config.identities).sort(),
          tools: Object.keys(config.tools).sort(),
        }),
        idealityHome,
      );
      console.log(colors.green(`Completion: ${completion}`));
      const installed = await installShellIntegration(
        config,
        flags.shell,
        rcPath,
        idealityHome,
      );
      console.log(colors.green(`Shell hook: ${installed.hookPath}`));
      console.log(`Shell rc:   ${installed.rcPath}`);
    }
    if (!flags["no-git"]) {
      console.log(
        colors.green(
          `Git config: ${await installGitIntegration(config, home, idealityHome)}`,
        ),
      );
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
