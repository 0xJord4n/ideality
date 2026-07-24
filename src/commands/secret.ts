import os from "node:os";

import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { renderTemplate } from "../core/environment.js";
import {
  secretBackendWritable,
  writeSecretValue,
} from "../core/secret-backends.js";
import type { ResolvedIdentity } from "../domain/config.js";
import {
  listSecretContexts,
  resolveSecretContext,
  writeSecret,
} from "../integrations/secrets.js";
import { printJson, requirePositional } from "./shared.js";

type StoredSource =
  | { from: "file"; path: string; optional?: boolean }
  | { from: "secret"; key: string; optional?: boolean };

function isStoredSource(value: unknown): value is StoredSource {
  return Boolean(
    value &&
      typeof value === "object" &&
      "from" in value &&
      (value.from === "file" || value.from === "secret"),
  );
}

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
  description: "Manage process-scoped secret references and backends",
  commands: [
    defineCommand({
      name: "set",
      description: "Securely write a configured secret reference",
      options: {
        stdin: option(z.boolean().default(false), {
          description: "Read the value from standard input",
          argumentKind: "flag",
        }),
        path: option(z.string().optional(), {
          short: "C",
          description: "Directory used to resolve a {{root}} template",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Validate and show the target without reading a value",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, prompt, colors }) => {
        const identityId = requirePositional(positional, 0, "identity ID");
        const toolName = requirePositional(positional, 1, "tool name");
        const variable = requirePositional(positional, 2, "variable name");
        const config = await loadConfig();
        const identity = config.identities[identityId];
        const source = identity?.tools[toolName]?.env?.[variable];
        if (!isStoredSource(source)) {
          throw new Error(
            `${identityId}/${toolName}:${variable} is not configured as a secret or file source`,
          );
        }
        const home = os.homedir();
        const reference = source.from === "file" ? source.path : source.key;
        const resolved = resolveSecretContext(
          config,
          identityId,
          home,
          reference,
          flags.path,
        );
        const renderedReference = renderTemplate(
          reference,
          resolved,
          home,
          getIdealityHome(),
        );
        if (flags["dry-run"]) {
          console.log(
            `Would store ${identityId}/${toolName}:${variable} at ${
              source.from === "file"
                ? renderedReference
                : `${config.secretBackend?.type ?? "file"}:${renderedReference}`
            }`,
          );
          return;
        }
        if (source.from === "secret" && !secretBackendWritable(config)) {
          throw new Error(
            `${config.secretBackend?.type ?? "file"} references are read-only; create or update the item with its native app or CLI`,
          );
        }
        const value = flags.stdin
          ? await Bun.stdin.text()
          : await prompt.password(
              `Value for ${identityId}/${toolName}:${variable}`,
              {
                validate: (input) => input.length > 0 || "Value is required",
              },
            );
        if (source.from === "secret") {
          const key = renderedReference;
          await writeSecretValue(config, key, value, home, getIdealityHome());
          console.log(
            colors.green(`Stored ${identityId}/${toolName}:${variable}`),
          );
          console.log(
            colors.dim(`${config.secretBackend?.type ?? "file"}:${key}`),
          );
          return;
        }
        const target = secretTarget(
          source.path,
          resolved,
          home,
          getIdealityHome(),
        );
        await writeSecret(target, value);
        console.log(
          colors.green(`Stored ${identityId}/${toolName}:${variable}`),
        );
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
                .filter((entry): entry is [string, StoredSource] =>
                  isStoredSource(entry[1]),
                )
                .flatMap(([variable, source]) =>
                  listSecretContexts(
                    config,
                    identityId,
                    home,
                    source.from === "file" ? source.path : source.key,
                  ).map((resolved) => {
                    const reference =
                      source.from === "file"
                        ? secretTarget(
                            source.path,
                            resolved,
                            home,
                            idealityHome,
                          )
                        : renderTemplate(
                            source.key,
                            resolved,
                            home,
                            idealityHome,
                          );
                    return {
                      identity: identityId,
                      tool: toolName,
                      variable,
                      root: (source.from === "file"
                        ? source.path
                        : source.key
                      ).includes("{{root}}")
                        ? resolved.matchedRoot
                        : null,
                      backend:
                        source.from === "file"
                          ? "file"
                          : (config.secretBackend?.type ?? "file"),
                      reference,
                      present:
                        source.from === "file"
                          ? Bun.file(reference).exists()
                          : null,
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
              present:
                entry.present instanceof Promise
                  ? await entry.present
                  : entry.present,
            })),
          ),
        );
      },
    }),
    defineCommand({
      name: "backend",
      description: "Show or select a local or password-manager secret backend",
      options: {
        directory: option(z.string().optional(), {
          description: "Override the file or age storage directory",
        }),
        recipient: option(z.string().optional(), {
          description: "age recipient used for encryption",
        }),
        "identity-file": option(z.string().optional(), {
          description: "age identity file used for decryption",
        }),
        service: option(z.string().optional(), {
          description: "Desktop keychain service name",
        }),
        prefix: option(z.string().optional(), {
          description: "pass store prefix",
        }),
        "app-data-directory": option(z.string().optional(), {
          description: "Bitwarden CLI account data directory",
        }),
        "dry-run": option(z.boolean().default(false), {
          description: "Validate and show the backend without saving it",
          argumentKind: "flag",
        }),
      },
      handler: async ({ positional, flags, colors }) => {
        const config = await loadConfig();
        const type = positional[0];
        if (!type) {
          console.log(
            JSON.stringify(config.secretBackend ?? { type: "file" }, null, 2),
          );
          return;
        }
        if (type === "file") {
          config.secretBackend = {
            type,
            ...(flags.directory ? { directory: flags.directory } : {}),
          };
        } else if (type === "age") {
          if (!flags.recipient || !flags["identity-file"]) {
            throw new Error(
              "The age backend requires --recipient and --identity-file",
            );
          }
          config.secretBackend = {
            type,
            recipient: flags.recipient,
            identityFile: flags["identity-file"],
            ...(flags.directory ? { directory: flags.directory } : {}),
          };
        } else if (type === "keychain") {
          config.secretBackend = {
            type,
            ...(flags.service ? { service: flags.service } : {}),
          };
        } else if (type === "pass") {
          config.secretBackend = {
            type,
            ...(flags.prefix ? { prefix: flags.prefix } : {}),
          };
        } else if (type === "onepassword") {
          config.secretBackend = { type };
        } else if (type === "bitwarden") {
          config.secretBackend = {
            type,
            ...(flags["app-data-directory"]
              ? { appDataDirectory: flags["app-data-directory"] }
              : {}),
          };
        } else if (type === "dashlane") {
          config.secretBackend = { type };
        } else {
          throw new Error(`Unknown secret backend '${type}'`);
        }
        if (!flags["dry-run"]) await saveConfig(config);
        console.log(colors.green(`Secret backend: ${type}`));
      },
    }),
  ],
});

export default secretCommand;
