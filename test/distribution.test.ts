import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

describe("release distribution", () => {
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
});
