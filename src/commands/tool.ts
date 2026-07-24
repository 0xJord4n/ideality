import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import { BUILTIN_TOOL_PACKS, BUILTIN_TOOLS } from "../adapters/builtins.js";
import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { resolveExecutable } from "../core/runtime.js";
import { createToolProfiles } from "../core/starter.js";
import type { ValueSource } from "../domain/config.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
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
  if (value.startsWith("secret:")) {
    return { from: "secret", key: value.slice(7), optional };
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
            `${name.padEnd(14)} ${(tool.pack ?? "custom").padEnd(15)} ${(tool.stateIsolation ?? "partial").padEnd(11)} ${
              installed ? colors.green("ready") : colors.yellow("missing")
            }  ${tool.executable}`,
          );
        }
      },
    }),
    defineCommand({
      name: "packs",
      description: "List built-in tool packs",
      handler: async () => {
        for (const [id, pack] of Object.entries(BUILTIN_TOOL_PACKS)) {
          console.log(
            `${id.padEnd(16)} ${pack.label}\n${"".padEnd(18)}${pack.tools.join(", ")}`,
          );
        }
      },
    }),
    ...(["enable-pack", "disable-pack"] as const).map((action) =>
      defineCommand({
        name: action,
        description: `${action === "enable-pack" ? "Enable" : "Disable"} every tool in a built-in pack`,
        options: {
          "dry-run": option(z.boolean().default(false), {
            description: "Show the change without saving it",
            argumentKind: "flag",
          }),
        },
        handler: async ({ positional, flags, colors }) => {
          const identityId = requirePositional(positional, 0, "identity ID");
          const packId = requirePositional(positional, 1, "tool pack");
          const config = await loadConfig();
          const identity = config.identities[identityId];
          const pack = BUILTIN_TOOL_PACKS[packId];
          if (!identity) {
            throw new Error(`Identity '${identityId}' does not exist`);
          }
          if (!pack) throw new Error(`Tool pack '${packId}' does not exist`);
          const profiles = createToolProfiles(
            identityId,
            pack.tools,
            identity.git?.sshKey,
          );
          for (const tool of pack.tools) {
            if (!BUILTIN_TOOLS[tool]) continue;
            identity.tools[tool] = {
              ...(profiles[tool] ?? {}),
              ...(identity.tools[tool] ?? {}),
              enabled: action === "enable-pack",
            };
          }
          if (!flags["dry-run"]) {
            await saveConfig(config);
            await installShims(config, getIdealityHome());
            await syncInstalledCompletions(config, getIdealityHome());
          }
          console.log(
            colors.green(
              `${action === "enable-pack" ? "Enabled" : "Disabled"} '${packId}' for '${identityId}'`,
            ),
          );
        },
      }),
    ),
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
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
          argumentKind: "flag",
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
        if (!flags["dry-run"]) {
          await saveConfig(config);
          await installShims(config, getIdealityHome());
          await syncInstalledCompletions(config, getIdealityHome());
        }
        console.log(
          flags["dry-run"]
            ? `Would register custom tool '${name}'`
            : colors.green(`Registered custom tool '${name}'`),
        );
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
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
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
        if (!flags["dry-run"]) {
          await saveConfig(config);
          await installShims(config, getIdealityHome());
          await syncInstalledCompletions(config, getIdealityHome());
        }
        console.log(
          flags["dry-run"]
            ? `Would remove tool '${name}'`
            : colors.green(`Removed tool '${name}'`),
        );
      },
    }),
    defineCommand({
      name: "env",
      description:
        "Set a variable: secret:key, file:path, env:NAME, value:text, or unset",
      options: {
        optional: option(z.boolean().default(false), {
          description: "Allow a missing file or source variable",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
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
        if (!flags["dry-run"]) await saveConfig(config);
        console.log(
          colors.green(`Updated ${identityId}/${toolName}:${variable}`),
        );
      },
    }),
    defineCommand({
      name: "args",
      description: "Replace identity-specific tool arguments",
      options: {
        "dry-run": option(z.boolean().default(false), {
          description: "Show the change without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const toolName = requirePositional(positional, 1, "tool name");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        if (!identity || !config.tools[toolName]) {
          throw new Error(`Unknown identity or tool`);
        }
        (identity.tools[toolName] ??= {}).args = commandArguments(
          positional,
          2,
        );
        if (!flags["dry-run"]) await saveConfig(config);
        console.log(
          colors.green(`Updated arguments for ${identityId}/${toolName}`),
        );
      },
    }),
    ...(["enable", "disable"] as const).map((action) =>
      defineCommand({
        name: action,
        description: `${action === "enable" ? "Enable" : "Disable"} a tool for one identity`,
        options: {
          "dry-run": option(z.boolean().default(false), {
            description: "Show the change without saving it",
            argumentKind: "flag",
          }),
        },
        handler: async ({ positional, flags, colors }) => {
          const identityId = requirePositional(positional, 0, "identity ID");
          const toolName = requirePositional(positional, 1, "tool name");
          const config = await loadConfig();
          const identity = config.identities[identityId];
          if (!identity || !config.tools[toolName]) {
            throw new Error("Unknown identity or tool");
          }
          const starter =
            createToolProfiles(identityId, [toolName], identity.git?.sshKey)[
              toolName
            ] ?? {};
          identity.tools[toolName] = {
            ...starter,
            ...(identity.tools[toolName] ?? {}),
            enabled: action === "enable",
          };
          if (!flags["dry-run"]) {
            await saveConfig(config);
            await installShims(config, getIdealityHome());
            await syncInstalledCompletions(config, getIdealityHome());
          }
          console.log(colors.green(`${action}d ${identityId}/${toolName}`));
        },
      }),
    ),
  ],
});

export default toolCommand;
