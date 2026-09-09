/** Grouped command registry; drives registration, help output, and completions. */
export const IDEALITY_COMMAND_GROUPS = [
  {
    title: "Get started",
    commands: ["init", "setup", "tui", "status"],
  },
  {
    title: "Everyday",
    commands: ["run", "env", "explain", "prompt", "skills"],
  },
  {
    title: "Identities & tools",
    commands: ["identity", "tool", "plugin", "auth", "secret"],
  },
  {
    title: "Shell & Git integration",
    commands: ["install", "enable", "disable", "hook", "completion"],
  },
  {
    title: "Isolation",
    commands: ["network", "vm", "policy"],
  },
  {
    title: "Care & recovery",
    commands: ["doctor", "audit", "rollback", "config", "update"],
  },
] as const;

export const IDEALITY_COMMAND_NAMES: readonly string[] =
  IDEALITY_COMMAND_GROUPS.flatMap((group) => group.commands);
