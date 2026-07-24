import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import {
  applyPlugin,
  listPluginManifests,
  parsePluginManifest,
  removePluginManifest,
  writePluginManifest,
} from "../core/plugins.js";
import { installShims } from "../integrations/shims.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import { requirePositional } from "./shared.js";

const pluginCommand = defineGroup({
  name: "plugin",
  description: "Install portable declarative tool integrations",
  commands: [
    defineCommand({
      name: "list",
      description: "List installed plugin manifests",
      handler: async ({ colors }) => {
        const idealityHome = getIdealityHome();
        const config = await loadConfig();
        for (const { file, manifest } of await listPluginManifests(idealityHome)) {
          const state = config.tools[manifest.id] ? colors.green("active") : colors.yellow("detached");
          console.log(
            `${manifest.id.padEnd(16)} ${state.padEnd(8)} ${manifest.executable.primary}  ${file}`,
          );
        }
      },
    }),
    defineCommand({
      name: "validate",
      description: "Validate a plugin manifest without installing it",
      handler: async ({ positional, colors }) => {
        const file = requirePositional(positional, 0, "manifest path");
        const manifest = parsePluginManifest(await Bun.file(file).text());
        console.log(colors.green(`Valid plugin '${manifest.id}'`));
      },
    }),
    defineCommand({
      name: "install",
      description: "Install or update a plugin manifest",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Replace an existing tool definition",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Validate and show the plugin without writing files",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const file = requirePositional(positional, 0, "manifest path");
        const manifest = parsePluginManifest(await Bun.file(file).text());
        const config = await loadConfig();
        if (config.tools[manifest.id] && !flags.force) {
          throw new Error(
            `Tool '${manifest.id}' already exists; use --force to replace it`,
          );
        }
        const next = applyPlugin(config, manifest);
        if (flags["dry-run"]) {
          console.log(JSON.stringify(manifest, null, 2));
          return;
        }
        await saveConfig(next);
        const installed = await writePluginManifest(manifest, getIdealityHome());
        await installShims(next, getIdealityHome());
        await syncInstalledCompletions(next, getIdealityHome());
        console.log(colors.green(`Installed plugin '${manifest.id}'`));
        console.log(colors.dim(installed));
      },
    }),
    defineCommand({
      name: "remove",
      description: "Remove a plugin and its identity profiles",
      options: {
        force: option(z.boolean().default(false), {
          short: "f",
          description: "Confirm removal",
          argumentKind: "flag",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Show the removal without writing files",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const name = requirePositional(positional, 0, "plugin name");
        if (!flags.force) throw new Error("Plugin removal requires --force");
        const installed = await listPluginManifests(getIdealityHome());
        if (!installed.some((entry) => entry.manifest.id === name)) {
          throw new Error(`Plugin '${name}' is not installed`);
        }
        const config = await loadConfig();
        delete config.tools[name];
        for (const identity of Object.values(config.identities)) {
          delete identity.tools[name];
        }
        if (!flags["dry-run"]) {
          await saveConfig(config);
          await removePluginManifest(name, getIdealityHome());
          await installShims(config, getIdealityHome());
          await syncInstalledCompletions(config, getIdealityHome());
        }
        console.log(
          flags["dry-run"]
            ? `Would remove plugin '${name}'`
            : colors.green(`Removed plugin '${name}'`),
        );
      },
    }),
  ],
});

export default pluginCommand;
