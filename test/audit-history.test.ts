import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { disableAuditHistory } from "../src/commands/audit.js";
import {
  getAuditHistoryPath,
  inspectAuditHistoryStatus,
  listAuditEvents,
  recordAuditEvent,
} from "../src/core/audit-history.js";
import type { IdealityConfig } from "../src/domain/config.js";

function sampleConfig(
  auditHistory?: IdealityConfig["auditHistory"],
): IdealityConfig {
  return {
    version: 1,
    defaultIdentity: "sample",
    identities: {
      sample: { label: "Sample", roots: ["/workspace"], tools: {} },
    },
    tools: {},
    ...(auditHistory ? { auditHistory } : {}),
  };
}

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "ideality-audit-"));
}

async function isolatedCliHome(
  auditHistory?: IdealityConfig["auditHistory"],
  config: IdealityConfig = sampleConfig(auditHistory),
): Promise<{ idealityHome: string; configPath: string; home: string }> {
  const idealityHome = await tempHome();
  const configPath = path.join(idealityHome, "config.jsonc");
  await writeFile(configPath, `${JSON.stringify(config)}\n`);
  return {
    idealityHome,
    configPath,
    home: path.join(idealityHome, "home"),
  };
}

function runIdeality(
  context: { idealityHome: string; configPath: string; home: string },
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: context.home,
      IDEALITY_HOME: context.idealityHome,
      IDEALITY_CONFIG: context.configPath,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function jsonOutput<T>(result: { stdout: string }): T {
  return JSON.parse(result.stdout) as T;
}

describe("audit history", () => {
  test("does not create storage or record events unless explicitly enabled", async () => {
    const idealityHome = await tempHome();

    const result = await recordAuditEvent(sampleConfig(), idealityHome, {
      eventType: "config.changed",
      payload: { action: "validate" },
    });

    expect(result.recorded).toBe(false);
    expect(await Bun.file(getAuditHistoryPath(idealityHome)).exists()).toBe(
      false,
    );
  });

  test("stores enabled events in deterministic order with locked local permissions", async () => {
    const idealityHome = await tempHome();
    const config = sampleConfig({ enabled: true, maxEvents: 10 });

    await recordAuditEvent(config, idealityHome, {
      eventType: "config.changed",
      timestamp: "2026-07-24T10:00:00.000Z",
      payload: { action: "edit" },
    });
    await recordAuditEvent(config, idealityHome, {
      eventType: "plugin.installed",
      timestamp: "2026-07-24T10:00:01.000Z",
      payload: { pluginId: "demo", dryRun: false },
    });

    const listed = await listAuditEvents(idealityHome);
    expect(listed.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(listed.events.map((event) => event.eventType)).toEqual([
      "config.changed",
      "plugin.installed",
    ]);
    expect(
      (await stat(path.dirname(getAuditHistoryPath(idealityHome)))).mode &
        0o777,
    ).toBe(0o700);
    expect((await stat(getAuditHistoryPath(idealityHome))).mode & 0o777).toBe(
      0o600,
    );
  });

  test("allowlists and redacts payloads without storing token-like text", async () => {
    const idealityHome = await tempHome();
    const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";

    await recordAuditEvent(sampleConfig({ enabled: true }), idealityHome, {
      eventType: "secret.set",
      payload: {
        identity: "sample",
        tool: "gh",
        variable: "GH_TOKEN",
        backend: "file",
        reference: "/tmp/not-secret",
        value: token,
        stdout: `stored ${token}`,
        argv: ["secret", "set", token],
      } as never,
    });

    const raw = await Bun.file(getAuditHistoryPath(idealityHome)).text();
    const [event] = (await listAuditEvents(idealityHome)).events;
    expect(raw).not.toContain(token);
    expect(event?.payload).toEqual({
      identity: "sample",
      tool: "gh",
      variable: "GH_TOKEN",
      backend: "file",
      referenceKind: "absolute-path",
    });
  });

  test("reports malformed lines while preserving valid events", async () => {
    const idealityHome = await tempHome();
    const historyPath = getAuditHistoryPath(idealityHome);
    await mkdir(path.dirname(historyPath), { recursive: true, mode: 0o700 });
    await writeFile(
      historyPath,
      [
        "{not-json}",
        JSON.stringify({
          schemaVersion: 1,
          sequence: 7,
          timestamp: "2026-07-24T10:00:00.000Z",
          eventType: "auth.action",
          actor: { pid: 123 },
          payload: { identity: "sample", tool: "gh", action: "status" },
        }),
      ].join("\n"),
      { mode: 0o600 },
    );

    const listed = await listAuditEvents(idealityHome);
    expect(listed.events).toHaveLength(1);
    expect(listed.corruptions).toEqual([
      { line: 1, reason: "Invalid JSON audit event" },
    ]);
  });

  test("filters by type and time with newest limit after deterministic ordering", async () => {
    const idealityHome = await tempHome();
    const config = sampleConfig({ enabled: true, maxEvents: 10 });
    await recordAuditEvent(config, idealityHome, {
      eventType: "config.changed",
      timestamp: "2026-07-24T10:00:00.000Z",
      payload: { action: "edit" },
    });
    await recordAuditEvent(config, idealityHome, {
      eventType: "auth.action",
      timestamp: "2026-07-24T11:00:00.000Z",
      payload: { identity: "sample", tool: "gh", action: "login" },
    });
    await recordAuditEvent(config, idealityHome, {
      eventType: "auth.action",
      timestamp: "2026-07-24T12:00:00.000Z",
      payload: { identity: "sample", tool: "gh", action: "logout" },
    });

    const listed = await listAuditEvents(idealityHome, {
      eventType: "auth.action",
      since: "2026-07-24T10:30:00.000Z",
      limit: 1,
    });
    expect(listed.events.map((event) => event.payload)).toEqual([
      { identity: "sample", tool: "gh", action: "logout" },
    ]);
  });

  test("bounds retained history when maxEvents is configured", async () => {
    const idealityHome = await tempHome();
    const config = sampleConfig({ enabled: true, maxEvents: 2 });
    for (const index of [1, 2, 3]) {
      await recordAuditEvent(config, idealityHome, {
        eventType: "tool.dispatched",
        timestamp: `2026-07-24T10:00:0${index}.000Z`,
        payload: {
          identity: "sample",
          tool: "gh",
          executionTarget: "host",
          argvShape: "passthrough",
        },
      });
    }

    const listed = await listAuditEvents(idealityHome);
    expect(listed.events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  test("status flags unsafe storage permissions", async () => {
    const idealityHome = await tempHome();
    const historyPath = getAuditHistoryPath(idealityHome);
    await mkdir(path.dirname(historyPath), { recursive: true, mode: 0o755 });
    await writeFile(historyPath, "", { mode: 0o644 });

    const status = await inspectAuditHistoryStatus(
      sampleConfig({ enabled: true }),
      idealityHome,
    );

    expect(status.enabled).toBe(true);
    expect(status.secure).toBe(false);
    expect(status.issues).toEqual([
      "audit directory permissions must be 0700",
      "audit file permissions must be 0600",
    ]);
  });

  test("clear on a fresh home does not create audit storage", async () => {
    const context = await isolatedCliHome();

    const result = runIdeality(context, ["audit", "clear", "--confirm"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Cleared 0 audit events");
    expect(
      await Bun.file(path.join(context.idealityHome, "audit")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(getAuditHistoryPath(context.idealityHome)).exists(),
    ).toBe(false);
  }, 20_000);

  test("CLI covers status/list forms, enable/disable, filters, and confirmation gates", async () => {
    const context = await isolatedCliHome();

    const initialStatus = runIdeality(context, ["audit", "status", "--json"]);
    expect(initialStatus.exitCode).toBe(0);
    expect(
      jsonOutput<{ enabled: boolean; exists: boolean }>(initialStatus),
    ).toMatchObject({
      enabled: false,
      exists: false,
    });
    expect(runIdeality(context, ["audit", "status"]).stdout).toContain(
      "Audit history: disabled",
    );
    expect(
      jsonOutput<{
        events: unknown[];
        corruptions: unknown[];
        readError: { code: string; message: string } | null;
      }>(runIdeality(context, ["audit", "list", "--json"])),
    ).toEqual({
      events: [],
      corruptions: [],
      readError: null,
    });

    expect(runIdeality(context, ["audit", "prune"]).exitCode).toBe(1);
    expect(runIdeality(context, ["audit", "clear"]).exitCode).toBe(1);

    const enabled = runIdeality(context, [
      "audit",
      "enable",
      "--max-events",
      "3",
      "--max-bytes",
      "4096",
    ]);
    expect(enabled.exitCode).toBe(0);

    const humanList = runIdeality(context, [
      "audit",
      "list",
      "--type",
      "audit.enabled",
    ]);
    expect(humanList.exitCode).toBe(0);
    expect(humanList.stdout).toContain("audit.enabled");
    expect(humanList.stdout).toContain("action=enable");

    const filtered = jsonOutput<{ events: Array<{ eventType: string }> }>(
      runIdeality(context, [
        "audit",
        "list",
        "--type",
        "audit.enabled",
        "--json",
      ]),
    );
    expect(filtered.events.map((event) => event.eventType)).toEqual([
      "audit.enabled",
    ]);

    expect(runIdeality(context, ["audit", "prune", "--confirm"]).exitCode).toBe(
      0,
    );
    expect(runIdeality(context, ["audit", "clear", "--confirm"]).exitCode).toBe(
      0,
    );
    expect(
      (await Bun.file(getAuditHistoryPath(context.idealityHome)).text()).trim(),
    ).toBe("");

    expect(runIdeality(context, ["audit", "disable"]).exitCode).toBe(0);
    expect(
      jsonOutput<{ enabled: boolean }>(
        runIdeality(context, ["audit", "status", "--json"]),
      ).enabled,
    ).toBe(false);
  }, 80_000);

  test("CLI reports corrupt audit lines in human and JSON output", async () => {
    const context = await isolatedCliHome({ enabled: true });
    const historyPath = getAuditHistoryPath(context.idealityHome);
    await mkdir(path.dirname(historyPath), { recursive: true, mode: 0o700 });
    await writeFile(
      historyPath,
      [
        "{bad-json}",
        JSON.stringify({
          schemaVersion: 1,
          sequence: 1,
          timestamp: "2026-07-24T10:00:00.000Z",
          eventType: "auth.action",
          actor: { pid: 123, uid: 456, user: "tester" },
          payload: { identity: "sample", tool: "gh", action: "status" },
        }),
      ].join("\n"),
      { mode: 0o600 },
    );

    const humanList = runIdeality(context, ["audit", "list"]);
    expect(humanList.exitCode).toBe(0);
    expect(humanList.stdout).toContain("auth.action");
    expect(humanList.stdout).toContain("1 malformed audit line ignored");

    const listed = jsonOutput<{
      events: unknown[];
      corruptions: Array<{ line: number; reason: string }>;
    }>(runIdeality(context, ["audit", "list", "--json"]));
    expect(listed.events).toHaveLength(1);
    expect(listed.corruptions).toEqual([
      { line: 1, reason: "Invalid JSON audit event" },
    ]);

    const status = jsonOutput<{ corruptions: number }>(
      runIdeality(context, ["audit", "status", "--json"]),
    );
    expect(status.corruptions).toBe(1);
  }, 30_000);

  test("CLI surfaces audit read failures in status and list output", async () => {
    const context = await isolatedCliHome({ enabled: true });
    const historyPath = getAuditHistoryPath(context.idealityHome);
    await mkdir(historyPath, { recursive: true, mode: 0o700 });

    const listed = jsonOutput<{
      readError: { code: string; message: string } | null;
    }>(runIdeality(context, ["audit", "list", "--json"]));
    expect(listed.readError).toEqual({
      code: "EISDIR",
      message: "audit history file could not be read",
    });

    const humanList = runIdeality(context, ["audit", "list"]);
    expect(humanList.exitCode).toBe(0);
    expect(humanList.stdout).toContain("Audit history read failed: EISDIR");

    const status = jsonOutput<{
      readError: { code: string; message: string } | null;
      issues: string[];
    }>(runIdeality(context, ["audit", "status", "--json"]));
    expect(status.readError).toEqual({
      code: "EISDIR",
      message: "audit history file could not be read",
    });
    expect(status.issues).toContain("audit file read failed: EISDIR");
    expect(runIdeality(context, ["audit", "status"]).stdout).toContain(
      "Read error: EISDIR",
    );
  }, 30_000);

  test("CLI clear and prune surface non-ENOENT audit read failures in human and JSON output", async () => {
    for (const command of ["clear", "prune"] as const) {
      const context = await isolatedCliHome({ enabled: true });
      await mkdir(getAuditHistoryPath(context.idealityHome), {
        recursive: true,
        mode: 0o700,
      });

      const human = runIdeality(context, ["audit", command, "--confirm"]);
      expect(human.exitCode).toBe(1);
      expect(human.stderr).toContain("Audit history read failed: EISDIR");

      const json = runIdeality(context, [
        "audit",
        command,
        "--confirm",
        "--json",
      ]);
      expect(json.exitCode).toBe(1);
      expect(
        jsonOutput<{
          error: {
            message: string;
            readError: { code: string; message: string };
          };
        }>(json),
      ).toEqual({
        error: {
          message: "Audit history read failed: EISDIR",
          readError: {
            code: "EISDIR",
            message: "audit history file could not be read",
          },
        },
      });
    }
  }, 50_000);

  test("disable does not record a success event when saving disabled config fails", async () => {
    const idealityHome = await tempHome();
    const config = sampleConfig({ enabled: true });
    await recordAuditEvent(config, idealityHome, {
      eventType: "audit.enabled",
      payload: { action: "enable", scope: "local", status: "ok" },
    });

    await expect(
      disableAuditHistory(config, idealityHome, async () => {
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");

    const listed = await listAuditEvents(idealityHome, {
      eventType: "audit.disabled",
    });
    expect(listed.events).toEqual([]);
  });

  test("run preflight failure does not emit a tool dispatched success event", async () => {
    const missingToolConfig = sampleConfig({ enabled: true });
    missingToolConfig.tools.missing = {
      executable: "ideality-missing-executable-for-audit-test",
    };
    missingToolConfig.identities.sample.tools.missing = { enabled: true };
    const context = await isolatedCliHome(
      missingToolConfig.auditHistory,
      missingToolConfig,
    );

    const failed = runIdeality(context, [
      "run",
      "missing",
      "--identity",
      "sample",
    ]);

    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain("is not installed");
    const listed = jsonOutput<{ events: unknown[] }>(
      runIdeality(context, [
        "audit",
        "list",
        "--type",
        "tool.dispatched",
        "--json",
      ]),
    );
    expect(listed.events).toEqual([]);
  }, 30_000);
});
