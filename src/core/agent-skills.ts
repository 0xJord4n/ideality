import type { ProcessRunner } from "./process.js";
import { runProcess } from "./process.js";
import { findExecutable } from "./runtime.js";

export const IDEALITY_SKILLS_SOURCE = "0xJord4n/ideality";

export type SkillsPackageRunner = "auto" | "bunx" | "npx";

export interface ResolvedSkillsRunner {
  executable: string;
  runner: Exclude<SkillsPackageRunner, "auto">;
}

export interface AgentSkillsInstallOptions {
  agents?: string[];
  all?: boolean;
  copy?: boolean;
  dryRun?: boolean;
  global?: boolean;
  list?: boolean;
  runner?: SkillsPackageRunner;
  signal?: AbortSignal;
  skills?: string[];
  yes?: boolean;
}

export interface AgentSkillsInstallResult {
  command: string[];
  executed: boolean;
  runner: Exclude<SkillsPackageRunner, "auto">;
}

type ExecutableFinder = (command: string) => string | null;

export function resolveSkillsRunner(
  requested: SkillsPackageRunner = "auto",
  finder: ExecutableFinder = findExecutable,
): ResolvedSkillsRunner {
  const candidates: Array<Exclude<SkillsPackageRunner, "auto">> =
    requested === "auto" ? ["bunx", "npx"] : [requested];
  for (const runner of candidates) {
    const executable = finder(runner);
    if (executable) return { executable, runner };
  }
  if (requested !== "auto") {
    throw new Error(
      `${requested} is not installed or is not executable on PATH.`,
    );
  }
  throw new Error(
    "No supported package runner found. Install Bun (bunx) or Node.js (npx), then retry.",
  );
}

export function buildSkillsInstallCommand(
  options: AgentSkillsInstallOptions,
  resolved: ResolvedSkillsRunner,
): string[] {
  const command = [
    resolved.executable,
    "skills",
    "add",
    IDEALITY_SKILLS_SOURCE,
  ];
  for (const skill of options.skills ?? []) {
    command.push("--skill", skill);
  }
  for (const agent of options.agents ?? []) {
    command.push("--agent", agent);
  }
  if (options.global) command.push("--global");
  if (options.copy) command.push("--copy");
  if (options.list) command.push("--list");
  if (options.all) command.push("--all");
  if (options.yes) command.push("--yes");
  return command;
}

export async function installAgentSkills(
  options: AgentSkillsInstallOptions = {},
  dependencies: {
    findExecutable?: ExecutableFinder;
    runProcess?: ProcessRunner;
  } = {},
): Promise<AgentSkillsInstallResult> {
  const resolved = resolveSkillsRunner(
    options.runner,
    dependencies.findExecutable,
  );
  const command = buildSkillsInstallCommand(options, resolved);
  if (options.dryRun) {
    return { command, executed: false, runner: resolved.runner };
  }
  const result = await (dependencies.runProcess ?? runProcess)(command, {
    inherit: true,
    signal: options.signal,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Vercel Skills installer exited with code ${result.exitCode}.`,
    );
  }
  return { command, executed: true, runner: resolved.runner };
}
