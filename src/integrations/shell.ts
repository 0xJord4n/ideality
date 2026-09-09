import { randomUUID } from "node:crypto";
import {
  chmod,
  chown,
  copyFile,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import type { IdealityConfig } from "../domain/config.js";

export type SupportedShell = "bash" | "zsh" | "fish";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANAGED_BLOCK_BEGIN = "# >>> ideality >>>";
const MANAGED_BLOCK_END = "# <<< ideality <<<";

interface ManagedBlockLocation {
  start: number;
  end: number;
}

function managedBlockLocation(content: string): ManagedBlockLocation | null {
  const marker = /^(# >>> ideality >>>|# <<< ideality <<<)\r?$/gm;
  const matches = [...content.matchAll(marker)];
  const begins = matches.filter((match) => match[1] === MANAGED_BLOCK_BEGIN);
  const ends = matches.filter((match) => match[1] === MANAGED_BLOCK_END);
  if (begins.length === 0 && ends.length === 0) return null;
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(
      "Ambiguous Ideality managed block markers; repair the shell rc file manually",
    );
  }
  const begin = begins[0]!;
  const end = ends[0]!;
  if (begin.index >= end.index) {
    throw new Error(
      "Invalid Ideality managed block markers; repair the shell rc file manually",
    );
  }
  return { start: begin.index, end: end.index + end[0].length };
}

export async function resolveShellRcWritePath(rcPath: string): Promise<string> {
  let writePath = rcPath;
  try {
    if ((await lstat(rcPath)).isSymbolicLink()) {
      writePath = await realpath(rcPath);
    }
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  return writePath;
}

async function shellRcMetadata(writePath: string, rcPath: string) {
  const rcFile = Bun.file(writePath);
  const metadata = (await rcFile.exists()) ? await stat(writePath) : null;
  const effectiveUser = process.geteuid?.();
  if (
    metadata &&
    effectiveUser !== undefined &&
    metadata.uid !== effectiveUser
  ) {
    throw new Error(`Refusing to replace '${rcPath}': owned by another user`);
  }
  return metadata;
}

export async function shellRcTransactionPaths(
  rcPath: string,
): Promise<string[]> {
  const writePath = await resolveShellRcWritePath(rcPath);
  await shellRcMetadata(writePath, rcPath);
  return [
    ...new Set([
      ...(writePath === rcPath ? [rcPath] : []),
      `${rcPath}.pre-ideality`,
      writePath,
    ]),
  ];
}

async function writeShellRc(rcPath: string, content: string): Promise<void> {
  const writePath = await resolveShellRcWritePath(rcPath);
  const metadata = await shellRcMetadata(writePath, rcPath);
  const mode = metadata ? metadata.mode & 0o777 : 0o600;
  const temporary = `${writePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await chmod(temporary, mode);
    if (metadata) {
      await chown(temporary, metadata.uid, metadata.gid);
      await utimes(temporary, metadata.atime, metadata.mtime);
    }
    await rename(temporary, writePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertVariableName(name: string): void {
  if (!VARIABLE_NAME.test(name)) {
    throw new Error(`Invalid environment variable name '${name}'`);
  }
}

function singleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function renderShellAssignments(
  values: Record<string, string>,
  unset: string[],
  shell: SupportedShell,
): string {
  const lines: string[] = [];
  for (const name of [...new Set(unset)].sort()) {
    assertVariableName(name);
    lines.push(shell === "fish" ? `set -e ${name}` : `unset ${name}`);
  }
  for (const [name, value] of Object.entries(values).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    assertVariableName(name);
    lines.push(
      shell === "fish"
        ? `set -gx ${name} ${fishQuote(value)}`
        : `export ${name}=${singleQuote(value)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function collectManagedVariables(config: IdealityConfig): string[] {
  const names = new Set<string>(["IDEALITY_IDENTITY"]);
  for (const identity of Object.values(config.identities)) {
    for (const [tool, profile] of Object.entries(identity.tools)) {
      const isolation =
        profile.isolation ?? config.tools[tool]?.isolation ?? "shell";
      if (isolation !== "shell") {
        continue;
      }
      for (const name of Object.keys(profile.env ?? {})) {
        assertVariableName(name);
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

export function renderShellHook(
  _config: IdealityConfig,
  shell: SupportedShell,
  idealityHome: string,
): string {
  const shimDirectory = path.join(idealityHome, "bin");
  const completion = path.join(
    idealityHome,
    "completions",
    `ideality.${shell}`,
  );
  if (shell === "fish") {
    return [
      `if not contains -- ${fishQuote(shimDirectory)} $PATH`,
      `  set -gx PATH ${fishQuote(shimDirectory)} $PATH`,
      "end",
      `test -r ${fishQuote(completion)}; and source ${fishQuote(completion)}`,
      "function __ideality_apply --on-variable PWD",
      '  command ideality env --shell fish --path "$PWD" | source',
      "end",
      "function ideality-refresh",
      "  __ideality_apply",
      "end",
      "__ideality_apply",
      "",
    ].join("\n");
  }

  const hook =
    shell === "zsh"
      ? [
          "autoload -Uz add-zsh-hook",
          "add-zsh-hook chpwd _ideality_apply",
          "add-zsh-hook precmd _ideality_apply",
        ]
      : [
          'case ";${PROMPT_COMMAND:-};" in',
          "  *';_ideality_apply;'*) ;;",
          '  *) PROMPT_COMMAND="_ideality_apply${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
          "esac",
        ];

  return [
    `case ":$PATH:" in`,
    `  *":${shimDirectory}:"*) ;;`,
    `  *) export PATH=${singleQuote(shimDirectory)}:"$PATH" ;;`,
    "esac",
    `[[ -r ${singleQuote(completion)} ]] && source ${singleQuote(completion)}`,
    "_ideality_apply() {",
    `  eval "$(command ideality env --shell ${shell} --path "$PWD")"`,
    "}",
    "ideality-refresh() { _ideality_apply; }",
    ...hook,
    "_ideality_apply",
    "",
  ].join("\n");
}

export async function installShellIntegration(
  config: IdealityConfig,
  shell: SupportedShell,
  rcPath: string,
  idealityHome: string,
): Promise<{ hookPath: string; rcPath: string; backupPath: string | null }> {
  const directory = path.join(idealityHome, "shell");
  const extension = shell === "fish" ? "fish" : shell;
  const hookPath = path.join(directory, `ideality.${extension}`);
  const rcFile = Bun.file(rcPath);
  const existing = (await rcFile.exists()) ? await rcFile.text() : "";
  const managed = managedBlockLocation(existing);

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Bun.write(hookPath, renderShellHook(config, shell, idealityHome));
  await chmod(hookPath, 0o600);

  const source =
    shell === "fish"
      ? `source ${fishQuote(hookPath)}`
      : `source ${singleQuote(hookPath)}`;
  const block = `${MANAGED_BLOCK_BEGIN}\n${source}\n${MANAGED_BLOCK_END}`;
  const next = managed
    ? `${existing.slice(0, managed.start)}${block}${existing.slice(managed.end)}`
    : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`;

  let backupPath: string | null = null;
  if (await rcFile.exists()) {
    backupPath = `${rcPath}.pre-ideality`;
    if (!(await Bun.file(backupPath).exists())) {
      await copyFile(rcPath, backupPath);
    }
  } else {
    await mkdir(path.dirname(rcPath), { recursive: true });
  }
  await writeShellRc(rcPath, next);
  return { hookPath, rcPath, backupPath };
}

export async function disableShellIntegration(
  rcPath: string,
): Promise<{ rcPath: string; removed: boolean }> {
  const rcFile = Bun.file(rcPath);
  if (!(await rcFile.exists())) {
    return { rcPath, removed: false };
  }

  const existing = await rcFile.text();
  const managed = managedBlockLocation(existing);
  if (!managed) {
    return { rcPath, removed: false };
  }

  await writeShellRc(
    rcPath,
    `${existing.slice(0, managed.start)}${existing.slice(managed.end)}`,
  );
  return { rcPath, removed: true };
}
