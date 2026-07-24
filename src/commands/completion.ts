import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import {
  installCompletion,
  renderCompletion,
  type CompletionShell,
} from "../integrations/completion.js";
import { requirePositional } from "./shared.js";

const completionCommand = defineCommand({
  name: "completion",
  description: "Generate shell completions",
  options: {
    install: option(z.boolean().default(false), {
      description: "Install the generated completion under ~/.ideality",
      argumentKind: "flag",
    }),
  },
  handler: async ({ positional, flags, colors }) => {
    const shell = requirePositional(positional, 0, "shell (zsh, bash, or fish)");
    if (!["zsh", "bash", "fish"].includes(shell)) {
      throw new Error(`Unsupported shell '${shell}'`);
    }
    const config = await loadConfig();
    const content = renderCompletion(shell as CompletionShell, {
      identities: Object.keys(config.identities).sort(),
      tools: Object.keys(config.tools).sort(),
    });
    if (flags.install) {
      const file = await installCompletion(
        shell as CompletionShell,
        content,
        getIdealityHome(),
      );
      console.log(colors.green(`Installed completion: ${file}`));
    } else {
      process.stdout.write(content);
    }
  },
});

export default completionCommand;
