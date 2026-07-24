import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { recordAuditEvent } from "../core/audit-history.js";
import {
  getConfigPath,
  getIdealityHome,
  loadConfig,
} from "../core/config-store.js";
import { runUpdate } from "../core/update.js";
import type { UpdateResult } from "../core/update.js";
import type { IdealityConfig } from "../domain/config.js";
import { VERSION } from "../version.js";

interface UpdateAuditContext {
  config: IdealityConfig;
  idealityHome: string;
}

async function captureUpdateAuditContext(): Promise<UpdateAuditContext | null> {
  const configPath = getConfigPath();
  if (!(await Bun.file(configPath).exists())) return null;
  try {
    return {
      config: await loadConfig(configPath),
      idealityHome: getIdealityHome(),
    };
  } catch {
    return null;
  }
}

export async function recordUpdateAuditResult(
  context: UpdateAuditContext,
  result: UpdateResult,
): Promise<void> {
  if (result.status !== "updated") return;

  await recordAuditEvent(context.config, context.idealityHome, {
    eventType: "update.completed",
    payload: {
      status: result.status,
      currentVersion: result.currentVersion,
      targetVersion: result.targetVersion,
      target: result.target,
      artifactVerified: result.artifactVerified,
      migrationReadinessChecked: result.migrationReadinessChecked,
    },
  });
}

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
    const auditContext = await captureUpdateAuditContext();
    const result = await runUpdate({
      allowDowngrade: flags["allow-downgrade"],
      baseUrl: flags["base-url"],
      checkOnly: flags.check,
      currentVersion: VERSION,
      dryRun: flags["dry-run"],
      targetVersion: flags.version,
    });
    if (auditContext) {
      await recordUpdateAuditResult(auditContext, result);
    }

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
