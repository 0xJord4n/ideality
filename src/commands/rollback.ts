import os from "node:os";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import {
  getConfigPath,
  getIdealityHome,
  listConfigSnapshots,
  restoreConfigSnapshot,
} from "../core/config-store.js";
import { syncInstalledCompletions } from "../integrations/completion.js";
import { installGitIntegration } from "../integrations/git.js";
import { installShims } from "../integrations/shims.js";

const rollbackCommand = defineCommand({
  name: "rollback",
  description: "List or restore transactional registry snapshots",
  options: {
    list: option(z.boolean().default(false), {
      short: "l",
      description: "List available snapshots",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description: "Validate and show the target without restoring it",
      argumentKind: "flag",
    }),
  },
  handler: async ({ positional, flags, colors }) => {
    if (flags.list) {
      const snapshots = await listConfigSnapshots(getConfigPath());
      if (snapshots.length === 0) console.log("No snapshots");
      else snapshots.forEach((snapshot) => console.log(snapshot));
      return;
    }
    const restored = await restoreConfigSnapshot(
      positional[0],
      getConfigPath(),
      { dryRun: flags["dry-run"] },
    );
    if (!flags["dry-run"]) {
      await installShims(restored.config, getIdealityHome());
      await installGitIntegration(
        restored.config,
        os.homedir(),
        getIdealityHome(),
      );
      await syncInstalledCompletions(restored.config, getIdealityHome());
    }
    console.log(
      flags["dry-run"]
        ? `Would restore ${restored.snapshot}`
        : colors.green(`Restored ${restored.snapshot}`),
    );
  },
});

export default rollbackCommand;
