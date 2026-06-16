import { useEffect, useMemo, useState } from "react";
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
};

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
export function OrchestratorPanel() {
  const { tasks } = useTaskGraph();
  const { caps } = useCostManager();
  const { events } = useEventBus();
  const { decisions } = useContextStore();
  const { fetchPlan } = useOrchestratorPlan();
  const [plan, setPlan] = useState<DispatchPlan | null>(null);

  const runningCount = useMemo(() => tasks.filter((task) => task.status === "running").length, [tasks]);

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

  return (
    <div className={styles.panel}>
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
