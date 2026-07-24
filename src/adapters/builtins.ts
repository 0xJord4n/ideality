import type { ToolDefinition } from "../domain/config.js";

export interface ToolPack {
  label: string;
  description: string;
  tools: string[];
}

type ToolOptions = Omit<ToolDefinition, "executable" | "description" | "pack">;

function tool(
  executable: string,
  description: string,
  pack: string,
  options: ToolOptions = {},
): ToolDefinition {
  return {
    executable,
    description,
    pack,
    isolation: "process",
    stateIsolation: "partial",
    ...options,
  };
}

export const BUILTIN_TOOLS: Record<string, ToolDefinition> = {
  gh: tool("gh", "GitHub CLI", "essentials", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  }),
  railway: tool("railway", "Railway CLI", "essentials", {
    stateIsolation: "credentials",
    auth: {
      login: ["login"],
      status: ["whoami"],
      logout: ["logout"],
    },
  }),
  cf: tool("cf", "Cloudflare CLI", "essentials", {
    stateIsolation: "credentials",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "whoami"],
      logout: ["auth", "logout"],
    },
  }),
  vercel: tool("vercel", "Vercel CLI", "essentials", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["whoami"],
      logout: ["logout"],
    },
  }),
  codex: tool("codex", "OpenAI Codex CLI", "essentials", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["login", "status"],
      logout: ["logout"],
    },
  }),
  claude: tool("claude", "Claude Code", "essentials", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  }),
  opencode: tool("opencode", "OpenCode", "essentials", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "list"],
      logout: ["auth", "logout"],
    },
  }),
  chrome: tool("google-chrome", "Google Chrome", "essentials", {
    stateIsolation: "full",
    detect: [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
    ],
  }),
  firefox: tool("firefox", "Firefox", "essentials", {
    stateIsolation: "full",
  }),

  aws: tool("aws", "AWS CLI", "cloud", {
    stateIsolation: "full",
    auth: {
      login: ["sso", "login"],
      status: ["sts", "get-caller-identity"],
      logout: ["sso", "logout"],
    },
  }),
  gcloud: tool("gcloud", "Google Cloud CLI", "cloud", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "list"],
      logout: ["auth", "revoke", "--all"],
    },
  }),
  az: tool("az", "Azure CLI", "cloud", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["account", "show"],
      logout: ["logout"],
    },
  }),
  doctl: tool("doctl", "DigitalOcean CLI", "cloud", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "init"],
      status: ["account", "get"],
    },
  }),

  glab: tool("glab", "GitLab CLI", "source-control", {
    stateIsolation: "full",
    auth: {
      login: ["auth", "login"],
      status: ["auth", "status"],
      logout: ["auth", "logout"],
    },
  }),
  tea: tool("tea", "Gitea and Forgejo CLI", "source-control", {
    stateIsolation: "partial",
    auth: { status: ["login", "list"] },
  }),
  bitbucket: tool("bitbucket", "Bitbucket community CLI", "source-control", {
    stateIsolation: "credentials",
    detect: ["bb"],
  }),
  gerrit: tool("ssh", "Gerrit SSH command transport", "source-control", {
    stateIsolation: "credentials",
  }),

  code: tool("code", "Visual Studio Code", "editors", {
    stateIsolation: "full",
    detect: ["code-insiders"],
  }),
  cursor: tool("cursor", "Cursor", "editors", {
    stateIsolation: "partial",
  }),
  windsurf: tool("windsurf", "Windsurf", "editors", {
    stateIsolation: "partial",
  }),
  zed: tool("zed", "Zed", "editors", { stateIsolation: "partial" }),
  idea: tool("idea", "IntelliJ IDEA", "editors", {
    stateIsolation: "partial",
  }),
  pycharm: tool("pycharm", "PyCharm", "editors", {
    stateIsolation: "partial",
  }),
  webstorm: tool("webstorm", "WebStorm", "editors", {
    stateIsolation: "partial",
  }),
  goland: tool("goland", "GoLand", "editors", {
    stateIsolation: "partial",
  }),
  rustrover: tool("rustrover", "RustRover", "editors", {
    stateIsolation: "partial",
  }),
  slack: tool("slack", "Slack desktop", "editors", {
    stateIsolation: "partial",
  }),
  discord: tool("discord", "Discord desktop", "editors", {
    stateIsolation: "partial",
  }),

  npm: tool("npm", "npm registry client", "registries", {
    stateIsolation: "full",
    auth: { login: ["login"], status: ["whoami"], logout: ["logout"] },
  }),
  pnpm: tool("pnpm", "pnpm registry client", "registries", {
    stateIsolation: "full",
    auth: { login: ["login"], status: ["whoami"], logout: ["logout"] },
  }),
  yarn: tool("yarn", "Yarn registry client", "registries", {
    stateIsolation: "full",
    auth: { login: ["npm", "login"], status: ["npm", "whoami"] },
  }),
  bun: tool("bun", "Bun package registry client", "registries", {
    stateIsolation: "full",
    shim: false,
  }),
  cargo: tool("cargo", "Cargo registry client", "registries", {
    stateIsolation: "full",
    auth: { login: ["login"], logout: ["logout"] },
  }),
  uv: tool("uv", "uv Python package client", "registries", {
    stateIsolation: "full",
  }),
  pip: tool("pip", "pip Python package client", "registries", {
    stateIsolation: "full",
    detect: ["pip3"],
  }),
  gem: tool("gem", "RubyGems client", "registries", {
    stateIsolation: "full",
  }),
  composer: tool("composer", "Composer registry client", "registries", {
    stateIsolation: "full",
  }),
  mvn: tool("mvn", "Maven registry client", "registries", {
    stateIsolation: "partial",
  }),
  gradle: tool("gradle", "Gradle registry client", "registries", {
    stateIsolation: "full",
    detect: ["gradlew"],
  }),
  nuget: tool("nuget", "NuGet client", "registries", {
    stateIsolation: "partial",
  }),

  fly: tool("fly", "Fly.io CLI", "deployment", {
    stateIsolation: "credentials",
    detect: ["flyctl"],
    auth: {
      login: ["auth", "login"],
      status: ["auth", "whoami"],
      logout: ["auth", "logout"],
    },
  }),
  netlify: tool("netlify", "Netlify CLI", "deployment", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["status"],
      logout: ["logout"],
    },
  }),
  supabase: tool("supabase", "Supabase CLI", "deployment", {
    stateIsolation: "credentials",
    auth: { login: ["login"] },
  }),
  firebase: tool("firebase", "Firebase CLI", "deployment", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["login:list"],
      logout: ["logout"],
    },
  }),
  heroku: tool("heroku", "Heroku CLI", "deployment", {
    stateIsolation: "credentials",
    auth: {
      login: ["login"],
      status: ["auth:whoami"],
      logout: ["logout"],
    },
  }),
  render: tool("render", "Render CLI", "deployment", {
    stateIsolation: "credentials",
  }),
  sst: tool("sst", "SST CLI", "deployment", {
    stateIsolation: "credentials",
  }),
  pulumi: tool("pulumi", "Pulumi CLI", "deployment", {
    stateIsolation: "full",
    auth: {
      login: ["login"],
      status: ["whoami"],
      logout: ["logout"],
    },
  }),
  shopify: tool("shopify", "Shopify CLI", "deployment", {
    stateIsolation: "credentials",
    auth: { logout: ["auth", "logout"] },
  }),
  stripe: tool("stripe", "Stripe CLI", "deployment", {
    stateIsolation: "credentials",
    auth: {
      login: ["login"],
      status: ["config", "--list"],
    },
  }),

  gemini: tool("gemini", "Gemini CLI", "ai", {
    stateIsolation: "full",
  }),
  copilot: tool("copilot", "GitHub Copilot CLI", "ai", {
    stateIsolation: "full",
    auth: { login: ["login"] },
  }),
  aider: tool("aider", "Aider", "ai", {
    stateIsolation: "credentials",
  }),
  amp: tool("amp", "Amp", "ai", {
    stateIsolation: "full",
  }),
  goose: tool("goose", "Goose", "ai", {
    stateIsolation: "partial",
  }),
  cn: tool("cn", "Continue CLI", "ai", {
    stateIsolation: "credentials",
    auth: { login: ["login"] },
  }),
  "kiro-cli": tool("kiro-cli", "Kiro CLI", "ai", {
    stateIsolation: "full",
  }),
  qwen: tool("qwen", "Qwen Code", "ai", {
    stateIsolation: "full",
    auth: { login: ["auth"] },
  }),
};

function toolsFor(pack: string): string[] {
  return Object.entries(BUILTIN_TOOLS)
    .filter(([, definition]) => definition.pack === pack)
    .map(([name]) => name);
}

export const BUILTIN_TOOL_PACKS: Record<string, ToolPack> = {
  essentials: {
    label: "Developer essentials",
    description: "GitHub, hosting, AI agents, and browsers",
    tools: toolsFor("essentials"),
  },
  cloud: {
    label: "Cloud accounts",
    description: "AWS, Google Cloud, Azure, and DigitalOcean",
    tools: toolsFor("cloud"),
  },
  "source-control": {
    label: "Source control",
    description: "GitLab, Gitea/Forgejo, Bitbucket, and Gerrit",
    tools: toolsFor("source-control"),
  },
  editors: {
    label: "Editors and desktop",
    description: "Editors, JetBrains IDEs, Slack, and Discord",
    tools: toolsFor("editors"),
  },
  registries: {
    label: "Package registries",
    description: "JavaScript, Python, Rust, Ruby, PHP, JVM, and NuGet",
    tools: toolsFor("registries"),
  },
  deployment: {
    label: "Deployment platforms",
    description: "Fly, Netlify, Supabase, Firebase, Heroku, and more",
    tools: toolsFor("deployment"),
  },
  ai: {
    label: "AI tools",
    description: "Gemini, Copilot, Aider, Amp, Goose, Continue, Kiro, and Qwen",
    tools: toolsFor("ai"),
  },
};

export const DEFAULT_TOOL_PACKS = ["essentials"];

export function toolsInPacks(packs: string[]): string[] {
  return [
    ...new Set(packs.flatMap((pack) => BUILTIN_TOOL_PACKS[pack]?.tools ?? [])),
  ];
}
