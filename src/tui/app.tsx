import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useMemo, useReducer, useRef, useState } from "react";

import type { IdealityConfig } from "../domain/config.js";
import {
  MaskedSecretInput,
  PluginScreen,
  SecretScreen,
} from "./admin-screens.js";
import { tidyPath } from "../commands/ui.js";
import { HelpOverlay } from "./help-overlay.js";
import {
  AuthScreen,
  DashboardScreen,
  DiffScreen,
  PolicyScreen,
  RollbackScreen,
} from "./screens.js";
import { COLORS, KEY_HINTS } from "./theme.js";
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
import { buildDashboardModel } from "./model.js";
import {
  canApplyRollback,
  canRunPluginSideEffect,
  canRunSecretSideEffect,
  createTuiState,
  diffConfigs,
  tuiReducer,
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
    if (current.showingHelp) {
      if (name === "escape" || name === "q" || name === "?") {
        dispatch({ type: "toggle-help" });
      }
      return;
    }
    if (name === "?") {
      dispatch({ type: "toggle-help" });
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
            ? `${tidyPath(context.path, context.home)}   [${stagedDiff.length} staged]`
            : tidyPath(context.path, context.home)}
        </text>
      </box>

      {state.showingHelp ? (
        <HelpOverlay colors={COLORS} />
      ) : (
        <>
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
        </>
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
      <text fg={COLORS.faint}>
        {state.showingHelp ? "esc close  ? close" : KEY_HINTS[state.screen]}
      </text>
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
