import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  BUILTIN_TOOL_MANIFESTS,
  BUILTIN_TOOL_PACKS,
} from "../src/adapters/builtins.js";

const repoRoot = path.resolve(import.meta.dir, "..");
const skillsRoot = path.join(repoRoot, "skills");
const operatingSkills = [
  "ideality-custom-tools",
  "ideality-getting-started",
  "ideality-identities",
  "ideality-network-vm",
  "ideality-project-setup",
  "ideality-secrets",
  "ideality-tools-and-packs",
  "ideality-troubleshooting",
];
const expectedSkills = [
  "ideality-catalog-adapter",
  "ideality-contributor-workflow",
  ...operatingSkills,
].sort();

function frontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  return Object.fromEntries(
    match[1]!.split("\n").map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    }),
  );
}

function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map(
    (match) => match[1]!,
  );
}

describe("agent skills package", () => {
  test("ships the approved Vercel-compatible skill roster", async () => {
    const directories = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(expectedSkills);

    for (const directory of directories) {
      expect(directory).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(await readdir(path.join(skillsRoot, directory))).toEqual([
        "SKILL.md",
      ]);
      const markdown = await readFile(
        path.join(skillsRoot, directory, "SKILL.md"),
        "utf8",
      );
      const metadata = frontmatter(markdown);
      expect(Object.keys(metadata).sort()).toEqual(["description", "name"]);
      expect(metadata.name).toBe(directory);
      expect(metadata.description?.length).toBeGreaterThan(20);
      expect(markdown.split("\n").length - 1).toBeLessThanOrEqual(200);
    }
  });

  test("keeps operating skills self-contained and examples executable", async () => {
    for (const directory of operatingSkills) {
      const markdown = await readFile(
        path.join(skillsRoot, directory, "SKILL.md"),
        "utf8",
      );
      expect(markdown).not.toMatch(
        /`(?:docs|schemas|catalog|privileged-adapters|src|test)\//,
      );
      expect(markdown).not.toMatch(/\bbun run (?:\.\/)?src\//);
      for (const block of bashBlocks(markdown)) {
        expect(block).not.toMatch(/\b[a-z][a-z-]*\|[a-z][a-z-]*\b/i);
        expect(block).not.toMatch(/<[^>\n]+>/);
      }
    }

    const gettingStarted = await readFile(
      path.join(skillsRoot, "ideality-getting-started", "SKILL.md"),
      "utf8",
    );
    expect(gettingStarted).toContain(
      "git clone https://github.com/0xJord4n/ideality.git",
    );
    expect(gettingStarted).toContain("cd ideality");
  });

  test("does not document the obsolete manual tag release path", async () => {
    const contributor = await readFile(
      path.join(skillsRoot, "ideality-contributor-workflow", "SKILL.md"),
      "utf8",
    );
    expect(contributor).not.toMatch(
      /version:(?:patch|minor|major)|git tag|follow-tags/,
    );
    expect(contributor).toContain("Release Please");
  });

  test("documents a portable released-binary policy CI gate", async () => {
    const policy = await readFile(
      path.join(repoRoot, "docs/policy.md"),
      "utf8",
    );
    expect(policy).toContain(
      "https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh",
    );
    expect(policy).toContain("~/.local/bin/ideality policy check --json");
    expect(policy).not.toMatch(
      /\bbun run (?:\.\/)?src\/index\.ts policy check/,
    );
  });

  test("locks catalog claims and step completion criteria to current behavior", async () => {
    const tools = await readFile(
      path.join(skillsRoot, "ideality-tools-and-packs", "SKILL.md"),
      "utf8",
    );
    expect(tools).toContain(
      `${Object.keys(BUILTIN_TOOL_MANIFESTS).length} adapters across ${
        Object.keys(BUILTIN_TOOL_PACKS).length
      } selectable packs`,
    );

    const catalog = await readFile(
      path.join(skillsRoot, "ideality-catalog-adapter", "SKILL.md"),
      "utf8",
    );
    expect(catalog.match(/\*\*Complete when:\*\*/g)).toHaveLength(5);
  });

  test("documents Vercel Skills installation with npx, bunx, and ideality", async () => {
    const index = await readFile(path.join(skillsRoot, "README.md"), "utf8");
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    for (const documentation of [index, readme]) {
      expect(documentation).toContain("npx skills add 0xJord4n/ideality");
      expect(documentation).toContain("bunx skills add 0xJord4n/ideality");
      expect(documentation).toContain("ideality skills install");
    }
    expect(index).not.toContain("sourced verbatim");
  });

  test("sources TUI skill guidance from the user documentation", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    const customTools = await readFile(
      path.join(skillsRoot, "ideality-custom-tools", "SKILL.md"),
      "utf8",
    );
    const secrets = await readFile(
      path.join(skillsRoot, "ideality-secrets", "SKILL.md"),
      "utf8",
    );
    expect(readme).toMatch(
      /(?:plugin manifests \(`g`\)|`g` for plugin manifest)/,
    );
    expect(readme).toMatch(
      /(?:secret\s+references \(`k`\)|`k` for secret-backend)/,
    );
    expect(customTools).toContain("press `g`");
    expect(secrets).toContain("press `k`");
  });
});
