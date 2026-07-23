import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { installGitIntegration } from "../integrations/git.js";
import {
  installShellIntegration,
  type SupportedShell,
} from "../integrations/shell.js";

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
  },
  handler: async ({ flags, colors }) => {
    const config = await loadConfig();
    const home = os.homedir();
    const idealityHome = getIdealityHome();
    if (!flags["no-shell"]) {
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
