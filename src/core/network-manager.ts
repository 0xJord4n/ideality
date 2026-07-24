import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";

import type {
  IdealityConfig,
  NetworkProfile,
  ResolvedIdentity,
  ValueSource,
} from "../domain/config.js";
import { resolveValueSource } from "./environment.js";
import {
  type ActiveNetworkState,
  buildNetworkPlan,
  clearActiveNetwork,
  loadActiveNetwork,
  type NetworkAction,
  type NetworkCommandStep,
  networkCapability,
  networkEnforcement,
  saveActiveNetwork,
} from "./network.js";
import {
  type ProcessRunner,
  requireSuccessfulProcess,
  runProcess,
} from "./process.js";
import { findExecutable } from "./runtime.js";

export interface NetworkManagerOptions {
  config: IdealityConfig;
  resolved: ResolvedIdentity;
  profileId: string;
  home: string;
  idealityHome: string;
  allowUnverified?: boolean;
  replace?: boolean;
  release?: boolean;
  dryRun?: boolean;
  runner?: ProcessRunner;
  baseEnv?: Record<string, string | undefined>;
  quiet?: boolean;
}

export interface NetworkOperation {
  profileId: string;
  action: NetworkAction;
  enforcement: ActiveNetworkState["enforcement"] | null;
  steps: NetworkCommandStep[];
  active: ActiveNetworkState | null;
}

export async function activateNetwork(
  options: NetworkManagerOptions,
): Promise<NetworkOperation> {
  return withNetworkLock(options.idealityHome, () =>
    activateNetworkUnlocked(options),
  );
}

async function activateNetworkUnlocked(
  options: NetworkManagerOptions,
): Promise<NetworkOperation> {
  const profile = requireProfile(options.config, options.profileId);
  const active = await loadActiveNetwork(options.idealityHome);
  if (active?.profile === options.profileId) {
    return {
      profileId: options.profileId,
      action: "up",
      enforcement: active.enforcement,
      steps: [],
      active,
    };
  }
  if (active && !options.replace) {
    throw new Error(
      `Network '${active.profile}' is already active for identity '${active.identity}'. Use --replace to switch it`,
    );
  }
  if (active && options.replace && !options.dryRun) {
    await deactivateNetworkUnlocked({
      ...options,
      profileId: active.profile,
      release: false,
    });
  }

  const enforcement = networkEnforcement(profile, options.allowUnverified);
  const prepared = await prepareNetworkPlan(profile, "up", options);
  try {
    if (!options.dryRun) {
      assertNetworkExecutable(profile);
      await executeSteps(
        prepared.steps,
        options.runner,
        options.baseEnv,
        options.quiet,
      );
      await saveActiveNetwork(options.idealityHome, {
        version: 1,
        profile: options.profileId,
        identity: options.resolved.id,
        driver: profile.driver,
        enforcement,
        activatedAt: new Date().toISOString(),
      });
    }
  } finally {
    await prepared.cleanup();
  }
  return {
    profileId: options.profileId,
    action: "up",
    enforcement,
    steps: prepared.publicSteps,
    active: options.dryRun
      ? active
      : await loadActiveNetwork(options.idealityHome),
  };
}

export async function deactivateNetwork(
  options: NetworkManagerOptions,
): Promise<NetworkOperation> {
  return withNetworkLock(options.idealityHome, () =>
    deactivateNetworkUnlocked(options),
  );
}

async function deactivateNetworkUnlocked(
  options: NetworkManagerOptions,
): Promise<NetworkOperation> {
  const profile = requireProfile(options.config, options.profileId);
  const active = await loadActiveNetwork(options.idealityHome);
  const prepared = await prepareNetworkPlan(profile, "down", options);
  try {
    if (!options.dryRun) {
      assertNetworkExecutable(profile);
      await executeSteps(
        prepared.steps,
        options.runner,
        options.baseEnv,
        options.quiet,
      );
      if (active?.profile === options.profileId) {
        await clearActiveNetwork(options.idealityHome);
      }
    }
  } finally {
    await prepared.cleanup();
  }
  return {
    profileId: options.profileId,
    action: "down",
    enforcement:
      active?.profile === options.profileId ? active.enforcement : null,
    steps: prepared.publicSteps,
    active: options.dryRun
      ? active
      : await loadActiveNetwork(options.idealityHome),
  };
}

export async function networkStatus(
  options: NetworkManagerOptions,
): Promise<NetworkOperation> {
  const profile = requireProfile(options.config, options.profileId);
  const prepared = await prepareNetworkPlan(profile, "status", options);
  try {
    if (!options.dryRun) {
      assertNetworkExecutable(profile);
      await executeSteps(
        prepared.steps,
        options.runner,
        options.baseEnv,
        options.quiet,
      );
    }
  } finally {
    await prepared.cleanup();
  }
  const active = await loadActiveNetwork(options.idealityHome);
  return {
    profileId: options.profileId,
    action: "status",
    enforcement:
      active?.profile === options.profileId ? active.enforcement : null,
    steps: prepared.publicSteps,
    active,
  };
}

export async function ensureNetwork(
  options: NetworkManagerOptions,
): Promise<void> {
  await withNetworkLock(options.idealityHome, async () => {
    const active = await loadActiveNetwork(options.idealityHome);
    if (active?.profile === options.profileId) {
      const profile = requireProfile(options.config, options.profileId);
      if (profile.driver === "mullvad") {
        const prepared = await prepareNetworkPlan(profile, "up", options);
        try {
          assertNetworkExecutable(profile);
          await executeSteps(
            prepared.steps,
            options.runner,
            options.baseEnv,
            true,
          );
        } finally {
          await prepared.cleanup();
        }
      } else {
        await networkStatus({ ...options, quiet: true });
      }
      return;
    }
    await activateNetworkUnlocked(options);
  });
}

function requireProfile(
  config: IdealityConfig,
  profileId: string,
): NetworkProfile {
  const profile = config.networks?.[profileId];
  if (!profile)
    throw new Error(`Network profile '${profileId}' does not exist`);
  return profile;
}

function assertNetworkExecutable(profile: NetworkProfile): void {
  const executable = networkCapability(profile).executable;
  if (!findExecutable(executable)) {
    throw new Error(
      `Network driver executable '${executable}' is not installed`,
    );
  }
  if (profile.sudo && !findExecutable("sudo")) {
    throw new Error(
      "Network profile requires sudo, but 'sudo' is not installed",
    );
  }
}

async function prepareNetworkPlan(
  profile: NetworkProfile,
  action: NetworkAction,
  options: NetworkManagerOptions,
): Promise<{
  steps: NetworkCommandStep[];
  publicSteps: NetworkCommandStep[];
  cleanup: () => Promise<void>;
}> {
  const runtimeDirectory = path.join(
    options.idealityHome,
    "runtime",
    "networks",
  );
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const pidPath = path.join(runtimeDirectory, `${options.profileId}.pid`);
  const temporary = await mkdtemp(path.join(runtimeDirectory, "materialized-"));
  await chmod(temporary, 0o700);
  const publicOptions = {
    allowUnverified: options.allowUnverified,
    release: options.release,
    pidPath,
    configPath:
      profile.driver === "wireguard" || profile.driver === "openvpn"
        ? "<materialized-config>"
        : undefined,
    authPath:
      profile.driver === "openvpn" && (profile.username || profile.password)
        ? "<materialized-auth>"
        : undefined,
  };
  const runtimeOptions = { ...publicOptions };
  const resolvedEnv: Record<string, string> = {};

  try {
    if (!options.dryRun) {
      if (
        profile.driver === "wireguard" &&
        (action === "up" || action === "down")
      ) {
        runtimeOptions.configPath = path.join(
          temporary,
          `${profile.interface ?? options.profileId}.conf`,
        );
        await writeSecretFile(
          runtimeOptions.configPath,
          await resolveSource(profile.config, options),
        );
      }
      if (profile.driver === "openvpn" && action === "up") {
        runtimeOptions.configPath = path.join(temporary, "network.conf");
        await writeSecretFile(
          runtimeOptions.configPath,
          await resolveSource(profile.config, options),
        );
      }
      if (
        action === "up" &&
        profile.driver === "openvpn" &&
        (profile.username || profile.password)
      ) {
        runtimeOptions.authPath = path.join(temporary, "auth.txt");
        await writeSecretFile(
          runtimeOptions.authPath,
          `${await optionalSource(profile.username, options)}\n${await optionalSource(profile.password, options)}\n`,
        );
      }
      if (profile.driver === "custom") {
        for (const [name, source] of Object.entries(profile.env ?? {})) {
          resolvedEnv[name] = await resolveSource(source, options);
        }
      }
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  let steps: NetworkCommandStep[];
  let publicSteps: NetworkCommandStep[];
  try {
    steps = buildNetworkPlan(
      options.profileId,
      profile,
      action,
      runtimeOptions,
    ).map((step) =>
      Object.keys(resolvedEnv).length > 0
        ? { ...step, env: resolvedEnv }
        : step,
    );
    publicSteps = buildNetworkPlan(
      options.profileId,
      profile,
      action,
      publicOptions,
    );
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return {
    steps,
    publicSteps,
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

async function resolveSource(
  source: ValueSource,
  options: NetworkManagerOptions,
): Promise<string> {
  const result = await resolveValueSource(
    options.config,
    source,
    options.resolved,
    {
      home: options.home,
      idealityHome: options.idealityHome,
      readFile: (file) => Bun.file(file).text(),
      baseEnv: options.baseEnv,
    },
  );
  if (result.value === null) throw new Error("Network value is unset");
  return result.value;
}

async function optionalSource(
  source: ValueSource | undefined,
  options: NetworkManagerOptions,
): Promise<string> {
  return source ? resolveSource(source, options) : "";
}

async function writeSecretFile(file: string, value: string): Promise<void> {
  await Bun.write(file, value);
  await chmod(file, 0o600);
}

async function executeSteps(
  steps: NetworkCommandStep[],
  runner: ProcessRunner = runProcess,
  baseEnv: Record<string, string | undefined> = process.env,
  quiet: boolean = false,
): Promise<void> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value !== undefined) env[name] = value;
  }
  for (const step of steps) {
    const result = await requireSuccessfulProcess(
      step.command,
      {
        env: { ...env, ...step.env },
        inherit: !quiet && !step.verifyConnection,
      },
      runner,
    );
    if (step.verifyConnection) {
      verifyConnectionOutput(step, result.stdout, result.stderr);
      if (!quiet) {
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
      }
    }
  }
}

function verifyConnectionOutput(
  step: NetworkCommandStep,
  stdout: string,
  stderr: string,
): void {
  const verification = step.verifyConnection;
  if (!verification) return;
  const output = `${stdout}\n${stderr}`;
  if (verification.provider === "tailscale") {
    let status: unknown;
    try {
      status = JSON.parse(stdout);
    } catch {
      throw new Error("Tailscale status did not return valid JSON");
    }
    if (!status || typeof status !== "object") {
      throw new Error("Tailscale status is invalid");
    }
    const value = status as Record<string, unknown>;
    const exitStatus = value.ExitNodeStatus;
    const exitNode =
      exitStatus && typeof exitStatus === "object"
        ? (exitStatus as Record<string, unknown>)
        : null;
    if (
      value.BackendState !== "Running" ||
      !exitNode ||
      typeof exitNode.ID !== "string" ||
      exitNode.ID.length === 0 ||
      exitNode.Online !== true
    ) {
      throw new Error(
        `Tailscale is not connected through exit node '${verification.exitNode}'`,
      );
    }
    return;
  }
  if (
    verification.provider === "warp" &&
    (!/\bconnected\b/i.test(output) || /\bdisconnected\b/i.test(output))
  ) {
    throw new Error("Cloudflare WARP is not connected");
  }
  if (
    verification.provider === "mullvad" &&
    (!/\bconnected\b/i.test(output) || /\bdisconnected\b/i.test(output))
  ) {
    throw new Error("Mullvad is not connected");
  }
}

async function withNetworkLock<T>(
  idealityHome: string,
  operation: () => Promise<T>,
): Promise<T> {
  const runtimeDirectory = path.join(idealityHome, "runtime");
  const lock = path.join(runtimeDirectory, "network.lock");
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await Bun.write(path.join(lock, "owner"), `${process.pid}\n`);
      try {
        return await operation();
      } finally {
        await rm(lock, { recursive: true, force: true });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (await lockOwnerIsDead(lock)) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await Bun.sleep(100);
    }
  }
  throw new Error("Timed out waiting for the host network lock");
}

async function lockOwnerIsDead(lock: string): Promise<boolean> {
  try {
    const owner = Number(
      (await Bun.file(path.join(lock, "owner")).text()).trim(),
    );
    if (!Number.isInteger(owner) || owner <= 0) return true;
    process.kill(owner, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return true;
    if (code === "ENOENT") {
      const info = await stat(lock).catch(() => null);
      return Boolean(info && Date.now() - info.mtimeMs > 5000);
    }
    return false;
  }
}
