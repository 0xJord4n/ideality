import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runDoctor } from "../src/core/doctor.js";
import type { IdealityConfig } from "../src/domain/config.js";

describe("doctor", () => {
  test("recognizes an existing identity root directory", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-"));
    const root = path.join(home, "code", "personal");
    await mkdir(root, { recursive: true });
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "personal",
      identities: {
        personal: {
          label: "Personal",
          roots: ["~/code/personal"],
          tools: {},
        },
      },
      tools: {},
    };

    const checks = await runDoctor(config, home);

    expect(checks).toContainEqual({
      status: "pass",
      subject: root,
      message: "owned by personal",
    });
  });

  test("resolves secret files under a custom ideality home", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-doctor-home-"));
    const idealityHome = await mkdtemp(
      path.join(os.tmpdir(), "ideality-doctor-state-"),
    );
    const root = path.join(home, "code", "sample");
    const secret = path.join(idealityHome, "secrets", "sample", "token");
    await mkdir(root, { recursive: true });
    await mkdir(path.dirname(secret), { recursive: true });
    await Bun.write(secret, "value");
    await chmod(secret, 0o600);
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "sample",
      identities: {
        sample: {
          label: "Sample",
          roots: [root],
          tools: {
            demo: {
              env: {
                DEMO_TOKEN: {
                  from: "file",
                  path: "{{idealityHome}}/secrets/{{identity}}/token",
                },
              },
            },
          },
        },
      },
      tools: {
        demo: { executable: "missing-demo-executable" },
      },
    };

    const checks = await runDoctor(config, home, idealityHome);

    expect(checks).toContainEqual({
      status: "pass",
      subject: "sample/demo:DEMO_TOKEN",
      message: "secret file present (600)",
    });
  });
});
