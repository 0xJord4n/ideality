import { describe, expect, test } from "bun:test";

import {
  BUILTIN_TOOL_PACKS,
  BUILTIN_TOOLS,
  toolsInPacks,
} from "../src/adapters/builtins.js";
import {
  createStarterConfig,
  createToolProfiles,
} from "../src/core/starter.js";

describe("starter tool profiles", () => {
  test("provides every supported built-in adapter", () => {
    const profiles = createToolProfiles("sample");

    expect(Object.keys(profiles).sort()).toEqual(
      Object.keys(BUILTIN_TOOLS).sort(),
    );
    expect(profiles.gh?.env?.GH_CONFIG_DIR).toContain("/sample/gh");
    expect(profiles.railway?.env?.RAILWAY_API_TOKEN).toEqual({
      from: "secret",
      key: "{{identity}}/railway-token",
      optional: true,
    });
    expect(profiles.cf?.env).toMatchObject({
      CLOUDFLARE_API_TOKEN: {
        from: "secret",
        key: "{{identity}}/cloudflare-token",
        optional: true,
      },
      CLOUDFLARE_ACCOUNT_ID: {
        from: "file",
        path: "{{idealityHome}}/profiles/sample/cloudflare-account-id",
        optional: true,
      },
      CLOUDFLARE_ZONE_ID: {
        from: "file",
        path: "{{idealityHome}}/profiles/sample/cloudflare-zone-id",
        optional: true,
      },
    });
    expect(profiles.codex?.env?.CODEX_HOME).toContain("/sample/codex");
    expect(profiles.claude?.env?.CLAUDE_CONFIG_DIR).toContain("/sample/claude");
    expect(profiles.opencode?.env?.XDG_CONFIG_HOME).toContain(
      "/sample/opencode/",
    );
    expect(profiles.vercel?.env?.XDG_CONFIG_HOME).toContain("/sample/vercel/");
    expect(profiles.chrome?.args?.[0]).toContain("/sample/browsers/chrome");
    expect(profiles.firefox?.args?.[1]).toContain("/sample/browsers/firefox");
    expect(
      Object.values(BUILTIN_TOOLS).every(
        (definition) => definition.isolation === "process",
      ),
    ).toBe(true);
  });

  test("keeps every built-in in exactly one selectable pack", () => {
    const packed = Object.values(BUILTIN_TOOL_PACKS).flatMap(
      (pack) => pack.tools,
    );

    expect([...new Set(packed)].sort()).toEqual(
      Object.keys(BUILTIN_TOOLS).sort(),
    );
    expect(packed).toHaveLength(Object.keys(BUILTIN_TOOLS).length);
    expect(toolsInPacks(["cloud"])).toEqual(["aws", "gcloud", "az", "doctl"]);
  });

  test("creates only selected profiles while retaining the complete catalog", () => {
    const config = createStarterConfig({
      id: "sample",
      label: "Sample",
      root: "~/code/sample",
      git: { name: "Sample Developer", email: "sample@example.com" },
      tools: ["aws", "copilot"],
    });

    expect(Object.keys(config.identities.sample!.tools)).toEqual([
      "aws",
      "copilot",
    ]);
    expect(config.identities.sample!.tools.aws?.env).toMatchObject({
      AWS_CONFIG_FILE: expect.stringContaining("/sample/cloud/aws/config"),
      AWS_SHARED_CREDENTIALS_FILE: expect.stringContaining(
        "/sample/cloud/aws/credentials",
      ),
    });
    expect(config.identities.sample!.tools.copilot?.env).toMatchObject({
      COPILOT_HOME: expect.stringContaining("/sample/ai/copilot"),
    });
    expect(Object.keys(config.tools).sort()).toEqual(
      Object.keys(BUILTIN_TOOLS).sort(),
    );
  });

  test("routes Gerrit SSH through the identity key", () => {
    const profiles = createToolProfiles(
      "sample",
      ["gerrit"],
      "/home/sample/.ssh/id_ed25519",
    );

    expect(profiles.gerrit?.args).toEqual([
      "-i",
      "/home/sample/.ssh/id_ed25519",
    ]);
  });
});
