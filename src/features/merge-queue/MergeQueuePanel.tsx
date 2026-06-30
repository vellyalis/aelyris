import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, GitMerge, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentFleet } from "../../shared/hooks/useAgentFleet";
import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import { toast } from "../../shared/store/toastStore";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./MergeQueuePanel.module.css";

/** Mirrors crate::git::MergeReadiness (serde camelCase). */
interface MergeReadiness {
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  sourceOid: string;
  targetOid: string;
  mergeBaseOid?: string | null;
  sourceAhead: number;
  sourceBehind: number;
  canFastForward: boolean;
  alreadyMerged: boolean;
  status: "already_merged" | "fast_forward_ready" | "merge_review_required";
}

/** Mirrors crate::merge_intent::MergeIntent (serde camelCase). */
interface MergeIntent {
  intentId: string;
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  state: string;
  taskId: string;
}

/** Mirrors crate::control::merge::DurableMergeExecution (serde camelCase). */
interface DurableMergeExecution {
  intentId: string;
  status: string;
}

const READINESS_META: Record<MergeReadiness["status"], { label: string; tone: string }> = {
  already_merged: { label: "Already merged", tone: "merged" },
  fast_forward_ready: { label: "Fast-forward ready", tone: "ready" },
  merge_review_required: { label: "Review required", tone: "review" },
};

/** Intent states from which the operator may still approve a merge. */
const APPROVABLE_STATES = new Set(["queued", "ready_to_merge"]);

interface MergeQueuePanelProps {
  visible: boolean;
  onClose: () => void;
}

function isMergeableDoneSession(session: AgentFleetSession): boolean {
  return session.runStatus === "done" && Boolean(session.worktreeBranch) && Boolean(session.repoPath);
}

export function MergeQueuePanel({ visible, onClose }: MergeQueuePanelProps) {
  const { fleetSessions } = useAgentFleet();
  const [targetBranch, setTargetBranch] = useState("main");
  const [intents, setIntents] = useState<MergeIntent[]>([]);
  const intentsSeq = useRef(0);

  const doneSessions = fleetSessions.filter(isMergeableDoneSession);

  const loadIntents = useCallback(async () => {
    const requestId = ++intentsSeq.current;
    try {
      const result = await invoke<MergeIntent[]>("merge_intents_pending");
      if (requestId !== intentsSeq.current) return;
      setIntents(result);
    } catch {
      if (requestId !== intentsSeq.current) return;
      // Merge persistence may be unattached (browser dev / fresh workspace);
      // an empty list is the correct read-only fallback.
      setIntents([]);
    }
  }, []);

  useEffect(() => {
    if (visible) void loadIntents();
  }, [visible, loadIntents]);

  const requestMerge = useCallback(
    async (session: AgentFleetSession) => {
      try {
        await invoke<MergeIntent>("request_merge_intent", {
          repoPath: session.repoPath,
          taskId: session.id,
          sessionId: session.id,
          sourceBranch: session.worktreeBranch,
          targetBranch,
        });
        toast.success("Merge requested", `${session.worktreeBranch} → ${targetBranch}`);
        await loadIntents();
      } catch (err) {
        toast.error("Merge request failed", err instanceof Error ? err.message : String(err));
      }
    },
    [targetBranch, loadIntents],
  );

  const approveMerge = useCallback(
    async (intent: MergeIntent) => {
      try {
        const execution = await invoke<DurableMergeExecution>("approve_merge_intent", {
          intentId: intent.intentId,
          reviewerId: "operator",
        });
        if (execution.status === "merged") {
          toast.success("Merged", `${intent.sourceBranch} → ${intent.targetBranch}`);
        } else {
          toast.info(`Merge ${execution.status}`, `${intent.sourceBranch} → ${intent.targetBranch}`);
        }
        await loadIntents();
      } catch (err) {
        // StaleTips / NeedsReconcile / conflict surface here — never assume success.
        toast.error("Approve failed", err instanceof Error ? err.message : String(err));
      }
    },
    [loadIntents],
  );

  // Match an intent to a session by task identity (the session id we send as
  // taskId at request time), NOT by branch pair alone — two repos can reuse a
  // branch name, and a branch can be reused for a newer task. Approve only sends
  // intentId, so a wrong match would merge an unrelated intent.
  const matchIntentForSession = (session: AgentFleetSession): MergeIntent | undefined =>
    intents.find(
      (intent) =>
        intent.taskId === session.id &&
        intent.sourceBranch === session.worktreeBranch &&
        intent.targetBranch === targetBranch,
    );

  // Durable intents persist across restart / session pruning; surface any that
  // no longer have a live session as their own rows so the operator can still
  // inspect and approve them instead of seeing an empty list.
  const matchedIntentIds = new Set(
    doneSessions
      .map((session) => matchIntentForSession(session)?.intentId)
      .filter((id): id is string => Boolean(id)),
  );
  const orphanIntents = intents.filter((intent) => !matchedIntentIds.has(intent.intentId));

  if (!visible) return null;

  return (
    <div className={styles.panel}>
      <PanelHeader
        title="Ready to Merge"
        count={doneSessions.length + orphanIntents.length}
        actions={
          <>
            <label className={styles.targetField} title="Target branch">
              →
              <input
                className={styles.targetInput}
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                aria-label="Target branch"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void loadIntents()}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button type="button" className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close">
              <X size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        }
      />
      <div className={styles.list}>
        {doneSessions.map((session) => {
          const intent = matchIntentForSession(session);
          return (
            <MergeRow
              key={`s:${session.id}`}
              sourceBranch={session.worktreeBranch ?? ""}
              repoPath={session.repoPath ?? ""}
              targetBranch={targetBranch}
              intent={intent}
              onRequest={() => requestMerge(session)}
              onApprove={intent ? () => approveMerge(intent) : undefined}
            />
          );
        })}
        {orphanIntents.map((intent) => (
          <MergeRow
            key={`i:${intent.intentId}`}
            sourceBranch={intent.sourceBranch}
            repoPath={intent.repoPath}
            targetBranch={intent.targetBranch}
            intent={intent}
            onApprove={() => approveMerge(intent)}
          />
        ))}
        {doneSessions.length === 0 && orphanIntents.length === 0 && (
          <EmptyState
            icon={<GitMerge size={20} strokeWidth={1.5} />}
            title="No branches ready to merge"
            description="When an agent finishes on its worktree branch, its merge outcome shows up here."
          />
        )}
      </div>
    </div>
  );
}

interface MergeRowProps {
  sourceBranch: string;
  repoPath: string;
  targetBranch: string;
  intent?: MergeIntent;
  /** Present only for live done-session rows; orphan-intent rows are already requested. */
  onRequest?: () => void;
  onApprove?: () => void;
}

function MergeRow({ sourceBranch, repoPath, targetBranch, intent, onRequest, onApprove }: MergeRowProps) {
  const [readiness, setReadiness] = useState<MergeReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const readinessSeq = useRef(0);
  const diffSeq = useRef(0);

  useEffect(() => {
    if (!sourceBranch || !repoPath || sourceBranch === targetBranch) return;
    const requestId = ++readinessSeq.current;
    setReadiness(null);
    setReadinessError(null);
    void (async () => {
      try {
        const result = await invoke<MergeReadiness>("inspect_merge_worktree_branch", {
          repoPath,
          sourceBranch,
          targetBranch,
        });
        if (requestId !== readinessSeq.current) return;
        setReadiness(result);
      } catch (err) {
        if (requestId !== readinessSeq.current) return;
        setReadinessError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [repoPath, sourceBranch, targetBranch]);

  const toggleDiff = async () => {
    if (expanded) {
      diffSeq.current += 1;
      setExpanded(false);
      setDiff(null);
      return;
    }
    const requestId = ++diffSeq.current;
    setExpanded(true);
    setDiff(null);
    try {
      const result = await invoke<string>("merge_diff", { repoPath, base: targetBranch, branch: sourceBranch });
      if (requestId !== diffSeq.current) return;
      setDiff(result.length > 0 ? result : "(no differences)");
    } catch (err) {
      if (requestId !== diffSeq.current) return;
      setDiff(`Failed to load diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const readinessMeta = readiness ? READINESS_META[readiness.status] : null;
  const canApprove = Boolean(onApprove) && intent != null && APPROVABLE_STATES.has(intent.state);

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.branch} title={`${sourceBranch} → ${targetBranch}`}>
          {sourceBranch}
        </span>
        {readinessMeta && (
          <span className={styles.statePill} data-tone={readinessMeta.tone}>
            {readinessMeta.label}
          </span>
        )}
        {readiness && (
          <span className={styles.aheadBehind}>
            ↑{readiness.sourceAhead} ↓{readiness.sourceBehind}
          </span>
        )}
        {intent && (
          <span className={styles.intentBadge} data-state={intent.state} title={`Intent ${intent.intentId}`}>
            {intent.state}
          </span>
        )}
        {readinessError && <span className={styles.rowError}>{readinessError}</span>}
      </div>
      <div className={styles.rowActions}>
        <button type="button" className={styles.actionBtn} onClick={() => void toggleDiff()}>
          {expanded ? "Hide diff" : "View diff"}
        </button>
        {onRequest && !intent && (
          <button type="button" className={styles.actionBtn} onClick={onRequest} title="Request a durable merge intent">
            Request merge
          </button>
        )}
        {canApprove && onApprove && (
          <button type="button" className={styles.approveBtn} onClick={onApprove} title="Approve and merge">
            <CheckCircle2 size={10} strokeWidth={2} aria-hidden="true" />
            Approve
          </button>
        )}
      </div>
      {expanded && diff != null && (
        <pre className={styles.diffPreview}>
          {diff.slice(0, 4000)}
          {diff.length > 4000 ? "\n…" : ""}
        </pre>
      )}
    </div>
  );
}
