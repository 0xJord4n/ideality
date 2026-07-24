import { describe, expect, test } from "bun:test";

import type { IdealityConfig } from "../src/domain/config.js";
import {
  ConfigMutationError,
  bindFolder,
  canApplyRollback,
  createTuiState,
  diffConfigs,
  formatDiffLine,
  isDirty,
  isToolActive,
  nextProfileChoice,
  setIdentityNetwork,
  setToolEnabled,
  tuiReducer,
  unbindFolder,
  type TuiState,
} from "../src/tui/state.js";

function sample(): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "personal",
    identities: {
      personal: {
        label: "Personal",
        roots: ["~/code/personal"],
        tools: { gh: { env: { GH_TOKEN: "ghp_super_secret_value" } } },
      },
      work: {
        label: "Work",
        roots: ["~/code/work", "~/code/client"],
        tools: { gh: { enabled: false } },
      },
    },
    tools: {
      gh: { executable: "gh", isolation: "shell" },
      npm: { executable: "npm" },
    },
    networks: {
      vpn: { driver: "warp" },
      wg: { driver: "wireguard", config: { from: "file", path: "~/wg.conf" } },
    },
    vms: {
      sandbox: { driver: "lima" },
    },
  };
}

function reduce(state: TuiState, ...actions: Parameters<typeof tuiReducer>[1][]): TuiState {
  return actions.reduce(tuiReducer, state);
}

describe("staged mutations", () => {
  test("toggling a tool stages the change and the diff describes it", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "select-identity", id: "work" },
      { type: "focus-next-pane" },
      { type: "toggle-tool" },
    );

    expect(isDirty(state)).toBe(true);
    expect(isToolActive(state.draft, "work", "gh")).toBe(true);
    expect(diffConfigs(state.saved, state.draft)).toEqual([
      {
        op: "change",
        path: "identities.work.tools.gh.enabled",
        before: "false",
        after: "true",
      },
    ]);
  });

  test("moving the cursor in the identities pane selects the next identity", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(state, { type: "move-cursor", direction: 1 });
    expect(state.selectedIdentity).toBe("work");
    state = reduce(state, { type: "move-cursor", direction: 1 });
    expect(state.selectedIdentity).toBe("work");
    state = reduce(state, { type: "move-cursor", direction: -1 });
    expect(state.selectedIdentity).toBe("personal");
  });

  test("discarding the draft returns to the saved config", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "focus-next-pane" },
      { type: "toggle-tool" },
      { type: "discard-draft" },
    );
    expect(isDirty(state)).toBe(false);
    expect(state.status?.kind).toBe("info");
  });

  test("save-succeeded promotes the draft to the saved config", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(state, { type: "focus-next-pane" }, { type: "toggle-tool" });
    const draft = state.draft;
    state = reduce(state, { type: "save-succeeded", config: draft });
    expect(state.saved).toBe(draft);
    expect(isDirty(state)).toBe(false);
    expect(state.screen).toBe("dashboard");
  });

  test("cycling networks and VMs walks sorted profiles and back to none", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(state, { type: "cycle-network" });
    expect(state.draft.identities.personal?.execution).toEqual({
      target: "host",
      network: "vpn",
    });
    state = reduce(state, { type: "cycle-network" });
    expect(state.draft.identities.personal?.execution?.network).toBe("wg");
    state = reduce(state, { type: "cycle-vm" });
    expect(state.draft.identities.personal?.execution).toEqual({
      target: "vm",
      vm: "sandbox",
      network: "wg",
    });
    state = reduce(state, { type: "cycle-network" });
    expect(state.draft.identities.personal?.execution).toEqual({
      target: "vm",
      vm: "sandbox",
    });
    state = reduce(state, { type: "cycle-vm" });
    expect(state.draft.identities.personal?.execution).toBeUndefined();
  });

  test("cycling without profiles reports an error instead of staging", () => {
    const config = sample();
    delete config.networks;
    let state = createTuiState(config, "personal");
    state = reduce(state, { type: "cycle-network" });
    expect(isDirty(state)).toBe(false);
    expect(state.status).toEqual({
      kind: "error",
      text: "No network profiles configured",
    });
  });

  test("set-default-identity stages the new default", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "select-identity", id: "work" },
      { type: "set-default-identity" },
    );
    expect(state.draft.defaultIdentity).toBe("work");
    expect(state.saved.defaultIdentity).toBe("personal");
  });

  test("bind-folder stages a new root and closes the input on success", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "open-bind-input" },
      { type: "bind-folder", root: " ~/code/oss " },
    );
    expect(state.bindingFolder).toBe(false);
    expect(state.draft.identities.personal?.roots).toEqual([
      "~/code/personal",
      "~/code/oss",
    ]);
  });

  test("binding a duplicate folder keeps the input open with an error", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "open-bind-input" },
      { type: "bind-folder", root: "~/code/personal" },
    );
    expect(state.bindingFolder).toBe(true);
    expect(state.status?.kind).toBe("error");
    expect(isDirty(state)).toBe(false);
  });

  test("unbind-folder removes the cursor root but never the last one", () => {
    let state = createTuiState(sample(), "work");
    state = reduce(
      state,
      { type: "focus-next-pane" },
      { type: "focus-next-pane" },
      { type: "move-cursor", direction: 1 },
      { type: "unbind-folder" },
    );
    expect(state.draft.identities.work?.roots).toEqual(["~/code/work"]);
    state = reduce(state, { type: "unbind-folder" });
    expect(state.status).toEqual({
      kind: "error",
      text: "Identities need at least one folder binding",
    });
    expect(state.draft.identities.work?.roots).toEqual(["~/code/work"]);
  });
});

describe("mutation helper validation", () => {
  test("rejects invalid staged edits with ConfigMutationError", () => {
    const config = sample();
    expect(() => bindFolder(config, "missing", "~/x")).toThrow(
      ConfigMutationError,
    );
    expect(() => bindFolder(config, "personal", "  ")).toThrow(
      "Folder path cannot be empty",
    );
    expect(() => unbindFolder(config, "personal", "~/code/personal")).toThrow(
      "at least one folder binding",
    );
    expect(() => setToolEnabled(config, "personal", "ghost", true)).toThrow(
      "has no definition",
    );
    expect(() => setIdentityNetwork(config, "personal", "ghost")).toThrow(
      "does not exist",
    );
  });

  test("nextProfileChoice walks sorted ids and terminates on null", () => {
    expect(nextProfileChoice(["wg", "vpn"], null)).toBe("vpn");
    expect(nextProfileChoice(["wg", "vpn"], "vpn")).toBe("wg");
    expect(nextProfileChoice(["wg", "vpn"], "wg")).toBeNull();
    expect(nextProfileChoice([], null)).toBeNull();
  });
});

describe("diff redaction", () => {
  test("never leaks secret literals into diff output", () => {
    const before = sample();
    const after = structuredClone(before);
    after.identities.personal!.tools.gh!.env!.GH_TOKEN = "ghp_other_secret";
    expect(diffConfigs(before, after)).toEqual([]);

    after.identities.work!.tools.gh!.env = { NPM_TOKEN: "raw_leak_value" };
    const diff = diffConfigs(before, after);
    expect(diff.length).toBeGreaterThan(0);
    const rendered = diff.map(formatDiffLine).join("\n");
    expect(rendered).not.toContain("raw_leak_value");
    expect(rendered).toContain("<secret:literal>");
  });
});

describe("rollback flow", () => {
  test("previews a snapshot diff and guards apply behind a clean draft", () => {
    const restored = sample();
    restored.defaultIdentity = "work";
    let state = createTuiState(sample(), "personal");
    state = reduce(
      state,
      { type: "open-screen", screen: "rollback" },
      { type: "rollback-loaded", snapshots: ["snap-b", "snap-a"] },
      { type: "rollback-move", direction: 1 },
    );
    expect(state.rollback.cursor).toBe(1);
    expect(canApplyRollback(state)).toEqual({
      ok: false,
      reason: "Preview a snapshot before applying it",
    });

    state = reduce(state, {
      type: "rollback-previewed",
      snapshot: "snap-a",
      config: restored,
    });
    expect(state.rollback.preview?.diff).toEqual([
      {
        op: "change",
        path: "defaultIdentity",
        before: '"personal"',
        after: '"work"',
      },
    ]);
    expect(canApplyRollback(state)).toEqual({ ok: true });

    const dirty = reduce(
      state,
      { type: "focus-next-pane" },
      { type: "toggle-tool" },
    );
    expect(canApplyRollback(dirty)).toEqual({
      ok: false,
      reason: "Save or discard staged changes before applying a rollback",
    });

    state = reduce(state, {
      type: "rollback-applied",
      snapshot: "snap-a",
      config: restored,
    });
    expect(state.saved).toBe(restored);
    expect(state.draft).toBe(restored);
    expect(state.screen).toBe("dashboard");
    expect(state.rollback.preview).toBeNull();
  });

  test("re-targets the selected identity when a restore removes it", () => {
    const restored = sample();
    delete restored.identities.work;
    let state = createTuiState(sample(), "work");
    state = reduce(state, {
      type: "rollback-applied",
      snapshot: "snap",
      config: restored,
    });
    expect(state.selectedIdentity).toBe("personal");
  });
});

describe("quit and surfacing screens", () => {
  test("quit confirmation toggles and auth/policy results are stored", () => {
    let state = createTuiState(sample(), "personal");
    state = reduce(state, { type: "request-quit" });
    expect(state.confirmingQuit).toBe(true);
    state = reduce(state, { type: "cancel-quit" });
    expect(state.confirmingQuit).toBe(false);

    state = reduce(state, { type: "auth-loading" });
    expect(state.auth.phase).toBe("loading");
    state = reduce(state, {
      type: "auth-loaded",
      results: [
        {
          identity: "personal",
          tool: "gh",
          state: "logged-in",
          executable: "/usr/bin/gh",
          detail: "authenticated as <redacted>",
        },
      ],
    });
    expect(state.auth.phase).toBe("ready");
    expect(state.auth.results).toHaveLength(1);

    state = reduce(state, {
      type: "policy-loaded",
      result: {
        status: "fail",
        projectRoot: "/repo",
        policyPath: "/repo/.ideality/policy.jsonc",
        policy: { version: 1, label: "Team" },
        findings: [
          {
            code: "tool-not-permitted",
            subject: "tools/npm",
            message: "Tool 'npm' is not on the team policy allowlist",
          },
        ],
      },
    });
    expect(state.policy.phase).toBe("ready");
    expect(state.policy.result?.findings).toHaveLength(1);
  });
});
