import os from "node:os";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import {
  authArguments,
  collectAuthHealth,
  type AuthHealthState,
} from "../core/auth.js";
import { getIdealityHome, loadConfig } from "../core/config-store.js";
import {
  buildChildEnvironment,
  buildEnvironment,
} from "../core/environment.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import type { AuthAction } from "../domain/config.js";
import { commandArguments, printJson, requirePositional } from "./shared.js";

const ACTIONS = new Set<AuthAction>(["login", "status", "logout"]);

const authCommand = defineCommand({
  name: "auth",
  description: "Manage a tool's authentication inside one identity",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Override folder-based selection",
    }),
    all: option(z.boolean().default(false), {
      description: "Report auth status for every identity/tool pairing",
      argumentKind: "flag",
    }),
    json: option(z.boolean().default(false), {
      description: "Emit JSON (with --all)",
      argumentKind: "flag",
    }),
  },
  handler: async ({ positional, flags, signal, colors }) => {
    if (flags.all) {
      const action = positional[0] ?? "status";
      if (action !== "status") {
        throw new Error(`Auth --all supports only the status action`);
      }
      const results = await collectAuthHealth(await loadConfig(), {
        home: os.homedir(),
        idealityHome: getIdealityHome(),
      });
      if (flags.json) {
        printJson(results);
        return;
      }
      const markers: Record<AuthHealthState, string> = {
        "logged-in": colors.green("logged-in"),
        expired: colors.red("expired"),
        unavailable: colors.yellow("unavailable"),
        unsupported: colors.dim("unsupported"),
      };
      for (const result of results) {
        console.log(
          `${result.identity.padEnd(12)} ${result.tool.padEnd(10)} ${markers[
            result.state
          ].padEnd(22)} ${result.detail}`,
        );
      }
      return;
    }

    const tool = requirePositional(positional, 0, "tool name");
    const runtime = await loadRuntime(flags.path, flags.identity);
    if (tool === "list") {
      for (const [name, definition] of Object.entries(runtime.config.tools)) {
        const actions = Object.keys(definition.auth ?? {});
        if (actions.length) {
          console.log(`${name.padEnd(12)} ${actions.join(", ")}`);
        }
      }
      return;
    }

    const requested = positional[1] ?? "status";
    if (!ACTIONS.has(requested as AuthAction)) {
      throw new Error(`Auth action must be login, status, or logout`);
    }
    const action = requested as AuthAction;
    const definition = runtime.config.tools[tool];
    if (!definition) {
      throw new Error(`Tool '${tool}' does not exist`);
    }
    const profile = runtime.resolved.identity.tools[tool];
    const executable = resolveExecutable(
      runtime.config,
      tool,
      profile?.executable,
    );
    if (!executable) {
      throw new Error(`Executable for tool '${tool}' is not installed`);
    }
    const environment = await buildEnvironment(
      runtime.config,
      runtime.resolved,
      {
        home: runtime.home,
        idealityHome: runtime.idealityHome,
        tool,
      },
    );
    const extra = commandArguments(positional, 2);
    console.log(
      colors.dim(`${runtime.resolved.id}/${tool}: ${action} via ${executable}`),
    );
    const child = Bun.spawn(
      [
        executable,
        ...environment.args,
        ...authArguments(definition, action),
        ...extra,
      ],
      {
        cwd: flags.path,
        env: buildChildEnvironment(runtime.config, environment),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        signal,
      },
    );
    process.exitCode = await child.exited;
  },
});

export default authCommand;
