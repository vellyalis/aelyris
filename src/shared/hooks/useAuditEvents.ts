import { useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "../lib/tauriRuntime";
import type { AuditEventFilters, AuditEventRecord, AuditJournalEventRecord, AuditSeverity } from "../types/audit";
import type { Invoke } from "./useLogStream";

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

type AuditEventBusPayload = AuditEventRecord | AuditJournalEventRecord;
type AuditEventBusListener = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

const defaultListen: AuditEventBusListener = async (event, handler) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(event, handler);
};

export interface UseAuditEventsOptions {
  enabled?: boolean;
  filters?: AuditEventFilters;
  invoke?: Invoke;
  limit?: number;
  listen?: AuditEventBusListener;
  pollMs?: number;
}

export interface AuditEventsState {
  entries: AuditEventRecord[];
  error: string | null;
  ready: boolean;
}

export function useAuditEvents(options: UseAuditEventsOptions = {}): AuditEventsState {
  const { enabled = true, filters, invoke = defaultInvoke, limit = 40, listen, pollMs = 3_000 } = options;
  const category = normalizeAuditFilter(filters?.category);
  const severity = normalizeAuditFilter(filters?.severity);
  const entityId = normalizeAuditFilter(filters?.entityId);
  const [state, setState] = useState<AuditEventsState>({
    entries: [],
    error: null,
    ready: false,
  });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      setState({ entries: [], error: null, ready: false });
      return;
    }
    if (invoke === defaultInvoke && !isTauriRuntime()) {
      setState({ entries: [], error: null, ready: true });
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const payload = await loadAuditEvents({ category, entityId, invoke, limit, severity });
        if (cancelled) return;
        if (!Array.isArray(payload)) {
          setState((prev) => ({
            ...prev,
            error: "Invalid audit event payload",
            ready: true,
          }));
          return;
        }
        const entries = payload
          .map(normalizeAuditEvent)
          .filter((entry) => matchesAuditFilters(entry, { category, entityId, severity }))
          .slice(0, limit);
        setState((prev) => ({
          entries: mergeAuditEntries(entries, prev.entries, limit),
          error: null,
          ready: true,
        }));
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : String(e),
          ready: true,
        }));
      }
    };

    void load();
    const handle = window.setInterval(() => {
      if (!enabledRef.current) return;
      void load();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [category, enabled, entityId, invoke, limit, pollMs, severity]);

  useEffect(() => {
    if (!enabled) return;
    if (!listen && (invoke !== defaultInvoke || !isTauriRuntime())) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const listenFn = listen ?? defaultListen;

    void listenFn<AuditEventBusPayload>("audit:event", (event) => {
      const entry = normalizeAuditEvent(event.payload);
      if (!matchesAuditFilters(entry, { category, entityId, severity })) return;
      setState((prev) => ({
        entries: mergeAuditEntries([entry], prev.entries, limit),
        error: null,
        ready: true,
      }));
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
          ready: true,
        }));
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [category, enabled, entityId, invoke, limit, listen, severity]);

  return state;
}

function normalizeAuditFilter(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function loadAuditEvents(args: {
  category?: string;
  entityId?: string;
  invoke: Invoke;
  limit: number;
  severity?: string;
}): Promise<Array<AuditEventRecord | AuditJournalEventRecord>> {
  try {
    return await args.invoke<Array<AuditEventRecord | AuditJournalEventRecord>>("list_audit_events", {
      filter: compactJournalQuery({ limit: Math.max(args.limit, 200) }),
    });
  } catch (error) {
    if (!shouldFallbackToLegacyAudit(error)) throw error;
    return args.invoke<AuditEventRecord[]>(
      "recent_audit_events",
      compactLegacyAuditQuery({
        category: args.category,
        entityId: args.entityId,
        limit: args.limit,
        severity: args.severity,
      }),
    );
  }
}

function compactJournalQuery(args: { limit: number }): Record<string, number> {
  return { limit: args.limit };
}

function compactLegacyAuditQuery(args: {
  category?: string;
  entityId?: string;
  limit: number;
  severity?: string;
}): Record<string, string | number> {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | number
  >;
}

function shouldFallbackToLegacyAudit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown command|not found|invalid args|missing field `filter`|list_audit_events/i.test(message);
}

function normalizeAuditEvent(entry: AuditEventRecord | AuditJournalEventRecord): AuditEventRecord {
  if (!isJournalEvent(entry)) return entry;
  const payload = asRecord(entry.redactedPayloadJson);
  const entity = journalEntity(entry);
  return {
    id: entry.id,
    timestamp: entry.createdAt,
    category: categoryFromKind(entry.kind),
    action: entry.kind,
    severity: normalizeSeverity(entry.severity),
    entityType: entity.type,
    entityId: entity.id,
    summary: journalSummary(entry, payload),
    metadata: {
      ...payload,
      auditJournal: true,
      workspaceId: entry.workspaceId,
      correlationId: entry.correlationId,
      sequence: entry.sequence,
      source: entry.source,
      confidence: entry.confidence,
      hash: entry.hash,
      taskId: entry.taskId,
      agentId: entry.agentId,
      terminalId: entry.terminalId,
      paneId: entry.paneId,
      workflowId: entry.workflowId,
    },
  };
}

function mergeAuditEntries(
  incoming: AuditEventRecord[],
  existing: AuditEventRecord[],
  limit: number,
): AuditEventRecord[] {
  const merged = new Map<string, AuditEventRecord>();
  for (const entry of [...incoming, ...existing]) {
    merged.set(auditEntryKey(entry), entry);
  }
  return [...merged.values()].sort(compareNewestFirst).slice(0, limit);
}

function auditEntryKey(entry: AuditEventRecord): string {
  const sequence = entry.metadata?.sequence;
  if (typeof sequence === "number") return `sequence:${sequence}`;
  return `id:${entry.id}`;
}

function compareNewestFirst(left: AuditEventRecord, right: AuditEventRecord): number {
  const leftSequence = typeof left.metadata?.sequence === "number" ? left.metadata.sequence : null;
  const rightSequence = typeof right.metadata?.sequence === "number" ? right.metadata.sequence : null;
  if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
    return rightSequence - leftSequence;
  }
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return right.id - left.id;
}

function isJournalEvent(entry: AuditEventRecord | AuditJournalEventRecord): entry is AuditJournalEventRecord {
  return "kind" in entry && "sequence" in entry && "createdAt" in entry;
}

function normalizeSeverity(severity: AuditSeverity): AuditSeverity {
  return severity === "warning" ? "warn" : severity;
}

function categoryFromKind(kind: string): string {
  if (/^(terminal|pty|ime|pane|process)/i.test(kind)) return "terminal";
  if (/^workflow/i.test(kind)) return "workflow";
  return "app";
}

function journalEntity(entry: AuditJournalEventRecord): { type: string | null; id: string | null } {
  if (entry.terminalId) return { type: "terminal", id: entry.terminalId };
  if (entry.paneId) return { type: "pane", id: entry.paneId };
  if (entry.agentId) return { type: "agent", id: entry.agentId };
  if (entry.workflowId) return { type: "workflow", id: entry.workflowId };
  if (entry.taskId) return { type: "task", id: entry.taskId };
  if (entry.sessionId) return { type: "session", id: entry.sessionId };
  return { type: "audit", id: entry.correlationId };
}

function journalSummary(entry: AuditJournalEventRecord, payload: Record<string, unknown>): string {
  const candidates = [
    payload.summary,
    payload.title,
    payload.message,
    payload.reason,
    asRecord(payload.notification).title,
    asRecord(payload.notification).body,
    asRecord(payload.finalReport).summary,
    asRecord(payload.blockerAnalysis).reason,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return found ? String(found) : `${entry.kind.replace(/_/g, " ")} from ${entry.source}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function matchesAuditFilters(entry: AuditEventRecord, filters: { category?: string; entityId?: string; severity?: string }): boolean {
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.entityId && entry.entityId !== filters.entityId) return false;
  if (filters.severity && normalizeSeverity(entry.severity) !== normalizeSeverity(filters.severity)) return false;
  return true;
}
