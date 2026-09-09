import { tidyPath, tidyPathsIn } from "../commands/ui.js";
import type { DashboardModel } from "./model.js";
import {
  formatDiffLine,
  isToolActive,
  toolNames,
  type ConfigDiffLine,
  type TuiState,
} from "./state.js";
import { AUTH_STATE_COLORS, COLORS, DIFF_COLORS } from "./theme.js";

interface DashboardScreenProps {
  state: TuiState;
  model: DashboardModel;
}

export function DashboardScreen({ state, model }: DashboardScreenProps) {
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
                  >{`  ${tidyPathsIn(identity.description ?? "")}`}</span>
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
              }${tidyPath(root)}`}
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

export function DiffScreen({ lines }: { lines: ConfigDiffLine[] }) {
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

export function RollbackScreen({ state }: { state: TuiState }) {
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

export function AuthScreen({ state }: { state: TuiState }) {
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

export function PolicyScreen({ state }: { state: TuiState }) {
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
