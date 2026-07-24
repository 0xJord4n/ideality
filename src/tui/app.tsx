import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useMemo, useState } from "react";

import type { IdealityConfig } from "../domain/config.js";
import { buildDashboardModel } from "./model.js";

export type DashboardAction = "quit" | "edit" | "doctor";

interface DashboardProps {
  config: IdealityConfig;
  activeIdentity: string;
  path: string;
  onExit: (action: DashboardAction) => void;
}

function Dashboard({ config, activeIdentity, path, onExit }: DashboardProps) {
  const [selectedId, setSelectedId] = useState(activeIdentity);
  const [refresh, setRefresh] = useState(0);
  const model = useMemo(
    () => buildDashboardModel(config, selectedId),
    [config, selectedId, refresh],
  );

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      onExit("quit");
    } else if (key.name === "e") {
      onExit("edit");
    } else if (key.name === "d") {
      onExit("doctor");
    } else if (key.name === "r") {
      setRefresh((value) => value + 1);
    }
  });

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: "#101418",
      }}
    >
      <box
        style={{
          height: 3,
          paddingX: 1,
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#172026",
        }}
      >
        <text fg="#22d3ee">IDEALITY</text>
        <text fg="#8da2ad">{path}</text>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "row", padding: 1, gap: 1 }}>
        <box
          title="Identities"
          style={{
            width: "34%",
            border: true,
            borderColor: "#34454f",
            padding: 1,
          }}
        >
          <select
            options={model.identities}
            focused
            selectedIndex={Math.max(
              0,
              model.identities.findIndex(
                (identity) => identity.value === model.selected.id,
              ),
            )}
            showDescription
            wrapSelection
            selectedBackgroundColor="#164e63"
            selectedTextColor="#f8fafc"
            descriptionColor="#70838d"
            onChange={(_index, option) => {
              if (typeof option?.value === "string") {
                setSelectedId(option.value);
              }
            }}
          />
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
          <text fg="#d7e0e5">Roots: {model.selected.roots.join(", ")}</text>
          <text fg="#d7e0e5">
            Git:{" "}
            {model.selected.git
              ? `${model.selected.git.name} <${model.selected.git.email}>`
              : "not configured"}
          </text>
          <text fg="#d7e0e5">
            SSH: {model.selected.git?.sshKey ?? "SSH agent default"}
          </text>
          <text fg="#d7e0e5">
            Target: {model.selected.execution.target}
            {model.selected.execution.vm
              ? ` / ${model.selected.execution.vm}`
              : ""}
            {model.selected.execution.network
              ? ` / VPN ${model.selected.execution.network}`
              : ""}
          </text>
          <text fg="#facc15">TOOLS</text>
          <scrollbox focused={false} style={{ flexGrow: 1 }}>
            {model.selected.tools.map((tool) => (
              <text
                key={tool.name}
                fg={
                  !tool.configured
                    ? "#64748b"
                    : tool.installed
                      ? "#4ade80"
                      : "#fbbf24"
                }
              >
                {`${tool.configured ? "+" : "-"} ${tool.name.padEnd(11)} ${tool.isolation.padEnd(7)} ${
                  tool.installed ? "ready  " : "missing"
                } ${tool.target}${tool.vm ? `:${tool.vm}` : ""}${
                  tool.network ? ` vpn:${tool.network}` : ""
                } env:${tool.variables} args:${tool.arguments}`}
              </text>
            ))}
          </scrollbox>
        </box>
      </box>

      <box
        style={{
          height: 2,
          paddingX: 1,
          alignItems: "center",
          backgroundColor: "#172026",
        }}
      >
        <text fg="#8da2ad">
          up/down navigate e edit config d doctor r refresh q quit
        </text>
      </box>
    </box>
  );
}

export async function runDashboard(
  config: IdealityConfig,
  activeIdentity: string,
  path: string,
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
    createRoot(renderer).render(
      <Dashboard
        config={config}
        activeIdentity={activeIdentity}
        path={path}
        onExit={finish}
      />,
    );
  });
}
