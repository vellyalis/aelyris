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
  | "inspect-risk"
  | "focused-review"
  | "collect-final-report"
  | "trace-provenance"
  | "review-queue"
  | "track-selected"
  | "parallel-run"
  | "open-conductor"
  | "inspect-context"
  | "ready-command"
  | "track-run";

export interface RightRailAction extends RightRailRecommendation {
  id: RightRailActionId;
  priority: number;
  state: "blocked" | "review-ready" | "running" | "idle" | "unhealthy";
  why: string;
  nextStep: string;
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
  const graphRiskCount = (workstationGraph?.nodeCountByKind.risk ?? 0) + (workstationGraph?.nodeCountByKind.blocker ?? 0);
  const graphContextPackCount = workstationGraph?.nodeCountByKind.context_pack ?? 0;
  const graphFinalReportCount = workstationGraph?.nodeCountByKind.final_report ?? 0;
  const graphOwnedChangeCount =
    (workstationGraph?.edgeCountByKind.wrote ?? 0) + (workstationGraph?.edgeCountByKind.changed ?? 0);
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
      why: "Context pressure is the highest data-loss risk.",
      nextStep: "Create a handoff pack before the run loses working memory.",
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
      why: "Agents are waiting on an explicit human gate.",
      nextStep: "Review the decision inbox and approve, deny, or reroute.",
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
      why: "A waiting or errored run is no longer making progress.",
      nextStep: "Inspect the session and choose retry, handoff, or stop.",
      targetSessionId: attentionSession?.id,
    });
  }

  if (graphRiskCount > 0) {
    const riskSession = sessions.find((session) => session.status === "waiting" || session.status === "error");
    actions.push({
      id: "inspect-risk",
      mode: "observe",
      tone: "warn",
      state: "blocked",
      priority: 92,
      label: "Inspect blockers",
      detail: plural(graphRiskCount, "risk or blocker", "risks or blockers"),
      why: "Open risks can invalidate a release or merge decision.",
      nextStep: "Open reliability evidence and close the blocker with proof.",
      targetSessionId: riskSession?.id,
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
      why: selectedRole === "test" ? "A test-focused pane is selected while files changed." : "Review context is selected while files changed.",
      nextStep: selectedRole === "test" ? "Run the focused validation path." : "Inspect the review queue and file ownership.",
      targetPaneRole: selectedRole,
    });
  }

  const reportSession = sessions.find(
    (session) => session.finalReport?.status === "ready" || session.closeState === "collectable",
  );
  if (reportSession || graphFinalReportCount > 0) {
    actions.push({
      id: "collect-final-report",
      mode: "review",
      tone: "review",
      state: "review-ready",
      priority: 86,
      label: "Collect report",
      detail: reportSession
        ? `${reportSession.name} · final report ready`
        : plural(graphFinalReportCount, "final report"),
      why: "A completed run has a result that should be collected before context is lost.",
      nextStep: "Open the report, verify evidence, and mark it collected.",
      targetSessionId: reportSession?.id,
    });
  }

  if (graphOwnedChangeCount > 0) {
    const ownerSession = sessions.find((session) => (session.changedFileDetails?.length ?? 0) > 0);
    actions.push({
      id: "trace-provenance",
      mode: "review",
      tone: "review",
      state: "review-ready",
      priority: 84,
      label: "Trace changes",
      detail: plural(graphOwnedChangeCount, "owned change"),
      why: "Changed files need provenance before review or handoff.",
      nextStep: "Open the run graph and connect files to the responsible session.",
      targetSessionId: ownerSession?.id,
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
      why: "Unreviewed file changes are the next merge risk.",
      nextStep: "Inspect changed files, test impact, and commit readiness.",
      targetSessionId: changedSession?.id,
    });
  }

  if (graphContextPackCount > 0 && summary.liveRunCount > 0) {
    actions.push({
      id: "inspect-context",
      mode: "command",
      tone: "command",
      state: "running",
      priority: 70,
      label: "Inspect context",
      detail: plural(graphContextPackCount, "context pack"),
      why: "A live run already has handoff context available.",
      nextStep: "Review the context pack before assigning or resuming work.",
      targetSessionId: summary.liveSessions[0]?.id,
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
      why: "The selected operational surface is tied to live execution.",
      nextStep: "Open the live pane or logs and verify forward progress.",
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
      why: "Multiple live sessions need coordination to avoid drift.",
      nextStep: "Open topology and compare roles, owners, and outputs.",
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
      why: "Traced runs form a dependency graph, not isolated tasks.",
      nextStep: "Inspect parent/child handoffs and merge ownership.",
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
      why: "A live run is active and should stay observable.",
      nextStep: "Watch process health, panes, and recent output.",
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
      why: "No active work or review pressure is detected.",
      nextStep: "Start a workflow, launch an agent, or run a saved tool.",
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
