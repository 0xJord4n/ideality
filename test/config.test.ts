import { describe, expect, test } from "bun:test";

import {
  getIdealityHome,
  parseConfig,
} from "../src/core/config-store.js";

describe("parseConfig", () => {
  test("rejects a default identity that is not defined", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "missing",
        "identities": {
          "personal": { "label": "Personal", "roots": ["~/code/personal"], "tools": {} }
        },
        "tools": {}
      }`),
    ).toThrow("Default identity 'missing' does not exist");
  });

  test("rejects identity IDs that could escape managed profile paths", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "../outside",
        "identities": {
          "../outside": { "label": "Unsafe", "roots": ["/tmp/work"], "tools": {} }
        },
        "tools": {}
      }`),
    ).toThrow("Invalid identity ID '../outside'");
  });

  test("rejects logical secrets that would be exported into a shell", () => {
    expect(() =>
      parseConfig(`{
        "version": 1,
        "defaultIdentity": "sample",
        "identities": {
          "sample": {
            "label": "Sample",
            "roots": ["/workspace"],
            "tools": {
              "demo": {
                "isolation": "shell",
                "env": { "DEMO_TOKEN": { "from": "secret", "key": "sample/demo" } }
              }
            }
          }
        },
        "tools": { "demo": { "executable": "demo", "isolation": "shell" } }
      }`),
    ).toThrow("Logical secrets require process isolation");
  });

  test("accepts Bitwarden and Dashlane secret backend settings", () => {
    const base = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: { label: "Sample", roots: ["/workspace"], tools: {} },
      },
      tools: {},
    };
    expect(
      parseConfig(
        JSON.stringify({
          ...base,
          secretBackend: {
            type: "bitwarden",
            appDataDirectory: "~/.config/bitwarden-sample",
          },
        }),
      ).secretBackend,
    ).toEqual({
      type: "bitwarden",
      appDataDirectory: "~/.config/bitwarden-sample",
    });
    expect(
      parseConfig(
        JSON.stringify({
          ...base,
          secretBackend: { type: "dashlane" },
        }),
      ).secretBackend,
    ).toEqual({ type: "dashlane" });
  });
});

describe("getIdealityHome", () => {
  test("uses a single hidden directory under HOME by default", () => {
    expect(getIdealityHome({ HOME: "/home/dev" })).toBe("/home/dev/.ideality");
    expect(
      getIdealityHome({
        HOME: "/home/dev",
        XDG_CONFIG_HOME: "/home/dev/.config",
      }),
    ).toBe("/home/dev/.ideality");
    expect(
      getIdealityHome({
        HOME: "/home/dev",
        IDEALITY_HOME: "/secure/ideality",
      }),
    ).toBe("/secure/ideality");
  });
});
