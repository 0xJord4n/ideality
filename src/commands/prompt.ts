import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { loadRuntime } from "../core/runtime.js";

const promptCommand = defineCommand({
  name: "prompt",
  description: "Render the active identity for a shell prompt",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    format: option(z.string().default("[{identity}]"), {
      description: "Template using {identity}, {label}, and {root}",
    }),
  },
  handler: async ({ flags }) => {
    const runtime = await loadRuntime(flags.path);
    process.stdout.write(
      flags.format
        .replaceAll("{identity}", runtime.resolved.id)
        .replaceAll("{label}", runtime.resolved.identity.label)
        .replaceAll("{root}", runtime.resolved.matchedRoot ?? ""),
    );
  },
});

export default promptCommand;
