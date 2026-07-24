import { describe, expect, test } from "bun:test";

import { BUILTIN_TOOLS } from "../src/adapters/builtins.js";
import {
  authArguments,
  collectAuthHealth,
  redactAuthOutput,
} from "../src/core/auth.js";
import type { ProcessRunner } from "../src/core/process.js";
import type { IdealityConfig, ToolDefinition } from "../src/domain/config.js";

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

const HEALTH_TOOLS: Record<string, ToolDefinition> = {
  gh: {
    executable: "gh",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  },
  cf: { executable: "wrangler", auth: { status: ["auth", "whoami"] } },
  codex: { executable: "codex", auth: { status: ["login", "status"] } },
  chrome: { executable: "google-chrome" },
};

const fakeResolveExecutable = (tool: string): string | null =>
  tool === "codex" ? null : `/usr/bin/${tool}`;

describe("collectAuthHealth", () => {
  test("reports every state deterministically without aborting the batch", async () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "personal",
      identities: {
        work: {
          label: "Work",
          roots: ["~/code/work"],
          tools: {
            gh: { env: { GH_TOKEN: "work-secret-token-value" } },
            chrome: {},
            codex: {},
            mystery: {},
            cf: { enabled: false },
          },
        },
        personal: {
          label: "Personal",
          roots: ["~/code/personal"],
          tools: { gh: {}, cf: {} },
        },
      },
      tools: HEALTH_TOOLS,
    };
    const runner: ProcessRunner = async (command, options) => {
      if (command[0] === "/usr/bin/cf") {
        throw new Error("wrangler exploded");
      }
      if (options?.env?.IDEALITY_IDENTITY === "work") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "token expired for octo-work\n",
        };
      }
      return {
        exitCode: 0,
        stdout: "Logged in to github.com account octocat\n",
        stderr: "",
      };
    };

    const results = await collectAuthHealth(config, {
      home: "/home/sample",
      idealityHome: "/home/sample/.ideality",
      runner,
      resolveExecutable: fakeResolveExecutable,
    });

    expect(results.map((r) => `${r.identity}/${r.tool}=${r.state}`)).toEqual([
      "personal/cf=unavailable",
      "personal/gh=logged-in",
      "work/chrome=unsupported",
      "work/codex=unavailable",
      "work/gh=expired",
      "work/mystery=unsupported",
    ]);
    expect(results[0]!.detail).toContain("wrangler exploded");
    expect(results[1]!.detail).toBe("Logged in to github.com account octocat");
    expect(results[3]!.detail).toBe("executable 'codex' is not installed");
    expect(results[4]!.detail).toBe("exit 1: token expired for octo-work");
  });

  test("isolates each identity's environment during probes", async () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "alpha",
      identities: {
        alpha: {
          label: "Alpha",
          roots: ["~/code/alpha"],
          tools: { gh: { env: { GH_CONFIG_DIR: "~/.config/gh-alpha" } } },
        },
        beta: {
          label: "Beta",
          roots: ["~/code/beta"],
          tools: {
            gh: {
              env: {
                GH_CONFIG_DIR: "~/.config/gh-beta",
                GH_TOKEN: "beta-secret-token-value",
              },
            },
          },
        },
      },
      tools: HEALTH_TOOLS,
    };
    const seen: Record<string, Record<string, string> | undefined> = {};
    const runner: ProcessRunner = async (_command, options) => {
      seen[options?.env?.IDEALITY_IDENTITY ?? "unknown"] = options?.env;
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    };

    await collectAuthHealth(config, {
      home: "/home/iso",
      idealityHome: "/home/iso/.ideality",
      runner,
      resolveExecutable: fakeResolveExecutable,
    });

    expect(seen.alpha?.GH_CONFIG_DIR).toBe("/home/iso/.config/gh-alpha");
    expect(seen.beta?.GH_CONFIG_DIR).toBe("/home/iso/.config/gh-beta");
    expect(seen.alpha?.GH_TOKEN).toBeUndefined();
    expect(seen.beta?.GH_TOKEN).toBe("beta-secret-token-value");
    expect(seen.alpha?.IDEALITY_IDENTITY).toBe("alpha");
    expect(seen.beta?.IDEALITY_IDENTITY).toBe("beta");
  });

  test("redacts token-like values and known secrets from captured output", async () => {
    const token = `ghp_${"a".repeat(36)}`;
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "solo",
      identities: {
        solo: {
          label: "Solo",
          roots: ["~/code/solo"],
          tools: { gh: { env: { GH_TOKEN: "super-secret-value-99" } } },
        },
      },
      tools: HEALTH_TOOLS,
    };
    const runner: ProcessRunner = async () => ({
      exitCode: 0,
      stdout: `Logged in with ${token} using super-secret-value-99\n`,
      stderr: "",
    });

    const [result] = await collectAuthHealth(config, {
      home: "/home/solo",
      idealityHome: "/home/solo/.ideality",
      runner,
      resolveExecutable: fakeResolveExecutable,
    });

    expect(result!.state).toBe("logged-in");
    expect(result!.detail).toBe("Logged in with <redacted> using <redacted>");
    expect(result!.detail).not.toContain(token);
    expect(result!.detail).not.toContain("super-secret-value-99");
  });

  test("bounds status execution and reports timeouts as unavailable", async () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "solo",
      identities: {
        solo: {
          label: "Solo",
          roots: ["~/code/solo"],
          tools: { gh: {} },
        },
      },
      tools: HEALTH_TOOLS,
    };
    const runner: ProcessRunner = (_command, options) =>
      new Promise((resolve) => {
        options?.signal?.addEventListener(
          "abort",
          () => resolve({ exitCode: 143, stdout: "", stderr: "" }),
          { once: true },
        );
      });

    const [result] = await collectAuthHealth(config, {
      home: "/home/solo",
      idealityHome: "/home/solo/.ideality",
      timeoutMs: 20,
      runner,
      resolveExecutable: fakeResolveExecutable,
    });

    expect(result!.state).toBe("unavailable");
    expect(result!.detail).toBe("status probe timed out after 20ms");
  });
});

describe("redactAuthOutput", () => {
  test("masks common token shapes and exact secret values", () => {
    expect(
      redactAuthOutput("bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig12345"),
    ).toBe("bearer <redacted>");
    expect(redactAuthOutput(`key ${"f".repeat(40)}`)).toBe("key <redacted>");
    expect(redactAuthOutput("uses xoxb-1234567890-abcdef")).toBe(
      "uses <redacted>",
    );
    expect(
      redactAuthOutput("literal my-configured-secret here", [
        "my-configured-secret",
      ]),
    ).toBe("literal <redacted> here");
    expect(redactAuthOutput("plain status message")).toBe(
      "plain status message",
    );
  });
});
