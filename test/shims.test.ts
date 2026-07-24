import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { findExecutable } from "../src/core/runtime.js";
import type { IdealityConfig } from "../src/domain/config.js";
import {
  installShims,
  renderShim,
} from "../src/integrations/shims.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function configWithTools(...tools: string[]): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "default",
    identities: {
      default: {
        label: "Default",
        roots: ["~/code"],
        tools: Object.fromEntries(tools.map((tool) => [tool, {}])),
      },
    },
    tools: Object.fromEntries(
      tools.map((tool) => [
        tool,
        { executable: tool, isolation: "process" as const },
      ]),
    ),
  };
}

describe("managed executable shims", () => {
  test("dispatches the original arguments through ideality", () => {
    expect(renderShim("sample")).toBe(
      "#!/bin/sh\nexec ideality run 'sample' -- \"$@\"\n",
    );
  });

  test("skips the shim directory when resolving the real executable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ideality-shims-"));
    temporaryDirectories.push(root);
    const shimDirectory = path.join(root, "shims");
    const realDirectory = path.join(root, "real");
    await mkdir(shimDirectory, { recursive: true });
    await mkdir(realDirectory, { recursive: true });
    for (const directory of [shimDirectory, realDirectory]) {
      const executable = path.join(directory, "sample");
      await writeFile(executable, "#!/bin/sh\n");
      await chmod(executable, 0o755);
    }

    expect(
      findExecutable("sample", {
        pathValue: `${shimDirectory}:${realDirectory}`,
        excludedDirectories: [shimDirectory],
      }),
    ).toBe(path.join(realDirectory, "sample"));
  });

  test("synchronizes owned shims without deleting unrelated files", async () => {
    const idealityHome = await mkdtemp(
      path.join(os.tmpdir(), "ideality-shims-"),
    );
    temporaryDirectories.push(idealityHome);
    const directory = path.join(idealityHome, "bin");
    await installShims(configWithTools("sample", "other"), idealityHome);
    await writeFile(path.join(directory, "unrelated"), "keep");

    await installShims(configWithTools("sample"), idealityHome);

    expect(await Bun.file(path.join(directory, "sample")).exists()).toBe(true);
    expect((await stat(path.join(directory, "sample"))).mode & 0o777).toBe(
      0o755,
    );
    expect(await Bun.file(path.join(directory, "other")).exists()).toBe(false);
    expect(await Bun.file(path.join(directory, "unrelated")).text()).toBe(
      "keep",
    );
  });
});
