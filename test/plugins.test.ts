import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  applyPlugin,
  listPluginManifests,
  parsePluginManifest,
  pluginDirectory,
  writePluginManifest,
} from "../src/core/plugins.js";
import type { IdealityConfig } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "sample",
  identities: {
    sample: { label: "Sample", roots: ["/workspace"], tools: {} },
  },
  tools: {},
};

const legacySource = `{
  // Portable custom integration
  "version": 1,
  "name": "acme",
  "description": "Acme deploy CLI",
  "executable": "acme",
  "detect": ["acme-cli"],
  "auth": { "login": ["login"], "status": ["whoami"] },
  "profile": {
    "isolation": "process",
    "env": {
      "ACME_TOKEN": { "from": "secret", "key": "{{identity}}/acme" }
    },
    "args": ["--profile", "{{identity}}"]
  }
}`;

describe("plugin manifests", () => {
  test("translates a version-1 manifest into the canonical adapter shape", () => {
    expect(parsePluginManifest(legacySource)).toEqual({
      schemaVersion: 1,
      kind: "tool",
      id: "acme",
      displayName: "acme",
      description: "Acme deploy CLI",
      pack: "custom",
      executable: { primary: "acme", alternatives: ["acme-cli"] },
      isolation: { scope: "process", state: "partial" },
      auth: { login: ["login"], status: ["whoami"] },
      profile: {
        env: {
          ACME_TOKEN: { from: "secret", key: "{{identity}}/acme" },
        },
        args: ["--profile", "{{identity}}"],
      },
    });
  });

  test("applies a plugin through the shared adapter compiler", () => {
    const next = applyPlugin(config, parsePluginManifest(legacySource));
    expect(next.tools.acme).toEqual({
      executable: "acme",
      displayName: "acme",
      description: "Acme deploy CLI",
      pack: "custom",
      isolation: "process",
      stateIsolation: "partial",
      detect: ["acme-cli"],
      auth: { login: ["login"], status: ["whoami"] },
    });
    expect(next.identities.sample?.tools.acme).toEqual({
      env: {
        ACME_TOKEN: { from: "secret", key: "{{identity}}/acme" },
      },
      args: ["--profile", "{{identity}}"],
    });
  });

  test("accepts new-format manifests and resolves identity arguments per identity", () => {
    const manifest = parsePluginManifest(`{
      "schemaVersion": 1,
      "kind": "tool",
      "id": "gerrit",
      "displayName": "Gerrit transport",
      "pack": "custom",
      "executable": { "primary": "ssh" },
      "isolation": { "scope": "process", "state": "credentials" },
      "profile": {
        "args": [{ "fromIdentity": "sshKey", "prefix": ["-i"] }]
      }
    }`);
    const keyed: IdealityConfig = structuredClone(config);
    keyed.identities.work = {
      label: "Work",
      roots: ["/work"],
      git: {
        name: "Sample Developer",
        email: "sample@example.com",
        sshKey: "/home/sample/.ssh/id_ed25519",
      },
      tools: {},
    };

    const next = applyPlugin(keyed, manifest);
    expect(next.tools.gerrit).toEqual({
      executable: "ssh",
      displayName: "Gerrit transport",
      pack: "custom",
      isolation: "process",
      stateIsolation: "credentials",
    });
    expect(next.identities.work?.tools.gerrit?.args).toEqual([
      "-i",
      "/home/sample/.ssh/id_ed25519",
    ]);
    expect(next.identities.sample?.tools.gerrit).toEqual({});
  });

  test("drops a redundant enabled flag and rejects untranslatable profile fields", () => {
    const enabled = parsePluginManifest(
      `{"version":1,"name":"acme","executable":"acme","profile":{"enabled":true,"args":["--verbose"]}}`,
    );
    expect(enabled.profile).toEqual({ args: ["--verbose"] });

    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"acme","profile":{"enabled":false}}`,
      ),
    ).toThrow(/profile\.enabled/);
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"acme","profile":{"executable":"other"}}`,
      ),
    ).toThrow(/profile\.executable/);
  });

  test("rejects unsafe names and shell-wide plugin isolation in both formats", () => {
    expect(() =>
      parsePluginManifest(`{"version":1,"name":"../bad","executable":"bad"}`),
    ).toThrow("Invalid plugin manifest");
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"bad","executable":"bad","profile":{"isolation":"shell"}}`,
      ),
    ).toThrow("Invalid plugin manifest");
    expect(() =>
      parsePluginManifest(`{
        "schemaVersion": 1,
        "kind": "tool",
        "id": "bad",
        "displayName": "Bad",
        "pack": "custom",
        "executable": { "primary": "bad" },
        "isolation": { "scope": "shell", "state": "partial" }
      }`),
    ).toThrow(/isolation\.scope/);
  });

  test("rejects hook-like and unknown fields in both formats", () => {
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"acme","hooks":{"postActivate":"rm -rf /"}}`,
      ),
    ).toThrow("Invalid plugin manifest");
    expect(() =>
      parsePluginManifest(`{
        "schemaVersion": 1,
        "kind": "tool",
        "id": "acme",
        "displayName": "Acme",
        "pack": "custom",
        "executable": { "primary": "acme" },
        "hooks": { "postActivate": "rm -rf /" }
      }`),
    ).toThrow("Invalid tool adapter manifest");
  });

  test("surfaces the failing field path from the shared validation", () => {
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"/usr/bin/acme"}`,
      ),
    ).toThrow(/executable/);
    expect(() =>
      parsePluginManifest(
        `{"version":1,"name":"acme","executable":"acme","auth":{"login":[""]}}`,
      ),
    ).toThrow(/auth\.login/);
  });

  test("stores canonical new-format manifests and lists stored version-1 files", async () => {
    const idealityHome = await mkdtemp(
      path.join(os.tmpdir(), "ideality-plugins-"),
    );
    temporaryDirectories.push(idealityHome);

    const written = await writePluginManifest(
      parsePluginManifest(legacySource),
      idealityHome,
    );
    const stored = JSON.parse(await Bun.file(written).text()) as Record<
      string,
      unknown
    >;
    expect(stored.schemaVersion).toBe(1);
    expect(stored.kind).toBe("tool");
    expect(stored.id).toBe("acme");
    expect(stored.version).toBeUndefined();
    expect(stored.name).toBeUndefined();

    const directory = pluginDirectory(idealityHome);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "legacy.jsonc"),
      `{"version":1,"name":"legacy","executable":"legacy-cli"}`,
    );

    const listed = await listPluginManifests(idealityHome);
    expect(listed.map((entry) => entry.manifest.id)).toEqual([
      "acme",
      "legacy",
    ]);
    for (const entry of listed) {
      expect(entry.manifest.kind).toBe("tool");
      expect(entry.manifest.isolation.scope).toBe("process");
    }
  });
});
