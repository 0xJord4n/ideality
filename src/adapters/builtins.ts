import type { ToolDefinition } from "../domain/config.js";

export const BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  gh: {
    executable: "gh",
    description: "GitHub CLI",
    isolation: "process",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  },
  railway: {
    executable: "railway",
    description: "Railway CLI",
    isolation: "process",
    auth: {
      login: ["login"],
      status: ["whoami"],
      logout: ["logout"],
    },
  },
  cf: {
    executable: "cf",
    description: "Cloudflare CLI",
    isolation: "process",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "whoami"],
      logout: ["auth", "logout"],
    },
  },
  vercel: {
    executable: "vercel",
    description: "Vercel CLI",
    isolation: "process",
    auth: {
      login: ["login"],
      status: ["whoami"],
      logout: ["logout"],
    },
  },
  codex: {
    executable: "codex",
    description: "OpenAI Codex CLI",
    isolation: "process",
    auth: {
      login: ["login"],
      status: ["login", "status"],
      logout: ["logout"],
    },
  },
  claude: {
    executable: "claude",
    description: "Claude Code",
    isolation: "process",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  },
  opencode: {
    executable: "opencode",
    description: "OpenCode",
    isolation: "process",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "list"],
      logout: ["auth", "logout"],
    },
  },
  chrome: {
    executable: "google-chrome",
    description: "Google Chrome",
    isolation: "process",
    detect: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  },
  firefox: {
    executable: "firefox",
    description: "Firefox",
    isolation: "process",
  },
};
