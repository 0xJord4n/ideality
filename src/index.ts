#!/usr/bin/env bun
import { createCLI } from "@bunli/core";
import { colors } from "@bunli/utils";

import { VERSION } from "./version.js";
import { idealityHelpRenderer } from "./commands/help.js";
import { GLYPHS } from "./commands/ui.js";
import { IDEALITY_COMMAND_NAMES } from "./commands/names.js";
import {
  commandsForInvocation,
  dispatchArgvForRun,
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
const selected = await commandsForInvocation(argv);
for (const command of selected) {
  cli.command(command);
}

try {
  // `run` forwards everything after `--` verbatim to the wrapped tool, so
  // hide that tail from option parsing: tool flags must never be validated
  // against this CLI's options. The handler still reads them from the raw
  // process argv (see `commandArguments`).
  const dispatch =
    selected.length === 1 && selected[0]?.name === "run"
      ? dispatchArgvForRun(argv)
      : argv;
  await cli.run(dispatch);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${colors.red(GLYPHS.fail)} ideality: ${message}`);
  process.exitCode = 1;
}
