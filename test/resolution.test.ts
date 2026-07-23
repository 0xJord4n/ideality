import { describe, expect, test } from "bun:test";

import { resolveIdentity } from "../src/core/resolution.js";
import type { IdealityConfig } from "../src/domain/config.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "personal",
  identities: {
    personal: {
      label: "Personal",
      roots: ["~/code/personal"],
      tools: {},
    },
    work: {
      label: "Work",
      roots: ["~/code/work", "~/work/shared"],
      tools: {},
    },
  },
  tools: {},
};

describe("resolveIdentity", () => {
  test("selects the identity with the most specific matching root", () => {
    const resolved = resolveIdentity(
      config,
      "/home/dev/code/work/project/packages/app",
      "/home/dev",
    );

    expect(resolved.id).toBe("work");
    expect(resolved.matchedRoot).toBe("/home/dev/code/work");
    expect(resolved.isDefault).toBe(false);
  });

  test("uses the configured default when no root matches", () => {
    const resolved = resolveIdentity(config, "/tmp/unmatched", "/home/dev");

    expect(resolved.id).toBe("personal");
    expect(resolved.matchedRoot).toBeNull();
    expect(resolved.isDefault).toBe(true);
  });
});
