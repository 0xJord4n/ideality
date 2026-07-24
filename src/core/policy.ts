import path from "node:path";

import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { z } from "zod";

import type {
  ExecutionTarget,
  IdealityConfig,
  NetworkProfile,
  SecretBackendConfig,
  ToolDefinition,
  VmProfile,
} from "../domain/config.js";
import {
  PROJECT_CONFIG_FILE,
  PROJECT_DIRECTORY,
  getProjectConfigPath,
  loadProjectConfig,
} from "./project-config.js";

export const POLICY_FILE = "policy.jsonc";
export const POLICY_VERSION = 1;

const POLICY_SUBJECT = `${PROJECT_DIRECTORY}/${POLICY_FILE}`;
const PROJECT_SUBJECT = `${PROJECT_DIRECTORY}/${PROJECT_CONFIG_FILE}`;

const NETWORK_DRIVERS = [
  "custom",
  "mullvad",
  "openvpn",
  "tailscale",
  "warp",
  "wireguard",
] as const satisfies readonly NetworkProfile["driver"][];

const VM_DRIVERS = [
  "apple-vz",
  "cloud-hypervisor",
  "custom",
  "firecracker",
  "lima",
] as const satisfies readonly VmProfile["driver"][];

const SECRET_BACKEND_TYPES = [
  "age",
  "bitwarden",
  "dashlane",
  "file",
  "keychain",
  "onepassword",
  "pass",
] as const satisfies readonly SecretBackendConfig["type"][];

const policySchema = z
  .object({
    version: z.literal(POLICY_VERSION),
    label: z.string().min(1).optional(),
    tools: z
      .object({
        permitted: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    network: z
      .object({
        required: z.boolean().optional(),
        permittedDrivers: z.array(z.enum(NETWORK_DRIVERS)).optional(),
      })
      .strict()
      .optional(),
    vm: z
      .object({
        required: z.boolean().optional(),
        permittedDrivers: z.array(z.enum(VM_DRIVERS)).optional(),
      })
      .strict()
      .optional(),
    secrets: z
      .object({
        requireBackend: z.boolean().optional(),
        permittedBackends: z.array(z.enum(SECRET_BACKEND_TYPES)).optional(),
      })
      .strict()
      .optional(),
    custom: z
      .object({
        toolCommands: z.boolean().optional(),
        networkCommands: z.boolean().optional(),
        vmCommands: z.boolean().optional(),
        vmProvisioning: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TeamPolicy = z.infer<typeof policySchema>;

export interface PolicyFinding {
  code: string;
  subject: string;
  message: string;
}

export type PolicyParseResult =
  | { ok: true; policy: TeamPolicy }
  | { ok: false; finding: PolicyFinding };

export interface PolicyCheckResult {
  status: "pass" | "fail";
  projectRoot: string;
  policyPath: string;
  policy: { version: number; label?: string } | null;
  findings: PolicyFinding[];
}

export interface PresentPolicyCheckResult {
  status: "pass" | "fail";
  projectRoot: string;
  policyPath: string;
  policy: { version: number; label?: string } | null;
  findings: PolicyFinding[];
}

export function getPolicyPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_DIRECTORY, POLICY_FILE);
}

export function parsePolicyDocument(source: string): PolicyParseResult {
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    const detail = errors
      .map(
        (error) =>
          `${printParseErrorCode(error.error)} at offset ${error.offset}`,
      )
      .join(", ");
    return {
      ok: false,
      finding: {
        code: "policy-malformed",
        subject: POLICY_SUBJECT,
        message: `Invalid JSONC: ${detail}`,
      },
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      finding: {
        code: "policy-malformed",
        subject: POLICY_SUBJECT,
        message: "Team policy must be a JSONC object",
      },
    };
  }
  const version = (value as Record<string, unknown>).version;
  if (version !== POLICY_VERSION) {
    const found =
      typeof version === "number" || typeof version === "string"
        ? `version ${JSON.stringify(version)}`
        : version === undefined
          ? "no version"
          : "an unsupported version value";
    return {
      ok: false,
      finding: {
        code: "policy-version-mismatch",
        subject: `${POLICY_SUBJECT}#version`,
        message: `Team policy declares ${found}; this build supports version ${POLICY_VERSION}`,
      },
    };
  }
  const result = policySchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      finding: {
        code: "policy-invalid",
        subject: POLICY_SUBJECT,
        message: `Invalid team policy: ${detail}`,
      },
    };
  }
  return { ok: true, policy: result.data };
}

function sortedEntries<T>(
  record: Record<string, T> | undefined,
): Array<[string, T]> {
  return Object.entries(record ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

function hasAuthCommands(auth: ToolDefinition["auth"]): boolean {
  return Object.values(auth ?? {}).some(
    (command) => (command?.length ?? 0) > 0,
  );
}

function effectiveNetwork(
  execution: ExecutionTarget | undefined,
  config: IdealityConfig,
): string | null {
  if (!execution) return null;
  if (execution.network) return execution.network;
  if (execution.target === "vm")
    return config.vms?.[execution.vm]?.network ?? null;
  return null;
}

export function evaluatePolicy(
  policy: TeamPolicy,
  config: IdealityConfig,
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];

  const permittedTools = policy.tools?.permitted;
  if (permittedTools) {
    const allowed = new Set(permittedTools);
    for (const [tool] of sortedEntries(config.tools)) {
      if (!allowed.has(tool)) {
        findings.push({
          code: "tool-not-permitted",
          subject: `tools/${tool}`,
          message: `Tool '${tool}' is not on the team policy allowlist`,
        });
      }
    }
  }
  if (policy.custom?.toolCommands === false) {
    for (const [tool, definition] of sortedEntries(config.tools)) {
      if (hasAuthCommands(definition.auth)) {
        findings.push({
          code: "custom-tool-commands-denied",
          subject: `tools/${tool}`,
          message: `Tool '${tool}' declares custom auth commands, which the team policy forbids`,
        });
      }
    }
  }

  const permittedNetworkDrivers = policy.network?.permittedDrivers;
  if (permittedNetworkDrivers) {
    const allowed = new Set<string>(permittedNetworkDrivers);
    for (const [id, profile] of sortedEntries(config.networks)) {
      if (!allowed.has(profile.driver)) {
        findings.push({
          code: "network-driver-not-permitted",
          subject: `networks/${id}`,
          message: `Network profile '${id}' uses driver '${profile.driver}', which the team policy does not permit`,
        });
      }
    }
  }
  if (policy.custom?.networkCommands === false) {
    for (const [id, profile] of sortedEntries(config.networks)) {
      if (profile.driver === "custom") {
        findings.push({
          code: "custom-network-commands-denied",
          subject: `networks/${id}`,
          message: `Network profile '${id}' runs custom commands, which the team policy forbids`,
        });
      }
    }
  }

  const permittedVmDrivers = policy.vm?.permittedDrivers;
  if (permittedVmDrivers) {
    const allowed = new Set<string>(permittedVmDrivers);
    for (const [id, profile] of sortedEntries(config.vms)) {
      if (!allowed.has(profile.driver)) {
        findings.push({
          code: "vm-driver-not-permitted",
          subject: `vms/${id}`,
          message: `VM profile '${id}' uses driver '${profile.driver}', which the team policy does not permit`,
        });
      }
    }
  }
  if (policy.custom?.vmCommands === false) {
    for (const [id, profile] of sortedEntries(config.vms)) {
      if (profile.driver === "custom") {
        findings.push({
          code: "custom-vm-commands-denied",
          subject: `vms/${id}`,
          message: `VM profile '${id}' runs custom commands, which the team policy forbids`,
        });
      }
    }
  }
  if (policy.custom?.vmProvisioning === false) {
    for (const [id, profile] of sortedEntries(config.vms)) {
      if (profile.driver === "lima" && (profile.provision?.length ?? 0) > 0) {
        findings.push({
          code: "vm-provisioning-denied",
          subject: `vms/${id}`,
          message: `VM profile '${id}' declares provisioning scripts, which the team policy forbids`,
        });
      }
    }
  }

  if (policy.vm?.required || policy.network?.required) {
    for (const [identityId, identity] of sortedEntries(config.identities)) {
      for (const [tool, profile] of sortedEntries(identity.tools)) {
        if (profile.enabled === false) continue;
        const execution = profile.execution ?? identity.execution;
        const subject = `identities/${identityId}/tools/${tool}`;
        if (policy.vm?.required && execution?.target !== "vm") {
          findings.push({
            code: "vm-required",
            subject,
            message: `Tool '${tool}' for identity '${identityId}' does not execute inside a VM, which the team policy requires`,
          });
        }
        if (policy.network?.required && !effectiveNetwork(execution, config)) {
          findings.push({
            code: "network-required",
            subject,
            message: `Tool '${tool}' for identity '${identityId}' does not route through a network profile, which the team policy requires`,
          });
        }
      }
    }
  }

  const backend = config.secretBackend;
  if (policy.secrets?.requireBackend && !backend) {
    findings.push({
      code: "secret-backend-required",
      subject: "secretBackend",
      message:
        "Team policy requires a secret backend, but the project does not declare one",
    });
  }
  const permittedBackends = policy.secrets?.permittedBackends;
  if (
    permittedBackends &&
    backend &&
    !permittedBackends.includes(backend.type)
  ) {
    findings.push({
      code: "secret-backend-not-permitted",
      subject: "secretBackend",
      message: `Secret backend type '${backend.type}' is not permitted by the team policy`,
    });
  }

  return findings;
}

function policySummary(policy: TeamPolicy): {
  version: number;
  label?: string;
} {
  return {
    version: policy.version,
    ...(policy.label ? { label: policy.label } : {}),
  };
}

export function formatPolicyFailure(
  heading: string,
  policyPath: string,
  findings: PolicyFinding[],
): string {
  return [
    `${heading} (${policyPath})`,
    ...findings.map((finding) => `- ${finding.subject}: ${finding.message}`),
  ].join("\n");
}

export async function checkPresentProjectPolicy(
  projectRoot: string,
  config: IdealityConfig | null,
): Promise<PresentPolicyCheckResult | null> {
  const policyPath = getPolicyPath(projectRoot);
  const policyFile = Bun.file(policyPath);
  if (!(await policyFile.exists())) return null;

  const parsed = parsePolicyDocument(await policyFile.text());
  if (parsed.ok === false) {
    return {
      status: "fail",
      projectRoot,
      policyPath,
      policy: null,
      findings: [parsed.finding],
    };
  }

  const findings = config
    ? evaluatePolicy(parsed.policy, config)
    : [
        {
          code: "project-missing",
          subject: PROJECT_SUBJECT,
          message: `No project configuration at '${getProjectConfigPath(projectRoot)}'`,
        },
      ];
  return {
    status: findings.length === 0 ? "pass" : "fail",
    projectRoot,
    policyPath,
    policy: policySummary(parsed.policy),
    findings,
  };
}

export async function checkProjectPolicy(
  projectRoot: string,
): Promise<PolicyCheckResult> {
  const policyPath = getPolicyPath(projectRoot);
  const findings: PolicyFinding[] = [];
  let policy: TeamPolicy | null = null;

  const policyFile = Bun.file(policyPath);
  if (!(await policyFile.exists())) {
    findings.push({
      code: "policy-missing",
      subject: POLICY_SUBJECT,
      message: `No team policy at '${policyPath}'`,
    });
  } else {
    const parsed = parsePolicyDocument(await policyFile.text());
    if (parsed.ok === true) {
      policy = parsed.policy;
    } else {
      findings.push(parsed.finding);
    }
  }

  if (policy) {
    let project: IdealityConfig | null = null;
    let projectInvalid = false;
    try {
      project = await loadProjectConfig(projectRoot);
    } catch (error) {
      projectInvalid = true;
      findings.push({
        code: "project-invalid",
        subject: PROJECT_SUBJECT,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (project) {
      findings.push(...evaluatePolicy(policy, project));
    } else if (!projectInvalid) {
      findings.push({
        code: "project-missing",
        subject: PROJECT_SUBJECT,
        message: `No project configuration at '${getProjectConfigPath(projectRoot)}'`,
      });
    }
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    projectRoot,
    policyPath,
    policy: policy ? policySummary(policy) : null,
    findings,
  };
}
