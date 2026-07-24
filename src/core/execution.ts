import type {
  IdealityConfig,
  NetworkProfile,
  ResolvedIdentity,
  VmProfile,
} from "../domain/config.js";

export interface ResolvedExecution {
  target: "host" | "vm";
  vmId: string | null;
  vm: VmProfile | null;
  networkId: string | null;
  network: NetworkProfile | null;
  source: "tool" | "identity" | "default";
}

export type ExecutionSummary = Pick<
  ResolvedExecution,
  "target" | "vmId" | "networkId" | "source"
>;

export function summarizeExecution(
  execution: ResolvedExecution,
): ExecutionSummary {
  return {
    target: execution.target,
    vmId: execution.vmId,
    networkId: execution.networkId,
    source: execution.source,
  };
}

export function resolveExecution(
  config: IdealityConfig,
  resolved: ResolvedIdentity,
  tool?: string,
): ResolvedExecution {
  const toolExecution = tool
    ? resolved.identity.tools[tool]?.execution
    : undefined;
  const execution = toolExecution ?? resolved.identity.execution;
  const source = toolExecution
    ? "tool"
    : resolved.identity.execution
      ? "identity"
      : "default";

  if (!execution || execution.target === "host") {
    const networkId = execution?.network ?? null;
    return {
      target: "host",
      vmId: null,
      vm: null,
      networkId,
      network: networkId ? (config.networks?.[networkId] ?? null) : null,
      source,
    };
  }

  const vm = config.vms?.[execution.vm];
  if (!vm) {
    throw new Error(`VM profile '${execution.vm}' does not exist`);
  }
  const networkId = execution.network ?? vm.network ?? null;
  return {
    target: "vm",
    vmId: execution.vm,
    vm,
    networkId,
    network: networkId ? (config.networks?.[networkId] ?? null) : null,
    source,
  };
}
