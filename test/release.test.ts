import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const installScript = path.join(repoRoot, "scripts", "install.sh");
const rehearsalScript = path.join(repoRoot, "scripts", "release-rehearsal.sh");
const formulaScript = path.join(repoRoot, "scripts", "homebrew-formula.ts");

const hostTarget = `${process.platform === "darwin" ? "darwin" : "linux"}-${
  process.arch === "arm64" ? "arm64" : "x64"
}`;

const STUB_VERSION = "9.9.9-rehearsal";

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string[], env: Record<string, string> = {}): RunResult {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

/**
 * Build a release-shaped artifact directory (archive + SHA256SUMS.txt)
 * around a stub `ideality` executable, mirroring build-release.sh output.
 */
async function makeStubRelease(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ideality-release-"));
  await writeFile(
    path.join(dir, "ideality"),
    `#!/bin/sh\necho "ideality ${STUB_VERSION}"\n`,
    { mode: 0o755 },
  );
  const archive = `ideality-${hostTarget}.tar.gz`;
  let result = run([
    "tar",
    "-C",
    dir,
    "-czf",
    path.join(dir, archive),
    "ideality",
  ]);
  if (result.exitCode !== 0) throw new Error(`tar failed: ${result.stderr}`);
  result = run([
    "bash",
    "-c",
    `cd "${dir}" && if command -v sha256sum >/dev/null 2>&1; then sha256sum ideality-*.tar.gz > SHA256SUMS.txt; else shasum -a 256 ideality-*.tar.gz > SHA256SUMS.txt; fi`,
  ]);
  if (result.exitCode !== 0)
    throw new Error(`checksum failed: ${result.stderr}`);
  return dir;
}

// A repository slug that cannot resolve: proves the installer never falls
// back to constructing GitHub URLs when IDEALITY_BASE_URL is set.
const UNREACHABLE_REPO = "example-invalid/ideality-rehearsal-does-not-exist";

describe("scripts/install.sh", () => {
  test("installs from a local artifact directory when IDEALITY_BASE_URL is set (offline)", async () => {
    const artifacts = await makeStubRelease();
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const installDir = path.join(home, "bin");
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_INSTALL_DIR: installDir,
      IDEALITY_REPO: UNREACHABLE_REPO,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Verifying checksum");
    expect(result.stdout).toContain(STUB_VERSION);
    const installed = await stat(path.join(installDir, "ideality"));
    expect(installed.isFile()).toBe(true);
  });

  test("rejects an archive whose checksum does not match the manifest", async () => {
    const artifacts = await makeStubRelease();
    await writeFile(
      path.join(artifacts, "SHA256SUMS.txt"),
      `${"0".repeat(64)}  ideality-${hostTarget}.tar.gz\n`,
    );
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const installDir = path.join(home, "bin");
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_INSTALL_DIR: installDir,
      IDEALITY_REPO: UNREACHABLE_REPO,
    });
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(path.join(installDir, "ideality"))).toBe(false);
  });
});

describe("scripts/release-rehearsal.sh", () => {
  test("fails fast when the release directory does not exist", () => {
    const result = run([
      "bash",
      rehearsalScript,
      "--release-dir",
      "/nonexistent/ideality-release",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("does not exist");
  });

  test("fails when an archive does not match SHA256SUMS.txt", async () => {
    const artifacts = await makeStubRelease();
    await writeFile(
      path.join(artifacts, "SHA256SUMS.txt"),
      `${"0".repeat(64)}  ideality-${hostTarget}.tar.gz\n`,
    );
    const result = run(["bash", rehearsalScript, "--release-dir", artifacts]);
    expect(result.exitCode).not.toBe(0);
  });

  test("fails when an archive is present but missing from SHA256SUMS.txt", async () => {
    const artifacts = await makeStubRelease();
    const listed = path.join(artifacts, `ideality-${hostTarget}.tar.gz`);
    const unlisted = path.join(
      artifacts,
      `ideality-${hostTarget === "linux-x64" ? "darwin-x64" : "linux-x64"}.tar.gz`,
    );
    const copy = run(["cp", listed, unlisted]);
    expect(copy.exitCode).toBe(0);
    const result = run(["bash", rehearsalScript, "--release-dir", artifacts]);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("scripts/homebrew-formula.ts", () => {
  const sums: Record<string, string> = {
    "darwin-arm64": "1".repeat(64),
    "darwin-x64": "2".repeat(64),
    "linux-arm64": "3".repeat(64),
    "linux-x64": "4".repeat(64),
  };

  async function writeChecksums(
    entries: Record<string, string>,
  ): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ideality-sums-"));
    const file = path.join(dir, "SHA256SUMS.txt");
    const lines = Object.entries(entries).map(
      ([target, sum]) => `${sum}  ideality-${target}.tar.gz`,
    );
    await writeFile(file, `${lines.join("\n")}\n`);
    return file;
  }

  test("renders a formula with the version, per-target URLs, and checksums", async () => {
    const checksums = await writeChecksums(sums);
    const result = run([
      "bun",
      formulaScript,
      "--version",
      "v1.2.3",
      "--repository",
      "acme/ideality",
      "--checksums",
      checksums,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("class Ideality < Formula");
    expect(result.stdout).toContain('version "1.2.3"');
    for (const [target, sum] of Object.entries(sums)) {
      expect(result.stdout).toContain(
        `https://github.com/acme/ideality/releases/download/v1.2.3/ideality-${target}.tar.gz`,
      );
      expect(result.stdout).toContain(sum);
    }
  });

  test("fails when a target's checksum is missing from the manifest", async () => {
    const { "linux-x64": _omitted, ...partial } = sums;
    const checksums = await writeChecksums(partial);
    const result = run([
      "bun",
      formulaScript,
      "--version",
      "1.2.3",
      "--repository",
      "acme/ideality",
      "--checksums",
      checksums,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("linux-x64");
  });
});
