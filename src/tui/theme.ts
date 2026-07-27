import type { AuthHealthState } from "../core/auth.js";
import type { ConfigDiffLine, TuiState } from "./state.js";

export const COLORS = {
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

export const AUTH_STATE_COLORS: Record<AuthHealthState, string> = {
  "logged-in": COLORS.green,
  expired: COLORS.red,
  unavailable: COLORS.amber,
  unsupported: COLORS.faint,
};

export const DIFF_COLORS: Record<ConfigDiffLine["op"], string> = {
  add: COLORS.green,
  remove: COLORS.red,
  change: COLORS.yellow,
};

export const KEY_HINTS: Record<TuiState["screen"], string> = {
  dashboard: "up/down move  tab pane  space toggle  s save  ? all keys  q quit",
  diff: "y save  c discard  esc back  ? all keys",
  rollback: "up/down select  enter preview  esc back  ? all keys",
  auth: "r probe again  esc back  ? all keys",
  policy: "r re-check  esc back  ? all keys",
  plugins: "up/down select  i install  x remove  esc back  ? all keys",
  secrets: "up/down select  n set  x delete  esc back  ? all keys",
};
