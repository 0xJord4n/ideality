import { describe, expect, test } from "bun:test";

import {
  keyValue,
  statusSummary,
  table,
  tidyPath,
  visibleWidth,
} from "../src/commands/ui.js";

describe("tidyPath", () => {
  test("collapses the home prefix to ~", () => {
    expect(tidyPath("/home/dev/code/acme", "/home/dev")).toBe("~/code/acme");
  });

  test("returns ~ for the home directory itself", () => {
    expect(tidyPath("/home/dev", "/home/dev")).toBe("~");
  });

  test("leaves foreign paths and lookalike prefixes untouched", () => {
    expect(tidyPath("/srv/data", "/home/dev")).toBe("/srv/data");
    expect(tidyPath("/home/developer/x", "/home/dev")).toBe(
      "/home/developer/x",
    );
  });
});

describe("visibleWidth", () => {
  test("ignores ANSI escape sequences", () => {
    expect(visibleWidth("\x1b[32mready\x1b[0m")).toBe(5);
  });
});

describe("keyValue", () => {
  test("aligns keys and skips empty values", () => {
    const block = keyValue([
      ["identity", "work"],
      ["ssh", undefined],
      ["matched root", "~/code"],
    ]);
    const lines = block.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("identity");
    expect(lines[0]).toContain("work");
    expect(lines[1]).toContain("matched root");
    const valueColumn = (line: string) => line.indexOf("  ~/code");
    expect(lines[0]?.indexOf("work")).toBe(
      (lines[1] ? valueColumn(lines[1]) : -1) + 2,
    );
  });
});

describe("table", () => {
  test("aligns columns using visible width", () => {
    const rendered = table({
      head: ["tool", "state"],
      rows: [
        ["gh", "\x1b[32mready\x1b[0m"],
        ["railway", "missing"],
      ],
    });
    const lines = rendered.split("\n").map((line) => Bun.stripANSI(line));
    expect(lines[0]).toBe("  tool     state");
    expect(lines[1]).toBe("  gh       ready");
    expect(lines[2]).toBe("  railway  missing");
  });
});

describe("statusSummary", () => {
  test("reports counts with pluralization and omits zeroes", () => {
    const summary = statusSummary({ ok: 3, warn: 1 });
    expect(summary).toContain("3 passed");
    expect(summary).toContain("1 warning");
    expect(summary).not.toContain("warnings");
    expect(summary).not.toContain("failed");
  });
});
