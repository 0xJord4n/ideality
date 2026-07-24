import { useKeyboard } from "@opentui/react";
import { useState } from "react";

import type { TuiState } from "./state.js";

interface TuiColors {
  accent: string;
  amber: string;
  border: string;
  dim: string;
  green: string;
  red: string;
  text: string;
  yellow: string;
}

export function PluginScreen({
  state,
  colors,
}: {
  state: TuiState;
  colors: TuiColors;
}) {
  const { plugins } = state;
  const selected = plugins.entries[plugins.cursor];
  return (
    <box style={{ flexGrow: 1, flexDirection: "row", margin: 1, gap: 1 }}>
      <box
        title="Plugins"
        style={{
          width: "38%",
          border: true,
          borderColor: colors.border,
          padding: 1,
          flexDirection: "column",
        }}
      >
        {plugins.phase === "loading" ? (
          <text fg={colors.dim}>Loading installed plugin manifests...</text>
        ) : plugins.entries.length === 0 ? (
          <text fg={colors.dim}>No installed plugins.</text>
        ) : (
          <scrollbox focused={false} style={{ flexGrow: 1 }}>
            {plugins.entries.map((plugin, index) => (
              <text
                key={plugin.id}
                fg={index === plugins.cursor ? colors.accent : colors.text}
              >
                {`${index === plugins.cursor ? "> " : "  "}${plugin.id.padEnd(
                  14,
                )} ${plugin.active ? "active" : "detached"}`}
              </text>
            ))}
          </scrollbox>
        )}
      </box>
      <box
        title="Manifest metadata (redacted)"
        style={{
          flexGrow: 1,
          border: true,
          borderColor: colors.border,
          padding: 1,
          flexDirection: "column",
          gap: 1,
        }}
      >
        {selected ? (
          <>
            <text fg={colors.accent}>{selected.displayName}</text>
            <text fg={colors.text}>ID: {selected.id}</text>
            <text fg={colors.text}>Executable: {selected.executable}</text>
            <text fg={colors.text}>
              Profiles: {selected.profileCount} Args: {selected.args}
            </text>
            <text fg={colors.dim}>
              {selected.description ?? "No description"}
            </text>
            <text fg={colors.dim}>{selected.file}</text>
            <text fg={colors.yellow}>Environment</text>
            {selected.env.length === 0 ? (
              <text fg={colors.dim}>No default environment entries.</text>
            ) : (
              selected.env.map((entry) => (
                <text key={entry} fg={colors.text}>
                  {entry}
                </text>
              ))
            )}
            {plugins.pendingRemove ? (
              <text fg={colors.red}>
                {`Remove '${plugins.pendingRemove}' and refresh shims/completions? y / esc`}
              </text>
            ) : null}
          </>
        ) : (
          <text fg={colors.dim}>
            Install a local manifest with i, then enter its path.
          </text>
        )}
      </box>
    </box>
  );
}

export function SecretScreen({
  state,
  colors,
}: {
  state: TuiState;
  colors: TuiColors;
}) {
  const { secrets } = state;
  const summary = secrets.summary;
  const references = summary?.references ?? [];
  return (
    <box
      title="Secrets"
      style={{
        flexGrow: 1,
        margin: 1,
        border: true,
        borderColor: colors.border,
        padding: 1,
        flexDirection: "column",
        gap: 1,
      }}
    >
      {secrets.phase === "loading" || !summary ? (
        <text fg={colors.dim}>Loading secret backend references...</text>
      ) : (
        <>
          <text fg={summary.writable ? colors.green : colors.amber}>
            {`Backend: ${summary.backend}  ${
              summary.writable ? "writable" : "read-only"
            }  ${summary.supported ? "listable" : "not listable"}`}
          </text>
          {!summary.supported ? (
            <text fg={colors.dim}>
              This backend does not expose a safe value-free listing API here.
            </text>
          ) : references.length === 0 ? (
            <text fg={colors.dim}>No stored logical references found.</text>
          ) : (
            <scrollbox focused={false} style={{ flexGrow: 1 }}>
              {references.map((reference, index) => (
                <text
                  key={reference}
                  fg={index === secrets.cursor ? colors.accent : colors.text}
                >
                  {`${index === secrets.cursor ? "> " : "  "}${reference}`}
                </text>
              ))}
            </scrollbox>
          )}
          {secrets.pendingDelete ? (
            <text fg={colors.red}>
              {`Delete secret reference '${secrets.pendingDelete}'? y / esc`}
            </text>
          ) : null}
        </>
      )}
    </box>
  );
}

function resolveTextInput(sequence: string): string {
  const normalized = sequence
    .split("\u001b[200~")
    .join("")
    .split("\u001b[201~")
    .join("")
    .replace(/\r\n/g, "")
    .replace(/[\r\n]/g, "");
  let output = "";
  for (const char of normalized) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint !== "number") continue;
    if (codePoint < 0x20 || codePoint === 0x7f) continue;
    output += char;
  }
  return output;
}

export function MaskedSecretInput({
  label,
  colors,
  onSubmit,
}: {
  label: string;
  colors: TuiColors;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  useKeyboard((key) => {
    if (key.name === "return") {
      onSubmit(value);
      setValue("");
      return;
    }
    if (key.name === "backspace" || key.name === "delete") {
      setValue((current) => current.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    const typed = resolveTextInput(key.sequence ?? "");
    if (typed) setValue((current) => `${current}${typed}`);
  });
  return (
    <box style={{ flexDirection: "row", gap: 1 }}>
      <text fg={colors.accent}>{label}</text>
      <text fg={colors.text}>
        {value.length > 0 ? "*".repeat(value.length) : "(masked input)"}
      </text>
    </box>
  );
}
