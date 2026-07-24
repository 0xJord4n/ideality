import path from "node:path";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import { migrateConfigFile } from "../core/config-migrate.js";
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
      name: "migrate",
      description: "Migrate the registry to the current schema version",
      options: {
        "dry-run": option(z.boolean().default(false), {
          description: "Show the migration plan without writing",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        const result = await migrateConfigFile(getConfigPath(), {
          dryRun: flags["dry-run"],
        });
        if (result.status === "current") {
          console.log(
            `Registry is already at the current version (${result.toVersion}); nothing to migrate.`,
          );
          return;
        }
        for (const step of result.steps) console.log(step);
        if (result.status === "dry-run") {
          console.log(
            `Would migrate registry from version ${result.fromVersion} to ${result.toVersion}`,
          );
          return;
        }
        if (result.snapshot) {
          console.log(
            `Snapshot saved: ${path.basename(result.snapshot)} (restore with 'ideality rollback')`,
          );
        }
        console.log(
          colors.green(
            `Migrated registry from version ${result.fromVersion} to ${result.toVersion}`,
          ),
        );
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
