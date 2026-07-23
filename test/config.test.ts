import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/core/config-store.js";

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
});
