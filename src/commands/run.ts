import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import {
  buildChildEnvironment,
  buildEnvironment,
} from "../core/environment.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import { commandArguments, requirePositional } from "./shared.js";

const runCommand = defineCommand({
  name: "run",
  alias: "x",
  description: "Run a tool inside its selected identity",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Override folder-based selection",
    }),
  },
  handler: async ({ positional, flags, signal }) => {
    const tool = requirePositional(positional, 0, "tool name");
    const runtime = await loadRuntime(flags.path, flags.identity);
    const profile = runtime.resolved.identity.tools[tool];
    const environment = await buildEnvironment(runtime.config, runtime.resolved, {
      home: runtime.home,
      idealityHome: runtime.idealityHome,
      tool,
    });
    const executable = resolveExecutable(
      runtime.config,
      tool,
      profile?.executable,
    );
    if (!executable) {
      throw new Error(`Executable for tool '${tool}' is not installed`);
    }
    const childEnv = buildChildEnvironment(runtime.config, environment);
    const userArgs = commandArguments(positional, 1);
    const child = Bun.spawn([executable, ...environment.args, ...userArgs], {
      cwd: flags.path,
      env: childEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      signal,
    });
    process.exitCode = await child.exited;
  },
});

export default runCommand;
