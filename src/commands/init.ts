import { defaultMaxListeners, setMaxListeners } from "node:events";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import {
  BUILTIN_TOOL_PACKS,
  BUILTIN_TOOLS,
  DEFAULT_TOOL_PACKS,
  toolsInPacks,
} from "../adapters/builtins.js";
import {
  getConfigPath,
  getIdealityHome,
  saveConfig,
} from "../core/config-store.js";
import { snapshotPaths } from "../core/file-transaction.js";
import { findSshPrivateKeys } from "../core/file-search.js";
import { deriveIdentityId } from "../core/identity-id.js";
import { expandHome } from "../core/resolution.js";
import { createStarterConfig } from "../core/starter.js";
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
import { generateSshKey } from "../integrations/ssh.js";
import {
  assertIdentityId,
  discoverConfiguredGitIdentity,
  discoverGitIdentity,
  parseList,
  wizardStep,
} from "./shared.js";
import { hintLines, statusGlyph, tidyPath } from "./ui.js";

type SshMode = "generate" | "existing" | "agent";
type Integration = "shell" | "git";
type SetupMode = "recommended" | "advanced";
type SshFileChoice = { kind: "file"; path: string } | { kind: "manual" };

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

const initCommand = defineCommand({
  name: "init",
  description: "Set up your first folder-based identity",
  options: {
    id: option(z.string().optional(), {
      description: "Override the automatic identity ID",
    }),
    label: option(z.string().default("Default"), {
      description: "Display label",
    }),
    root: option(z.string().optional(), {
      description: "Directory root (defaults to the current directory)",
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
    packs: option(z.string().optional(), {
      description: "Comma-separated built-in tool packs",
    }),
    tools: option(z.string().optional(), {
      description: "Comma-separated tools enabled for the identity",
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
    "dry-run": option(z.boolean().default(false), {
      description: "Show the registry and integrations without writing files",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, prompt, spinner, terminal, colors }) => {
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

    const configuredGit = discoverConfiguredGitIdentity(
      flags["git-name"],
      flags["git-email"],
    );
    const discoveredGit = discoverGitIdentity(
      configuredGit.name,
      configuredGit.email,
    );
    let id = flags.id ?? "";
    if (id) assertIdentityId(id);
    let label = flags.label;
    let root = flags.root ?? process.cwd();
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
    const requestedPacks = parseList(flags.packs);
    const requestedTools = parseList(flags.tools);
    let selectedPacks =
      requestedPacks.length > 0
        ? requestedPacks
        : requestedTools.length > 0
          ? Object.entries(BUILTIN_TOOL_PACKS)
              .filter(([, pack]) =>
                pack.tools.some((tool) => requestedTools.includes(tool)),
              )
              .map(([pack]) => pack)
          : [...DEFAULT_TOOL_PACKS];
    let selectedTools =
      requestedTools.length > 0 ? requestedTools : toolsInPacks(selectedPacks);

    if (interactive) {
      // Bunli keeps each OpenTUI view's keyboard hooks until session disposal.
      setMaxListeners(Math.max(defaultMaxListeners, 64));
      prompt.intro("IDEALITY  /  FIRST IDENTITY");
      prompt.note(
        [
          "Choose which account belongs to this folder.",
          "Inside it, Ideality selects that account automatically.",
        ].join("\n"),
        "How it works",
      );

      label = await wizardStep(
        prompt.text("Identity name", {
          default: label === "Default" ? "" : label,
          placeholder: "Work, Personal, or Acme",
          validate: (value) => value.length > 0 || "A name is required",
        }),
      );
      if (!id) id = deriveIdentityId(label, []);
      assertIdentityId(id);
      prompt.note(id, "Automatic ID");
      root = await wizardStep(
        prompt.text("Folder for this identity", {
          default: root,
          placeholder: process.cwd(),
          validate: (value) => value.length > 0 || "A folder is required",
        }),
      );

      const setupMode = await wizardStep(
        prompt.select<SetupMode>("Setup", {
          default: "recommended",
          options: [
            {
              label: "Recommended",
              value: "recommended",
              hint: "Git identity, SSH agent, essential tools, and auto-switching",
            },
            {
              label: "Advanced setup",
              value: "advanced",
              hint: "customize Git, SSH, tools, and integrations",
            },
          ],
        }),
      );

      if (setupMode === "advanced" || !configuredGit.name) {
        gitName = await wizardStep(
          prompt.text("Git author name", {
            default: configuredGit.name ?? "",
            validate: (value) =>
              value.length > 0 || "Git author name is required",
          }),
        );
      }
      if (setupMode === "advanced" || !configuredGit.email) {
        gitEmail = await wizardStep(
          prompt.text("Git author email", {
            default: configuredGit.email ?? "",
            validate: (value) =>
              z.string().email().safeParse(value).success ||
              "Enter a valid email",
          }),
        );
      }

      if (setupMode === "advanced") {
        sshMode = await wizardStep(
          prompt.select<SshMode>("SSH authentication", {
            default: sshMode,
            options: [
              {
                label: "Generate a new Ed25519 key",
                value: "generate",
                hint: tidyPath(path.join(idealityHome, "ssh", id), home),
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
                  label: tidyPath(file, home),
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

        selectedPacks = await wizardStep(
          prompt.multiselect<string>("Tool packs", {
            options: Object.entries(BUILTIN_TOOL_PACKS).map(([id, pack]) => ({
              label: pack.label,
              value: id,
              hint: pack.description,
            })),
            initialValues: selectedPacks,
            min: 1,
          }),
        );
        const packTools = toolsInPacks(selectedPacks);
        selectedTools = await wizardStep(
          prompt.multiselect<string>("Tools enabled for this identity", {
            options: packTools.map((tool) => ({
              label: BUILTIN_TOOLS[tool]?.description ?? tool,
              value: tool,
              hint: `${tool} / ${BUILTIN_TOOLS[tool]?.stateIsolation ?? "partial"}`,
            })),
            initialValues:
              requestedTools.length > 0
                ? selectedTools.filter((tool) => packTools.includes(tool))
                : packTools,
            min: 1,
          }),
        );

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
      } else {
        integrations = [
          ...(flags["no-shell"] ? [] : (["shell"] as const)),
          ...(flags["no-git"] ? [] : (["git"] as const)),
        ];
      }

      if (setupMode === "advanced" && integrations.includes("shell")) {
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

      const review =
        setupMode === "recommended"
          ? [
              `${label} (${id})`,
              `Folder: ${tidyPath(root, home)}`,
              `Git: ${gitName} <${gitEmail}>`,
              `Automatic switching: ${integrations.length > 0 ? "enabled" : "disabled"}`,
            ]
          : [
              `${label} (${id})`,
              `Folder: ${tidyPath(root, home)}`,
              `Git:  ${gitName} <${gitEmail}>`,
              `SSH:  ${sshMode}`,
              `Home: ${tidyPath(idealityHome, home)}`,
              `Packs: ${selectedPacks.join(", ")}`,
              `Tools: ${selectedTools.join(", ")}`,
              `Integrations: ${integrations.join(", ") || "none"}`,
            ];
      prompt.note(review.join("\n"), "Review");
      if (
        !(await wizardStep(
          prompt.confirm("Finish setup?", {
            default: true,
            fallbackValue: false,
          }),
        ))
      ) {
        prompt.cancel("No files were changed.");
        return;
      }
    }

    if (!id) id = deriveIdentityId(label, []);
    assertIdentityId(id);
    for (const pack of selectedPacks) {
      if (!BUILTIN_TOOL_PACKS[pack]) {
        throw new Error(`Unknown tool pack '${pack}'`);
      }
    }
    const knownTools = new Set(toolsInPacks(Object.keys(BUILTIN_TOOL_PACKS)));
    for (const tool of selectedTools) {
      if (!knownTools.has(tool))
        throw new Error(`Unknown built-in tool '${tool}'`);
    }
    const transaction = flags["dry-run"]
      ? null
      : await snapshotPaths([
          configPath,
          path.join(idealityHome, "bin"),
          path.join(idealityHome, "completions"),
          path.join(idealityHome, "shell"),
          path.join(idealityHome, "git"),
          ...(integrations.includes("shell") ? [defaultRc(shell, home)] : []),
        ]);
    let generatedKey: { privateKey: string; publicKey: string } | null = null;
    let spin: ReturnType<typeof spinner> | null = null;
    try {
      const git = { name: gitName, email: gitEmail };
      if (sshMode === "existing") {
        const expanded = expandHome(sshKey!, home);
        if (!(await Bun.file(expanded).exists())) {
          throw new Error(`SSH key '${sshKey}' does not exist`);
        }
        Object.assign(git, { sshKey: expanded });
      } else if (sshMode === "generate") {
        if (flags["dry-run"]) {
          Object.assign(git, { sshKey: path.join(idealityHome, "ssh", id) });
        } else {
          generatedKey = await generateSshKey({
            identity: id,
            email: gitEmail,
            idealityHome,
          });
          Object.assign(git, { sshKey: generatedKey.privateKey });
        }
      }

      const config = createStarterConfig({
        id,
        label,
        root,
        git,
        tools: selectedTools,
      });
      if (flags["dry-run"]) {
        console.log(
          JSON.stringify(
            {
              configPath,
              config,
              integrations,
              shell: integrations.includes("shell") ? shell : null,
            },
            null,
            2,
          ),
        );
        return;
      }
      spin = interactive
        ? spinner({ text: "Writing identity registry", showTimer: true })
        : null;
      spin?.start();
      await saveConfig(config);
      if (integrations.includes("shell")) {
        await installCompletion(
          shell,
          renderCompletion(shell, {
            identities: Object.keys(config.identities).sort(),
            tools: Object.keys(config.tools).sort(),
          }),
          idealityHome,
        );
        await installShims(config, idealityHome);
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
      await transaction!.commit();
      spin?.succeed("Identity system ready");
    } catch (error) {
      spin?.fail("Setup failed");
      if (generatedKey) {
        await rm(generatedKey.privateKey, { force: true });
        await rm(generatedKey.publicKey, { force: true });
      }
      await transaction?.rollback();
      throw error;
    }

    if (interactive) {
      prompt.outro(
        `Ready. ${tidyPath(root, home)} now uses ${label}. Check it with ${colors.cyan("ideality status")}`,
      );
    } else {
      console.log(statusGlyph("ok", `Created ${tidyPath(configPath, home)}`));
      console.log(
        hintLines([
          ...(flags.install
            ? []
            : [`install integrations: ideality install --shell ${shell}`]),
          "see the active identity: ideality status",
        ]),
      );
    }
  },
});

export default initCommand;
