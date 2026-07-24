import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readSecretValue,
  writeSecretValue,
  type SecretCommandRunner,
} from "../src/core/secret-backends.js";
import type { IdealityConfig } from "../src/domain/config.js";

function config(backend: IdealityConfig["secretBackend"]): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    secretBackend: backend,
    identities: {
      sample: { label: "Sample", roots: ["/workspace"], tools: {} },
    },
    tools: {},
  };
}

describe("secret backends", () => {
  test("writes file-backed logical secrets with locked permissions", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-secret-"));
    await writeSecretValue(
      config({ type: "file" }),
      "sample/token",
      "private-value",
      home,
      path.join(home, ".ideality"),
    );
    expect(
      await readSecretValue(
        config({ type: "file" }),
        "sample/token",
        home,
        path.join(home, ".ideality"),
      ),
    ).toBe("private-value");
    expect(
      (await Bun.file(path.join(home, ".ideality/secrets/sample/token")).stat())
        .mode & 0o777,
    ).toBe(0o600);
  });

  test("passes values over stdin to age without exposing them in arguments", async () => {
    const calls: Array<{ command: string[]; input?: string }> = [];
    const runner: SecretCommandRunner = async (command, input) => {
      calls.push({ command, input });
      return {
        exitCode: 0,
        stdout: new TextEncoder().encode("encrypted"),
        stderr: "",
      };
    };
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-age-"));
    await writeSecretValue(
      config({
        type: "age",
        recipient: "age1example",
        identityFile: "~/.config/age/key.txt",
      }),
      "sample/token",
      "private-value",
      home,
      path.join(home, ".ideality"),
      runner,
    );
    expect(calls[0]?.command).toEqual([
      "age",
      "--encrypt",
      "-r",
      "age1example",
    ]);
    expect(calls[0]?.command.join(" ")).not.toContain("private-value");
    expect(calls[0]?.input).toBe("private-value\n");
  });

  test("reads 1Password references without accepting arbitrary keys", async () => {
    const runner: SecretCommandRunner = async () => ({
      exitCode: 0,
      stdout: new TextEncoder().encode("resolved"),
      stderr: "",
    });
    await expect(
      readSecretValue(
        config({ type: "onepassword" }),
        "plain-key",
        "/home/dev",
        "/home/dev/.ideality",
        runner,
      ),
    ).rejects.toThrow("op://");
  });
});
