import { describe, expect, test } from "bun:test";

import {
  applyPlugin,
  parsePluginManifest,
} from "../src/core/plugins.js";
import type { IdealityConfig } from "../src/domain/config.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "sample",
  identities: {
    sample: { label: "Sample", roots: ["/workspace"], tools: {} },
  },
  tools: {},
};

describe("plugin manifests", () => {
  test("adds a process-scoped adapter and profile to every identity", () => {
    const manifest = parsePluginManifest(`{
      // Portable custom integration
      "version": 1,
      "name": "acme",
      "executable": "acme",
      "detect": ["acme-cli"],
      "profile": {
        "env": {
          "ACME_TOKEN": { "from": "secret", "key": "{{identity}}/acme" }
        }
      }
    }`);
    const next = applyPlugin(config, manifest);
    expect(next.tools.acme).toMatchObject({
      executable: "acme",
      isolation: "process",
    });
    expect(next.identities.sample?.tools.acme?.env?.ACME_TOKEN).toEqual({
      from: "secret",
      key: "{{identity}}/acme",
    });
  });

  test("rejects unsafe names and shell-wide plugin isolation", () => {
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"../bad","executable":"bad"}`,
      ),
    ).toThrow("Invalid plugin manifest");
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"bad","executable":"bad","profile":{"isolation":"shell"}}`,
      ),
    ).toThrow("Invalid plugin manifest");
  });
});
