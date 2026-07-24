import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  applyProjectConfig,
  createProjectConfig,
  findProjectRoot,
  loadProjectConfig,
  saveProjectConfig,
} from "../src/core/project-config.js";
import type { IdealityConfig } from "../src/domain/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function config(): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    secretBackend: { type: "bitwarden" },
    networks: {
      private: {
        driver: "wireguard",
        config: { from: "secret", key: "bw://wireguard/private" },
        killSwitch: "required",
      },
      unused: {
        driver: "mullvad",
      },
    },
    vms: {
      workspace: {
        driver: "lima",
        network: "private",
        mounts: [
          {
            source: "{{root}}",
            target: "/workspace",
            writable: true,
          },
        ],
      },
      unused: {
        driver: "firecracker",
      },
    },
    identities: {
      sample: {
        label: "Sample",
        roots: ["/workspace"],
        git: { name: "Sample User", email: "sample@example.com" },
        execution: { target: "vm", vm: "workspace" },
        tools: {
          gh: {
            env: { GH_CONFIG_DIR: "/profiles/sample/gh" },
          },
          custom: {
            args: ["--team", "sample"],
            env: { CUSTOM_TOKEN: { from: "secret", key: "bw://custom" } },
          },
        },
      },
      other: {
        label: "Other",
        roots: ["/other"],
        tools: {},
      },
    },
    tools: {
      gh: { executable: "gh", isolation: "process" },
      custom: { executable: "custom-cli", isolation: "process" },
    },
  };
}

describe("project configuration", () => {
  test("creates a full-fidelity bundle for selected tools", () => {
    const project = createProjectConfig(config(), "sample", ["custom"]);

    expect(project.defaultIdentity).toBe("sample");
    expect(project.secretBackend).toEqual({ type: "bitwarden" });
    expect(project.identities.sample?.roots).toEqual(["."]);
    expect(project.identities.sample?.git).toEqual({
      name: "Sample User",
      email: "sample@example.com",
    });
    expect(project.identities.sample?.execution).toEqual({
      target: "vm",
      vm: "workspace",
    });
    expect(project.identities.sample?.tools.custom).toEqual({
      enabled: true,
      args: ["--team", "sample"],
      env: { CUSTOM_TOKEN: { from: "secret", key: "bw://custom" } },
    });
    expect(project.identities.sample?.tools.gh).toBeUndefined();
    expect(project.tools).toEqual({
      custom: { executable: "custom-cli", isolation: "process" },
    });
    expect(project.networks).toEqual({
      private: config().networks!.private!,
    });
    expect(project.vms).toEqual({
      workspace: config().vms!.workspace!,
    });
  });

  test("applies a bundle without deleting unrelated local configuration", () => {
    const local = config();
    local.identities.sample!.tools.custom!.enabled = false;
    const project = createProjectConfig(config(), "sample", ["custom"]);
    const applied = applyProjectConfig(
      local,
      project,
      "/workspace/application",
      "sample",
    );

    expect(applied.identities.other).toEqual(local.identities.other);
    expect(applied.identities.sample?.roots).toEqual([
      "/workspace",
      "/workspace/application",
    ]);
    expect(applied.identities.sample?.tools.gh).toEqual(
      local.identities.sample?.tools.gh,
    );
    expect(applied.identities.sample?.tools.custom?.enabled).toBe(true);
    expect(applied.identities.sample?.execution).toEqual({
      target: "vm",
      vm: "workspace",
    });
    expect(applied.networks?.private).toEqual(project.networks?.private);
    expect(applied.vms?.workspace).toEqual(project.vms?.workspace);
  });

  test("imports the handed-over identity when it is not local", () => {
    const project = createProjectConfig(config(), "sample", ["gh"]);
    const local = config();
    delete local.identities.sample;
    local.defaultIdentity = "other";

    const applied = applyProjectConfig(
      local,
      project,
      "/workspace/application",
      "project-team",
    );

    expect(applied.identities["project-team"]).toMatchObject({
      label: "Sample",
      roots: ["/workspace/application"],
      tools: { gh: { enabled: true } },
    });
    expect(applied.defaultIdentity).toBe("other");
  });

  test("requirements-only bundles preserve local profile settings", () => {
    const project = createProjectConfig(config(), "sample", ["custom"], {
      requirementsOnly: true,
    });
    const local = config();
    local.secretBackend = { type: "file" };
    local.identities.sample!.tools.custom = {
      enabled: false,
      env: { CUSTOM_HOME: "/local/custom" },
    };

    const applied = applyProjectConfig(
      local,
      project,
      "/workspace/application",
      "sample",
    );

    expect(applied.identities.sample?.tools.custom).toEqual({
      enabled: true,
      env: { CUSTOM_HOME: "/local/custom" },
    });
    expect(project.networks).toBeUndefined();
    expect(project.vms).toBeUndefined();
    expect(project.identities.sample?.execution).toBeUndefined();
    expect(applied.secretBackend).toEqual(local.secretBackend);
  });

  test("full handovers apply their declared secret backend", () => {
    const project = createProjectConfig(config(), "sample", ["gh"]);
    const local = config();
    local.secretBackend = { type: "file" };

    const applied = applyProjectConfig(
      local,
      project,
      "/workspace/application",
      "sample",
    );

    expect(applied.secretBackend).toEqual({ type: "bitwarden" });
  });

  test("discovers a Git project and round-trips its handover file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ideality-project-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, ".git"));
    await mkdir(path.join(root, "packages", "app"), { recursive: true });

    expect(await findProjectRoot(path.join(root, "packages", "app"))).toBe(
      root,
    );
    const project = createProjectConfig(config(), "sample", ["gh"]);
    const saved = await saveProjectConfig(root, project);

    expect(saved).toBe(path.join(root, ".ideality", "project.jsonc"));
    expect(await loadProjectConfig(root)).toEqual(project);
  });
});
