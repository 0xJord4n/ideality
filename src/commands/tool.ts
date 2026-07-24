import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { resolveExecutable } from "../core/runtime.js";
import type { ValueSource } from "../domain/config.js";
import { installShims } from "../integrations/shims.js";
import { commandArguments, requirePositional } from "./shared.js";

function parseSource(value: string, optional: boolean): ValueSource | null {
  if (value === "unset") {
    return null;
  }
  if (value.startsWith("file:")) {
    return { from: "file", path: value.slice(5), optional };
  }
  if (value.startsWith("env:")) {
    return { from: "env", name: value.slice(4), optional };
  }
  return value.startsWith("value:") ? value.slice(6) : value;
}

const toolCommand = defineGroup({
  name: "tool",
  description: "Manage built-in and custom tool adapters",
  commands: [
    defineCommand({
      name: "list",
      description: "List tool definitions",
      handler: async ({ colors }) => {
        const config = await loadConfig();
        for (const [name, tool] of Object.entries(config.tools)) {
          const installed = Boolean(resolveExecutable(config, name));
          console.log(
            `${name.padEnd(12)} ${(tool.isolation ?? "shell").padEnd(8)} ${
              installed ? colors.green("ready") : colors.yellow("missing")
            }  ${tool.executable}`,
          );
        }
      },
    }),
    defineCommand({
      name: "add",
      description: "Register a custom executable",
      options: {
        executable: option(z.string(), {
          short: "x",
          description: "Executable name or path",
        }),
        isolation: option(z.enum(["shell", "process"]).default("process"), {
          description: "Environment scope",
        }),
        description: option(z.string().optional(), {
          description: "Human-readable description",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const name = requirePositional(positional, 0, "tool name");
        const config = await loadConfig();
        if (config.tools[name]) {
          throw new Error(`Tool '${name}' already exists`);
        }
        config.tools[name] = {
          executable: flags.executable,
          isolation: flags.isolation,
          description: flags.description,
        };
        await saveConfig(config);
        await installShims(config, getIdealityHome());
        console.log(colors.green(`Registered custom tool '${name}'`));
      },
    }),
    defineCommand({
      name: "remove",
      description: "Remove a tool definition and its identity profiles",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Confirm removal",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const name = requirePositional(positional, 0, "tool name");
        if (!flags.force) {
          throw new Error("Tool removal requires --force");
        }
        const config = await loadConfig();
        if (!config.tools[name]) {
          throw new Error(`Tool '${name}' does not exist`);
        }
        delete config.tools[name];
        for (const identity of Object.values(config.identities)) {
          delete identity.tools[name];
        }
        await saveConfig(config);
        await installShims(config, getIdealityHome());
        console.log(colors.green(`Removed tool '${name}'`));
      },
    }),
    defineCommand({
      name: "env",
      description: "Set a profile variable: file:path, env:NAME, value:text, or unset",
      options: {
        optional: option(z.boolean().default(false), {
          description: "Allow a missing file or source variable",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const toolName = requirePositional(positional, 1, "tool name");
        const variable = requirePositional(positional, 2, "variable name");
        const value = requirePositional(positional, 3, "value source");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
          throw new Error(`Invalid environment variable name '${variable}'`);
        }
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity) {
          throw new Error(`Identity '${identityId}' does not exist`);
        }
        if (!config.tools[toolName]) {
          throw new Error(`Tool '${toolName}' does not exist`);
        }
        const profile = (identity.tools[toolName] ??= {});
        profile.env ??= {};
        profile.env[variable] = parseSource(value, flags.optional);
        await saveConfig(config);
        console.log(colors.green(`Updated ${identityId}/${toolName}:${variable}`));
      },
    }),
    defineCommand({
      name: "args",
      description: "Replace identity-specific tool arguments",
      handler: async ({ positional, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const toolName = requirePositional(positional, 1, "tool name");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity || !config.tools[toolName]) {
          throw new Error(`Unknown identity or tool`);
        }
        (identity.tools[toolName] ??= {}).args = commandArguments(positional, 2);
        await saveConfig(config);
        console.log(colors.green(`Updated arguments for ${identityId}/${toolName}`));
      },
    }),
    ...(["enable", "disable"] as const).map((action) =>
      defineCommand({
        name: action,
        description: `${action === "enable" ? "Enable" : "Disable"} a tool for one identity`,
        handler: async ({ positional, colors }) => {
          const identityId = requirePositional(positional, 0, "identity ID");
          const toolName = requirePositional(positional, 1, "tool name");
          const config = await loadConfig();
          const identity = config.identities[identityId];
          if (!identity || !config.tools[toolName]) {
            throw new Error("Unknown identity or tool");
          }
          (identity.tools[toolName] ??= {}).enabled = action === "enable";
          await saveConfig(config);
          console.log(colors.green(`${action}d ${identityId}/${toolName}`));
        },
      }),
    ),
  ],
});

export default toolCommand;
