import { Activity, AlertTriangle, GitCompare, Radio, Route } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { listWorkstationGraphAgentIds, type WorkstationGraph } from "../../shared/lib/workstationGraph";
import {
  buildWorkstationSummary,
  compactWorkstationNumber,
  type TelemetryConfidence,
} from "../../shared/lib/workstationSummary";
import { useAppStore } from "../../shared/store/appStore";
import type { AgentSession } from "../../shared/types/agent";
import styles from "./WorkstationPulse.module.css";

interface WorkstationPulseProps {
  sessions: AgentSession[];
  changedFilesCount?: number;
  workstationGraph?: WorkstationGraph;
}

export function WorkstationPulse({ sessions, changedFilesCount = 0, workstationGraph }: WorkstationPulseProps) {
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

  const signal =
    summary.attentionCount > 0
      ? {
          tone: "danger",
          icon: <AlertTriangle size={12} />,
          label: "Attention",
          detail: `${summary.attentionCount} session${summary.attentionCount === 1 ? "" : "s"} blocked`,
        }
      : summary.peakContextPct >= contextWarnPct
        ? {
            tone: "warn",
            icon: <AlertTriangle size={12} />,
            label: "Handoff watch",
            detail: `${Math.round(summary.peakContextPct)}% peak context`,
          }
        : summary.changedFilesCount > 0
          ? {
              tone: "review",
              icon: <GitCompare size={12} />,
              label: "Review ready",
              detail: `${summary.changedFilesCount} changed file${summary.changedFilesCount === 1 ? "" : "s"}`,
            }
          : summary.tracedSessionCount > 0
            ? {
                tone: "trace",
                icon: <Route size={12} />,
                label: "Trace active",
                detail: `${summary.tracedSessionCount} linked session${summary.tracedSessionCount === 1 ? "" : "s"}`,
              }
            : {
                tone: "quiet",
                icon: <Radio size={12} />,
                label: "Ready",
                detail:
                  summary.liveSessionCount > 0
                    ? `${summary.liveSessionCount} live session${summary.liveSessionCount === 1 ? "" : "s"}`
                    : "No pressure",
              };

  return (
    <section
      className={styles.pulse}
      data-tone={signal.tone}
      data-graph-source={workstationGraph ? "workstation-graph" : "session-summary"}
      aria-label="Workstation pulse"
    >
      <div className={styles.signal}>
        <span className={styles.signalIcon} aria-hidden="true">
          {signal.icon}
        </span>
        <span className={styles.signalText}>
          <span className={styles.signalLabel}>{signal.label}</span>
          <span className={styles.signalDetail}>{signal.detail}</span>
        </span>
      </div>
      <fieldset className={styles.metrics} aria-label="Workstation summary">
        <Metric icon={<Activity size={10} />} label="Live" value={String(summary.liveSessionCount)} />
        <Metric label="Ctx" value={`${Math.round(summary.peakContextPct)}%`} confidence={summary.contextConfidence} />
        <Metric
          label="Tok"
          value={compactWorkstationNumber(summary.totalTokens)}
          confidence={summary.tokenConfidence}
        />
        <Metric label="Files" value={String(summary.changedFilesCount)} confidence={summary.fileConfidence} />
      </fieldset>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  confidence,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  confidence?: TelemetryConfidence;
}) {
  return (
    <div className={styles.metric} title={confidence ? `${label} confidence: ${confidence}` : undefined}>
      <span className={styles.metricValue}>
        {icon}
        {value}
      </span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
