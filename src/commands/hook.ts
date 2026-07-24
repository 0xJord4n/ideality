import { defineCommand } from "@bunli/core";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { renderShellHook, type SupportedShell } from "../integrations/shell.js";
import { requirePositional } from "./shared.js";

const hookCommand = defineCommand({
  name: "hook",
  description: "Print a shell hook",
  handler: async ({ positional }) => {
    const shell = requirePositional(positional, 0, "shell (zsh, bash, or fish)");
    if (!["zsh", "bash", "fish"].includes(shell)) {
      throw new Error(`Unsupported shell '${shell}'`);
    }
    process.stdout.write(
      renderShellHook(
        await loadConfig(),
        shell as SupportedShell,
        getIdealityHome(),
      ),
    );
  },
});

export default hookCommand;
