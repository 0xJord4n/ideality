import { redactConfig } from "../core/environment.js";
import type { IdealityConfig } from "../domain/config.js";

export interface ConfigDiffLine {
  op: "add" | "remove" | "change";
  path: string;
  before: string | null;
  after: string | null;
}

const VALUE_LIMIT = 64;

function renderValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > VALUE_LIMIT
    ? `${text.slice(0, VALUE_LIMIT - 3)}...`
    : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => deepEqual(a[key], b[key]))
    );
  }
  return false;
}

function walkDiff(
  before: unknown,
  after: unknown,
  path: string,
  out: ConfigDiffLine[],
): void {
  if (deepEqual(before, after)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    for (const key of keys) {
      walkDiff(before[key], after[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walkDiff(before[index], after[index], `${path}[${index}]`, out);
    }
    return;
  }
  if (before === undefined) {
    out.push({ op: "add", path, before: null, after: renderValue(after) });
  } else if (after === undefined) {
    out.push({ op: "remove", path, before: renderValue(before), after: null });
  } else {
    out.push({
      op: "change",
      path,
      before: renderValue(before),
      after: renderValue(after),
    });
  }
}

/** Readable, redacted diff between two configs (secret literals masked). */
export function diffConfigs(
  before: IdealityConfig,
  after: IdealityConfig,
): ConfigDiffLine[] {
  const lines: ConfigDiffLine[] = [];
  walkDiff(redactConfig(before), redactConfig(after), "", lines);
  return lines;
}

/** One-line human-readable rendering of a diff entry. */
export function formatDiffLine(line: ConfigDiffLine): string {
  if (line.op === "add") return `+ ${line.path} = ${line.after}`;
  if (line.op === "remove") return `- ${line.path} (was ${line.before})`;
  return `~ ${line.path}: ${line.before} -> ${line.after}`;
}
