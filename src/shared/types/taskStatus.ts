/**
 * Canonical Task Graph lifecycle states — TS mirror of the Rust source of
 * truth in `src-tauri/src/task/status.rs`. Kept in lockstep by
 * `src/__tests__/taskStatusContract.test.ts`. See
 * docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 4.
 *
 * Distinct from the kanban board's `KanbanColumnId` (a UI projection); these
 * are the runtime orchestration states the autonomous loop transitions through.
 */
export const TASK_STATUSES = [
  "pending",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Terminal states the loop never transitions out of on its own. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "done" || status === "failed";
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
