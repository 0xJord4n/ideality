import { defaultMaxListeners, setMaxListeners } from "node:events";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { recordAuditEvent } from "../core/audit-history.js";
import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { findSshPrivateKeys } from "../core/file-search.js";
import { deriveIdentityId } from "../core/identity-id.js";
import {
  checkPresentProjectPolicy,
  formatPolicyFailure,
} from "../core/policy.js";
import {
  applyProjectConfig,
  createProjectConfig,
  findProjectRoot,
  getProjectConfigPath,
  loadProjectConfig,
  saveProjectConfig,
} from "../core/project-config.js";
import { findExecutable } from "../core/runtime.js";
import { createToolProfiles } from "../core/starter.js";
import type {
  ExecutionTarget,
  GitIdentity,
  IdealityConfig,
} from "../domain/config.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import { installGitIntegration } from "../integrations/git.js";
import { installShims } from "../integrations/shims.js";
import { generateSshKey } from "../integrations/ssh.js";
import { discoverGitIdentity, printJson } from "./shared.js";

type SetupScope = "project" | "local";
type HandoverDetail = "full" | "requirements";
type Integration = "git" | "shims" | "completions";
type SshMode = "generate" | "existing" | "agent";
type IdentityChoice =
  | { kind: "local"; id: string }
  | { kind: "project"; id: string }
  | { kind: "new" };
type FileChoice = { kind: "file"; path: string } | { kind: "manual" };

async function wizardStep<T>(pending: Promise<T>): Promise<T> {
  const value = await pending;
  await Bun.sleep(0);
  return value;
}

function parseTools(value: string | undefined): string[] {
  return value
    ? [
        ...new Set(
          value
            .split(",")
            .map((tool) => tool.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function displayHomePath(file: string, home: string): string {
  const relative = path.relative(home, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~/${relative}`
    : file;
}

function handoverRisks(
  config: IdealityConfig,
  identityId: string,
  tools: string[],
): string[] {
  const identity = config.identities[identityId];
  if (!identity) return [];
  const toolLiterals = tools.flatMap((tool) =>
    Object.entries(identity.tools[tool]?.env ?? {})
      .filter(
        ([name, source]) =>
          typeof source === "string" &&
          /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(name),
      )
      .map(([name]) => `${tool}:${name}`),
  );
  const networkIds = new Set<string>();
  const vmIds = new Set<string>();
  const collect = (target: ExecutionTarget | undefined) => {
    if (target?.network) networkIds.add(target.network);
    if (target?.target === "vm") vmIds.add(target.vm);
  };
  collect(identity.execution);
  for (const tool of tools) collect(identity.tools[tool]?.execution);
  for (const vmId of vmIds) {
    const network = config.vms?.[vmId]?.network;
    if (network) networkIds.add(network);
  }
  const networkLiterals: string[] = [];
  for (const networkId of networkIds) {
    const profile = config.networks?.[networkId];
    if (!profile) continue;
    if (
      (profile.driver === "wireguard" || profile.driver === "openvpn") &&
      typeof profile.config === "string"
    ) {
      networkLiterals.push(`network:${networkId}:config`);
    }
    if (profile.driver === "openvpn") {
      if (typeof profile.username === "string") {
        networkLiterals.push(`network:${networkId}:username`);
      }
      if (typeof profile.password === "string") {
        networkLiterals.push(`network:${networkId}:password`);
      }
    }
    if (profile.driver === "custom") {
      networkLiterals.push(`network:${networkId}:custom-commands`);
      for (const [name, source] of Object.entries(profile.env ?? {})) {
        if (typeof source === "string") {
          networkLiterals.push(`network:${networkId}:${name}`);
        }
      }
    }
  }
  const vmCommands = [...vmIds].flatMap((vmId) => {
    const profile = config.vms?.[vmId];
    if (profile?.driver === "lima" && profile.provision?.length) {
      return [`vm:${vmId}:provision`];
    }
    if (profile?.driver === "custom") {
      return [`vm:${vmId}:custom-commands`];
    }
    return [];
  });
  return [...toolLiterals, ...networkLiterals, ...vmCommands];
}

const setupCommand = defineCommand({
  name: "setup",
  description: "Configure the current project with an interactive wizard",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Project directory",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Local identity to activate",
    }),
    tools: option(z.string().optional(), {
      description: "Comma-separated tools for non-interactive setup",
    }),
    project: option(z.boolean().default(false), {
      description: "Write a complete .ideality/project.jsonc handover bundle",
      argumentKind: "flag",
    }),
    "local-only": option(z.boolean().default(false), {
      description: "Keep configuration only under the user ideality home",
      argumentKind: "flag",
    }),
    advanced: option(z.boolean().default(false), {
      description: "Show SSH, handover, and integration controls",
      argumentKind: "flag",
    }),
    "requirements-only": option(z.boolean().default(false), {
      description: "Share tool requirements without full identity profiles",
      argumentKind: "flag",
    }),
    vm: option(z.string().optional(), {
      description: "Run selected tools in this VM profile",
    }),
    network: option(z.string().optional(), {
      description: "Require this host-enforced network profile",
    }),
    "non-interactive": option(z.boolean().default(false), {
      description: "Never prompt; require identity and tool flags as needed",
      argumentKind: "flag",
    }),
    yes: option(z.boolean().default(false), {
      short: "y",
      description: "Apply without the final confirmation",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description: "Show the complete change without writing files",
      argumentKind: "flag",
    }),
    "allow-policy-violations": option(z.boolean().default(false), {
      description:
        "Bypass .ideality/policy.jsonc violations for this setup invocation",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, prompt, terminal, spinner, colors }) => {
    if (flags.project && flags["local-only"]) {
      throw new Error("Use either --project or --local-only, not both");
    }
    const interactive = terminal.isInteractive && !flags["non-interactive"];
    const home = os.homedir();
    const idealityHome = getIdealityHome();
    const projectRoot = await findProjectRoot(flags.path);
    const existingProject = await loadProjectConfig(projectRoot);
    const localConfig = await loadConfig();
    let working = structuredClone(localConfig);
    if (existingProject) {
      Object.assign(working.tools, structuredClone(existingProject.tools));
      Object.assign(
        (working.networks ??= {}),
        structuredClone(existingProject.networks ?? {}),
      );
      Object.assign(
        (working.vms ??= {}),
        structuredClone(existingProject.vms ?? {}),
      );
    }

    let scope: SetupScope = flags["local-only"]
      ? "local"
      : flags.project
        ? "project"
        : "local";
    let detail: HandoverDetail = flags["requirements-only"]
      ? "requirements"
      : "full";
    let integrations: Integration[] = ["git", "shims", "completions"];
    let identityId = flags.identity ?? "";
    let selectedTools = parseTools(flags.tools);
    let sshMode: SshMode = "agent";
    let sshKey: string | undefined;
    let generatedIdentity = false;
    let execution: ExecutionTarget | undefined;
    if (flags.vm) {
      execution = {
        target: "vm",
        vm: flags.vm,
        network: flags.network,
      };
    } else if (flags.network) {
      execution = { target: "host", network: flags.network };
    }

    if (interactive) {
      setMaxListeners(Math.max(defaultMaxListeners, 64));
      prompt.intro("IDEALITY  /  PROJECT SETUP");
      prompt.note(
        [
          `Project: ${projectRoot}`,
          `Git: ${
            (await stat(path.join(projectRoot, ".git"))
              .then(() => true)
              .catch(() => false))
              ? "detected"
              : "not detected"
          }`,
          `Handover: ${existingProject ? getProjectConfigPath(projectRoot) : "not configured"}`,
        ].join("\n"),
        "Detected",
      );

      scope = await wizardStep(
        prompt.select<SetupScope>("Where should this setup live?", {
          default: existingProject ? "project" : "project",
          options: [
            {
              label: "Project handover + local activation",
              value: "project",
              hint: "complete .ideality/project.jsonc",
            },
            {
              label: "Local activation only",
              value: "local",
              hint: idealityHome,
            },
          ],
        }),
      );

      if (!identityId) {
        const choices: Array<{
          label: string;
          value: IdentityChoice;
          hint?: string;
        }> = Object.entries(localConfig.identities).map(([id, identity]) => ({
          label: identity.label,
          value: { kind: "local", id },
          hint: `${id}  ${identity.git?.email ?? "no Git identity"}`,
        }));
        const projectId = existingProject?.defaultIdentity;
        if (projectId && !localConfig.identities[projectId]) {
          choices.unshift({
            label: existingProject!.identities[projectId]!.label,
            value: { kind: "project", id: projectId },
            hint: "import from project handover",
          });
        }
        choices.push({
          label: "Create a new identity",
          value: { kind: "new" },
        });
        const result = await wizardStep(
          prompt.filter<IdentityChoice>("Identity for this project", {
            options: choices,
            placeholder: "Type to fuzzy search identities",
            fuzzy: true,
            limit: 12,
            height: 10,
          }),
        );
        const choice = Array.isArray(result) ? result[0] : result;
        if (!choice) throw new Error("Select an identity");
        if (choice.kind === "project") {
          identityId = choice.id;
          const source = existingProject!.identities[choice.id]!;
          working.identities[identityId] = {
            ...structuredClone(source),
            roots: [projectRoot],
            tools: {},
          };
        } else if (choice.kind === "new") {
          const label = await wizardStep(
            prompt.text("Identity label", {
              default: path.basename(projectRoot),
              validate: (value) =>
                value.length > 0 || "Identity label is required",
            }),
          );
          identityId = deriveIdentityId(label, Object.keys(working.identities));
          prompt.note(identityId, "Automatic ID");
          const discovered = discoverGitIdentity();
          const git: GitIdentity = {
            name: await wizardStep(
              prompt.text("Git author name", {
                default: discovered.name,
                validate: (value) =>
                  value.length > 0 || "Git author name is required",
              }),
            ),
            email: await wizardStep(
              prompt.text("Git author email", {
                default: discovered.email,
                validate: (value) =>
                  z.string().email().safeParse(value).success ||
                  "Enter a valid email",
              }),
            ),
          };
          if (flags.advanced) {
            sshMode = await wizardStep(
              prompt.select<SshMode>("SSH authentication", {
                default: "agent",
                options: [
                  { label: "Use the default SSH agent", value: "agent" },
                  { label: "Generate a new Ed25519 key", value: "generate" },
                  { label: "Use an existing private key", value: "existing" },
                ],
              }),
            );
            if (sshMode === "existing") {
              const keys = await findSshPrivateKeys({ home, idealityHome });
              const selected = await wizardStep(
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
              const keyChoice = Array.isArray(selected)
                ? selected[0]
                : selected;
              sshKey =
                keyChoice?.kind === "file"
                  ? keyChoice.path
                  : await wizardStep(
                      prompt.text("SSH private key path", {
                        default: "~/.ssh/id_ed25519",
                      }),
                    );
              git.sshKey = sshKey;
            }
          }
          working.identities[identityId] = {
            label,
            roots: [projectRoot],
            color: "#22d3ee",
            git,
            tools: {},
          };
          generatedIdentity = true;
        } else {
          identityId = choice.id;
        }
      }

      execution ??= working.identities[identityId]?.execution;
      const availableTools = Object.entries(working.tools)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, definition]) => {
          const executable = findExecutable(definition.executable);
          return {
            label: definition.description ?? name,
            value: name,
            hint: `${definition.pack ?? "custom"} / ${definition.stateIsolation ?? "partial"} / ${executable ? "installed" : "missing"}`,
          };
        });
      const projectTools = existingProject
        ? Object.keys(existingProject.tools)
        : [];
      const installedTools = availableTools
        .filter((tool) => tool.hint.endsWith("installed"))
        .map((tool) => tool.value);
      selectedTools = await wizardStep(
        prompt.multiselect<string>("Tools used by this project", {
          options: availableTools,
          initialValues:
            selectedTools.length > 0
              ? selectedTools
              : projectTools.length > 0
                ? projectTools
                : installedTools,
          min: 1,
        }),
      );

      const executionOptions = [
        {
          label: "Host without a VPN requirement",
          value: "host",
          hint: "identity isolation only",
        },
        ...Object.entries(working.networks ?? {}).map(([id, profile]) => ({
          label: `Host via ${profile.label ?? id}`,
          value: `network:${id}`,
          hint: `${profile.driver} / ${profile.killSwitch ?? "required"}`,
        })),
        ...Object.entries(working.vms ?? {}).map(([id, profile]) => ({
          label: `VM: ${profile.label ?? id}`,
          value: `vm:${id}`,
          hint: `${profile.driver}${profile.network ? ` / ${profile.network}` : ""}`,
        })),
      ];
      if (executionOptions.length > 1) {
        const selectedExecution = await wizardStep(
          prompt.select<string>("Execution and network (optional)", {
            default:
              execution?.target === "vm"
                ? `vm:${execution.vm}`
                : execution?.network
                  ? `network:${execution.network}`
                  : "host",
            options: executionOptions,
          }),
        );
        if (selectedExecution.startsWith("vm:")) {
          execution = {
            target: "vm",
            vm: selectedExecution.slice(3),
          };
        } else if (selectedExecution.startsWith("network:")) {
          execution = {
            target: "host",
            network: selectedExecution.slice(8),
          };
        } else {
          execution = undefined;
        }
      }

      if (flags.advanced && scope === "project") {
        detail = await wizardStep(
          prompt.select<HandoverDetail>("Project handover detail", {
            default: detail,
            options: [
              {
                label: "Full identity and tool profiles",
                value: "full",
                hint: "Git, SSH references, arguments, environment, secrets",
              },
              {
                label: "Tool requirements only",
                value: "requirements",
                hint: "teammates provide their own identity details",
              },
            ],
          }),
        );
      }
      if (flags.advanced) {
        integrations = await wizardStep(
          prompt.multiselect<Integration>("Update local integrations", {
            options: [
              { label: "Git folder identity", value: "git" },
              { label: "Managed tool shims", value: "shims" },
              { label: "Installed completions", value: "completions" },
            ],
            initialValues: integrations,
          }),
        );
      }
    } else {
      if (!identityId) {
        identityId = existingProject?.defaultIdentity ?? "";
      }
      if (!identityId) {
        throw new Error("Non-interactive setup requires --identity");
      }
      if (!working.identities[identityId]) {
        if (
          existingProject?.identities[existingProject.defaultIdentity] &&
          identityId === existingProject.defaultIdentity
        ) {
          const source = existingProject.identities[identityId]!;
          working.identities[identityId] = {
            ...structuredClone(source),
            roots: [projectRoot],
            tools: {},
          };
        } else {
          throw new Error(`Identity '${identityId}' does not exist`);
        }
      }
      if (selectedTools.length === 0) {
        selectedTools = existingProject
          ? Object.keys(existingProject.tools)
          : [];
      }
      execution ??= working.identities[identityId]?.execution;
      if (selectedTools.length === 0) {
        throw new Error("Non-interactive setup requires --tools");
      }
    }

    for (const tool of selectedTools) {
      if (!working.tools[tool])
        throw new Error(`Tool '${tool}' does not exist`);
    }
    if (!working.identities[identityId]) {
      throw new Error(`Identity '${identityId}' does not exist`);
    }
    const identity = working.identities[identityId]!;
    const defaultProfiles = createToolProfiles(
      identityId,
      selectedTools,
      identity.git?.sshKey,
    );
    for (const tool of selectedTools) {
      identity.tools[tool] ??= defaultProfiles[tool] ?? {};
    }
    if (execution?.target === "vm" && !working.vms?.[execution.vm]) {
      throw new Error(`VM profile '${execution.vm}' does not exist`);
    }
    if (execution?.network && !working.networks?.[execution.network]) {
      throw new Error(`Network profile '${execution.network}' does not exist`);
    }
    working.identities[identityId]!.execution = execution;
    if (existingProject) {
      const handedOverTools = selectedTools.filter(
        (tool) => existingProject.tools[tool],
      );
      if (handedOverTools.length > 0) {
        const selectedHandover = createProjectConfig(
          existingProject,
          existingProject.defaultIdentity,
          handedOverTools,
        );
        working = applyProjectConfig(
          working,
          selectedHandover,
          projectRoot,
          identityId,
        );
      }
    }

    const risks =
      detail === "full"
        ? handoverRisks(working, identityId, selectedTools)
        : [];
    if (
      interactive &&
      (scope === "project" || existingProject) &&
      risks.length > 0 &&
      !(await wizardStep(
        prompt.confirm(
          `Trust ${risks.length} sensitive value${risks.length === 1 ? "" : "s"} or executable hook${risks.length === 1 ? "" : "s"} in this handover?`,
          { default: false, fallbackValue: false },
        ),
      ))
    ) {
      throw new Error(
        "Replace literal credentials and review executable hooks before trusting the handover",
      );
    }
    if (
      !interactive &&
      (scope === "project" || existingProject) &&
      risks.length > 0 &&
      !flags.yes
    ) {
      throw new Error(
        "Sensitive values or executable hooks require --yes in non-interactive mode",
      );
    }

    if (sshMode === "generate") {
      const git = working.identities[identityId]!.git!;
      git.sshKey = path.join(idealityHome, "ssh", identityId);
    }

    const projectConfig = createProjectConfig(
      working,
      identityId,
      selectedTools,
      { requirementsOnly: detail === "requirements" },
    );
    const nextConfig = applyProjectConfig(
      working,
      projectConfig,
      projectRoot,
      identityId,
    );
    const review = {
      project: projectRoot,
      identity: identityId,
      identityCreated: generatedIdentity,
      tools: selectedTools.sort(),
      handover: scope === "project" ? getProjectConfigPath(projectRoot) : null,
      handoverDetail: scope === "project" ? detail : null,
      integrations,
      secretBackend: nextConfig.secretBackend?.type ?? "file",
      handoverRisks: risks,
      execution: execution ?? { target: "host" },
    };
    const policyTarget = scope === "project" ? projectConfig : existingProject;
    const policyResult = await checkPresentProjectPolicy(
      projectRoot,
      policyTarget,
    );
    if (policyResult?.status === "fail") {
      const message = formatPolicyFailure(
        "Project setup violates team policy",
        policyResult.policyPath,
        policyResult.findings,
      );
      if (!flags["allow-policy-violations"]) {
        throw new Error(message);
      }
      const overrideMessage = formatPolicyFailure(
        "Project setup violates team policy; continuing because --allow-policy-violations was set",
        policyResult.policyPath,
        policyResult.findings,
      );
      if (interactive) {
        prompt.note(overrideMessage, "Policy override");
      } else {
        console.warn(overrideMessage);
      }
    }

    if (interactive) {
      prompt.note(
        [
          `Identity: ${identityId}${generatedIdentity ? " (new)" : ""}`,
          `Tools: ${selectedTools.join(", ")}`,
          `Handover: ${review.handover ?? "local only"}`,
          `Detail: ${review.handoverDetail ?? "not shared"}`,
          `Secrets: ${review.secretBackend}`,
          `Execution: ${execution?.target ?? "host"}${
            execution?.target === "vm"
              ? ` / ${execution.vm}`
              : execution?.network
                ? ` / ${execution.network}`
                : ""
          }`,
          `Integrations: ${integrations.join(", ") || "none"}`,
        ].join("\n"),
        "Review",
      );
      if (
        !flags.yes &&
        !(await wizardStep(
          prompt.confirm("Apply this project setup?", {
            default: true,
            fallbackValue: false,
          }),
        ))
      ) {
        prompt.cancel("No files were changed.");
        return;
      }
    }

    if (flags["dry-run"]) {
      printJson({
        ...review,
        localConfig: nextConfig,
        projectConfig: scope === "project" ? projectConfig : null,
      });
      return;
    }

    if (sshMode === "generate" && !flags["dry-run"]) {
      const git = working.identities[identityId]!.git!;
      git.sshKey = (
        await generateSshKey({
          identity: identityId,
          email: git.email,
          idealityHome,
        })
      ).privateKey;
    }

    const spin = interactive
      ? spinner({ text: "Applying project setup", showTimer: true })
      : null;
    spin?.start();
    try {
      await saveConfig(nextConfig);
      if (scope === "project") {
        await saveProjectConfig(projectRoot, projectConfig);
      }
      if (integrations.includes("git")) {
        await installGitIntegration(nextConfig, home, idealityHome);
      }
      if (integrations.includes("shims")) {
        await installShims(nextConfig, idealityHome);
      }
      if (integrations.includes("completions")) {
        await syncInstalledCompletions(nextConfig, idealityHome);
      }
      await recordAuditEvent(nextConfig, idealityHome, {
        eventType: "setup.decision",
        payload: {
          identity: identityId,
          scope,
          detail,
          execution: execution?.target ?? "host",
          tools: selectedTools,
          integrations,
          project: scope === "project",
          localOnly: scope === "local",
          dryRun: false,
        },
      });
      spin?.succeed("Project setup complete");
    } catch (error) {
      spin?.fail("Project setup failed");
      throw error;
    }

    if (interactive) {
      prompt.outro(
        `Ready. Verify with ${colors.cyan(`ideality status -C ${projectRoot}`)}`,
      );
    } else {
      console.log(colors.green(`Configured ${projectRoot}`));
      if (scope === "project") {
        console.log(`Handover: ${getProjectConfigPath(projectRoot)}`);
      }
    }
  },
});

export default setupCommand;
