import { describe, expect, test } from "bun:test";

import { BUILTIN_TOOLS } from "../src/adapters/builtins.js";
import { authArguments } from "../src/core/auth.js";

describe("authArguments", () => {
  test("maps supported provider actions to their native CLI commands", () => {
    expect(authArguments(BUILTIN_TOOLS.gh!, "login")).toEqual([
      "auth",
      "login",
    ]);
    expect(authArguments(BUILTIN_TOOLS.cf!, "status")).toEqual([
      "auth",
      "whoami",
    ]);
    expect(authArguments(BUILTIN_TOOLS.codex!, "logout")).toEqual(["logout"]);
    expect(authArguments(BUILTIN_TOOLS.opencode!, "status")).toEqual([
      "auth",
      "list",
    ]);
  });

  test("rejects providers without the requested workflow", () => {
    expect(() => authArguments(BUILTIN_TOOLS.chrome!, "login")).toThrow(
      "does not support",
    );
  });
});
