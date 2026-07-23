import type { IdealityConfig } from "../domain/config.js";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type SupportedShell = "bash" | "zsh" | "fish";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function processTools(config: IdealityConfig): string[] {
  return Object.entries(config.tools)
    .filter(([name, definition]) => {
      if (definition.isolation === "process") {
        return true;
      }
      return Object.values(config.identities).some(
        (identity) => identity.tools[name]?.isolation === "process",
      );
    })
    .map(([name]) => name)
    .sort();
}

export function renderShellHook(
  config: IdealityConfig,
  shell: SupportedShell,
): string {
  const wrappers = processTools(config);
  if (shell === "fish") {
    return [
      "function __ideality_apply --on-variable PWD",
      "  command ideality env --shell fish --path \"$PWD\" | source",
      "end",
      "function ideality-refresh",
      "  __ideality_apply",
      "end",
      ...wrappers.flatMap((tool) => [
        `function ${tool}`,
        `  command ideality run ${tool} -- $argv`,
        "end",
      ]),
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
          "case \";${PROMPT_COMMAND:-};\" in",
          "  *';_ideality_apply;'*) ;;",
          "  *) PROMPT_COMMAND=\"_ideality_apply${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
          "esac",
        ];

  return [
    "_ideality_apply() {",
    `  eval "$(command ideality env --shell ${shell} --path "$PWD")"`,
    "}",
    "ideality-refresh() { _ideality_apply; }",
    ...hook,
    ...wrappers.map(
      (tool) => `${tool}() { command ideality run ${tool} -- "$@"; }`,
    ),
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
  await Bun.write(hookPath, renderShellHook(config, shell));
  await chmod(hookPath, 0o600);

  const rcFile = Bun.file(rcPath);
  const existing = (await rcFile.exists()) ? await rcFile.text() : "";
  const begin = "# >>> ideality >>>";
  const end = "# <<< ideality <<<";
  const source = shell === "fish"
    ? `source ${fishQuote(hookPath)}`
    : `source ${singleQuote(hookPath)}`;
  const block = `${begin}\n${source}\n${end}`;
  const matcher = new RegExp(
    `${begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
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
  await Bun.write(rcPath, next);
  return { hookPath, rcPath, backupPath };
}
