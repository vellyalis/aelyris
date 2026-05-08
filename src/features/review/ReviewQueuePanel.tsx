import { AlertTriangle, Bot, FileSearch, GitCompare, ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import type { OrchestraRoleId } from "../../shared/lib/orchestrator";
import {
  buildReviewQueue,
  type GitChangedFile,
  type ReviewCoverageState,
  type ReviewMergeReadiness,
  type ReviewRisk,
  type ReviewValidationState,
} from "../../shared/lib/reviewQueue";
import { listWorkstationGraphChangedFiles, type WorkstationGraph } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./ReviewQueuePanel.module.css";

interface ReviewQueuePanelProps {
  sessions: AgentSession[];
  changedFiles: GitChangedFile[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onOpenDiff: (path: string) => void;
  onStartAgent?: (prompt: string, model?: string, meta?: { role?: OrchestraRoleId; handoffFrom?: string }) => void;
  workstationGraph?: WorkstationGraph;
}

const RISK_LABELS: Record<ReviewRisk, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const READINESS_LABELS: Record<ReviewMergeReadiness, string> = {
  blocked: "Blocked",
  needs_validation: "Validate",
  needs_review: "Review",
  ready: "Ready",
};

const COVERAGE_LABELS: Record<ReviewCoverageState, string> = {
  covered: "Covered",
  missing: "Coverage gap",
  not_required: "No coverage req",
  unknown: "Coverage unknown",
};

const VALIDATION_LABELS: Record<ReviewValidationState, string> = {
  passed: "Validated",
  failed: "Validation failed",
  missing: "No validation",
  unknown: "Validation unknown",
};

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function parentPath(path: string): string {
  const name = fileName(path);
  return path === name ? "" : path.slice(0, Math.max(0, path.length - name.length));
}

function buildReviewerPrompt(items: ReturnType<typeof buildReviewQueue>["items"]): string {
  const fileList = items
    .slice(0, 12)
    .map(
      (item) =>
        `- ${item.path} (score ${item.score}, ${item.mergeReadiness}, ${item.risk}/${item.riskClass}; ${item.diffstat.additions}+/${item.diffstat.deletions}-; coverage ${item.coverage}; validation ${item.validation})`,
    )
    .join("\n");
  return `Review the current working tree changes for bugs, regressions, security risks, missing tests, and merge readiness.\n\nCreate a targeted validation plan before recommending merge.\n\nFocus files:\n${fileList}`;
}

export function ReviewQueuePanel({
  sessions,
  changedFiles,
  activeSessionId,
  onSelectSession,
  onOpenDiff,
  onStartAgent,
  workstationGraph,
}: ReviewQueuePanelProps) {
  const graphChangedFiles = useMemo(() => listWorkstationGraphChangedFiles(workstationGraph), [workstationGraph]);
  const queueChangedFiles = useMemo(
    () => (workstationGraph ? graphChangedFiles : mergeChangedFiles(changedFiles, graphChangedFiles)),
    [changedFiles, graphChangedFiles, workstationGraph],
  );
  const queue = useMemo(() => buildReviewQueue(sessions, queueChangedFiles), [sessions, queueChangedFiles]);
  const visibleItems = queue.items.slice(0, 6);
  const canStartReviewer = queue.items.length > 0 && onStartAgent;

  return (
    <section
      className={styles.panel}
      aria-label="AI review queue"
      data-empty={queue.items.length === 0}
      data-graph-source={workstationGraph ? "workstation-graph" : "git-status"}
    >
      <PanelHeader
        title="Review Queue"
        leadingIcon={<GitCompare size={12} />}
        count={queue.items.length > 0 ? queue.items.length : undefined}
        actions={
          canStartReviewer ? (
            <button
              type="button"
              className={styles.reviewAgentBtn}
              onClick={() => onStartAgent?.(buildReviewerPrompt(queue.items), "opus", { role: "reviewer" })}
              title="Start a reviewer agent for the current queue"
              aria-label="Start reviewer agent"
            >
              <Bot size={11} aria-hidden="true" />
              Reviewer
            </button>
          ) : null
        }
      />

      {queue.items.length === 0 ? (
        <EmptyState
          icon={<FileSearch size={18} />}
          title="No review queue"
          description="Changed files and agent edits will appear here before commit or merge."
        />
      ) : (
        <div className={styles.body}>
          <section className={styles.metrics} aria-label="Review summary">
            <Metric label="Risk" value={queue.highRiskCount} />
            <Metric label="Conflicts" value={queue.conflictCount} />
            <Metric label="Validate" value={queue.needsValidationCount} />
            <Metric label="Ready" value={queue.readyCount} />
          </section>

          <div className={styles.readinessSummary} data-readiness={queue.mergeReadiness}>
            <span>Merge readiness</span>
            <strong>{READINESS_LABELS[queue.mergeReadiness]}</strong>
            <span>{queue.totalRiskScore} risk points</span>
          </div>

          <div className={styles.list}>
            {visibleItems.map((item) => {
              const active = item.sessions.some((session) => session.id === activeSessionId);
              return (
                <div key={item.path} className={styles.item} data-risk={item.risk} data-active={active || undefined}>
                  <div className={styles.itemTop}>
                    <span className={styles.fileIcon} aria-hidden="true">
                      {item.conflict ? <AlertTriangle size={12} /> : <ShieldAlert size={12} />}
                    </span>
                    <button
                      type="button"
                      className={styles.fileButton}
                      onClick={() => onOpenDiff(item.path)}
                      title={item.path}
                    >
                      <span className={styles.fileName}>{fileName(item.path)}</span>
                      <span className={styles.filePath}>{parentPath(item.path)}</span>
                    </button>
                    <span className={styles.riskBadge} data-risk={item.risk}>
                      {RISK_LABELS[item.risk]}
                    </span>
                    <span className={styles.scoreBadge} title={`Review score ${item.score}`}>
                      {item.score}
                    </span>
                  </div>
                  <div className={styles.itemMeta}>
                    <span className={styles.reason}>{item.reason}</span>
                    <span className={styles.status}>{item.status}</span>
                    <span className={styles.itemScoreLine}>
                      <span data-readiness={item.mergeReadiness}>{READINESS_LABELS[item.mergeReadiness]}</span>
                      <span>
                        {item.diffstat.binary ? "binary" : `${item.diffstat.additions}+/${item.diffstat.deletions}-`}
                      </span>
                      <span>{COVERAGE_LABELS[item.coverage]}</span>
                      <span>{VALIDATION_LABELS[item.validation]}</span>
                    </span>
                    {item.signals.length > 0 && (
                      <span className={styles.signalChips}>
                        {item.signals.slice(0, 5).map((signal) => (
                          <span key={signal} className={styles.signalChip}>
                            {signal}
                          </span>
                        ))}
                      </span>
                    )}
                    {item.sessions.length > 0 && (
                      <span className={styles.sessionChips}>
                        {item.sessions.slice(0, 3).map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            className={styles.sessionChip}
                            data-active={session.id === activeSessionId || undefined}
                            onClick={() => onSelectSession(session.id)}
                            title={`Select ${session.name}`}
                          >
                            {session.owner ?? session.role ?? session.name}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {queue.items.length > visibleItems.length && (
            <div className={styles.more}>+{queue.items.length - visibleItems.length} more files in SCM</div>
          )}
        </div>
      )}
    </section>
  );
}

function mergeChangedFiles(base: readonly GitChangedFile[], graphFiles: readonly GitChangedFile[]): GitChangedFile[] {
  if (graphFiles.length === 0) return [...base];
  const byPath = new Map<string, GitChangedFile>();
  for (const file of base) byPath.set(file.path.replace(/\\/g, "/").toLowerCase(), file);
  for (const file of graphFiles) {
    const normalized = file.path.replace(/\\/g, "/");
    const key = normalized.toLowerCase();
    byPath.set(key, { path: normalized, status: byPath.get(key)?.status ?? file.status });
  }
  return [...byPath.values()];
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  );
}
