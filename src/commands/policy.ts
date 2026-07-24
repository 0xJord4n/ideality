import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import { recordAuditEvent } from "../core/audit-history.js";
import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { checkProjectPolicy } from "../core/policy.js";
import { findProjectRoot } from "../core/project-config.js";
import { printJson } from "./shared.js";

export const policyCheckCommand = defineCommand({
  name: "check",
  description: "Validate the project handover against the team policy",
  options: {
    json: option(z.boolean().default(false), {
      description: "Emit JSON",
      argumentKind: "flag",
    }),
    path: option(z.string().default(process.cwd()), {
      description: "Project path",
    }),
  },
  handler: async ({ flags, colors }) => {
    const projectRoot = await findProjectRoot(flags.path);
    const result = await checkProjectPolicy(projectRoot);
    if (flags.json) {
      printJson(result);
    } else {
      if (result.policy?.label) {
        console.log(`Team policy: ${result.policy.label}`);
      }
      for (const finding of result.findings) {
        console.log(
          `${colors.red("FAIL")} ${finding.subject}: ${finding.message}`,
        );
      }
      if (result.status === "pass") {
        console.log(colors.green(`Policy satisfied (${result.policyPath})`));
      } else {
        const count = result.findings.length;
        console.log(
          colors.red(
            `${count} policy ${count === 1 ? "violation" : "violations"}`,
          ),
        );
      }
    }
    if (result.status === "fail") {
      process.exitCode = 1;
    }
    const config = await loadConfig().catch(() => null);
    if (config) {
      await recordAuditEvent(config, getIdealityHome(), {
        eventType: "policy.checked",
        payload: {
          status: result.status,
          policyPath: result.policyPath,
          findings: result.findings.length,
        },
      });
    }
  },
});

const policyCommand = defineGroup({
  name: "policy",
  description: "Team policy contracts for project handovers",
  commands: [policyCheckCommand],
});

export default policyCommand;
