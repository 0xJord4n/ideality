import { describe, expect, test } from "bun:test";

import {
  commandArguments,
  discoverConfiguredGitIdentity,
} from "../src/commands/shared.js";

describe("commandArguments", () => {
  test("preserves option-like values after the passthrough separator", () => {
    expect(
      commandArguments(["sample", "value-that-survived-parser"], 1, [
        "run",
        "sample",
        "--identity",
        "work",
        "--",
        "--region",
        "eu",
      ]),
    ).toEqual(["--region", "eu"]);
  });

  test("falls back to parsed positional arguments without a separator", () => {
    expect(
      commandArguments(["sample", "one", "two"], 1, ["run", "sample"]),
    ).toEqual(["one", "two"]);
  });
});

describe("discoverConfiguredGitIdentity", () => {
  test("rejects invalid discovered Git name and email values", () => {
    const originalSpawnSync = Bun.spawnSync;
    Bun.spawnSync = ((options: { cmd: string[] }) => ({
      exitCode: 0,
      stdout: Buffer.from(
        options.cmd.at(-1) === "user.name" ? "   \n" : "not-an-email\n",
      ),
      stderr: Buffer.from(""),
    })) as typeof Bun.spawnSync;
    try {
      expect(discoverConfiguredGitIdentity()).toEqual({
        name: undefined,
        email: undefined,
      });
    } finally {
      Bun.spawnSync = originalSpawnSync;
    }
  });
});
