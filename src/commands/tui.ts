import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getConfigPath } from "../core/config-store.js";
import { loadRuntime } from "../core/runtime.js";
import { runDoctor } from "../core/doctor.js";
import { runDashboard } from "../tui/app.js";

const tuiCommand = defineCommand({
  name: "tui",
  description: "Open the interactive identity dashboard",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for initial identity selection",
    }),
  },
  handler: async ({ flags }) => {
    const runtime = await loadRuntime(flags.path);
    const action = await runDashboard(
      runtime.config,
      runtime.resolved.id,
      flags.path,
    );
    if (action === "edit") {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const child = Bun.spawn([editor, getConfigPath()], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exitCode = await child.exited;
    } else if (action === "doctor") {
      const checks = await runDoctor(
        runtime.config,
        runtime.home,
        runtime.idealityHome,
      );
      for (const check of checks) {
        console.log(`${check.status.toUpperCase()} ${check.subject}: ${check.message}`);
      }
    }
  },
});

export default tuiCommand;
