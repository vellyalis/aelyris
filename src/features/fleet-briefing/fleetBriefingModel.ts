import type { AgentEventKind, SeqEvent } from "../../shared/types/eventBus";

export type FleetBriefingCategory = "progress" | "attention" | "durable" | "fleet";

export interface FleetBriefingItem {
  readonly seq: number;
  readonly eventId: string;
  readonly kind: AgentEventKind;
  readonly category: FleetBriefingCategory;
  readonly label: string;
  readonly detail: string | null;
}

export interface FleetBriefingSummary {
  readonly total: number;
  readonly latestSeq: number;
  readonly headline: string;
  readonly unlocks: number;
  readonly counts: Readonly<Record<FleetBriefingCategory, number>>;
  readonly items: FleetBriefingItem[];
}

const CATEGORY_BY_KIND: Record<AgentEventKind, FleetBriefingCategory> = {
  task_created: "fleet",
  task_completed: "progress",
  decision_changed: "attention",
  review_required: "attention",
  agent_spawned: "fleet",
  worktree_created: "fleet",
  file_locked: "fleet",
  file_released: "progress",
  agent_activity: "fleet",
  intent_declared: "fleet",
  blocker_raised: "attention",
  steer_avoid: "fleet",
  session_handoff: "durable",
  context_recycled: "progress",
  escalation_raised: "attention",
  execution_reserved: "durable",
};

const LABEL_BY_KIND: Record<AgentEventKind, string> = {
  task_created: "Task created",
  task_completed: "Task completed",
  decision_changed: "Decision changed",
  review_required: "Review required",
  agent_spawned: "Agent joined the fleet",
  worktree_created: "Worktree created",
  file_locked: "Work lane claimed",
  file_released: "Work lane released",
  agent_activity: "Agent activity updated",
  intent_declared: "Intent declared",
  blocker_raised: "Blocker raised",
  steer_avoid: "Collision avoidance issued",
  session_handoff: "Session handoff committed",
  context_recycled: "Agent context renewed",
  escalation_raised: "Escalation raised",
  execution_reserved: "Execution reserved",
};

const PAYLOAD_DETAIL_KEYS = [
  "title",
  "taskId",
  "task_id",
  "sessionId",
  "session_id",
  "agentId",
  "agent_id",
  "path",
  "file",
  "message",
  "reason",
] as const;

function compactText(value: string): string | null {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function payloadDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of PAYLOAD_DETAIL_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      const detail = compactText(value);
      if (detail) return detail;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function headlineFor(total: number, progress: number, attention: number): string {
  if (total === 0) return "No new durable events since your last check";
  if (attention > 0) return `${attention} item${attention === 1 ? " needs" : "s need"} attention`;
  if (progress > 0) return `${progress} progress update${progress === 1 ? "" : "s"} since your last check`;
  return `${total} fleet update${total === 1 ? "" : "s"} since your last check`;
}

export function deriveFleetBriefing(events: readonly SeqEvent[], itemLimit = 8): FleetBriefingSummary {
  const counts: Record<FleetBriefingCategory, number> = {
    progress: 0,
    attention: 0,
    durable: 0,
    fleet: 0,
  };
  let unlocks = 0;
  let latestSeq = 0;

  for (const event of events) {
    const category = CATEGORY_BY_KIND[event.kind];
    counts[category] += 1;
    latestSeq = Math.max(latestSeq, event.seq);
    if (event.kind === "task_completed" || event.kind === "file_released" || event.kind === "context_recycled") {
      unlocks += 1;
    }
  }

  const items = [...events]
    .sort((left, right) => right.seq - left.seq)
    .slice(0, Math.max(0, itemLimit))
    .map<FleetBriefingItem>((event) => ({
      seq: event.seq,
      eventId: event.eventId,
      kind: event.kind,
      category: CATEGORY_BY_KIND[event.kind],
      label: LABEL_BY_KIND[event.kind],
      detail: payloadDetail(event.payload),
    }));

  return {
    total: events.length,
    latestSeq,
    headline: headlineFor(events.length, counts.progress, counts.attention),
    unlocks,
    counts,
    items,
  };
}
