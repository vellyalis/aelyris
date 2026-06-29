import type { AgentSession } from "../types/agent";
import type { AiCliLaunchPlan } from "./aiCliLaunchPlanner";
import type { FallbackTelemetryDetail } from "./fallbackTelemetry";
import type { WorkforceGuardrailProfile } from "./rightRailWorkforce";
import { listWorkstationGraphChangedFiles, type WorkstationGraph } from "./workstationGraph";
import { buildWorkstationSummary } from "./workstationSummary";

export const RIGHT_RAIL_COMPATIBILITY_CLIENT = {
  schema: "aelyris.react.right-rail-compatibility-client.v1",
  surface: "right-rail-advisor",
  primarySurface: "aelyris-native",
  compatibilityRole: "legacy-tauri-react-client",
  productTruthOwner: "rust-native-command-center",
  nativeContract: "aelyris.native.right-rail-demotion-proof.v1",
  reactOwnsProductTruth: false,
  webviewDispatchRequired: false,
} as const;

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
  | "inspect-cli-boundary"
  | "plan-cli-launch"
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
  target: RightRailActionTarget;
  why: string;
  nextStep: string;
  execution: RightRailActionExecution;
  targetSessionId?: string;
  targetPaneRole?: string;
  targetFilePath?: string;
  auditPayload?: Record<string, unknown>;
}

export interface RightRailActionTarget {
  kind: "workspace" | "session" | "pane" | "file" | "widget";
  label: string;
  reason: string;
  id?: string;
  role?: string;
  path?: string;
  widget?: string;
}

export interface RightRailActionExecution {
  status: "ready" | "guided" | "blocked";
  operation: "focus-widget" | "focus-session" | "focus-pane" | "open-primary-diff" | "copy-context-pack";
  label: string;
  expectedResult: string;
  evidence: string;
  auditEvent: string;
  guardrailProfile?: WorkforceGuardrailProfile;
  guardrailLabel?: string;
  guardrailDetail?: string;
  recoveryStep?: string;
  disabledReason?: string;
}

export interface RightRailActionAuditPayload {
  actionId: RightRailActionId;
  label: string;
  operation: RightRailActionExecution["operation"];
  fromMode: RightRailMode;
  toMode: RightRailMode;
  state: RightRailAction["state"];
  tone: RightRailRecommendation["tone"];
  executionStatus: RightRailActionExecution["status"];
  executionLabel: string;
  expectedResult: string;
  evidence: string;
  nextStep: string;
  target: RightRailActionTarget;
  targetFilePath: string | null;
  targetPaneRole: string | null;
  [key: string]: unknown;
}

type RightRailActionDraft = Omit<RightRailAction, "execution" | "target"> & {
  execution?: Partial<RightRailActionExecution>;
  target?: Partial<RightRailActionTarget>;
};

const ACTION_TARGET_WIDGETS: Record<RightRailActionId, string> = {
  "handoff-context": "context",
  "resolve-approvals": "decision-inbox",
  "recover-attention": "sessions",
  "inspect-risk": "reliability",
  "focused-review": "review-queue",
  "collect-final-report": "review-queue",
  "trace-provenance": "run-graph",
  "inspect-cli-boundary": "processes",
  "plan-cli-launch": "toolkit",
  "review-queue": "review-queue",
  "track-selected": "live-panes",
  "parallel-run": "sessions",
  "open-conductor": "run-graph",
  "inspect-context": "context",
  "ready-command": "toolkit",
  "track-run": "processes",
};

const ACTION_EXECUTION_CONTRACTS: Record<RightRailActionId, RightRailActionExecution> = {
  "handoff-context": {
    status: "ready",
    operation: "copy-context-pack",
    label: "Copy handoff",
    expectedResult: "Handoff pack is copied and Context opens before memory pressure gets worse.",
    evidence: "Peak context pressure and the owning live session identify the handoff risk.",
    auditEvent: "right_rail.handoff_context.opened",
    recoveryStep: "If no context pack exists, create one from the Context panel.",
  },
  "resolve-approvals": {
    status: "guided",
    operation: "focus-session",
    label: "Open inbox",
    expectedResult: "Decision Inbox opens and the first pending owner session is selected when available.",
    evidence: "Pending human-gate count from the Decision Inbox is greater than zero.",
    auditEvent: "right_rail.approvals.opened",
    recoveryStep: "If the inbox is empty, refresh workflow state and inspect the audit timeline.",
  },
  "recover-attention": {
    status: "guided",
    operation: "focus-session",
    label: "Inspect run",
    expectedResult: "Blocked or errored session is selected so retry, handoff, or stop is one action away.",
    evidence: "At least one session is waiting or errored and no longer making progress.",
    auditEvent: "right_rail.blocked_run.opened",
    recoveryStep: "If the session disappeared, use Health to clean up stale process rows.",
  },
  "inspect-risk": {
    status: "guided",
    operation: "focus-widget",
    label: "Open evidence",
    expectedResult: "Reliability evidence opens around the active blocker or release risk.",
    evidence: "The workstation graph contains risk or blocker nodes.",
    auditEvent: "right_rail.risk.opened",
    recoveryStep: "If evidence is missing, run the focused validation before closing the risk.",
  },
  "focused-review": {
    status: "ready",
    operation: "open-primary-diff",
    label: "Open diff",
    expectedResult: "The highest-priority changed file opens in diff mode from the selected review or test intent.",
    evidence: "A review or test pane is selected while changed files are present.",
    auditEvent: "right_rail.focused_review.opened",
    recoveryStep: "If the pane no longer exists, choose the owner from the run graph.",
  },
  "collect-final-report": {
    status: "guided",
    operation: "focus-session",
    label: "Collect",
    expectedResult: "Review surface opens on the completed run so evidence can be collected.",
    evidence: "A final report is ready or a completed session is collectable.",
    auditEvent: "right_rail.final_report.opened",
    recoveryStep: "If the report is stale, reopen the owning session from the run graph.",
  },
  "trace-provenance": {
    status: "guided",
    operation: "focus-widget",
    label: "Trace",
    expectedResult: "Run graph opens so changed files can be traced back to the owning session.",
    evidence: "Workstation graph ownership edges connect sessions to changed files.",
    auditEvent: "right_rail.provenance.opened",
    recoveryStep: "If ownership is unknown, refresh git status and session telemetry.",
  },
  "inspect-cli-boundary": {
    status: "guided",
    operation: "focus-widget",
    label: "Inspect CLI",
    expectedResult: "Process health opens with interactive AI CLI sessions and backend provenance visible.",
    evidence: "Interactive AI CLI sessions must stay on the sidecar command-session boundary.",
    auditEvent: "right_rail.cli_boundary.opened",
    recoveryStep: "If a session reports native fallback, restart it after PTY sidecar health is green.",
  },
  "plan-cli-launch": {
    status: "guided",
    operation: "focus-widget",
    label: "Plan launch",
    expectedResult: "Toolkit opens with provider, role, context, worktree, and backend proof ready to review.",
    evidence: "Launch planner combines CLI probe evidence, sidecar provenance, live sessions, and guardrails.",
    auditEvent: "right_rail.cli_launch_planner.opened",
    recoveryStep: "If the plan is blocked, refresh CLI proof or clear the launcher gate before spending tokens.",
  },
  "review-queue": {
    status: "ready",
    operation: "open-primary-diff",
    label: "Open diff",
    expectedResult: "The highest-priority changed file opens in diff mode with the review queue focused.",
    evidence: "Git status or graph-derived file nodes report unreviewed changes.",
    auditEvent: "right_rail.review_queue.opened",
    recoveryStep: "If the queue is empty, refresh source control and run graph inputs.",
  },
  "track-selected": {
    status: "ready",
    operation: "focus-pane",
    label: "Focus pane",
    expectedResult: "The selected operational pane or log surface becomes the active target.",
    evidence: "The selected pane role is tied to live execution or logs.",
    auditEvent: "right_rail.selected_pane.focused",
    recoveryStep: "If focus fails, open the pane switcher and choose a live pane.",
  },
  "parallel-run": {
    status: "guided",
    operation: "focus-session",
    label: "Compare runs",
    expectedResult: "Health opens on live sessions so roles, owners, and progress can be compared.",
    evidence: "Multiple live sessions are active in the same workspace.",
    auditEvent: "right_rail.parallel_run.opened",
    recoveryStep: "If a row is stale, use the process manager cleanup actions.",
  },
  "open-conductor": {
    status: "guided",
    operation: "focus-widget",
    label: "Open graph",
    expectedResult: "Run graph opens with parent, child, handoff, and ownership edges visible.",
    evidence: "Two or more traced runs have role or handoff metadata.",
    auditEvent: "right_rail.conductor.opened",
    recoveryStep: "If graph edges are missing, inspect session handoff metadata.",
  },
  "inspect-context": {
    status: "guided",
    operation: "focus-widget",
    label: "Inspect pack",
    expectedResult: "Context panel opens on the active run's reusable handoff material.",
    evidence: "The workstation graph contains attached context-pack nodes.",
    auditEvent: "right_rail.context_pack.opened",
    recoveryStep: "If context is absent, generate a pack from the current run state.",
  },
  "ready-command": {
    status: "ready",
    operation: "focus-widget",
    label: "Start",
    expectedResult: "Toolkit opens so a workflow, saved tool, or agent can be launched.",
    evidence: "No live work, changed files, or pending decisions currently need attention.",
    auditEvent: "right_rail.ready_command.opened",
    recoveryStep: "If tools are unavailable, import or create a toolkit command.",
  },
  "track-run": {
    status: "guided",
    operation: "focus-session",
    label: "Watch",
    expectedResult: "Process health opens on the live run and recent terminal output.",
    evidence: "At least one live session is active and should remain observable.",
    auditEvent: "right_rail.track_run.opened",
    recoveryStep: "If the process is gone, use recovery or detach cleanup in Health.",
  },
};

function deriveActionTarget(action: RightRailActionDraft): RightRailActionTarget {
  const fallbackWidget = ACTION_TARGET_WIDGETS[action.id];
  const fallback: RightRailActionTarget = action.targetFilePath
    ? {
        kind: "file",
        label: action.targetFilePath,
        path: action.targetFilePath,
        widget: fallbackWidget,
        reason: action.why,
      }
    : action.targetPaneRole
      ? {
          kind: "pane",
          label: action.targetPaneRole,
          role: action.targetPaneRole,
          widget: fallbackWidget,
          reason: action.why,
        }
      : action.targetSessionId
        ? {
            kind: "session",
            label: action.targetSessionId,
            id: action.targetSessionId,
            widget: fallbackWidget,
            reason: action.why,
          }
        : {
            kind: fallbackWidget ? "widget" : "workspace",
            label: fallbackWidget ?? "workspace",
            widget: fallbackWidget,
            reason: action.why,
          };

  return {
    ...fallback,
    ...action.target,
    reason: action.target?.reason ?? fallback.reason,
    label: action.target?.label ?? fallback.label,
    kind: action.target?.kind ?? fallback.kind,
  };
}

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
  return { ...action, target: deriveActionTarget(action), execution };
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
  interactiveNativeFallbackCount?: number;
  recentFallbackEvents?: readonly FallbackTelemetryDetail[];
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
  aiCliLaunchPlan?: AiCliLaunchPlan | null;
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function sortActions(actions: RightRailAction[]): RightRailAction[] {
  return [...actions].sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}

export function buildRightRailActionAuditPayload(
  action: RightRailAction,
  previousMode: RightRailMode,
): RightRailActionAuditPayload {
  return {
    actionId: action.id,
    label: action.label,
    operation: action.execution.operation,
    fromMode: previousMode,
    toMode: action.mode,
    state: action.state,
    tone: action.tone,
    executionStatus: action.execution.status,
    executionLabel: action.execution.label,
    expectedResult: action.execution.expectedResult,
    evidence: action.execution.evidence,
    nextStep: action.nextStep,
    target: action.target,
    targetFilePath: action.targetFilePath ?? null,
    targetPaneRole: action.targetPaneRole ?? null,
    ...action.auditPayload,
  };
}

export function deriveRightRailActions({
  sessions,
  interactiveSessionCount,
  interactiveNativeFallbackCount = 0,
  recentFallbackEvents = [],
  changedFilesCount,
  contextWarnPct,
  pendingDecisionCount = 0,
  guardrailProfile,
  workstationGraph,
  selectedPane,
  aiCliLaunchPlan,
}: RightRailAdvisorInput): RightRailAction[] {
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const graphChangedFiles = listWorkstationGraphChangedFiles(workstationGraph);
  const primaryChangedFilePath = graphChangedFiles[0]?.path;
  const graphPaneCount = workstationGraph?.nodeCountByKind.pane ?? 0;
  const graphRiskCount =
    (workstationGraph?.nodeCountByKind.risk ?? 0) + (workstationGraph?.nodeCountByKind.blocker ?? 0);
  const visibleFallbackEvents = recentFallbackEvents.filter(
    (event) => event.userVisible !== false && (event.severity === "warning" || event.severity === "error"),
  );
  const visibleFallbackErrorCount = visibleFallbackEvents.filter((event) => event.severity === "error").length;
  const runtimeFallbackRiskCount = visibleFallbackEvents.length;
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
        target: { kind: "session", label: summary.peakSession.name },
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
        target: attentionSession ? { kind: "session", label: attentionSession.name } : undefined,
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

  if (graphRiskCount > 0 || runtimeFallbackRiskCount > 0) {
    const riskSession = sessions.find((session) => session.status === "waiting" || session.status === "error");
    const detail =
      graphRiskCount > 0 && runtimeFallbackRiskCount > 0
        ? `${plural(graphRiskCount, "risk or blocker", "risks or blockers")} · ${plural(
            runtimeFallbackRiskCount,
            "runtime fallback",
          )}`
        : runtimeFallbackRiskCount > 0
          ? plural(runtimeFallbackRiskCount, "runtime fallback")
          : plural(graphRiskCount, "risk or blocker", "risks or blockers");
    const latestFallback = visibleFallbackEvents[0];
    const latestFallbackBoundary =
      latestFallback?.nativeBoundaryEscaped && latestFallback.boundary ? ` (${latestFallback.boundary})` : "";
    actions.push(
      withContract({
        id: "inspect-risk",
        mode: "observe",
        tone: "warn",
        state: visibleFallbackErrorCount > 0 ? "unhealthy" : "blocked",
        priority: runtimeFallbackRiskCount > 0 ? 96 : 92,
        label: runtimeFallbackRiskCount > 0 ? "Inspect fallback" : "Inspect blockers",
        detail,
        why:
          runtimeFallbackRiskCount > 0
            ? "A runtime fallback path was used and must be treated as visible reliability evidence."
            : "Open risks can invalidate a release or merge decision.",
        nextStep:
          runtimeFallbackRiskCount > 0
            ? "Open reliability evidence, inspect the fallback source, and restore the native/sidecar path."
            : "Open reliability evidence and close the blocker with proof.",
        targetSessionId: riskSession?.id,
        target: riskSession ? { kind: "session", label: riskSession.name } : { kind: "widget", label: "reliability" },
        auditPayload:
          runtimeFallbackRiskCount > 0
            ? {
                fallbackTelemetryCount: runtimeFallbackRiskCount,
                fallbackTelemetryErrors: visibleFallbackErrorCount,
                fallbackTelemetryLatest: latestFallback
                  ? {
                      source: latestFallback.source,
                      operation: latestFallback.operation,
                      severity: latestFallback.severity,
                      message: latestFallback.message,
                      boundary: latestFallback.boundary,
                      nativeBoundaryEscaped: latestFallback.nativeBoundaryEscaped,
                    }
                  : null,
              }
            : undefined,
        execution:
          runtimeFallbackRiskCount > 0
            ? {
                guardrailLabel: "Fallback visible",
                guardrailDetail: "Runtime fallbacks are routed to Reliability instead of being silent UI behavior.",
                evidence: latestFallback
                  ? `${latestFallback.source}.${latestFallback.operation}${latestFallbackBoundary}: ${latestFallback.message}`
                  : "Runtime fallback telemetry emitted by the app shell.",
              }
            : undefined,
      }),
    );
  }

  if (interactiveNativeFallbackCount > 0) {
    actions.push(
      withContract({
        id: "inspect-cli-boundary",
        mode: "observe",
        tone: "warn",
        state: "unhealthy",
        priority: 94,
        label: "Fix CLI fallback",
        detail: plural(interactiveNativeFallbackCount, "native fallback"),
        why: "An interactive AI CLI session is no longer on the daemon sidecar path.",
        nextStep: "Open process health, verify sidecar state, then restart the affected CLI session.",
        target: { kind: "widget", label: "processes" },
        execution: {
          status: "guided",
          guardrailLabel: "Fallback visible",
          guardrailDetail:
            "Native fallback is allowed only as a visible recovery state, not as silent product behavior.",
        },
      }),
    );
  } else if (interactiveSessionCount > 0) {
    actions.push(
      withContract({
        id: "inspect-cli-boundary",
        mode: "observe",
        tone: "observe",
        state: "running",
        priority: 49,
        label: "Verify CLI path",
        detail: plural(interactiveSessionCount, "sidecar CLI"),
        why: "Interactive AI CLI sessions are part of the terminal trust boundary.",
        nextStep: "Open process health and confirm sidecar provenance stays visible while the run continues.",
        target: { kind: "widget", label: "processes" },
      }),
    );
  }

  if (aiCliLaunchPlan && summary.liveRunCount === 0 && summary.changedFilesCount === 0) {
    const blocked = aiCliLaunchPlan.status === "blocked";
    const degraded = aiCliLaunchPlan.status === "degraded" || aiCliLaunchPlan.status === "unknown";
    actions.push(
      withContract({
        id: "plan-cli-launch",
        mode: blocked ? "observe" : "command",
        tone: blocked ? "warn" : degraded ? "warn" : "command",
        state: blocked ? "unhealthy" : "idle",
        priority: blocked ? 91 : degraded ? 16 : 18,
        label: aiCliLaunchPlan.actionLabel,
        detail: aiCliLaunchPlan.detail,
        why: aiCliLaunchPlan.why,
        nextStep: aiCliLaunchPlan.nextStep,
        target: {
          kind: "widget",
          label: blocked ? "processes" : "toolkit",
          widget: blocked ? "processes" : "toolkit",
          reason: aiCliLaunchPlan.evidence,
        },
        execution: {
          status: blocked ? "guided" : aiCliLaunchPlan.status === "ready" ? "ready" : "guided",
          label: blocked ? "Open Health" : "Plan launch",
          expectedResult: blocked
            ? "Process health opens on the launcher gate that must be fixed before launch."
            : "Toolkit opens with the AI CLI launch plan ready to review before prompt submission.",
          evidence: aiCliLaunchPlan.evidence,
          guardrailLabel: aiCliLaunchPlan.guardrailLabel,
          guardrailDetail: aiCliLaunchPlan.guardrailDetail,
          recoveryStep: aiCliLaunchPlan.warnings[0] ?? ACTION_EXECUTION_CONTRACTS["plan-cli-launch"].recoveryStep,
        },
        auditPayload: {
          aiCliLaunchTrace: aiCliLaunchPlan.trace,
        },
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
        target: primaryChangedFilePath
          ? { kind: "file", label: primaryChangedFilePath }
          : { kind: "pane", label: selectedName, role: selectedRole },
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
        target: reportSession
          ? { kind: "session", label: reportSession.name }
          : { kind: "widget", label: "review-queue" },
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
        target: ownerSession ? { kind: "session", label: ownerSession.name } : { kind: "widget", label: "run-graph" },
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
        target: summary.liveSessions[0]
          ? { kind: "session", label: summary.liveSessions[0].name }
          : { kind: "widget", label: "context" },
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
        target: { kind: "pane", label: selectedName, role: selectedRole },
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
        target: summary.liveSessions[0]
          ? { kind: "session", label: summary.liveSessions[0].name }
          : { kind: "widget", label: "sessions" },
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
        target: tracedSession ? { kind: "session", label: tracedSession.name } : { kind: "widget", label: "run-graph" },
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
        target: summary.liveSessions[0]
          ? { kind: "session", label: summary.liveSessions[0].name }
          : { kind: "widget", label: "processes" },
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
