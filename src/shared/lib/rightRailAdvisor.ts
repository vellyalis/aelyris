import type { AgentSession } from "../types/agent";
import type { WorkstationGraph } from "./workstationGraph";
import { buildWorkstationSummary } from "./workstationSummary";

export type RightRailMode = "command" | "review" | "observe";

export interface RightRailRecommendation {
  mode: RightRailMode;
  label: string;
  detail: string;
  tone: "command" | "review" | "observe" | "warn";
}

export type RightRailActionId =
  | "handoff-context"
  | "resolve-approvals"
  | "recover-attention"
  | "focused-review"
  | "review-queue"
  | "track-selected"
  | "parallel-run"
  | "open-conductor"
  | "ready-command"
  | "track-run";

export interface RightRailAction extends RightRailRecommendation {
  id: RightRailActionId;
  priority: number;
  state: "blocked" | "review-ready" | "running" | "idle" | "unhealthy";
  targetSessionId?: string;
  targetPaneRole?: string;
}

export interface RightRailNowState {
  state: RightRailAction["state"];
  label: string;
  detail: string;
  tone: RightRailRecommendation["tone"];
}

interface RightRailAdvisorInput {
  sessions: AgentSession[];
  interactiveSessionCount: number;
  changedFilesCount: number;
  contextWarnPct: number;
  currentMode: RightRailMode;
  pendingDecisionCount?: number;
  workstationGraph?: WorkstationGraph;
  selectedPane?: {
    role?: string;
    title?: string;
    label?: string;
  } | null;
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function sortActions(actions: RightRailAction[]): RightRailAction[] {
  return [...actions].sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}

export function deriveRightRailActions({
  sessions,
  interactiveSessionCount,
  changedFilesCount,
  contextWarnPct,
  pendingDecisionCount = 0,
  workstationGraph,
  selectedPane,
}: RightRailAdvisorInput): RightRailAction[] {
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const graphPaneCount = workstationGraph?.nodeCountByKind.pane ?? 0;
  const summary = buildWorkstationSummary({
    sessions,
    changedFilesCount: Math.max(changedFilesCount, graphChangedFilesCount),
    interactiveSessionCount,
  });
  const peakContext = Math.round(summary.peakContextPct);
  const selectedRole = selectedPane?.role?.toLowerCase();
  const selectedName =
    selectedPane?.title || selectedPane?.label || (selectedRole ? `@${selectedRole}` : "selected pane");
  const actions: RightRailAction[] = [];

  if (summary.peakSession && peakContext >= contextWarnPct) {
    actions.push({
      id: "handoff-context",
      mode: "observe",
      tone: "warn",
      state: "unhealthy",
      priority: 110,
      label: "Handoff watch",
      detail: `${summary.peakSession.name} is at ${peakContext}% context`,
      targetSessionId: summary.peakSession.id,
    });
  }

  if (pendingDecisionCount > 0) {
    actions.push({
      id: "resolve-approvals",
      mode: "command",
      tone: "warn",
      state: "blocked",
      priority: 105,
      label: "Resolve approvals",
      detail: plural(pendingDecisionCount, "pending decision"),
    });
  }

  if (summary.attentionCount > 0) {
    const attentionSession = sessions.find((session) => session.status === "waiting" || session.status === "error");
    actions.push({
      id: "recover-attention",
      mode: "observe",
      tone: "warn",
      state: "blocked",
      priority: 95,
      label: "Recover blocked run",
      detail: plural(summary.attentionCount, "agent"),
      targetSessionId: attentionSession?.id,
    });
  }

  if ((selectedRole === "review" || selectedRole === "test") && summary.changedFilesCount > 0) {
    actions.push({
      id: "focused-review",
      mode: "review",
      tone: "review",
      state: "review-ready",
      priority: selectedRole === "test" ? 88 : 90,
      label: selectedRole === "test" ? "Verify changes" : "Focused review",
      detail: `${selectedName} · ${plural(summary.changedFilesCount, "changed file")}`,
      targetPaneRole: selectedRole,
    });
  }

  if (summary.changedFilesCount > 0) {
    const changedSession = sessions.find((session) => (session.changedFileDetails?.length ?? session.filesChanged ?? 0) > 0);
    actions.push({
      id: "review-queue",
      mode: "review",
      tone: "review",
      state: "review-ready",
      priority: 80,
      label: "Review queue",
      detail: plural(summary.changedFilesCount, "changed file"),
      targetSessionId: changedSession?.id,
    });
  }

  if ((selectedRole === "agent" || selectedRole === "logs") && (summary.liveRunCount > 0 || graphPaneCount > 0)) {
    actions.push({
      id: "track-selected",
      mode: "observe",
      tone: "observe",
      state: "running",
      priority: 72,
      label: selectedRole === "logs" ? "Inspect logs" : "Track agent",
      detail: `${selectedName} · ${plural(summary.liveRunCount, "live session")}`,
      targetPaneRole: selectedRole,
    });
  }

  if (summary.liveRunCount >= 2) {
    actions.push({
      id: "parallel-run",
      mode: "observe",
      tone: "observe",
      state: "running",
      priority: 68,
      label: "Parallel run",
      detail: plural(summary.liveRunCount, "live session"),
      targetSessionId: summary.liveSessions[0]?.id,
    });
  }

  if (summary.tracedSessionCount >= 2) {
    const tracedSession = sessions.find((session) => session.role || session.handoffFrom);
    actions.push({
      id: "open-conductor",
      mode: "observe",
      tone: "observe",
      state: "running",
      priority: 64,
      label: "Open topology",
      detail: plural(summary.tracedSessionCount, "traced run"),
      targetSessionId: tracedSession?.id,
    });
  }

  if (summary.liveRunCount > 0) {
    actions.push({
      id: "track-run",
      mode: "observe",
      tone: "observe",
      state: "running",
      priority: 50,
      label: "Track current run",
      detail: plural(summary.liveRunCount, "live session"),
      targetSessionId: summary.liveSessions[0]?.id,
    });
  }

  if (summary.liveRunCount === 0 && summary.changedFilesCount === 0 && pendingDecisionCount === 0) {
    actions.push({
      id: "ready-command",
      mode: "command",
      tone: "command",
      state: "idle",
      priority: 10,
      label: "Ready for command",
      detail: "Launch agents, workflows, or tools",
    });
  }

  return sortActions(actions).slice(0, 5);
}

export function deriveRightRailNowState(input: RightRailAdvisorInput): RightRailNowState {
  const action = deriveRightRailActions(input)[0];
  if (!action) return { state: "idle", label: "Idle", detail: "Ready for command", tone: "command" };
  const labels: Record<RightRailAction["state"], string> = {
    blocked: "Blocked",
    "review-ready": "Review ready",
    running: "Running",
    idle: "Idle",
    unhealthy: "Unhealthy",
  };
  return {
    state: action.state,
    label: labels[action.state],
    detail: action.detail,
    tone: action.tone,
  };
}

export function deriveRightRailRecommendation(input: RightRailAdvisorInput): RightRailRecommendation | null {
  const action = deriveRightRailActions(input)[0];
  if (!action || action.mode === input.currentMode) return null;
  const { mode, label, detail, tone } = action;
  return { mode, label, detail, tone };
}
