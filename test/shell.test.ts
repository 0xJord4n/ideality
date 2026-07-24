import { describe, expect, test } from "bun:test";

import {
  collectManagedVariables,
  renderShellAssignments,
  renderShellHook,
} from "../src/integrations/shell.js";
import type { IdealityConfig } from "../src/domain/config.js";

describe("renderShellAssignments", () => {
  test("quotes values and unsets stale variables for zsh", () => {
    const output = renderShellAssignments(
      {
        IDEALITY_IDENTITY: "personal",
        EXAMPLE_VALUE: "Developer's profile",
      },
      ["OLD_TOKEN"],
      "zsh",
    );

    expect(output).toContain("export EXAMPLE_VALUE='Developer'\\''s profile'");
    expect(output).toContain("unset OLD_TOKEN");
    expect(output).not.toContain("undefined");
  });

  test("does not globally unset variables owned by process-scoped tools", () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "personal",
      identities: {
        personal: {
          label: "Personal",
          roots: ["~/code/personal"],
          tools: {
            gh: { env: { GH_CONFIG_DIR: "~/.config/gh" } },
            editor: { env: { XDG_CONFIG_HOME: "~/.config/editor" } },
          },
        },
      },
      tools: {
        gh: { executable: "gh", isolation: "shell" },
        editor: { executable: "editor", isolation: "process" },
      },
    };

    expect(collectManagedVariables(config)).toEqual([
      "GH_CONFIG_DIR",
      "IDEALITY_IDENTITY",
    ]);
  });

  test("adds the dynamic shim directory without static tool functions", () => {
    const config: IdealityConfig = {
      version: 1,
      defaultIdentity: "default",
      identities: {
        default: {
          label: "Default",
          roots: ["~/code"],
          tools: { sample: {} },
        },
      },
      tools: {
        sample: {
          executable: "sample",
          isolation: "process",
        },
      },
    };

    const hook = renderShellHook(config, "zsh", "/home/dev/.ideality");

    expect(hook).toContain(
      "export PATH='/home/dev/.ideality/bin':\"$PATH\"",
    );
    expect(hook).not.toContain("sample()");
    expect(hook).toContain("ideality env --shell zsh");
  });
});
