/**
 * Event Bus taxonomy — TS mirror of `src-tauri/src/event_bus/mod.rs`. See
 * docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 5.
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
  "steer_avoid",
  "session_handoff",
  "context_recycled",
  "escalation_raised",
  "execution_reserved",
] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export interface AgentEvent {
  /** Stable idempotency identity used by at-least-once consumers. */
  eventId: string;
  kind: AgentEventKind;
  channel: EventChannel;
  payload?: unknown;
}

export interface SeqEvent extends AgentEvent {
  seq: number;
}

export interface EventBatch {
  afterSeq: number;
  events: SeqEvent[];
  status: "complete";
}

export type PublishDurability = "durable" | "ephemeral" | "duplicate";

export interface PublishReceipt {
  eventId: string;
  seq: number | null;
  durability: PublishDurability;
}

export interface AckReceipt {
  consumerId: string;
  ackSeq: number;
  eventId: string;
  alreadyAcked: boolean;
}

/** Exact tagged Rust error mirror; variant payload fields remain snake_case. */
export type EventBusError =
  | { code: "durability_unavailable" }
  | { code: "invalid_event_identity" }
  | { code: "invalid_consumer_identity" }
  | { code: "append_failed"; event_id: string; message: string }
  | { code: "query_failed"; operation: string; message: string }
  | { code: "corrupt_row"; seq: number; field: string; message: string }
  | {
      code: "stream_invariant";
      high_water_seq: number;
      max_seq: number | null;
      row_count: number;
      message: string;
    }
  | { code: "cursor_out_of_range"; after_seq: number; high_water_seq: number }
  | {
      code: "consumer_cursor_corrupt";
      consumer_id: string;
      ack_seq: number;
      ack_event_id: string | null;
      message: string;
    }
  | { code: "gap"; expected_seq: number; observed_seq: number }
  | {
      code: "ack_identity_mismatch";
      seq: number;
      expected_event_id: string;
      observed_event_id: string;
    }
  | { code: "ack_regression"; current_seq: number; attempted_seq: number };

export interface EventBusMcpError {
  schema: "aelyris.event-bus.error/v1";
  domain: "event_bus";
  retryable: boolean;
  deliveryContract: "at_least_once";
  eventBusError: EventBusError;
}

export const EVENT_BUS_MCP_TOOLS = [
  "aelyris.event.recent",
  "aelyris.event.by_channel",
  "aelyris.event.since",
  "aelyris.event.poll",
  "aelyris.event.ack",
] as const;
export type EventBusMcpTool = (typeof EVENT_BUS_MCP_TOOLS)[number];

export const EVENT_BUS_STRUCTURED_ERROR_TOOLS = [
  "aelyris.event.since",
  "aelyris.event.poll",
  "aelyris.event.ack",
] as const;
export type EventBusStructuredErrorTool = (typeof EVENT_BUS_STRUCTURED_ERROR_TOOLS)[number];

export interface EventBusMcpFailure {
  schema: "aelyris.mcp.server.v1";
  tool: EventBusStructuredErrorTool;
  ok: false;
  error: EventBusMcpError;
}
