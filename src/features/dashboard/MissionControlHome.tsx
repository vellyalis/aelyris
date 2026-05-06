import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  GitBranch,
  GitCompare,
  HeartPulse,
  Layers,
  Radio,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { buildReviewQueue, type GitChangedFile } from "../../shared/lib/reviewQueue";
import { buildWorkstationSummary, compactWorkstationNumber } from "../../shared/lib/workstationSummary";
import type { WorkstationGraph } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import type { AuditEventRecord } from "../../shared/types/audit";
import styles from "./MissionControlHome.module.css";

export interface MissionControlPane {
  paneId: string;
  terminalId?: string | null;
  lifecycle?: string;
  role?: string;
  title?: string;
  label?: string;
}

interface MissionControlHomeProps {
  projectName: string;
  projectPath: string;
  branch?: string;
  panes: readonly MissionControlPane[];
  sessions: readonly AgentSession[];
  interactiveSessionCount?: number;
  changedFiles: readonly GitChangedFile[];
  auditEvents?: readonly AuditEventRecord[];
  workstationGraph?: WorkstationGraph;
  contextWarnPct?: number;
  onOpenCommand?: () => void;
  onOpenReview?: () => void;
  onOpenObserve?: () => void;
}

type MissionTone = "good" | "review" | "watch" | "danger" | "quiet";

interface MissionSignal {
  tone: MissionTone;
  label: string;
  detail: string;
  icon: ReactNode;
  actionLabel?: string;
  action?: () => void;
}

interface BlockerItem {
  id: string;
  label: string;
  detail: string;
  tone: MissionTone;
}

const BLOCKER_PATTERN = /(blocked|blocker|needs_attention|permission|denied|failed|error|timeout)/i;
const FINAL_REPORT_PATTERN = /(final[_ -]?report|final report written|report_written)/i;

export function MissionControlHome({
  projectName,
  projectPath,
  branch,
  panes,
  sessions,
  interactiveSessionCount = 0,
  changedFiles,
  auditEvents = [],
  workstationGraph,
  contextWarnPct = 85,
  onOpenCommand,
  onOpenReview,
  onOpenObserve,
}: MissionControlHomeProps) {
  const sortedAuditEvents = useMemo(
    () => [...auditEvents].sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp)),
    [auditEvents],
  );
  const reviewQueue = useMemo(() => buildReviewQueue(sessions, changedFiles), [changedFiles, sessions]);
  const summary = useMemo(
    () =>
      buildWorkstationSummary({
        sessions,
        changedFilesCount: changedFiles.length,
        interactiveSessionCount,
      }),
    [changedFiles.length, interactiveSessionCount, sessions],
  );

  const activePanes = panes.filter((pane) => pane.lifecycle === "live" || Boolean(pane.terminalId));
  const detachedPanes = panes.filter((pane) => pane.lifecycle === "detached" || pane.lifecycle === "orphaned");
  const recentBlockers = useMemo(
    () => buildRecentBlockers(sessions, sortedAuditEvents),
    [sessions, sortedAuditEvents],
  );
  const latestFinalReport = sortedAuditEvents.find(isFinalReportEvent) ?? null;
  const contextPressure = Math.round(summary.peakContextPct);
  const contextState =
    contextPressure >= contextWarnPct
      ? ({
          tone: "watch",
          label: "Handoff watch",
          detail: `${contextPressure}% peak context`,
          icon: <AlertTriangle size={13} />,
          actionLabel: "Observe",
          action: onOpenObserve,
        } satisfies MissionSignal)
      : ({
          tone: summary.tokenConfidence === "unknown" ? "quiet" : "good",
          label: "Context stable",
          detail:
            summary.tokenConfidence === "unknown"
              ? "No token telemetry yet"
              : `${compactWorkstationNumber(summary.totalTokens)} tokens tracked`,
          icon: <HeartPulse size={13} />,
        } satisfies MissionSignal);
  const longrun = pickLongrunSignal(summary, sessions, interactiveSessionCount, onOpenObserve);
  const releaseReadiness = pickReleaseSignal(recentBlockers, reviewQueue, summary, onOpenReview);
  const workspaceHealth = pickWorkspaceHealth({
    blockerCount: recentBlockers.length,
    auditEvents: sortedAuditEvents,
    detachedPaneCount: detachedPanes.length,
    contextPressure,
    contextWarnPct,
    danglingEdgeCount: workstationGraph?.integrity.danglingEdgeCount ?? 0,
  });
  const nextAction = pickNextAction({
    blockers: recentBlockers,
    reviewQueue,
    summary,
    contextPressure,
    contextWarnPct,
    onOpenCommand,
    onOpenReview,
    onOpenObserve,
  });

  return (
    <section
      className={styles.home}
      aria-label="Mission Control home"
      data-health={workspaceHealth.tone}
      data-graph-source={workstationGraph ? "workstation-graph" : "app-state"}
    >
      <header className={styles.header}>
        <div className={styles.projectBlock}>
          <span className={styles.kicker}>Mission Control</span>
          <h2 className={styles.title}>{projectName}</h2>
          <div className={styles.projectMeta}>
            <span title={branch ? `Branch ${branch}` : "Branch unavailable"}>
              <GitBranch size={12} aria-hidden="true" />
              {branch || "no branch"}
            </span>
            <span className={styles.path} title={projectPath}>
              {projectPath}
            </span>
          </div>
        </div>

        <div className={styles.nextAction} data-tone={nextAction.tone} aria-label="Current next action">
          <span className={styles.nextLabel}>Next action</span>
          <span className={styles.nextValue}>{nextAction.label}</span>
          <span className={styles.nextDetail}>{nextAction.detail}</span>
          {nextAction.action && nextAction.actionLabel && (
            <button type="button" className={styles.actionButton} onClick={nextAction.action}>
              <Zap size={12} aria-hidden="true" />
              {nextAction.actionLabel}
            </button>
          )}
        </div>
      </header>

      <div className={styles.metricGrid} aria-label="Mission Control summary">
        <Metric icon={<Terminal size={13} />} label="Panes" value={String(activePanes.length)} detail={`${panes.length} total`} />
        <Metric icon={<Bot size={13} />} label="Agents" value={String(summary.liveRunCount)} detail={`${sessions.length} tracked`} />
        <Metric
          icon={<GitCompare size={13} />}
          label="Review queue"
          value={String(reviewQueue.items.length)}
          detail={`${reviewQueue.highRiskCount} high risk`}
        />
        <Metric
          icon={<HeartPulse size={13} />}
          label="Context"
          value={`${contextPressure}%`}
          detail={summary.contextConfidence}
        />
        <Metric
          icon={<Layers size={13} />}
          label="Graph"
          value={String(workstationGraph?.nodes.length ?? 0)}
          detail={`${workstationGraph?.edges.length ?? 0} edges`}
        />
      </div>

      <div className={styles.statusGrid}>
        <StatusTile title="Current longrun" signal={longrun} />
        <StatusTile
          title="Review queue"
          signal={{
            tone: reviewQueue.items.length > 0 ? "review" : "good",
            label: reviewQueue.items.length > 0 ? `${reviewQueue.items.length} files waiting` : "No review queue",
            detail:
              reviewQueue.items.length > 0
                ? `${reviewQueue.conflictCount} conflicts / ${reviewQueue.highRiskCount} high risk`
                : "Working tree has no queued review items",
            icon: reviewQueue.items.length > 0 ? <GitCompare size={13} /> : <CheckCircle2 size={13} />,
            actionLabel: reviewQueue.items.length > 0 ? "Review" : undefined,
            action: reviewQueue.items.length > 0 ? onOpenReview : undefined,
          }}
        />
        <StatusTile title="Context pressure" signal={contextState} />
        <BlockerTile blockers={recentBlockers} />
        <StatusTile
          title="Last final report"
          signal={{
            tone: latestFinalReport ? "good" : "quiet",
            label: latestFinalReport ? compactSummary(latestFinalReport.summary || latestFinalReport.action, 56) : "No final report yet",
            detail: latestFinalReport ? formatAge(latestFinalReport.timestamp) : "Completion reports will appear here",
            icon: <FileText size={13} />,
          }}
        />
        <StatusTile title="Release readiness" signal={releaseReadiness} />
        <StatusTile title="Workspace health" signal={workspaceHealth} />
      </div>
    </section>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricText}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={styles.metricDetail}>{detail}</span>
      </span>
    </div>
  );
}

function StatusTile({ title, signal }: { title: string; signal: MissionSignal }) {
  return (
    <section className={styles.statusTile} data-tone={signal.tone} aria-label={title}>
      <div className={styles.tileTop}>
        <span className={styles.tileIcon} aria-hidden="true">
          {signal.icon}
        </span>
        <span className={styles.tileTitle}>{title}</span>
      </div>
      <div className={styles.tileLabel}>{signal.label}</div>
      <div className={styles.tileDetail}>{signal.detail}</div>
      {signal.action && signal.actionLabel && (
        <button type="button" className={styles.tileAction} onClick={signal.action}>
          {signal.actionLabel}
        </button>
      )}
    </section>
  );
}

function BlockerTile({ blockers }: { blockers: readonly BlockerItem[] }) {
  return (
    <section className={styles.statusTile} data-tone={blockers.length > 0 ? "danger" : "good"} aria-label="Recent blockers">
      <div className={styles.tileTop}>
        <span className={styles.tileIcon} aria-hidden="true">
          {blockers.length > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
        </span>
        <span className={styles.tileTitle}>Recent blockers</span>
      </div>
      {blockers.length === 0 ? (
        <>
          <div className={styles.tileLabel}>No blockers</div>
          <div className={styles.tileDetail}>No waiting agents or recent blocking events</div>
        </>
      ) : (
        <ul className={styles.blockerList}>
          {blockers.slice(0, 3).map((blocker) => (
            <li key={blocker.id} className={styles.blockerItem} data-tone={blocker.tone}>
              <span className={styles.blockerLabel}>{blocker.label}</span>
              <span className={styles.blockerDetail}>{blocker.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function buildRecentBlockers(
  sessions: readonly AgentSession[],
  auditEvents: readonly AuditEventRecord[],
): BlockerItem[] {
  const sessionBlockers = sessions
    .filter((session) => session.status === "waiting" || session.status === "error")
    .map<BlockerItem>((session) => ({
      id: `session-${session.id}`,
      label: session.name,
      detail: session.status === "error" ? "Agent error" : "Needs attention",
      tone: session.status === "error" ? "danger" : "watch",
    }));

  const auditBlockers = auditEvents.filter(isBlockingAuditEvent).map<BlockerItem>((event) => ({
    id: `audit-${event.id}`,
    label: compactSummary(event.summary || event.action, 42),
    detail: event.category || event.action,
    tone: event.severity === "error" ? "danger" : "watch",
  }));

  return [...sessionBlockers, ...auditBlockers].slice(0, 5);
}

function pickLongrunSignal(
  summary: ReturnType<typeof buildWorkstationSummary>,
  sessions: readonly AgentSession[],
  interactiveSessionCount: number,
  onOpenObserve?: () => void,
): MissionSignal {
  const liveSession = summary.liveSessions[0] ?? null;
  if (liveSession) {
    return {
      tone: liveSession.status === "waiting" ? "watch" : "good",
      label: liveSession.name,
      detail: `${liveSession.status} / ${liveSession.model}`,
      icon: <Radio size={13} />,
      actionLabel: "Observe",
      action: onOpenObserve,
    };
  }
  if (interactiveSessionCount > 0) {
    return {
      tone: "good",
      label: "Interactive agent active",
      detail: `${interactiveSessionCount} interactive session${interactiveSessionCount === 1 ? "" : "s"}`,
      icon: <Bot size={13} />,
      actionLabel: "Observe",
      action: onOpenObserve,
    };
  }
  const latestDone = sessions.find((session) => session.status === "done") ?? null;
  return {
    tone: latestDone ? "quiet" : "quiet",
    label: latestDone ? "No active longrun" : "Idle",
    detail: latestDone ? `${latestDone.name} completed` : "No agent run is active",
    icon: <Activity size={13} />,
  };
}

function pickReleaseSignal(
  blockers: readonly BlockerItem[],
  reviewQueue: ReturnType<typeof buildReviewQueue>,
  summary: ReturnType<typeof buildWorkstationSummary>,
  onOpenReview?: () => void,
): MissionSignal {
  if (blockers.length > 0 || reviewQueue.conflictCount > 0) {
    return {
      tone: "danger",
      label: "Blocked",
      detail: blockers.length > 0 ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "Conflicts in review queue",
      icon: <AlertTriangle size={13} />,
      actionLabel: "Review",
      action: onOpenReview,
    };
  }
  if (reviewQueue.highRiskCount > 0 || reviewQueue.items.length > 0) {
    return {
      tone: "review",
      label: "Review needed",
      detail: `${reviewQueue.items.length} changed file${reviewQueue.items.length === 1 ? "" : "s"}`,
      icon: <GitCompare size={13} />,
      actionLabel: "Review",
      action: onOpenReview,
    };
  }
  if (summary.liveRunCount > 0) {
    return {
      tone: "watch",
      label: "Run in progress",
      detail: `${summary.liveRunCount} active run${summary.liveRunCount === 1 ? "" : "s"}`,
      icon: <Radio size={13} />,
    };
  }
  return {
    tone: "good",
    label: "Ready",
    detail: "No blockers or queued changes",
    icon: <ShieldCheck size={13} />,
  };
}

function pickWorkspaceHealth({
  blockerCount,
  auditEvents,
  detachedPaneCount,
  contextPressure,
  contextWarnPct,
  danglingEdgeCount,
}: {
  blockerCount: number;
  auditEvents: readonly AuditEventRecord[];
  detachedPaneCount: number;
  contextPressure: number;
  contextWarnPct: number;
  danglingEdgeCount: number;
}): MissionSignal {
  const errorCount = auditEvents.filter((event) => event.severity === "error").length;
  const warnCount = auditEvents.filter((event) => event.severity === "warn").length;
  if (blockerCount > 0 || errorCount > 0 || danglingEdgeCount > 0) {
    return {
      tone: "danger",
      label: "Needs attention",
      detail:
        danglingEdgeCount > 0
          ? `${danglingEdgeCount} graph integrity issue${danglingEdgeCount === 1 ? "" : "s"}`
          : blockerCount > 0
            ? `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`
            : `${errorCount} error event${errorCount === 1 ? "" : "s"}`,
      icon: <AlertTriangle size={13} />,
    };
  }
  if (warnCount > 0 || detachedPaneCount > 0 || contextPressure >= contextWarnPct) {
    return {
      tone: "watch",
      label: "Watch",
      detail:
        detachedPaneCount > 0
          ? `${detachedPaneCount} detached pane${detachedPaneCount === 1 ? "" : "s"}`
          : `${warnCount} warning event${warnCount === 1 ? "" : "s"}`,
      icon: <HeartPulse size={13} />,
    };
  }
  return {
    tone: "good",
    label: "Healthy",
    detail: "No recent incidents",
    icon: <CheckCircle2 size={13} />,
  };
}

function pickNextAction({
  blockers,
  reviewQueue,
  summary,
  contextPressure,
  contextWarnPct,
  onOpenCommand,
  onOpenReview,
  onOpenObserve,
}: {
  blockers: readonly BlockerItem[];
  reviewQueue: ReturnType<typeof buildReviewQueue>;
  summary: ReturnType<typeof buildWorkstationSummary>;
  contextPressure: number;
  contextWarnPct: number;
  onOpenCommand?: () => void;
  onOpenReview?: () => void;
  onOpenObserve?: () => void;
}): MissionSignal {
  if (blockers.length > 0) {
    return {
      tone: "danger",
      label: "Resolve blocker",
      detail: blockers[0].label,
      icon: <AlertTriangle size={13} />,
      actionLabel: "Observe",
      action: onOpenObserve,
    };
  }
  if (reviewQueue.conflictCount > 0 || reviewQueue.highRiskCount > 0 || reviewQueue.items.length > 0) {
    return {
      tone: "review",
      label: reviewQueue.highRiskCount > 0 ? "Review high-risk files" : "Review changes",
      detail: `${reviewQueue.items.length} queued file${reviewQueue.items.length === 1 ? "" : "s"}`,
      icon: <GitCompare size={13} />,
      actionLabel: "Review",
      action: onOpenReview,
    };
  }
  if (contextPressure >= contextWarnPct) {
    return {
      tone: "watch",
      label: "Prepare handoff",
      detail: `${contextPressure}% peak context`,
      icon: <HeartPulse size={13} />,
      actionLabel: "Observe",
      action: onOpenObserve,
    };
  }
  if (summary.liveRunCount > 0) {
    return {
      tone: "good",
      label: "Monitor active run",
      detail: `${summary.liveRunCount} live run${summary.liveRunCount === 1 ? "" : "s"}`,
      icon: <Radio size={13} />,
      actionLabel: "Observe",
      action: onOpenObserve,
    };
  }
  return {
    tone: "quiet",
    label: "Open terminal or start agent",
    detail: "Workspace is idle",
    icon: <Terminal size={13} />,
    actionLabel: "Command",
    action: onOpenCommand,
  };
}

function isBlockingAuditEvent(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return (event.severity === "warn" || event.severity === "error") && BLOCKER_PATTERN.test(source);
}

function isFinalReportEvent(event: AuditEventRecord): boolean {
  const source = `${event.category} ${event.action} ${event.summary}`;
  return FINAL_REPORT_PATTERN.test(source);
}

function compactSummary(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 3))}...` : compact;
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function formatAge(timestamp: string): string {
  const ms = timestampMs(timestamp);
  if (ms <= 0) return "timestamp unavailable";
  const delta = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
