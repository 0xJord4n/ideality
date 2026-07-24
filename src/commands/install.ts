import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
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

function defaultRc(shell: SupportedShell, home: string): string {
  if (shell === "fish") {
    return path.join(home, ".config", "fish", "config.fish");
  }
  return path.join(home, shell === "bash" ? ".bashrc" : ".zshrc");
}

const installCommand = defineCommand({
  name: "install",
  description: "Install shell and Git integrations",
  options: {
    shell: option(z.enum(["zsh", "bash", "fish"]).default("zsh"), {
      description: "Shell integration to install",
    }),
    rc: option(z.string().optional(), {
      description: "Override shell rc file",
    }),
    "no-shell": option(z.boolean().default(false), {
      description: "Skip shell integration",
      argumentKind: "flag",
    }),
    "no-git": option(z.boolean().default(false), {
      description: "Skip Git includeIf integration",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description: "Show installation targets without writing files",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, colors }) => {
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
              : path.join(idealityHome, "git", "config"),
            tools: Object.keys(config.tools).sort(),
          },
          null,
          2,
        ),
      );
      return;
    }
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
        flags.rc ?? defaultRc(flags.shell, home),
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
  },
});

export default installCommand;
