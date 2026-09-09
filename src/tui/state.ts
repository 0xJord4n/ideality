import type { AuthHealthResult } from "../core/auth.js";
import type { PolicyCheckResult } from "../core/policy.js";
import type {
  ExecutionTarget,
  IdealityConfig,
  SecretBackendConfig,
} from "../domain/config.js";
import { deepEqual, diffConfigs, type ConfigDiffLine } from "./diff.js";

export { diffConfigs, formatDiffLine, type ConfigDiffLine } from "./diff.js";

/** Raised by staged-mutation helpers when a change would be invalid. */
export class ConfigMutationError extends Error {}

export type TuiScreen =
  | "dashboard"
  | "diff"
  | "rollback"
  | "auth"
  | "policy"
  | "plugins"
  | "secrets";
export type DashboardPane = "identities" | "tools" | "roots";

export interface TuiStatus {
  kind: "info" | "error";
  text: string;
}

export interface RollbackPreview {
  snapshot: string;
  config: IdealityConfig;
  diff: ConfigDiffLine[];
}

export interface PluginAdminEntry {
  id: string;
  displayName: string;
  description: string | null;
  executable: string;
  file: string;
  active: boolean;
  profileCount: number;
  env: string[];
  args: number;
}

export interface SecretAdminSummary {
  backend: SecretBackendConfig["type"];
  supported: boolean;
  writable: boolean;
  references: string[];
}

export type AdminInput =
  | { kind: "plugin-path" }
  | { kind: "secret-backend" }
  | { kind: "secret-key" }
  | { kind: "secret-value"; key: string };

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
  showingHelp: boolean;
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
  plugins: {
    phase: "idle" | "loading" | "ready";
    entries: PluginAdminEntry[];
    cursor: number;
    pendingRemove: string | null;
  };
  secrets: {
    phase: "idle" | "loading" | "ready";
    summary: SecretAdminSummary | null;
    cursor: number;
    pendingDelete: string | null;
  };
  adminInput: AdminInput | null;
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
  | { type: "plugins-loading" }
  | { type: "plugins-loaded"; plugins: PluginAdminEntry[] }
  | { type: "plugins-failed"; error: string }
  | { type: "plugin-move"; direction: 1 | -1 }
  | { type: "plugin-remove-requested" }
  | { type: "plugin-remove-cancelled" }
  | { type: "plugin-removed"; id: string; config: IdealityConfig }
  | { type: "plugin-installed"; config: IdealityConfig }
  | { type: "secrets-loading" }
  | { type: "secrets-loaded"; secrets: SecretAdminSummary }
  | { type: "secrets-failed"; error: string }
  | { type: "secret-move"; direction: 1 | -1 }
  | { type: "secret-delete-requested" }
  | { type: "secret-delete-cancelled" }
  | { type: "secret-deleted"; key: string }
  | { type: "secret-written"; key: string }
  | { type: "open-admin-input"; input: AdminInput }
  | { type: "close-admin-input" }
  | { type: "submit-admin-input"; value: string }
  | { type: "request-quit" }
  | { type: "cancel-quit" }
  | { type: "toggle-help" }
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
    showingHelp: false,
    status: null,
    rollback: { loaded: false, snapshots: [], cursor: 0, preview: null },
    auth: { phase: "idle", results: [] },
    policy: { phase: "idle", result: null },
    plugins: {
      phase: "idle",
      entries: [],
      cursor: 0,
      pendingRemove: null,
    },
    secrets: {
      phase: "idle",
      summary: null,
      cursor: 0,
      pendingDelete: null,
    },
    adminInput: null,
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

type SideEffectGuard = { ok: true } | { ok: false; reason: string };

const DEFAULT_SECRET_BACKEND: SecretBackendConfig = { type: "file" };

function activeSecretBackend(config: IdealityConfig): SecretBackendConfig {
  return config.secretBackend ?? DEFAULT_SECRET_BACKEND;
}

/** Guard for plugin install/remove effects, which persist config immediately. */
export function canRunPluginSideEffect(state: TuiState): SideEffectGuard {
  if (isDirty(state)) {
    return {
      ok: false,
      reason:
        "Save or discard staged changes before installing or removing plugins",
    };
  }
  return { ok: true };
}

/** Guard for secret effects that would otherwise use the saved backend. */
export function canRunSecretSideEffect(state: TuiState): SideEffectGuard {
  if (
    !deepEqual(
      activeSecretBackend(state.saved),
      activeSecretBackend(state.draft),
    )
  ) {
    return {
      ok: false,
      reason:
        "Save or discard staged secret backend changes before listing or editing secrets",
    };
  }
  return { ok: true };
}

/** Guard for applying a rollback snapshot. */
export function canApplyRollback(state: TuiState): SideEffectGuard {
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

/** Stage the selected secret backend settings. */
export function setSecretBackend(
  config: IdealityConfig,
  backend: SecretBackendConfig,
): IdealityConfig {
  const next = structuredClone(config);
  next.secretBackend = backend;
  return next;
}

/** Parse the compact TUI backend editor input into a backend config. */
export function parseSecretBackendInput(input: string): SecretBackendConfig {
  const [type, ...parts] = input.trim().split(/\s+/).filter(Boolean);
  if (!type) throw new ConfigMutationError("Secret backend type is required");
  if (type === "file") {
    return { type, ...(parts[0] ? { directory: parts[0] } : {}) };
  }
  if (type === "age") {
    const [recipient, identityFile, directory] = parts;
    if (!recipient || !identityFile) {
      throw new ConfigMutationError(
        "age backend requires recipient and identity file",
      );
    }
    return {
      type,
      recipient,
      identityFile,
      ...(directory ? { directory } : {}),
    };
  }
  if (type === "keychain") {
    return { type, ...(parts[0] ? { service: parts[0] } : {}) };
  }
  if (type === "pass") {
    return { type, ...(parts[0] ? { prefix: parts[0] } : {}) };
  }
  if (type === "onepassword") return { type };
  if (type === "bitwarden") {
    return { type, ...(parts[0] ? { appDataDirectory: parts[0] } : {}) };
  }
  if (type === "dashlane") return { type };
  throw new ConfigMutationError(`Unknown secret backend '${type}'`);
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
      return { ...state, bindingFolder: true, adminInput: null, status: null };
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
    case "toggle-help":
      return { ...state, showingHelp: !state.showingHelp, status: null };
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
      const next: TuiState = {
        ...state,
        screen: action.screen,
        status: null,
        adminInput: null,
      };
      if (action.screen === "rollback") {
        next.rollback = {
          loaded: false,
          snapshots: [],
          cursor: 0,
          preview: null,
        };
      }
      if (action.screen === "plugins") {
        next.plugins = {
          phase: "idle",
          entries: [],
          cursor: 0,
          pendingRemove: null,
        };
      }
      if (action.screen === "secrets") {
        next.secrets = {
          phase: "idle",
          summary: null,
          cursor: 0,
          pendingDelete: null,
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
    case "plugins-loading":
      return {
        ...state,
        plugins: { ...state.plugins, phase: "loading", pendingRemove: null },
        status: null,
      };
    case "plugins-loaded":
      return {
        ...state,
        plugins: {
          phase: "ready",
          entries: action.plugins,
          cursor: clamp(state.plugins.cursor, action.plugins.length - 1),
          pendingRemove: null,
        },
      };
    case "plugins-failed":
      return {
        ...state,
        plugins: {
          ...state.plugins,
          phase: state.plugins.entries.length > 0 ? "ready" : "idle",
        },
        status: { kind: "error", text: action.error },
      };
    case "plugin-move":
      return {
        ...state,
        plugins: {
          ...state.plugins,
          cursor: clamp(
            state.plugins.cursor + action.direction,
            state.plugins.entries.length - 1,
          ),
          pendingRemove: null,
        },
      };
    case "plugin-remove-requested": {
      const plugin = state.plugins.entries[state.plugins.cursor];
      if (!plugin) {
        return {
          ...state,
          status: { kind: "error", text: "No plugin selected" },
        };
      }
      return {
        ...state,
        plugins: { ...state.plugins, pendingRemove: plugin.id },
        status: null,
      };
    }
    case "plugin-remove-cancelled":
      return {
        ...state,
        plugins: { ...state.plugins, pendingRemove: null },
      };
    case "plugin-removed":
      return {
        ...state,
        saved: action.config,
        draft: action.config,
        plugins: {
          ...state.plugins,
          entries: state.plugins.entries.filter(
            (entry) => entry.id !== action.id,
          ),
          cursor: clamp(state.plugins.cursor, state.plugins.entries.length - 2),
          pendingRemove: null,
        },
        status: { kind: "info", text: `Removed plugin '${action.id}'` },
      };
    case "plugin-installed":
      return {
        ...state,
        saved: action.config,
        draft: action.config,
        adminInput: null,
        status: { kind: "info", text: "Plugin installed" },
      };
    case "secrets-loading":
      return {
        ...state,
        secrets: { ...state.secrets, phase: "loading", pendingDelete: null },
        status: null,
      };
    case "secrets-loaded":
      return {
        ...state,
        secrets: {
          phase: "ready",
          summary: action.secrets,
          cursor: clamp(
            state.secrets.cursor,
            action.secrets.references.length - 1,
          ),
          pendingDelete: null,
        },
      };
    case "secrets-failed":
      return {
        ...state,
        secrets: {
          ...state.secrets,
          phase: state.secrets.summary ? "ready" : "idle",
        },
        status: { kind: "error", text: action.error },
      };
    case "secret-move": {
      const count = state.secrets.summary?.references.length ?? 0;
      return {
        ...state,
        secrets: {
          ...state.secrets,
          cursor: clamp(state.secrets.cursor + action.direction, count - 1),
          pendingDelete: null,
        },
      };
    }
    case "secret-delete-requested": {
      if (!state.secrets.summary?.writable) {
        return {
          ...state,
          status: {
            kind: "error",
            text: "Selected secret backend is read-only",
          },
        };
      }
      const key = state.secrets.summary.references[state.secrets.cursor];
      if (!key) {
        return {
          ...state,
          status: { kind: "error", text: "No secret reference selected" },
        };
      }
      return {
        ...state,
        secrets: { ...state.secrets, pendingDelete: key },
        status: null,
      };
    }
    case "secret-delete-cancelled":
      return {
        ...state,
        secrets: { ...state.secrets, pendingDelete: null },
      };
    case "secret-deleted": {
      const summary = state.secrets.summary
        ? {
            ...state.secrets.summary,
            references: state.secrets.summary.references.filter(
              (key) => key !== action.key,
            ),
          }
        : null;
      return {
        ...state,
        secrets: {
          ...state.secrets,
          summary,
          cursor: clamp(
            state.secrets.cursor,
            (summary?.references.length ?? 0) - 1,
          ),
          pendingDelete: null,
        },
        status: { kind: "info", text: `Deleted secret '${action.key}'` },
      };
    }
    case "secret-written":
      return {
        ...state,
        adminInput: null,
        status: { kind: "info", text: `Stored secret '${action.key}'` },
      };
    case "open-admin-input":
      return {
        ...state,
        bindingFolder: false,
        adminInput: action.input,
        status: null,
      };
    case "close-admin-input":
      return { ...state, adminInput: null };
    case "submit-admin-input": {
      const input = state.adminInput;
      if (!input) return state;
      if (input.kind === "secret-backend") {
        return withStagedDraft(
          { ...state, adminInput: null },
          () =>
            setSecretBackend(
              state.draft,
              parseSecretBackendInput(action.value),
            ),
          `Staged: secret backend ${action.value.trim().split(/\s+/)[0] ?? ""}`,
        );
      }
      if (input.kind === "secret-key") {
        const key = action.value.trim();
        if (!key) {
          return {
            ...state,
            status: { kind: "error", text: "Secret key cannot be empty" },
          };
        }
        return { ...state, adminInput: { kind: "secret-value", key } };
      }
      if (input.kind === "plugin-path") {
        return { ...state, adminInput: null };
      }
      return {
        ...state,
        status: {
          kind: "error",
          text: "Secret values are handled outside reducer state",
        },
      };
    }
    case "request-quit":
      return { ...state, confirmingQuit: true };
    case "cancel-quit":
      return { ...state, confirmingQuit: false };
    case "status":
      return { ...state, status: action.status };
  }
}
