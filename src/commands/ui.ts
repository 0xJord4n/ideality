import os from "node:os";

import { colors } from "@bunli/utils";

/** Status glyphs shared by every human-facing command surface. */
export const GLYPHS = {
  ok: "✓",
  warn: "!",
  fail: "✗",
  off: "·",
  pointer: ">",
  arrow: "->",
} as const;

export type StatusKind = "ok" | "warn" | "fail" | "off";

const STATUS_COLORS: Record<StatusKind, (text: string) => string> = {
  ok: colors.green,
  warn: colors.yellow,
  fail: colors.red,
  off: colors.dim,
};

/** Render a colored status glyph, optionally followed by a label. */
export function statusGlyph(kind: StatusKind, label?: string): string {
  const glyph = STATUS_COLORS[kind](GLYPHS[kind]);
  return label ? `${glyph} ${label}` : glyph;
}

/** Visible width of a string once ANSI sequences are stripped. */
export function visibleWidth(text: string): number {
  return colors.strip(text).length;
}

function padVisible(text: string, width: number): string {
  const pad = width - visibleWidth(text);
  return pad > 0 ? text + " ".repeat(pad) : text;
}

/** Collapse the home directory prefix of a path to `~`. */
export function tidyPath(value: string, home: string = os.homedir()): string {
  if (!home || home === "/") return value;
  if (value === home) return "~";
  const prefix = home.endsWith("/") ? home : `${home}/`;
  return value.startsWith(prefix) ? `~/${value.slice(prefix.length)}` : value;
}

/** Collapse every home-directory occurrence inside free text to `~`. */
export function tidyPathsIn(text: string, home: string = os.homedir()): string {
  if (!home || home === "/") return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(?=/|$|[^\\w/])`, "g"), "~");
}

/** Aligned key/value block with dimmed keys; skips rows with empty values. */
export function keyValue(
  rows: ReadonlyArray<readonly [string, string | undefined | null]>,
): string {
  const present = rows.filter(
    (row): row is readonly [string, string] =>
      row[1] !== undefined && row[1] !== null && row[1] !== "",
  );
  const width = present.reduce((max, [key]) => Math.max(max, key.length), 0);
  return present
    .map(([key, value]) => `  ${colors.dim(key.padEnd(width))}  ${value}`)
    .join("\n");
}

export interface TableOptions {
  head: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
  indent?: string;
}

/** ANSI-aware aligned table with a dimmed header row. */
export function table({ head, rows, indent = "  " }: TableOptions): string {
  const widths = head.map((cell, column) =>
    rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[column] ?? "")),
      visibleWidth(cell),
    ),
  );
  const render = (cells: readonly string[], style?: (text: string) => string) =>
    indent +
    cells
      .map((cell, column) => {
        const padded = padVisible(cell, widths[column] ?? 0);
        return style ? style(padded) : padded;
      })
      .join("  ")
      .trimEnd();
  return [render(head, colors.dim), ...rows.map((row) => render(row))].join(
    "\n",
  );
}

/** Bold section heading. */
export function section(title: string): string {
  return colors.bold(title);
}

/** Highlight a runnable command inside hint or body text. */
export function commandText(command: string): string {
  return colors.cyan(command);
}

/** Dimmed next-step hint lines, each introduced by an arrow. */
export function hintLines(lines: readonly string[]): string {
  return lines
    .map((line) => `${colors.dim(GLYPHS.arrow)} ${colors.dim(line)}`)
    .join("\n");
}

/** One-line pass/warn/fail summary, e.g. `✓ 12 passed  ! 2 warnings`. */
export function statusSummary(counts: {
  ok?: number;
  warn?: number;
  fail?: number;
}): string {
  const parts: string[] = [];
  if (counts.ok) {
    parts.push(colors.green(`${GLYPHS.ok} ${counts.ok} passed`));
  }
  if (counts.warn) {
    const label = counts.warn === 1 ? "warning" : "warnings";
    parts.push(colors.yellow(`${GLYPHS.warn} ${counts.warn} ${label}`));
  }
  if (counts.fail) {
    parts.push(colors.red(`${GLYPHS.fail} ${counts.fail} failed`));
  }
  return parts.join("  ");
}
