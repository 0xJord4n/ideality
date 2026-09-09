import { existsSync } from "node:fs";

import type { CLIOption, HelpRenderContext } from "@bunli/core";
import { colors } from "@bunli/utils";

import { getConfigPath } from "../core/config-store.js";
import { IDEALITY_COMMAND_GROUPS } from "./names.js";
import { GLYPHS, commandText, hintLines, section } from "./ui.js";

type AnyCommand = HelpRenderContext["commands"][number];

/** Usage overrides for commands whose positional arguments bunli cannot see. */
const USAGE_OVERRIDES: Record<string, string> = {
  run: "ideality run <tool> [options] [-- tool-args...]",
  explain: "ideality explain <tool> [options]",
  completion: "ideality completion <zsh|bash|fish> [options]",
  rollback: "ideality rollback [snapshot] [options]",
};

const EXAMPLES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  init: [
    ["ideality init", "guided first-identity setup"],
    ["ideality init --non-interactive --label Work", "scripted setup"],
  ],
  setup: [["ideality setup", "adopt the current project interactively"]],
  status: [
    ["ideality status", "identity active in this directory"],
    ["ideality status -C ~/code/acme", "identity another folder would use"],
  ],
  run: [
    ["ideality run gh -- pr list", "run gh as the folder's identity"],
    ["ideality x claude", "alias of run"],
  ],
  env: [
    ["ideality env", "environment for the folder's identity"],
    ["ideality env --shell fish", "emit fish-compatible exports"],
  ],
  explain: [["ideality explain gh", "how a gh call will be isolated"]],
  identity: [
    ["ideality identity list", "every identity and its folders"],
    ["ideality identity add work --label Work", "create an identity"],
  ],
  secret: [
    ["ideality secret set work gh GH_TOKEN", "store a secret value"],
    ["ideality secret list", "configured secret references"],
  ],
  doctor: [
    ["ideality doctor", "full health check"],
    ["ideality doctor --strict", "treat warnings as failures"],
  ],
  rollback: [
    ["ideality rollback --list", "list registry snapshots"],
    ["ideality rollback", "restore the most recent snapshot"],
  ],
  tui: [["ideality tui", "full-screen dashboard"]],
  completion: [
    ["ideality completion zsh --install", "install zsh completions"],
  ],
};

function optionRows(
  options: Record<string, CLIOption> | undefined,
): Array<{ label: string; description: string }> {
  if (!options) return [];
  return Object.entries(options).map(([name, opt]) => {
    const short = opt.short ? `-${opt.short}, ` : "    ";
    const value = opt.argumentKind === "flag" ? "" : " <value>";
    return {
      label: `${short}--${name}${value}`,
      description: opt.description ?? "",
    };
  });
}

function alignRows(
  rows: ReadonlyArray<{ label: string; description: string }>,
  indent = "  ",
): string[] {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  return rows.map(
    (row) =>
      `${indent}${commandText(row.label.padEnd(width))}  ${colors.dim(row.description)}`,
  );
}

function commandAliases(command: AnyCommand): string[] {
  if (!command.alias) return [];
  return Array.isArray(command.alias) ? command.alias : [command.alias];
}

/** Render the branded, grouped root help screen. */
export function renderRootHelpText(
  ctx: Pick<HelpRenderContext, "cliName" | "version" | "commands">,
  configured: boolean = existsSync(getConfigPath()),
): string {
  const byName = new Map(
    ctx.commands.map((command) => [command.name, command]),
  );
  const lines: string[] = [];
  lines.push(
    `${colors.bold(ctx.cliName)} ${colors.dim(`v${ctx.version}`)}  ${colors.cyan(
      "one machine, many developer identities",
    )}`,
  );
  lines.push(
    colors.dim(
      "  Bind an identity to a folder; Git, CLIs, and agents switch with it.",
    ),
  );
  lines.push("");
  lines.push(section("Usage"));
  lines.push(`  ${commandText("ideality <command> [options]")}`);
  if (!configured) {
    lines.push("");
    lines.push(section("First time here?"));
    lines.push(
      `  ${GLYPHS.pointer} ${commandText("ideality init")}  ${colors.dim(
        "guided setup, about a minute, review before writing",
      )}`,
    );
  }
  for (const group of IDEALITY_COMMAND_GROUPS) {
    const rows = group.commands.flatMap((name) => {
      const command = byName.get(name);
      return command
        ? [{ label: command.name, description: command.description ?? "" }]
        : [];
    });
    if (rows.length === 0) continue;
    lines.push("");
    lines.push(section(group.title));
    lines.push(...alignRows(rows));
  }
  lines.push("");
  lines.push(
    hintLines([
      "ideality <command> --help  shows flags and examples",
      "ideality tui  opens the interactive dashboard",
    ]),
  );
  return lines.join("\n");
}

/** Render help for a single command or command group. */
export function renderCommandHelpText(
  ctx: Pick<HelpRenderContext, "cliName" | "version">,
  command: AnyCommand,
  path: string[] = [],
): string {
  const fullName = [ctx.cliName, ...path, command.name].join(" ");
  const lines: string[] = [];
  const aliasSuffix =
    commandAliases(command).length > 0
      ? colors.dim(`  (alias: ${commandAliases(command).join(", ")})`)
      : "";
  lines.push(`${colors.bold(fullName)}${aliasSuffix}`);
  if (command.description) {
    lines.push(colors.dim(`  ${command.description}`));
  }
  lines.push("");
  lines.push(section("Usage"));
  const usage = path.length === 0 ? USAGE_OVERRIDES[command.name] : undefined;
  if (usage) {
    lines.push(`  ${commandText(usage)}`);
  } else if (command.commands && command.commands.length > 0) {
    lines.push(`  ${commandText(`${fullName} <subcommand> [options]`)}`);
  } else {
    lines.push(`  ${commandText(`${fullName} [options]`)}`);
  }

  const subcommands = command.commands ?? [];
  if (subcommands.length > 0) {
    lines.push("");
    lines.push(section("Subcommands"));
    lines.push(
      ...alignRows(
        subcommands.map((sub) => ({
          label: sub.name,
          description: sub.description ?? "",
        })),
      ),
    );
  }

  const options = optionRows(command.options as Record<string, CLIOption>);
  if (options.length > 0) {
    lines.push("");
    lines.push(section("Options"));
    lines.push(...alignRows(options));
  }

  const examples = path.length === 0 ? EXAMPLES[command.name] : undefined;
  if (examples) {
    lines.push("");
    lines.push(section("Examples"));
    const width = examples.reduce(
      (max, [invocation]) => Math.max(max, invocation.length),
      0,
    );
    for (const [invocation, note] of examples) {
      lines.push(
        `  ${commandText(invocation.padEnd(width))}  ${colors.dim(note)}`,
      );
    }
  }
  if (subcommands.length > 0) {
    lines.push("");
    lines.push(
      hintLines([`${fullName} <subcommand> --help  shows one subcommand`]),
    );
  }
  return lines.join("\n");
}

/** bunli help renderer: branded output for humans (JSON stays untouched for agents). */
export function idealityHelpRenderer(ctx: HelpRenderContext): void {
  if (ctx.command) {
    console.log(renderCommandHelpText(ctx, ctx.command, ctx.path));
  } else {
    console.log(renderRootHelpText(ctx));
  }
}
