/**
 * Orchestrator scheduling types — TS mirror of the Rust source of truth in
 * `src-tauri/src/orchestrator/mod.rs` (LoopState, DispatchPlan). See
 * docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md (Agent Hierarchy, BR9).
 *
 * The read-only scheduling decision surfaced by the `orchestrator_plan` command:
 * which tasks to dispatch next (priority-ordered, concurrency-capped) and where
 * the autonomy loop stands. Distinct from the UI "Orchestra" helper in
 * `shared/lib/orchestrator.ts`, which builds prompts/branch names for dispatch.
 */
export type LoopState = "active" | "complete" | "stalled" | "halted_by_budget";

export interface DispatchPlan {
  /** Task ids to start now, highest priority first, capped by free slots. */
  to_dispatch: string[];
  state: LoopState;
}
