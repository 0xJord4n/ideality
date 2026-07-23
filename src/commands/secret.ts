import os from "node:os";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import { getIdealityHome, loadConfig } from "../core/config-store.js";
import { renderTemplate } from "../core/environment.js";
import type { ResolvedIdentity } from "../domain/config.js";
import {
  listSecretContexts,
  resolveSecretContext,
  writeSecret,
} from "../integrations/secrets.js";
import { printJson, requirePositional } from "./shared.js";

function secretTarget(
  sourcePath: string,
  resolved: ResolvedIdentity,
  home: string,
  idealityHome: string,
): string {
  return renderTemplate(sourcePath, resolved, home, idealityHome);
}

const secretCommand = defineGroup({
  name: "secret",
  description: "Write and inspect file-backed credentials",
  commands: [
    defineCommand({
      name: "set",
      description: "Securely write a configured file-backed variable",
      options: {
        stdin: option(z.boolean().default(false), {
          description: "Read the value from standard input",
          argumentKind: "flag",
        }),
        path: option(z.string().optional(), {
          short: "C",
          description: "Directory used to resolve a {{root}} template",
        }),
      },
      handler: async ({ positional, flags, prompt, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const toolName = requirePositional(positional, 1, "tool name");
        const variable = requirePositional(positional, 2, "variable name");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        const source = identity?.tools[toolName]?.env?.[variable];
        if (!source || typeof source === "string" || source.from !== "file") {
          throw new Error(
            `${identityId}/${toolName}:${variable} is not configured as a file source`,
          );
        }
        const value = flags.stdin
          ? await Bun.stdin.text()
          : await prompt.password(`Value for ${identityId}/${toolName}:${variable}`, {
              validate: (input) => input.length > 0 || "Value is required",
            });
        const home = os.homedir();
        const target = secretTarget(
          source.path,
          resolveSecretContext(
            config,
            identityId,
            home,
            source.path,
            flags.path,
          ),
          home,
          getIdealityHome(),
        );
        await writeSecret(target, value);
        console.log(colors.green(`Stored ${identityId}/${toolName}:${variable}`));
        console.log(colors.dim(target));
      },
    }),
    defineCommand({
      name: "list",
      description: "List credential references without reading their values",
      handler: async () => {
        const config = await loadConfig();
        const home = os.homedir();
        const idealityHome = getIdealityHome();
        const entries = Object.entries(config.identities).flatMap(
          ([identityId, identity]) =>
            Object.entries(identity.tools).flatMap(([toolName, profile]) =>
              Object.entries(profile.env ?? {})
                .filter(
                  (entry): entry is [
                    string,
                    { from: "file"; path: string; optional?: boolean },
                  ] =>
                    Boolean(
                      entry[1] &&
                        typeof entry[1] !== "string" &&
                        entry[1].from === "file",
                    ),
                )
                .flatMap(([variable, source]) =>
                  listSecretContexts(
                    config,
                    identityId,
                    home,
                    source.path,
                  ).map((resolved) => {
                    const file = secretTarget(
                      source.path,
                      resolved,
                      home,
                      idealityHome,
                    );
                    return {
                      identity: identityId,
                      tool: toolName,
                      variable,
                      root: source.path.includes("{{root}}")
                        ? resolved.matchedRoot
                        : null,
                      file,
                      present: Bun.file(file).exists(),
                      optional: source.optional ?? false,
                    };
                  }),
                ),
            ),
        );
        printJson(
          await Promise.all(
            entries.map(async (entry) => ({
              ...entry,
              present: await entry.present,
            })),
          ),
        );
      },
    }),
  ],
});

export default secretCommand;
