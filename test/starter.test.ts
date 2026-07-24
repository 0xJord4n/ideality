import { describe, expect, test } from "bun:test";

import { BUILTIN_TOOLS } from "../src/adapters/builtins.js";
import { createToolProfiles } from "../src/core/starter.js";

describe("starter tool profiles", () => {
  test("provides every supported built-in adapter", () => {
    const profiles = createToolProfiles("sample");

    expect(Object.keys(profiles).sort()).toEqual(Object.keys(BUILTIN_TOOLS).sort());
    expect(profiles.gh?.env?.GH_CONFIG_DIR).toContain("/sample/gh");
    expect(profiles.railway?.env?.RAILWAY_API_TOKEN).toEqual({
      from: "file",
      path: "{{idealityHome}}/secrets/sample/railway-token",
      optional: true,
    });
    expect(profiles.cf?.env).toMatchObject({
      CLOUDFLARE_API_TOKEN: {
        from: "file",
        path: "{{idealityHome}}/secrets/sample/cloudflare-token",
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
    expect(profiles.opencode?.env?.XDG_CONFIG_HOME).toContain("/sample/opencode/");
    expect(profiles.vercel?.env?.XDG_CONFIG_HOME).toContain("/sample/vercel/");
    expect(profiles.chrome?.args?.[0]).toContain("/sample/browsers/chrome");
    expect(profiles.firefox?.args?.[1]).toContain("/sample/browsers/firefox");
    expect(
      Object.values(BUILTIN_TOOLS).every(
        (definition) => definition.isolation === "process",
      ),
    ).toBe(true);
  });
});
