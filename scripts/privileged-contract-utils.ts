import { issue, type CatalogIssue } from "./catalog-lib.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Produce deterministic JSON for contract comparisons and diagnostics. */
export function canonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Describe expected-versus-runtime behavior drift consistently. */
export function behaviorIssue(
  file: string,
  subject: string,
  expected: unknown,
  actual: unknown,
): CatalogIssue {
  return issue(
    file,
    `${file}: ${subject} contract ${canonical(expected)} does not match runtime behavior ${canonical(actual)}`,
  );
}
