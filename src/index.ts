#!/usr/bin/env bun
import { createCLI } from "@bunli/core";
import { colors } from "@bunli/utils";

import { VERSION } from "./version.js";
import { idealityHelpRenderer } from "./commands/help.js";
import { GLYPHS } from "./commands/ui.js";
import { IDEALITY_COMMAND_NAMES } from "./commands/names.js";
import {
  commandsForInvocation,
  IDEALITY_COMMAND_REGISTRY,
} from "./command-registry.js";

const cli = await createCLI({
  name: "ideality",
  version: VERSION,
  description: "Folder-based identity orchestration for developer tools",
  help: { renderer: idealityHelpRenderer },
});

if (
  IDEALITY_COMMAND_REGISTRY.length !== IDEALITY_COMMAND_NAMES.length ||
  IDEALITY_COMMAND_REGISTRY.some(
    ({ name }, index) => name !== IDEALITY_COMMAND_NAMES[index],
  )
) {
  throw new Error("Ideality command registry has duplicate or missing names");
}
const argv = process.argv.slice(2);
for (const command of await commandsForInvocation(argv)) {
  cli.command(command);
}

try {
  await cli.run(argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${colors.red(GLYPHS.fail)} ideality: ${message}`);
  process.exitCode = 1;
}
