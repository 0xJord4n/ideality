import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { explainTool } from "../core/explain.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import { printJson, requirePositional } from "./shared.js";
import { keyValue, section, statusGlyph, tidyPath } from "./ui.js";

const explainCommand = defineCommand({
  name: "explain",
  description: "Explain how a tool invocation will be isolated",
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
  handler: async ({ positional, flags, colors }) => {
    const tool = requirePositional(positional, 0, "tool name");
    const runtime = await loadRuntime(flags.path, flags.identity);
    const profile = runtime.resolved.identity.tools[tool];
    const executable = resolveExecutable(
      runtime.config,
      tool,
      profile?.executable,
    );
    const shim = `${runtime.idealityHome}/bin/${tool}`;
    const explanation = await explainTool(runtime.config, runtime.resolved, {
      tool,
      executable,
      home: runtime.home,
      idealityHome: runtime.idealityHome,
      intercepted: await Bun.file(shim).exists(),
    });
    if (flags.json) {
      printJson(explanation);
      return;
    }
    console.log(
      `${colors.bold(explanation.tool)} -> ${
        explanation.executable
          ? tidyPath(explanation.executable)
          : colors.yellow("not installed")
      }`,
    );
    console.log(
      keyValue([
        ["identity", `${explanation.label} (${explanation.identity})`],
        ["path", tidyPath(explanation.path)],
        [
          "matched root",
          explanation.matchedRoot
            ? tidyPath(explanation.matchedRoot)
            : colors.dim("none (default identity)"),
        ],
        ["shim", tidyPath(explanation.shim)],
        [
          "intercepted",
          explanation.intercepted
            ? statusGlyph("ok", "yes")
            : statusGlyph("off", "no"),
        ],
        ["isolation", explanation.isolation],
        [
          "target",
          `${explanation.execution.target} ${colors.dim(
            `(from ${explanation.execution.source})`,
          )}`,
        ],
        ["vm", explanation.execution.vm ?? colors.dim("none")],
        ["network", explanation.execution.network ?? colors.dim("none")],
        [
          "arguments",
          explanation.arguments.length
            ? explanation.arguments.join(" ")
            : colors.dim("none"),
        ],
      ]),
    );
    console.log();
    console.log(section("Environment"));
    console.log(
      keyValue(
        Object.entries(explanation.environment).map(([name, value]) => [
          name,
          tidyPath(value),
        ]),
      ),
    );
  },
});

export default explainCommand;
