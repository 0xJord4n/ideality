import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { expandHome } from "../core/resolution.js";
import type { IdealityConfig } from "../domain/config.js";

export interface RenderedGitConfig {
  includes: string;
  identities: Record<string, string>;
}

export interface GitIntegrationOptions {
  executable?: string;
  environment?: Record<string, string | undefined>;
}

export function currentGitEnvironment(
  options: GitIntegrationOptions = {},
): Record<string, string | undefined> {
  return (
    options.environment ?? (process.env as Record<string, string | undefined>)
  );
}

/** Check global include registration using the process Git environment. */
export function isGitIntegrationRegistered(
  idealityHome: string,
  options: GitIntegrationOptions = {},
): boolean {
  const includesPath = gitIntegrationPath(idealityHome);
  const inspect = Bun.spawnSync({
    cmd: ["git", "config", "--global", "--get-all", "include.path"],
    env: currentGitEnvironment(options) as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (inspect.exitCode !== 0 && inspect.exitCode !== 1) return false;
  return inspect.stdout
    .toString()
    .split("\n")
    .some((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return false;
      try {
        return path.resolve(trimmed) === includesPath;
      } catch {
        return false;
      }
    });
}

export function gitIntegrationPath(idealityHome: string): string {
  return path.join(idealityHome, "git", "includes.gitconfig");
}

export interface GitConfigProbe {
  value: string;
  origin: string;
  scope: "system" | "global" | "local" | "worktree" | "command" | "unknown";
}

export interface ResolvedGitIdentity {
  name: GitConfigProbe | null;
  email: GitConfigProbe | null;
  overridden: boolean;
  origins: string[];
}

function normalizeGitProbeExit(exitCode: number): boolean {
  return exitCode === 0 || exitCode === 1;
}

function parseGitProbeLine(line: string): GitConfigProbe | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const scopeMatch = /^(system|global|local|worktree|command)\s+/.exec(trimmed);
  if (!scopeMatch) {
    return { value: trimmed, origin: "", scope: "unknown" };
  }
  const scope = scopeMatch[1] as GitConfigProbe["scope"];
  const rest = trimmed.slice(scopeMatch[0].length).trim();
  const tabIndex = rest.indexOf("\t");
  const value =
    tabIndex >= 0
      ? rest.slice(tabIndex + 1)
      : rest.split(/\s+/).slice(1).join(" ");
  const origin =
    tabIndex >= 0 ? rest.slice(0, tabIndex) : (rest.split(/\s+/)[0] ?? "");
  return { value: value.trim(), origin: origin.trim(), scope };
}

function probeGitConfig(
  key: string,
  options: GitIntegrationOptions & { cwd?: string } = {},
): GitConfigProbe[] {
  const executable = options.executable ?? "git";
  const env = currentGitEnvironment(options);
  const probed = Bun.spawnSync({
    cmd: [
      executable,
      "config",
      "--show-origin",
      "--show-scope",
      "--get-all",
      key,
    ],
    cwd: options.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!normalizeGitProbeExit(probed.exitCode)) {
    throw new Error(
      `Failed to inspect Git '${key}': ${probed.stderr.toString().trim()}`,
    );
  }
  return probed.stdout
    .toString()
    .split("\n")
    .map(parseGitProbeLine)
    .filter((entry): entry is GitConfigProbe => entry !== null);
}

/** Resolve the effective Git author for a repo, including overrides that beat includeIf. */
export function resolveEffectiveGitIdentity(
  cwd?: string,
  options: GitIntegrationOptions = {},
): ResolvedGitIdentity {
  const names = probeGitConfig("user.name", { ...options, cwd });
  const emails = probeGitConfig("user.email", { ...options, cwd });
  const name = names.at(-1) ?? null;
  const email = emails.at(-1) ?? null;
  // Only repo-scoped values beat the global includeIf chain. Multiple global
  // entries are normal include layering; the last one wins.
  const overridden =
    (name !== null && name.scope !== "global" && name.scope !== "system") ||
    (email !== null && email.scope !== "global" && email.scope !== "system");
  const origins = [
    ...names.map(
      (entry) => `user.name ${entry.scope}:${entry.origin || "<default>"}`,
    ),
    ...emails.map(
      (entry) => `user.email ${entry.scope}:${entry.origin || "<default>"}`,
    ),
  ];
  return { name, email, overridden, origins };
}

/** Remove local (repo, worktree, or file-scoped) Git author overrides. */
export function clearLocalGitIdentity(
  cwd?: string,
  options: GitIntegrationOptions = {},
): { cleared: string[]; path: string | null } {
  const executable = options.executable ?? "git";
  const env = currentGitEnvironment(options);
  const toplevel = Bun.spawnSync({
    cmd: [executable, "rev-parse", "--show-toplevel"],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const repoRoot =
    toplevel.exitCode === 0 ? toplevel.stdout.toString().trim() : null;
  const cleared: string[] = [];
  for (const key of ["user.name", "user.email"]) {
    const probes = probeGitConfig(key, { ...options, cwd });
    for (const probe of probes) {
      if (probe.scope === "global" || probe.scope === "system") continue;
      const removed = Bun.spawnSync({
        cmd: [executable, "config", "--unset-all", key],
        cwd,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (removed.exitCode !== 0) {
        throw new Error(
          `Failed to clear local Git '${key}': ${removed.stderr.toString().trim()}`,
        );
      }
      cleared.push(`${key} (${probe.scope}:${probe.origin || "<default>"})`);
      break;
    }
  }
  return { cleared, path: repoRoot };
}

function gitValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Git identity values cannot contain newlines");
  }
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\t", "\\t")}"`;
}

function shellValue(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function renderGitIncludes(
  config: IdealityConfig,
  home: string,
  idealityHome: string,
): RenderedGitConfig {
  const lines = ["# Generated by ideality. Do not edit.", ""];
  const identities: Record<string, string> = {};

  for (const [id, identity] of Object.entries(config.identities).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (!identity.git) {
      continue;
    }
    const identityPath = path.join(idealityHome, "git", `${id}.gitconfig`);
    identities[id] = [
      "# Generated by ideality. Do not edit.",
      "[user]",
      `\tname = ${gitValue(identity.git.name)}`,
      `\temail = ${gitValue(identity.git.email)}`,
      ...(identity.git.signingKey
        ? [`\tsigningKey = ${gitValue(identity.git.signingKey)}`]
        : []),
      ...(identity.git.gpgSign === undefined
        ? []
        : [
            "[commit]",
            `\tgpgSign = ${identity.git.gpgSign ? "true" : "false"}`,
          ]),
      ...(identity.git.sshKey
        ? [
            "[core]",
            `\tsshCommand = ${gitValue(
              `ssh -i ${shellValue(expandHome(identity.git.sshKey, home))} -o IdentitiesOnly=yes`,
            )}`,
          ]
        : []),
      "",
    ].join("\n");

    for (const configuredRoot of identity.roots) {
      const root = `${expandHome(configuredRoot, home).replace(/\/+$/, "")}/`;
      lines.push(
        `[includeIf "gitdir:${root}"]`,
        `\tpath = ${gitValue(identityPath)}`,
        "",
      );
    }
  }

  return { includes: lines.join("\n"), identities };
}

export async function installGitIntegration(
  config: IdealityConfig,
  home: string,
  idealityHome: string,
): Promise<string> {
  const rendered = renderGitIncludes(config, home, idealityHome);
  const directory = path.join(idealityHome, "git");
  const includesPath = gitIntegrationPath(idealityHome);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Bun.write(includesPath, rendered.includes);
  await chmod(includesPath, 0o600);

  for (const [id, content] of Object.entries(rendered.identities)) {
    const identityPath = path.join(directory, `${id}.gitconfig`);
    await Bun.write(identityPath, content);
    await chmod(identityPath, 0o600);
  }

  const inspect = Bun.spawnSync({
    cmd: ["git", "config", "--global", "--get-all", "include.path"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (inspect.exitCode !== 0 && inspect.exitCode !== 1) {
    throw new Error(
      `Failed to inspect global Git config: ${inspect.stderr.toString().trim()}`,
    );
  }
  const registered = inspect.stdout
    .toString()
    .split("\n")
    .some((entry) => path.resolve(entry.trim()) === includesPath);

  if (!registered) {
    const add = Bun.spawnSync({
      cmd: ["git", "config", "--global", "--add", "include.path", includesPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (add.exitCode !== 0) {
      throw new Error(
        `Failed to register Git config: ${add.stderr.toString().trim()}`,
      );
    }
  }

  return includesPath;
}

export async function disableGitIntegration(
  idealityHome: string,
  options: GitIntegrationOptions = {},
): Promise<{ configPath: string; removed: boolean }> {
  const configPath = gitIntegrationPath(idealityHome);
  const executable = options.executable ?? "git";
  const inspect = Bun.spawnSync({
    cmd: [executable, "config", "--global", "--get-all", "include.path"],
    env: options.environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (inspect.exitCode !== 0 && inspect.exitCode !== 1) {
    throw new Error(
      `Failed to inspect global Git config: ${inspect.stderr.toString().trim()}`,
    );
  }
  const registeredValue = inspect.stdout
    .toString()
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => path.resolve(entry) === path.resolve(configPath));
  if (!registeredValue) {
    return { configPath, removed: false };
  }

  const remove = Bun.spawnSync({
    cmd: [
      executable,
      "config",
      "--global",
      "--fixed-value",
      "--unset-all",
      "include.path",
      registeredValue,
    ],
    env: options.environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (remove.exitCode !== 0) {
    throw new Error(
      `Failed to unregister Git config: ${remove.stderr.toString().trim()}`,
    );
  }
  return { configPath, removed: true };
}
