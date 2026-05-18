import type { AgentSession } from "../types/agent";
import type { WorkforceGuardrailProfile } from "./rightRailWorkforce";
import { listWorkstationGraphChangedFiles, type WorkstationGraph } from "./workstationGraph";
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
  execution: RightRailActionExecution;
  targetSessionId?: string;
  targetPaneRole?: string;
  targetFilePath?: string;
}

export interface RightRailActionExecution {
  status: "ready" | "guided" | "blocked";
  operation: "focus-widget" | "focus-session" | "focus-pane" | "open-primary-diff" | "copy-context-pack";
  label: string;
  expectedResult: string;
  auditEvent: string;
  guardrailProfile?: WorkforceGuardrailProfile;
  guardrailLabel?: string;
  guardrailDetail?: string;
  recoveryStep?: string;
  disabledReason?: string;
}

type RightRailActionDraft = Omit<RightRailAction, "execution"> & {
  execution?: Partial<RightRailActionExecution>;
};

const ACTION_EXECUTION_CONTRACTS: Record<RightRailActionId, RightRailActionExecution> = {
  "handoff-context": {
    status: "ready",
    operation: "copy-context-pack",
    label: "Copy handoff",
    expectedResult: "Handoff pack is copied and Context opens before memory pressure gets worse.",
    auditEvent: "right_rail.handoff_context.opened",
    recoveryStep: "If no context pack exists, create one from the Context panel.",
  },
  "resolve-approvals": {
    status: "guided",
    operation: "focus-session",
    label: "Open inbox",
    expectedResult: "Decision Inbox opens and the first pending owner session is selected when available.",
    auditEvent: "right_rail.approvals.opened",
    recoveryStep: "If the inbox is empty, refresh workflow state and inspect the audit timeline.",
  },
  "recover-attention": {
    status: "guided",
    operation: "focus-session",
    label: "Inspect run",
    expectedResult: "Blocked or errored session is selected so retry, handoff, or stop is one action away.",
    auditEvent: "right_rail.blocked_run.opened",
    recoveryStep: "If the session disappeared, use Health to clean up stale process rows.",
  },
  "inspect-risk": {
    status: "guided",
    operation: "focus-widget",
    label: "Open evidence",
    expectedResult: "Reliability evidence opens around the active blocker or release risk.",
    auditEvent: "right_rail.risk.opened",
    recoveryStep: "If evidence is missing, run the focused validation before closing the risk.",
  },
  "focused-review": {
    status: "ready",
    operation: "open-primary-diff",
    label: "Open diff",
    expectedResult: "The highest-priority changed file opens in diff mode from the selected review or test intent.",
    auditEvent: "right_rail.focused_review.opened",
    recoveryStep: "If the pane no longer exists, choose the owner from the run graph.",
  },
  "collect-final-report": {
    status: "guided",
    operation: "focus-session",
    label: "Collect",
    expectedResult: "Review surface opens on the completed run so evidence can be collected.",
    auditEvent: "right_rail.final_report.opened",
    recoveryStep: "If the report is stale, reopen the owning session from the run graph.",
  },
  "trace-provenance": {
    status: "guided",
    operation: "focus-widget",
    label: "Trace",
    expectedResult: "Run graph opens so changed files can be traced back to the owning session.",
    auditEvent: "right_rail.provenance.opened",
    recoveryStep: "If ownership is unknown, refresh git status and session telemetry.",
  },
  "review-queue": {
    status: "ready",
    operation: "open-primary-diff",
    label: "Open diff",
    expectedResult: "The highest-priority changed file opens in diff mode with the review queue focused.",
    auditEvent: "right_rail.review_queue.opened",
    recoveryStep: "If the queue is empty, refresh source control and run graph inputs.",
  },
  "track-selected": {
    status: "ready",
    operation: "focus-pane",
    label: "Focus pane",
    expectedResult: "The selected operational pane or log surface becomes the active target.",
    auditEvent: "right_rail.selected_pane.focused",
    recoveryStep: "If focus fails, open the pane switcher and choose a live pane.",
  },
  "parallel-run": {
    status: "guided",
    operation: "focus-session",
    label: "Compare runs",
    expectedResult: "Health opens on live sessions so roles, owners, and progress can be compared.",
    auditEvent: "right_rail.parallel_run.opened",
    recoveryStep: "If a row is stale, use the process manager cleanup actions.",
  },
  "open-conductor": {
    status: "guided",
    operation: "focus-widget",
    label: "Open graph",
    expectedResult: "Run graph opens with parent, child, handoff, and ownership edges visible.",
    auditEvent: "right_rail.conductor.opened",
    recoveryStep: "If graph edges are missing, inspect session handoff metadata.",
  },
  "inspect-context": {
    status: "guided",
    operation: "focus-widget",
    label: "Inspect pack",
    expectedResult: "Context panel opens on the active run's reusable handoff material.",
    auditEvent: "right_rail.context_pack.opened",
    recoveryStep: "If context is absent, generate a pack from the current run state.",
  },
  "ready-command": {
    status: "ready",
    operation: "focus-widget",
    label: "Start",
    expectedResult: "Toolkit opens so a workflow, saved tool, or agent can be launched.",
    auditEvent: "right_rail.ready_command.opened",
    recoveryStep: "If tools are unavailable, import or create a toolkit command.",
  },
  "track-run": {
    status: "guided",
    operation: "focus-session",
    label: "Watch",
    expectedResult: "Process health opens on the live run and recent terminal output.",
    auditEvent: "right_rail.track_run.opened",
    recoveryStep: "If the process is gone, use recovery or detach cleanup in Health.",
  },
};

function applyGuardrailToExecution(
  action: RightRailActionDraft,
  execution: RightRailActionExecution,
  guardrailProfile?: WorkforceGuardrailProfile,
): RightRailActionExecution {
  if (!guardrailProfile) return execution;

  if (guardrailProfile === "Conservative" && action.id === "resolve-approvals") {
    return {
      ...execution,
      guardrailProfile,
      guardrailLabel: "Human gate",
      guardrailDetail: "Conservative mode keeps owner decisions explicit before agents continue.",
    };
  }

  if (guardrailProfile === "Conservative" && (action.id === "recover-attention" || action.id === "inspect-risk")) {
    return {
      ...execution,
      guardrailProfile,
      guardrailLabel: "Risk gate",
      guardrailDetail: "Conservative mode routes blocked or risky runs through evidence before recovery.",
    };
  }

  if (
    guardrailProfile === "Release" &&
    (action.id === "focused-review" ||
      action.id === "review-queue" ||
      action.id === "trace-provenance" ||
      action.id === "collect-final-report")
  ) {
    return {
      ...execution,
      guardrailProfile,
      guardrailLabel: "Release gate",
      guardrailDetail: "Release mode requires diff evidence, ownership, and validation before handoff.",
    };
  }

  if (guardrailProfile === "Research" && action.id === "ready-command") {
    return {
      ...execution,
      status: "guided",
      label: "Choose tool",
      guardrailProfile,
      guardrailLabel: "Explore first",
      guardrailDetail: "Research mode starts with workflow or tool selection before mutating workspace state.",
    };
  }

  if (guardrailProfile === "Builder" && (action.id === "ready-command" || action.id === "track-run")) {
    return {
      ...execution,
      guardrailProfile,
      guardrailLabel: "Builder-safe",
      guardrailDetail: "Builder mode permits focused local work while destructive actions stay gated elsewhere.",
    };
  }

  return {
    ...execution,
    guardrailProfile,
  };
}

function withExecutionContract(
  action: RightRailActionDraft,
  guardrailProfile?: WorkforceGuardrailProfile,
): RightRailAction {
  const base = ACTION_EXECUTION_CONTRACTS[action.id];
  const execution = applyGuardrailToExecution(action, { ...base, ...action.execution }, guardrailProfile);
  return { ...action, execution };
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
  guardrailProfile?: WorkforceGuardrailProfile;
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
  guardrailProfile,
  workstationGraph,
  selectedPane,
}: RightRailAdvisorInput): RightRailAction[] {
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const graphChangedFiles = listWorkstationGraphChangedFiles(workstationGraph);
  const primaryChangedFilePath = graphChangedFiles[0]?.path;
  const graphPaneCount = workstationGraph?.nodeCountByKind.pane ?? 0;
  const graphRiskCount =
    (workstationGraph?.nodeCountByKind.risk ?? 0) + (workstationGraph?.nodeCountByKind.blocker ?? 0);
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
  const withContract = (action: RightRailActionDraft) => withExecutionContract(action, guardrailProfile);

  if (summary.peakSession && peakContext >= contextWarnPct) {
    actions.push(
      withContract({
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
      }),
    );
  }

  if (pendingDecisionCount > 0) {
    actions.push(
      withContract({
        id: "resolve-approvals",
        mode: "command",
        tone: "warn",
        state: "blocked",
        priority: 105,
        label: "Resolve approvals",
        detail: plural(pendingDecisionCount, "pending decision"),
        why: "Agents are waiting on an explicit human gate.",
        nextStep: "Review the decision inbox and approve, deny, or reroute.",
      }),
    );
  }

  if (summary.attentionCount > 0) {
    const attentionSession = sessions.find((session) => session.status === "waiting" || session.status === "error");
    actions.push(
      withContract({
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
        execution: attentionSession
          ? undefined
          : {
              status: "blocked",
              disabledReason: "No blocked session row is available to select.",
              recoveryStep: "Refresh session telemetry, then open Health to remove stale attention state.",
            },
      }),
    );
  }

  if (graphRiskCount > 0) {
    const riskSession = sessions.find((session) => session.status === "waiting" || session.status === "error");
    actions.push(
      withContract({
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
      }),
    );
  }

  if ((selectedRole === "review" || selectedRole === "test") && summary.changedFilesCount > 0) {
    actions.push(
      withContract({
        id: "focused-review",
        mode: "review",
        tone: "review",
        state: "review-ready",
        priority: selectedRole === "test" ? 88 : 90,
        label: selectedRole === "test" ? "Verify changes" : "Focused review",
        detail: `${selectedName} · ${plural(summary.changedFilesCount, "changed file")}`,
        why:
          selectedRole === "test"
            ? "A test-focused pane is selected while files changed."
            : "Review context is selected while files changed.",
        nextStep:
          selectedRole === "test" ? "Run the focused validation path." : "Inspect the review queue and file ownership.",
        targetPaneRole: selectedRole,
        targetFilePath: primaryChangedFilePath,
      }),
    );
  }

  const reportSession = sessions.find(
    (session) => session.finalReport?.status === "ready" || session.closeState === "collectable",
  );
  if (reportSession || graphFinalReportCount > 0) {
    actions.push(
      withContract({
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
      }),
    );
  }

  if (graphOwnedChangeCount > 0) {
    const ownerSession = sessions.find((session) => (session.changedFileDetails?.length ?? 0) > 0);
    actions.push(
      withContract({
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
      }),
    );
  }

  if (summary.changedFilesCount > 0) {
    const changedSession = sessions.find(
      (session) => (session.changedFileDetails?.length ?? session.filesChanged ?? 0) > 0,
    );
    actions.push(
      withContract({
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
        targetFilePath: primaryChangedFilePath,
      }),
    );
  }

  if (graphContextPackCount > 0 && summary.liveRunCount > 0) {
    actions.push(
      withContract({
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
      }),
    );
  }

  if ((selectedRole === "agent" || selectedRole === "logs") && (summary.liveRunCount > 0 || graphPaneCount > 0)) {
    actions.push(
      withContract({
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
        execution: selectedRole
          ? undefined
          : {
              status: "blocked",
              disabledReason: "No selected pane role is available.",
              recoveryStep: "Select a live pane or log surface, then retry this action.",
            },
      }),
    );
  }

  if (summary.liveRunCount >= 2) {
    actions.push(
      withContract({
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
      }),
    );
  }

  if (summary.tracedSessionCount >= 2) {
    const tracedSession = sessions.find((session) => session.role || session.handoffFrom);
    actions.push(
      withContract({
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
      }),
    );
  }

  if (summary.liveRunCount > 0) {
    actions.push(
      withContract({
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
      }),
    );
  }

  if (summary.liveRunCount === 0 && summary.changedFilesCount === 0 && pendingDecisionCount === 0) {
    actions.push(
      withContract({
        id: "ready-command",
        mode: "command",
        tone: "command",
        state: "idle",
        priority: 10,
        label: "Ready for command",
        detail: "Launch agents, workflows, or tools",
        why: "No active work or review pressure is detected.",
        nextStep: "Start a workflow, launch an agent, or run a saved tool.",
      }),
    );
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
