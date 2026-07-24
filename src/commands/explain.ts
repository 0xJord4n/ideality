import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { explainTool } from "../core/explain.js";
import { loadRuntime, resolveExecutable } from "../core/runtime.js";
import { printJson, requirePositional } from "./shared.js";

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
      `${colors.bold(explanation.tool)} -> ${explanation.executable ?? "<missing>"}`,
    );
    console.log(`identity     ${explanation.label} (${explanation.identity})`);
    console.log(`path         ${explanation.path}`);
    console.log(`matched root ${explanation.matchedRoot ?? "<fallback>"}`);
    console.log(`shim         ${explanation.shim}`);
    console.log(`intercepted  ${explanation.intercepted ? "yes" : "no"}`);
    console.log(`isolation    ${explanation.isolation}`);
    console.log(
      `arguments    ${explanation.arguments.length ? explanation.arguments.join(" ") : "<none>"}`,
    );
    console.log("environment");
    for (const [name, value] of Object.entries(explanation.environment)) {
      console.log(`  ${name}=${value}`);
    }
  },
});

export default explainCommand;
