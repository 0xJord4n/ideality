import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AuditHistoryConfig, IdealityConfig } from "../domain/config.js";

export const AUDIT_SCHEMA_VERSION = 1;
export const DEFAULT_AUDIT_MAX_EVENTS = 1000;
export const DEFAULT_AUDIT_MAX_BYTES = 5 * 1024 * 1024;

export type AuditEventType =
  | "audit.enabled"
  | "audit.disabled"
  | "audit.cleared"
  | "audit.pruned"
  | "config.changed"
  | "config.migrated"
  | "config.rollback"
  | "setup.decision"
  | "policy.checked"
  | "plugin.installed"
  | "plugin.removed"
  | "secret.set"
  | "secret.backend.changed"
  | "auth.action"
  | "tool.dispatched"
  | "network.added"
  | "network.bound"
  | "network.activated"
  | "network.deactivated"
  | "network.status"
  | "vm.added"
  | "vm.bound"
  | "vm.unbound"
  | "vm.started"
  | "vm.stopped"
  | "vm.status"
  | "vm.exec";

export type AuditPayload = Record<
  string,
  string | number | boolean | null | string[]
>;

export interface AuditEvent {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  sequence: number;
  timestamp: string;
  eventType: AuditEventType;
  actor: {
    pid: number;
    uid: number | null;
    user: string | null;
  };
  payload: AuditPayload;
}

export interface AuditEventInput {
  eventType: AuditEventType;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export interface AuditCorruption {
  line: number;
  reason: string;
}

export interface AuditReadError {
  code: string;
  message: "audit history file could not be read";
}

export interface AuditListFilters {
  eventType?: AuditEventType;
  since?: string;
  until?: string;
  limit?: number;
}

export interface AuditListResult {
  events: AuditEvent[];
  corruptions: AuditCorruption[];
  readError: AuditReadError | null;
}

export interface AuditRecordResult {
  recorded: boolean;
  path: string;
  sequence: number | null;
  reason?: "disabled";
  error?: string;
}

export interface AuditHistoryStatus {
  enabled: boolean;
  path: string;
  exists: boolean;
  secure: boolean;
  issues: string[];
  events: number;
  corruptions: number;
  bytes: number;
  maxEvents: number;
  maxBytes: number;
  retentionDays: number | null;
  readError: AuditReadError | null;
}

export class AuditHistoryReadFailure extends Error {
  readonly readError: AuditReadError;

  constructor(readError: AuditReadError) {
    super(`Audit history read failed: ${readError.code}`);
    this.name = "AuditHistoryReadFailure";
    this.readError = readError;
  }
}

const TOKEN_PATTERNS = [
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b[A-Za-z0-9_-]{32,}\b/g,
] as const;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export function getAuditHistoryPath(idealityHome: string): string {
  return path.join(idealityHome, "audit", "history.jsonl");
}

export function auditHistoryEnabled(config: IdealityConfig): boolean {
  return config.auditHistory?.enabled === true;
}

export async function recordAuditEvent(
  config: IdealityConfig,
  idealityHome: string,
  input: AuditEventInput,
): Promise<AuditRecordResult> {
  const historyPath = getAuditHistoryPath(idealityHome);
  if (!auditHistoryEnabled(config)) {
    return {
      recorded: false,
      path: historyPath,
      sequence: null,
      reason: "disabled",
    };
  }

  return appendAuditEvent(config, idealityHome, input);
}

export async function recordAuditAdministrationEvent(
  config: IdealityConfig,
  idealityHome: string,
  input: AuditEventInput & { eventType: "audit.disabled" },
): Promise<AuditRecordResult> {
  return appendAuditEvent(config, idealityHome, input);
}

async function appendAuditEvent(
  config: IdealityConfig,
  idealityHome: string,
  input: AuditEventInput,
): Promise<AuditRecordResult> {
  const historyPath = getAuditHistoryPath(idealityHome);
  try {
    return await withAuditLock(idealityHome, async () => {
      await ensureAuditStorage(historyPath);
      const existing = await readAuditFile(historyPath);
      if (existing.readError) {
        throw new AuditHistoryReadFailure(existing.readError);
      }
      const sequence = nextSequence(existing.events);
      const event: AuditEvent = {
        schemaVersion: AUDIT_SCHEMA_VERSION,
        sequence,
        timestamp: input.timestamp ?? new Date().toISOString(),
        eventType: input.eventType,
        actor: auditActor(),
        payload: sanitizePayload(input.eventType, input.payload ?? {}),
      };
      await appendFile(historyPath, `${JSON.stringify(event)}\n`, {
        mode: 0o600,
      });
      await chmod(historyPath, 0o600);
      await applyRetention(historyPath, config.auditHistory);
      return { recorded: true, path: historyPath, sequence };
    });
  } catch (error) {
    return {
      recorded: false,
      path: historyPath,
      sequence: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listAuditEvents(
  idealityHome: string,
  filters: AuditListFilters = {},
): Promise<AuditListResult> {
  const historyPath = getAuditHistoryPath(idealityHome);
  const listed = await readAuditFile(historyPath);
  const since = filters.since ? Date.parse(filters.since) : null;
  const until = filters.until ? Date.parse(filters.until) : null;
  let events = listed.events.filter((event) => {
    if (filters.eventType && event.eventType !== filters.eventType) {
      return false;
    }
    const timestamp = Date.parse(event.timestamp);
    if (since !== null && timestamp < since) return false;
    if (until !== null && timestamp > until) return false;
    return true;
  });
  events = sortEvents(events);
  if (filters.limit !== undefined) {
    events = events.slice(-Math.max(0, filters.limit));
  }
  return {
    events,
    corruptions: listed.corruptions,
    readError: listed.readError,
  };
}

export async function inspectAuditHistoryStatus(
  config: IdealityConfig,
  idealityHome: string,
): Promise<AuditHistoryStatus> {
  const historyPath = getAuditHistoryPath(idealityHome);
  const settings = normalizedSettings(config.auditHistory);
  const [directoryStatus, fileStatus, listed] = await Promise.all([
    permissionIssue(path.dirname(historyPath), 0o700, "audit directory"),
    permissionIssue(historyPath, 0o600, "audit file"),
    readAuditFile(historyPath),
  ]);
  const fileStats = await stat(historyPath).catch(() => null);
  const issues = [directoryStatus, fileStatus].filter(
    (issue): issue is string => Boolean(issue),
  );
  if (listed.readError) {
    issues.push(`audit file read failed: ${listed.readError.code}`);
  }
  return {
    enabled: auditHistoryEnabled(config),
    path: historyPath,
    exists: Boolean(fileStats),
    secure: issues.length === 0,
    issues,
    events: listed.events.length,
    corruptions: listed.corruptions.length,
    bytes: fileStats?.size ?? 0,
    maxEvents: settings.maxEvents,
    maxBytes: settings.maxBytes,
    retentionDays: settings.retentionDays ?? null,
    readError: listed.readError,
  };
}

export async function pruneAuditHistory(
  idealityHome: string,
  settings: AuditHistoryConfig = {},
): Promise<{ removed: number; remaining: number }> {
  const historyPath = getAuditHistoryPath(idealityHome);
  if (!(await historyFileIsRegularOrMissing(historyPath))) {
    return { removed: 0, remaining: 0 };
  }
  return withAuditLock(idealityHome, async () => {
    const before = await readAuditFile(historyPath);
    if (before.readError) {
      throw new AuditHistoryReadFailure(before.readError);
    }
    await writeRetainedEvents(
      historyPath,
      retainEvents(before.events, settings),
    );
    const after = await readAuditFile(historyPath);
    return {
      removed: before.events.length - after.events.length,
      remaining: after.events.length,
    };
  });
}

export async function clearAuditHistory(
  idealityHome: string,
): Promise<{ removed: number }> {
  const historyPath = getAuditHistoryPath(idealityHome);
  if (!(await historyFileIsRegularOrMissing(historyPath))) {
    return { removed: 0 };
  }
  return withAuditLock(idealityHome, async () => {
    const before = await readAuditFile(historyPath);
    if (before.readError) {
      throw new AuditHistoryReadFailure(before.readError);
    }
    await writeFile(historyPath, "", { mode: 0o600 });
    await chmod(historyPath, 0o600);
    return { removed: before.events.length };
  });
}

async function withAuditLock<T>(
  idealityHome: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(idealityHome, "audit", "history.lock");
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        return await action();
      } finally {
        await rm(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const lockStats = await stat(lockPath).catch(() => null);
      if (lockStats && Date.now() - lockStats.mtimeMs > 30_000) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await Bun.sleep(25);
    }
  }
  throw new Error("Timed out waiting for audit history lock");
}

async function ensureAuditStorage(historyPath: string): Promise<void> {
  await mkdir(path.dirname(historyPath), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(historyPath), 0o700);
  if (!(await Bun.file(historyPath).exists())) {
    await writeFile(historyPath, "", { mode: 0o600 });
  }
  await chmod(historyPath, 0o600);
}

async function readAuditFile(historyPath: string): Promise<AuditListResult> {
  const content = await readFile(historyPath, "utf8").catch((error) => {
    if (isErrno(error, "ENOENT")) return null;
    return auditReadError(error);
  });
  if (content === null) {
    return { events: [], corruptions: [], readError: null };
  }
  if (typeof content !== "string") {
    return { events: [], corruptions: [], readError: content };
  }
  const events: AuditEvent[] = [];
  const corruptions: AuditCorruption[] = [];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isAuditEvent(parsed)) {
        corruptions.push({
          line: index + 1,
          reason: "Invalid audit event schema",
        });
        continue;
      }
      events.push(parsed);
    } catch {
      corruptions.push({ line: index + 1, reason: "Invalid JSON audit event" });
    }
  }
  return { events: sortEvents(events), corruptions, readError: null };
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const event = value as Partial<AuditEvent>;
  return (
    event.schemaVersion === AUDIT_SCHEMA_VERSION &&
    Number.isInteger(event.sequence) &&
    (event.sequence ?? 0) > 0 &&
    typeof event.timestamp === "string" &&
    !Number.isNaN(Date.parse(event.timestamp)) &&
    typeof event.eventType === "string" &&
    isAuditEventType(event.eventType) &&
    Boolean(event.actor && typeof event.actor === "object") &&
    Boolean(event.payload && typeof event.payload === "object")
  );
}

function isAuditEventType(value: string): value is AuditEventType {
  return AUDIT_EVENT_TYPES.has(value as AuditEventType);
}

export const AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  "audit.enabled",
  "audit.disabled",
  "audit.cleared",
  "audit.pruned",
  "config.changed",
  "config.migrated",
  "config.rollback",
  "setup.decision",
  "policy.checked",
  "plugin.installed",
  "plugin.removed",
  "secret.set",
  "secret.backend.changed",
  "auth.action",
  "tool.dispatched",
  "network.added",
  "network.bound",
  "network.activated",
  "network.deactivated",
  "network.status",
  "vm.added",
  "vm.bound",
  "vm.unbound",
  "vm.started",
  "vm.stopped",
  "vm.status",
  "vm.exec",
]);

function sortEvents(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.timestamp.localeCompare(right.timestamp) ||
      left.eventType.localeCompare(right.eventType),
  );
}

function nextSequence(events: AuditEvent[]): number {
  return (
    events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1
  );
}

async function applyRetention(
  historyPath: string,
  settings: AuditHistoryConfig | undefined,
): Promise<void> {
  const listed = await readAuditFile(historyPath);
  if (listed.readError) {
    throw new AuditHistoryReadFailure(listed.readError);
  }
  const retained = retainEvents(listed.events, settings);
  if (retained.length !== listed.events.length) {
    await writeRetainedEvents(historyPath, retained);
    return;
  }
  const maxBytes = normalizedSettings(settings).maxBytes;
  let encoded = encodeEvents(retained);
  if (Buffer.byteLength(encoded) <= maxBytes) return;
  const bounded = [...retained];
  while (bounded.length > 1 && Buffer.byteLength(encoded) > maxBytes) {
    bounded.shift();
    encoded = encodeEvents(bounded);
  }
  await writeRetainedEvents(historyPath, bounded);
}

function retainEvents(
  events: AuditEvent[],
  settings: AuditHistoryConfig | undefined,
): AuditEvent[] {
  const normalized = normalizedSettings(settings);
  const minimumTimestamp =
    normalized.retentionDays === undefined
      ? null
      : Date.now() - normalized.retentionDays * 24 * 60 * 60 * 1000;
  let retained =
    minimumTimestamp === null
      ? sortEvents(events)
      : sortEvents(events).filter(
          (event) => Date.parse(event.timestamp) >= minimumTimestamp,
        );
  retained = retained.slice(-normalized.maxEvents);
  return retained;
}

async function writeRetainedEvents(
  historyPath: string,
  events: AuditEvent[],
): Promise<void> {
  await ensureAuditStorage(historyPath);
  await writeFile(historyPath, encodeEvents(events), { mode: 0o600 });
  await chmod(historyPath, 0o600);
}

function encodeEvents(events: AuditEvent[]): string {
  return (
    events.map((event) => JSON.stringify(event)).join("\n") +
    (events.length ? "\n" : "")
  );
}

function normalizedSettings(settings: AuditHistoryConfig | undefined): {
  maxEvents: number;
  maxBytes: number;
  retentionDays: number | undefined;
} {
  return {
    maxEvents: settings?.maxEvents ?? DEFAULT_AUDIT_MAX_EVENTS,
    maxBytes: settings?.maxBytes ?? DEFAULT_AUDIT_MAX_BYTES,
    retentionDays: settings?.retentionDays,
  };
}

function auditActor(): AuditEvent["actor"] {
  return {
    pid: process.pid,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    user: safeString(os.userInfo().username),
  };
}

function sanitizePayload(
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): AuditPayload {
  switch (eventType) {
    case "audit.enabled":
    case "audit.disabled":
    case "config.changed":
    case "config.migrated":
    case "config.rollback":
      return pickStrings(payload, ["action", "scope", "status"]);
    case "audit.cleared":
    case "audit.pruned":
      return pickNumbers(payload, ["removed", "remaining"]);
    case "setup.decision":
      return {
        ...pickStrings(payload, ["identity", "scope", "detail", "execution"]),
        ...pickStringArrays(payload, ["tools", "integrations"]),
        ...pickBooleans(payload, ["project", "localOnly", "dryRun"]),
      };
    case "policy.checked":
      return {
        ...pickStrings(payload, ["status", "policyPath"]),
        ...pickNumbers(payload, ["findings"]),
      };
    case "plugin.installed":
    case "plugin.removed":
      return {
        ...pickStrings(payload, ["pluginId"]),
        ...pickBooleans(payload, ["dryRun", "force"]),
      };
    case "secret.set":
      return {
        ...pickStrings(payload, ["identity", "tool", "variable", "backend"]),
        referenceKind: referenceKind(payload.reference),
      };
    case "secret.backend.changed":
      return pickStrings(payload, ["backend", "action"]);
    case "auth.action":
      return {
        ...pickStrings(payload, ["identity", "tool", "action"]),
        ...pickNumbers(payload, ["exitCode"]),
      };
    case "tool.dispatched":
      return {
        ...pickStrings(payload, [
          "identity",
          "tool",
          "executionTarget",
          "network",
          "vm",
          "argvShape",
        ]),
        ...pickNumbers(payload, ["argsCount"]),
      };
    case "network.added":
      return {
        ...pickStrings(payload, ["network", "driver", "killSwitch"]),
        ...pickBooleans(payload, ["dryRun"]),
      };
    case "network.bound":
      return pickStrings(payload, ["identity", "tool", "network"]);
    case "network.activated":
    case "network.deactivated":
    case "network.status":
      return {
        ...pickStrings(payload, [
          "identity",
          "network",
          "action",
          "enforcement",
        ]),
        ...pickBooleans(payload, ["dryRun"]),
      };
    case "vm.added":
      return {
        ...pickStrings(payload, ["vm", "driver", "network"]),
        ...pickBooleans(payload, ["dryRun"]),
      };
    case "vm.bound":
    case "vm.unbound":
      return pickStrings(payload, ["identity", "tool", "vm", "network"]);
    case "vm.started":
    case "vm.stopped":
    case "vm.status":
    case "vm.exec":
      return pickStrings(payload, ["identity", "vm", "network", "action"]);
  }
}

function pickStrings(
  payload: Record<string, unknown>,
  keys: string[],
): AuditPayload {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = payload[key];
      return typeof value === "string" ? [[key, safeString(value)]] : [];
    }),
  );
}

function pickBooleans(
  payload: Record<string, unknown>,
  keys: string[],
): AuditPayload {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = payload[key];
      return typeof value === "boolean" ? [[key, value]] : [];
    }),
  );
}

function pickNumbers(
  payload: Record<string, unknown>,
  keys: string[],
): AuditPayload {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = payload[key];
      return typeof value === "number" && Number.isFinite(value)
        ? [[key, value]]
        : [];
    }),
  );
}

function pickStringArrays(
  payload: Record<string, unknown>,
  keys: string[],
): AuditPayload {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = payload[key];
      if (!Array.isArray(value)) return [];
      return [
        [
          key,
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => safeString(entry))
            .slice(0, 50),
        ],
      ];
    }),
  );
}

function safeString(value: string): string {
  const trimmed = value.trim().slice(0, 256);
  if (!trimmed) return "";
  if (!ID_PATTERN.test(trimmed) && looksTokenLike(trimmed)) {
    return "<redacted>";
  }
  return redactTokenShapes(trimmed);
}

function redactTokenShapes(value: string): string {
  return TOKEN_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "<redacted>"),
    value,
  );
}

function looksTokenLike(value: string): boolean {
  return TOKEN_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function referenceKind(value: unknown): string {
  if (typeof value !== "string") return "none";
  if (value.startsWith("secret:")) return "secret-reference";
  if (value.startsWith("env:")) return "env-reference";
  if (value.startsWith("file:")) return "file-reference";
  if (path.isAbsolute(value)) return "absolute-path";
  return "relative-reference";
}

async function permissionIssue(
  target: string,
  expected: number,
  label: string,
): Promise<string | null> {
  const stats = await stat(target).catch(() => null);
  if (!stats) return null;
  const mode = stats.mode & 0o777;
  return mode === expected
    ? null
    : `${label} permissions must be 0${expected.toString(8)}`;
}

function isAlreadyExists(error: unknown): boolean {
  return isErrno(error, "EEXIST");
}

async function historyFileIsRegularOrMissing(
  historyPath: string,
): Promise<boolean> {
  try {
    const stats = await stat(historyPath);
    if (stats.isFile()) return true;
    throw new AuditHistoryReadFailure({
      code: stats.isDirectory() ? "EISDIR" : "ENOTREG",
      message: "audit history file could not be read",
    });
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

function auditReadError(error: unknown): AuditReadError {
  return {
    code:
      error instanceof Error && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "UNKNOWN",
    message: "audit history file could not be read",
  };
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
