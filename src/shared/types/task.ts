/**
 * Task Graph entity — TS mirror of the Rust source of truth in
 * `src-tauri/src/task/graph.rs` (Task). See
 * docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 4.
 *
 * The orchestration model the autonomous loop runs on, distinct from the UI
 * kanban board (`KanbanTask`). Priority reuses the kanban vocabulary rather
 * than duplicating the union.
 */
import type { TaskPriority } from "./kanban";
import type { TaskStatus } from "./taskStatus";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  owner?: string | null;
  priority: TaskPriority;
  estimate?: number | null;
  dependencies: string[];
  outputs: string[];
  /** Branch the task's work lives on (set when dispatched to a worktree). */
  source_branch?: string | null;
  /** Branch the task merges into once reviewed (usually `main`). */
  target_branch?: string | null;
}

export type { TaskPriority };
