import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  installAgentSkills,
  type SkillsPackageRunner,
} from "../core/agent-skills.js";

function commaSeparated(values: Array<string | undefined>): string[] {
  return values
    .flatMap((value) => (value ?? "").split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function repeatedOptionValues(
  argv: string[],
  longName: string,
  shortName: string,
  fallback?: string,
): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === longName || argument === shortName) {
      const value = argv[index + 1];
      if (value !== undefined) values.push(value);
      index += 1;
      continue;
    }
    if (argument.startsWith(`${longName}=`)) {
      values.push(argument.slice(longName.length + 1));
    }
  }
  return commaSeparated(values.length > 0 ? values : [fallback]);
}

function displayCommand(command: string[]): string {
  return command.map((part) => JSON.stringify(part)).join(" ");
}

const skillsCommand = defineGroup({
  name: "skills",
  description: "Install Ideality agent skills with the Vercel Skills CLI",
  commands: [
    defineCommand({
      name: "install",
      description: "Install the skills package into supported coding agents",
      options: {
        runner: option(z.enum(["auto", "bunx", "npx"]).default("auto"), {
          description: "Package runner (auto prefers bunx, then npx)",
        }),
        skill: option(z.string().optional(), {
          short: "s",
          description: "Skill name; repeat or comma-separate (default: choose)",
        }),
        agent: option(z.string().optional(), {
          short: "a",
          description: "Agent ID; repeat or comma-separate",
        }),
        global: option(z.boolean().default(false), {
          short: "g",
          description: "Install for the current user instead of this project",
          argumentKind: "flag",
        }),
        copy: option(z.boolean().default(false), {
          description: "Copy skill files instead of creating symlinks",
          argumentKind: "flag",
        }),
        list: option(z.boolean().default(false), {
          description: "List available Ideality skills without installing",
          argumentKind: "flag",
        }),
        all: option(z.boolean().default(false), {
          description: "Install every skill into every detected agent",
          argumentKind: "flag",
        }),
        yes: option(z.boolean().default(false), {
          short: "y",
          description: "Skip Vercel Skills confirmation prompts",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Print the external command without executing it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors, signal }) => {
        const argv = process.argv.slice(2);
        const result = await installAgentSkills({
          agents: repeatedOptionValues(argv, "--agent", "-a", flags.agent),
          all: flags.all,
          copy: flags.copy,
          dryRun: flags["dry-run"],
          global: flags.global,
          list: flags.list,
          runner: flags.runner as SkillsPackageRunner,
          signal,
          skills: repeatedOptionValues(argv, "--skill", "-s", flags.skill),
          yes: flags.yes,
        });
        if (!result.executed) {
          console.log(`Would run: ${displayCommand(result.command)}`);
          return;
        }
        console.log(
          colors.green(
            `Vercel Skills installer completed with ${result.runner}.`,
          ),
        );
      },
    }),
  ],
});

export default skillsCommand;
