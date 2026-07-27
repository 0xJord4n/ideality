import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome } from "../core/config-store.js";
import {
  disableGitIntegration,
  gitIntegrationPath,
} from "../integrations/git.js";
import { disableShellIntegration } from "../integrations/shell.js";
import { defaultRc, detectedShell } from "./integration-lifecycle.js";

const disableCommand = defineCommand({
  name: "disable",
  description: "Disable shell shims and Git routing without deleting config",
  options: {
    shell: option(z.enum(["zsh", "bash", "fish"]).default(detectedShell()), {
      description: "Shell integration to disable",
    }),
    rc: option(z.string().optional(), {
      description: "Override shell rc file",
    }),
    "no-shell": option(z.boolean().default(false), {
      description: "Keep shell integration enabled",
      argumentKind: "flag",
    }),
    "no-git": option(z.boolean().default(false), {
      description: "Keep Git includeIf integration enabled",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description: "Show integrations that would be disabled",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, colors }) => {
    const home = os.homedir();
    const idealityHome = getIdealityHome();
    const rcPath = flags.rc ?? defaultRc(flags.shell, home);

    if (flags["dry-run"]) {
      console.log(
        JSON.stringify(
          {
            shell: flags["no-shell"] ? null : { type: flags.shell, rc: rcPath },
            git: flags["no-git"] ? null : gitIntegrationPath(idealityHome),
            preserved: [
              path.join(idealityHome, "audit"),
              path.join(idealityHome, "bin"),
              path.join(idealityHome, "completions"),
              path.join(idealityHome, "config.jsonc"),
              path.join(idealityHome, "git"),
              path.join(idealityHome, "history"),
              path.join(idealityHome, "plugins"),
              path.join(idealityHome, "profiles"),
              path.join(idealityHome, "runtime"),
              path.join(idealityHome, "secrets"),
              path.join(idealityHome, "shell"),
              path.join(idealityHome, "ssh"),
            ],
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!flags["no-shell"]) {
      const shell = await disableShellIntegration(rcPath);
      console.log(
        shell.removed
          ? colors.green(`Shell integration disabled: ${shell.rcPath}`)
          : colors.dim(`Shell integration already disabled: ${shell.rcPath}`),
      );
    }
    if (!flags["no-git"]) {
      const git = await disableGitIntegration(idealityHome);
      console.log(
        git.removed
          ? colors.green(`Git routing disabled: ${git.configPath}`)
          : colors.dim(`Git routing already disabled: ${git.configPath}`),
      );
    }

    console.log(colors.green(`Configuration preserved: ${idealityHome}`));
    if (!flags["no-shell"]) {
      console.log(
        `Open a new ${flags.shell} session to stop using the current shell hooks and shims.`,
      );
    }
    console.log("Re-enable later with: ideality enable");
  },
});

export default disableCommand;
