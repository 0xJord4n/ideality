import { defineCommand, defineGroup } from "@bunli/core";

import { getConfigPath, loadConfig } from "../core/config-store.js";
import { redactConfig } from "../core/environment.js";
import { printJson } from "./shared.js";

const configCommand = defineGroup({
  name: "config",
  description: "Inspect or edit the registry",
  commands: [
    defineCommand({
      name: "path",
      description: "Print the registry path",
      handler: () => {
        console.log(getConfigPath());
      },
    }),
    defineCommand({
      name: "validate",
      description: "Validate the registry",
      handler: async ({ colors }) => {
        const config = await loadConfig();
        console.log(
          colors.green(
            `Valid: ${Object.keys(config.identities).length} identities, ${Object.keys(config.tools).length} tools`,
          ),
        );
      },
    }),
    defineCommand({
      name: "show",
      description: "Print the registry (secrets are references only)",
      handler: async () => {
        printJson(redactConfig(await loadConfig()));
      },
    }),
    defineCommand({
      name: "edit",
      description: "Open the registry in $EDITOR",
      handler: async () => {
        const editor = process.env.EDITOR || process.env.VISUAL || "vi";
        const child = Bun.spawn([editor, getConfigPath()], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
        process.exitCode = await child.exited;
      },
    }),
  ],
});

export default configCommand;
