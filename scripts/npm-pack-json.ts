export interface NpmPackFile {
  path: string;
  mode?: number;
}

export interface NpmPackResult {
  name: string;
  filename: string;
  files: NpmPackFile[];
}

function isNpmPackResult(value: unknown): value is NpmPackResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.filename === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(
      (file) =>
        file !== null &&
        typeof file === "object" &&
        typeof (file as Record<string, unknown>).path === "string",
    )
  );
}

export function parseNpmPackResult(output: string): NpmPackResult {
  const parsed: unknown = JSON.parse(output);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error("npm pack returned no package");
    if (parsed.length === 1 && isNpmPackResult(parsed[0])) return parsed[0];
    throw new Error("npm pack returned no valid package");
  }
  if (parsed && typeof parsed === "object") {
    const packages = Object.values(parsed);
    if (packages.length === 1 && isNpmPackResult(packages[0])) {
      return packages[0];
    }
  }
  throw new Error("npm pack returned no valid package");
}

const expectedFiles = [
  "LICENSE",
  "README.md",
  "bin/ideality",
  "package.json",
  "scripts/install-package.sh",
  "scripts/install.sh",
];

if (import.meta.main) {
  const packed = Bun.spawnSync({
    cmd: ["npm", "pack", "--ignore-scripts", "--dry-run", "--json"],
    stdout: "pipe",
    stderr: "inherit",
  });
  if (packed.exitCode !== 0) process.exit(packed.exitCode);

  const result = parseNpmPackResult(packed.stdout.toString());
  const actualFiles = result.files.map((file) => file.path).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `npm package file set mismatch\nexpected: ${expectedFiles.join(", ")}\nactual: ${actualFiles.join(", ")}`,
    );
  }
  console.log(`Validated ${result.name}: ${actualFiles.join(", ")}`);
}
