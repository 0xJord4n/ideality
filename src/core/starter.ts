import { BUILTIN_TOOLS } from "../adapters/builtins.js";
import type {
  GitIdentity,
  IdealityConfig,
  ToolProfile,
} from "../domain/config.js";

export function createToolProfiles(identity: string): Record<string, ToolProfile> {
  const profile = `{{idealityHome}}/profiles/${identity}`;
  const secret = `{{idealityHome}}/secrets/${identity}`;
  return {
    gh: {
      isolation: "shell",
      env: { GH_CONFIG_DIR: `${profile}/gh` },
    },
    railway: {
      isolation: "shell",
      env: {
        RAILWAY_API_TOKEN: {
          from: "file",
          path: `${secret}/railway-token`,
          optional: true,
        },
      },
    },
    cf: {
      isolation: "shell",
      env: {
        CLOUDFLARE_API_TOKEN: {
          from: "file",
          path: `${secret}/cloudflare-token`,
          optional: true,
        },
        CLOUDFLARE_ACCOUNT_ID: {
          from: "file",
          path: `${profile}/cloudflare-account-id`,
          optional: true,
        },
        CLOUDFLARE_ZONE_ID: {
          from: "file",
          path: `${profile}/cloudflare-zone-id`,
          optional: true,
        },
      },
    },
    codex: {
      isolation: "shell",
      env: { CODEX_HOME: `${profile}/codex` },
    },
    claude: {
      isolation: "process",
      env: { CLAUDE_CONFIG_DIR: `${profile}/claude` },
    },
    opencode: {
      isolation: "process",
      env: {
        XDG_CONFIG_HOME: `${profile}/opencode/config`,
        XDG_DATA_HOME: `${profile}/opencode/data`,
        XDG_STATE_HOME: `${profile}/opencode/state`,
        XDG_CACHE_HOME: `${profile}/opencode/cache`,
      },
    },
    vercel: {
      isolation: "process",
      env: {
        XDG_CONFIG_HOME: `${profile}/vercel/config`,
        XDG_DATA_HOME: `${profile}/vercel/data`,
        XDG_CACHE_HOME: `${profile}/vercel/cache`,
      },
    },
    chrome: {
      isolation: "process",
      args: [
        `--user-data-dir=${profile}/browsers/chrome`,
        "--profile-directory=Default",
      ],
    },
    firefox: {
      isolation: "process",
      args: ["-profile", `${profile}/browsers/firefox`],
    },
  };
}

export function createStarterConfig(options: {
  id: string;
  label: string;
  root: string;
  git: GitIdentity;
}): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: options.id,
    identities: {
      [options.id]: {
        label: options.label,
        roots: [options.root],
        color: "#22d3ee",
        git: options.git,
        tools: createToolProfiles(options.id),
      },
    },
    tools: structuredClone(BUILTIN_TOOLS),
  };
}
