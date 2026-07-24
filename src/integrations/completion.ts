export type CompletionShell = "zsh" | "bash" | "fish";

const COMMANDS = [
  "init",
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
