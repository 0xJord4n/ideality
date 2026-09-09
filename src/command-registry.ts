import type { Command } from "@bunli/core";

// Command implementations have intentionally heterogeneous option/store schemas.
// biome-ignore lint/suspicious/noExplicitAny: registry erases those schemas after construction
type AnyCommand = Command<any, any, any>;

export interface LazyCommandRegistration {
  name: string;
  description: string;
  aliases: readonly string[];
  load(): Promise<AnyCommand>;
}

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  init: "Set up your first folder-based identity",
  setup: "Configure the current project with an interactive wizard",
  tui: "Open the interactive identity, plugin, and secret dashboard",
  status: "Show the identity active for a directory",
  run: "Run a tool inside its selected identity",
  env: "Render the selected identity environment",
  explain: "Explain how a tool invocation will be isolated",
  prompt: "Render the active identity for a shell prompt",
  skills: "Install Ideality agent skills with the Vercel Skills CLI",
  identity: "Create and manage identities",
  tool: "Manage built-in and custom tool adapters",
  plugin: "Install portable declarative tool integrations",
  auth: "Manage a tool's authentication inside one identity",
  secret: "Manage process-scoped secret references and backends",
  install: "Install shell and Git integrations",
  enable: "Enable shell shims and Git identity routing",
  disable: "Disable shell shims and Git routing without deleting config",
  hook: "Print a shell hook",
  completion: "Generate shell completions",
  network: "Manage enforced VPN and network profiles",
  vm: "Manage isolated execution machines",
  policy: "Team policy contracts for project handovers",
  doctor: "Audit identity configuration and local tooling",
  audit: "Administer opt-in local structured audit history",
  rollback: "List or restore transactional registry snapshots",
  config: "Inspect or edit the registry",
  update: "Safely update a direct binary install",
};

function registration(
  name: string,
  load: () => Promise<{ default: AnyCommand }>,
  aliases: readonly string[] = [],
): LazyCommandRegistration {
  const description = COMMAND_DESCRIPTIONS[name];
  if (!description) throw new Error(`Missing command metadata for '${name}'`);
  return {
    name,
    description,
    aliases,
    load: async () => (await load()).default,
  };
}

/** Lightweight top-level metadata. Command modules are evaluated on demand. */
export const IDEALITY_COMMAND_REGISTRY: readonly LazyCommandRegistration[] = [
  registration("init", () => import("./commands/init.js")),
  registration("setup", () => import("./commands/setup.js")),
  registration("tui", () => import("./commands/tui.js")),
  registration("status", () => import("./commands/status.js"), [
    "whoami",
    "current",
  ]),
  registration("run", () => import("./commands/run.js"), ["x"]),
  registration("env", () => import("./commands/env.js")),
  registration("explain", () => import("./commands/explain.js")),
  registration("prompt", () => import("./commands/prompt.js")),
  registration("skills", () => import("./commands/skills.js")),
  registration("identity", () => import("./commands/identity.js"), ["id"]),
  registration("tool", () => import("./commands/tool.js")),
  registration("plugin", () => import("./commands/plugin.js")),
  registration("auth", () => import("./commands/auth.js")),
  registration("secret", () => import("./commands/secret.js")),
  registration("install", () => import("./commands/install.js")),
  registration("enable", () => import("./commands/enable.js")),
  registration("disable", () => import("./commands/disable.js")),
  registration("hook", () => import("./commands/hook.js")),
  registration("completion", () => import("./commands/completion.js")),
  registration("network", () => import("./commands/network.js"), ["vpn"]),
  registration("vm", () => import("./commands/vm.js")),
  registration("policy", () => import("./commands/policy.js")),
  registration("doctor", () => import("./commands/doctor.js")),
  registration("audit", () => import("./commands/audit.js")),
  registration("rollback", () => import("./commands/rollback.js")),
  registration("config", () => import("./commands/config.js")),
  registration("update", () => import("./commands/update.js")),
];

const BOOLEAN_GLOBAL_FLAGS = new Set([
  "--help",
  "-h",
  "--version",
  "-v",
  "--llms",
  "--llms-full",
]);
const VALUE_GLOBAL_FLAGS = new Set(["--format", "--image-mode"]);

function booleanFlagEnabled(
  args: readonly string[],
  longName: string,
  shortName?: string,
): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") break;
    if (arg === longName || (shortName && arg === shortName)) {
      return args[index + 1] !== "false";
    }
    if (arg === `${longName}=true`) return true;
  }
  return false;
}

function topLevelToken(args: readonly string[]): string | null {
  const commandArgs = args.slice(
    0,
    args.indexOf("--") < 0 ? undefined : args.indexOf("--"),
  );
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (!arg) continue;
    const optionName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (BOOLEAN_GLOBAL_FLAGS.has(optionName)) {
      if (
        !arg.includes("=") &&
        ["true", "false"].includes(commandArgs[index + 1] ?? "")
      ) {
        index += 1;
      }
      continue;
    }
    if (VALUE_GLOBAL_FLAGS.has(optionName)) {
      if (!arg.includes("=") && commandArgs[index + 1] !== undefined)
        index += 1;
      continue;
    }
    return arg;
  }
  return null;
}

function loadAllCommands(
  registry: readonly LazyCommandRegistration[],
): Promise<AnyCommand[]> {
  return Promise.all(registry.map(({ load }) => load()));
}

function metadataCommands(
  registry: readonly LazyCommandRegistration[],
): AnyCommand[] {
  return registry.map(({ name, description, aliases }) => ({
    name,
    description,
    alias: [...aliases],
    handler: async () => {},
  }));
}

export async function commandsForInvocation(
  argv: readonly string[],
  registry: readonly LazyCommandRegistration[] = IDEALITY_COMMAND_REGISTRY,
): Promise<AnyCommand[]> {
  if (booleanFlagEnabled(argv, "--version", "-v")) return [];
  if (
    booleanFlagEnabled(argv, "--llms") ||
    booleanFlagEnabled(argv, "--llms-full")
  ) {
    return loadAllCommands(registry);
  }

  const token = topLevelToken(argv);
  if (!token) return metadataCommands(registry);
  const selected = registry.find(
    ({ name, aliases }) => name === token || aliases.includes(token),
  );
  return selected ? [await selected.load()] : metadataCommands(registry);
}
