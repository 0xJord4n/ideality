import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { runUpdate } from "../core/update.js";
import { VERSION } from "../version.js";

const updateCommand = defineCommand({
  name: "update",
  description: "Safely update a direct binary install",
  options: {
    check: option(z.boolean().default(false), {
      description: "Check release metadata without downloading or installing",
      argumentKind: "flag",
    }),
    "dry-run": option(z.boolean().default(false), {
      description:
        "Verify the release artifact and migration readiness without replacing the executable",
      argumentKind: "flag",
    }),
    version: option(z.string().optional(), {
      description:
        "Install a specific release version when metadata is available",
    }),
    "allow-downgrade": option(z.boolean().default(false), {
      description: "Permit an explicit downgrade",
      argumentKind: "flag",
    }),
    "base-url": option(z.string().optional(), {
      description:
        "Override the release artifact base URL (used for offline rehearsals)",
    }),
  },
  handler: async ({ flags, colors }) => {
    const result = await runUpdate({
      allowDowngrade: flags["allow-downgrade"],
      baseUrl: flags["base-url"],
      checkOnly: flags.check,
      currentVersion: VERSION,
      dryRun: flags["dry-run"],
      targetVersion: flags.version,
    });

    if (result.status === "current") {
      console.log(`ideality ${result.currentVersion} is already current.`);
      return;
    }
    if (result.status === "update-available") {
      console.log(
        `Update available: ${result.currentVersion} -> ${result.targetVersion} (${result.target})`,
      );
      return;
    }
    if (result.status === "dry-run") {
      console.log(
        `Would update ${result.executablePath} from ${result.currentVersion} to ${result.targetVersion}`,
      );
      console.log("Verified SHA256 and staged binary execution.");
      console.log(
        result.migrationReadinessChecked
          ? "Registry migration readiness passed."
          : "No registry found; migration readiness skipped.",
      );
      return;
    }
    console.log(
      colors.green(
        `Updated ${result.executablePath} from ${result.currentVersion} to ${result.targetVersion}`,
      ),
    );
    if (result.configSnapshot) {
      console.log(`Registry snapshot: ${result.configSnapshot}`);
    }
  },
});

export default updateCommand;
