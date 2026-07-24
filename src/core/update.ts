import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { VERSION } from "../version.js";
import { createConfigSnapshot, getConfigPath } from "./config-store.js";

const METADATA_FILE = "release-metadata.json";
const METADATA_BUNDLE_FILE = `${METADATA_FILE}.sigstore.json`;
const DEFAULT_REPOSITORY = "0xJord4n/ideality";
const SIGSTORE_CERTIFICATE_IDENTITY_REGEXP =
  "https://github.com/0xJord4n/ideality/\\.github/workflows/release\\.yml.*";
const SIGSTORE_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const STRICT_SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const artifactSchema = z.object({
  filename: z.string().regex(/^ideality-[a-z]+-(x64|arm64)\.tar\.gz$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().positive().optional(),
});

const releaseMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  package: z.literal("ideality"),
  version: z.string().min(1),
  artifacts: z.record(artifactSchema),
});

export type ReleaseMetadata = z.infer<typeof releaseMetadataSchema>;

export interface UpdateOptions {
  allowDowngrade?: boolean;
  baseUrl?: string;
  checkOnly?: boolean;
  cosignPath?: string;
  currentVersion?: string;
  dryRun?: boolean;
  env?: Record<string, string | undefined>;
  executablePath?: string;
  fetcher?: typeof fetch;
  targetVersion?: string;
}

export type UpdateStatus =
  | "current"
  | "update-available"
  | "dry-run"
  | "updated";

export interface UpdateResult {
  status: UpdateStatus;
  currentVersion: string;
  targetVersion: string;
  target: string;
  installMode: "direct";
  artifactVerified: boolean;
  migrationReadinessChecked: boolean;
  configSnapshot?: string;
  executablePath: string;
}

interface ManagedInstall {
  manager: string;
  command: string;
}

export function getHostTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const osName =
    platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : null;
  const archName = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!osName || !archName) {
    throw new Error(
      `No prebuilt ideality artifact exists for ${platform}/${arch}. Supported targets are linux-x64, linux-arm64, darwin-x64, and darwin-arm64.`,
    );
  }
  return `${osName}-${archName}`;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string, label: string): number[] =>
    normalizeVersion(value, label)
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10));
  const a = parse(left, "left");
  const b = parse(right, "right");
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function normalizeVersion(value: string, label: string): string {
  if (!STRICT_SEMVER.test(value)) {
    throw new Error(
      `Invalid ${label} version '${value}'. Expected semver like 1.2.3.`,
    );
  }
  return value.replace(/^v/, "");
}

export function defaultReleaseBase(
  version: string | undefined,
  repo: string = DEFAULT_REPOSITORY,
): string {
  if (!version || version === "latest") {
    return `https://github.com/${repo}/releases/latest/download`;
  }
  return `https://github.com/${repo}/releases/download/v${version.replace(/^v/, "")}`;
}

export function currentExecutablePath(): string {
  const argvExecutable = Bun.argv[1];
  if (path.basename(process.execPath).startsWith("bun") && argvExecutable) {
    return path.resolve(argvExecutable);
  }
  return path.resolve(process.execPath);
}

export function assertDefaultSelfUpdateTarget(
  executablePath: string,
  repoRoot: string = path.resolve(import.meta.dir, "..", ".."),
): void {
  const resolved = path.resolve(executablePath);
  const normalized = resolved.replaceAll("\\", "/");
  const root = path.resolve(repoRoot).replaceAll("\\", "/");
  if (
    normalized === `${root}/src/index.ts` ||
    normalized === `${root}/dist/ideality`
  ) {
    throw new Error(
      "Refusing to self-update a source checkout entrypoint. Install ideality from a release binary before using 'ideality update'.",
    );
  }
}

export async function runUpdate(
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const currentVersion = normalizeVersion(
    options.currentVersion ?? VERSION,
    "current",
  );
  const target = getHostTarget();
  const explicitExecutable = Boolean(options.executablePath);
  const executablePath = path.resolve(
    options.executablePath ?? currentExecutablePath(),
  );
  const managed = await detectManagedInstall(executablePath);
  if (managed) {
    throw new Error(
      `This ideality executable is managed by ${managed.manager}; refusing to overwrite it. Use '${managed.command}' instead.`,
    );
  }
  if (!explicitExecutable) {
    if (path.basename(process.execPath).startsWith("bun")) {
      throw new Error(
        "Refusing to self-update a Bun/source execution. Install ideality from a release binary before using 'ideality update'.",
      );
    }
    assertDefaultSelfUpdateTarget(executablePath);
  }
  const baseUrl =
    options.baseUrl ??
    process.env.IDEALITY_UPDATE_BASE_URL ??
    process.env.IDEALITY_BASE_URL ??
    defaultReleaseBase(options.targetVersion);

  const metadataRoot = await mkdtemp(
    path.join(os.tmpdir(), "ideality-update-"),
  );
  let metadata: ReleaseMetadata;
  try {
    metadata = await fetchVerifiedReleaseMetadata(
      baseUrl,
      metadataRoot,
      options,
    );
  } finally {
    await rm(metadataRoot, { recursive: true, force: true });
  }

  const targetVersion = normalizeVersion(metadata.version, "release");
  const requestedVersion = options.targetVersion
    ? normalizeVersion(options.targetVersion, "requested")
    : undefined;
  if (requestedVersion && targetVersion !== requestedVersion) {
    throw new Error(
      `Release metadata version ${metadata.version} does not match requested version ${options.targetVersion}`,
    );
  }
  const artifact = metadata.artifacts[target];
  if (!artifact) {
    throw new Error(
      `Release ${metadata.version} has no artifact for ${target}; available targets: ${Object.keys(metadata.artifacts).sort().join(", ")}`,
    );
  }

  const ordering = compareVersions(targetVersion, currentVersion);
  if (ordering < 0 && !options.allowDowngrade) {
    throw new Error(
      `Refusing to downgrade ideality from ${currentVersion} to ${targetVersion}. Re-run with --allow-downgrade to override.`,
    );
  }
  if (ordering === 0 && !options.allowDowngrade) {
    return {
      status: "current",
      currentVersion,
      targetVersion,
      target,
      installMode: "direct",
      artifactVerified: false,
      migrationReadinessChecked: false,
      executablePath,
    };
  }
  if (options.checkOnly) {
    return {
      status: "update-available",
      currentVersion,
      targetVersion,
      target,
      installMode: "direct",
      artifactVerified: false,
      migrationReadinessChecked: false,
      executablePath,
    };
  }

  await assertDirectWritableExecutable(executablePath);

  const stagingRoot = await mkdtemp(
    path.join(path.dirname(executablePath), ".ideality-update-"),
  );
  const archivePath = path.join(stagingRoot, artifact.filename);
  const extractedPath = path.join(stagingRoot, "ideality");
  let configSnapshot: string | null = null;
  let backupCreated = false;
  const backupPath = `${executablePath}.previous-${process.pid}`;
  try {
    await downloadFile(
      joinUrl(baseUrl, artifact.filename),
      archivePath,
      options.fetcher,
    );
    await verifySha256(archivePath, artifact.sha256);
    await extractSingleBinary(archivePath, stagingRoot);
    await chmod(extractedPath, 0o755);
    await proveBinaryVersion(extractedPath, targetVersion, options.env);
    const migrationReadinessChecked = await checkMigrationReadiness(
      extractedPath,
      options.env,
    );

    if (options.dryRun) {
      return {
        status: "dry-run",
        currentVersion,
        targetVersion,
        target,
        installMode: "direct",
        artifactVerified: true,
        migrationReadinessChecked,
        executablePath,
      };
    }

    configSnapshot = await createConfigSnapshotIfPresent(options.env);
    await rename(executablePath, backupPath);
    backupCreated = true;
    await rename(extractedPath, executablePath);
    await runRequiredMigrations(executablePath, options.env);
    await proveBinaryVersion(executablePath, targetVersion, options.env);
    await rm(backupPath, { force: true });
    return {
      status: "updated",
      currentVersion,
      targetVersion,
      target,
      installMode: "direct",
      artifactVerified: true,
      migrationReadinessChecked,
      configSnapshot: configSnapshot ?? undefined,
      executablePath,
    };
  } catch (error) {
    if (backupCreated) {
      await rollbackBinary(executablePath, backupPath);
      if (configSnapshot) {
        await restoreConfigBytes(
          configSnapshot,
          getConfigPath(toProcessEnv(options.env)),
        );
      }
    }
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(backupPath, { force: true });
  }
}

async function fetchVerifiedReleaseMetadata(
  baseUrl: string,
  stagingRoot: string,
  options: Pick<UpdateOptions, "cosignPath" | "env" | "fetcher">,
): Promise<ReleaseMetadata> {
  const { metadataPath, bundlePath } = await stageMetadataFiles(
    baseUrl,
    stagingRoot,
    options.fetcher,
  );
  verifyMetadataSignature(metadataPath, bundlePath, options);
  const bytes = await readFile(metadataPath);
  return releaseMetadataSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
}

async function stageMetadataFiles(
  baseUrl: string,
  stagingRoot: string,
  fetcher: typeof fetch = fetch,
): Promise<{ metadataPath: string; bundlePath: string }> {
  const metadataUrl = joinUrl(baseUrl, METADATA_FILE);
  const bundleUrl = joinUrl(baseUrl, METADATA_BUNDLE_FILE);
  if (baseUrl.startsWith("file://")) {
    const files = {
      metadataPath: fileURLToPath(new URL(metadataUrl)),
      bundlePath: fileURLToPath(new URL(bundleUrl)),
    };
    await assertReadableMetadataFiles(files.metadataPath, files.bundlePath);
    return files;
  }
  const metadataPath = path.join(stagingRoot, METADATA_FILE);
  const bundlePath = path.join(stagingRoot, METADATA_BUNDLE_FILE);
  await downloadFile(metadataUrl, metadataPath, fetcher);
  await downloadFile(bundleUrl, bundlePath, fetcher);
  await assertReadableMetadataFiles(metadataPath, bundlePath);
  return { metadataPath, bundlePath };
}

async function assertReadableMetadataFiles(
  metadataPath: string,
  bundlePath: string,
): Promise<void> {
  try {
    await access(metadataPath, constants.R_OK);
    await access(bundlePath, constants.R_OK);
  } catch {
    throw new Error(
      "Could not verify release metadata signature because release-metadata.json or its Sigstore bundle is unavailable.",
    );
  }
}

function verifyMetadataSignature(
  metadataPath: string,
  bundlePath: string,
  options: Pick<UpdateOptions, "cosignPath" | "env">,
): void {
  const cosign = options.cosignPath ?? options.env?.IDEALITY_COSIGN ?? "cosign";
  const args = [
    "verify-blob",
    "--bundle",
    bundlePath,
    "--certificate-identity-regexp",
    SIGSTORE_CERTIFICATE_IDENTITY_REGEXP,
    "--certificate-oidc-issuer",
    SIGSTORE_OIDC_ISSUER,
    metadataPath,
  ];
  let result: ReturnType<typeof runCommand>;
  try {
    result = runCommand([cosign, ...args], options.env);
  } catch (error) {
    throw new Error(
      `Could not verify release metadata signature with cosign. Install cosign and retry; ideality will not trust unsigned release metadata. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not verify release metadata signature with cosign. Install cosign and retry; ideality will not trust unsigned release metadata. ${result.stderr || result.stdout}`,
    );
  }
}

async function downloadFile(
  url: string,
  destination: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await Bun.write(destination, await readUrl(url, fetcher));
}

async function readUrl(
  url: string,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  if (url.startsWith("file://")) {
    return new Uint8Array(await readFile(new URL(url)));
  }
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function joinUrl(baseUrl: string, filename: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${filename}`;
}

async function verifySha256(file: string, expected: string): Promise<void> {
  const actual = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Archive checksum mismatch for ${path.basename(file)}: expected ${expected}, got ${actual}`,
    );
  }
}

async function extractSingleBinary(
  archivePath: string,
  stagingRoot: string,
): Promise<void> {
  const list = runCommand(["tar", "-tzf", archivePath]);
  if (list.exitCode !== 0) {
    throw new Error(`Could not inspect release archive: ${list.stderr}`);
  }
  const members = list.stdout.trim().split("\n").filter(Boolean);
  if (members.length !== 1 || members[0] !== "ideality") {
    throw new Error(
      `Release archive must contain exactly one member named 'ideality'; got ${members.join(", ") || "nothing"}`,
    );
  }
  const extract = runCommand([
    "tar",
    "-C",
    stagingRoot,
    "-xzf",
    archivePath,
    "ideality",
  ]);
  if (extract.exitCode !== 0) {
    throw new Error(`Could not extract release archive: ${extract.stderr}`);
  }
}

async function proveBinaryVersion(
  executablePath: string,
  expectedVersion: string,
  env: Record<string, string | undefined> | undefined,
): Promise<void> {
  const result = runCommand([executablePath, "--version"], env);
  if (result.exitCode !== 0) {
    throw new Error(`Staged ideality did not run: ${result.stderr}`);
  }
  if (!result.stdout.includes(expectedVersion)) {
    throw new Error(
      `Staged ideality reported '${result.stdout.trim()}', expected version ${expectedVersion}`,
    );
  }
}

async function checkMigrationReadiness(
  executablePath: string,
  env: Record<string, string | undefined> | undefined,
): Promise<boolean> {
  const configPath = getConfigPath(toProcessEnv(env));
  if (!(await Bun.file(configPath).exists())) return false;
  const result = runCommand(
    [executablePath, "config", "migrate", "--dry-run"],
    env,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Staged ideality rejected registry migration readiness: ${result.stderr || result.stdout}`,
    );
  }
  return true;
}

async function runRequiredMigrations(
  executablePath: string,
  env: Record<string, string | undefined> | undefined,
): Promise<void> {
  const configPath = getConfigPath(toProcessEnv(env));
  if (!(await Bun.file(configPath).exists())) return;
  const result = runCommand([executablePath, "config", "migrate"], env);
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || result.stdout || "ideality config migrate failed",
    );
  }
}

async function createConfigSnapshotIfPresent(
  env: Record<string, string | undefined> | undefined,
): Promise<string | null> {
  const configPath = getConfigPath(toProcessEnv(env));
  if (!(await Bun.file(configPath).exists())) return null;
  return createConfigSnapshot(configPath);
}

async function rollbackBinary(
  executablePath: string,
  backupPath: string,
): Promise<void> {
  await rm(executablePath, { force: true });
  await rename(backupPath, executablePath);
}

async function restoreConfigBytes(
  snapshotPath: string,
  configPath: string,
): Promise<void> {
  await copyFile(snapshotPath, configPath);
  await chmod(configPath, 0o600);
}

function runCommand(
  cmd: string[],
  env: Record<string, string | undefined> | undefined = {},
): { exitCode: number; stdout: string; stderr: string } {
  const child = Bun.spawnSync({
    cmd,
    env: { ...process.env, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

async function assertDirectWritableExecutable(
  executablePath: string,
): Promise<void> {
  const info = await stat(executablePath);
  if (!info.isFile()) {
    throw new Error(
      `Cannot update '${executablePath}' because it is not a regular file.`,
    );
  }
  try {
    await access(executablePath, constants.W_OK);
    await access(path.dirname(executablePath), constants.W_OK);
  } catch {
    throw new Error(
      `Cannot update '${executablePath}' because the executable or its directory is not writable. Re-run the native installer for this install mode; ideality will not require sudo silently.`,
    );
  }
}

async function detectManagedInstall(
  executablePath: string,
): Promise<ManagedInstall | null> {
  const resolved = await realpath(executablePath).catch(() => executablePath);
  const normalized = resolved.replaceAll("\\", "/");
  if (/\/Cellar\/ideality\//.test(normalized)) {
    return {
      manager: "Homebrew",
      command: "brew upgrade 0xJord4n/tap/ideality",
    };
  }
  if (/\/\.bun\/install\/global\//.test(normalized)) {
    return { manager: "Bun", command: "bun update -g ideality" };
  }
  if (
    /\/pnpm\/global\/[^/]+\/node_modules\/ideality\//.test(normalized) ||
    /\/node_modules\/\.pnpm\/ideality@[^/]+\/node_modules\/ideality\//.test(
      normalized,
    )
  ) {
    return { manager: "pnpm", command: "pnpm update -g ideality" };
  }
  if (/\/\.config\/yarn\/global\/node_modules\/ideality\//.test(normalized)) {
    return { manager: "Yarn", command: "yarn global upgrade ideality" };
  }
  if (/\/node_modules\/ideality\//.test(normalized)) {
    return {
      manager: "npm",
      command: "npm update -g ideality",
    };
  }
  return null;
}

function toProcessEnv(
  env: Record<string, string | undefined> | undefined,
): NodeJS.ProcessEnv {
  return { ...process.env, ...env };
}
