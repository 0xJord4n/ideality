import { describe, expect, test } from "bun:test";

import { commandArguments } from "../src/commands/shared.js";

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
