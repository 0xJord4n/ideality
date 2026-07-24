import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import type { IdealityConfig } from "../domain/config.js";

export type CompletionShell = "zsh" | "bash" | "fish";

const COMMANDS = [
  "init",
  "setup",
  "status",
  "env",
  "run",
  "explain",
  "prompt",
  "auth",
  "secret",
  "identity",
  "tool",
  "plugin",
  "install",
  "rollback",
  "hook",
  "completion",
  "doctor",
  "config",
  "tui",
];

export function renderCompletion(
  shell: CompletionShell,
  values: { identities: string[]; tools: string[] },
): string {
  const commands = COMMANDS.join(" ");
  const identities = values.identities.join(" ");
  const tools = values.tools.join(" ");
  if (shell === "zsh") {
    return [
      "#compdef ideality",
      "_ideality() {",
      `  local -a commands identities tools`,
      `  commands=(${commands})`,
      `  identities=(${identities})`,
      `  tools=(${tools})`,
      "  _arguments '1:command:($commands)' '2:value:($identities $tools)' '*:argument:_files'",
      "}",
      "compdef _ideality ideality",
      "",
    ].join("\n");
  }
  if (shell === "bash") {
    return [
      "_ideality_completion() {",
      "  local cur",
      '  cur="${COMP_WORDS[COMP_CWORD]}"',
      `  COMPREPLY=( $(compgen -W '${commands} ${identities} ${tools}' -- "$cur") )`,
      "}",
      "complete -F _ideality_completion ideality",
      "",
    ].join("\n");
  }
  return [
    `complete -c ideality -f -n '__fish_use_subcommand' -a '${commands}'`,
    `complete -c ideality -f -a '${identities} ${tools}'`,
    "",
  ].join("\n");
}

export async function installCompletion(
  shell: CompletionShell,
  content: string,
  idealityHome: string,
): Promise<string> {
  const directory = path.join(idealityHome, "completions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `ideality.${shell}`);
  const temporary = `${file}.${process.pid}.tmp`;
  await Bun.write(temporary, content);
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  return file;
}

export async function syncInstalledCompletions(
  config: IdealityConfig,
  idealityHome: string,
): Promise<string[]> {
  const values = {
    identities: Object.keys(config.identities).sort(),
    tools: Object.keys(config.tools).sort(),
  };
  const installed: string[] = [];
  for (const shell of ["zsh", "bash", "fish"] as const) {
    const file = path.join(idealityHome, "completions", `ideality.${shell}`);
    if (await Bun.file(file).exists()) {
      installed.push(
        await installCompletion(
          shell,
          renderCompletion(shell, values),
          idealityHome,
        ),
      );
    }
  }
  return installed;
}
