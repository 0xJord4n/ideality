#!/usr/bin/env bun
import { createCLI } from "@bunli/core";

import configCommand from "./commands/config.js";
import doctorCommand from "./commands/doctor.js";
import envCommand from "./commands/env.js";
import hookCommand from "./commands/hook.js";
import identityCommand from "./commands/identity.js";
import initCommand from "./commands/init.js";
import installCommand from "./commands/install.js";
import runCommand from "./commands/run.js";
import secretCommand from "./commands/secret.js";
import statusCommand from "./commands/status.js";
import toolCommand from "./commands/tool.js";
import tuiCommand from "./commands/tui.js";

const cli = await createCLI({
  name: "ideality",
  version: "0.1.0",
  description: "Folder-based identity orchestration for developer tools",
});

for (const command of [
  initCommand,
  statusCommand,
  envCommand,
  runCommand,
  secretCommand,
  identityCommand,
  toolCommand,
  installCommand,
  hookCommand,
  doctorCommand,
  configCommand,
  tuiCommand,
]) {
  cli.command(command);
}

try {
  await cli.run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ideality: ${message}`);
  process.exitCode = 1;
}
