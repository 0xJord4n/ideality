import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { buildEnvironment } from "../core/environment.js";
import { resolveExecution, summarizeExecution } from "../core/execution.js";
import { loadActiveNetwork } from "../core/network.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import { printJson } from "./shared.js";
import { hintLines, keyValue, statusGlyph, table, tidyPath } from "./ui.js";

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
            installed: Boolean(executable),
            executable,
            isolation:
              profile.isolation ??
              runtime.config.tools[name]?.isolation ??
              "shell",
            environment: environment.redacted,
            execution: summarizeExecution(
              resolveExecution(runtime.config, runtime.resolved, name),
            ),
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
      execution: summarizeExecution(
        resolveExecution(runtime.config, runtime.resolved),
      ),
      activeNetwork: await loadActiveNetwork(runtime.idealityHome),
    };
    if (flags.json) {
      printJson(output);
      return;
    }
    console.log(
      `${colors.bold(output.label)} ${colors.dim(`(${output.identity})`)}${
        output.default ? colors.dim("  default identity") : ""
      }`,
    );
    console.log(
      keyValue([
        ["path", tidyPath(output.path)],
        [
          "matched root",
          output.matchedRoot
            ? tidyPath(output.matchedRoot)
            : colors.dim("none (default identity)"),
        ],
        [
          "git",
          output.git ? `${output.git.name} <${output.git.email}>` : undefined,
        ],
        [
          "ssh",
          output.git
            ? output.git.sshKey
              ? tidyPath(output.git.sshKey)
              : colors.dim("default SSH agent")
            : undefined,
        ],
        [
          "target",
          `${output.execution.target}${
            output.execution.vmId ? ` (${output.execution.vmId})` : ""
          }`,
        ],
        [
          "vpn",
          output.execution.networkId
            ? `${output.execution.networkId}${
                output.activeNetwork
                  ? ` / active: ${output.activeNetwork.profile} (${output.activeNetwork.enforcement})`
                  : ""
              }`
            : colors.dim("none"),
        ],
      ]),
    );
    console.log();
    console.log(
      table({
        head: ["tool", "state", "isolation", "target", "executable"],
        rows: tools.map((tool) => [
          tool.name,
          tool.installed
            ? statusGlyph("ok", "ready")
            : statusGlyph("off", "missing"),
          tool.isolation,
          tool.execution.target,
          tool.executable ? tidyPath(tool.executable) : colors.dim("-"),
        ]),
      }),
    );
    const missing = tools.filter((tool) => !tool.installed);
    if (missing.length > 0) {
      console.log();
      console.log(
        hintLines([
          `${missing.map((tool) => tool.name).join(", ")} not installed on this machine; ideality doctor has details`,
        ]),
      );
    }
  },
});

export default statusCommand;
