import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";

import type {
  IdealityConfig,
  SecretBackendConfig,
} from "../domain/config.js";
import { expandHome } from "./resolution.js";

interface CommandResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: string;
}

export type SecretCommandRunner = (
  command: string[],
  input?: string,
) => Promise<CommandResult>;

async function runCommand(
  command: string[],
  input?: string,
): Promise<CommandResult> {
  const child = Bun.spawn(command, {
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

export async function readSecretValue(
  config: IdealityConfig,
  key: string,
  home: string,
  idealityHome: string,
  runner: SecretCommandRunner = runCommand,
): Promise<string> {
  const selected = backend(config);
  if (selected.type === "file") {
    return (await Bun.file(secretFile(selected, key, home, idealityHome)).text()).trim();
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

  assertKey(key);
  const service = selected.service ?? "ideality";
  const command =
    process.platform === "darwin"
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
  if (selected.type === "onepassword") {
    throw new Error(
      "1Password references are read-only in ideality; create the item with 'op' and use its op:// reference",
    );
  }
  if (process.platform === "darwin") {
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

export function secretBackendExecutable(
  config: IdealityConfig,
): string | null {
  switch (backend(config).type) {
    case "age":
      return "age";
    case "keychain":
      return process.platform === "darwin" ? "security" : "secret-tool";
    case "pass":
      return "pass";
    case "onepassword":
      return "op";
    default:
      return null;
  }
}
