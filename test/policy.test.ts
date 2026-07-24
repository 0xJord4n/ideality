import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { policyCheckCommand } from "../src/commands/policy.js";
import {
  checkProjectPolicy,
  evaluatePolicy,
  getPolicyPath,
  parsePolicyDocument,
  type TeamPolicy,
} from "../src/core/policy.js";
import { findProjectRoot } from "../src/core/project-config.js";
import type { IdealityConfig } from "../src/domain/config.js";

const FIXTURES = path.join(import.meta.dir, "fixtures", "policy");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture(name: string): Promise<string> {
  return Bun.file(path.join(FIXTURES, name)).text();
}

async function fixturePolicy(): Promise<TeamPolicy> {
  const parsed = parsePolicyDocument(await fixture("policy.jsonc"));
  if (!parsed.ok) throw new Error(parsed.finding.message);
  return parsed.policy;
}

async function projectDirectory(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ideality-policy-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, ".ideality"), { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    await Bun.write(path.join(root, ".ideality", name), source);
  }
  return root;
}

function config(): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    secretBackend: { type: "bitwarden" },
    networks: {
      private: {
        driver: "wireguard",
        config: { from: "secret", key: "bw://wireguard/private" },
        killSwitch: "required",
      },
    },
    vms: {
      workspace: { driver: "lima", network: "private" },
    },
    identities: {
      sample: {
        label: "Sample",
        roots: ["."],
        execution: { target: "vm", vm: "workspace" },
        tools: {
          gh: { enabled: true },
          custom: {
            enabled: true,
            env: { CUSTOM_TOKEN: { from: "secret", key: "bw://custom" } },
          },
        },
      },
    },
    tools: {
      gh: { executable: "gh", isolation: "process" },
      custom: { executable: "custom-cli", isolation: "process" },
    },
  };
}

function policy(overrides: Partial<TeamPolicy> = {}): TeamPolicy {
  return { version: 1, ...overrides };
}

describe("parsePolicyDocument", () => {
  test("parses versioned JSONC with comments and trailing commas", async () => {
    const parsed = parsePolicyDocument(await fixture("policy.jsonc"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.finding.message);
    expect(parsed.policy.version).toBe(1);
    expect(parsed.policy.label).toBe("Platform team baseline");
    expect(parsed.policy.tools?.permitted).toEqual(["custom", "gh"]);
    expect(parsed.policy.network?.required).toBe(true);
    expect(parsed.policy.custom?.vmProvisioning).toBe(false);
  });

  test("reports malformed JSONC explicitly", async () => {
    const parsed = parsePolicyDocument(await fixture("policy-malformed.jsonc"));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a parse failure");
    expect(parsed.finding.code).toBe("policy-malformed");
    expect(parsed.finding.message).toContain("Invalid JSONC");
  });

  test("reports a version mismatch explicitly", async () => {
    const parsed = parsePolicyDocument(
      await fixture("policy-version-mismatch.jsonc"),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a parse failure");
    expect(parsed.finding.code).toBe("policy-version-mismatch");
    expect(parsed.finding.message).toContain("version 2");
    expect(parsed.finding.message).toContain("supports version 1");
  });

  test("reports a missing version as a version mismatch", () => {
    const parsed = parsePolicyDocument(`{ "label": "No version" }`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a parse failure");
    expect(parsed.finding.code).toBe("policy-version-mismatch");
    expect(parsed.finding.message).toContain("no version");
  });

  test("rejects unknown policy fields", () => {
    const parsed = parsePolicyDocument(
      `{ "version": 1, "tools": { "allowed": [] } }`,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a parse failure");
    expect(parsed.finding.code).toBe("policy-invalid");
  });

  test("rejects unknown secret backend types", () => {
    const parsed = parsePolicyDocument(
      `{ "version": 1, "secrets": { "permittedBackends": ["vault"] } }`,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected a parse failure");
    expect(parsed.finding.code).toBe("policy-invalid");
  });
});

describe("evaluatePolicy", () => {
  test("passes a compliant handover bundle", async () => {
    expect(evaluatePolicy(await fixturePolicy(), config())).toEqual([]);
  });

  test("flags tools outside the allowlist in deterministic order", () => {
    const bundle = config();
    bundle.tools.zulu = { executable: "zulu" };
    bundle.tools.alpha = { executable: "alpha" };
    const findings = evaluatePolicy(
      policy({ tools: { permitted: ["custom", "gh"] } }),
      bundle,
    );
    expect(findings.map((finding) => finding.subject)).toEqual([
      "tools/alpha",
      "tools/zulu",
    ]);
    expect(findings.map((finding) => finding.code)).toEqual([
      "tool-not-permitted",
      "tool-not-permitted",
    ]);
  });

  test("denies custom tool auth commands", () => {
    const bundle = config();
    bundle.tools.custom!.auth = { login: ["custom-cli", "login"] };
    const findings = evaluatePolicy(
      policy({ custom: { toolCommands: false } }),
      bundle,
    );
    expect(findings).toEqual([
      {
        code: "custom-tool-commands-denied",
        subject: "tools/custom",
        message:
          "Tool 'custom' declares custom auth commands, which the team policy forbids",
      },
    ]);
  });

  test("restricts network drivers and custom network commands", () => {
    const bundle = config();
    bundle.networks!.adhoc = {
      driver: "custom",
      connect: ["vpn-up"],
      disconnect: ["vpn-down"],
      status: ["vpn-status"],
    };
    const findings = evaluatePolicy(
      policy({
        network: { permittedDrivers: ["wireguard"] },
        custom: { networkCommands: false },
      }),
      bundle,
    );
    expect(findings.map((finding) => finding.code)).toEqual([
      "network-driver-not-permitted",
      "custom-network-commands-denied",
    ]);
    expect(findings.every((finding) => finding.subject === "networks/adhoc")).toBe(
      true,
    );
  });

  test("requires a network route for enabled tools", () => {
    const bundle = config();
    bundle.identities.sample!.execution = { target: "host" };
    bundle.identities.sample!.tools = { custom: { enabled: true } };
    const findings = evaluatePolicy(policy({ network: { required: true } }), bundle);
    expect(findings).toEqual([
      {
        code: "network-required",
        subject: "identities/sample/tools/custom",
        message:
          "Tool 'custom' for identity 'sample' does not route through a network profile, which the team policy requires",
      },
    ]);
  });

  test("requires VM execution for enabled tools", () => {
    const bundle = config();
    bundle.identities.sample!.execution = { target: "host", network: "private" };
    bundle.identities.sample!.tools = { custom: { enabled: true } };
    const findings = evaluatePolicy(policy({ vm: { required: true } }), bundle);
    expect(findings.map((finding) => finding.code)).toEqual(["vm-required"]);
  });

  test("skips disabled tools when checking execution requirements", () => {
    const bundle = config();
    bundle.identities.sample!.execution = { target: "host" };
    bundle.identities.sample!.tools = { custom: { enabled: false } };
    expect(
      evaluatePolicy(
        policy({ network: { required: true }, vm: { required: true } }),
        bundle,
      ),
    ).toEqual([]);
  });

  test("restricts VM drivers, custom VM commands, and provisioning", () => {
    const bundle = config();
    bundle.vms!.legacy = {
      driver: "custom",
      start: ["vm-start"],
      stop: ["vm-stop"],
      status: ["vm-status"],
      exec: ["vm-exec"],
    };
    bundle.vms!.workspace = {
      driver: "lima",
      network: "private",
      provision: ["install-toolchain"],
    };
    const findings = evaluatePolicy(
      policy({
        vm: { permittedDrivers: ["lima"] },
        custom: { vmCommands: false, vmProvisioning: false },
      }),
      bundle,
    );
    expect(
      findings.map((finding) => [finding.code, finding.subject]),
    ).toEqual([
      ["vm-driver-not-permitted", "vms/legacy"],
      ["custom-vm-commands-denied", "vms/legacy"],
      ["vm-provisioning-denied", "vms/workspace"],
    ]);
  });

  test("requires and restricts secret backends", () => {
    const missing = config();
    delete missing.secretBackend;
    expect(
      evaluatePolicy(policy({ secrets: { requireBackend: true } }), missing).map(
        (finding) => finding.code,
      ),
    ).toEqual(["secret-backend-required"]);

    const mismatched = config();
    mismatched.secretBackend = { type: "file" };
    expect(
      evaluatePolicy(
        policy({ secrets: { permittedBackends: ["bitwarden"] } }),
        mismatched,
      ).map((finding) => finding.code),
    ).toEqual(["secret-backend-not-permitted"]);
  });

  test("never leaks secret material into findings", () => {
    const bundle = config();
    bundle.networks!.leak = {
      driver: "openvpn",
      config: "wg-secret-material-3f9a",
      password: "ovpn-password-literal-77c1",
    };
    bundle.identities.sample!.tools.custom!.env = {
      CUSTOM_TOKEN: "token-literal-value-b2d4",
    };
    const findings = evaluatePolicy(
      policy({
        tools: { permitted: [] },
        network: { permittedDrivers: ["mullvad"] },
        vm: { required: true },
        custom: { networkCommands: false },
      }),
      bundle,
    );
    expect(findings.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain("wg-secret-material-3f9a");
    expect(serialized).not.toContain("ovpn-password-literal-77c1");
    expect(serialized).not.toContain("token-literal-value-b2d4");
    expect(serialized).not.toContain("bw://wireguard/private");
  });
});

describe("checkProjectPolicy", () => {
  test("resolves the policy path inside the project directory", () => {
    expect(getPolicyPath("/workspace/app")).toBe(
      "/workspace/app/.ideality/policy.jsonc",
    );
  });

  test("passes a compliant project", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy.jsonc"),
      "project.jsonc": await fixture("project.jsonc"),
    });
    const result = await checkProjectPolicy(root);
    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.policy).toEqual({
      version: 1,
      label: "Platform team baseline",
    });
    expect(result.policyPath).toBe(getPolicyPath(root));
  });

  test("discovers the project root from a nested directory", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy.jsonc"),
      "project.jsonc": await fixture("project.jsonc"),
    });
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    const discovered = await findProjectRoot(nested);
    expect(discovered).toBe(root);
    expect((await checkProjectPolicy(discovered)).status).toBe("pass");
  });

  test("fails explicitly when the policy is missing", async () => {
    const root = await projectDirectory({
      "project.jsonc": await fixture("project.jsonc"),
    });
    const result = await checkProjectPolicy(root);
    expect(result.status).toBe("fail");
    expect(result.policy).toBeNull();
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "policy-missing",
    ]);
  });

  test("fails explicitly when the project configuration is missing", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy.jsonc"),
    });
    const result = await checkProjectPolicy(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "project-missing",
    ]);
  });

  test("fails explicitly when the project configuration is malformed", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy.jsonc"),
      "project.jsonc": `{ "version": 1,`,
    });
    const result = await checkProjectPolicy(root);
    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "project-invalid",
    ]);
  });

  test("surfaces a policy version mismatch without evaluating the project", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy-version-mismatch.jsonc"),
      "project.jsonc": await fixture("project.jsonc"),
    });
    const result = await checkProjectPolicy(root);
    expect(result.status).toBe("fail");
    expect(result.policy).toBeNull();
    expect(result.findings.map((finding) => finding.code)).toEqual([
      "policy-version-mismatch",
    ]);
  });
});

interface PolicyCheckContext {
  flags: { json: boolean; path: string };
  colors: { red: (text: string) => string; green: (text: string) => string };
}

async function runPolicyCheck(flags: {
  json: boolean;
  path: string;
}): Promise<{ stdout: string; exitCode: number }> {
  const handler = policyCheckCommand.handler as unknown as (
    context: PolicyCheckContext,
  ) => Promise<void>;
  const lines: string[] = [];
  const originalLog = console.log;
  const previousExitCode = process.exitCode ?? 0;
  process.exitCode = 0;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    await handler({
      flags,
      colors: { red: (text) => text, green: (text) => text },
    });
    return { stdout: lines.join("\n"), exitCode: process.exitCode ?? 0 };
  } finally {
    console.log = originalLog;
    process.exitCode = previousExitCode;
  }
}

describe("policy check command", () => {
  test("fails CI with a nonzero exit code and JSON findings", async () => {
    const root = await projectDirectory({
      "project.jsonc": await fixture("project.jsonc"),
    });
    const result = await runPolicyCheck({ json: true, path: root });
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      findings: Array<{ code: string }>;
    };
    expect(payload.status).toBe("fail");
    expect(payload.findings.map((finding) => finding.code)).toEqual([
      "policy-missing",
    ]);
  });

  test("reports success with a zero exit code for a compliant project", async () => {
    const root = await projectDirectory({
      "policy.jsonc": await fixture("policy.jsonc"),
      "project.jsonc": await fixture("project.jsonc"),
    });
    const result = await runPolicyCheck({ json: false, path: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Team policy: Platform team baseline");
    expect(result.stdout).toContain("Policy satisfied");
  });
});
