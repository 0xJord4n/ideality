import type { ToolDefinition } from "../domain/config.js";

export const BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  gh: {
    executable: "gh",
    description: "GitHub CLI",
    isolation: "shell",
  },
  railway: {
    executable: "railway",
    description: "Railway CLI",
    isolation: "shell",
  },
  cf: {
    executable: "cf",
    description: "Cloudflare CLI",
    isolation: "shell",
  },
  vercel: {
    executable: "vercel",
    description: "Vercel CLI",
    isolation: "process",
  },
  codex: {
    executable: "codex",
    description: "OpenAI Codex CLI",
    isolation: "shell",
  },
  claude: {
    executable: "claude",
    description: "Claude Code",
    isolation: "process",
  },
  opencode: {
    executable: "opencode",
    description: "OpenCode",
    isolation: "process",
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
