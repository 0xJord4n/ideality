import type { AuthHealthResult } from "../core/auth.js";
import { redactConfig } from "../core/environment.js";
import type { PolicyCheckResult } from "../core/policy.js";
import type { ExecutionTarget, IdealityConfig } from "../domain/config.js";

/** Raised by staged-mutation helpers when a change would be invalid. */
export class ConfigMutationError extends Error {}

export type TuiScreen = "dashboard" | "diff" | "rollback" | "auth" | "policy";
export type DashboardPane = "identities" | "tools" | "roots";

export interface TuiStatus {
  kind: "info" | "error";
  text: string;
}

export interface ConfigDiffLine {
  op: "add" | "remove" | "change";
  path: string;
  before: string | null;
  after: string | null;
}

export interface RollbackPreview {
  snapshot: string;
  config: IdealityConfig;
  diff: ConfigDiffLine[];
}

export interface TuiState {
  saved: IdealityConfig;
  draft: IdealityConfig;
  screen: TuiScreen;
  pane: DashboardPane;
  selectedIdentity: string;
  toolCursor: number;
  rootCursor: number;
  bindingFolder: boolean;
  confirmingQuit: boolean;
  status: TuiStatus | null;
  rollback: {
    loaded: boolean;
    snapshots: string[];
    cursor: number;
    preview: RollbackPreview | null;
  };
  auth: {
    phase: "idle" | "loading" | "ready";
    results: AuthHealthResult[];
  };
  policy: {
    phase: "idle" | "loading" | "ready";
    result: PolicyCheckResult | null;
  };
}

export type TuiAction =
  | { type: "select-identity"; id: string }
  | { type: "focus-next-pane" }
  | { type: "move-cursor"; direction: 1 | -1 }
  | { type: "toggle-tool" }
  | { type: "cycle-network" }
  | { type: "cycle-vm" }
  | { type: "set-default-identity" }
  | { type: "open-bind-input" }
  | { type: "close-bind-input" }
  | { type: "bind-folder"; root: string }
  | { type: "unbind-folder" }
  | { type: "discard-draft" }
  | { type: "open-screen"; screen: TuiScreen }
  | { type: "save-succeeded"; config: IdealityConfig }
  | { type: "save-failed"; error: string }
  | { type: "rollback-loaded"; snapshots: string[] }
  | { type: "rollback-move"; direction: 1 | -1 }
  | { type: "rollback-previewed"; snapshot: string; config: IdealityConfig }
  | { type: "rollback-preview-closed" }
  | { type: "rollback-applied"; snapshot: string; config: IdealityConfig }
  | { type: "rollback-failed"; error: string }
  | { type: "auth-loading" }
  | { type: "auth-loaded"; results: AuthHealthResult[] }
  | { type: "auth-failed"; error: string }
  | { type: "policy-loading" }
  | { type: "policy-loaded"; result: PolicyCheckResult }
  | { type: "policy-failed"; error: string }
  | { type: "request-quit" }
  | { type: "cancel-quit" }
  | { type: "status"; status: TuiStatus };

/** Build the initial TUI state around the last saved config. */
export function createTuiState(
  config: IdealityConfig,
  activeIdentity: string,
): TuiState {
  return {
    saved: config,
    draft: config,
    screen: "dashboard",
    pane: "identities",
    selectedIdentity: config.identities[activeIdentity]
      ? activeIdentity
      : config.defaultIdentity,
    toolCursor: 0,
    rootCursor: 0,
    bindingFolder: false,
    confirmingQuit: false,
    status: null,
    rollback: { loaded: false, snapshots: [], cursor: 0, preview: null },
    auth: { phase: "idle", results: [] },
    policy: { phase: "idle", result: null },
  };
}

/** Tool names in the same order the dashboard renders them. */
export function toolNames(config: IdealityConfig): string[] {
  return Object.keys(config.tools);
}

/** Whether a tool is configured and enabled for an identity. */
export function isToolActive(
  config: IdealityConfig,
  identityId: string,
  tool: string,
): boolean {
  const profile = config.identities[identityId]?.tools[tool];
  return Boolean(profile) && profile?.enabled !== false;
}

/** Whether the draft differs from the last saved config. */
export function isDirty(state: TuiState): boolean {
  return !deepEqual(state.saved, state.draft);
}

/** Guard for applying a rollback snapshot. */
export function canApplyRollback(
  state: TuiState,
): { ok: true } | { ok: false; reason: string } {
  if (isDirty(state)) {
    return {
      ok: false,
      reason: "Save or discard staged changes before applying a rollback",
    };
  }
  if (!state.rollback.preview) {
    return { ok: false, reason: "Preview a snapshot before applying it" };
  }
  return { ok: true };
}

function requireIdentity(config: IdealityConfig, id: string): void {
  if (!config.identities[id]) {
    throw new ConfigMutationError(`Identity '${id}' does not exist`);
  }
}

/** Stage a new default identity. */
export function setDefaultIdentity(
  config: IdealityConfig,
  id: string,
): IdealityConfig {
  requireIdentity(config, id);
  if (config.defaultIdentity === id) return config;
  const next = structuredClone(config);
  next.defaultIdentity = id;
  return next;
}

/** Stage an additional folder binding for an identity. */
export function bindFolder(
  config: IdealityConfig,
  id: string,
  root: string,
): IdealityConfig {
  requireIdentity(config, id);
  const trimmed = root.trim();
  if (!trimmed) {
    throw new ConfigMutationError("Folder path cannot be empty");
  }
  if (/[\0\r\n"]/.test(trimmed)) {
    throw new ConfigMutationError(
      "Folder paths cannot contain NUL, newlines, or quotes",
    );
  }
  if (config.identities[id]!.roots.includes(trimmed)) {
    throw new ConfigMutationError(
      `Folder '${trimmed}' is already bound to '${id}'`,
    );
  }
  const next = structuredClone(config);
  next.identities[id]!.roots.push(trimmed);
  return next;
}

/** Stage removal of a folder binding from an identity. */
export function unbindFolder(
  config: IdealityConfig,
  id: string,
  root: string,
): IdealityConfig {
  requireIdentity(config, id);
  const roots = config.identities[id]!.roots;
  const index = roots.indexOf(root);
  if (index === -1) {
    throw new ConfigMutationError(`Folder '${root}' is not bound to '${id}'`);
  }
  if (roots.length <= 1) {
    throw new ConfigMutationError(
      "Identities need at least one folder binding",
    );
  }
  const next = structuredClone(config);
  next.identities[id]!.roots.splice(index, 1);
  return next;
}

/** Stage tool enablement for an identity, creating the profile if needed. */
export function setToolEnabled(
  config: IdealityConfig,
  id: string,
  tool: string,
  enabled: boolean,
): IdealityConfig {
  requireIdentity(config, id);
  if (!config.tools[tool]) {
    throw new ConfigMutationError(`Tool '${tool}' has no definition`);
  }
  const next = structuredClone(config);
  const profile = next.identities[id]!.tools[tool] ?? {};
  profile.enabled = enabled;
  next.identities[id]!.tools[tool] = profile;
  return next;
}

/** Stage the identity-level network binding (null clears it). */
export function setIdentityNetwork(
  config: IdealityConfig,
  id: string,
  network: string | null,
): IdealityConfig {
  requireIdentity(config, id);
  if (network && !config.networks?.[network]) {
    throw new ConfigMutationError(
      `Network profile '${network}' does not exist`,
    );
  }
  const next = structuredClone(config);
  const identity = next.identities[id]!;
  const execution = identity.execution;
  if (execution?.target === "vm") {
    identity.execution = network
      ? { target: "vm", vm: execution.vm, network }
      : { target: "vm", vm: execution.vm };
  } else if (network) {
    identity.execution = { target: "host", network };
  } else {
    delete identity.execution;
  }
  return next;
}

/** Stage the identity-level VM target (null returns execution to the host). */
export function setIdentityVm(
  config: IdealityConfig,
  id: string,
  vm: string | null,
): IdealityConfig {
  requireIdentity(config, id);
  if (vm && !config.vms?.[vm]) {
    throw new ConfigMutationError(`VM profile '${vm}' does not exist`);
  }
  const next = structuredClone(config);
  const identity = next.identities[id]!;
  const network = identity.execution?.network;
  if (vm) {
    identity.execution = network
      ? { target: "vm", vm, network }
      : { target: "vm", vm };
  } else if (network) {
    identity.execution = { target: "host", network };
  } else {
    delete identity.execution;
  }
  return next;
}

/** Next choice when cycling through sorted profile IDs (ends on null). */
export function nextProfileChoice(
  ids: string[],
  current: string | null,
): string | null {
  const sorted = [...ids].sort();
  if (sorted.length === 0) return null;
  if (current === null) return sorted[0]!;
  const index = sorted.indexOf(current);
  if (index === -1 || index === sorted.length - 1) return null;
  return sorted[index + 1]!;
}

const VALUE_LIMIT = 64;

function renderValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > VALUE_LIMIT
    ? `${text.slice(0, VALUE_LIMIT - 3)}...`
    : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => deepEqual(a[key], b[key]))
    );
  }
  return false;
}

function walkDiff(
  before: unknown,
  after: unknown,
  path: string,
  out: ConfigDiffLine[],
): void {
  if (deepEqual(before, after)) return;
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort();
    for (const key of keys) {
      walkDiff(before[key], after[key], path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      walkDiff(before[index], after[index], `${path}[${index}]`, out);
    }
    return;
  }
  if (before === undefined) {
    out.push({ op: "add", path, before: null, after: renderValue(after) });
  } else if (after === undefined) {
    out.push({ op: "remove", path, before: renderValue(before), after: null });
  } else {
    out.push({
      op: "change",
      path,
      before: renderValue(before),
      after: renderValue(after),
    });
  }
}

/** Readable, redacted diff between two configs (secret literals masked). */
export function diffConfigs(
  before: IdealityConfig,
  after: IdealityConfig,
): ConfigDiffLine[] {
  const lines: ConfigDiffLine[] = [];
  walkDiff(redactConfig(before), redactConfig(after), "", lines);
  return lines;
}

/** One-line human-readable rendering of a diff entry. */
export function formatDiffLine(line: ConfigDiffLine): string {
  if (line.op === "add") return `+ ${line.path} = ${line.after}`;
  if (line.op === "remove") return `- ${line.path} (was ${line.before})`;
  return `~ ${line.path}: ${line.before} -> ${line.after}`;
}

function selectedIdentityId(state: TuiState): string {
  return state.draft.identities[state.selectedIdentity]
    ? state.selectedIdentity
    : state.draft.defaultIdentity;
}

function identityExecution(state: TuiState): ExecutionTarget | undefined {
  return state.draft.identities[selectedIdentityId(state)]?.execution;
}

function withStagedDraft(
  state: TuiState,
  stage: () => IdealityConfig,
  message: string,
): TuiState {
  try {
    const draft = stage();
    return { ...state, draft, status: { kind: "info", text: message } };
  } catch (error) {
    if (error instanceof ConfigMutationError) {
      return { ...state, status: { kind: "error", text: error.message } };
    }
    throw error;
  }
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, Math.max(0, max)));
}

/** Pure reducer driving every TUI screen and staged mutation. */
export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "select-identity": {
      if (!state.draft.identities[action.id]) return state;
      return {
        ...state,
        selectedIdentity: action.id,
        toolCursor: 0,
        rootCursor: 0,
      };
    }
    case "focus-next-pane": {
      const order: DashboardPane[] = ["identities", "tools", "roots"];
      const pane = order[(order.indexOf(state.pane) + 1) % order.length]!;
      return { ...state, pane };
    }
    case "move-cursor": {
      if (state.pane === "identities") {
        const ids = Object.keys(state.draft.identities);
        const index = clamp(
          ids.indexOf(selectedIdentityId(state)) + action.direction,
          ids.length - 1,
        );
        const id = ids[index];
        if (!id || id === state.selectedIdentity) return state;
        return { ...state, selectedIdentity: id, toolCursor: 0, rootCursor: 0 };
      }
      if (state.pane === "tools") {
        const max = toolNames(state.draft).length - 1;
        return {
          ...state,
          toolCursor: clamp(state.toolCursor + action.direction, max),
        };
      }
      if (state.pane === "roots") {
        const id = selectedIdentityId(state);
        const max = (state.draft.identities[id]?.roots.length ?? 1) - 1;
        return {
          ...state,
          rootCursor: clamp(state.rootCursor + action.direction, max),
        };
      }
      return state;
    }
    case "toggle-tool": {
      const tool = toolNames(state.draft)[state.toolCursor];
      if (!tool) {
        return {
          ...state,
          status: { kind: "error", text: "No tools are defined" },
        };
      }
      const id = selectedIdentityId(state);
      const enable = !isToolActive(state.draft, id, tool);
      return withStagedDraft(
        state,
        () => setToolEnabled(state.draft, id, tool, enable),
        `Staged: ${enable ? "enable" : "disable"} tool '${tool}' for '${id}'`,
      );
    }
    case "cycle-network": {
      const ids = Object.keys(state.draft.networks ?? {});
      if (ids.length === 0) {
        return {
          ...state,
          status: { kind: "error", text: "No network profiles configured" },
        };
      }
      const id = selectedIdentityId(state);
      const current = identityExecution(state)?.network ?? null;
      const next = nextProfileChoice(ids, current);
      return withStagedDraft(
        state,
        () => setIdentityNetwork(state.draft, id, next),
        next
          ? `Staged: route '${id}' through network '${next}'`
          : `Staged: clear network binding for '${id}'`,
      );
    }
    case "cycle-vm": {
      const ids = Object.keys(state.draft.vms ?? {});
      if (ids.length === 0) {
        return {
          ...state,
          status: { kind: "error", text: "No VM profiles configured" },
        };
      }
      const id = selectedIdentityId(state);
      const execution = identityExecution(state);
      const current = execution?.target === "vm" ? execution.vm : null;
      const next = nextProfileChoice(ids, current);
      return withStagedDraft(
        state,
        () => setIdentityVm(state.draft, id, next),
        next
          ? `Staged: execute '${id}' inside VM '${next}'`
          : `Staged: execute '${id}' on the host`,
      );
    }
    case "set-default-identity": {
      const id = selectedIdentityId(state);
      return withStagedDraft(
        state,
        () => setDefaultIdentity(state.draft, id),
        `Staged: make '${id}' the default identity`,
      );
    }
    case "open-bind-input":
      return { ...state, bindingFolder: true, status: null };
    case "close-bind-input":
      return { ...state, bindingFolder: false };
    case "bind-folder": {
      const id = selectedIdentityId(state);
      try {
        const draft = bindFolder(state.draft, id, action.root);
        return {
          ...state,
          draft,
          bindingFolder: false,
          status: {
            kind: "info",
            text: `Staged: bind '${action.root.trim()}' to '${id}'`,
          },
        };
      } catch (error) {
        if (error instanceof ConfigMutationError) {
          return { ...state, status: { kind: "error", text: error.message } };
        }
        throw error;
      }
    }
    case "unbind-folder": {
      const id = selectedIdentityId(state);
      const root = state.draft.identities[id]?.roots[state.rootCursor];
      if (!root) {
        return {
          ...state,
          status: { kind: "error", text: "No folder binding selected" },
        };
      }
      const next = withStagedDraft(
        state,
        () => unbindFolder(state.draft, id, root),
        `Staged: unbind '${root}' from '${id}'`,
      );
      const max = (next.draft.identities[id]?.roots.length ?? 1) - 1;
      return { ...next, rootCursor: clamp(next.rootCursor, max) };
    }
    case "discard-draft":
      return {
        ...state,
        draft: state.saved,
        screen: "dashboard",
        toolCursor: 0,
        rootCursor: 0,
        status: { kind: "info", text: "Discarded staged changes" },
      };
    case "open-screen": {
      const next: TuiState = { ...state, screen: action.screen, status: null };
      if (action.screen === "rollback") {
        next.rollback = {
          loaded: false,
          snapshots: [],
          cursor: 0,
          preview: null,
        };
      }
      return next;
    }
    case "save-succeeded":
      return {
        ...state,
        saved: action.config,
        draft: action.config,
        screen: "dashboard",
        status: {
          kind: "info",
          text: "Configuration saved (previous version kept in history)",
        },
      };
    case "save-failed":
      return { ...state, status: { kind: "error", text: action.error } };
    case "rollback-loaded":
      return {
        ...state,
        rollback: {
          loaded: true,
          snapshots: action.snapshots,
          cursor: 0,
          preview: null,
        },
      };
    case "rollback-move":
      return {
        ...state,
        rollback: {
          ...state.rollback,
          cursor: clamp(
            state.rollback.cursor + action.direction,
            state.rollback.snapshots.length - 1,
          ),
        },
      };
    case "rollback-previewed":
      return {
        ...state,
        rollback: {
          ...state.rollback,
          preview: {
            snapshot: action.snapshot,
            config: action.config,
            diff: diffConfigs(state.saved, action.config),
          },
        },
      };
    case "rollback-preview-closed":
      return { ...state, rollback: { ...state.rollback, preview: null } };
    case "rollback-applied": {
      const selected = action.config.identities[state.selectedIdentity]
        ? state.selectedIdentity
        : action.config.defaultIdentity;
      return {
        ...state,
        saved: action.config,
        draft: action.config,
        selectedIdentity: selected,
        toolCursor: 0,
        rootCursor: 0,
        screen: "dashboard",
        rollback: { loaded: false, snapshots: [], cursor: 0, preview: null },
        status: {
          kind: "info",
          text: `Restored snapshot ${action.snapshot}`,
        },
      };
    }
    case "rollback-failed":
      return { ...state, status: { kind: "error", text: action.error } };
    case "auth-loading":
      return {
        ...state,
        auth: { ...state.auth, phase: "loading" },
        status: null,
      };
    case "auth-loaded":
      return { ...state, auth: { phase: "ready", results: action.results } };
    case "auth-failed":
      return {
        ...state,
        auth: {
          ...state.auth,
          phase: state.auth.results.length > 0 ? "ready" : "idle",
        },
        status: { kind: "error", text: action.error },
      };
    case "policy-loading":
      return {
        ...state,
        policy: { ...state.policy, phase: "loading" },
        status: null,
      };
    case "policy-loaded":
      return { ...state, policy: { phase: "ready", result: action.result } };
    case "policy-failed":
      return {
        ...state,
        policy: {
          ...state.policy,
          phase: state.policy.result ? "ready" : "idle",
        },
        status: { kind: "error", text: action.error },
      };
    case "request-quit":
      return { ...state, confirmingQuit: true };
    case "cancel-quit":
      return { ...state, confirmingQuit: false };
    case "status":
      return { ...state, status: action.status };
  }
}
