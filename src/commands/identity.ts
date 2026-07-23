import os from "node:os";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { expandHome } from "../core/resolution.js";
import { createToolProfiles } from "../core/starter.js";
import { installGitIntegration } from "../integrations/git.js";
import { generateSshKey } from "../integrations/ssh.js";
import {
  assertIdentityId,
  discoverGitIdentity,
  printJson,
  requirePositional,
} from "./shared.js";

async function saveAndSync(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  await saveConfig(config);
  await installGitIntegration(config, os.homedir(), getIdealityHome());
}

const identityCommand = defineGroup({
  name: "identity",
  alias: "id",
  description: "Create and manage identities",
  commands: [
    defineCommand({
      name: "list",
      description: "List identities",
      handler: async ({ colors }) => {
        const config = await loadConfig();
        for (const [id, identity] of Object.entries(config.identities)) {
          const marker = id === config.defaultIdentity ? colors.green("*") : " ";
          console.log(
            `${marker} ${id.padEnd(16)} ${identity.label.padEnd(20)} ${identity.roots.join(", ")}`,
          );
        }
      },
    }),
    defineCommand({
      name: "show",
      description: "Show one identity",
      handler: async ({ positional }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const identity = (await loadConfig()).identities[id];
        if (!identity) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        printJson({ id, ...identity });
      },
    }),
    defineCommand({
      name: "ssh-public",
      description: "Print an identity's SSH public key",
      handler: async ({ positional }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const key = (await loadConfig()).identities[id]?.git?.sshKey;
        if (!key) {
          throw new Error(`Identity '${id}' has no configured SSH key`);
        }
        const publicKey = `${expandHome(key, os.homedir())}.pub`;
        if (!(await Bun.file(publicKey).exists())) {
          throw new Error(`Public key '${publicKey}' does not exist`);
        }
        process.stdout.write(await Bun.file(publicKey).text());
      },
    }),
    defineCommand({
      name: "add",
      description: "Create an identity and optional SSH key",
      options: {
        label: option(z.string().optional(), {
          description: "Display label",
        }),
        root: option(z.string().optional(), {
          description: "Directory root (defaults to ~/code/<id>)",
        }),
        color: option(z.string().default("#22d3ee"), {
          description: "TUI accent color",
        }),
        "git-name": option(z.string().optional(), {
          description: "Git author name",
        }),
        "git-email": option(z.string().email().optional(), {
          description: "Git author email",
        }),
        "ssh-key": option(z.string().optional(), {
          description: "Existing SSH private key",
        }),
        "generate-ssh": option(z.boolean().default(false), {
          description: "Generate a new Ed25519 key",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        assertIdentityId(id);
        if (flags["ssh-key"] && flags["generate-ssh"]) {
          throw new Error("Use either --ssh-key or --generate-ssh, not both");
        }
        const config = await loadConfig();
        if (config.identities[id]) {
          throw new Error(`Identity '${id}' already exists`);
        }
        const git = discoverGitIdentity(flags["git-name"], flags["git-email"]);
        if (flags["ssh-key"]) {
          const sshKey = expandHome(flags["ssh-key"], os.homedir());
          if (!(await Bun.file(sshKey).exists())) {
            throw new Error(`SSH key '${flags["ssh-key"]}' does not exist`);
          }
          git.sshKey = sshKey;
        } else if (flags["generate-ssh"]) {
          git.sshKey = (
            await generateSshKey({
              identity: id,
              email: git.email,
              home: os.homedir(),
            })
          ).privateKey;
        }
        config.identities[id] = {
          label: flags.label ?? id[0]!.toUpperCase() + id.slice(1),
          roots: [flags.root ?? `~/code/${id}`],
          color: flags.color,
          git,
          tools: createToolProfiles(id),
        };
        await saveAndSync(config);
        console.log(colors.green(`Created identity '${id}'`));
        if (git.sshKey) {
          console.log(`SSH public key: ${git.sshKey}.pub`);
        }
      },
    }),
    defineCommand({
      name: "remove",
      description: "Remove an identity without deleting its files",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Skip confirmation",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, prompt, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const config = await loadConfig();
        if (!config.identities[id]) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        if (id === config.defaultIdentity) {
          throw new Error("Set a different default identity before removing this one");
        }
        if (
          !flags.force &&
          !(await prompt.confirm(`Remove '${id}' from the registry?`, {
            default: false,
            fallbackValue: false,
          }))
        ) {
          throw new Error("Removal cancelled");
        }
        delete config.identities[id];
        await saveAndSync(config);
        console.log(colors.green(`Removed '${id}'; profile files were preserved`));
      },
    }),
    defineCommand({
      name: "bind",
      description: "Bind an additional directory root",
      handler: async ({ positional, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const root = requirePositional(positional, 1, "directory root");
        const config = await loadConfig();
        const identity = config.identities[id];
        if (!identity) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        if (!identity.roots.includes(root)) {
          identity.roots.push(root);
        }
        await saveAndSync(config);
        console.log(colors.green(`Bound ${root} to '${id}'`));
      },
    }),
    defineCommand({
      name: "unbind",
      description: "Remove a directory binding",
      handler: async ({ positional, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const root = requirePositional(positional, 1, "directory root");
        const config = await loadConfig();
        const identity = config.identities[id];
        if (!identity) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        if (identity.roots.length === 1) {
          throw new Error("An identity must keep at least one root");
        }
        identity.roots = identity.roots.filter((entry) => entry !== root);
        await saveAndSync(config);
        console.log(colors.green(`Unbound ${root} from '${id}'`));
      },
    }),
    defineCommand({
      name: "default",
      description: "Set the fallback identity",
      handler: async ({ positional, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const config = await loadConfig();
        if (!config.identities[id]) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        config.defaultIdentity = id;
        await saveConfig(config);
        console.log(colors.green(`Default identity is now '${id}'`));
      },
    }),
  ],
});

export default identityCommand;
