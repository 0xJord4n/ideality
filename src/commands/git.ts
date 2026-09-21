import { defineCommand, defineGroup, option } from "@bunli/core";
import os from "node:os";
import { z } from "zod";

import { loadRuntime } from "../core/runtime.js";
import {
  clearLocalGitIdentity,
  resolveEffectiveGitIdentity,
} from "../integrations/git.js";
import { loadConfig } from "../core/config-store.js";
import { expandHome } from "../core/resolution.js";
import { requirePositional } from "./shared.js";
import { hintLines, keyValue, statusGlyph, tidyPath } from "./ui.js";

function identityRootsFor(
  config: Awaited<ReturnType<typeof loadConfig>>,
  id: string,
): string[] {
  return (config.identities[id]?.roots ?? []).map((root) =>
    expandHome(root, os.homedir()),
  );
}

const gitCommand = defineGroup({
  name: "git",
  description: "Inspect and repair effective Git identity routing",
  commands: [
    defineCommand({
      name: "status",
      description: "Show configured vs effective Git author for a directory",
      options: {
        path: option(z.string().default(process.cwd()), {
          short: "C",
          description: "Path used for identity resolution",
        }),
        identity: option(z.string().optional(), {
          short: "i",
          description: "Override folder-based selection",
        }),
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        const runtime = await loadRuntime(flags.path, flags.identity);
        const configured = runtime.resolved.identity.git ?? null;
        const effective = resolveEffectiveGitIdentity(flags.path);
        const output = {
          identity: runtime.resolved.id,
          label: runtime.resolved.identity.label,
          path: runtime.resolved.path,
          matchedRoot: runtime.resolved.matchedRoot,
          configured,
          effective: {
            name: effective.name,
            email: effective.email,
            overridden: effective.overridden,
            origins: effective.origins,
          },
        };
        if (flags.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }
        console.log(
          `${colors.bold(output.label)} ${colors.dim(`(${output.identity})`)}`,
        );
        console.log(
          keyValue([
            ["path", tidyPath(output.path)],
            [
              "matched root",
              output.matchedRoot
                ? tidyPath(output.matchedRoot)
                : colors.dim("none (default identity)"),
            ],
            [
              "configured",
              configured
                ? `${configured.name} <${configured.email}>`
                : colors.dim("none"),
            ],
            [
              "effective",
              effective.name
                ? `${effective.name.value} <${effective.email?.value ?? "?"}>`
                : colors.dim("none"),
            ],
            [
              "override",
              effective.overridden
                ? statusGlyph("fail", "local config beats includeIf")
                : statusGlyph("ok", "profile applies"),
            ],
          ]),
        );
        if (effective.origins.length > 0) {
          console.log();
          console.log(hintLines(effective.origins));
        }
        if (effective.overridden) {
          console.log();
          console.log(
            hintLines([`clear it with: ideality git repair -C ${output.path}`]),
          );
        }
      },
    }),
    defineCommand({
      name: "repair",
      description: "Clear local Git author overrides so the profile applies",
      options: {
        path: option(z.string().default(process.cwd()), {
          short: "C",
          description: "Repository path to repair",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Show overrides without removing them",
          argumentKind: "flag",
        }),
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        const config = await loadConfig();
        const runtime = await loadRuntime(flags.path);
        const effective = resolveEffectiveGitIdentity(flags.path);
        const roots = identityRootsFor(config, runtime.resolved.id);
        const insideManagedRoot = roots.some(
          (root) =>
            runtime.resolved.path === root ||
            runtime.resolved.path.startsWith(`${root}/`),
        );
        if (flags["dry-run"]) {
          const planned = {
            identity: runtime.resolved.id,
            path: runtime.resolved.path,
            repo: null as string | null,
            insideManagedRoot,
            wouldClear: effective.overridden
              ? effective.origins.filter(
                  (origin) => !origin.includes("global:"),
                )
              : [],
            effective,
          };
          if (flags.json) {
            console.log(JSON.stringify(planned, null, 2));
          } else if (planned.wouldClear.length === 0) {
            console.log(statusGlyph("ok", "no local Git author overrides"));
          } else {
            console.log(
              statusGlyph(
                "fail",
                `would clear: ${planned.wouldClear.join("; ")}`,
              ),
            );
          }
          return;
        }
        if (!effective.overridden) {
          if (flags.json) {
            console.log(
              JSON.stringify(
                { cleared: [], path: runtime.resolved.path, effective },
                null,
                2,
              ),
            );
          } else {
            console.log(statusGlyph("ok", "no local Git author overrides"));
          }
          return;
        }
        const cleared = clearLocalGitIdentity(flags.path);
        const after = resolveEffectiveGitIdentity(flags.path);
        if (flags.json) {
          console.log(
            JSON.stringify(
              {
                cleared: cleared.cleared,
                path: cleared.path,
                effective: after,
              },
              null,
              2,
            ),
          );
          return;
        }
        console.log(
          colors.green(
            `Cleared local Git author: ${cleared.cleared.join("; ")}`,
          ),
        );
        if (cleared.path) {
          console.log(`Repository: ${tidyPath(cleared.path)}`);
        }
        if (after.name) {
          console.log(
            `Effective author is now '${after.name.value} <${after.email?.value ?? "?"}>'`,
          );
        }
      },
    }),
    defineCommand({
      name: "check",
      description: "Verify the active tool binary (PATH precedence)",
      options: {
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const tool = requirePositional(positional, 0, "tool name");
        const { getIdealityHome } = await import("../core/config-store.js");
        const { findExecutable } = await import("../core/runtime.js");
        const idealityHome = getIdealityHome();
        const shim = `${idealityHome}/bin/${tool}`;
        const shimExists = await Bun.file(shim).exists();
        const delimiter = process.platform === "win32" ? ";" : ":";
        const entries = (process.env.PATH ?? "").split(delimiter);
        const firstHit = entries.find((entry) => {
          try {
            const candidate = `${entry}/${tool}`;
            findExecutable(candidate, {});
            return (
              Bun.spawnSync({
                cmd: ["test", "-x", candidate],
                stdout: "ignore",
                stderr: "ignore",
              }).exitCode === 0
            );
          } catch {
            return false;
          }
        });
        const output = {
          tool,
          shim,
          shimExists,
          pathFirst: firstHit ?? null,
          intercepted: shimExists && firstHit === `${idealityHome}/bin`,
        };
        if (flags.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }
        console.log(
          keyValue([
            ["tool", tool],
            ["shim", tidyPath(shim)],
            [
              "shim exists",
              shimExists ? statusGlyph("ok", "yes") : statusGlyph("off", "no"),
            ],
            [
              "first in PATH",
              firstHit ? tidyPath(firstHit) : colors.dim("not found"),
            ],
            [
              "intercepted",
              output.intercepted
                ? statusGlyph("ok", "yes")
                : statusGlyph("fail", "no — re-source the shell hook"),
            ],
          ]),
        );
        if (!output.intercepted) {
          console.log();
          console.log(
            hintLines(['fix: ideality install, then exec "$SHELL" -l']),
          );
        }
      },
    }),
  ],
});

export default gitCommand;
