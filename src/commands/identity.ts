import { defaultMaxListeners, setMaxListeners } from "node:events";
import os from "node:os";
import path from "node:path";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import {
  findIdentityDirectories,
  findSshPrivateKeys,
} from "../core/file-search.js";
import { deriveIdentityId } from "../core/identity-id.js";
import { expandHome } from "../core/resolution.js";
import { createToolProfiles } from "../core/starter.js";
import { installGitIntegration } from "../integrations/git.js";
import { generateSshKey } from "../integrations/ssh.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import {
  assertIdentityId,
  discoverGitIdentity,
  printJson,
  requirePositional,
} from "./shared.js";

async function saveAndSync(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
  await saveConfig(config);
  await installGitIntegration(config, os.homedir(), getIdealityHome());
  await syncInstalledCompletions(config, getIdealityHome());
}

type SshMode = "generate" | "existing" | "agent";
type FileChoice =
  | { kind: "file"; path: string }
  | { kind: "manual" };

async function wizardStep<T>(pending: Promise<T>): Promise<T> {
  const value = await pending;
  await Bun.sleep(0);
  return value;
}

function displayHomePath(file: string, home: string): string {
  const relative = path.relative(home, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~/${relative}`
    : file;
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
        id: option(z.string().optional(), {
          description: "Override the automatically derived identity ID",
        }),
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
        interactive: option(z.boolean().default(false), {
          description: "Force the identity wizard",
          argumentKind: "flag",
        }),
        "non-interactive": option(z.boolean().default(false), {
          description: "Never prompt; derive the ID from the label",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Show the identity without changing files",
          argumentKind: "flag",
        }),
      },
      handler: async ({
        positional,
        flags,
        colors,
        prompt,
        spinner,
        terminal,
      }) => {
        if (flags.interactive && flags["non-interactive"]) {
          throw new Error(
            "Use either --interactive or --non-interactive, not both",
          );
        }
        if (flags["ssh-key"] && flags["generate-ssh"]) {
          throw new Error("Use either --ssh-key or --generate-ssh, not both");
        }
        const interactive =
          flags.interactive ||
          (terminal.isInteractive && !flags["non-interactive"]);
        const config = await loadConfig();
        const home = os.homedir();
        const idealityHome = getIdealityHome();
        let id = flags.id ?? positional[0] ?? "";
        let label =
          flags.label ??
          (id ? id[0]!.toUpperCase() + id.slice(1) : "New identity");
        let root = flags.root;
        let git = discoverGitIdentity(
          flags["git-name"],
          flags["git-email"],
        );
        let sshMode: SshMode = flags["ssh-key"]
          ? "existing"
          : flags["generate-ssh"]
            ? "generate"
            : "agent";
        let sshKey = flags["ssh-key"];

        if (interactive) {
          setMaxListeners(Math.max(defaultMaxListeners, 64));
          prompt.intro("IDEALITY  /  NEW IDENTITY");
          label = await wizardStep(
            prompt.text("Display label", {
              default: label,
              validate: (value) =>
                value.length > 0 || "Display label is required",
            }),
          );
          if (!id) {
            id = deriveIdentityId(label, Object.keys(config.identities));
          }
          assertIdentityId(id);
          if (config.identities[id]) {
            throw new Error(`Identity '${id}' already exists`);
          }
          prompt.note(id, "Automatic ID");

          const directories = await findIdentityDirectories(home);
          const selectedRoot = await wizardStep(
            prompt.filter<FileChoice>("Folder root", {
              options: [
                ...directories.map((directory) => ({
                  label: displayHomePath(directory, home),
                  value: { kind: "file", path: directory } as const,
                })),
                {
                  label: "Enter another path",
                  value: { kind: "manual" } as const,
                },
              ],
              placeholder: "Type to fuzzy search directories",
              fuzzy: true,
              limit: 12,
              height: 10,
            }),
          );
          const rootChoice = Array.isArray(selectedRoot)
            ? selectedRoot[0]
            : selectedRoot;
          root =
            rootChoice?.kind === "file"
              ? rootChoice.path
              : await wizardStep(
                  prompt.text("Folder root path", {
                    default: root ?? `~/code/${id}`,
                    validate: (value) =>
                      value.length > 0 || "Folder root is required",
                  }),
                );

          git.name = await wizardStep(
            prompt.text("Git author name", {
              default: git.name,
              validate: (value) =>
                value.length > 0 || "Git author name is required",
            }),
          );
          git.email = await wizardStep(
            prompt.text("Git author email", {
              default: git.email,
              validate: (value) =>
                z.string().email().safeParse(value).success ||
                "Enter a valid email",
            }),
          );
          sshMode = await wizardStep(
            prompt.select<SshMode>("SSH authentication", {
              default: sshMode,
              options: [
                {
                  label: "Generate a new Ed25519 key",
                  value: "generate",
                },
                {
                  label: "Use an existing private key",
                  value: "existing",
                },
                {
                  label: "Use the default SSH agent",
                  value: "agent",
                },
              ],
            }),
          );
          if (sshMode === "existing") {
            const keys = await findSshPrivateKeys({
              home,
              idealityHome,
              preferred: sshKey ? expandHome(sshKey, home) : undefined,
            });
            const selectedKey = await wizardStep(
              prompt.filter<FileChoice>("SSH private key", {
                options: [
                  ...keys.map((file) => ({
                    label: displayHomePath(file, home),
                    value: { kind: "file", path: file } as const,
                  })),
                  {
                    label: "Enter another path",
                    value: { kind: "manual" } as const,
                  },
                ],
                placeholder: "Type to fuzzy search files",
                fuzzy: true,
                limit: 12,
                height: 10,
              }),
            );
            const keyChoice = Array.isArray(selectedKey)
              ? selectedKey[0]
              : selectedKey;
            sshKey =
              keyChoice?.kind === "file"
                ? keyChoice.path
                : await wizardStep(
                    prompt.text("SSH private key path", {
                      default: sshKey ?? "~/.ssh/id_ed25519",
                    }),
                  );
          }

          prompt.note(
            [
              `${label} (${id})`,
              `Root: ${root}`,
              `Git:  ${git.name} <${git.email}>`,
              `SSH:  ${sshMode}`,
            ].join("\n"),
            "Review",
          );
          if (
            !(await wizardStep(
              prompt.confirm("Create this identity?", {
                default: true,
                fallbackValue: false,
              }),
            ))
          ) {
            prompt.cancel("No files were changed.");
            return;
          }
        } else if (!id) {
          id = deriveIdentityId(label, Object.keys(config.identities));
        }

        assertIdentityId(id);
        if (config.identities[id]) {
          throw new Error(`Identity '${id}' already exists`);
        }
        root ??= `~/code/${id}`;
        if (sshMode === "existing") {
          const expandedKey = expandHome(sshKey!, home);
          if (!(await Bun.file(expandedKey).exists())) {
            throw new Error(`SSH key '${sshKey}' does not exist`);
          }
          git.sshKey = expandedKey;
        } else if (sshMode === "generate") {
          git.sshKey = flags["dry-run"]
            ? path.join(idealityHome, "ssh", id)
            : (
                await generateSshKey({
                  identity: id,
                  email: git.email,
                  idealityHome,
                })
              ).privateKey;
        }
        config.identities[id] = {
          label,
          roots: [root],
          color: flags.color,
          git,
          tools: createToolProfiles(id),
        };
        if (flags["dry-run"]) {
          printJson({ id, ...config.identities[id] });
          return;
        }
        const spin = interactive
          ? spinner({ text: "Creating identity", showTimer: true })
          : null;
        spin?.start();
        try {
          await saveAndSync(config);
          spin?.succeed("Identity created");
        } catch (error) {
          spin?.fail("Identity creation failed");
          throw error;
        }
        if (!interactive) {
          console.log(colors.green(`Created identity '${id}'`));
        }
        if (git.sshKey) {
          console.log(`SSH public key: ${git.sshKey}.pub`);
        }
        if (interactive) {
          prompt.outro(`Ready. Active under ${root}`);
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
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
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
        if (!flags["dry-run"]) await saveAndSync(config);
        console.log(colors.green(`Removed '${id}'; profile files were preserved`));
      },
    }),
    defineCommand({
      name: "bind",
      description: "Bind an additional directory root",
      options: {
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
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
        if (!flags["dry-run"]) await saveAndSync(config);
        console.log(colors.green(`Bound ${root} to '${id}'`));
      },
    }),
    defineCommand({
      name: "unbind",
      description: "Remove a directory binding",
      options: {
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
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
        if (!flags["dry-run"]) await saveAndSync(config);
        console.log(colors.green(`Unbound ${root} from '${id}'`));
      },
    }),
    defineCommand({
      name: "default",
      description: "Set the fallback identity",
      options: {
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const id = requirePositional(positional, 0, "identity ID");
        const config = await loadConfig();
        if (!config.identities[id]) {
          throw new Error(`Identity '${id}' does not exist`);
        }
        config.defaultIdentity = id;
        if (!flags["dry-run"]) await saveConfig(config);
        console.log(colors.green(`Default identity is now '${id}'`));
      },
    }),
  ],
});

export default identityCommand;
