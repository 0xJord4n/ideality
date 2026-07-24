import { describe, expect, test } from "bun:test";
import type { IdealityConfig } from "../src/domain/config.js";
import { resolveSecretContext } from "../src/integrations/secrets.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "sample",
  identities: {
    sample: {
      label: "Sample",
      roots: ["/work/one", "/work/two"],
      tools: {},
    },
  },
  tools: {},
};

describe("resolveSecretContext", () => {
  test("requires an explicit matching path for root-templated secrets", () => {
    expect(() =>
      resolveSecretContext(
        config,
        "sample",
        "/home/dev",
        "{{root}}/.secrets/token",
      ),
    ).toThrow("requires --path");

    expect(
      resolveSecretContext(
        config,
        "sample",
        "/home/dev",
        "{{root}}/.secrets/token",
        "/work/two/project",
      ).matchedRoot,
    ).toBe("/work/two");
  });
});
