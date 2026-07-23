import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { buildEnvironment } from "../core/environment.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import { printJson } from "./shared.js";

const statusCommand = defineCommand({
  name: "status",
  alias: ["whoami", "current"],
  description: "Show the identity active for a directory",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Override folder-based selection",
    }),
    json: option(z.boolean().default(false), {
      description: "Emit JSON",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, colors }) => {
    const runtime = await loadRuntime(flags.path, flags.identity);
    const tools = await Promise.all(
      Object.entries(runtime.resolved.identity.tools).map(
        async ([name, profile]) => {
          const environment = await buildEnvironment(
            runtime.config,
            runtime.resolved,
            {
              home: runtime.home,
              idealityHome: runtime.idealityHome,
              tool: name,
            },
          );
          const executable = resolveExecutable(
            runtime.config,
            name,
            profile.executable,
          );
          return {
            name,
            enabled: profile.enabled !== false,
            installed: executable ? Boolean(Bun.which(executable)) : false,
            executable,
            isolation:
              profile.isolation ??
              runtime.config.tools[name]?.isolation ??
              "shell",
            environment: environment.redacted,
          };
        },
      ),
    );
    const output = {
      identity: runtime.resolved.id,
      label: runtime.resolved.identity.label,
      path: runtime.resolved.path,
      matchedRoot: runtime.resolved.matchedRoot,
      default: runtime.resolved.isDefault,
      git: runtime.resolved.identity.git ?? null,
      tools,
    };
    if (flags.json) {
      printJson(output);
      return;
    }
    console.log(
      `${colors.bold(output.label)} ${colors.dim(`(${output.identity})`)}`,
    );
    console.log(
      `path  ${output.path}\nmatch ${output.matchedRoot ?? "<default identity>"}`,
    );
    if (output.git) {
      console.log(`git   ${output.git.name} <${output.git.email}>`);
      console.log(`ssh   ${output.git.sshKey ?? "<default SSH agent>"}`);
    }
    console.log();
    for (const tool of tools) {
      const marker = tool.installed ? colors.green("ready") : colors.yellow("missing");
      console.log(
        `${tool.name.padEnd(10)} ${marker.padEnd(16)} ${tool.isolation.padEnd(8)} ${tool.executable ?? "-"}`,
      );
    }
  },
});

export default statusCommand;
