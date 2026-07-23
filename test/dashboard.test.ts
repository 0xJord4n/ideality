import { describe, expect, test } from "bun:test";

import { buildDashboardModel } from "../src/tui/model.js";
import type { IdealityConfig } from "../src/domain/config.js";

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
    });
  });
});
