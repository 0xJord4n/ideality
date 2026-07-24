import {
  compileToolDefinition,
  parseToolAdapterManifest,
  type ToolAdapterManifest,
} from "../core/tool-adapters.js";
import type { ToolDefinition } from "../domain/config.js";

import ghManifest from "../../catalog/gh.jsonc" with { type: "text" };
import railwayManifest from "../../catalog/railway.jsonc" with { type: "text" };
import cfManifest from "../../catalog/cf.jsonc" with { type: "text" };
import vercelManifest from "../../catalog/vercel.jsonc" with { type: "text" };
import codexManifest from "../../catalog/codex.jsonc" with { type: "text" };
import claudeManifest from "../../catalog/claude.jsonc" with { type: "text" };
import opencodeManifest from "../../catalog/opencode.jsonc" with { type: "text" };
import chromeManifest from "../../catalog/chrome.jsonc" with { type: "text" };
import firefoxManifest from "../../catalog/firefox.jsonc" with { type: "text" };
import awsManifest from "../../catalog/aws.jsonc" with { type: "text" };
import gcloudManifest from "../../catalog/gcloud.jsonc" with { type: "text" };
import azManifest from "../../catalog/az.jsonc" with { type: "text" };
import doctlManifest from "../../catalog/doctl.jsonc" with { type: "text" };
import glabManifest from "../../catalog/glab.jsonc" with { type: "text" };
import teaManifest from "../../catalog/tea.jsonc" with { type: "text" };
import bitbucketManifest from "../../catalog/bitbucket.jsonc" with { type: "text" };
import gerritManifest from "../../catalog/gerrit.jsonc" with { type: "text" };
import codeManifest from "../../catalog/code.jsonc" with { type: "text" };
import cursorManifest from "../../catalog/cursor.jsonc" with { type: "text" };
import windsurfManifest from "../../catalog/windsurf.jsonc" with { type: "text" };
import zedManifest from "../../catalog/zed.jsonc" with { type: "text" };
import ideaManifest from "../../catalog/idea.jsonc" with { type: "text" };
import pycharmManifest from "../../catalog/pycharm.jsonc" with { type: "text" };
import webstormManifest from "../../catalog/webstorm.jsonc" with { type: "text" };
import golandManifest from "../../catalog/goland.jsonc" with { type: "text" };
import rustroverManifest from "../../catalog/rustrover.jsonc" with { type: "text" };
import slackManifest from "../../catalog/slack.jsonc" with { type: "text" };
import discordManifest from "../../catalog/discord.jsonc" with { type: "text" };
import npmManifest from "../../catalog/npm.jsonc" with { type: "text" };
import pnpmManifest from "../../catalog/pnpm.jsonc" with { type: "text" };
import yarnManifest from "../../catalog/yarn.jsonc" with { type: "text" };
import bunManifest from "../../catalog/bun.jsonc" with { type: "text" };
import cargoManifest from "../../catalog/cargo.jsonc" with { type: "text" };
import uvManifest from "../../catalog/uv.jsonc" with { type: "text" };
import pipManifest from "../../catalog/pip.jsonc" with { type: "text" };
import gemManifest from "../../catalog/gem.jsonc" with { type: "text" };
import composerManifest from "../../catalog/composer.jsonc" with { type: "text" };
import mvnManifest from "../../catalog/mvn.jsonc" with { type: "text" };
import gradleManifest from "../../catalog/gradle.jsonc" with { type: "text" };
import nugetManifest from "../../catalog/nuget.jsonc" with { type: "text" };
import flyManifest from "../../catalog/fly.jsonc" with { type: "text" };
import netlifyManifest from "../../catalog/netlify.jsonc" with { type: "text" };
import supabaseManifest from "../../catalog/supabase.jsonc" with { type: "text" };
import firebaseManifest from "../../catalog/firebase.jsonc" with { type: "text" };
import herokuManifest from "../../catalog/heroku.jsonc" with { type: "text" };
import renderManifest from "../../catalog/render.jsonc" with { type: "text" };
import sstManifest from "../../catalog/sst.jsonc" with { type: "text" };
import pulumiManifest from "../../catalog/pulumi.jsonc" with { type: "text" };
import shopifyManifest from "../../catalog/shopify.jsonc" with { type: "text" };
import stripeManifest from "../../catalog/stripe.jsonc" with { type: "text" };
import geminiManifest from "../../catalog/gemini.jsonc" with { type: "text" };
import copilotManifest from "../../catalog/copilot.jsonc" with { type: "text" };
import aiderManifest from "../../catalog/aider.jsonc" with { type: "text" };
import ampManifest from "../../catalog/amp.jsonc" with { type: "text" };
import gooseManifest from "../../catalog/goose.jsonc" with { type: "text" };
import cnManifest from "../../catalog/cn.jsonc" with { type: "text" };
import kiroCliManifest from "../../catalog/kiro-cli.jsonc" with { type: "text" };
import qwenManifest from "../../catalog/qwen.jsonc" with { type: "text" };

export interface ToolPack {
  label: string;
  description: string;
  tools: string[];
}

const MANIFEST_SOURCES: readonly string[] = [
  ghManifest,
  railwayManifest,
  cfManifest,
  vercelManifest,
  codexManifest,
  claudeManifest,
  opencodeManifest,
  chromeManifest,
  firefoxManifest,
  awsManifest,
  gcloudManifest,
  azManifest,
  doctlManifest,
  glabManifest,
  teaManifest,
  bitbucketManifest,
  gerritManifest,
  codeManifest,
  cursorManifest,
  windsurfManifest,
  zedManifest,
  ideaManifest,
  pycharmManifest,
  webstormManifest,
  golandManifest,
  rustroverManifest,
  slackManifest,
  discordManifest,
  npmManifest,
  pnpmManifest,
  yarnManifest,
  bunManifest,
  cargoManifest,
  uvManifest,
  pipManifest,
  gemManifest,
  composerManifest,
  mvnManifest,
  gradleManifest,
  nugetManifest,
  flyManifest,
  netlifyManifest,
  supabaseManifest,
  firebaseManifest,
  herokuManifest,
  renderManifest,
  sstManifest,
  pulumiManifest,
  shopifyManifest,
  stripeManifest,
  geminiManifest,
  copilotManifest,
  aiderManifest,
  ampManifest,
  gooseManifest,
  cnManifest,
  kiroCliManifest,
  qwenManifest,
];

const PACK_DETAILS: Record<string, Omit<ToolPack, "tools">> = {
  essentials: {
    label: "Developer essentials",
    description: "GitHub, hosting, AI agents, and browsers",
  },
  cloud: {
    label: "Cloud accounts",
    description: "AWS, Google Cloud, Azure, and DigitalOcean",
  },
  "source-control": {
    label: "Source control",
    description: "GitLab, Gitea/Forgejo, Bitbucket, and Gerrit",
  },
  editors: {
    label: "Editors and desktop",
    description: "Editors, JetBrains IDEs, Slack, and Discord",
  },
  registries: {
    label: "Package registries",
    description: "JavaScript, Python, Rust, Ruby, PHP, JVM, and NuGet",
  },
  deployment: {
    label: "Deployment platforms",
    description: "Fly, Netlify, Supabase, Firebase, Heroku, and more",
  },
  ai: {
    label: "AI tools",
    description: "Gemini, Copilot, Aider, Amp, Goose, Continue, Kiro, and Qwen",
  },
};

/** Parsed built-in adapter manifests keyed by tool ID, in catalog order. */
export const BUILTIN_TOOL_MANIFESTS: Record<string, ToolAdapterManifest> =
  Object.fromEntries(
    MANIFEST_SOURCES.map((source) => {
      const manifest = parseToolAdapterManifest(source);
      if (!PACK_DETAILS[manifest.pack]) {
        throw new Error(
          `Tool adapter '${manifest.id}' references unknown pack '${manifest.pack}'`,
        );
      }
      return [manifest.id, manifest] as const;
    }),
  );

if (Object.keys(BUILTIN_TOOL_MANIFESTS).length !== MANIFEST_SOURCES.length) {
  throw new Error("Duplicate tool adapter IDs in the built-in catalog");
}

function toToolDefinition(manifest: ToolAdapterManifest): ToolDefinition {
  const {
    displayName,
    description,
    executable,
    pack,
    isolation,
    stateIsolation,
    ...extras
  } = compileToolDefinition(manifest);
  // The manifest displayName doubles as the legacy `description` label so
  // existing configs and prompts keep their wording.
  return {
    executable,
    description: description ?? displayName,
    pack,
    isolation,
    stateIsolation,
    ...extras,
  };
}

/** Built-in tool definitions compiled from the catalog manifests. */
export const BUILTIN_TOOLS: Record<string, ToolDefinition> = Object.fromEntries(
  Object.entries(BUILTIN_TOOL_MANIFESTS).map(([id, manifest]) => [
    id,
    toToolDefinition(manifest),
  ]),
);

function toolsFor(pack: string): string[] {
  return Object.entries(BUILTIN_TOOLS)
    .filter(([, definition]) => definition.pack === pack)
    .map(([name]) => name);
}

export const BUILTIN_TOOL_PACKS: Record<string, ToolPack> = Object.fromEntries(
  Object.entries(PACK_DETAILS).map(([id, details]) => [
    id,
    { ...details, tools: toolsFor(id) },
  ]),
);

export const DEFAULT_TOOL_PACKS = ["essentials"];

export function toolsInPacks(packs: string[]): string[] {
  return [
    ...new Set(
      packs.flatMap((pack) => BUILTIN_TOOL_PACKS[pack]?.tools ?? []),
    ),
  ];
}
