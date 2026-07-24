import { describe, expect, test } from "bun:test";

import path from "node:path";

import {
  compileToolDefinition,
  compileToolProfile,
  parseToolAdapterManifest,
} from "../src/core/tool-adapters.js";

function manifestSource(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "tool",
    id: "gh",
    displayName: "GitHub CLI",
    pack: "essentials",
    executable: { primary: "gh" },
    ...overrides,
  });
}

describe("tool adapter manifests", () => {
  test("compiles a JSONC manifest into a tool definition and default profile", () => {
    const manifest = parseToolAdapterManifest(`{
      // GitHub CLI adapter
      "schemaVersion": 1,
      "kind": "tool",
      "id": "gh",
      "displayName": "GitHub CLI",
      "description": "Work with GitHub from the terminal.",
      "pack": "essentials",
      "executable": {
        "primary": "gh",
        "alternatives": ["gh-insiders"],
        "shim": true,
      },
      "isolation": { "scope": "process", "state": "full" },
      "auth": {
        "login": ["auth", "login"],
        "status": ["auth", "status"],
        "logout": ["auth", "logout"],
      },
      "profile": {
        "env": {
          "GH_CONFIG_DIR": "{{idealityHome}}/profiles/{{identity}}/gh",
          "GH_TOKEN": {
            "from": "secret",
            "key": "{{identity}}/gh-token",
            "optional": true,
          },
          "GH_NO_UPDATE_NOTIFIER": null,
        },
        "args": ["--config-dir", "{{idealityHome}}/profiles/{{identity}}/gh"],
      },
    }`);

    expect(compileToolDefinition(manifest)).toEqual({
      executable: "gh",
      displayName: "GitHub CLI",
      description: "Work with GitHub from the terminal.",
      pack: "essentials",
      isolation: "process",
      stateIsolation: "full",
      shim: true,
      detect: ["gh-insiders"],
      auth: {
        login: ["auth", "login"],
        status: ["auth", "status"],
        logout: ["auth", "logout"],
      },
    });
    expect(compileToolProfile(manifest)).toEqual({
      env: {
        GH_CONFIG_DIR: "{{idealityHome}}/profiles/{{identity}}/gh",
        GH_TOKEN: {
          from: "secret",
          key: "{{identity}}/gh-token",
          optional: true,
        },
        GH_NO_UPDATE_NOTIFIER: null,
      },
      args: ["--config-dir", "{{idealityHome}}/profiles/{{identity}}/gh"],
    });
  });

  test("defaults to process isolation with partial state and an empty profile", () => {
    const manifest = parseToolAdapterManifest(manifestSource());

    expect(compileToolDefinition(manifest)).toEqual({
      executable: "gh",
      displayName: "GitHub CLI",
      pack: "essentials",
      isolation: "process",
      stateIsolation: "partial",
    });
    expect(compileToolProfile(manifest)).toEqual({});
  });

  test("emits Gerrit SSH key arguments only when the identity provides a key", () => {
    const manifest = parseToolAdapterManifest(`{
      "schemaVersion": 1,
      "kind": "tool",
      "id": "gerrit",
      "displayName": "Gerrit SSH command transport",
      "pack": "source-control",
      "executable": { "primary": "ssh" },
      "isolation": { "scope": "process", "state": "credentials" },
      "profile": {
        "args": [{ "fromIdentity": "sshKey", "prefix": ["-i"] }]
      }
    }`);

    const keyed = compileToolProfile(manifest, {
      git: {
        name: "Sample Developer",
        email: "sample@example.com",
        sshKey: "/home/sample/.ssh/id_ed25519",
      },
    });
    expect(keyed.args).toEqual(["-i", "/home/sample/.ssh/id_ed25519"]);

    const keyless = compileToolProfile(manifest, {
      git: { name: "Sample Developer", email: "sample@example.com" },
    });
    expect(keyless).toEqual({});
    expect(compileToolProfile(manifest)).toEqual({});
  });

  test("rejects unknown fields including hook-like escape hatches", () => {
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({ hooks: { postActivate: "rm -rf /" } }),
      ),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({ executable: { primary: "gh", command: "gh api" } }),
      ),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({ auth: { login: "gh auth login" } }),
      ),
    ).toThrow("Invalid tool adapter manifest");
  });

  test("rejects unsupported schema versions and kinds", () => {
    expect(() =>
      parseToolAdapterManifest(manifestSource({ schemaVersion: 2 })),
    ).toThrow("schemaVersion");
    expect(() =>
      parseToolAdapterManifest(manifestSource({ kind: "network" })),
    ).toThrow("Invalid tool adapter manifest");
  });

  test("rejects unsafe identifiers, executables, and variable names", () => {
    expect(() =>
      parseToolAdapterManifest(manifestSource({ id: "../bad" })),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(manifestSource({ pack: "No Pack" })),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({ executable: { primary: "/usr/bin/gh" } }),
      ),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({
          executable: { primary: "gh", alternatives: ["-insiders"] },
        }),
      ),
    ).toThrow("Invalid tool adapter manifest");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({
          profile: { env: { "BAD NAME": "value" } },
        }),
      ),
    ).toThrow("BAD NAME");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({
          profile: { env: { "GH=TOKEN": "value" } },
        }),
      ),
    ).toThrow("Invalid tool adapter manifest");
  });

  test("rejects duplicate executable aliases", () => {
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({
          executable: { primary: "gh", alternatives: ["gh2", "gh2"] },
        }),
      ),
    ).toThrow("Duplicate executable alias");
    expect(() =>
      parseToolAdapterManifest(
        manifestSource({
          executable: { primary: "gh", alternatives: ["gh"] },
        }),
      ),
    ).toThrow("Duplicate executable alias");
  });

  test("rejects malformed JSONC", () => {
    expect(() => parseToolAdapterManifest(`{"schemaVersion": 1,,}`)).toThrow(
      "Invalid tool adapter JSONC",
    );
  });

  test("ships a JSON Schema that mirrors the strict manifest contract", async () => {
    const schema = JSON.parse(
      await Bun.file(
        path.resolve(import.meta.dir, "../schemas/tool-adapter.v1.schema.json"),
      ).text(),
    ) as {
      properties: {
        schemaVersion: { const: number };
        kind: { const: string };
      };
      additionalProperties: boolean;
      required: string[];
    };

    expect(schema.properties.schemaVersion.const).toBe(1);
    expect(schema.properties.kind.const).toBe("tool");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(["id", "displayName", "pack", "executable"]),
    );
  });
});
