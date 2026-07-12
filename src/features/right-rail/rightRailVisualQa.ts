import { VISUAL_QA_FALLBACK_PROJECT_PATH } from "../../shared/hooks/useTabManager";
import type { RightRailAction, RightRailMode } from "../../shared/lib/rightRailAdvisor";
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
