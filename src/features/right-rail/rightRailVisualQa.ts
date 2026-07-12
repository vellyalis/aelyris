import { VISUAL_QA_FALLBACK_PROJECT_PATH } from "../../shared/hooks/useTabManager";
import { type AgentFleetSession, headlessToFleetSession } from "../../shared/lib/agentFleet";
import type { RightRailAction, RightRailMode } from "../../shared/lib/rightRailAdvisor";
import type { WorkstationGraphCommandBlock } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import { RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM } from "./rightRailFeedbackContract";

export interface DevVisualQaState {
  enabled: boolean;
  attachFixture: boolean;
  diagnosticsEnabled: boolean;
  incidentFixtures: boolean;
  negativePath: "missing-diff" | "stale-pane" | null;
  projectPath: string;
  railMode: RightRailMode;
  railScenario: "idle" | "running" | "blocked" | "review" | "conductor" | "unhealthy";
  railScenarioExplicit: boolean;
  railScenarioParam: "railState" | "state" | "scenario" | null;
  usesDeprecatedStateAlias: boolean;
  hasUrlEdgeLoop: boolean;
}

const DISABLED_VISUAL_QA_STATE: DevVisualQaState = {
  enabled: false,
  attachFixture: false,
  diagnosticsEnabled: false,
  incidentFixtures: false,
  negativePath: null,
  projectPath: "",
  railMode: "observe",
  railScenario: "idle",
  railScenarioExplicit: false,
  railScenarioParam: null,
  usesDeprecatedStateAlias: false,
  hasUrlEdgeLoop: false,
};

export function readDevVisualQaState(): DevVisualQaState {
  if (!import.meta.env.DEV || typeof window === "undefined") return { ...DISABLED_VISUAL_QA_STATE };
  const params = new URLSearchParams(window.location.search);
  let storedProject: string | null = null;
  try {
    storedProject = window.localStorage.getItem("aelyris:visualQaProject");
  } catch {
    /* storage may be unavailable in private/test contexts */
  }
  const enabled = params.get("aelyrisVisualQa") === "1" || params.get("visualQa") === "1";
  if (!enabled) return { ...DISABLED_VISUAL_QA_STATE };
  const attachFixture = params.get("attachFixture") === "1" || params.get("processAttach") === "1";
  const diagnosticsEnabled = params.get("diagnostics") === "1" || params.get("logs") === "1";
  const incidentFixtures = params.get("incidents") === "1" || params.get("auditRisk") === "1";
  const requestedNegativePath = params.get("negativePath") ?? params.get("rightRailNegativePath");
  const negativePath =
    requestedNegativePath === "missing-diff" || requestedNegativePath === "stale-pane" ? requestedNegativePath : null;
  const projectPath = params.get("projectPath") || storedProject || VISUAL_QA_FALLBACK_PROJECT_PATH;
  const requestedRail = params.get("rail");
  const requestedScenarioParam = params.has("railState")
    ? "railState"
    : params.has("state")
      ? "state"
      : params.has("scenario")
        ? "scenario"
        : null;
  const requestedScenario = requestedScenarioParam ? params.get(requestedScenarioParam) : null;
  const railScenario =
    requestedScenario === "running" || requestedScenario === "blocked" || requestedScenario === "review" ||
    requestedScenario === "conductor" || requestedScenario === "unhealthy" ? requestedScenario : "idle";
  const railMode: RightRailMode =
    requestedRail === "command" || requestedRail === "review" || requestedRail === "observe" ? requestedRail : "observe";
  return {
    enabled: true,
    attachFixture,
    diagnosticsEnabled,
    incidentFixtures,
    negativePath,
    projectPath: projectPath.replace(/\\/g, "/"),
    railMode,
    railScenario,
    railScenarioExplicit: requestedScenario != null,
    railScenarioParam: requestedScenarioParam,
    usesDeprecatedStateAlias: requestedScenarioParam === "state",
    hasUrlEdgeLoop: params.has(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM),
  };
}

export function createDevVisualQaNegativePathAction(negativePath: DevVisualQaState["negativePath"]): RightRailAction | null {
  if (negativePath === "missing-diff") {
    return {
      id: "review-queue", mode: "review", tone: "warn", state: "review-ready", priority: 999,
      label: "QA missing diff", detail: "missing changed-file target",
      target: { kind: "widget", label: "review-queue", widget: "review-queue", reason: "Negative-path fixture intentionally omits a file target." },
      why: "Release smoke needs a deterministic missing diff target.",
      nextStep: "Confirm the rail reports a recoverable warning and writes outcome audit evidence.",
      execution: {
        status: "ready", operation: "open-primary-diff", label: "Open diff",
        expectedResult: "The rail should warn when no changed-file target is available.",
        evidence: "QA URL requested a missing diff target fixture.", auditEvent: "right_rail.qa_missing_diff.opened",
        recoveryStep: "Refresh source control and reopen the review queue.",
      },
    };
  }
  if (negativePath === "stale-pane") {
    return {
      id: "track-selected", mode: "observe", tone: "warn", state: "running", priority: 999,
      label: "QA stale pane", detail: "missing operational pane target",
      target: { kind: "pane", label: "__qa_missing_pane__", role: "__qa_missing_pane__", widget: "live-panes", reason: "Negative-path fixture intentionally points at a stale pane role." },
      why: "Release smoke needs a deterministic stale pane target.",
      nextStep: "Confirm the rail reports a recoverable warning and writes outcome audit evidence.",
      targetPaneRole: "__qa_missing_pane__",
      execution: {
        status: "ready", operation: "focus-pane", label: "Focus pane",
        expectedResult: "The rail should warn when the selected pane target is stale.",
        evidence: "QA URL requested a stale pane target fixture.", auditEvent: "right_rail.qa_stale_pane.opened",
        recoveryStep: "Open Health, refresh live panes, and choose an existing pane.",
      },
    };
  }
  return null;
}

export function createDevVisualQaSessions(
  scenario: DevVisualQaState["railScenario"],
  projectPath: string,
): AgentFleetSession[] {
  const now = Date.now();
  const worktree = {
    name: "aelyris-command-center",
    path: `${projectPath}/.aelyris/worktrees/command-center`,
    branch: "feature/command-center",
    is_main: false,
    head_sha: "qa12345",
    status: "Modified" as const,
  };
  const base = (id: string, overrides: Partial<AgentSession> = {}): AgentFleetSession =>
    headlessToFleetSession({
      id,
      name: id,
      status: "coding",
      model: "claude-sonnet",
      prompt: "Harden Aelyris Command Center",
      startedAt: now - 120_000,
      logs: [
        { timestamp: now - 90_000, type: "tool_use", content: 'Edit({"file":"src/App.tsx"})' },
        { timestamp: now - 30_000, type: "text", content: "Mapped right rail state into next actions." },
      ],
      cost: 0.42,
      tokensUsed: 18_000,
      branch: "feature/command-center",
      filesChanged: 2,
      changedFileDetails: [
        { path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: now - 60_000 },
        { path: "src/shared/lib/rightRailAdvisor.ts", action: "edit", toolName: "Edit", timestamp: now - 45_000 },
      ],
      worktree,
      workspaceScope: projectPath,
      ...overrides,
    });

  if (scenario === "idle") return [];
  if (scenario === "review") {
    return [base("qa-review", { name: "Review ready", status: "done", role: "reviewer", finalReport: { status: "ready", title: "Command Center review", updatedAt: now - 5_000 }, closeState: "collectable" })];
  }
  if (scenario === "blocked") {
    return [base("qa-blocked", { name: "Blocked implementer", status: "waiting", role: "implementer", blockedReason: "Destructive file-system write requires explicit approval before deleting generated output.", nextActor: "human" })];
  }
  if (scenario === "unhealthy") {
    return [base("qa-unhealthy", { name: "Long context runner", status: "coding", role: "implementer", tokensUsed: 192_000, logs: [{ timestamp: now - 45_000, type: "error", content: "Context pressure is above handoff threshold." }] })];
  }
  if (scenario === "conductor") {
    return [
      base("qa-impl", { name: "Implementer", role: "implementer", startedAt: now - 180_000 }),
      base("qa-test", { name: "Tester", role: "tester", handoffFrom: "qa-impl", startedAt: now - 120_000 }),
      base("qa-reviewer", { name: "Reviewer", role: "reviewer", handoffFrom: "qa-test", startedAt: now - 60_000 }),
    ];
  }
  return [
    base("qa-impl", { name: "Implementer", role: "implementer" }),
    base("qa-reviewer", { name: "Reviewer", role: "reviewer", handoffFrom: "qa-impl" }),
  ];
}

export function createDevVisualQaChangedFiles(scenario: DevVisualQaState["railScenario"]): Array<{ path: string; status: string }> {
  if (scenario === "idle") return [];
  const files = [
    { path: "src/App.tsx", status: "modified" },
    { path: "src/shared/lib/rightRailAdvisor.ts", status: "modified" },
  ];
  return scenario === "blocked" || scenario === "unhealthy"
    ? files
    : [...files, { path: "src/styles/global.css", status: "modified" }];
}

export function createDevVisualQaCommandBlocks(
  scenario: DevVisualQaState["railScenario"],
  projectPath: string,
): WorkstationGraphCommandBlock[] {
  if (scenario === "idle") return [];
  const cwd = projectPath || VISUAL_QA_FALLBACK_PROJECT_PATH;
  const agentId = scenario === "review" ? "qa-review" : scenario === "blocked" ? "qa-blocked" : "qa-impl";
  return [{
    id: "qa-command-typecheck",
    command: "pnpm exec tsc --noEmit",
    cwd,
    status: "passed",
    exitCode: 0,
    terminalId: "qa-review-shell",
    agentId,
    filePaths: ["src/App.tsx", "src/shared/lib/rightRailAdvisor.ts"],
    validationKind: "typecheck",
    commandSequence: 101,
    outputSequence: 102,
    endSequence: 103,
    commandHistorySize: 18,
    outputHistorySize: 19,
    endHistorySize: 21,
    commandScreenLine: 4,
    outputScreenLine: 5,
    endScreenLine: 7,
  }];
}
