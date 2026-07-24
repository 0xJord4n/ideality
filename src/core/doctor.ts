import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { IdealityConfig } from "../domain/config.js";
import { renderTemplate } from "./environment.js";
import { expandHome } from "./resolution.js";
import { findExecutable, resolveExecutable } from "./runtime.js";
import { secretBackendExecutable } from "./secret-backends.js";
import { listConfigSnapshots } from "./config-store.js";
import { listPluginManifests } from "./plugins.js";
import { renderShim } from "../integrations/shims.js";
import { networkCapability } from "./network.js";
import { vmCapability } from "./vm.js";

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
  const canonicalRoots: Array<{ id: string; root: string }> = [];

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
          if (info.isDirectory()) {
            canonicalRoots.push({ id, root: await realpath(expanded) });
          }
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

  for (let index = 0; index < canonicalRoots.length; index += 1) {
    const current = canonicalRoots[index]!;
    for (const other of canonicalRoots.slice(index + 1)) {
      if (
        current.root === other.root ||
        current.root.startsWith(`${other.root}${path.sep}`) ||
        other.root.startsWith(`${current.root}${path.sep}`)
      ) {
        checks.push({
          status: current.id === other.id ? "warn" : "fail",
          subject: `${current.id}/${other.id}:roots`,
          message: `canonical roots overlap: ${current.root} and ${other.root}`,
        });
      }
    }
  }

  const configuredTools = new Set(
    Object.values(config.identities).flatMap((identity) =>
      Object.entries(identity.tools)
        .filter(([, profile]) => profile.enabled !== false)
        .map(([tool]) => tool),
    ),
  );
  for (const [tool, definition] of Object.entries(config.tools)) {
    if (!configuredTools.has(tool)) continue;
    const executable = resolveExecutable(config, tool);
    checks.push({
      status: executable ? "pass" : "warn",
      subject: tool,
      message:
        executable
          ? `executable ${executable}`
          : `executable '${definition.executable}' is not installed`,
    });
    if (definition.auth) {
      checks.push({
        status: executable ? "pass" : "warn",
        subject: `auth:${tool}`,
        message: `native workflows: ${Object.keys(definition.auth).sort().join(", ")}`,
      });
    }
  }

  const shimDirectory = path.join(idealityHome, "bin");
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => path.resolve(entry));
  const shimPathActive = pathEntries.includes(path.resolve(shimDirectory));
  checks.push({
    status: shimPathActive ? "pass" : "warn",
    subject: "shim-path",
    message: shimPathActive
      ? `${shimDirectory} is active in PATH`
      : `${shimDirectory} is not active in PATH; reload the shell integration`,
  });
  for (const tool of configuredTools) {
    if (config.tools[tool]?.shim === false) continue;
    const file = path.join(shimDirectory, tool);
    try {
      const info = await stat(file);
      const current =
        info.isFile() &&
        Boolean(info.mode & 0o111) &&
        (await Bun.file(file).text()) === renderShim(tool);
      checks.push({
        status: current ? "pass" : "fail",
        subject: `shim:${tool}`,
        message: current
          ? "managed shim is current"
          : "shim is stale or not executable; run 'ideality install'",
      });
    } catch {
      checks.push({
        status: "fail",
        subject: `shim:${tool}`,
        message: "managed shim is missing; run 'ideality install'",
      });
    }
  }

  const backendExecutable = secretBackendExecutable(config);
  if (backendExecutable) {
    const executable = findExecutable(backendExecutable);
    checks.push({
      status: executable ? "pass" : "fail",
      subject: `secrets:${config.secretBackend?.type}`,
      message: executable
        ? `backend executable ${executable}`
        : `required executable '${backendExecutable}' is missing`,
    });
  } else {
    checks.push({
      status: "pass",
      subject: "secrets:file",
      message: "locked local file backend",
    });
  }
  if (config.secretBackend?.type === "age") {
    const identity = expandHome(config.secretBackend.identityFile, home);
    const exists = await Bun.file(identity).exists();
    checks.push({
      status: exists ? "pass" : "fail",
      subject: "secrets:age-identity",
      message: exists
        ? `identity file present: ${identity}`
        : `identity file is missing: ${identity}`,
    });
  }

  try {
    const plugins = await listPluginManifests(idealityHome);
    checks.push({
      status: "pass",
      subject: "plugins",
      message: `${plugins.length} valid manifest${plugins.length === 1 ? "" : "s"}`,
    });
  } catch (error) {
    checks.push({
      status: "fail",
      subject: "plugins",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const shellDirectory = path.join(idealityHome, "shell");
  let hooks: string[] = [];
  try {
    hooks = (await readdir(shellDirectory)).filter((file) =>
      /^ideality\.(zsh|bash|fish)$/.test(file),
    );
  } catch {
    // Missing shell integration is reported below.
  }
  checks.push({
    status: hooks.length > 0 ? "pass" : "warn",
    subject: "shell-hook",
    message:
      hooks.length > 0
        ? `installed: ${hooks.join(", ")}`
        : "not installed; run 'ideality install'",
  });

  const snapshots = await listConfigSnapshots(
    path.join(idealityHome, "config.jsonc"),
  );
  checks.push({
    status: "pass",
    subject: "history",
    message: `${snapshots.length} rollback snapshot${snapshots.length === 1 ? "" : "s"}`,
  });
  for (const [id, profile] of Object.entries(config.networks ?? {})) {
    const capability = networkCapability(profile);
    const executable = findExecutable(capability.executable);
    const sudo = !profile.sudo || Boolean(findExecutable("sudo"));
    const strictRequested = (profile.killSwitch ?? "required") === "required";
    checks.push({
      status:
        !executable
          ? "fail"
          : !sudo
            ? "fail"
          : strictRequested && !capability.strictKillSwitch
            ? "fail"
            : "pass",
      subject: `network:${id}`,
      message: !executable
        ? `required executable '${capability.executable}' is missing`
        : !sudo
          ? "profile requires sudo, but 'sudo' is missing"
        : strictRequested && !capability.strictKillSwitch
          ? `${capability.detail}; strict activation will fail closed`
          : capability.detail,
    });
  }
  for (const [id, profile] of Object.entries(config.vms ?? {})) {
    const capability = vmCapability(profile);
    checks.push({
      status: capability.available ? "pass" : "fail",
      subject: `vm:${id}`,
      message: capability.detail,
    });
  }
  return checks;
}
