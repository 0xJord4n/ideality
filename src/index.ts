#!/usr/bin/env bun
import { createCLI } from "@bunli/core";

import { VERSION } from "./version.js";
import authCommand from "./commands/auth.js";
import configCommand from "./commands/config.js";
import completionCommand from "./commands/completion.js";
import doctorCommand from "./commands/doctor.js";
import envCommand from "./commands/env.js";
import explainCommand from "./commands/explain.js";
import hookCommand from "./commands/hook.js";
import identityCommand from "./commands/identity.js";
import initCommand from "./commands/init.js";
import installCommand from "./commands/install.js";
import networkCommand from "./commands/network.js";
import pluginCommand from "./commands/plugin.js";
import policyCommand from "./commands/policy.js";
import promptCommand from "./commands/prompt.js";
import rollbackCommand from "./commands/rollback.js";
import runCommand from "./commands/run.js";
import secretCommand from "./commands/secret.js";
import setupCommand from "./commands/setup.js";
import statusCommand from "./commands/status.js";
import toolCommand from "./commands/tool.js";
import tuiCommand from "./commands/tui.js";
import vmCommand from "./commands/vm.js";

const cli = await createCLI({
  name: "ideality",
  version: VERSION,
  description: "Folder-based identity orchestration for developer tools",
});

for (const command of [
  initCommand,
  setupCommand,
  statusCommand,
  envCommand,
  runCommand,
  explainCommand,
  promptCommand,
  rollbackCommand,
  authCommand,
  secretCommand,
  networkCommand,
  vmCommand,
  identityCommand,
  toolCommand,
  pluginCommand,
  policyCommand,
  installCommand,
  hookCommand,
  completionCommand,
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
