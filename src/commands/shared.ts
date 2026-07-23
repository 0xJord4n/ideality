import type { GitIdentity } from "../domain/config.js";

export function requirePositional(
  positional: string[],
  index: number,
  label: string,
): string {
  const value = positional[index];
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

export function commandArguments(
  positional: string[],
  consumed: number,
  argv: string[] = process.argv.slice(2),
): string[] {
  const separator = argv.indexOf("--");
  return separator >= 0 ? argv.slice(separator + 1) : positional.slice(consumed);
}

export function assertIdentityId(id: string): void {
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
    throw new Error(
      "Identity ID must start with a lowercase letter and contain only letters, numbers, _ or -",
    );
  }
}

function gitConfig(key: string): string | null {
  const result = Bun.spawnSync({
    cmd: ["git", "config", "--global", "--get", key],
    stdout: "pipe",
    stderr: "pipe",
  });
  const value = result.stdout.toString().trim();
  return result.exitCode === 0 && value ? value : null;
}

export function discoverGitIdentity(
  name?: string,
  email?: string,
): GitIdentity {
  const user = process.env.USER || "developer";
  return {
    name: name || gitConfig("user.name") || "Example Developer",
    email: email || gitConfig("user.email") || `${user}@example.invalid`,
  };
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
