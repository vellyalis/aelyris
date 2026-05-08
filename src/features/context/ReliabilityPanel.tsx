import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  GitBranch,
  MousePointer2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { TerminalPaneTarget } from "../../App";
import { useAuditEvents } from "../../shared/hooks/useAuditEvents";
import { buildReliabilityReport, type Guardrail, type Incident } from "../../shared/lib/reliabilityReport";
import {
  listWorkstationGraphAgentIds,
  listWorkstationGraphPaneIds,
  listWorkstationGraphRiskIds,
  listWorkstationGraphTerminalIds,
  type WorkstationGraph,
} from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import type { AuditEventRecord } from "../../shared/types/audit";
import { showConfirm } from "../../shared/ui/ConfirmDialog";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./ReliabilityPanel.module.css";

interface ReliabilityPanelProps {
  sessions: AgentSession[];
  panes: TerminalPaneTarget[];
  changedFilesCount?: number;
  auditEvents?: AuditEventRecord[];
  workstationGraph?: WorkstationGraph;
  selectedEventId?: number | null;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onSelectIncident?: (incident: { eventId: number; pane?: TerminalPaneTarget }) => void;
  onTraceIncident?: (correlationId: string, incident: { eventId: number; pane?: TerminalPaneTarget }) => void;
}

export function ReliabilityPanel({
  sessions,
  panes,
  changedFilesCount = 0,
  auditEvents,
  workstationGraph,
  selectedEventId = null,
  onFocusPane,
  onRestartPane,
  onSelectIncident,
  onTraceIncident,
}: ReliabilityPanelProps) {
  const auditStream = useAuditEvents({ enabled: auditEvents === undefined, limit: 40, pollMs: 3_000 });
  const panesRef = useRef<TerminalPaneTarget[]>([]);
  const operationalEvents = auditEvents ?? auditStream.entries;
  const graphAgentIds = useMemo(() => listWorkstationGraphAgentIds(workstationGraph), [workstationGraph]);
  const graphPaneIds = useMemo(() => listWorkstationGraphPaneIds(workstationGraph), [workstationGraph]);
  const graphTerminalIds = useMemo(() => listWorkstationGraphTerminalIds(workstationGraph), [workstationGraph]);
  const graphRiskIds = useMemo(() => listWorkstationGraphRiskIds(workstationGraph), [workstationGraph]);
  const graphSessions = useMemo(() => {
    if (graphAgentIds.length === 0) return sessions;
    const ids = new Set(graphAgentIds);
    return sessions.filter((session) => ids.has(session.id));
  }, [graphAgentIds, sessions]);
  const graphPanes = useMemo(() => {
    if (graphPaneIds.length === 0 && graphTerminalIds.length === 0) return panes;
    const paneIds = new Set(graphPaneIds);
    const terminalIds = new Set(graphTerminalIds);
    return panes.filter(
      (pane) => paneIds.has(pane.paneId) || (pane.terminalId ? terminalIds.has(pane.terminalId) : false),
    );
  }, [graphPaneIds, graphTerminalIds, panes]);
  const graphEvents = useMemo(
    () => filterEventsByGraph(operationalEvents, graphAgentIds, graphRiskIds, graphPaneIds, graphTerminalIds),
    [graphAgentIds, graphPaneIds, graphRiskIds, graphTerminalIds, operationalEvents],
  );
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const scopedChangedFilesCount = workstationGraph ? graphChangedFilesCount : changedFilesCount;
  const report = useMemo(
    () =>
      buildReliabilityReport({
        sessions: graphSessions,
        panes: graphPanes,
        changedFilesCount: scopedChangedFilesCount,
        auditEvents: graphEvents,
      }),
    [graphEvents, graphPanes, graphSessions, scopedChangedFilesCount],
  );
  useEffect(() => {
    panesRef.current = graphPanes;
  }, [graphPanes]);
  const resolveLivePane = (pane: TerminalPaneTarget): TerminalPaneTarget | undefined =>
    panesRef.current.find((candidate) => candidate.tabId === pane.tabId && candidate.paneId === pane.paneId);

  return (
    <section
      className={styles.panel}
      aria-label="Operational reliability"
      data-graph-source={workstationGraph ? "workstation-graph" : "reliability-report"}
    >
      <PanelHeader
        title="Reliability"
        leadingIcon={<ShieldCheck size={12} />}
        count={`${report.score}`}
        actions={<span className={styles.grade}>{report.grade}</span>}
      />

      <div className={styles.body}>
        <div className={styles.scoreCard} data-tone={report.tone}>
          <span className={styles.score}>{report.score}</span>
          <span className={styles.scoreText}>
            <span className={styles.scoreLabel}>{report.label}</span>
            <span className={styles.scoreDetail}>{report.detail}</span>
          </span>
        </div>

        <ul className={styles.grid} aria-label="Reliability guardrails">
          {report.guardrails.map((guardrail) => (
            <GuardrailRow key={guardrail.id} guardrail={guardrail} />
          ))}
        </ul>

        {report.incidents.length > 0 && (
          <ul className={styles.incidents} aria-label="Recent reliability incidents">
            {report.incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                selected={selectedEventId === incident.id}
                onFocusPane={onFocusPane}
                onRestartPane={onRestartPane}
                onSelectIncident={onSelectIncident}
                onTraceIncident={onTraceIncident}
                resolveLivePane={resolveLivePane}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function GuardrailRow({ guardrail }: { guardrail: Guardrail }) {
  const Icon = guardrail.state === "ok" ? CheckCircle2 : guardrail.state === "idle" ? CircleDashed : AlertTriangle;
  return (
    <li className={styles.guardrail} data-state={guardrail.state}>
      <span className={styles.guardIcon} aria-hidden="true">
        <Icon size={12} />
      </span>
      <span className={styles.guardText}>
        <span className={styles.guardLabel}>{guardrail.label}</span>
        <span className={styles.guardDetail}>{guardrail.detail}</span>
      </span>
    </li>
  );
}

function IncidentRow({
  incident,
  selected,
  onFocusPane,
  onRestartPane,
  onSelectIncident,
  onTraceIncident,
  resolveLivePane,
}: {
  incident: Incident;
  selected: boolean;
  onFocusPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onRestartPane?: (tabId: string, paneId: string) => void | Promise<void>;
  onSelectIncident?: (incident: { eventId: number; pane?: TerminalPaneTarget }) => void;
  onTraceIncident?: (correlationId: string, incident: { eventId: number; pane?: TerminalPaneTarget }) => void;
  resolveLivePane: (pane: TerminalPaneTarget) => TerminalPaneTarget | undefined;
}) {
  const canFocus = Boolean(incident.pane && onFocusPane);
  const canRestart = Boolean(incident.pane && onRestartPane && incident.recovery.kind === "restart-pane");
  const canTrace = Boolean(incident.correlationId && onTraceIncident);
  const paneLabel = incident.pane ? `${incident.pane.tabLabel}/${incident.pane.title || incident.pane.paneId}` : "";

  const restartPane = async () => {
    if (!incident.pane || !onRestartPane) return;
    const ok = await showConfirm({
      title: "Restart terminal shell",
      description: `Restart ${paneLabel}? The current shell process will be replaced in the same pane.`,
      confirmLabel: "Restart",
      tone: "default",
    });
    if (!ok) return;
    const livePane = resolveLivePane(incident.pane);
    if (!livePane) return;
    await onRestartPane(livePane.tabId, livePane.paneId);
  };

  const focusPane = () => {
    if (!incident.pane || !onFocusPane) return;
    const livePane = resolveLivePane(incident.pane);
    if (!livePane) return;
    onSelectIncident?.({ eventId: incident.id, pane: livePane });
    void onFocusPane(livePane.tabId, livePane.paneId);
  };

  return (
    <li
      className={styles.incident}
      data-severity={incident.severity}
      data-selected={selected ? "true" : "false"}
      tabIndex={onSelectIncident ? 0 : undefined}
      onClick={() => onSelectIncident?.({ eventId: incident.id, pane: incident.pane })}
      onKeyDown={(event) => {
        if (!onSelectIncident || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onSelectIncident({ eventId: incident.id, pane: incident.pane });
      }}
    >
      <span className={styles.incidentMarker} aria-hidden="true" />
      <span className={styles.incidentText}>
        <span className={styles.incidentTop}>
          <span className={styles.incidentAction}>{compactAction(incident.action)}</span>
          <span className={styles.incidentTarget}>{incident.target}</span>
        </span>
        <span className={styles.incidentSummary}>{incident.summary}</span>
        <span className={styles.incidentStep}>
          <span className={styles.recoveryLabel}>{incident.recovery.label}</span>
          {incident.recovery.detail}
        </span>
      </span>
      {(canFocus || canRestart || canTrace) && (
        <span className={styles.incidentActions}>
          {canTrace && (
            <button
              type="button"
              className={styles.incidentActionBtn}
              title={`Open trace ${incident.correlationId}`}
              aria-label={`Open trace ${incident.correlationId}`}
              onClick={(event) => {
                event.stopPropagation();
                if (!incident.correlationId) return;
                onTraceIncident?.(incident.correlationId, { eventId: incident.id, pane: incident.pane });
              }}
            >
              <GitBranch size={11} aria-hidden="true" />
            </button>
          )}
          {canFocus && (
            <button
              type="button"
              className={styles.incidentActionBtn}
              title={`Focus ${paneLabel}`}
              aria-label={`Focus ${paneLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                focusPane();
              }}
            >
              <MousePointer2 size={11} aria-hidden="true" />
            </button>
          )}
          {canRestart && (
            <button
              type="button"
              className={styles.incidentActionBtn}
              title={`Restart ${paneLabel}`}
              aria-label={`Restart ${paneLabel}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectIncident?.({ eventId: incident.id, pane: incident.pane });
                void restartPane();
              }}
            >
              <RotateCcw size={11} aria-hidden="true" />
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function filterEventsByGraph(
  events: AuditEventRecord[],
  agentIds: readonly string[],
  riskIds: readonly string[],
  paneIds: readonly string[],
  terminalIds: readonly string[],
): AuditEventRecord[] {
  if (agentIds.length === 0 && riskIds.length === 0 && paneIds.length === 0 && terminalIds.length === 0) return events;
  const agentSet = new Set(agentIds);
  const riskSet = new Set(riskIds);
  const paneSet = new Set(paneIds);
  const terminalSet = new Set(terminalIds);
  return events.filter((event) => {
    if (event.entityType === "agent" && event.entityId && agentSet.has(event.entityId)) return true;
    const agentId = readMetadataString(event, "agentId");
    if (agentId && agentSet.has(agentId)) return true;
    if (riskSet.has(`audit-${event.id}`) || riskSet.has(String(event.id))) return true;
    if (event.entityId && (paneSet.has(event.entityId) || terminalSet.has(event.entityId))) return true;
    const paneId = readMetadataString(event, "paneId");
    const terminalId = readMetadataString(event, "terminalId");
    return Boolean((paneId && paneSet.has(paneId)) || (terminalId && terminalSet.has(terminalId)));
  });
}

function readMetadataString(event: AuditEventRecord, key: string): string | null {
  const value = event.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function compactAction(action: string): string {
  return action.replace(/_/g, " ");
}
