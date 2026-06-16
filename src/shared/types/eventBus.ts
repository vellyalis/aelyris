/**
 * Event Bus taxonomy — TS mirror of `src-tauri/src/event_bus/mod.rs`. See
 * docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 5.
 */
export const EVENT_CHANNELS = ["planning", "backend", "frontend", "database", "review", "system"] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export const AGENT_EVENT_KINDS = [
  "task_created",
  "task_completed",
  "decision_changed",
  "review_required",
  "agent_spawned",
  "worktree_created",
  "file_locked",
  "file_released",
  "agent_activity",
  "intent_declared",
  "blocker_raised",
] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export interface AgentEvent {
  kind: AgentEventKind;
  channel: EventChannel;
  payload?: unknown;
}
