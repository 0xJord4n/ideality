import { defaultMaxListeners, setMaxListeners } from "node:events";
import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import {
  getConfigPath,
  getIdealityHome,
  saveConfig,
} from "../core/config-store.js";
import { findSshPrivateKeys } from "../core/file-search.js";
import { expandHome } from "../core/resolution.js";
import { createStarterConfig } from "../core/starter.js";
import { installGitIntegration } from "../integrations/git.js";
import {
  installShellIntegration,
  type SupportedShell,
} from "../integrations/shell.js";
import { generateSshKey } from "../integrations/ssh.js";
import { assertIdentityId, discoverGitIdentity } from "./shared.js";

type SshMode = "generate" | "existing" | "agent";
type Integration = "shell" | "git";
type SshFileChoice =
  | { kind: "file"; path: string }
  | { kind: "manual" };

async function wizardStep<T>(prompt: Promise<T>): Promise<T> {
  const value = await prompt;
  await Bun.sleep(0);
  return value;
}

function detectedShell(): SupportedShell {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("fish")) return "fish";
  if (shell.endsWith("bash")) return "bash";
  return "zsh";
}

function defaultRc(shell: SupportedShell, home: string): string {
  if (shell === "fish") {
    return path.join(home, ".config", "fish", "config.fish");
  }
  return path.join(home, shell === "bash" ? ".bashrc" : ".zshrc");
}

function displayHomePath(file: string, home: string): string {
  const relative = path.relative(home, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~/${relative}`
    : file;
}

const initCommand = defineCommand({
  name: "init",
  description: "Create the identity registry",
  options: {
    id: option(z.string().default("default"), {
      description: "Override the automatic identity ID",
    }),
    label: option(z.string().default("Default"), {
      description: "Display label",
    }),
    root: option(z.string().default("~/code"), {
      description: "Directory root owned by this identity",
    }),
    "git-name": option(z.string().optional(), {
      description: "Git author name (defaults to global Git config)",
    }),
    "git-email": option(z.string().email().optional(), {
      description: "Git author email (defaults to global Git config)",
    }),
    "ssh-key": option(z.string().optional(), {
      description: "Existing SSH private key",
    }),
    "generate-ssh": option(z.boolean().default(false), {
      description: "Generate an Ed25519 SSH key",
      argumentKind: "flag",
    }),
    install: option(z.boolean().default(false), {
      description: "Install shell and Git integrations",
      argumentKind: "flag",
    }),
    shell: option(z.enum(["zsh", "bash", "fish"]).default(detectedShell()), {
      description: "Shell integration",
    }),
    "no-shell": option(z.boolean().default(false), {
      description: "Skip shell integration",
      argumentKind: "flag",
    }),
    "no-git": option(z.boolean().default(false), {
      description: "Skip Git integration",
      argumentKind: "flag",
    }),
    interactive: option(z.boolean().default(false), {
      description: "Force the setup wizard",
      argumentKind: "flag",
    }),
    "non-interactive": option(z.boolean().default(false), {
      description: "Never prompt; use flags and defaults",
      argumentKind: "flag",
    }),
    force: option(z.boolean().default(false), {
      short: "f",
      description: "Overwrite an existing registry",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, prompt, spinner, terminal, colors }) => {
    if (flags.interactive && flags["non-interactive"]) {
      throw new Error("Use either --interactive or --non-interactive, not both");
    }
    if (flags["ssh-key"] && flags["generate-ssh"]) {
      throw new Error("Use either --ssh-key or --generate-ssh, not both");
    }

    const interactive =
      flags.interactive ||
      (terminal.isInteractive && !flags["non-interactive"]);
    const configPath = getConfigPath();
    const idealityHome = getIdealityHome();
    const home = os.homedir();

    if ((await Bun.file(configPath).exists()) && !flags.force) {
      if (
        !interactive ||
        !(await wizardStep(
          prompt.confirm(`Replace the existing registry at ${configPath}?`, {
            default: false,
            fallbackValue: false,
          }),
        ))
      ) {
        throw new Error(
          interactive
            ? "Initialization cancelled"
            : `Registry already exists at '${configPath}'; use --force`,
        );
      }
    }

    const discoveredGit = discoverGitIdentity(
      flags["git-name"],
      flags["git-email"],
    );
    const id = flags.id;
    assertIdentityId(id);
    let label = flags.label;
    let root = flags.root;
    let gitName = discoveredGit.name;
    let gitEmail = discoveredGit.email;
    let sshMode: SshMode = flags["ssh-key"]
      ? "existing"
      : flags["generate-ssh"]
        ? "generate"
        : "agent";
    let sshKey = flags["ssh-key"];
    let shell = flags.shell;
    let integrations: Integration[] = flags.install
      ? [
          ...(flags["no-shell"] ? [] : (["shell"] as const)),
          ...(flags["no-git"] ? [] : (["git"] as const)),
        ]
      : [];

    if (interactive) {
      // Bunli keeps each OpenTUI view's keyboard hooks until session disposal.
      setMaxListeners(Math.max(defaultMaxListeners, 64));
      prompt.intro("IDEALITY  /  IDENTITY SETUP");
      prompt.note(
        [
          "Folder ownership selects the active identity.",
          "Secrets stay in locked files and tool profiles remain isolated.",
        ].join("\n"),
        "How it works",
      );

      label = await wizardStep(
        prompt.text("Display label", {
          default:
            label === "Default" ? id[0]!.toUpperCase() + id.slice(1) : label,
        }),
      );
      root = await wizardStep(
        prompt.text("Folder root", {
          default: root,
          placeholder: "~/code",
          validate: (value) => value.length > 0 || "A folder root is required",
        }),
      );
      gitName = await wizardStep(
        prompt.text("Git author name", {
          default: gitName,
          validate: (value) =>
            value.length > 0 || "Git author name is required",
        }),
      );
      gitEmail = await wizardStep(
        prompt.text("Git author email", {
          default: gitEmail,
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
              hint: `${idealityHome}/ssh/${id}`,
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
        const discoveredKeys = await findSshPrivateKeys({
          home,
          idealityHome,
          preferred: sshKey ? expandHome(sshKey, home) : undefined,
        });
        const selected = await wizardStep(
          prompt.filter<SshFileChoice>("SSH private key", {
            options: [
              ...discoveredKeys.map((file) => ({
                label: displayHomePath(file, home),
                value: { kind: "file", path: file } as const,
              })),
              {
                label: "Enter another path",
                value: { kind: "manual" } as const,
                hint: "for keys stored outside the usual SSH directories",
              },
            ],
            placeholder: "Type to fuzzy search files",
            fuzzy: true,
            limit: 12,
            selectIfOne: false,
            height: 10,
          }),
        );
        const choice = Array.isArray(selected) ? selected[0] : selected;
        if (choice?.kind === "file") {
          sshKey = choice.path;
        } else {
          sshKey = await wizardStep(
            prompt.text("SSH private key path", {
              default: sshKey ?? "~/.ssh/id_ed25519",
              validate: (value) =>
                value.length > 0 || "SSH key path is required",
            }),
          );
        }
      }

      integrations = await wizardStep(
        prompt.multiselect<Integration>("Install integrations", {
          options: [
            {
              label: "Shell auto-switching",
              value: "shell",
              hint: "updates the identity when the directory changes",
            },
            {
              label: "Git includeIf",
              value: "git",
              hint: "selects author and SSH key by repository path",
            },
          ],
          initialValues: [
            ...(flags["no-shell"] ? [] : (["shell"] as const)),
            ...(flags["no-git"] ? [] : (["git"] as const)),
          ],
        }),
      );
      if (integrations.includes("shell")) {
        shell = await wizardStep(
          prompt.select<SupportedShell>("Shell", {
            default: shell,
            options: [
              { label: "Zsh", value: "zsh" },
              { label: "Bash", value: "bash" },
              { label: "Fish", value: "fish" },
            ],
          }),
        );
      }

      prompt.note(
        [
          `${label} (${id})`,
          `Root: ${root}`,
          `Git:  ${gitName} <${gitEmail}>`,
          `SSH:  ${sshMode}`,
          `Home: ${idealityHome}`,
          `Integrations: ${integrations.join(", ") || "none"}`,
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
    }

    const git = { name: gitName, email: gitEmail };
    if (sshMode === "existing") {
      const expanded = expandHome(sshKey!, home);
      if (!(await Bun.file(expanded).exists())) {
        throw new Error(`SSH key '${sshKey}' does not exist`);
      }
      Object.assign(git, { sshKey: expanded });
    } else if (sshMode === "generate") {
      Object.assign(
        git,
        await generateSshKey({
          identity: id,
          email: gitEmail,
          idealityHome,
        }).then(({ privateKey }) => ({ sshKey: privateKey })),
      );
    }

    const config = createStarterConfig({ id, label, root, git });
    const spin = interactive
      ? spinner({ text: "Writing identity registry", showTimer: true })
      : null;
    spin?.start();
    try {
      await saveConfig(config);
      if (integrations.includes("shell")) {
        await installShellIntegration(
          config,
          shell,
          defaultRc(shell, home),
          idealityHome,
        );
      }
      if (integrations.includes("git")) {
        await installGitIntegration(config, home, idealityHome);
      }
      spin?.succeed("Identity system ready");
    } catch (error) {
      spin?.fail("Setup failed");
      throw error;
    }

    if (interactive) {
      prompt.outro(
        `Ready. Open the dashboard with ${colors.cyan("ideality tui")}`,
      );
    } else {
      console.log(colors.green(`Created ${configPath}`));
      if (!flags.install) {
        console.log(`Next: ideality install --shell ${shell}`);
      }
    }
  },
});

export default initCommand;
