import { describe, expect, test } from "bun:test";
import type { IdealityConfig } from "../src/domain/config.js";
import { buildDashboardModel } from "../src/tui/model.js";
import { createTuiState, tuiReducer } from "../src/tui/state.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "personal",
  identities: {
    personal: {
      label: "Personal",
      roots: ["~/code/personal"],
      tools: { gh: { env: { GH_CONFIG_DIR: "~/.config/gh-personal" } } },
    },
    work: {
      label: "Work",
      roots: ["~/code/work"],
      tools: {},
    },
  },
  tools: { gh: { executable: "gh", isolation: "shell" } },
};

describe("help overlay", () => {
  test("toggle-help opens and closes the keymap overlay", () => {
    const initial = createTuiState(config, "personal");
    expect(initial.showingHelp).toBe(false);

    const opened = tuiReducer(initial, { type: "toggle-help" });
    expect(opened.showingHelp).toBe(true);
    expect(opened.screen).toBe("dashboard");

    const closed = tuiReducer(opened, { type: "toggle-help" });
    expect(closed.showingHelp).toBe(false);
  });
});

describe("buildDashboardModel", () => {
  test("builds identity navigation and tool readiness without secret values", () => {
    const model = buildDashboardModel(config, "personal", () => true);

    expect(model.identities.map((identity) => identity.value)).toEqual([
      "personal",
      "work",
    ]);
    expect(model.selected.tools[0]).toMatchObject({
      name: "gh",
      configured: true,
      installed: true,
      target: "host",
      network: null,
    });
  });

  test("reflects staged tool enablement from the draft config", () => {
    const draft = structuredClone(config);
    draft.identities.personal!.tools.gh = { enabled: false };
    const model = buildDashboardModel(draft, "personal", () => true);

    expect(model.selected.tools[0]).toMatchObject({
      name: "gh",
      configured: true,
      enabled: false,
    });
  });
});
