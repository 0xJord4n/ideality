import { describe, expect, test } from "bun:test";

import {
  buildChildEnvironment,
  buildEnvironment,
  redactConfig,
  renderTemplate,
} from "../src/core/environment.js";
import type { IdealityConfig, ResolvedIdentity } from "../src/domain/config.js";

const config: IdealityConfig = {
  version: 1,
  defaultIdentity: "personal",
  identities: {
    personal: {
      label: "Personal",
      roots: ["~/code/personal"],
      tools: {
        gh: {
          env: { GH_CONFIG_DIR: "~/.config/gh-personal" },
        },
        railway: {
          env: {
            RAILWAY_API_TOKEN: {
              from: "file",
              path: "~/.config/railway-tokens/personal",
            },
          },
        },
      },
    },
  },
  tools: {
    gh: { executable: "gh", isolation: "shell" },
    railway: { executable: "railway", isolation: "shell" },
  },
};

const resolved: ResolvedIdentity = {
  id: "personal",
  identity: config.identities.personal!,
  path: "/home/dev/code/personal/app",
  matchedRoot: "/home/dev/code/personal",
  isDefault: false,
};

describe("buildEnvironment", () => {
  test("resolves paths and secret files while keeping a redacted view", async () => {
    const environment = await buildEnvironment(config, resolved, {
      home: "/home/dev",
      readFile: async (file) =>
        file === "/home/dev/.config/railway-tokens/personal"
          ? " secret-token\n"
          : "",
    });

    expect(environment.values).toEqual({
      IDEALITY_IDENTITY: "personal",
      GH_CONFIG_DIR: "/home/dev/.config/gh-personal",
      RAILWAY_API_TOKEN: "secret-token",
    });
    expect(environment.redacted.RAILWAY_API_TOKEN).toBe("<secret:file>");
    expect(environment.redacted.GH_CONFIG_DIR).toBe(
      "/home/dev/.config/gh-personal",
    );
  });

  test("redacts credential-like literal values", async () => {
    const literalConfig = structuredClone(config);
    literalConfig.identities.personal!.tools.gh!.env!.ACME_API_TOKEN =
      "plain-secret";
    const literalResolved = {
      ...resolved,
      identity: literalConfig.identities.personal!,
    };

    const environment = await buildEnvironment(literalConfig, literalResolved, {
      home: "/home/dev",
      readFile: async () => "secret-token",
    });

    expect(environment.values.ACME_API_TOKEN).toBe("plain-secret");
    expect(environment.redacted.ACME_API_TOKEN).toBe("<secret:literal>");
    expect(
      redactConfig(literalConfig).identities.personal!.tools.gh!.env!
        .ACME_API_TOKEN,
    ).toBe("<secret:literal>");
  });

  test("scrubs ambient shell-profile credentials before running one tool", () => {
    const childConfig = structuredClone(config);
    childConfig.tools.opencode = {
      executable: "opencode",
      isolation: "process",
    };
    childConfig.identities.personal!.tools.opencode = {
      isolation: "process",
      env: { XDG_CONFIG_HOME: "/managed/opencode" },
    };
    const selected = {
      values: { IDEALITY_IDENTITY: "personal", CLAUDE_CONFIG_DIR: "/isolated" },
      redacted: {},
      unset: [],
      tool: "claude",
      executable: "claude",
      args: [],
    };
    const child = buildChildEnvironment(childConfig, selected, {
      PATH: "/usr/bin",
      RAILWAY_API_TOKEN: "ambient-secret",
      GH_CONFIG_DIR: "/stale",
      XDG_CONFIG_HOME: "/stale-process-profile",
    });

    expect(child).toEqual({
      PATH: "/usr/bin",
      IDEALITY_IDENTITY: "personal",
      CLAUDE_CONFIG_DIR: "/isolated",
    });
  });

  test("renders all supported path templates consistently", () => {
    expect(
      renderTemplate(
        "{{idealityHome}}/{{identity}}:{{home}}:{{root}}",
        resolved,
        "/home/dev",
        "/secure/ideality",
      ),
    ).toBe("/secure/ideality/personal:/home/dev:/home/dev/code/personal");
  });

  test("resolves logical secrets only through the selected environment", async () => {
    const secretConfig = structuredClone(config);
    secretConfig.secretBackend = {
      type: "age",
      recipient: "age1x",
      identityFile: "/key",
    };
    secretConfig.identities.personal!.tools.railway!.env!.RAILWAY_API_TOKEN = {
      from: "secret",
      key: "{{identity}}/railway",
    };
    const environment = await buildEnvironment(
      secretConfig,
      {
        ...resolved,
        identity: secretConfig.identities.personal!,
      },
      {
        home: "/home/dev",
        tool: "railway",
        readSecret: async (_config, key) =>
          key === "personal/railway" ? "resolved-secret" : "",
      },
    );
    expect(environment.values.RAILWAY_API_TOKEN).toBe("resolved-secret");
    expect(environment.redacted.RAILWAY_API_TOKEN).toBe("<secret:age>");
  });

  test("maps literal templates to guest paths without remapping host file sources", async () => {
    const guestConfig = structuredClone(config);
    guestConfig.identities.personal!.tools.railway!.env = {
      TOOL_HOME: "{{home}}/tool",
      PROJECT_PATH: "{{root}}/package",
      RAILWAY_API_TOKEN: {
        from: "file",
        path: "{{idealityHome}}/secrets/token",
      },
    };
    const environment = await buildEnvironment(
      guestConfig,
      {
        ...resolved,
        identity: guestConfig.identities.personal!,
      },
      {
        home: "/home/dev",
        idealityHome: "/host/state",
        targetHome: "/home/ideality",
        targetIdealityHome: "/home/ideality/.ideality",
        targetRoot: "/workspace",
        tool: "railway",
        readFile: async (file) =>
          file === "/host/state/secrets/token" ? "token" : "",
      },
    );
    expect(environment.values).toMatchObject({
      TOOL_HOME: "/home/ideality/tool",
      PROJECT_PATH: "/workspace/package",
      RAILWAY_API_TOKEN: "token",
    });
  });

  test("redacts literal VPN material from config output", () => {
    const networkConfig = structuredClone(config);
    networkConfig.networks = {
      private: {
        driver: "openvpn",
        config: "client\nremote vpn.example",
        username: "account",
        password: "password",
        killSwitch: "provider",
      },
    };
    expect(redactConfig(networkConfig).networks?.private).toMatchObject({
      config: "<secret:literal>",
      username: "<secret:literal>",
      password: "<secret:literal>",
    });
  });
});
