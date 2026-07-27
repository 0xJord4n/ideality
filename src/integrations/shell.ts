import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { IdealityConfig } from "../domain/config.js";

export type SupportedShell = "bash" | "zsh" | "fish";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANAGED_BLOCK_BEGIN = "# >>> ideality >>>";
const MANAGED_BLOCK_END = "# <<< ideality <<<";

function managedBlockMatcher(): RegExp {
  return new RegExp(
    `${MANAGED_BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${MANAGED_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
}

async function writeShellRc(rcPath: string, content: string): Promise<void> {
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

  const rcFile = Bun.file(writePath);
  const mode = (await rcFile.exists())
    ? (await rcFile.stat()).mode & 0o777
    : 0o600;
  const temporary = `${writePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await chmod(temporary, mode);
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
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Bun.write(hookPath, renderShellHook(config, shell, idealityHome));
  await chmod(hookPath, 0o600);

  const rcFile = Bun.file(rcPath);
  const existing = (await rcFile.exists()) ? await rcFile.text() : "";
  const source =
    shell === "fish"
      ? `source ${fishQuote(hookPath)}`
      : `source ${singleQuote(hookPath)}`;
  const block = `${MANAGED_BLOCK_BEGIN}\n${source}\n${MANAGED_BLOCK_END}`;
  const matcher = managedBlockMatcher();
  const next = matcher.test(existing)
    ? existing.replace(matcher, block)
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
  const matcher = managedBlockMatcher();
  if (!matcher.test(existing)) {
    return { rcPath, removed: false };
  }

  await writeShellRc(rcPath, existing.replace(matcher, ""));
  return { rcPath, removed: true };
}
