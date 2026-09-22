import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { buildEnvironment } from "../core/environment.js";
import { isPassthrough } from "../core/resolution.js";
import { loadRuntime } from "../core/runtime.js";
import {
  collectManagedVariables,
  renderShellAssignments,
} from "../integrations/shell.js";
import { printJson } from "./shared.js";

const envCommand = defineCommand({
  name: "env",
  description: "Render the selected identity environment",
  options: {
    path: option(z.string().default(process.cwd()), {
      short: "C",
      description: "Path used for identity resolution",
    }),
    identity: option(z.string().optional(), {
      short: "i",
      description: "Override folder-based selection",
    }),
    shell: option(z.enum(["zsh", "bash", "fish"]).optional(), {
      description: "Emit shell assignments instead of JSON",
    }),
    reveal: option(z.boolean().default(false), {
      description: "Include resolved values in JSON output",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags }) => {
    const runtime = await loadRuntime(flags.path, flags.identity);
    if (isPassthrough(runtime.config, runtime.resolved, flags.identity)) {
      // Unmatched directory: clear any managed variables left over from a
      // previously matched directory instead of applying an identity.
      const stale = collectManagedVariables(runtime.config);
      if (flags.shell) {
        process.stdout.write(renderShellAssignments({}, stale, flags.shell));
        return;
      }
      printJson({
        identity: null,
        passthrough: true,
        path: runtime.resolved.path,
        matchedRoot: null,
        environment: {},
        unset: stale,
      });
      return;
    }
    const environment = await buildEnvironment(
      runtime.config,
      runtime.resolved,
      {
        home: runtime.home,
        idealityHome: runtime.idealityHome,
      },
    );
    if (flags.shell) {
      const stale = collectManagedVariables(runtime.config).filter(
        (name) => !(name in environment.values),
      );
      process.stdout.write(
        renderShellAssignments(
          environment.values,
          [...stale, ...environment.unset],
          flags.shell,
        ),
      );
      return;
    }
    printJson({
      identity: runtime.resolved.id,
      path: runtime.resolved.path,
      matchedRoot: runtime.resolved.matchedRoot,
      environment: flags.reveal ? environment.values : environment.redacted,
      unset: environment.unset,
    });
  },
});

export default envCommand;
