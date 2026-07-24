import { stat } from "node:fs/promises";
import path from "node:path";

import type { IdealityConfig } from "../domain/config.js";
import { renderTemplate } from "./environment.js";
import { expandHome } from "./resolution.js";
import { resolveExecutable } from "./runtime.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  status: CheckStatus;
  subject: string;
  message: string;
}

export async function runDoctor(
  config: IdealityConfig,
  home: string,
  idealityHome: string = path.join(home, ".ideality"),
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const rootOwners = new Map<string, string>();

  for (const [id, identity] of Object.entries(config.identities)) {
    const primaryRoot = expandHome(identity.roots[0]!, home);
    const resolved = {
      id,
      identity,
      path: primaryRoot,
      matchedRoot: primaryRoot,
      isDefault: id === config.defaultIdentity,
    };
    for (const root of identity.roots) {
      const expanded = expandHome(root, home);
      const previous = rootOwners.get(expanded);
      if (previous) {
        checks.push({
          status: "fail",
          subject: expanded,
          message: `root is assigned to both '${previous}' and '${id}'`,
        });
      } else {
        rootOwners.set(expanded, id);
        try {
          const info = await stat(expanded);
          checks.push({
            status: info.isDirectory() ? "pass" : "fail",
            subject: expanded,
            message: info.isDirectory() ? `owned by ${id}` : "root exists but is not a directory",
          });
        } catch {
          checks.push({
            status: "warn",
            subject: expanded,
            message: "directory is missing",
          });
        }
      }
    }

    if (identity.git?.sshKey) {
      const key = expandHome(identity.git.sshKey, home);
      try {
        const info = await stat(key);
        const permissions = info.mode & 0o777;
        checks.push({
          status: permissions & 0o077 ? "fail" : "pass",
          subject: `${id}/git:sshKey`,
          message:
            permissions & 0o077
              ? `private key ${key} must not be group/world accessible`
              : `private key present (${permissions.toString(8)})`,
        });
      } catch {
        checks.push({
          status: "fail",
          subject: `${id}/git:sshKey`,
          message: `private key is missing: ${key}`,
        });
      }
    }

    for (const [tool, profile] of Object.entries(identity.tools)) {
      for (const [name, source] of Object.entries(profile.env ?? {})) {
        if (
          typeof source === "string" &&
          /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(name)
        ) {
          checks.push({
            status: "warn",
            subject: `${id}/${tool}:${name}`,
            message: "credential-like value is stored directly in config; use a file source",
          });
        }
        if (!source || typeof source === "string" || source.from !== "file") {
          continue;
        }
        const file = renderTemplate(source.path, resolved, home, idealityHome);
        try {
          const info = await stat(file);
          const permissions = info.mode & 0o777;
          checks.push({
            status: permissions & 0o077 ? "warn" : "pass",
            subject: `${id}/${tool}:${name}`,
            message:
              permissions & 0o077
                ? `secret file ${file} should be chmod 600`
                : `secret file present (${permissions.toString(8)})`,
          });
        } catch {
          checks.push({
            status: source.optional ? "warn" : "fail",
            subject: `${id}/${tool}:${name}`,
            message: `secret file is missing: ${file}`,
          });
        }
      }
    }
  }

  for (const [tool, definition] of Object.entries(config.tools)) {
    const executable = resolveExecutable(config, tool);
    checks.push({
      status: executable ? "pass" : "warn",
      subject: tool,
      message:
        executable
          ? `executable ${executable}`
          : `executable '${definition.executable}' is not installed`,
    });
  }
  return checks;
}
