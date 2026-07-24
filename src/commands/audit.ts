import { defineCommand, defineGroup, option } from "@bunli/core";
import { z } from "zod";

import {
  AUDIT_EVENT_TYPES,
  AuditHistoryReadFailure,
  type AuditEvent,
  type AuditEventType,
  type AuditRecordResult,
  clearAuditHistory,
  getAuditHistoryPath,
  inspectAuditHistoryStatus,
  listAuditEvents,
  pruneAuditHistory,
  recordAuditAdministrationEvent,
  recordAuditEvent,
} from "../core/audit-history.js";
import {
  getIdealityHome,
  loadConfig,
  saveConfig,
} from "../core/config-store.js";
import { printJson } from "./shared.js";

function parseAuditEventType(
  value: string | undefined,
): AuditEventType | undefined {
  if (!value) return undefined;
  if (!AUDIT_EVENT_TYPES.has(value as AuditEventType)) {
    throw new Error(`Unknown audit event type '${value}'`);
  }
  return value as AuditEventType;
}

function formatPayload(payload: AuditEvent["payload"]): string {
  const entries = Object.entries(payload);
  return entries.length
    ? entries
        .map(([key, value]) =>
          Array.isArray(value)
            ? `${key}=${value.join(",")}`
            : `${key}=${value}`,
        )
        .join(" ")
    : "-";
}

export async function disableAuditHistory(
  config: Awaited<ReturnType<typeof loadConfig>>,
  idealityHome: string,
  save: (
    nextConfig: Awaited<ReturnType<typeof loadConfig>>,
  ) => Promise<void> = saveConfig,
): Promise<AuditRecordResult | null> {
  const wasEnabled = config.auditHistory?.enabled === true;
  config.auditHistory = {
    ...(config.auditHistory ?? {}),
    enabled: false,
  };
  await save(config);
  if (!wasEnabled) return null;
  return recordAuditAdministrationEvent(config, idealityHome, {
    eventType: "audit.disabled",
    payload: { action: "disable", scope: "local", status: "ok" },
  });
}

function printAuditAdminError(error: unknown, json: boolean): void {
  if (!json) throw error;
  const message = error instanceof Error ? error.message : String(error);
  printJson({
    error: {
      message,
      ...(error instanceof AuditHistoryReadFailure
        ? { readError: error.readError }
        : {}),
    },
  });
  process.exitCode = 1;
}

const auditCommand = defineGroup({
  name: "audit",
  description: "Administer opt-in local structured audit history",
  commands: [
    defineCommand({
      name: "status",
      description: "Inspect audit history settings and local storage",
      options: {
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        const config = await loadConfig();
        const status = await inspectAuditHistoryStatus(
          config,
          getIdealityHome(),
        );
        if (flags.json) {
          printJson(status);
          return;
        }
        console.log(
          `Audit history: ${status.enabled ? "enabled" : "disabled"}`,
        );
        console.log(`Path: ${status.path}`);
        console.log(`Events: ${status.events}`);
        console.log(`Corruptions: ${status.corruptions}`);
        console.log(
          `Retention: ${status.maxEvents} events, ${status.maxBytes} bytes${
            status.retentionDays ? `, ${status.retentionDays} days` : ""
          }`,
        );
        if (status.secure) {
          console.log(colors.green("Storage permissions: locked"));
        } else {
          console.log(colors.red("Storage permissions: unsafe"));
          for (const issue of status.issues) console.log(`- ${issue}`);
        }
        if (status.readError) {
          console.log(`Read error: ${status.readError.code}`);
        }
      },
    }),
    defineCommand({
      name: "enable",
      description: "Enable local audit history recording",
      options: {
        "max-events": option(z.coerce.number().int().min(1).optional(), {
          description: "Maximum retained events",
        }),
        "max-bytes": option(z.coerce.number().int().min(1024).optional(), {
          description: "Maximum audit file size in bytes",
        }),
        "retention-days": option(z.coerce.number().int().min(1).optional(), {
          description: "Maximum retained event age in days",
        }),
      },
      handler: async ({ flags, colors }) => {
        const config = await loadConfig();
        config.auditHistory = {
          ...(config.auditHistory ?? {}),
          enabled: true,
          ...(flags["max-events"] ? { maxEvents: flags["max-events"] } : {}),
          ...(flags["max-bytes"] ? { maxBytes: flags["max-bytes"] } : {}),
          ...(flags["retention-days"]
            ? { retentionDays: flags["retention-days"] }
            : {}),
        };
        await saveConfig(config);
        const result = await recordAuditEvent(config, getIdealityHome(), {
          eventType: "audit.enabled",
          payload: {
            action: "enable",
            scope: "local",
            status: resultStatus(config.auditHistory.enabled),
          },
        });
        if (result.error) {
          console.error(`audit: ${result.error}`);
        }
        console.log(colors.green(`Audit history enabled at ${result.path}`));
      },
    }),
    defineCommand({
      name: "disable",
      description: "Disable local audit history recording",
      handler: async ({ colors }) => {
        const config = await loadConfig();
        const result = await disableAuditHistory(config, getIdealityHome());
        if (result?.error) console.error(`audit: ${result.error}`);
        console.log(colors.green("Audit history disabled"));
      },
    }),
    defineCommand({
      name: "list",
      description: "List audit events",
      options: {
        json: option(z.boolean().default(false), {
          description: "Emit JSON",
          argumentKind: "flag",
        }),
        type: option(z.string().optional(), {
          description: "Filter by event type",
        }),
        since: option(z.string().optional(), {
          description: "Only show events at or after this ISO timestamp",
        }),
        until: option(z.string().optional(), {
          description: "Only show events at or before this ISO timestamp",
        }),
        limit: option(z.coerce.number().int().min(0).optional(), {
          description: "Show the newest N matching events",
        }),
      },
      handler: async ({ flags, colors }) => {
        const result = await listAuditEvents(getIdealityHome(), {
          eventType: parseAuditEventType(flags.type),
          since: flags.since,
          until: flags.until,
          limit: flags.limit,
        });
        if (flags.json) {
          printJson(result);
          return;
        }
        if (result.readError) {
          console.log(`Audit history read failed: ${result.readError.code}`);
        }
        for (const event of result.events) {
          console.log(
            `${String(event.sequence).padStart(6)} ${event.timestamp} ${event.eventType.padEnd(20)} ${formatPayload(event.payload)}`,
          );
        }
        if (result.corruptions.length > 0) {
          console.log(
            colors.yellow(
              `${result.corruptions.length} malformed audit line${
                result.corruptions.length === 1 ? "" : "s"
              } ignored`,
            ),
          );
        }
      },
    }),
    defineCommand({
      name: "prune",
      description: "Apply configured audit retention now",
      options: {
        confirm: option(z.boolean().default(false), {
          description: "Confirm audit history pruning",
          argumentKind: "flag",
        }),
        json: option(z.boolean().default(false), {
          description: "Emit JSON errors",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        if (!flags.confirm) {
          throw new Error("Audit pruning requires --confirm");
        }
        try {
          const config = await loadConfig();
          const result = await pruneAuditHistory(
            getIdealityHome(),
            config.auditHistory,
          );
          await recordAuditEvent(config, getIdealityHome(), {
            eventType: "audit.pruned",
            payload: result,
          });
          console.log(colors.green(`Pruned ${result.removed} audit events`));
        } catch (error) {
          printAuditAdminError(error, flags.json);
        }
      },
    }),
    defineCommand({
      name: "clear",
      description: "Clear local audit history",
      options: {
        confirm: option(z.boolean().default(false), {
          description: "Confirm audit history deletion",
          argumentKind: "flag",
        }),
        json: option(z.boolean().default(false), {
          description: "Emit JSON errors",
          argumentKind: "flag",
        }),
      },
      handler: async ({ flags, colors }) => {
        if (!flags.confirm) {
          throw new Error("Audit clear requires --confirm");
        }
        try {
          const result = await clearAuditHistory(getIdealityHome());
          console.log(
            colors.green(
              `Cleared ${result.removed} audit events from ${getAuditHistoryPath(getIdealityHome())}`,
            ),
          );
        } catch (error) {
          printAuditAdminError(error, flags.json);
        }
      },
    }),
  ],
});

function resultStatus(value: boolean | undefined): string {
  return value ? "ok" : "disabled";
}

export default auditCommand;
