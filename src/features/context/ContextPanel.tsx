import { Activity, AlertTriangle, Braces, FileText, GitBranch, GitCompare, Layers, Radio, Route } from "lucide-react";
import { useMemo } from "react";
import { buildContextPack } from "../../shared/lib/contextPack";
import type { GitChangedFile } from "../../shared/lib/reviewQueue";
import {
  listWorkstationGraphAgentIds,
  listWorkstationGraphChangedFiles,
  type WorkstationGraph,
  type WorkstationGraphPane,
} from "../../shared/lib/workstationGraph";
import {
  agentContextPercent,
  agentContextWindow,
  agentFileCount,
  buildWorkstationSummary,
  compactWorkstationNumber,
  isLiveAgentStatus,
  type TelemetryConfidence,
} from "../../shared/lib/workstationSummary";
import { useAppStore } from "../../shared/store/appStore";
import type { AgentSession } from "../../shared/types/agent";
import type { AuditEventRecord } from "../../shared/types/audit";
import { ContextGauge } from "../../shared/ui/ContextGauge";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./ContextPanel.module.css";

interface ContextPanelProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  changedFilesCount?: number;
  changedFiles?: readonly GitChangedFile[];
  panes?: readonly WorkstationGraphPane[];
  auditEvents?: readonly AuditEventRecord[];
  projectName?: string;
  projectPath?: string;
  branch?: string | null;
  density?: "full" | "compact";
  workstationGraph?: WorkstationGraph;
}

export function ContextPanel({
  sessions,
  activeSessionId,
  changedFilesCount = 0,
  changedFiles,
  panes = [],
  auditEvents = [],
  projectName = "Workspace",
  projectPath = "",
  branch = null,
  density = "full",
  workstationGraph,
}: ContextPanelProps) {
  const contextWarnPct = useAppStore((s) => s.contextWarnPct);
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const graphAgentIds = useMemo(() => listWorkstationGraphAgentIds(workstationGraph), [workstationGraph]);
  const graphSessions = useMemo(() => {
    if (graphAgentIds.length === 0) return sessions;
    const ids = new Set(graphAgentIds);
    return sessions.filter((session) => ids.has(session.id));
  }, [graphAgentIds, sessions]);
  const scopedChangedFilesCount = workstationGraph ? graphChangedFilesCount : changedFilesCount;
  const summary = useMemo(
    () =>
      buildWorkstationSummary({
        sessions: graphSessions,
        changedFilesCount: scopedChangedFilesCount,
      }),
    [graphSessions, scopedChangedFilesCount],
  );
  const activeSession = graphSessions.find((s) => s.id === activeSessionId) ?? null;
  const sortedSessions = useMemo(() => summary.rankedSessions.slice(0, 4), [summary]);
  const focusSession = activeSession ?? sortedSessions[0] ?? null;
  const focusWindow = focusSession ? agentContextWindow(focusSession) : null;
  const signal =
    summary.peakSession && summary.peakContextPct >= contextWarnPct
      ? {
          tone: "warn",
          icon: <AlertTriangle size={12} />,
          label: "Handoff soon",
          detail: `${summary.peakSession.name} is at ${Math.round(summary.peakContextPct)}% context`,
        }
      : summary.changedFilesCount > 0
        ? {
            tone: "review",
            icon: <GitCompare size={12} />,
            label: "Review queue",
            detail: `${summary.changedFilesCount} changed file${summary.changedFilesCount === 1 ? "" : "s"}`,
          }
        : summary.tracedSessionCount > 0
          ? {
              tone: "trace",
              icon: <Route size={12} />,
              label: "Handoff trace",
              detail: `${summary.tracedSessionCount} linked session${summary.tracedSessionCount === 1 ? "" : "s"}`,
            }
          : null;
  const contextPackChangedFiles = useMemo(
    () => changedFiles ?? listWorkstationGraphChangedFiles(workstationGraph),
    [changedFiles, workstationGraph],
  );
  const contextPack = useMemo(
    () =>
      buildContextPack({
        workspace: {
          name: projectName,
          path: projectPath,
          branch,
        },
        activeTask: focusSession
          ? {
              id: focusSession.id,
              title: focusSession.name,
              status: focusSession.status,
              nextAction:
                signal?.label === "Handoff soon"
                  ? `Prepare handoff for ${focusSession.name}.`
                  : signal?.label === "Review queue"
                    ? "Review changed files before handoff."
                    : undefined,
            }
          : null,
        sessions: graphSessions,
        changedFiles: contextPackChangedFiles,
        panes,
        auditEvents,
        workstationGraph,
      }),
    [
      auditEvents,
      branch,
      contextPackChangedFiles,
      focusSession,
      graphSessions,
      panes,
      projectName,
      projectPath,
      signal?.label,
      workstationGraph,
    ],
  );

  return (
    <section
      className={styles.panel}
      aria-label="Context and agent telemetry"
      data-density={density}
      data-empty={graphSessions.length === 0}
      data-graph-source={workstationGraph ? "workstation-graph" : "session-summary"}
    >
      <PanelHeader
        title="Context"
        leadingIcon={<Activity size={12} />}
        count={summary.liveSessionCount > 0 ? summary.liveSessionCount : undefined}
        actions={
          summary.tracedSessionCount > 0 ? (
            <span className={styles.traceBadge} title="Sessions with role or handoff metadata">
              <GitBranch size={11} />
              {summary.tracedSessionCount}
            </span>
          ) : null
        }
      />

      {graphSessions.length === 0 ? (
        <div className={styles.empty}>No agent telemetry yet.</div>
      ) : (
        <div className={styles.body}>
          <fieldset className={styles.metricGrid} aria-label="Context summary">
            <Metric
              label="Peak"
              value={`${Math.round(summary.peakContextPct)}%`}
              confidence={summary.contextConfidence}
            />
            <Metric
              label="Tokens"
              value={compactWorkstationNumber(summary.totalTokens)}
              confidence={summary.tokenConfidence}
            />
            <Metric label="Cost" value={`$${summary.totalCost.toFixed(2)}`} />
            <Metric label="Files" value={String(summary.changedFilesCount)} confidence={summary.fileConfidence} />
          </fieldset>

          {signal && (
            <div className={styles.signal} data-tone={signal.tone}>
              <span className={styles.signalIcon} aria-hidden="true">
                {signal.icon}
              </span>
              <span className={styles.signalText}>
                <span className={styles.signalLabel}>{signal.label}</span>
                <span className={styles.signalDetail}>{signal.detail}</span>
              </span>
            </div>
          )}

          {density === "full" && (
            <section
              className={styles.packCard}
              aria-label="Context pack builder"
              data-redactions={contextPack.json.summary.redactionCount}
            >
              <div className={styles.packTop}>
                <span className={styles.packTitle}>
                  <FileText size={12} aria-hidden="true" />
                  Copy project state
                </span>
                <span className={styles.packBadge}>{contextPack.json.summary.redactionCount} redacted</span>
              </div>
              <p className={styles.packSummary}>{contextPack.threadSummary}</p>
              <div className={styles.packActions}>
                <button
                  type="button"
                  className={styles.packButton}
                  onClick={() => copyText(contextPack.markdown)}
                  aria-label="Copy context pack markdown"
                >
                  <FileText size={12} aria-hidden="true" />
                  Markdown
                </button>
                <button
                  type="button"
                  className={styles.packButton}
                  onClick={() => copyText(JSON.stringify(contextPack.json, null, 2))}
                  aria-label="Copy context pack JSON"
                >
                  <Braces size={12} aria-hidden="true" />
                  JSON
                </button>
              </div>
            </section>
          )}

          {focusSession && (
            <div className={styles.focusCard}>
              <div className={styles.focusTop}>
                <span className={styles.focusLabel}>Focus</span>
                <span className={styles.focusName}>{focusSession.name}</span>
              </div>
              <ContextGauge percent={agentContextPercent(focusSession)} width={108} />
              <div className={styles.focusMeta}>
                <span>{compactWorkstationNumber(focusSession.tokensUsed)} tokens</span>
                {focusWindow && (
                  <span title={`${focusWindow.remaining.toLocaleString()} tokens remaining`}>
                    {compactWorkstationNumber(focusWindow.remaining)} left
                  </span>
                )}
                <span>{agentFileCount(focusSession)} files</span>
                <span>{focusSession.status}</span>
              </div>
            </div>
          )}

          {density === "full" && (
            <ul className={styles.sessionList} aria-label="Tracked sessions">
              {sortedSessions.map((session) => {
                const pct = agentContextPercent(session);
                const live = isLiveAgentStatus(session.status);
                return (
                  <li
                    className={styles.sessionRow}
                    key={session.id}
                    data-live={live}
                    data-active={session.id === activeSessionId}
                  >
                    <span className={styles.liveDot} aria-hidden="true" />
                    <span className={styles.sessionMain}>
                      <span className={styles.sessionName}>{session.name}</span>
                      <span className={styles.sessionMeta}>
                        {session.model}
                        {session.role ? ` / ${session.role}` : ""}
                      </span>
                    </span>
                    <ContextGauge percent={pct} width={72} />
                  </li>
                );
              })}
            </ul>
          )}

          {density === "full" && (
            <div className={styles.footer}>
              <span>
                <Radio size={11} />
                {summary.liveSessionCount} live
              </span>
              <span>
                <Layers size={11} />
                {graphSessions.length} total
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, confidence }: { label: string; value: string; confidence?: TelemetryConfidence }) {
  return (
    <div className={styles.metric} title={confidence ? `${label} confidence: ${confidence}` : undefined}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabelRow}>
        <span className={styles.metricLabel}>{label}</span>
        {confidence && <span className={styles.confidence}>{confidenceLabel(confidence)}</span>}
      </span>
    </div>
  );
}

function confidenceLabel(confidence: TelemetryConfidence): string {
  if (confidence === "estimated") return "est.";
  return confidence;
}

function copyText(text: string): void {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") return;
  void navigator.clipboard.writeText(text).catch(() => undefined);
}
