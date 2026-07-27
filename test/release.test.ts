import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pkg from "../package.json";

const repoRoot = path.resolve(import.meta.dir, "..");
const installScript = path.join(repoRoot, "scripts", "install.sh");
const rehearsalScript = path.join(repoRoot, "scripts", "release-rehearsal.sh");
const releaseWorkflow = path.join(
  repoRoot,
  ".github",
  "workflows",
  "release.yml",
);
const releasePleaseWorkflow = path.join(
  repoRoot,
  ".github",
  "workflows",
  "release-please.yml",
);
const securityWorkflow = path.join(
  repoRoot,
  ".github",
  "workflows",
  "security.yml",
);

const hostTarget = `${process.platform === "darwin" ? "darwin" : "linux"}-${
  process.arch === "arm64" ? "arm64" : "x64"
}`;

const STUB_VERSION = "9.9.9-rehearsal";
const PACKAGE_VERSION = pkg.version;

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
async function makeStubRelease(
  binaryVersion: string = STUB_VERSION,
  options: { delegateToSource?: boolean; metadataVersion?: string } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ideality-release-"));
  await writeFile(
    path.join(dir, "ideality"),
    options.delegateToSource
      ? `#!/bin/sh\nexec bun run "${path.join(repoRoot, "src", "index.ts")}" "$@"\n`
      : `#!/bin/sh\necho "ideality ${binaryVersion}"\n`,
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
  const checksum = (await Bun.file(path.join(dir, "SHA256SUMS.txt")).text())
    .trim()
    .split(/\s+/)[0]!;
  await writeFile(
    path.join(dir, "release-metadata.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        package: "ideality",
        version: options.metadataVersion ?? PACKAGE_VERSION,
        artifacts: {
          [hostTarget]: {
            filename: archive,
            sha256: checksum,
            size: (await stat(path.join(dir, archive))).size,
          },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(dir, "release-metadata.json.sigstore.json"),
    JSON.stringify({ fakeBundle: true }),
  );
  return dir;
}

async function makeFakeCosign(): Promise<{ bin: string; log: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ideality-cosign-"));
  const log = path.join(dir, "cosign.args");
  const bin = path.join(dir, "cosign");
  await writeFile(
    bin,
    `#!/bin/sh
printf '%s\\n' "$@" > "${log}"
exit 0
`,
    { mode: 0o755 },
  );
  await chmod(bin, 0o755);
  return { bin, log };
}

// A repository slug that cannot resolve: proves the installer never falls
// back to constructing GitHub URLs when IDEALITY_BASE_URL is set.
const UNREACHABLE_REPO = "example-invalid/ideality-rehearsal-does-not-exist";

describe("scripts/install.sh", () => {
  test("installs from a local artifact directory when IDEALITY_BASE_URL is set (offline)", async () => {
    const artifacts = await makeStubRelease();
    const cosign = await makeFakeCosign();
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const installDir = path.join(home, "bin");
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: cosign.bin,
      IDEALITY_INSTALL_DIR: installDir,
      IDEALITY_REPO: UNREACHABLE_REPO,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Verifying release metadata signature");
    expect(result.stdout).toContain("Verifying checksum");
    expect(result.stdout).toContain(STUB_VERSION);
    const args = (await readFile(cosign.log, "utf8")).trim().split("\n");
    expect(args[0]).toBe("verify-blob");
    expect(args[1]).toBe("--bundle");
    expect(path.basename(args[2]!)).toBe("release-metadata.json.sigstore.json");
    expect(args.slice(3, 7)).toEqual([
      "--certificate-identity-regexp",
      "https://github.com/0xJord4n/ideality/\\.github/workflows/release\\.yml.*",
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
    ]);
    expect(path.basename(args[7]!)).toBe("release-metadata.json");
    const installed = await stat(path.join(installDir, "ideality"));
    expect(installed.isFile()).toBe(true);
  }, 30_000);

  test("rejects an archive whose checksum does not match the manifest", async () => {
    const artifacts = await makeStubRelease();
    const cosign = await makeFakeCosign();
    await writeFile(
      path.join(artifacts, "release-metadata.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          package: "ideality",
          version: PACKAGE_VERSION,
          artifacts: {
            [hostTarget]: {
              filename: `ideality-${hostTarget}.tar.gz`,
              sha256: "0".repeat(64),
            },
          },
        },
        null,
        2,
      ),
    );
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const installDir = path.join(home, "bin");
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: cosign.bin,
      IDEALITY_INSTALL_DIR: installDir,
      IDEALITY_REPO: UNREACHABLE_REPO,
    });
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(path.join(installDir, "ideality"))).toBe(false);
  });

  test("downloads and installs a pinned cosign verifier when requested", async () => {
    const artifacts = await makeStubRelease();
    const fakeCosign = await makeFakeCosign();
    const verifierDir = await mkdtemp(
      path.join(os.tmpdir(), "ideality-cosign-release-"),
    );
    const cosignAsset = `cosign-${
      process.platform === "darwin" ? "darwin" : "linux"
    }-${process.arch === "arm64" ? "arm64" : "amd64"}`;
    const verifierBytes = await readFile(fakeCosign.bin);
    const verifierPath = path.join(verifierDir, cosignAsset);
    await writeFile(verifierPath, verifierBytes, { mode: 0o755 });
    const verifierSha = new Bun.CryptoHasher("sha256")
      .update(verifierBytes)
      .digest("hex");
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const installDir = path.join(home, "bin");

    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: "auto",
      IDEALITY_COSIGN_BASE_URL: `file://${verifierDir}`,
      IDEALITY_COSIGN_SHA256: verifierSha,
      IDEALITY_INSTALL_DIR: installDir,
      IDEALITY_REPO: UNREACHABLE_REPO,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Downloading pinned cosign");
    expect(result.stdout).toContain(
      `Installing pinned verifier to ${installDir}/cosign`,
    );
    expect((await stat(path.join(installDir, "cosign"))).isFile()).toBe(true);
    expect((await stat(path.join(installDir, "ideality"))).isFile()).toBe(true);
  });

  test("npm package exposes a lazy verified ideality executable", async () => {
    const artifacts = await makeStubRelease(PACKAGE_VERSION);
    const cosign = await makeFakeCosign();
    const packDir = await mkdtemp(path.join(os.tmpdir(), "ideality-pack-"));
    const prefix = await mkdtemp(path.join(os.tmpdir(), "ideality-prefix-"));
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const packed = run([
      "npm",
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDir,
    ]);
    expect(packed.exitCode).toBe(0);
    const [{ filename }] = JSON.parse(packed.stdout) as Array<{
      filename: string;
    }>;
    const installed = run(
      [
        "npm",
        "install",
        "--global",
        "--ignore-scripts",
        "--prefix",
        prefix,
        path.join(packDir, filename),
      ],
      { HOME: home },
    );
    expect(installed.exitCode).toBe(0);

    const packageRoot = path.join(
      prefix,
      "lib",
      "node_modules",
      "@0xjordan",
      "ideality",
    );
    const bootstrapEnv = {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: cosign.bin,
      IDEALITY_REPO: UNREACHABLE_REPO,
    };
    const directNodeCommand = run(
      ["node", path.join(packageRoot, "bin", "ideality"), "--version"],
      bootstrapEnv,
    );
    expect(directNodeCommand.exitCode).toBe(0);
    expect(directNodeCommand.stdout).toContain(`ideality ${PACKAGE_VERSION}`);

    const vendoredBinary = path.join(packageRoot, "vendor", "ideality");
    await chmod(vendoredBinary, 0o644);
    const command = run(
      [path.join(prefix, "bin", "ideality"), "--version"],
      bootstrapEnv,
    );
    expect(command.exitCode).toBe(0);
    expect(command.stdout).toContain(`ideality ${PACKAGE_VERSION}`);
    expect((await stat(vendoredBinary)).isFile()).toBe(true);
    expect((await stat(vendoredBinary)).mode & 0o111).not.toBe(0);
  }, 60_000);

  test("fails closed when cosign cannot verify release metadata", async () => {
    const artifacts = await makeStubRelease();
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: path.join(artifacts, "missing-cosign"),
      IDEALITY_INSTALL_DIR: path.join(home, "bin"),
      IDEALITY_REPO: UNREACHABLE_REPO,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("cosign is required");
  });

  test("rejects signed metadata for a different requested version", async () => {
    const artifacts = await makeStubRelease(PACKAGE_VERSION, {
      metadataVersion: "9.9.9",
    });
    const cosign = await makeFakeCosign();
    const home = await mkdtemp(path.join(os.tmpdir(), "ideality-home-"));
    const result = run(["bash", installScript], {
      HOME: home,
      IDEALITY_BASE_URL: `file://${artifacts}`,
      IDEALITY_COSIGN: cosign.bin,
      IDEALITY_INSTALL_DIR: path.join(home, "bin"),
      IDEALITY_REPO: UNREACHABLE_REPO,
      IDEALITY_VERSION: PACKAGE_VERSION,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `release metadata version 9.9.9 does not match requested version ${PACKAGE_VERSION}`,
    );
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

  test("fails when release metadata is not truthful about a checksum", async () => {
    const artifacts = await makeStubRelease();
    const metadata = JSON.parse(
      await Bun.file(path.join(artifacts, "release-metadata.json")).text(),
    );
    metadata.artifacts[hostTarget].sha256 = "0".repeat(64);
    await writeFile(
      path.join(artifacts, "release-metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    const result = run(["bash", rehearsalScript, "--release-dir", artifacts]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("metadata verification failed");
  });

  test("uses a controlled fake verifier for offline installer rehearsal", async () => {
    const artifacts = await makeStubRelease(PACKAGE_VERSION, {
      delegateToSource: true,
    });
    const result = run(["bash", rehearsalScript, "--release-dir", artifacts]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Verified offline metadata signature command",
    );
  }, 120_000);
});

describe(".github/workflows/release.yml", () => {
  test("signs and uploads release metadata plus its Sigstore bundle", async () => {
    const workflow = await readFile(releaseWorkflow, "utf8");
    expect(workflow).toContain("dist/release/release-metadata.json");
    expect(workflow).toContain("cosign sign-blob --yes --bundle");
    expect(workflow).toContain(
      "dist/release/release-metadata.json.sigstore.json",
    );
  });

  test("is dispatched explicitly after release-please creates a tag", async () => {
    const release = await readFile(releaseWorkflow, "utf8");
    const releasePlease = await readFile(releasePleaseWorkflow, "utf8");
    expect(release).toContain("workflow_dispatch:");
    expect(releasePlease).toContain("actions: write");
    expect(releasePlease).toContain("id: release");
    expect(releasePlease).toContain("steps.release.outputs.release_created");
    expect(releasePlease).not.toContain("steps.release.outputs.prs_created");
    for (const workflow of [
      "ci.yml",
      "quality.yml",
      "catalog-check.yml",
      "security.yml",
    ]) {
      expect(releasePlease).toContain(
        `gh workflow run ${workflow} --repo "$GITHUB_REPOSITORY" --ref "$release_branch"`,
      );
    }
    expect(releasePlease).toContain(
      'gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "$RELEASE_TAG"',
    );
  });

  test("supports immutable-tag recovery and private repository releases", async () => {
    const workflow = await readFile(releaseWorkflow, "utf8");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("ref: ${{ inputs.release_tag || github.ref }}");
    expect(workflow).toContain(
      "RELEASE_TAG: ${{ inputs.release_tag || github.ref_name }}",
    );
    expect(workflow).toContain(
      "tag_name: ${{ inputs.release_tag || github.ref_name }}",
    );
    expect(workflow).toContain("if: ${{ !github.event.repository.private }}");
  });

  test("publishes the scoped CLI package through npm trusted publishing", async () => {
    const workflow = await readFile(releaseWorkflow, "utf8");
    expect(workflow).toContain("actions/setup-node@v6");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("registry-url: https://registry.npmjs.org");
    expect(workflow).toContain("npm pack --dry-run");
    expect(workflow).toContain('npm view "$package@$version" version');
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
  });
});

describe(".github/workflows/security.yml", () => {
  test("audits dependencies without requiring GitHub Advanced Security", async () => {
    const workflow = await readFile(securityWorkflow, "utf8");
    expect(workflow).toContain("bun run audit");
    expect(workflow).not.toContain("actions/dependency-review-action");
  });
});
