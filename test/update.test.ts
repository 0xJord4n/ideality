import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertDefaultSelfUpdateTarget,
  runUpdate,
} from "../src/core/update.js";

const tmpRoots: string[] = [];
const hostTarget = `${process.platform === "darwin" ? "darwin" : "linux"}-${
  process.arch === "arm64" ? "arm64" : "x64"
}`;

afterEach(async () => {
  await Promise.all(
    tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

async function writeBinary(
  file: string,
  version: string,
  behavior: "normal" | "migration-fails" = "normal",
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const migrateBody =
    behavior === "migration-fails"
      ? 'if [ "${3:-}" = "--dry-run" ]; then echo "would migrate"; exit 0; fi\necho "migration failed" >&2\nexit 42'
      : 'echo "registry is current"\nexit 0';
  await writeFile(
    file,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "ideality ${version}"; exit 0; fi
if [ "$1" = "config" ] && [ "$2" = "migrate" ]; then
${migrateBody}
fi
echo "unexpected args: $*" >&2
exit 2
`,
    { mode: 0o755 },
  );
  await chmod(file, 0o755);
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function makeRelease(
  version: string,
  behavior: "normal" | "migration-fails" = "normal",
): Promise<{ dir: string; archive: string; sha: string }> {
  const dir = await tempDir("ideality-release-");
  const payload = path.join(dir, "payload");
  await mkdir(payload);
  await writeBinary(path.join(payload, "ideality"), version, behavior);
  const archive = `ideality-${hostTarget}.tar.gz`;
  const tar = Bun.spawnSync({
    cmd: ["tar", "-C", payload, "-czf", path.join(dir, archive), "ideality"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  const sha = await sha256(path.join(dir, archive));
  await writeFile(
    path.join(dir, "release-metadata.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        package: "ideality",
        version,
        artifacts: {
          [hostTarget]: { filename: archive, sha256: sha },
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
  return { dir, archive, sha };
}

async function makeInstall(version = "0.1.0"): Promise<{
  dir: string;
  executable: string;
  configPath: string;
}> {
  const dir = await tempDir("ideality-install-");
  const executable = path.join(dir, "bin", "ideality");
  await writeBinary(executable, version);
  const configPath = path.join(dir, "home", ".ideality", "config.jsonc");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({
      version: 1,
      defaultIdentity: "sample",
      identities: { sample: { label: "Sample", roots: [dir], tools: {} } },
      tools: {},
    })}\n`,
  );
  return { dir, executable, configPath };
}

async function makeFakeCosign(): Promise<{ bin: string; log: string }> {
  const dir = await tempDir("ideality-cosign-");
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

async function updateOptions(): Promise<{
  cosignPath: string;
}> {
  const cosign = await makeFakeCosign();
  return { cosignPath: cosign.bin };
}

describe("runUpdate", () => {
  test("verifies signed release metadata before parsing checksums", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const cosign = await makeFakeCosign();
    await runUpdate({
      baseUrl: `file://${release.dir}`,
      checkOnly: true,
      cosignPath: cosign.bin,
      currentVersion: "0.1.0",
      executablePath: install.executable,
      env: { IDEALITY_CONFIG: install.configPath },
    });
    expect((await readFile(cosign.log, "utf8")).trim().split("\n")).toEqual([
      "verify-blob",
      "--bundle",
      path.join(release.dir, "release-metadata.json.sigstore.json"),
      "--certificate-identity-regexp",
      "https://github.com/0xJord4n/ideality/\\.github/workflows/release\\.yml.*",
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      path.join(release.dir, "release-metadata.json"),
    ]);
  });

  test("fails closed when metadata signature verification is unavailable", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    await rm(path.join(release.dir, "release-metadata.json.sigstore.json"));
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        checkOnly: true,
        cosignPath: path.join(release.dir, "missing-cosign"),
        currentVersion: "0.1.0",
        executablePath: install.executable,
      }),
    ).rejects.toThrow("Could not verify release metadata signature");
  });

  test("check reports an available version without touching the executable", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const before = await readFile(install.executable, "utf8");
    const result = await runUpdate({
      baseUrl: `file://${release.dir}`,
      checkOnly: true,
      ...(await updateOptions()),
      currentVersion: "0.1.0",
      executablePath: install.executable,
      env: { IDEALITY_CONFIG: install.configPath },
    });
    expect(result.status).toBe("update-available");
    expect(result.targetVersion).toBe("0.2.0");
    expect(await readFile(install.executable, "utf8")).toBe(before);
  });

  test("dry-run verifies the artifact and migration readiness without replacing", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const before = await readFile(install.executable, "utf8");
    const result = await runUpdate({
      baseUrl: `file://${release.dir}`,
      ...(await updateOptions()),
      currentVersion: "0.1.0",
      dryRun: true,
      executablePath: install.executable,
      env: { IDEALITY_CONFIG: install.configPath },
    });
    expect(result.status).toBe("dry-run");
    expect(result.artifactVerified).toBe(true);
    expect(result.migrationReadinessChecked).toBe(true);
    expect(await readFile(install.executable, "utf8")).toBe(before);
  });

  test("refuses legacy Cellar executables and directs migration to the signed installer", async () => {
    const release = await makeRelease("0.2.0");
    await rm(path.join(release.dir, "release-metadata.json.sigstore.json"));
    const dir = await tempDir("ideality-managed-");
    const cellar = path.join(
      dir,
      "prefix",
      "Cellar",
      "ideality",
      "0.1.0",
      "bin",
    );
    const executable = path.join(cellar, "ideality");
    await writeBinary(executable, "0.1.0");
    const update = runUpdate({
      baseUrl: `file://${release.dir}`,
      ...(await updateOptions()),
      currentVersion: "0.1.0",
      checkOnly: true,
      executablePath: executable,
    });
    await expect(update).rejects.toThrow(
      "first remove the legacy package-manager installation",
    );
    await expect(update).rejects.toThrow(
      "https://raw.githubusercontent.com/0xJord4n/ideality/main/scripts/install.sh",
    );
  });

  test("refuses Bun, npm, pnpm, and yarn managed installs with native upgrade commands", async () => {
    const release = await makeRelease("0.2.0");
    await rm(path.join(release.dir, "release-metadata.json.sigstore.json"));
    const cases = [
      {
        pathParts: [
          ".bun",
          "install",
          "global",
          "node_modules",
          "@0xjord4n",
          "ideality",
        ],
        command: "bun update -g @0xjord4n/ideality",
      },
      {
        pathParts: ["lib", "node_modules", "@0xjord4n", "ideality"],
        command: "npm update -g @0xjord4n/ideality",
      },
      {
        pathParts: [
          "pnpm",
          "global",
          "5",
          "node_modules",
          "@0xjord4n",
          "ideality",
        ],
        command: "pnpm update -g @0xjord4n/ideality",
      },
      {
        pathParts: [
          ".config",
          "yarn",
          "global",
          "node_modules",
          "@0xjord4n",
          "ideality",
        ],
        command: "yarn global upgrade @0xjord4n/ideality",
      },
    ];
    for (const entry of cases) {
      const dir = await tempDir("ideality-managed-");
      const executable = path.join(dir, ...entry.pathParts, "bin", "ideality");
      await writeBinary(executable, "0.1.0");
      await expect(
        runUpdate({
          baseUrl: `file://${release.dir}`,
          checkOnly: true,
          ...(await updateOptions()),
          currentVersion: "0.1.0",
          executablePath: executable,
        }),
      ).rejects.toThrow(entry.command);
    }
  });

  test("rejects checksum mismatches before replacing the current binary", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const metadata = JSON.parse(
      await readFile(path.join(release.dir, "release-metadata.json"), "utf8"),
    );
    metadata.artifacts[hostTarget].sha256 = "0".repeat(64);
    await writeFile(
      path.join(release.dir, "release-metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
    const before = await readFile(install.executable, "utf8");
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.1.0",
        executablePath: install.executable,
        env: { IDEALITY_CONFIG: install.configPath },
      }),
    ).rejects.toThrow("checksum");
    expect(await readFile(install.executable, "utf8")).toBe(before);
  });

  test("rolls back binary and config when required migrations fail after replacement", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0", "migration-fails");
    const beforeBinary = await readFile(install.executable, "utf8");
    const beforeConfig = await readFile(install.configPath, "utf8");
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.1.0",
        executablePath: install.executable,
        env: { IDEALITY_CONFIG: install.configPath },
      }),
    ).rejects.toThrow("migration failed");
    expect(await readFile(install.executable, "utf8")).toBe(beforeBinary);
    expect(await readFile(install.configPath, "utf8")).toBe(beforeConfig);
  });

  test("refuses downgrades unless explicitly overridden", async () => {
    const install = await makeInstall("0.2.0");
    const release = await makeRelease("0.1.0");
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.2.0",
        executablePath: install.executable,
      }),
    ).rejects.toThrow("Refusing to downgrade");
    const result = await runUpdate({
      allowDowngrade: true,
      baseUrl: `file://${release.dir}`,
      ...(await updateOptions()),
      currentVersion: "0.2.0",
      dryRun: true,
      executablePath: install.executable,
    });
    expect(result.status).toBe("dry-run");
  });

  test("requires explicit target versions to match release metadata", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const result = await runUpdate({
      baseUrl: `file://${release.dir}`,
      ...(await updateOptions()),
      currentVersion: "0.1.0",
      dryRun: true,
      executablePath: install.executable,
      targetVersion: "0.2.0",
    });
    expect(result.targetVersion).toBe("0.2.0");
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.1.0",
        executablePath: install.executable,
        targetVersion: "0.3.0",
      }),
    ).rejects.toThrow("does not match requested version");
  });

  test("rejects malformed release and requested versions", async () => {
    const install = await makeInstall();
    const release = await makeRelease("not-a-version");
    await expect(
      runUpdate({
        baseUrl: `file://${release.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.1.0",
        executablePath: install.executable,
      }),
    ).rejects.toThrow("Invalid release version");

    const validRelease = await makeRelease("0.2.0");
    await expect(
      runUpdate({
        baseUrl: `file://${validRelease.dir}`,
        ...(await updateOptions()),
        currentVersion: "0.1.0",
        executablePath: install.executable,
        targetVersion: "later",
      }),
    ).rejects.toThrow("Invalid requested version");
  });

  test("refuses source and repository dist entrypoints unless an explicit test executable is provided", () => {
    expect(() =>
      assertDefaultSelfUpdateTarget(
        path.join(import.meta.dir, "..", "src", "index.ts"),
      ),
    ).toThrow("Refusing to self-update a source checkout");
    expect(() =>
      assertDefaultSelfUpdateTarget(
        path.join(import.meta.dir, "..", "dist", "ideality"),
      ),
    ).toThrow("Refusing to self-update a source checkout");
  });

  test("replaces a direct writable binary after staging, checksum, readiness, migration, and smoke checks", async () => {
    const install = await makeInstall();
    const release = await makeRelease("0.2.0");
    const result = await runUpdate({
      baseUrl: `file://${release.dir}`,
      ...(await updateOptions()),
      currentVersion: "0.1.0",
      executablePath: install.executable,
      env: { IDEALITY_CONFIG: install.configPath },
    });
    expect(result.status).toBe("updated");
    expect(result.artifactVerified).toBe(true);
    expect(result.migrationReadinessChecked).toBe(true);
    const smoke = Bun.spawnSync({
      cmd: [install.executable, "--version"],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(smoke.exitCode).toBe(0);
    expect(smoke.stdout.toString()).toContain("0.2.0");
    expect(
      existsSync(path.join(path.dirname(install.configPath), "history")),
    ).toBe(true);
  });
});
