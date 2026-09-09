import os from "node:os";

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { runDoctor } from "../core/doctor.js";
import { printJson } from "./shared.js";
import { hintLines, statusGlyph, statusSummary, tidyPathsIn } from "./ui.js";

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
      const glyphFor = { pass: "ok", warn: "warn", fail: "fail" } as const;
      for (const check of checks) {
        const subject = tidyPathsIn(check.subject);
        const message = tidyPathsIn(check.message);
        console.log(
          `  ${statusGlyph(glyphFor[check.status])} ${subject}  ${
            check.status === "pass" ? colors.dim(message) : message
          }`,
        );
      }
      console.log();
      console.log(
        `  ${statusSummary({
          ok: checks.filter((check) => check.status === "pass").length,
          warn: checks.filter((check) => check.status === "warn").length,
          fail: checks.filter((check) => check.status === "fail").length,
        })}`,
      );
      const fixes = new Set<string>();
      for (const check of checks) {
        if (check.status === "pass") continue;
        const match = check.message.match(/run 'ideality ([^']+)'/);
        if (match) fixes.add(`ideality ${match[1]}`);
      }
      if (fixes.size > 0) {
        console.log(hintLines([...fixes].map((fix) => `fix: ${fix}`)));
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
