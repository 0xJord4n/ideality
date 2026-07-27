import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import pkg from "../package.json";

const repoRoot = path.resolve(import.meta.dir, "..");

describe("release distribution", () => {
  test("publishes a portable scoped CLI package", async () => {
    expect(pkg.name).toBe("@0xjordan/ideality");
    expect(pkg.bin).toEqual({ ideality: "bin/ideality" });
    expect(pkg.files).toEqual([
      "bin/ideality",
      "scripts/install-package.sh",
      "scripts/install.sh",
    ]);
    expect(pkg.os).toEqual(["darwin", "linux"]);
    expect(pkg.cpu).toEqual(["arm64", "x64"]);
    expect(pkg.scripts.postinstall).toBe("bash scripts/install-package.sh");
    expect(pkg.publishConfig).toEqual({
      access: "public",
      provenance: true,
    });
    expect("dependencies" in pkg).toBe(false);

    const launcher = await readFile(
      path.join(repoRoot, "bin", "ideality"),
      "utf8",
    );
    expect(launcher).toStartWith("#!/bin/sh\n");
    expect(launcher).toContain("command -v node || command -v bun");
    expect(launcher).toContain('"install-package.sh"');
    expect(launcher).toContain("spawn(binary, process.argv.slice(2)");
  });

  test("does not build or publish Homebrew packages", async () => {
    const workflow = await readFile(
      path.join(repoRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const rehearsal = await readFile(
      path.join(repoRoot, "scripts", "release-rehearsal.sh"),
      "utf8",
    );

    expect(workflow).not.toMatch(/homebrew|tap repository/i);
    expect(rehearsal).not.toMatch(/homebrew-formula\.ts|publish-homebrew\.sh/i);
    expect(
      existsSync(path.join(repoRoot, "scripts", "homebrew-formula.ts")),
    ).toBe(false);
    expect(
      existsSync(path.join(repoRoot, "scripts", "publish-homebrew.sh")),
    ).toBe(false);
  });

  test("documents package-manager installs and releases", async () => {
    const readRepoFile = (relativePath: string) =>
      readFile(path.join(repoRoot, relativePath), "utf8");
    const [readme, releaseDocs, gettingStarted, contributorWorkflow] =
      await Promise.all([
        readRepoFile("README.md"),
        readRepoFile("docs/releasing.md"),
        readRepoFile("skills/ideality-getting-started/SKILL.md"),
        readRepoFile("skills/ideality-contributor-workflow/SKILL.md"),
      ]);
    const installCommands = [
      "npm install --global @0xjordan/ideality",
      "pnpm add --global @0xjordan/ideality",
      "bun add --global @0xjordan/ideality",
      "yarn global add @0xjordan/ideality",
      "yarn dlx @0xjordan/ideality",
    ];

    for (const command of installCommands) {
      expect(readme).toContain(command);
      expect(gettingStarted).toContain(command);
    }
    expect(releaseDocs).toContain("npm trusted publishing");
    expect(releaseDocs).toContain("@0xjordan/ideality");
    expect(releaseDocs).toContain(
      "NPM_CONFIG_PROVENANCE=false npm publish --access public",
    );
    expect(contributorWorkflow).toContain("npm publish --access public");
    expect(contributorWorkflow).toContain("npm pack --dry-run");
    expect(readme).toContain("yarn dlx @0xjordan/ideality@latest");
    expect(gettingStarted).toContain("yarn dlx @0xjordan/ideality@latest");
  });
});
