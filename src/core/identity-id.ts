export function deriveIdentityId(
  label: string,
  existingIds: Iterable<string>,
): string {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = /^[a-z]/.test(normalized)
    ? normalized || "identity"
    : `id-${normalized || "identity"}`;
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
