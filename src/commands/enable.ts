import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { detectedShell, enableIntegrations } from "./integration-lifecycle.js";

const enableCommand = defineCommand({
  name: "enable",
  description: "Enable shell shims and Git identity routing",
  options: {
    shell: option(z.enum(["zsh", "bash", "fish"]).default(detectedShell()), {
      description: "Shell integration to enable",
    }),
    rc: option(z.string().optional(), {
      description: "Override shell rc file",
    }),
    "no-shell": option(z.boolean().default(false), {
      description: "Skip shell integration",
      argumentKind: "flag",
    }),
    "no-git": option(z.boolean().default(false), {
      description: "Skip Git includeIf integration",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description: "Show integrations that would be enabled",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, colors }) => {
    await enableIntegrations(flags, colors);
  },
});

export default enableCommand;
