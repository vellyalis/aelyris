import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useContextStore } from "../../shared/hooks/useContextStore";
import { useCostManager } from "../../shared/hooks/useCostManager";
import { useEventBus } from "../../shared/hooks/useEventBus";
import { useOrchestratorPlan } from "../../shared/hooks/useOrchestratorPlan";
import { useTaskGraph } from "../../shared/hooks/useTaskGraph";
import type { AgentEvent, AgentEventKind } from "../../shared/types/eventBus";
import type { DispatchPlan, LoopState } from "../../shared/types/orchestratorPlan";
import type { TaskStatus } from "../../shared/types/taskStatus";
import styles from "./OrchestratorPanel.module.css";

const LOOP_STATE_LABEL: Record<LoopState, string> = {
  active: "Active",
  complete: "Complete",
  stalled: "Stalled",
  halted_by_budget: "Halted",
};

const LOOP_STATE_CLASS: Record<LoopState, string> = {
  active: styles.loopActive,
  complete: styles.loopComplete,
  stalled: styles.loopStalled,
  halted_by_budget: styles.loopHalted,
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: styles.statusPending,
  ready: styles.statusReady,
  running: styles.statusRunning,
  blocked: styles.statusBlocked,
  review: styles.statusReview,
  done: styles.statusDone,
  failed: styles.statusFailed,
};

// Highest-attention states first, so in-flight + reviewable work sits on top.
const STATUS_ORDER: TaskStatus[] = ["running", "review", "ready", "pending", "blocked", "failed", "done"];

const EVENT_LABEL: Record<AgentEventKind, string> = {
  task_created: "created",
  task_completed: "merged",
  decision_changed: "decision",
  review_required: "review",
  agent_spawned: "spawned",
  worktree_created: "worktree",
  file_locked: "locked",
  file_released: "released",
  agent_activity: "activity",
  intent_declared: "intent",
  blocker_raised: "blocked",
  steer_avoid: "steer",
  session_handoff: "handoff",
  context_recycled: "recycled",
  escalation_raised: "escalated",
  execution_reserved: "execution reserved",
};

interface OrchestratorPanelProps {
  projectPath?: string;
}

interface OrchestratorStepReport {
  dispatched: string[];
  merged: string[];
  rejected: string[];
  recovered?: string[];
  escalations?: unknown[];
  state: LoopState;
}

interface ReviewGateResults {
  tests_pass: boolean;
  lint_pass: boolean;
  types_pass: boolean;
  design_consistent: boolean;
  context_aligned: boolean;
}

interface BranchReviewReport {
  gates: ReviewGateResults;
  mergeOk: boolean;
  reasons: { gate: string; reason: string }[];
}

interface ActionStatus {
  kind: "success" | "error";
  message: string;
}

/** Best-effort subject id from an event payload (`{ id }`), for the feed. */
function eventSubject(event: AgentEvent): string | null {
  if (event.payload && typeof event.payload === "object" && "id" in event.payload) {
    const id = (event.payload as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Orchestrator loop view (BR9) — the cockpit's read-only window on the autonomous
 * build loop. Surfaces the live Task Graph, the scheduler's next move
 * (`orchestrator_plan`), the cost cap, and the recent fleet event feed. Consumes
 * the Task Graph / Cost Manager / Event Bus / orchestrator hooks that were wired
 * to the backend but previously had no UI consumer.
 */
export function OrchestratorPanel({ projectPath = "" }: OrchestratorPanelProps) {
  const { tasks } = useTaskGraph();
  const { caps } = useCostManager();
  const { events } = useEventBus();
  const { decisions } = useContextStore();
  const { fetchPlan } = useOrchestratorPlan();
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);

  const runningCount = useMemo(() => tasks.filter((task) => task.status === "running").length, [tasks]);
  const reviewCount = useMemo(() => tasks.filter((task) => task.status === "review").length, [tasks]);
  const hasRunnableWork = useMemo(
    () => tasks.some((task) => task.status === "ready" || task.status === "running"),
    [tasks],
  );
  const reviewTask = useMemo(() => tasks.find((task) => task.status === "review") ?? null, [tasks]);

  // Re-read the scheduling decision whenever the graph changes (a merge can
  // unblock dependents; a dispatch fills a slot). Read-only — never dispatches.
  useEffect(() => {
    let cancelled = false;
    const activeAgents = tasks.filter((task) => task.status === "running").length;
    void fetchPlan({
      active_agents: activeAgents,
      tokens_used: 0,
      cost_usd: 0,
      runtime_secs: 0,
    }).then((next) => {
      if (!cancelled) setPlan(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPlan, tasks]);

  const ordered = useMemo(() => {
    const rank = (status: TaskStatus) => {
      const index = STATUS_ORDER.indexOf(status);
      return index === -1 ? STATUS_ORDER.length : index;
    };
    return [...tasks].sort((a, b) => rank(a.status) - rank(b.status));
  }, [tasks]);

  const recentEvents = useMemo(
    () =>
      events
        .map((event, index) => ({ event, index }))
        .slice(-6)
        .reverse(),
    [events],
  );

  const decisionEntries = useMemo(() => Object.entries(decisions), [decisions]);

  const plannerContext = useMemo(() => {
    if (decisionEntries.length === 0) return null;
    return decisionEntries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
  }, [decisionEntries]);

  const handleBuildPlan = useCallback(async () => {
    const trimmed = goal.trim();
    if (!trimmed || !projectPath || planning || stepping || reviewing) return;
    setPlanning(true);
    setActionStatus(null);
    try {
      const readied = await invoke<string[]>("plan_build", {
        goal: trimmed,
        context: plannerContext,
        repoPath: projectPath,
        model: null,
      });
      setActionStatus({
        kind: "success",
        message: `Plan created${readied.length > 0 ? ` · ${readied.length} task${readied.length === 1 ? "" : "s"} ready` : ""}. Review it below, then run the next step.`,
      });
    } catch (error) {
      setActionStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPlanning(false);
    }
  }, [goal, plannerContext, planning, projectPath, reviewing, stepping]);

  const handleRunNextStep = useCallback(async () => {
    if (!projectPath || tasks.length === 0 || plan?.state !== "active" || planning || stepping || reviewing) return;
    setStepping(true);
    setActionStatus(null);
    try {
      const report = await invoke<OrchestratorStepReport>("orchestrator_step", {
        usage: {
          active_agents: runningCount,
          tokens_used: 0,
          cost_usd: 0,
          runtime_secs: 0,
        },
        repoPath: projectPath,
        reviewerId: "operator",
        gates: {},
      });
      const changes = [
        report.dispatched.length > 0 ? `${report.dispatched.length} dispatched` : null,
        report.merged.length > 0 ? `${report.merged.length} merged` : null,
        report.recovered?.length ? `${report.recovered.length} recovered` : null,
        report.escalations?.length ? `${report.escalations.length} blocked` : null,
      ].filter((value): value is string => Boolean(value));
      setActionStatus({
        kind: "success",
        message: changes.length > 0 ? changes.join(" · ") : `Loop is ${LOOP_STATE_LABEL[report.state].toLowerCase()}.`,
      });
    } catch (error) {
      setActionStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setStepping(false);
    }
  }, [plan?.state, planning, projectPath, reviewing, runningCount, stepping, tasks.length]);

  const handleReviewAndMerge = useCallback(async () => {
    if (!projectPath || !reviewTask || planning || stepping || reviewing) return;
    setReviewing(true);
    setActionStatus(null);
    try {
      const review = await invoke<BranchReviewReport>("review_branch", {
        repoPath: projectPath,
        taskId: reviewTask.id,
        reviewerId: "cockpit-reviewer",
        model: "codex",
      });
      if (!review.mergeOk) {
        const reasons = review.reasons.map(({ gate, reason }) => `${gate}: ${reason}`).join(" · ");
        setActionStatus({
          kind: "error",
          message: reasons || "Review rejected the candidate without a reason.",
        });
        return;
      }

      const report = await invoke<OrchestratorStepReport>("orchestrator_step", {
        usage: {
          active_agents: runningCount,
          tokens_used: 0,
          cost_usd: 0,
          runtime_secs: 0,
        },
        repoPath: projectPath,
        reviewerId: "cockpit-reviewer",
        gates: { [reviewTask.id]: review.gates },
      });
      if (!report.merged.includes(reviewTask.id)) {
        throw new Error(`Review passed, but ${reviewTask.id} did not merge.`);
      }
      setActionStatus({ kind: "success", message: `${reviewTask.title} reviewed and merged.` });
    } catch (error) {
      setActionStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setReviewing(false);
    }
  }, [planning, projectPath, reviewTask, reviewing, runningCount, stepping]);

  const canBuild =
    goal.trim().length > 0 && projectPath.length > 0 && !planning && !stepping && !reviewing;
  const canRun =
    projectPath.length > 0 &&
    tasks.length > 0 &&
    hasRunnableWork &&
    plan?.state === "active" &&
    !planning &&
    !stepping &&
    !reviewing;
  const reviewOnly = reviewTask != null && !hasRunnableWork;
  const canReview = reviewOnly && projectPath.length > 0 && !planning && !stepping && !reviewing;
  const runLabel = reviewing
    ? "Reviewing…"
    : reviewOnly
      ? "Review & merge"
      : stepping
        ? "Starting…"
        : "Run next step";

  return (
    <div className={styles.panel}>
      <form
        className={styles.composer}
        aria-label="Goal planner"
        onSubmit={(event) => {
          event.preventDefault();
          void handleBuildPlan();
        }}
      >
        <label className={styles.goalLabel} htmlFor="orchestrator-goal">
          Goal
        </label>
        <textarea
          id="orchestrator-goal"
          className={styles.goalInput}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Describe the next development outcome…"
          rows={3}
          disabled={planning || stepping || reviewing}
        />
        <div className={styles.composerActions}>
          <button type="submit" className={styles.primaryAction} disabled={!canBuild}>
            {planning ? "Building plan…" : "Build plan"}
          </button>
          <button
            type="button"
            className={styles.secondaryAction}
            disabled={reviewOnly ? !canReview : !canRun}
            onClick={() => void (reviewOnly ? handleReviewAndMerge() : handleRunNextStep())}
          >
            {runLabel}
          </button>
        </div>
        <p className={styles.composerHint}>
          {reviewOnly
            ? `${reviewCount} task${reviewCount === 1 ? "" : "s"} finished implementation. Run real gates and independent review before merge.`
            : "Build first, inspect the TaskGraph, then start visible agent work."}
        </p>
        {actionStatus ? (
          <p
            className={`${styles.actionStatus} ${actionStatus.kind === "error" ? styles.actionError : ""}`}
            role={actionStatus.kind === "error" ? "alert" : "status"}
          >
            {actionStatus.message}
          </p>
        ) : null}
      </form>

      <div className={styles.loopRow}>
        <span className={`${styles.loopBadge} ${plan ? LOOP_STATE_CLASS[plan.state] : ""}`}>
          {plan ? LOOP_STATE_LABEL[plan.state] : "—"}
        </span>
        <span className={styles.loopMeta}>
          {runningCount} running
          {caps?.max_agents != null ? ` · cap ${caps.max_agents}` : ""}
        </span>
      </div>

      {plan && plan.to_dispatch.length > 0 && (
        <div className={styles.nextRow}>
          <span className={styles.nextLabel}>next</span>
          <span className={styles.nextIds}>{plan.to_dispatch.join(" · ")}</span>
        </div>
      )}

      <ul className={styles.taskList}>
        {ordered.length === 0 ? (
          <li className={styles.empty}>No tasks in the graph yet</li>
        ) : (
          ordered.map((task) => (
            <li key={task.id} className={styles.taskRow}>
              <span className={`${styles.statusDot} ${STATUS_CLASS[task.status]}`} aria-hidden />
              <span className={styles.taskTitle} title={task.title}>
                {task.title}
              </span>
              <span className={styles.taskStatus}>{task.status}</span>
            </li>
          ))
        )}
      </ul>

      {recentEvents.length > 0 && (
        <div className={styles.feed}>
          <div className={styles.feedHeading}>Activity</div>
          <ul className={styles.feedList}>
            {recentEvents.map(({ event, index }) => {
              const subject = eventSubject(event);
              return (
                <li key={`${index}-${event.kind}`} className={styles.feedRow}>
                  <span className={styles.feedKind}>{EVENT_LABEL[event.kind]}</span>
                  <span className={styles.feedChannel}>{event.channel}</span>
                  {subject && <span className={styles.feedSubject}>{subject}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {decisionEntries.length > 0 && (
        <div className={styles.feed}>
          <div className={styles.feedHeading}>Decisions</div>
          <ul className={styles.feedList}>
            {decisionEntries.map(([key, value]) => (
              <li key={key} className={styles.decisionRow}>
                <span className={styles.decisionKey}>{key}</span>
                <span className={styles.decisionValue} title={value}>
                  {value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
