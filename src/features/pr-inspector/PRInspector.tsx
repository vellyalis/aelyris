import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { LoadingSkeleton } from "../../shared/ui/LoadingSkeleton";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./PRInspector.module.css";

interface CheckRun {
  status?: string;
  conclusion?: string;
  state?: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: { login?: string };
  headRefName: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  reviewDecision: string;
  statusCheckRollup: CheckRun[] | null;
}

interface PRInspectorProps {
  visible: boolean;
  projectPath: string;
  onClose: () => void;
  onViewDiff?: (diff: string, prNumber: number) => void;
  onStartReview?: (prompt: string) => void;
}

type PrState = "open" | "draft" | "merged" | "closed";

function derivePrState(pr: PullRequest): PrState {
  const s = pr.state.toUpperCase();
  if (s === "MERGED") return "merged";
  if (s === "CLOSED") return "closed";
  if (pr.isDraft) return "draft";
  return "open";
}

const STATE_META: Record<PrState, { label: string; color: string; icon: typeof GitPullRequest }> = {
  open: { label: "Open", color: "var(--ctp-green)", icon: GitPullRequest },
  draft: { label: "Draft", color: "var(--ctp-yellow)", icon: GitPullRequestDraft },
  merged: { label: "Merged", color: "var(--ctp-mauve)", icon: GitMerge },
  closed: { label: "Closed", color: "var(--ctp-red)", icon: GitPullRequestClosed },
};

type CiState = "passing" | "failing" | "pending" | "none";

function deriveCiState(checks: CheckRun[] | null | undefined): CiState {
  if (!checks || checks.length === 0) return "none";
  let anyPending = false;
  let anyFailure = false;
  for (const c of checks) {
    // GitHub mixes two shapes: GH Actions uses `conclusion` once completed and
    // `status` while queued/in-progress; classic statuses use `state`.
    const conclusion = (c.conclusion ?? c.state ?? "").toUpperCase();
    const status = (c.status ?? "").toUpperCase();
    if (status === "QUEUED" || status === "IN_PROGRESS" || conclusion === "PENDING") {
      anyPending = true;
    }
    if (
      conclusion === "FAILURE" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "ACTION_REQUIRED" ||
      conclusion === "CANCELLED" ||
      conclusion === "ERROR"
    ) {
      anyFailure = true;
    }
  }
  if (anyFailure) return "failing";
  if (anyPending) return "pending";
  return "passing";
}

const CI_META: Record<CiState, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  passing: { label: "CI passing", color: "var(--ctp-green)", icon: CheckCircle2 },
  failing: { label: "CI failing", color: "var(--ctp-red)", icon: XCircle },
  pending: { label: "CI pending", color: "var(--ctp-sapphire)", icon: Clock },
  none: { label: "No checks", color: "var(--text-muted)", icon: CircleDashed },
};

type ReviewState = "approved" | "changes" | "commented" | "requested" | "none";

function deriveReviewState(decision: string): ReviewState {
  const d = decision.toUpperCase();
  if (d === "APPROVED") return "approved";
  if (d === "CHANGES_REQUESTED") return "changes";
  if (d === "COMMENTED") return "commented";
  if (d === "REVIEW_REQUIRED") return "requested";
  return "none";
}

const REVIEW_META: Record<ReviewState, { label: string; color: string; icon: typeof CheckCircle2 } | null> = {
  approved: { label: "Approved", color: "var(--ctp-green)", icon: CheckCircle2 },
  changes: { label: "Changes requested", color: "var(--ctp-red)", icon: AlertCircle },
  commented: { label: "Commented", color: "var(--ctp-sapphire)", icon: MessageSquare },
  requested: { label: "Review requested", color: "var(--ctp-yellow)", icon: Clock },
  none: null,
};

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  if (diffMon < 12) return `${diffMon}mo ago`;
  return `${Math.floor(diffMon / 12)}y ago`;
}

export function PRInspector({ visible, projectPath, onClose, onViewDiff, onStartReview }: PRInspectorProps) {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPr, setExpandedPr] = useState<number | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const loadPRs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PullRequest[]>("list_pull_requests", { cwd: projectPath });
      setPrs(result);
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    if (visible) loadPRs();
  }, [loadPRs, visible]);

  const viewDiff = async (prNumber: number) => {
    if (expandedPr === prNumber) {
      setExpandedPr(null);
      setDiff(null);
      return;
    }
    setExpandedPr(prNumber);
    try {
      const d = await invoke<string>("get_pr_diff", { cwd: projectPath, prNumber });
      setDiff(d);
      onViewDiff?.(d, prNumber);
    } catch {
      setDiff("Failed to load diff");
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <PanelHeader
            title="Pull Requests"
            count={prs.length}
            actions={
              <>
                <button className={styles.iconBtn} onClick={loadPRs} title="Refresh" aria-label="Refresh">
                  <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <button className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close">
                  <X size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </>
            }
          />
          <div className={styles.list}>
            {loading && <LoadingSkeleton variant="card" count={3} label="Loading pull requests" />}
            {error && <div className={styles.error}>{error}</div>}
            {prs.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                expanded={expandedPr === pr.number}
                diff={expandedPr === pr.number ? diff : null}
                onExpand={() => viewDiff(pr.number)}
                onStartReview={onStartReview}
              />
            ))}
            {!loading && prs.length === 0 && !error && (
              <EmptyState
                icon={<GitPullRequest size={20} strokeWidth={1.5} />}
                title="No open pull requests"
                description="Pull requests on this repository will appear here."
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface PrRowProps {
  pr: PullRequest;
  expanded: boolean;
  diff: string | null;
  onExpand: () => void;
  onStartReview?: (prompt: string) => void;
}

function PrRow({ pr, expanded, diff, onExpand, onStartReview }: PrRowProps) {
  const state = useMemo(() => derivePrState(pr), [pr]);
  const ciState = useMemo(() => deriveCiState(pr.statusCheckRollup), [pr.statusCheckRollup]);
  const reviewState = useMemo(() => deriveReviewState(pr.reviewDecision), [pr.reviewDecision]);
  const updatedAt = useMemo(() => formatRelativeTime(pr.updatedAt), [pr.updatedAt]);

  const StatePillIcon = STATE_META[state].icon;
  const CiIcon = CI_META[ciState].icon;
  const review = REVIEW_META[reviewState];

  return (
    <div className={styles.prContainer}>
      <button className={styles.prCard} onClick={onExpand}>
        <div className={styles.prHeader}>
          <span
            className={styles.statePill}
            style={{ color: STATE_META[state].color, borderColor: STATE_META[state].color }}
          >
            <StatePillIcon size={10} strokeWidth={2} aria-hidden="true" />
            {STATE_META[state].label}
          </span>
          <span className={styles.prNumber}>#{pr.number}</span>
          <span className={styles.prTitle}>{pr.title}</span>
        </div>
        <div className={styles.prMeta}>
          {pr.author?.login && <span className={styles.metaItem}>@{pr.author.login}</span>}
          <span className={styles.prBranch}>{pr.headRefName}</span>
          <span className={styles.metaItem} style={{ color: CI_META[ciState].color }} title={CI_META[ciState].label}>
            <CiIcon size={10} strokeWidth={2} aria-hidden="true" />
            {CI_META[ciState].label}
          </span>
          {review && (
            <span className={styles.metaItem} style={{ color: review.color }} title={review.label}>
              <review.icon size={10} strokeWidth={2} aria-hidden="true" />
              {review.label}
            </span>
          )}
          {updatedAt && <span className={styles.metaItemMuted}>{updatedAt}</span>}
        </div>
      </button>
      {expanded && diff && (
        <>
          <pre className={styles.diffPreview}>
            {diff.slice(0, 2000)}
            {diff.length > 2000 ? "\n..." : ""}
          </pre>
          {onStartReview && (
            <button
              className={styles.reviewBtn}
              onClick={() => onStartReview(`Review PR #${pr.number}: ${pr.title}\n\nDiff:\n${diff.slice(0, 8000)}`)}
            >
              Review with Agent
            </button>
          )}
        </>
      )}
    </div>
  );
}
