import { defineCommand } from "@bunli/core";

import { loadConfig } from "../core/config-store.js";
import {
  renderCompletion,
  type CompletionShell,
} from "../integrations/completion.js";
import { requirePositional } from "./shared.js";

const completionCommand = defineCommand({
  name: "completion",
  description: "Generate shell completions",
  handler: async ({ positional }) => {
    const shell = requirePositional(positional, 0, "shell (zsh, bash, or fish)");
    if (!["zsh", "bash", "fish"].includes(shell)) {
      throw new Error(`Unsupported shell '${shell}'`);
    }
    const config = await loadConfig();
    process.stdout.write(
      renderCompletion(shell as CompletionShell, {
        identities: Object.keys(config.identities).sort(),
        tools: Object.keys(config.tools).sort(),
      }),
    );
  },
});

export default completionCommand;
