import os from "node:os";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { runDoctor } from "../core/doctor.js";
import { printJson } from "./shared.js";

const doctorCommand = defineCommand({
  name: "doctor",
  description: "Audit identity configuration and local tooling",
  options: {
    json: option(z.boolean().default(false), {
      description: "Emit JSON",
      argumentKind: "flag",
    }),
    strict: option(z.boolean().default(false), {
      description: "Treat warnings as failures",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags, colors }) => {
    const checks = await runDoctor(
      await loadConfig(),
      os.homedir(),
      getIdealityHome(),
    );
    if (flags.json) {
      printJson(checks);
    } else {
      for (const check of checks) {
        const marker =
          check.status === "pass"
            ? colors.green("PASS")
            : check.status === "warn"
              ? colors.yellow("WARN")
              : colors.red("FAIL");
        console.log(`${marker} ${check.subject}: ${check.message}`);
      }
    }
    const failed = checks.some(
      (check) =>
        check.status === "fail" || (flags.strict && check.status === "warn"),
    );
    if (failed) {
      process.exitCode = 1;
    }
  },
});

export default doctorCommand;
