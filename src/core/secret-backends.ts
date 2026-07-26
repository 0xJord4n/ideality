import { chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { IdealityConfig, SecretBackendConfig } from "../domain/config.js";
import { expandHome } from "./resolution.js";

export type SecretBackendType = SecretBackendConfig["type"];

interface CommandResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: string;
}

export type SecretCommandRunner = (
  command: string[],
  input?: string,
  environment?: Record<string, string>,
) => Promise<CommandResult>;

export interface SecretReferenceList {
  backend: SecretBackendConfig["type"];
  supported: boolean;
  writable: boolean;
  references: string[];
}

async function runCommand(
  command: string[],
  input?: string,
  environment?: Record<string, string>,
): Promise<CommandResult> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, environment);
  const child = Bun.spawn(command, {
    env,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) {
    child.stdin!.write(input);
    child.stdin!.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr: stderr.trim() };
}

function backend(config: IdealityConfig): SecretBackendConfig {
  return config.secretBackend ?? { type: "file" };
}

function assertKey(key: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) ||
    key.split("/").includes("..")
  ) {
    throw new Error(`Invalid secret key '${key}'`);
  }
}

function directoryFor(
  config: SecretBackendConfig & { type: "file" | "age" },
  home: string,
  idealityHome: string,
): string {
  return config.directory
    ? expandHome(config.directory, home)
    : path.join(idealityHome, "secrets");
}

function secretFile(
  config: SecretBackendConfig & { type: "file" | "age" },
  key: string,
  home: string,
  idealityHome: string,
): string {
  assertKey(key);
  const directory = path.resolve(directoryFor(config, home, idealityHome));
  const target = path.resolve(
    directory,
    config.type === "age" ? `${key}.age` : key,
  );
  if (!target.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`Secret key '${key}' escapes the backend directory`);
  }
  return target;
}

function commandError(command: string, result: CommandResult): Error {
  return new Error(
    `${command} failed${result.stderr ? `: ${result.stderr}` : ""}`,
  );
}

async function listFilesRecursively(
  directory: string,
  suffix = "",
): Promise<string[]> {
  const found: string[] = [];
  async function visit(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile() && (!suffix || relative.endsWith(suffix))) {
        found.push(suffix ? relative.slice(0, -suffix.length) : relative);
      }
    }
  }
  try {
    await visit(directory, "");
    return found.sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

function externalReference(
  key: string,
  scheme: "bw://" | "dl://",
  backendName: string,
): string {
  if (!key.startsWith(scheme)) {
    throw new Error(`${backendName} secret keys must be ${scheme} references`);
  }
  const reference = key.slice(scheme.length);
  if (!reference || /[\0\r\n]/.test(reference)) {
    throw new Error(`Invalid ${backendName} secret reference`);
  }
  try {
    const decoded = decodeURIComponent(reference);
    if (/[\0\r\n]/.test(decoded)) {
      throw new Error("control character");
    }
    return decoded;
  } catch {
    throw new Error(`Invalid ${backendName} secret reference encoding`);
  }
}

export async function readSecretValue(
  config: IdealityConfig,
  key: string,
  home: string,
  idealityHome: string,
  runner: SecretCommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const selected = backend(config);
  if (selected.type === "file") {
    return (
      await Bun.file(secretFile(selected, key, home, idealityHome)).text()
    ).trim();
  }
  if (selected.type === "age") {
    const file = secretFile(selected, key, home, idealityHome);
    const identity = expandHome(selected.identityFile, home);
    const result = await runner(["age", "--decrypt", "-i", identity, file]);
    if (result.exitCode !== 0) throw commandError("age", result);
    return new TextDecoder().decode(result.stdout).trim();
  }
  if (selected.type === "pass") {
    assertKey(key);
    const name = [selected.prefix ?? "ideality", key].filter(Boolean).join("/");
    const result = await runner(["pass", "show", name]);
    if (result.exitCode !== 0) throw commandError("pass", result);
    return new TextDecoder().decode(result.stdout).split("\n")[0]!.trim();
  }
  if (selected.type === "onepassword") {
    if (!key.startsWith("op://")) {
      throw new Error("1Password secret keys must be op:// references");
    }
    const result = await runner(["op", "read", key]);
    if (result.exitCode !== 0) throw commandError("op", result);
    return new TextDecoder().decode(result.stdout).trim();
  }
  if (selected.type === "bitwarden") {
    const item = externalReference(key, "bw://", "Bitwarden");
    const environment = selected.appDataDirectory
      ? {
          BITWARDENCLI_APPDATA_DIR: expandHome(selected.appDataDirectory, home),
        }
      : undefined;
    const result = await runner(
      ["bw", "get", "password", item],
      undefined,
      environment,
    );
    if (result.exitCode !== 0) throw commandError("bw", result);
    return new TextDecoder().decode(result.stdout).trim();
  }
  if (selected.type === "dashlane") {
    externalReference(key, "dl://", "Dashlane");
    const result = await runner(["dcli", "read", key]);
    if (result.exitCode !== 0) throw commandError("dcli", result);
    return new TextDecoder().decode(result.stdout).trim();
  }

  assertKey(key);
  const service = selected.service ?? "ideality";
  const command =
    platform === "darwin"
      ? ["security", "find-generic-password", "-s", service, "-a", key, "-w"]
      : ["secret-tool", "lookup", "service", service, "key", key];
  const result = await runner(command);
  if (result.exitCode !== 0) throw commandError(command[0]!, result);
  return new TextDecoder().decode(result.stdout).trim();
}

export async function writeSecretValue(
  config: IdealityConfig,
  key: string,
  value: string,
  home: string,
  idealityHome: string,
  runner: SecretCommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const normalized = value.trim();
  if (!normalized) throw new Error("Secret value cannot be empty");
  const selected = backend(config);
  if (selected.type === "file") {
    const file = secretFile(selected, key, home, idealityHome);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    await Bun.write(temporary, `${normalized}\n`);
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    return;
  }
  if (selected.type === "age") {
    const file = secretFile(selected, key, home, idealityHome);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const result = await runner(
      ["age", "--encrypt", "-r", selected.recipient],
      `${normalized}\n`,
    );
    if (result.exitCode !== 0) throw commandError("age", result);
    const temporary = `${file}.${process.pid}.tmp`;
    await Bun.write(temporary, result.stdout);
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    return;
  }
  if (selected.type === "pass") {
    assertKey(key);
    const name = [selected.prefix ?? "ideality", key].filter(Boolean).join("/");
    const result = await runner(
      ["pass", "insert", "--multiline", "--force", name],
      `${normalized}\n`,
    );
    if (result.exitCode !== 0) throw commandError("pass", result);
    return;
  }
  if (
    selected.type === "onepassword" ||
    selected.type === "bitwarden" ||
    selected.type === "dashlane"
  ) {
    const name =
      selected.type === "onepassword"
        ? "1Password"
        : selected.type === "bitwarden"
          ? "Bitwarden"
          : "Dashlane";
    throw new Error(
      `${name} references are read-only in ideality; create or update the item with its native app or CLI`,
    );
  }
  if (platform === "darwin") {
    throw new Error(
      "Keychain writes are disabled on macOS because the security CLI exposes values in process arguments; use age, pass, or 1Password",
    );
  }
  assertKey(key);
  const service = selected.service ?? "ideality";
  const result = await runner(
    [
      "secret-tool",
      "store",
      "--label",
      `Ideality ${key}`,
      "service",
      service,
      "key",
      key,
    ],
    `${normalized}\n`,
  );
  if (result.exitCode !== 0) throw commandError("secret-tool", result);
}

/** List backend-owned logical references without reading secret values. */
export async function listSecretReferences(
  config: IdealityConfig,
  home: string,
  idealityHome: string,
  platform: NodeJS.Platform = process.platform,
): Promise<SecretReferenceList> {
  const selected = backend(config);
  if (selected.type === "file") {
    return {
      backend: selected.type,
      supported: true,
      writable: secretBackendWritable(config, platform),
      references: await listFilesRecursively(
        directoryFor(selected, home, idealityHome),
      ),
    };
  }
  if (selected.type === "age") {
    return {
      backend: selected.type,
      supported: true,
      writable: secretBackendWritable(config, platform),
      references: await listFilesRecursively(
        directoryFor(selected, home, idealityHome),
        ".age",
      ),
    };
  }
  return {
    backend: selected.type,
    supported: false,
    writable: secretBackendWritable(config, platform),
    references: [],
  };
}

/** Delete a backend-owned logical secret without accepting or exposing values. */
export async function deleteSecretValue(
  config: IdealityConfig,
  key: string,
  home: string,
  idealityHome: string,
  runner: SecretCommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (!secretBackendWritable(config, platform)) {
    throw new Error(
      `${backend(config).type} references are read-only; delete the item with its native app or CLI`,
    );
  }
  const selected = backend(config);
  if (selected.type === "file" || selected.type === "age") {
    await rm(secretFile(selected, key, home, idealityHome), { force: true });
    return;
  }
  if (selected.type === "pass") {
    assertKey(key);
    const name = [selected.prefix ?? "ideality", key].filter(Boolean).join("/");
    const result = await runner(["pass", "rm", "--force", name]);
    if (result.exitCode !== 0) throw commandError("pass", result);
    return;
  }
  if (selected.type === "keychain") {
    assertKey(key);
    const service = selected.service ?? "ideality";
    const command =
      platform === "darwin"
        ? ["security", "delete-generic-password", "-s", service, "-a", key]
        : ["secret-tool", "clear", "service", service, "key", key];
    const result = await runner(command);
    if (result.exitCode !== 0) throw commandError(command[0]!, result);
    return;
  }
  throw new Error(
    `${selected.type} references are read-only; delete the item with its native app or CLI`,
  );
}

export function secretBackendExecutable(
  config: IdealityConfig,
  platform: NodeJS.Platform = process.platform,
): string | null {
  switch (backend(config).type) {
    case "age":
      return "age";
    case "keychain":
      return platform === "darwin" ? "security" : "secret-tool";
    case "pass":
      return "pass";
    case "onepassword":
      return "op";
    case "bitwarden":
      return "bw";
    case "dashlane":
      return "dcli";
    default:
      return null;
  }
}

export function secretBackendWritable(
  config: IdealityConfig,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const type = backend(config).type;
  if (type === "onepassword" || type === "bitwarden" || type === "dashlane") {
    return false;
  }
  return type !== "keychain" || platform !== "darwin";
}
