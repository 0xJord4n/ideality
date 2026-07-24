import { describe, expect, test } from "bun:test";

import { explainTool } from "../src/core/explain.js";
import type { IdealityConfig, ResolvedIdentity } from "../src/domain/config.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "default",
  identities: {
    default: {
      label: "Default",
      roots: ["~/code"],
      tools: {
        sample: {
          env: {
            SAMPLE_TOKEN: {
              from: "file",
              path: "{{idealityHome}}/secrets/default/sample-token",
            },
          },
        },
      },
    },
  },
  tools: {
    sample: {
      executable: "sample",
      isolation: "process",
    },
  },
};

const resolved: ResolvedIdentity = {
  id: "default",
  identity: config.identities.default!,
  path: "/home/dev/code/project",
  matchedRoot: "/home/dev/code",
  isDefault: true,
};

describe("explainTool", () => {
  test("describes dispatch without exposing resolved secrets", async () => {
    const explanation = await explainTool(config, resolved, {
      tool: "sample",
      home: "/home/dev",
      idealityHome: "/home/dev/.ideality",
      executable: "/usr/bin/sample",
      readFile: async () => "secret-value",
    });

    expect(explanation).toMatchObject({
      identity: "default",
      label: "Default",
      matchedRoot: "/home/dev/code",
      executable: "/usr/bin/sample",
      shim: "/home/dev/.ideality/bin/sample",
      intercepted: true,
      isolation: "process",
      environment: {
        SAMPLE_TOKEN: "<secret:file>",
      },
    });
    expect(JSON.stringify(explanation)).not.toContain("secret-value");
  });
});
