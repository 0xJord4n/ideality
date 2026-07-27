import { describe, expect, test } from "bun:test";
import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  renderCommandHelpText,
  renderRootHelpText,
} from "../src/commands/help.js";
import {
  IDEALITY_COMMAND_GROUPS,
  IDEALITY_COMMAND_NAMES,
} from "../src/commands/names.js";

const ctx = { cliName: "ideality", version: "0.0.0" };

function stubCommands() {
  return IDEALITY_COMMAND_NAMES.map((name) =>
    defineCommand({
      name,
      description: `${name} description`,
      handler: async () => {},
    }),
  );
}

describe("renderRootHelpText", () => {
  test("lists every command under its group title", () => {
    const text = renderRootHelpText({ ...ctx, commands: stubCommands() }, true);
    for (const group of IDEALITY_COMMAND_GROUPS) {
      expect(text).toContain(group.title);
    }
    for (const name of IDEALITY_COMMAND_NAMES) {
      expect(text).toContain(`${name} description`);
    }
  });

  test("shows the first-run callout only when unconfigured", () => {
    const commands = stubCommands();
    expect(renderRootHelpText({ ...ctx, commands }, false)).toContain(
      "First time here?",
    );
    expect(renderRootHelpText({ ...ctx, commands }, true)).not.toContain(
      "First time here?",
    );
  });
});

describe("renderCommandHelpText", () => {
  test("renders aliases, value placeholders, and flags", () => {
    const command = defineCommand({
      name: "status",
      alias: ["whoami"],
      description: "Show the identity active for a directory",
      options: {
        path: option(z.string().default("."), {
          short: "C",
          description: "Path used for identity resolution",
        }),
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
      },
      handler: async () => {},
    });
    const text = renderCommandHelpText(ctx, command);
    expect(text).toContain("(alias: whoami)");
    expect(text).toContain("-C, --path <value>");
    expect(text).toContain("--json");
    expect(text).not.toContain("--json <value>");
    expect(text).toContain("Examples");
  });

  test("uses usage overrides for positional commands", () => {
    const command = defineCommand({
      name: "run",
      description: "Run a tool inside its selected identity",
      handler: async () => {},
    });
    expect(renderCommandHelpText(ctx, command)).toContain(
      "ideality run <tool> [options] [-- tool-args...]",
    );
  });

  test("lists subcommands for command groups", () => {
    const group = defineGroup({
      name: "identity",
      description: "Create and manage identities",
      commands: [
        defineCommand({
          name: "list",
          description: "List identities",
          handler: async () => {},
        }),
      ],
    });
    const text = renderCommandHelpText(ctx, group);
    expect(text).toContain("Subcommands");
    expect(text).toContain("List identities");
  });
});
