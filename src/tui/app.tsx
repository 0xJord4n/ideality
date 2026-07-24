import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useMemo, useReducer, useRef, useState } from "react";

import type { AuthHealthState } from "../core/auth.js";
import type { IdealityConfig } from "../domain/config.js";
import {
  MaskedSecretInput,
  PluginScreen,
  SecretScreen,
} from "./admin-screens.js";
import {
  applyRollbackSnapshot,
  deleteTuiSecret,
  installPluginPath,
  loadPluginAdmin,
  loadRollbackSnapshots,
  loadSecretAdmin,
  loadPolicyStatus,
  previewRollbackSnapshot,
  probeAuthHealth,
  removeInstalledPlugin,
  saveDraftConfig,
  writeTuiSecret,
} from "./effects.js";
import { buildDashboardModel, type DashboardModel } from "./model.js";
import {
  canApplyRollback,
  canRunPluginSideEffect,
  canRunSecretSideEffect,
  createTuiState,
  diffConfigs,
  formatDiffLine,
  isToolActive,
  toolNames,
  tuiReducer,
  type ConfigDiffLine,
  type TuiAction,
  type TuiState,
} from "./state.js";

export type DashboardAction = "quit" | "edit" | "doctor";

export interface DashboardContext {
  config: IdealityConfig;
  activeIdentity: string;
  path: string;
  configPath: string;
  home: string;
  idealityHome: string;
}

const COLORS = {
  background: "#101418",
  panel: "#172026",
  border: "#34454f",
  accent: "#22d3ee",
  text: "#d7e0e5",
  dim: "#8da2ad",
  faint: "#70838d",
  green: "#4ade80",
  yellow: "#facc15",
  amber: "#fbbf24",
  red: "#f87171",
  selection: "#164e63",
} as const;

const AUTH_STATE_COLORS: Record<AuthHealthState, string> = {
  "logged-in": COLORS.green,
  expired: COLORS.red,
  unavailable: COLORS.amber,
  unsupported: COLORS.faint,
};

const DIFF_COLORS: Record<ConfigDiffLine["op"], string> = {
  add: COLORS.green,
  remove: COLORS.red,
  change: COLORS.yellow,
};

const KEY_HINTS: Record<TuiState["screen"], string> = {
  dashboard:
    "tab pane  space toggle  n net  v vm  m default  b bind  x unbind  s save  u undo  h history  a auth  p policy  g plugins  k secrets  e edit  d doctor  q quit",
  diff: "y save  c discard  esc back",
  rollback: "up/down select  enter preview  esc back",
  auth: "r probe again  esc back",
  policy: "r re-check  esc back",
  plugins: "up/down select  i install manifest  x remove  r refresh  esc back",
  secrets:
    "up/down select  b backend  n set secret  x delete  r refresh  esc back",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface TuiAppProps {
  context: DashboardContext;
  onExit: (action: DashboardAction) => void;
}

function TuiApp({ context, onExit }: TuiAppProps) {
  const [state, dispatch] = useReducer(
    tuiReducer,
    createTuiState(context.config, context.activeIdentity),
  );
  const [refresh, setRefresh] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const stagedDiff = useMemo(
    () => diffConfigs(state.saved, state.draft),
    [state.saved, state.draft],
  );
  const model = useMemo(
    () => buildDashboardModel(state.draft, state.selectedIdentity),
    [state.draft, state.selectedIdentity, refresh],
  );

  const runSave = () => {
    const draft = stateRef.current.draft;
    saveDraftConfig(draft, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then(() => dispatch({ type: "save-succeeded", config: draft }))
      .catch((error: unknown) =>
        dispatch({ type: "save-failed", error: errorText(error) }),
      );
  };

  const runLoadSnapshots = () => {
    loadRollbackSnapshots(context.configPath)
      .then((snapshots) => dispatch({ type: "rollback-loaded", snapshots }))
      .catch((error: unknown) =>
        dispatch({ type: "rollback-failed", error: errorText(error) }),
      );
  };

  const runPreviewSnapshot = (snapshot: string) => {
    previewRollbackSnapshot(snapshot, context.configPath)
      .then((preview) => dispatch({ type: "rollback-previewed", ...preview }))
      .catch((error: unknown) =>
        dispatch({ type: "rollback-failed", error: errorText(error) }),
      );
  };

  const runApplySnapshot = (snapshot: string) => {
    applyRollbackSnapshot(snapshot, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then((restored) => dispatch({ type: "rollback-applied", ...restored }))
      .catch((error: unknown) =>
        dispatch({ type: "rollback-failed", error: errorText(error) }),
      );
  };

  const runAuthProbe = () => {
    dispatch({ type: "auth-loading" });
    probeAuthHealth(stateRef.current.saved, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then((results) => dispatch({ type: "auth-loaded", results }))
      .catch((error: unknown) =>
        dispatch({ type: "auth-failed", error: errorText(error) }),
      );
  };

  const runPolicyCheck = () => {
    dispatch({ type: "policy-loading" });
    loadPolicyStatus(context.path)
      .then((result) => dispatch({ type: "policy-loaded", result }))
      .catch((error: unknown) =>
        dispatch({ type: "policy-failed", error: errorText(error) }),
      );
  };

  const runPluginLoad = () => {
    dispatch({ type: "plugins-loading" });
    loadPluginAdmin(context.idealityHome, stateRef.current.saved)
      .then((plugins) => dispatch({ type: "plugins-loaded", plugins }))
      .catch((error: unknown) =>
        dispatch({ type: "plugins-failed", error: errorText(error) }),
      );
  };

  const runPluginInstall = (manifestPath: string) => {
    const guard = canRunPluginSideEffect(stateRef.current);
    if (!guard.ok) {
      dispatch({
        type: "status",
        status: { kind: "error", text: guard.reason },
      });
      return;
    }
    installPluginPath(manifestPath, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then(({ config }) => {
        dispatch({ type: "plugin-installed", config });
        return loadPluginAdmin(context.idealityHome, config);
      })
      .then((plugins) => dispatch({ type: "plugins-loaded", plugins }))
      .catch((error: unknown) =>
        dispatch({ type: "plugins-failed", error: errorText(error) }),
      );
  };

  const runPluginRemove = (id: string) => {
    const guard = canRunPluginSideEffect(stateRef.current);
    if (!guard.ok) {
      dispatch({
        type: "status",
        status: { kind: "error", text: guard.reason },
      });
      return;
    }
    removeInstalledPlugin(id, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then(({ config }) => dispatch({ type: "plugin-removed", id, config }))
      .catch((error: unknown) =>
        dispatch({ type: "plugins-failed", error: errorText(error) }),
      );
  };

  const runSecretLoad = () => {
    const guard = canRunSecretSideEffect(stateRef.current);
    if (!guard.ok) {
      dispatch({
        type: "status",
        status: { kind: "error", text: guard.reason },
      });
      return;
    }
    dispatch({ type: "secrets-loading" });
    loadSecretAdmin(stateRef.current.saved, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then((secrets) => dispatch({ type: "secrets-loaded", secrets }))
      .catch((error: unknown) =>
        dispatch({ type: "secrets-failed", error: errorText(error) }),
      );
  };

  const runSecretWrite = (key: string, value: string) => {
    const guard = canRunSecretSideEffect(stateRef.current);
    if (!guard.ok) {
      dispatch({
        type: "status",
        status: { kind: "error", text: guard.reason },
      });
      return;
    }
    writeTuiSecret(key, value, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then(() => {
        dispatch({ type: "secret-written", key });
        return loadSecretAdmin(stateRef.current.saved, {
          home: context.home,
          idealityHome: context.idealityHome,
        });
      })
      .then((secrets) => dispatch({ type: "secrets-loaded", secrets }))
      .catch((error: unknown) =>
        dispatch({ type: "secrets-failed", error: errorText(error) }),
      );
  };

  const runSecretDelete = (key: string) => {
    const guard = canRunSecretSideEffect(stateRef.current);
    if (!guard.ok) {
      dispatch({
        type: "status",
        status: { kind: "error", text: guard.reason },
      });
      return;
    }
    deleteTuiSecret(key, context.configPath, {
      home: context.home,
      idealityHome: context.idealityHome,
    })
      .then(() => dispatch({ type: "secret-deleted", key }))
      .catch((error: unknown) =>
        dispatch({ type: "secrets-failed", error: errorText(error) }),
      );
  };

  const requireCleanDraft = (action: DashboardAction): void => {
    if (
      diffConfigs(stateRef.current.saved, stateRef.current.draft).length > 0
    ) {
      dispatch({
        type: "status",
        status: {
          kind: "error",
          text: "Save or discard staged changes first",
        },
      });
      return;
    }
    onExit(action);
  };

  const handleDashboardKey = (name: string): void => {
    const current = stateRef.current;
    if (name === "up" || name === "down") {
      dispatch({ type: "move-cursor", direction: name === "up" ? -1 : 1 });
    } else if (name === "tab") {
      dispatch({ type: "focus-next-pane" });
    } else if (name === "space" || name === "return") {
      if (current.pane === "tools") dispatch({ type: "toggle-tool" });
    } else if (name === "n") {
      dispatch({ type: "cycle-network" });
    } else if (name === "v") {
      dispatch({ type: "cycle-vm" });
    } else if (name === "m") {
      dispatch({ type: "set-default-identity" });
    } else if (name === "b") {
      dispatch({ type: "open-bind-input" });
    } else if (name === "x") {
      dispatch({ type: "unbind-folder" });
    } else if (name === "s") {
      dispatch({ type: "open-screen", screen: "diff" });
    } else if (name === "u") {
      dispatch({ type: "discard-draft" });
    } else if (name === "h") {
      dispatch({ type: "open-screen", screen: "rollback" });
      runLoadSnapshots();
    } else if (name === "a") {
      dispatch({ type: "open-screen", screen: "auth" });
      if (current.auth.phase === "idle") runAuthProbe();
    } else if (name === "p") {
      dispatch({ type: "open-screen", screen: "policy" });
      if (current.policy.phase === "idle") runPolicyCheck();
    } else if (name === "g") {
      dispatch({ type: "open-screen", screen: "plugins" });
      runPluginLoad();
    } else if (name === "k") {
      dispatch({ type: "open-screen", screen: "secrets" });
      runSecretLoad();
    } else if (name === "e") {
      requireCleanDraft("edit");
    } else if (name === "d") {
      requireCleanDraft("doctor");
    } else if (name === "r") {
      setRefresh((value) => value + 1);
    } else if (name === "q" || name === "escape") {
      if (diffConfigs(current.saved, current.draft).length > 0) {
        dispatch({ type: "request-quit" });
      } else {
        onExit("quit");
      }
    }
  };

  const handleDiffKey = (name: string): void => {
    const current = stateRef.current;
    if (name === "y") {
      if (diffConfigs(current.saved, current.draft).length > 0) runSave();
    } else if (name === "c") {
      dispatch({ type: "discard-draft" });
    } else if (name === "escape") {
      dispatch({ type: "open-screen", screen: "dashboard" });
    }
  };

  const handleRollbackKey = (name: string): void => {
    const current = stateRef.current;
    if (current.rollback.preview) {
      if (name === "y") {
        const guard = canApplyRollback(current);
        if (guard.ok) {
          runApplySnapshot(current.rollback.preview.snapshot);
        } else {
          dispatch({
            type: "status",
            status: { kind: "error", text: guard.reason },
          });
        }
      } else if (name === "escape") {
        dispatch({ type: "rollback-preview-closed" });
      }
      return;
    }
    if (name === "up" || name === "down") {
      dispatch({ type: "rollback-move", direction: name === "up" ? -1 : 1 });
    } else if (name === "return") {
      const snapshot = current.rollback.snapshots[current.rollback.cursor];
      if (snapshot) runPreviewSnapshot(snapshot);
    } else if (name === "escape") {
      dispatch({ type: "open-screen", screen: "dashboard" });
    }
  };

  const handlePluginsKey = (name: string): void => {
    const current = stateRef.current;
    if (current.plugins.pendingRemove) {
      if (name === "y") runPluginRemove(current.plugins.pendingRemove);
      else if (name === "escape" || name === "n") {
        dispatch({ type: "plugin-remove-cancelled" });
      }
      return;
    }
    if (name === "up" || name === "down") {
      dispatch({ type: "plugin-move", direction: name === "up" ? -1 : 1 });
    } else if (name === "i") {
      dispatch({ type: "open-admin-input", input: { kind: "plugin-path" } });
    } else if (name === "x") {
      dispatch({ type: "plugin-remove-requested" });
    } else if (name === "r") {
      runPluginLoad();
    } else if (name === "escape") {
      dispatch({ type: "open-screen", screen: "dashboard" });
    }
  };

  const handleSecretsKey = (name: string): void => {
    const current = stateRef.current;
    if (current.secrets.pendingDelete) {
      if (name === "y") runSecretDelete(current.secrets.pendingDelete);
      else if (name === "escape" || name === "n") {
        dispatch({ type: "secret-delete-cancelled" });
      }
      return;
    }
    if (name === "up" || name === "down") {
      dispatch({ type: "secret-move", direction: name === "up" ? -1 : 1 });
    } else if (name === "b") {
      dispatch({
        type: "open-admin-input",
        input: { kind: "secret-backend" },
      });
    } else if (name === "n") {
      const guard = canRunSecretSideEffect(current);
      if (!guard.ok) {
        dispatch({
          type: "status",
          status: { kind: "error", text: guard.reason },
        });
        return;
      }
      if (!current.secrets.summary?.writable) {
        dispatch({
          type: "status",
          status: {
            kind: "error",
            text: "Selected secret backend is read-only",
          },
        });
      } else {
        dispatch({ type: "open-admin-input", input: { kind: "secret-key" } });
      }
    } else if (name === "x") {
      const guard = canRunSecretSideEffect(current);
      if (!guard.ok) {
        dispatch({
          type: "status",
          status: { kind: "error", text: guard.reason },
        });
        return;
      }
      dispatch({ type: "secret-delete-requested" });
    } else if (name === "r") {
      runSecretLoad();
    } else if (name === "escape") {
      dispatch({ type: "open-screen", screen: "dashboard" });
    }
  };

  useKeyboard((key) => {
    const current = stateRef.current;
    const name = key.name;
    if (current.bindingFolder) {
      if (name === "escape") dispatch({ type: "close-bind-input" });
      return;
    }
    if (current.adminInput) {
      if (name === "escape") dispatch({ type: "close-admin-input" });
      return;
    }
    if (current.confirmingQuit) {
      if (name === "y") onExit("quit");
      else if (name === "escape" || name === "n") {
        dispatch({ type: "cancel-quit" });
      }
      return;
    }
    if (current.screen === "dashboard") handleDashboardKey(name);
    else if (current.screen === "diff") handleDiffKey(name);
    else if (current.screen === "rollback") handleRollbackKey(name);
    else if (current.screen === "auth") {
      if (name === "r") runAuthProbe();
      else if (name === "escape") {
        dispatch({ type: "open-screen", screen: "dashboard" });
      }
    } else if (current.screen === "policy") {
      if (name === "r") runPolicyCheck();
      else if (name === "escape") {
        dispatch({ type: "open-screen", screen: "dashboard" });
      }
    } else if (current.screen === "plugins") {
      handlePluginsKey(name);
    } else if (current.screen === "secrets") {
      handleSecretsKey(name);
    }
  });

  const handleAdminInputSubmit = (value: string): void => {
    const input = stateRef.current.adminInput;
    if (!input) return;
    if (input.kind === "plugin-path") {
      dispatch({ type: "close-admin-input" });
      runPluginInstall(value);
      return;
    }
    if (input.kind === "secret-value") {
      dispatch({ type: "close-admin-input" });
      runSecretWrite(input.key, value);
      return;
    }
    dispatch({ type: "submit-admin-input", value });
  };

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: COLORS.background,
      }}
    >
      <box
        style={{
          height: 3,
          paddingX: 1,
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: COLORS.panel,
        }}
      >
        <text fg={COLORS.accent}>IDEALITY</text>
        <text fg={stagedDiff.length > 0 ? COLORS.yellow : COLORS.dim}>
          {stagedDiff.length > 0
            ? `${context.path}   [${stagedDiff.length} staged]`
            : context.path}
        </text>
      </box>

      {state.screen === "dashboard" && (
        <DashboardScreen state={state} model={model} />
      )}
      {state.screen === "diff" && <DiffScreen lines={stagedDiff} />}
      {state.screen === "rollback" && <RollbackScreen state={state} />}
      {state.screen === "auth" && <AuthScreen state={state} />}
      {state.screen === "policy" && <PolicyScreen state={state} />}
      {state.screen === "plugins" && (
        <PluginScreen state={state} colors={COLORS} />
      )}
      {state.screen === "secrets" && (
        <SecretScreen state={state} colors={COLORS} />
      )}

      <Footer
        state={state}
        stagedCount={stagedDiff.length}
        dispatch={dispatch}
        onAdminInputSubmit={handleAdminInputSubmit}
      />
    </box>
  );
}

interface DashboardScreenProps {
  state: TuiState;
  model: DashboardModel;
}

function DashboardScreen({ state, model }: DashboardScreenProps) {
  const names = toolNames(state.draft);
  return (
    <box style={{ flexGrow: 1, flexDirection: "row", padding: 1, gap: 1 }}>
      <box style={{ width: "34%", flexDirection: "column", gap: 1 }}>
        <box
          title="Identities"
          style={{
            flexGrow: 1,
            border: true,
            borderColor:
              state.pane === "identities" ? COLORS.accent : COLORS.border,
            padding: 1,
          }}
        >
          <scrollbox focused={false} style={{ flexGrow: 1 }}>
            {model.identities.map((identity) => {
              const selected = identity.value === model.selected.id;
              return (
                <text
                  key={String(identity.value)}
                  fg={
                    selected
                      ? state.pane === "identities"
                        ? COLORS.accent
                        : "#f8fafc"
                      : COLORS.text
                  }
                >
                  {`${selected ? "> " : "  "}${identity.name}`}
                  <span
                    fg={COLORS.faint}
                  >{`  ${identity.description ?? ""}`}</span>
                </text>
              );
            })}
          </scrollbox>
        </box>
        <box
          title="Folders"
          style={{
            height: 8,
            border: true,
            borderColor: state.pane === "roots" ? COLORS.accent : COLORS.border,
            padding: 1,
            flexDirection: "column",
          }}
        >
          {model.selected.roots.map((root, index) => (
            <text
              key={root}
              fg={
                state.pane === "roots" && index === state.rootCursor
                  ? COLORS.accent
                  : COLORS.text
              }
            >
              {`${
                state.pane === "roots" && index === state.rootCursor
                  ? "> "
                  : "  "
              }${root}`}
            </text>
          ))}
        </box>
      </box>

      <box
        title={`${model.selected.label} / ${model.selected.id}`}
        style={{
          flexGrow: 1,
          border: true,
          borderColor: model.selected.color,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
        <text fg={model.selected.color}>
          {model.selected.isDefault ? "DEFAULT IDENTITY" : "FOLDER IDENTITY"}
        </text>
        <text fg={COLORS.text}>
          Git:{" "}
          {model.selected.git
            ? `${model.selected.git.name} <${model.selected.git.email}>`
            : "not configured"}
        </text>
        <text fg={COLORS.text}>
          SSH: {model.selected.git?.sshKey ?? "SSH agent default"}
        </text>
        <text fg={COLORS.text}>
          Target: {model.selected.execution.target}
          {model.selected.execution.vm
            ? ` / ${model.selected.execution.vm}`
            : ""}
          {model.selected.execution.network
            ? ` / VPN ${model.selected.execution.network}`
            : ""}
        </text>
        <text fg={state.pane === "tools" ? COLORS.accent : COLORS.yellow}>
          TOOLS
        </text>
        <scrollbox focused={false} style={{ flexGrow: 1 }}>
          {model.selected.tools.map((tool, index) => {
            const active = isToolActive(
              state.draft,
              model.selected.id,
              tool.name,
            );
            const staged =
              active !==
              isToolActive(state.saved, model.selected.id, tool.name);
            const cursor =
              state.pane === "tools" &&
              index === state.toolCursor &&
              names[state.toolCursor] === tool.name;
            return (
              <text
                key={tool.name}
                fg={
                  cursor
                    ? COLORS.accent
                    : !tool.configured
                      ? COLORS.faint
                      : !active
                        ? COLORS.faint
                        : tool.installed
                          ? COLORS.green
                          : COLORS.amber
                }
              >
                {`${cursor ? ">" : " "}[${active ? "x" : " "}]${
                  staged ? "*" : " "
                }${tool.name.padEnd(11)} ${tool.isolation.padEnd(7)} ${
                  tool.installed ? "ready  " : "missing"
                } ${tool.target}${tool.vm ? `:${tool.vm}` : ""}${
                  tool.network ? ` vpn:${tool.network}` : ""
                } env:${tool.variables} args:${tool.arguments}`}
              </text>
            );
          })}
        </scrollbox>
      </box>
    </box>
  );
}

function DiffScreen({ lines }: { lines: ConfigDiffLine[] }) {
  return (
    <box
      title="Staged changes"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: COLORS.border,
        padding: 1,
        flexDirection: "column",
      }}
    >
      {lines.length === 0 ? (
        <text fg={COLORS.dim}>No staged changes.</text>
      ) : (
        <scrollbox focused={false} style={{ flexGrow: 1 }}>
          {lines.map((line) => (
            <text key={`${line.op}:${line.path}`} fg={DIFF_COLORS[line.op]}>
              {formatDiffLine(line)}
            </text>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function RollbackScreen({ state }: { state: TuiState }) {
  const { rollback } = state;
  if (rollback.preview) {
    return (
      <box
        title={`Rollback preview: ${rollback.preview.snapshot}`}
        style={{
          flexGrow: 1,
          margin: 1,
          border: true,
          borderColor: COLORS.border,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
        <text fg={COLORS.dim}>
          Applying restores the saved config below (a snapshot of the current
          config is kept first).
        </text>
        {rollback.preview.diff.length === 0 ? (
          <text fg={COLORS.dim}>Snapshot matches the current config.</text>
        ) : (
          <scrollbox focused={false} style={{ flexGrow: 1 }}>
            {rollback.preview.diff.map((line) => (
              <text key={`${line.op}:${line.path}`} fg={DIFF_COLORS[line.op]}>
                {formatDiffLine(line)}
              </text>
            ))}
          </scrollbox>
        )}
      </box>
    );
  }
  return (
    <box
      title="Rollback history (newest first)"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: COLORS.border,
        padding: 1,
        flexDirection: "column",
      }}
    >
      {!rollback.loaded ? (
        <text fg={COLORS.dim}>Loading history...</text>
      ) : rollback.snapshots.length === 0 ? (
        <text fg={COLORS.dim}>No snapshots yet.</text>
      ) : (
        <scrollbox focused={false} style={{ flexGrow: 1 }}>
          {rollback.snapshots.map((snapshot, index) => (
            <text
              key={snapshot}
              fg={index === rollback.cursor ? COLORS.accent : COLORS.text}
            >
              {`${index === rollback.cursor ? "> " : "  "}${snapshot}`}
            </text>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function AuthScreen({ state }: { state: TuiState }) {
  const { auth } = state;
  return (
    <box
      title="Auth health (redacted)"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: COLORS.border,
        padding: 1,
        flexDirection: "column",
      }}
    >
      {auth.phase === "loading" ? (
        <text fg={COLORS.dim}>Probing auth status for every identity...</text>
      ) : auth.results.length === 0 ? (
        <text fg={COLORS.dim}>
          No results yet. Press r to probe every identity/tool pairing.
        </text>
      ) : (
        <scrollbox focused={false} style={{ flexGrow: 1 }}>
          {auth.results.map((result) => (
            <text
              key={`${result.identity}/${result.tool}`}
              fg={AUTH_STATE_COLORS[result.state]}
            >
              {`${result.identity.padEnd(12)} ${result.tool.padEnd(
                10,
              )} ${result.state.padEnd(12)} ${result.detail}`}
            </text>
          ))}
        </scrollbox>
      )}
    </box>
  );
}

function PolicyScreen({ state }: { state: TuiState }) {
  const { policy } = state;
  const result = policy.result;
  return (
    <box
      title="Team policy"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: COLORS.border,
        padding: 1,
        flexDirection: "column",
        gap: 1,
      }}
    >
      {policy.phase === "loading" || !result ? (
        <text fg={COLORS.dim}>Checking the team policy...</text>
      ) : (
        <>
          <text fg={result.status === "pass" ? COLORS.green : COLORS.red}>
            {`${result.status.toUpperCase()}  ${
              result.policy
                ? `policy v${result.policy.version}${
                    result.policy.label ? ` (${result.policy.label})` : ""
                  }`
                : "no policy loaded"
            }`}
          </text>
          <text fg={COLORS.dim}>{result.policyPath}</text>
          {result.findings.length === 0 ? (
            <text fg={COLORS.green}>All policy checks passed.</text>
          ) : (
            <scrollbox focused={false} style={{ flexGrow: 1 }}>
              {result.findings.map((finding) => (
                <text
                  key={`${finding.code}:${finding.subject}:${finding.message}`}
                  fg={COLORS.amber}
                >
                  {`${finding.code.padEnd(28)} ${finding.subject}: ${finding.message}`}
                </text>
              ))}
            </scrollbox>
          )}
        </>
      )}
    </box>
  );
}

interface FooterProps {
  state: TuiState;
  stagedCount: number;
  dispatch: (action: TuiAction) => void;
  onAdminInputSubmit: (value: string) => void;
}

function Footer({
  state,
  stagedCount,
  dispatch,
  onAdminInputSubmit,
}: FooterProps) {
  const adminInput = state.adminInput;
  return (
    <box
      style={{
        height: 3,
        paddingX: 1,
        flexDirection: "column",
        backgroundColor: COLORS.panel,
      }}
    >
      {adminInput?.kind === "secret-value" ? (
        <MaskedSecretInput
          label={`Value for ${adminInput.key}:`}
          colors={COLORS}
          onSubmit={onAdminInputSubmit}
        />
      ) : adminInput ? (
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text fg={COLORS.accent}>
            {adminInput.kind === "plugin-path"
              ? "Manifest path:"
              : adminInput.kind === "secret-backend"
                ? "Backend:"
                : "Secret key:"}
          </text>
          <input
            focused
            placeholder={
              adminInput.kind === "plugin-path"
                ? "/path/to/plugin.jsonc"
                : adminInput.kind === "secret-backend"
                  ? "file [directory] | age recipient identityFile [directory] | pass [prefix]"
                  : "identity/tool-token"
            }
            onSubmit={(value) => {
              if (typeof value === "string") onAdminInputSubmit(value);
            }}
            style={{ flexGrow: 1 }}
          />
        </box>
      ) : state.bindingFolder ? (
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text fg={COLORS.accent}>Bind folder:</text>
          <input
            focused
            placeholder="~/code/project (enter to stage, esc to cancel)"
            onSubmit={(value) => {
              if (typeof value === "string") {
                dispatch({ type: "bind-folder", root: value });
              }
            }}
            style={{ flexGrow: 1 }}
          />
        </box>
      ) : state.confirmingQuit ? (
        <text fg={COLORS.red}>
          {`Discard ${stagedCount} staged change${
            stagedCount === 1 ? "" : "s"
          } and quit? y / esc`}
        </text>
      ) : state.status ? (
        <text fg={state.status.kind === "error" ? COLORS.red : COLORS.green}>
          {state.status.text}
        </text>
      ) : (
        <text fg={COLORS.dim}>
          {stagedCount > 0
            ? `${stagedCount} staged change${stagedCount === 1 ? "" : "s"} - press s to review and save`
            : "No staged changes"}
        </text>
      )}
      <text fg={COLORS.faint}>{KEY_HINTS[state.screen]}</text>
    </box>
  );
}

/** Run the interactive dashboard until the user exits. */
export async function runDashboard(
  context: DashboardContext,
): Promise<DashboardAction> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  return new Promise<DashboardAction>((resolve) => {
    let done = false;
    const finish = (action: DashboardAction) => {
      if (done) {
        return;
      }
      done = true;
      renderer.destroy();
      resolve(action);
    };
    createRoot(renderer).render(<TuiApp context={context} onExit={finish} />);
  });
}
