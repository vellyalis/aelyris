import { AlertTriangle, ClipboardList, MousePointer2, RotateCcw, Terminal, Workflow, Zap } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { TerminalPaneTarget } from "../../App";
import { useAuditEvents } from "../../shared/hooks/useAuditEvents";
import type { Invoke } from "../../shared/hooks/useLogStream";
import {
  deriveAuditRecoveryHint,
  formatAuditMetadataSummary,
  getAuditCorrelationId,
} from "../../shared/lib/auditRecovery";
import { buildAuditTraceSummary } from "../../shared/lib/auditTrace";
import {
  listWorkstationGraphAgentIds,
  listWorkstationGraphPaneIds,
  listWorkstationGraphRiskIds,
  listWorkstationGraphTerminalIds,
  type WorkstationGraph,
} from "../../shared/lib/workstationGraph";
import type { AuditEventRecord } from "../../shared/types/audit";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./AuditTimelinePanel.module.css";

interface AuditTimelinePanelProps {
  enabled?: boolean;
  invoke?: Invoke;
  limit?: number;
  pollMs?: number;
  auditEvents?: AuditEventRecord[];
  workstationGraph?: WorkstationGraph;
  auditError?: string | null;
  auditReady?: boolean;
  panes?: TerminalPaneTarget[];
  selectedEventId?: number | null;
  traceFilter?: string | null;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onSelectEvent?: (entry: AuditEventRecord, pane?: TerminalPaneTarget) => void;
  onTraceFilterChange?: (correlationId: string | null) => void;
}

const CATEGORY_ICONS = {
  terminal: Terminal,
  workflow: Workflow,
  app: Zap,
} as const;

const AUDIT_VIEW_MODES = [
  { id: "all", label: "All" },
  { id: "risk", label: "Risk" },
  { id: "recover", label: "Recover" },
] as const;

type AuditViewMode = (typeof AUDIT_VIEW_MODES)[number]["id"];

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function compactAction(action: string): string {
  return action.replace(/_/g, " ");
}

function riskCounts(entries: AuditEventRecord[]) {
  return entries.reduce(
    (acc, entry) => {
      if (entry.severity === "error") acc.errors += 1;
      if (entry.severity === "warn") acc.warnings += 1;
      if (deriveAuditRecoveryHint(entry).recoverable) acc.recoverable += 1;
      return acc;
    },
    { errors: 0, warnings: 0, recoverable: 0 },
  );
}

export function AuditTimelinePanel({
  enabled = true,
  invoke,
  limit = 24,
  pollMs = 3_000,
  auditEvents,
  workstationGraph,
  auditError,
  auditReady,
  panes = [],
  selectedEventId = null,
  traceFilter: controlledTraceFilter,
  onFocusPane,
  onRestartPane,
  onSelectEvent,
  onTraceFilterChange,
}: AuditTimelinePanelProps) {
  const stream = useAuditEvents({ enabled: enabled && auditEvents === undefined, invoke, limit, pollMs });
  const [viewMode, setViewMode] = useState<AuditViewMode>("all");
  const [localTraceFilter, setLocalTraceFilter] = useState<string | null>(null);
  const panesRef = useRef<TerminalPaneTarget[]>([]);
  const traceFilter = controlledTraceFilter ?? localTraceFilter;
  const entries = auditEvents ?? stream.entries;
  const graphAgentIds = useMemo(() => listWorkstationGraphAgentIds(workstationGraph), [workstationGraph]);
  const graphPaneIds = useMemo(() => listWorkstationGraphPaneIds(workstationGraph), [workstationGraph]);
  const graphTerminalIds = useMemo(() => listWorkstationGraphTerminalIds(workstationGraph), [workstationGraph]);
  const graphRiskIds = useMemo(() => listWorkstationGraphRiskIds(workstationGraph), [workstationGraph]);
  const graphEntries = useMemo(
    () => filterEntriesByGraph(entries, graphAgentIds, graphRiskIds, graphPaneIds, graphTerminalIds),
    [entries, graphAgentIds, graphPaneIds, graphRiskIds, graphTerminalIds],
  );
  const graphPanes = useMemo(() => {
    if (graphPaneIds.length === 0 && graphTerminalIds.length === 0) return panes;
    const paneIds = new Set(graphPaneIds);
    const terminalIds = new Set(graphTerminalIds);
    return panes.filter(
      (pane) => paneIds.has(pane.paneId) || (pane.terminalId ? terminalIds.has(pane.terminalId) : false),
    );
  }, [graphPaneIds, graphTerminalIds, panes]);
  const error = auditError ?? stream.error;
  const ready = auditReady ?? stream.ready;
  const filteredEntries = useMemo(
    () => filterAuditEntries(graphEntries, viewMode, traceFilter),
    [graphEntries, traceFilter, viewMode],
  );
  const visibleEntries = useMemo(() => filteredEntries.slice(0, 8), [filteredEntries]);
  const counts = useMemo(() => riskCounts(graphEntries), [graphEntries]);
  const traceSummary = useMemo(() => buildAuditTraceSummary(graphEntries, traceFilter), [graphEntries, traceFilter]);
  const attentionCount = counts.errors + counts.warnings;
  const setTraceFilter = (correlationId: string | null) => {
    if (controlledTraceFilter === undefined) {
      setLocalTraceFilter(correlationId);
    }
    onTraceFilterChange?.(correlationId);
  };
  useEffect(() => {
    panesRef.current = graphPanes;
  }, [graphPanes]);
  const resolveLivePane = (pane: TerminalPaneTarget): TerminalPaneTarget | undefined =>
    panesRef.current.find((candidate) => candidate.tabId === pane.tabId && candidate.paneId === pane.paneId);

  return (
    <section
      className={styles.panel}
      aria-label="Audit timeline"
      data-empty={graphEntries.length === 0}
      data-graph-source={workstationGraph ? "workstation-graph" : "audit-stream"}
      data-graph-risk-count={workstationGraph?.nodeCountByKind.risk ?? undefined}
    >
      <PanelHeader
        title="Audit Timeline"
        leadingIcon={<ClipboardList size={12} />}
        count={attentionCount > 0 ? attentionCount : undefined}
        actions={
          graphEntries.length > 0 ? (
            <span className={styles.lastSeen} title="Latest audit event">
              {formatTime(graphEntries[0]?.timestamp ?? "")}
            </span>
          ) : null
        }
      />

      <div className={styles.body}>
        <fieldset className={styles.metrics} aria-label="Audit summary">
          <Metric label="Events" value={graphEntries.length} />
          <Metric label="Warn" value={counts.warnings} />
          <Metric label="Errors" value={counts.errors} />
          <Metric label="Recover" value={counts.recoverable} />
        </fieldset>

        <div className={styles.filterBar} role="tablist" aria-label="Audit event filter">
          {AUDIT_VIEW_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={styles.filterButton}
              role="tab"
              aria-selected={viewMode === mode.id}
              onClick={() => setViewMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {traceFilter && (
          <section className={styles.traceBar} aria-label="Active audit trace">
            <span className={styles.traceStack}>
              <span className={styles.traceLabel} title={traceFilter}>
                Trace {compactTrace(traceFilter)}
              </span>
              <span className={styles.traceStats} title={traceSummary.detail}>
                <span className={styles.traceStatus} data-status={traceSummary.status}>
                  {traceSummary.label}
                </span>
                <span>{traceSummary.eventCount} ev</span>
                <span>{traceSummary.riskCount} risk</span>
                <span>{traceSummary.recoverableCount} rec</span>
              </span>
            </span>
            <button type="button" className={styles.traceClear} onClick={() => setTraceFilter(null)}>
              Clear
            </button>
          </section>
        )}

        {error && (
          <div className={styles.error} role="alert">
            <AlertTriangle size={12} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {visibleEntries.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={18} />}
            title={ready ? emptyTitle(viewMode, graphEntries.length) : "Loading audit trail"}
            description={emptyDescription(viewMode, traceFilter)}
          />
        ) : (
          <div className={styles.list}>
            {visibleEntries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                pane={findAuditPane(entry, graphPanes)}
                selected={selectedEventId === entry.id}
                onFocusPane={onFocusPane}
                onRestartPane={onRestartPane}
                onSelectEvent={onSelectEvent}
                onTraceFilter={setTraceFilter}
                resolveLivePane={resolveLivePane}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AuditRow({
  entry,
  pane,
  selected,
  onFocusPane,
  onRestartPane,
  onSelectEvent,
  onTraceFilter,
  resolveLivePane,
}: {
  entry: AuditEventRecord;
  pane?: TerminalPaneTarget;
  selected: boolean;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onSelectEvent?: (entry: AuditEventRecord, pane?: TerminalPaneTarget) => void;
  onTraceFilter: (correlationId: string) => void;
  resolveLivePane: (pane: TerminalPaneTarget) => TerminalPaneTarget | undefined;
}) {
  const Icon = CATEGORY_ICONS[entry.category as keyof typeof CATEGORY_ICONS] ?? ClipboardList;
  const entityLabel = entry.entityType && entry.entityId ? `${entry.entityType}:${entry.entityId}` : entry.category;
  const canFocus = Boolean(pane && onFocusPane);
  const recoveryHint = deriveAuditRecoveryHint(entry);
  const canRestart = Boolean(pane && onRestartPane && recoveryHint.kind === "restart-pane");
  const paneLabel = pane ? `${pane.tabLabel}/${pane.title || pane.paneId}` : "";
  const correlationId = getAuditCorrelationId(entry.metadata);
  const metadataSummary = formatAuditMetadataSummary(entry.metadata);
  const selectEvent = () => onSelectEvent?.(entry, pane);
  const focusPane = () => {
    if (!pane || !onFocusPane) return;
    const livePane = resolveLivePane(pane);
    if (!livePane) return;
    void onFocusPane(livePane.tabId, livePane.paneId);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!onSelectEvent || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    selectEvent();
  };

  const restartPane = async () => {
    if (!pane || !onRestartPane) return;
    const ok = await showConfirm({
      title: "Restart terminal shell",
      description: `Restart ${paneLabel}? The current shell process will be replaced in the same pane.`,
      confirmLabel: "Restart",
      tone: "default",
    });
    if (!ok) return;
    const livePane = resolveLivePane(pane);
    if (!livePane) return;
    await onRestartPane(livePane.tabId, livePane.paneId);
  };

  return (
    <article
      className={styles.row}
      data-severity={entry.severity}
      data-selected={selected ? "true" : "false"}
      title={entry.summary}
      onClick={selectEvent}
      onKeyDown={handleKeyDown}
      tabIndex={onSelectEvent ? 0 : undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        <Icon size={12} />
      </span>
      <span className={styles.main}>
        <span className={styles.topLine}>
          <span className={styles.action}>{compactAction(entry.action)}</span>
          <span className={styles.time}>{formatTime(entry.timestamp)}</span>
        </span>
        <span className={styles.summary}>{entry.summary}</span>
        <span className={styles.meta}>
          <span>{entityLabel}</span>
          {recoveryHint.recoverable && (
            <span className={styles.recovery} title={recoveryHint.detail}>
              {recoveryHint.label}
            </span>
          )}
          {metadataSummary && <span className={styles.metadata}>{metadataSummary}</span>}
          {correlationId && (
            <button
              type="button"
              className={styles.traceButton}
              title={`Filter trace ${correlationId}`}
              aria-label={`Filter trace ${correlationId}`}
              onClick={(event) => {
                event.stopPropagation();
                onTraceFilter(correlationId);
              }}
            >
              Trace
            </button>
          )}
        </span>
      </span>
      {(canFocus || canRestart) && (
        <span className={styles.actions}>
          {canFocus && (
            <button
              type="button"
              className={styles.actionButton}
              title={`Focus ${paneLabel}`}
              aria-label={`Focus ${paneLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                selectEvent();
                focusPane();
              }}
            >
              <MousePointer2 size={11} aria-hidden="true" />
            </button>
          )}
          {canRestart && (
            <button
              type="button"
              className={styles.actionButton}
              title={`Restart ${paneLabel}`}
              aria-label={`Restart ${paneLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                selectEvent();
                void restartPane();
              }}
            >
              <RotateCcw size={11} aria-hidden="true" />
            </button>
          )}
        </span>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}

function filterAuditEntries(
  entries: AuditEventRecord[],
  viewMode: AuditViewMode,
  traceFilter: string | null,
): AuditEventRecord[] {
  return entries.filter((entry) => {
    if (traceFilter && getAuditCorrelationId(entry.metadata) !== traceFilter) return false;
    if (viewMode === "risk") return entry.severity === "warn" || entry.severity === "error";
    if (viewMode === "recover") return deriveAuditRecoveryHint(entry).recoverable;
    return true;
  });
}

function filterEntriesByGraph(
  entries: AuditEventRecord[],
  agentIds: readonly string[],
  riskIds: readonly string[],
  paneIds: readonly string[],
  terminalIds: readonly string[],
): AuditEventRecord[] {
  if (agentIds.length === 0 && riskIds.length === 0 && paneIds.length === 0 && terminalIds.length === 0) return entries;
  const agentSet = new Set(agentIds);
  const riskSet = new Set(riskIds);
  const paneSet = new Set(paneIds);
  const terminalSet = new Set(terminalIds);
  return entries.filter((entry) => {
    if (entry.entityType === "agent" && entry.entityId && agentSet.has(entry.entityId)) return true;
    const agentId = readMetadataString(entry, "agentId");
    if (agentId && agentSet.has(agentId)) return true;
    if (riskSet.has(`audit-${entry.id}`) || riskSet.has(String(entry.id))) return true;
    if (entry.entityId && (paneSet.has(entry.entityId) || terminalSet.has(entry.entityId))) return true;
    const paneId = readMetadataString(entry, "paneId");
    const terminalId = readMetadataString(entry, "terminalId");
    return Boolean((paneId && paneSet.has(paneId)) || (terminalId && terminalSet.has(terminalId)));
  });
}

function readMetadataString(entry: AuditEventRecord, key: string): string | null {
  const value = entry.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyTitle(viewMode: AuditViewMode, totalCount: number): string {
  if (totalCount === 0) return "No audit events yet";
  if (viewMode === "risk") return "No risky audit events";
  if (viewMode === "recover") return "No recoverable events";
  return "No audit events yet";
}

function emptyDescription(viewMode: AuditViewMode, traceFilter: string | null): string {
  if (traceFilter) return "No events match the active trace and filter.";
  if (viewMode === "risk") return "Warnings and errors will appear here.";
  if (viewMode === "recover") return "Restart, target, gate, and denial recoveries will appear here.";
  return "Terminal sends, failures, and workflow gates will appear here.";
}

function compactTrace(correlationId: string): string {
  if (correlationId.length <= 24) return correlationId;
  return `${correlationId.slice(0, 23)}...`;
}

function findAuditPane(entry: AuditEventRecord, panes: TerminalPaneTarget[]): TerminalPaneTarget | undefined {
  const entityId = entry.entityId;
  if (!entityId) return undefined;
  return panes.find((pane) => pane.terminalId === entityId || pane.paneId === entityId || pane.role === entityId);
}
