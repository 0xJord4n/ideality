import os from "node:os";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getConfigPath, saveConfig } from "../core/config-store.js";
import { createStarterConfig } from "../core/starter.js";
import { generateSshKey } from "../integrations/ssh.js";
import { assertIdentityId, discoverGitIdentity } from "./shared.js";

const initCommand = defineCommand({
  name: "init",
  description: "Create the identity registry",
  options: {
    id: option(z.string().default("personal"), {
      description: "Initial identity ID",
    }),
    label: option(z.string().default("Personal"), {
      description: "Display label",
    }),
    root: option(z.string().default("~/code/personal"), {
      description: "Directory root owned by this identity",
    }),
    "git-name": option(z.string().optional(), {
      description: "Git author name (defaults to global Git config)",
    }),
    "git-email": option(z.string().email().optional(), {
      description: "Git author email (defaults to global Git config)",
    }),
    "generate-ssh": option(z.boolean().default(false), {
      description: "Generate an Ed25519 SSH key",
      argumentKind: "flag",
    }),
    force: option(z.boolean().default(false), {
      short: "f",
      description: "Overwrite an existing registry",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, prompt, colors }) => {
    assertIdentityId(flags.id);
    const configPath = getConfigPath();
    if ((await Bun.file(configPath).exists()) && !flags.force) {
      const confirmed = await prompt.confirm(`Replace ${configPath}?`, {
        default: false,
        fallbackValue: false,
      });
      if (!confirmed) {
        throw new Error("Initialization cancelled");
      }
    }

    const git = discoverGitIdentity(flags["git-name"], flags["git-email"]);
    if (flags["generate-ssh"]) {
      const generated = await generateSshKey({
        identity: flags.id,
        email: git.email,
        home: os.homedir(),
      });
      git.sshKey = generated.privateKey;
    }
    await saveConfig(
      createStarterConfig({
        id: flags.id,
        label: flags.label,
        root: flags.root,
        git,
      }),
    );
    console.log(colors.green(`Created ${configPath}`));
    console.log(`Next: ideality install --shell ${process.env.SHELL?.endsWith("fish") ? "fish" : process.env.SHELL?.endsWith("bash") ? "bash" : "zsh"}`);
  },
});

export default initCommand;
