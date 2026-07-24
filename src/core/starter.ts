import {
  BUILTIN_TOOLS,
  DEFAULT_TOOL_PACKS,
  toolsInPacks,
} from "../adapters/builtins.js";
import type {
  GitIdentity,
  IdealityConfig,
  ToolProfile,
  ValueSource,
} from "../domain/config.js";

function optionalSecret(key: string): ValueSource {
  return {
    from: "secret",
    key: `{{identity}}/${key}`,
    optional: true,
  };
}

function xdg(root: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: `${root}/config`,
    XDG_DATA_HOME: `${root}/data`,
    XDG_STATE_HOME: `${root}/state`,
    XDG_CACHE_HOME: `${root}/cache`,
  };
}

function registryProfile(
  root: string,
  cacheName: string,
): Record<string, string> {
  return {
    NPM_CONFIG_USERCONFIG: `${root}/npmrc`,
    NPM_CONFIG_CACHE: `${root}/${cacheName}`,
  };
}

export function createToolProfiles(
  identity: string,
  selectedTools: string[] = Object.keys(BUILTIN_TOOLS),
  sshKey?: string,
): Record<string, ToolProfile> {
  const profile = `{{idealityHome}}/profiles/${identity}`;
  const profiles: Record<string, ToolProfile> = {
    gh: { env: { GH_CONFIG_DIR: `${profile}/gh` } },
    railway: {
      env: { RAILWAY_API_TOKEN: optionalSecret("railway-token") },
    },
    cf: {
      env: {
        CLOUDFLARE_API_TOKEN: optionalSecret("cloudflare-token"),
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
    vercel: { env: xdg(`${profile}/vercel`) },
    codex: { env: { CODEX_HOME: `${profile}/codex` } },
    claude: { env: { CLAUDE_CONFIG_DIR: `${profile}/claude` } },
    opencode: { env: xdg(`${profile}/opencode`) },
    chrome: {
      args: [
        `--user-data-dir=${profile}/browsers/chrome`,
        "--profile-directory=Default",
      ],
    },
    firefox: {
      args: ["-profile", `${profile}/browsers/firefox`],
    },

    aws: {
      env: {
        AWS_CONFIG_FILE: `${profile}/cloud/aws/config`,
        AWS_SHARED_CREDENTIALS_FILE: `${profile}/cloud/aws/credentials`,
      },
    },
    gcloud: {
      env: { CLOUDSDK_CONFIG: `${profile}/cloud/gcloud` },
    },
    az: {
      env: { AZURE_CONFIG_DIR: `${profile}/cloud/azure` },
    },
    doctl: {
      args: ["--config", `${profile}/cloud/doctl/config.yaml`],
    },

    glab: {
      env: {
        GLAB_CONFIG_DIR: `${profile}/source-control/glab`,
        GITLAB_TOKEN: optionalSecret("gitlab-token"),
      },
    },
    tea: { env: xdg(`${profile}/source-control/tea`) },
    bitbucket: {
      env: {
        ...xdg(`${profile}/source-control/bitbucket`),
        BITBUCKET_TOKEN: optionalSecret("bitbucket-token"),
      },
    },
    gerrit: sshKey ? { args: ["-i", sshKey] } : {},

    code: {
      args: [
        "--user-data-dir",
        `${profile}/editors/vscode/user-data`,
        "--extensions-dir",
        `${profile}/editors/vscode/extensions`,
      ],
    },
    cursor: {
      args: [
        "--user-data-dir",
        `${profile}/editors/cursor/user-data`,
        "--extensions-dir",
        `${profile}/editors/cursor/extensions`,
      ],
    },
    windsurf: {
      args: [
        "--user-data-dir",
        `${profile}/editors/windsurf/user-data`,
        "--extensions-dir",
        `${profile}/editors/windsurf/extensions`,
      ],
    },
    zed: { env: xdg(`${profile}/editors/zed`) },
    idea: { env: xdg(`${profile}/editors/jetbrains/idea`) },
    pycharm: { env: xdg(`${profile}/editors/jetbrains/pycharm`) },
    webstorm: { env: xdg(`${profile}/editors/jetbrains/webstorm`) },
    goland: { env: xdg(`${profile}/editors/jetbrains/goland`) },
    rustrover: { env: xdg(`${profile}/editors/jetbrains/rustrover`) },
    slack: {
      args: [`--user-data-dir=${profile}/desktop/slack`],
    },
    discord: {
      args: [`--user-data-dir=${profile}/desktop/discord`],
    },

    npm: {
      env: registryProfile(`${profile}/registries/npm`, "cache"),
    },
    pnpm: {
      env: {
        ...registryProfile(`${profile}/registries/pnpm`, "cache"),
        XDG_DATA_HOME: `${profile}/registries/pnpm/data`,
      },
    },
    yarn: {
      env: {
        ...registryProfile(`${profile}/registries/yarn`, "npm-cache"),
        YARN_CACHE_FOLDER: `${profile}/registries/yarn/cache`,
      },
    },
    bun: {
      env: {
        ...registryProfile(`${profile}/registries/bun`, "npm-cache"),
        BUN_INSTALL_CACHE_DIR: `${profile}/registries/bun/cache`,
      },
    },
    cargo: {
      env: { CARGO_HOME: `${profile}/registries/cargo` },
    },
    uv: {
      env: {
        ...xdg(`${profile}/registries/uv`),
        UV_CACHE_DIR: `${profile}/registries/uv/cache`,
      },
    },
    pip: {
      env: {
        PIP_CONFIG_FILE: `${profile}/registries/pip/pip.conf`,
        PIP_CACHE_DIR: `${profile}/registries/pip/cache`,
      },
    },
    gem: {
      env: {
        GEM_HOME: `${profile}/registries/rubygems/gems`,
        GEM_PATH: `${profile}/registries/rubygems/gems`,
        GEMRC: `${profile}/registries/rubygems/gemrc`,
      },
    },
    composer: {
      env: {
        COMPOSER_HOME: `${profile}/registries/composer`,
        COMPOSER_CACHE_DIR: `${profile}/registries/composer/cache`,
      },
    },
    mvn: {
      env: {
        MAVEN_OPTS: `-Duser.home=${profile}/registries/maven/home`,
      },
    },
    gradle: {
      env: { GRADLE_USER_HOME: `${profile}/registries/gradle` },
    },
    nuget: {
      env: {
        NUGET_PACKAGES: `${profile}/registries/nuget/packages`,
        DOTNET_CLI_HOME: `${profile}/registries/nuget/dotnet-home`,
      },
    },

    fly: {
      env: {
        FLY_API_TOKEN: optionalSecret("fly-token"),
        ...xdg(`${profile}/deployment/fly`),
      },
    },
    netlify: {
      env: {
        NETLIFY_AUTH_TOKEN: optionalSecret("netlify-token"),
        ...xdg(`${profile}/deployment/netlify`),
      },
    },
    supabase: {
      env: {
        SUPABASE_ACCESS_TOKEN: optionalSecret("supabase-token"),
        ...xdg(`${profile}/deployment/supabase`),
      },
    },
    firebase: {
      env: {
        FIREBASE_TOKEN: optionalSecret("firebase-token"),
        ...xdg(`${profile}/deployment/firebase`),
      },
    },
    heroku: {
      env: {
        HEROKU_API_KEY: optionalSecret("heroku-token"),
        ...xdg(`${profile}/deployment/heroku`),
      },
    },
    render: {
      env: {
        RENDER_API_KEY: optionalSecret("render-token"),
        ...xdg(`${profile}/deployment/render`),
      },
    },
    sst: {
      env: {
        SST_AUTH_TOKEN: optionalSecret("sst-token"),
        AWS_CONFIG_FILE: `${profile}/cloud/aws/config`,
        AWS_SHARED_CREDENTIALS_FILE: `${profile}/cloud/aws/credentials`,
      },
    },
    pulumi: {
      env: {
        PULUMI_HOME: `${profile}/deployment/pulumi`,
        PULUMI_ACCESS_TOKEN: optionalSecret("pulumi-token"),
        AWS_CONFIG_FILE: `${profile}/cloud/aws/config`,
        AWS_SHARED_CREDENTIALS_FILE: `${profile}/cloud/aws/credentials`,
        CLOUDSDK_CONFIG: `${profile}/cloud/gcloud`,
        AZURE_CONFIG_DIR: `${profile}/cloud/azure`,
      },
    },
    shopify: {
      env: {
        SHOPIFY_CLI_PARTNERS_TOKEN: optionalSecret("shopify-token"),
        ...xdg(`${profile}/deployment/shopify`),
      },
    },
    stripe: {
      env: {
        STRIPE_API_KEY: optionalSecret("stripe-api-key"),
        ...xdg(`${profile}/deployment/stripe`),
      },
    },

    gemini: {
      env: {
        GEMINI_CLI_HOME: `${profile}/ai/gemini`,
        GEMINI_API_KEY: optionalSecret("gemini-api-key"),
      },
    },
    copilot: {
      env: {
        COPILOT_HOME: `${profile}/ai/copilot`,
        COPILOT_CACHE_HOME: `${profile}/ai/copilot/cache`,
        COPILOT_GITHUB_TOKEN: optionalSecret("copilot-github-token"),
      },
    },
    aider: {
      env: {
        OPENAI_API_KEY: optionalSecret("openai-api-key"),
        ANTHROPIC_API_KEY: optionalSecret("anthropic-api-key"),
      },
    },
    amp: {
      env: {
        ...xdg(`${profile}/ai/amp`),
        AMP_API_KEY: optionalSecret("amp-api-key"),
      },
    },
    goose: {
      env: {
        ...xdg(`${profile}/ai/goose`),
        GOOSE_API_KEY: optionalSecret("goose-api-key"),
      },
    },
    cn: {
      env: {
        CONTINUE_API_KEY: optionalSecret("continue-api-key"),
      },
    },
    "kiro-cli": {
      env: { KIRO_HOME: `${profile}/ai/kiro` },
    },
    qwen: {
      env: {
        QWEN_HOME: `${profile}/ai/qwen`,
        QWEN_RUNTIME_DIR: `${profile}/ai/qwen/runtime`,
        OPENAI_API_KEY: optionalSecret("qwen-api-key"),
      },
    },
  };

  return Object.fromEntries(
    selectedTools
      .filter((name) => BUILTIN_TOOLS[name] && profiles[name])
      .map((name) => [
        name,
        { isolation: "process", ...structuredClone(profiles[name]!) },
      ]),
  );
}

export function createStarterConfig(options: {
  id: string;
  label: string;
  root: string;
  git: GitIdentity;
  tools?: string[];
}): IdealityConfig {
  const selectedTools = options.tools ?? toolsInPacks(DEFAULT_TOOL_PACKS);
  return {
    version: 1,
    defaultIdentity: options.id,
    secretBackend: { type: "file" },
    identities: {
      [options.id]: {
        label: options.label,
        roots: [options.root],
        color: "#22d3ee",
        git: options.git,
        tools: createToolProfiles(
          options.id,
          selectedTools,
          options.git.sshKey,
        ),
      },
    },
    tools: structuredClone(BUILTIN_TOOLS),
  };
}
