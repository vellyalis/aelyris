import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  Activity,
  Bot,
  ChevronDown,
  ClipboardCopy,
  GitBranch,
  GitCompare,
  History,
  type LucideIcon,
  Radio,
  Settings as SettingsIcon,
  SquareTerminal,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { VISUAL_QA_FALLBACK_PROJECT_PATH } from "../../shared/hooks/useTabManager";
import { type AgentFleetSession, headlessToFleetSession } from "../../shared/lib/agentFleet";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { writeClipboardText as writeNativeClipboardText } from "../../shared/lib/nativeClipboard";
import type { GitChangedFile } from "../../shared/lib/reviewQueue";
import {
  buildRightRailActionAuditPayload,
  type RightRailAction,
  type RightRailMode,
} from "../../shared/lib/rightRailAdvisor";
import { WORKFORCE_GUARDRAIL_PROFILES, type WorkforceGuardrailProfile } from "../../shared/lib/rightRailWorkforce";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { WorkstationGraphCommandBlock } from "../../shared/lib/workstationGraph";
import type { AgentSession } from "../../shared/types/agent";
import type { AuditEventRecord, AuditJournalEventRecord } from "../../shared/types/audit";
import { SHELL_LABELS, type ShellType, type TerminalPaneTarget } from "../../shared/types/terminalPane";

import type { BootstrapAppConfig } from "./bootstrapAppConfig";
export type { BootstrapAppConfig } from "./bootstrapAppConfig";
import type {
  RightRailActionResult, RightRailActionResultTone,
  RightRailDestinationPrompt, RightRailEdgeFeedbackAxisSummary,
  RightRailEdgeFeedbackStaleGroup, RightRailEdgeNextBestAction, RightRailEdgeRecommendationOutcome,
  RightRailEdgeScore, RightRailEdgeScoreFeedbackEntry, RightRailEdgeScoreItem,
  RightRailGuardrailSelection, RightRailRouteConfirmation, RightRailWidgetId,
} from "./rightRailTypes";
export type * from "./rightRailTypes";
import {
  RIGHT_RAIL_EDGE_FEEDBACK_ACTION_LABELS,
  RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY,
  RIGHT_RAIL_EDGE_FEEDBACK_LIMIT,
  RIGHT_RAIL_EDGE_FEEDBACK_TARGET_WIDGETS,
  RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM,
} from "./rightRailFeedbackContract";
export * from "./rightRailFeedbackContract";
import {
  isPlainRecord, isRightRailEdgeFeedbackGrade, isRightRailEdgeFeedbackTrend,
  isSafeRightRailEdgeFeedbackAxisId, normalizeProjectPath, rightRailEdgeFeedbackStorageKey,
  sanitizeBoundedNumber, sanitizeRightRailEdgeFeedbackAxisLabel,
} from "./rightRailFeedbackPersistence";
export * from "./rightRailFeedbackPersistence";

export const RIGHT_RAIL_ACTION_HISTORY_LIMIT = 5;
export const RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID = "right-panel-edge-feedback-list";
export const RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID = "right-panel-edge-feedback-stale-count-description";
export const RIGHT_RAIL_GUARDRAIL_OPTIONS: readonly RightRailGuardrailSelection[] = [
  "Auto",
  ...WORKFORCE_GUARDRAIL_PROFILES,
];
export const RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY = "aelyris:right-rail-guardrail-selection";
export const RIGHT_RAIL_GUARDRAIL_SYNC_EVENT = "aelyris:right-rail-guardrail-sync";
export const RIGHT_RAIL_WIDGET_STORAGE_PREFIX = "aelyris:right-rail-widget:";
export const RIGHT_RAIL_WIDGET_SYNC_EVENT = "aelyris:right-rail-widget-sync";

export const RIGHT_RAIL_WIDGET_IDS: readonly RightRailWidgetId[] = [
  "decision-inbox",
  "sessions",
  "orchestrator",
  "workflow",
  "toolkit",
  "context",
  "audit-timeline",
  "run-graph",
  "tool-ledger",
  "logs",
];

export interface RightRailWidgetFrameProps {
  widget: RightRailWidgetId;
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  focusConfirmation?: Pick<RightRailRouteConfirmation, "title" | "detail"> | null;
  children: ReactNode;
}

export function isRightRailGuardrailSelection(value: string | null): value is RightRailGuardrailSelection {
  return value === "Auto" || WORKFORCE_GUARDRAIL_PROFILES.includes(value as WorkforceGuardrailProfile);
}

export function loadRightRailGuardrailSelection(): RightRailGuardrailSelection {
  if (typeof window === "undefined") return "Auto";
  try {
    const saved = window.localStorage.getItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY);
    return isRightRailGuardrailSelection(saved) ? saved : "Auto";
  } catch {
    return "Auto";
  }
}

export function saveRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection);
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
  void saveRightRailGuardrailSelectionToNativeConfig(selection);
}

export function applyRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection);
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, { detail: { selection } }));
}

export function hydrateRightRailGuardrailSelectionFromConfig(selection: unknown): void {
  if (typeof selection !== "string") return;
  if (isRightRailGuardrailSelection(selection)) applyRightRailGuardrailSelection(selection);
}

export async function saveRightRailGuardrailSelectionToNativeConfig(
  selection: RightRailGuardrailSelection,
): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const config = await invoke<BootstrapAppConfig>("load_app_config");
    const paneLayout = config.workspace_profile?.global_defaults?.pane_layout ?? {};
    await invoke("save_app_config", {
      config: {
        ...config,
        workspace_profile: {
          ...(config.workspace_profile ?? {}),
          global_defaults: {
            ...(config.workspace_profile?.global_defaults ?? {}),
            pane_layout: {
              ...paneLayout,
              right_rail_guardrail_profile: selection,
            },
          },
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "save_right_rail_guardrail_config",
      err,
      severity: "warning",
    });
  }
}

export function isRightRailWidgetId(value: string): value is RightRailWidgetId {
  return RIGHT_RAIL_WIDGET_IDS.includes(value as RightRailWidgetId);
}

export function writeRightRailWidgetOpenToStorage(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`, open ? "1" : "0");
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
}

export function applyRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } }));
}

export function loadRightRailWidgetOpen(widget: RightRailWidgetId, defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  try {
    const saved = window.localStorage.getItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`);
    return saved == null ? defaultOpen : saved === "1";
  } catch {
    return defaultOpen;
  }
}

export function hydrateRightRailWidgetOpenFromConfig(
  widgets: Partial<Record<RightRailWidgetId, boolean>> | null | undefined,
): void {
  if (!widgets || typeof window === "undefined") return;
  for (const [widget, open] of Object.entries(widgets)) {
    if (isRightRailWidgetId(widget) && typeof open === "boolean") {
      applyRightRailWidgetOpen(widget, open);
    }
  }
}

export async function saveRightRailWidgetOpenToNativeConfig(widget: RightRailWidgetId, open: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const config = await invoke<BootstrapAppConfig>("load_app_config");
    const paneLayout = config.workspace_profile?.global_defaults?.pane_layout ?? {};
    const widgets = { ...(paneLayout.right_rail_widgets ?? {}), [widget]: open };
    await invoke("save_app_config", {
      config: {
        ...config,
        workspace_profile: {
          ...(config.workspace_profile ?? {}),
          global_defaults: {
            ...(config.workspace_profile?.global_defaults ?? {}),
            pane_layout: {
              ...paneLayout,
              right_rail_widgets: widgets,
            },
          },
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "save_right_rail_widget_config",
      err,
      severity: "warning",
    });
  }
}

export function saveRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } }));
  }, 0);
  void saveRightRailWidgetOpenToNativeConfig(widget, open);
}

export function RightRailWidgetFrame({
  widget,
  title,
  subtitle,
  defaultOpen = true,
  forceOpen = false,
  focusConfirmation = null,
  children,
}: RightRailWidgetFrameProps) {
  const [open, setOpen] = useState(() => loadRightRailWidgetOpen(widget, defaultOpen));
  const effectiveOpen = forceOpen || open;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ widget?: string; open?: unknown }>).detail;
      if (detail?.widget === widget && typeof detail.open === "boolean") {
        setOpen(detail.open);
      }
    };
    window.addEventListener(RIGHT_RAIL_WIDGET_SYNC_EVENT, onSync);
    return () => window.removeEventListener(RIGHT_RAIL_WIDGET_SYNC_EVENT, onSync);
  }, [widget]);
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    saveRightRailWidgetOpen(widget, true);
  }, [forceOpen, widget]);
  const toggleOpen = useCallback(() => {
    if (forceOpen) return;
    setOpen((current) => {
      const next = !current;
      saveRightRailWidgetOpen(widget, next);
      return next;
    });
  }, [forceOpen, widget]);

  return (
    <div className="bento-widget right-panel-widget-frame" data-widget={widget} data-open={effectiveOpen}>
      <button
        type="button"
        className="right-panel-widget-frame-header"
        onClick={toggleOpen}
        aria-expanded={effectiveOpen}
        aria-controls={`right-rail-widget-${widget}`}
        title={`${title}: ${subtitle}`}
      >
        <ChevronDown className="right-panel-widget-frame-chevron" size={12} strokeWidth={2.1} aria-hidden="true" />
        <span className="right-panel-widget-frame-copy">
          <span className="right-panel-widget-frame-title">{title}</span>
          <span className="right-panel-widget-frame-subtitle">{subtitle}</span>
        </span>
        {forceOpen && <span className="right-panel-widget-frame-pin">Focused</span>}
      </button>
      {effectiveOpen && (
        <div id={`right-rail-widget-${widget}`} className="right-panel-widget-frame-body">
          {focusConfirmation && (
            <div className="right-panel-widget-focus-confirmation" role="status" aria-live="polite">
              <span>{focusConfirmation.title}</span>
              <strong>{focusConfirmation.detail}</strong>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

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

export function formatTerminalTarget(shell: ShellType, terminalId: string | null): string {
  const shellLabel = SHELL_LABELS[shell] ?? shell;
  if (!terminalId) return `${shellLabel} · starting`;
  return `${shellLabel} · ${terminalId.slice(0, 8)}`;
}

export function readDevVisualQaState(): DevVisualQaState {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return {
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
  }
  const params = new URLSearchParams(window.location.search);
  let storedProject: string | null = null;
  try {
    storedProject = window.localStorage.getItem("aelyris:visualQaProject");
  } catch {
    /* storage may be unavailable in private/test contexts */
  }
  const enabled = params.get("aelyrisVisualQa") === "1" || params.get("visualQa") === "1";
  if (!enabled)
    return {
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
  const requestedScenario =
    requestedScenarioParam === "railState"
      ? params.get("railState")
      : requestedScenarioParam === "state"
        ? params.get("state")
        : requestedScenarioParam === "scenario"
          ? params.get("scenario")
          : null;
  const railScenarioExplicit = requestedScenario != null;
  const railScenario =
    requestedScenario === "running" ||
    requestedScenario === "blocked" ||
    requestedScenario === "review" ||
    requestedScenario === "conductor" ||
    requestedScenario === "unhealthy"
      ? requestedScenario
      : "idle";
  const railMode: RightRailMode =
    requestedRail === "command" || requestedRail === "review" || requestedRail === "observe"
      ? requestedRail
      : "observe";
  return {
    enabled: true,
    attachFixture,
    diagnosticsEnabled,
    incidentFixtures,
    negativePath,
    projectPath: projectPath.replace(/\\/g, "/"),
    railMode,
    railScenario,
    railScenarioExplicit,
    railScenarioParam: requestedScenarioParam,
    usesDeprecatedStateAlias: requestedScenarioParam === "state",
    hasUrlEdgeLoop: params.has(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM),
  };
}

export function isExplicitDevVisualQaRequest(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("aelyrisVisualQa") === "1" || params.get("visualQa") === "1";
  } catch {
    return false;
  }
}

export function shouldMirrorRightRailEdgeFeedbackHistoryUrl(): boolean {
  if (!isExplicitDevVisualQaRequest()) return false;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.has(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM);
  } catch {
    return false;
  }
}

export function createDevVisualQaNegativePathAction(
  negativePath: DevVisualQaState["negativePath"],
): RightRailAction | null {
  if (negativePath === "missing-diff") {
    return {
      id: "review-queue",
      mode: "review",
      tone: "warn",
      state: "review-ready",
      priority: 999,
      label: "QA missing diff",
      detail: "missing changed-file target",
      target: {
        kind: "widget",
        label: "review-queue",
        widget: "review-queue",
        reason: "Negative-path fixture intentionally omits a file target.",
      },
      why: "Release smoke needs a deterministic missing diff target.",
      nextStep: "Confirm the rail reports a recoverable warning and writes outcome audit evidence.",
      execution: {
        status: "ready",
        operation: "open-primary-diff",
        label: "Open diff",
        expectedResult: "The rail should warn when no changed-file target is available.",
        evidence: "QA URL requested a missing diff target fixture.",
        auditEvent: "right_rail.qa_missing_diff.opened",
        recoveryStep: "Refresh source control and reopen the review queue.",
      },
    };
  }
  if (negativePath === "stale-pane") {
    return {
      id: "track-selected",
      mode: "observe",
      tone: "warn",
      state: "running",
      priority: 999,
      label: "QA stale pane",
      detail: "missing operational pane target",
      target: {
        kind: "pane",
        label: "__qa_missing_pane__",
        role: "__qa_missing_pane__",
        widget: "live-panes",
        reason: "Negative-path fixture intentionally points at a stale pane role.",
      },
      why: "Release smoke needs a deterministic stale pane target.",
      nextStep: "Confirm the rail reports a recoverable warning and writes outcome audit evidence.",
      targetPaneRole: "__qa_missing_pane__",
      execution: {
        status: "ready",
        operation: "focus-pane",
        label: "Focus pane",
        expectedResult: "The rail should warn when the selected pane target is stale.",
        evidence: "QA URL requested a stale pane target fixture.",
        auditEvent: "right_rail.qa_stale_pane.opened",
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
    return [
      base("qa-review", {
        name: "Review ready",
        status: "done",
        role: "reviewer",
        finalReport: { status: "ready", title: "Command Center review", updatedAt: now - 5_000 },
        closeState: "collectable",
      }),
    ];
  }
  if (scenario === "blocked") {
    return [
      base("qa-blocked", {
        name: "Blocked implementer",
        status: "waiting",
        role: "implementer",
        blockedReason: "Destructive file-system write requires explicit approval before deleting generated output.",
        nextActor: "human",
      }),
    ];
  }
  if (scenario === "unhealthy") {
    return [
      base("qa-unhealthy", {
        name: "Long context runner",
        status: "coding",
        role: "implementer",
        tokensUsed: 192_000,
        logs: [{ timestamp: now - 45_000, type: "error", content: "Context pressure is above handoff threshold." }],
      }),
    ];
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

export function createDevVisualQaChangedFiles(
  scenario: DevVisualQaState["railScenario"],
): Array<{ path: string; status: string }> {
  if (scenario === "idle") return [];
  if (scenario === "blocked" || scenario === "unhealthy") {
    return [
      { path: "src/App.tsx", status: "modified" },
      { path: "src/shared/lib/rightRailAdvisor.ts", status: "modified" },
    ];
  }
  return [
    { path: "src/App.tsx", status: "modified" },
    { path: "src/shared/lib/rightRailAdvisor.ts", status: "modified" },
    { path: "src/styles/global.css", status: "modified" },
  ];
}

export function createDevVisualQaCommandBlocks(
  scenario: DevVisualQaState["railScenario"],
  projectPath: string,
): WorkstationGraphCommandBlock[] {
  if (scenario === "idle") return [];
  const cwd = projectPath || VISUAL_QA_FALLBACK_PROJECT_PATH;
  const agentId = scenario === "review" ? "qa-review" : scenario === "blocked" ? "qa-blocked" : "qa-impl";
  return [
    {
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
    },
  ];
}

export function createDevVisualQaAuditEvents(): AuditEventRecord[] {
  return [
    {
      id: 3,
      timestamp: "2026-05-01T12:10:00.000Z",
      category: "terminal",
      action: "stream_lagged",
      severity: "warn",
      entityType: "terminal",
      entityId: "visual-terminal-with-a-very-long-id",
      summary: "Terminal stream lagged while rendering dense output",
      metadata: { droppedChunks: 12, redacted: true },
    },
    {
      id: 2,
      timestamp: "2026-05-01T12:09:00.000Z",
      category: "terminal",
      action: "spawn_failed",
      severity: "error",
      entityType: "terminal",
      entityId: "review-pane",
      summary: "Terminal spawn failed",
      metadata: { redacted: true },
    },
    {
      id: 1,
      timestamp: "2026-05-01T12:08:00.000Z",
      category: "workflow",
      action: "reject_gate",
      severity: "warn",
      entityType: "workflow",
      entityId: "bug-fix",
      summary: "Workflow gate rejected",
      metadata: { redacted: true },
    },
  ];
}

export function createDevVisualQaPanes(
  projectPath: string,
  tabId: string,
  tabLabel: string,
  tabShell: ShellType,
  attachFixture = false,
): TerminalPaneTarget[] {
  const cwd = projectPath || VISUAL_QA_FALLBACK_PROJECT_PATH;
  if (attachFixture) {
    return [
      {
        paneId: "qa-detached-left",
        terminalId: null,
        lifecycle: "detached",
        index: 0,
        shell: tabShell,
        cwd,
        title: "Detached Left",
        role: "work",
        label: "Detached Left",
        route: `${tabLabel}.1 Detached Left`,
        tabId,
        tabLabel,
        tabShell,
        tabCwd: cwd,
      },
      {
        paneId: "qa-detached-review",
        terminalId: null,
        lifecycle: "detached",
        index: 1,
        shell: tabShell,
        cwd,
        title: "Review Resume Target",
        role: "review",
        label: "Review Resume Target",
        route: `${tabLabel}.2 Review Resume Target`,
        tabId,
        tabLabel,
        tabShell,
        tabCwd: cwd,
      },
      {
        paneId: "qa-orphaned-backend",
        terminalId: "qa-orphaned-agent-pty",
        lifecycle: "orphaned",
        index: 2,
        shell: tabShell,
        cwd,
        title: "Orphaned Agent PTY",
        role: "agent",
        label: "Orphaned Agent PTY",
        route: `${tabLabel}.3 Orphaned Agent PTY`,
        tabId,
        tabLabel,
        tabShell,
        tabCwd: cwd,
      },
    ];
  }
  return [
    {
      paneId: "qa-work",
      terminalId: "qa-main-powershell",
      lifecycle: "live",
      index: 0,
      shell: tabShell,
      cwd,
      title: "PowerShell",
      role: "work",
      label: "PowerShell",
      route: `${tabLabel}.1 PowerShell`,
      tabId,
      tabLabel,
      tabShell,
      tabCwd: cwd,
    },
    {
      paneId: "qa-agent",
      terminalId: "qa-gemini-agent",
      lifecycle: "live",
      index: 1,
      shell: tabShell,
      cwd,
      title: "Gemini CLI",
      role: "agent",
      label: "Gemini CLI",
      route: `${tabLabel}.2 Gemini CLI`,
      tabId,
      tabLabel,
      tabShell,
      tabCwd: cwd,
    },
    {
      paneId: "qa-review",
      terminalId: "qa-review-shell",
      lifecycle: "live",
      index: 2,
      shell: tabShell,
      cwd,
      title: "Review Shell",
      role: "review",
      label: "Review Shell",
      route: `${tabLabel}.3 Review Shell`,
      tabId,
      tabLabel,
      tabShell,
      tabCwd: cwd,
    },
  ];
}

export const RIGHT_RAIL_MODES: Array<{
  id: RightRailMode;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "command",
    label: "Run",
    title: "Launch agents, workflows, and project tools",
    description: "Start agents, run saved tools, and answer workflow gates.",
    icon: Bot,
  },
  {
    id: "review",
    label: "Review",
    title: "Review agent output, source changes, and commits",
    description: "Inspect changed files, review queues, provenance, and commit readiness.",
    icon: GitCompare,
  },
  {
    id: "observe",
    label: "Health",
    title: "Watch live panes, agent state, and reliability signals",
    description: "Track running panes, logs, failures, and recovery actions.",
    icon: Radio,
  },
];

export const RIGHT_RAIL_ACTION_WIDGET: Partial<Record<RightRailAction["id"], string>> = {
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

export const RIGHT_RAIL_ACTION_PHASE: Record<RightRailAction["id"], string> = {
  "handoff-context": "Preserve",
  "resolve-approvals": "Route",
  "recover-attention": "Recover",
  "inspect-risk": "Observe",
  "focused-review": "Review",
  "collect-final-report": "Preserve",
  "trace-provenance": "Review",
  "inspect-cli-boundary": "Observe",
  "plan-cli-launch": "Plan",
  "review-queue": "Review",
  "track-selected": "Observe",
  "parallel-run": "Route",
  "open-conductor": "Route",
  "inspect-context": "Plan",
  "ready-command": "Run",
  "track-run": "Observe",
};

export type ProductModeId = "terminal" | "agents" | "workspace" | "review" | "git" | "context" | "history" | "settings";

export const PRODUCT_MODE_RAIL: Array<{
  id: ProductModeId;
  label: string;
  shortcut: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "terminal",
    label: "Terminal",
    shortcut: "Alt+1",
    description: "Focus panes, mux state, shell sessions, and AI CLI input.",
    icon: SquareTerminal,
  },
  {
    id: "agents",
    label: "Agents",
    shortcut: "Alt+2",
    description: "Run purpose-pinned agents, worktrees, approvals, and telemetry.",
    icon: Bot,
  },
  {
    id: "workspace",
    label: "Workspace",
    shortcut: "Alt+3",
    description: "Open project tasks, workflows, notes, and shared context.",
    icon: Activity,
  },
  {
    id: "review",
    label: "Review",
    shortcut: "Alt+4",
    description: "Inspect changed files, review queues, risks, and handoff evidence.",
    icon: GitCompare,
  },
  {
    id: "git",
    label: "Git",
    shortcut: "Alt+5",
    description: "Route to branch, status, diffs, worktrees, commit, and push actions.",
    icon: GitBranch,
  },
  {
    id: "context",
    label: "Context",
    shortcut: "Alt+6",
    description: "Inspect context packs, selected panes, files, audit trails, and handoffs.",
    icon: ClipboardCopy,
  },
  {
    id: "history",
    label: "History",
    shortcut: "Alt+7",
    description: "Search command, session, and action history across the workspace.",
    icon: History,
  },
  {
    id: "settings",
    label: "Settings",
    shortcut: "Alt+8",
    description: "Customize themes, materials, wallpaper, shell profiles, and editor behavior.",
    icon: SettingsIcon,
  },
];

export const PRODUCT_MODE_ROUTES: Record<
  ProductModeId,
  {
    rightRailMode?: RightRailMode;
    focusWidget?: string | null;
    expandSidebar?: boolean;
    openHistory?: boolean;
    openSettings?: boolean;
  }
> = {
  terminal: { rightRailMode: "observe", focusWidget: "live-panes" },
  agents: { rightRailMode: "command", focusWidget: "sessions" },
  workspace: { rightRailMode: "command", focusWidget: "workflow", expandSidebar: true },
  review: { rightRailMode: "review", focusWidget: "review-queue" },
  git: { rightRailMode: "review", focusWidget: "scm" },
  context: { rightRailMode: "observe", focusWidget: "context" },
  history: { rightRailMode: "observe", focusWidget: "audit-timeline", openHistory: true },
  settings: { openSettings: true },
};

export const PRODUCT_MODE_INSPECTOR_SUMMARY: Record<
  ProductModeId,
  {
    target: string;
    owner: string;
    proof: string;
  }
> = {
  terminal: {
    target: "Live panes / PTY health",
    owner: "Rust PTY + mux core",
    proof: "Native terminal boundary evidence",
  },
  agents: {
    target: "Sessions / workflow gates",
    owner: "Rust AI orchestration",
    proof: "Context pack, guardrail, and audit trace",
  },
  workspace: {
    target: "Files / tasks / workflows",
    owner: "Project workspace state",
    proof: "File tree, task, and workflow source",
  },
  review: {
    target: "Review queue / changed files",
    owner: "Git + provenance graph",
    proof: "Risk, diff, and handoff evidence",
  },
  git: {
    target: "SCM / branch / worktrees",
    owner: "git2 + worktree core",
    proof: "Branch, status, and commit readiness",
  },
  context: {
    target: "Context pack / audit trail",
    owner: "Rust-backed workspace evidence",
    proof: "Selected pane, file, and session context",
  },
  history: {
    target: "Command / session history",
    owner: "SQLite history store",
    proof: "Searchable command and action records",
  },
  settings: {
    target: "Theme / material / shell settings",
    owner: "Rust settings store",
    proof: "Config roundtrip and UI control state",
  },
};

export function compactRightRailOwnerId(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(-4)}`;
}

export function formatRightRailPathOwner(path: string | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export function formatRightRailActionOwner(action: RightRailAction): string {
  if (action.targetSessionId) return `Session ${compactRightRailOwnerId(action.targetSessionId)}`;
  if (action.targetPaneRole) return `Pane ${action.targetPaneRole}`;
  if (action.targetFilePath) return `File ${formatRightRailPathOwner(action.targetFilePath)}`;
  if (action.target.role) return `Role ${action.target.role}`;
  if (action.target.widget) return `Widget ${action.target.widget}`;
  return `${action.target.kind} ${action.target.label}`;
}

export function formatInspectorProof(evidence: string | undefined, fallback: string): string {
  const normalized = evidence?.trim();
  if (!normalized) return fallback;
  const lower = normalized.toLowerCase();
  if (
    lower.includes("cannot read properties") ||
    lower.includes("reading 'invoke'") ||
    lower.includes("not available in this webview")
  ) {
    return fallback;
  }
  return normalized;
}

export async function appendRightRailActionAudit(
  action: RightRailAction,
  workspaceId: string,
  previousMode: RightRailMode,
): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId,
        threadId: null,
        sessionId: action.targetSessionId ?? null,
        paneId: null,
        terminalId: null,
        agentId: action.targetSessionId ?? null,
        workflowId: null,
        taskId: null,
        correlationId: null,
        kind: action.execution.auditEvent,
        severity: action.execution.status === "blocked" ? "warn" : "info",
        source: "right-rail",
        confidence: 0.9,
        payloadJson: buildRightRailActionAuditPayload(action, previousMode),
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "append_right_rail_action_audit",
      err,
      severity: "warning",
    });
    return null;
  }
}

export async function appendRightRailActionOutcomeAudit(
  action: RightRailAction,
  workspaceId: string,
  previousMode: RightRailMode,
  outcome: "blocked" | "failed",
  detail: string,
): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId,
        threadId: null,
        sessionId: action.targetSessionId ?? null,
        paneId: null,
        terminalId: null,
        agentId: action.targetSessionId ?? null,
        workflowId: null,
        taskId: null,
        correlationId: null,
        kind: `${action.execution.auditEvent}.${outcome}`,
        severity: "warn",
        source: "right-rail",
        confidence: 0.92,
        payloadJson: {
          actionId: action.id,
          label: action.label,
          operation: action.execution.operation,
          fromMode: previousMode,
          toMode: action.mode,
          outcome,
          detail,
          recoveryStep: action.execution.recoveryStep ?? null,
          disabledReason: action.execution.disabledReason ?? null,
          targetFilePath: action.targetFilePath ?? null,
          targetPaneRole: action.targetPaneRole ?? null,
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "append_right_rail_action_outcome_audit",
      err,
      severity: "warning",
    });
    return null;
  }
}

export async function appendRightRailEdgeScoreInteractionAudit({
  item,
  workspaceId,
  fromMode,
  score,
  grade,
  stage,
}: {
  item: RightRailEdgeScoreItem;
  workspaceId: string;
  fromMode: RightRailMode;
  score: number;
  grade: RightRailEdgeScore["grade"];
  stage: "clicked" | "destination-reached";
}): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId,
        threadId: null,
        sessionId: null,
        paneId: null,
        terminalId: null,
        agentId: null,
        workflowId: null,
        taskId: null,
        correlationId: null,
        kind: `right_rail.edge_score.${stage}`,
        severity: item.status === "gap" ? "warn" : "info",
        source: "right-rail",
        confidence: 0.88,
        payloadJson: {
          axisId: item.id,
          axisLabel: item.label,
          axisStatus: item.status,
          axisScore: item.score,
          axisMax: item.max,
          edgeScore: score,
          edgeGrade: grade,
          fromMode,
          toMode: item.routeMode,
          targetWidget: item.focusWidget,
          actionLabel: item.actionLabel,
          privacy: "no command text, prompt text, file path, or user input captured",
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "append_right_rail_edge_score_interaction_audit",
      err,
      severity: "warning",
    });
    return null;
  }
}

export async function appendRightRailEdgeFeedbackStaleAudit({
  entry,
  workspaceId,
  staleReason,
}: {
  entry: RightRailEdgeScoreFeedbackEntry;
  workspaceId: string;
  staleReason: string;
}): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId,
        threadId: null,
        sessionId: null,
        paneId: null,
        terminalId: null,
        agentId: null,
        workflowId: null,
        taskId: null,
        correlationId: null,
        kind: "right_rail.edge_feedback.stale",
        severity: "warn",
        source: "right-rail",
        confidence: 0.86,
        payloadJson: {
          axisId: entry.axisId,
          axisLabel: entry.axisLabel,
          score: entry.score,
          grade: entry.grade,
          staleReason,
          privacy: "no command text, prompt text, file path, or user input captured",
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({
      source: "app",
      operation: "append_right_rail_edge_feedback_stale_audit",
      err,
      severity: "warning",
    });
    return null;
  }
}

export function formatRightRailRecoveryDetail(action: RightRailAction, detail: string): string {
  const recovery = action.execution.recoveryStep;
  if (!recovery || detail.includes(recovery)) return detail;
  return `${detail} Recovery: ${recovery}`;
}

export function getNextRightRailMode(current: RightRailMode, key: string): RightRailMode | null {
  const currentIndex = RIGHT_RAIL_MODES.findIndex((mode) => mode.id === current);
  if (currentIndex < 0) return null;
  if (key === "Home") return RIGHT_RAIL_MODES[0]?.id ?? null;
  if (key === "End") return RIGHT_RAIL_MODES.at(-1)?.id ?? null;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return RIGHT_RAIL_MODES[(currentIndex + 1) % RIGHT_RAIL_MODES.length]?.id ?? null;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return RIGHT_RAIL_MODES[(currentIndex - 1 + RIGHT_RAIL_MODES.length) % RIGHT_RAIL_MODES.length]?.id ?? null;
  }
  return null;
}

export const CLOSED_INTERACTIVE_STATUSES = new Set([
  "idle",
  "done",
  "complete",
  "completed",
  "stopped",
  "exited",
  "closed",
]);

export function isLiveInteractiveSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 && !CLOSED_INTERACTIVE_STATUSES.has(normalized);
}

export function sanitizeRightRailEdgeFeedbackEntry(value: unknown): RightRailEdgeScoreFeedbackEntry | null {
  if (!isPlainRecord(value)) return null;
  const rawAxisId =
    typeof value.axisId === "string" ? value.axisId : typeof value.id === "string" ? value.id.split(":")[0] : null;
  if (!isSafeRightRailEdgeFeedbackAxisId(rawAxisId)) return null;
  const createdAt = sanitizeBoundedNumber(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER);
  const actionLabel =
    typeof value.actionLabel === "string" && RIGHT_RAIL_EDGE_FEEDBACK_ACTION_LABELS.has(value.actionLabel)
      ? value.actionLabel
      : "Replay action";
  const targetWidget =
    typeof value.targetWidget === "string" && RIGHT_RAIL_EDGE_FEEDBACK_TARGET_WIDGETS.has(value.targetWidget)
      ? value.targetWidget
      : "decision-inbox";
  return {
    id: `${rawAxisId}:${createdAt}`,
    axisId: rawAxisId,
    axisLabel: sanitizeRightRailEdgeFeedbackAxisLabel(rawAxisId, value.axisLabel),
    actionLabel,
    targetWidget,
    score: sanitizeBoundedNumber(value.score, 0, 0, 100),
    grade: isRightRailEdgeFeedbackGrade(value.grade) ? value.grade : "D",
    previousScore: value.previousScore == null ? null : sanitizeBoundedNumber(value.previousScore, 0, 0, 100),
    delta: sanitizeBoundedNumber(value.delta, 0, -100, 100),
    trend: isRightRailEdgeFeedbackTrend(value.trend) ? value.trend : "baseline",
    createdAt,
  };
}

export function sanitizeRightRailEdgeFeedbackHistory(history: unknown): RightRailEdgeScoreFeedbackEntry[] {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => sanitizeRightRailEdgeFeedbackEntry(entry))
    .filter((entry): entry is RightRailEdgeScoreFeedbackEntry => entry != null)
    .slice(0, RIGHT_RAIL_EDGE_FEEDBACK_LIMIT);
}

export function readRightRailEdgeFeedbackHistoryState(key: string): RightRailEdgeScoreFeedbackEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const state: unknown = window.history.state;
    if (!isPlainRecord(state)) return [];
    const payload = state[RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY];
    if (!isPlainRecord(payload) || payload.key !== key) return [];
    return sanitizeRightRailEdgeFeedbackHistory(payload.history);
  } catch {
    return [];
  }
}

export function readRightRailEdgeFeedbackHistoryUrl(key: string): RightRailEdgeScoreFeedbackEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed) || parsed.key !== key) return [];
    return sanitizeRightRailEdgeFeedbackHistory(parsed.history);
  } catch {
    return [];
  }
}

export function writeRightRailEdgeFeedbackHistoryState(key: string, history: RightRailEdgeScoreFeedbackEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const state = isPlainRecord(window.history.state) ? window.history.state : {};
    window.history.replaceState(
      {
        ...state,
        [RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY]: {
          key,
          history,
        },
      },
      "",
      window.location.href,
    );
  } catch {
    /* history.state can be unavailable in constrained browser harnesses */
  }
}

export function writeRightRailEdgeFeedbackHistoryUrl(key: string, history: RightRailEdgeScoreFeedbackEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM, JSON.stringify({ key, history }));
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* URL fallback is best-effort and still privacy-safe when unavailable */
  }
}

export function clearRightRailEdgeFeedbackHistory(projectPath: string): void {
  const key = rightRailEdgeFeedbackStorageKey(projectPath);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* localStorage can be unavailable in locked-down WebView contexts */
  }
  try {
    const state = isPlainRecord(window.history.state) ? { ...window.history.state } : {};
    delete state[RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY];
    const url = new URL(window.location.href);
    url.searchParams.delete(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM);
    window.history.replaceState(state, "", url.toString());
  } catch {
    /* reset remains best-effort when history or URL mutation is unavailable */
  }
}

export function loadRightRailEdgeFeedbackHistory(projectPath: string): RightRailEdgeScoreFeedbackEntry[] {
  const key = rightRailEdgeFeedbackStorageKey(projectPath);
  if (!key || typeof window === "undefined") return [];
  const allowDebugUrlFallback = isExplicitDevVisualQaRequest();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      if (!allowDebugUrlFallback) return [];
      const stateHistory = readRightRailEdgeFeedbackHistoryState(key);
      return stateHistory.length > 0 ? stateHistory : readRightRailEdgeFeedbackHistoryUrl(key);
    }
    const parsed: unknown = JSON.parse(raw);
    return sanitizeRightRailEdgeFeedbackHistory(parsed);
  } catch {
    if (!allowDebugUrlFallback) return [];
    const stateHistory = readRightRailEdgeFeedbackHistoryState(key);
    return stateHistory.length > 0 ? stateHistory : readRightRailEdgeFeedbackHistoryUrl(key);
  }
}

export function saveRightRailEdgeFeedbackHistory(
  projectPath: string,
  history: RightRailEdgeScoreFeedbackEntry[],
): void {
  const key = rightRailEdgeFeedbackStorageKey(projectPath);
  if (!key || typeof window === "undefined") return;
  const persisted = history
    .slice(0, RIGHT_RAIL_EDGE_FEEDBACK_LIMIT)
    .map((entry) => sanitizeRightRailEdgeFeedbackEntry(entry))
    .filter((entry): entry is RightRailEdgeScoreFeedbackEntry => entry != null)
    .map(
      ({ id, axisId, axisLabel, actionLabel, targetWidget, score, grade, previousScore, delta, trend, createdAt }) => ({
        id,
        axisId,
        axisLabel,
        actionLabel,
        targetWidget,
        score,
        grade,
        previousScore,
        delta,
        trend,
        createdAt,
      }),
    );
  if (persisted.length === 0) {
    clearRightRailEdgeFeedbackHistory(projectPath);
    return;
  }
  writeRightRailEdgeFeedbackHistoryState(key, persisted);
  if (shouldMirrorRightRailEdgeFeedbackHistoryUrl()) {
    writeRightRailEdgeFeedbackHistoryUrl(key, persisted);
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(persisted));
  } catch {
    /* localStorage can be unavailable in locked-down WebView contexts */
  }
}

export function sameOrNestedPath(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function sessionTabMatches(session: AgentSession, tabCwd?: string): boolean {
  const normalizedTabCwd = normalizeProjectPath(tabCwd);
  if (!normalizedTabCwd) return false;
  const candidates = [session.workspaceScope, session.worktree?.path]
    .map((path) => normalizeProjectPath(path))
    .filter((path): path is string => path != null);
  return candidates.some((candidate) => sameOrNestedPath(candidate, normalizedTabCwd));
}

export function resolveProjectFilePath(projectPath: string, path: string): string {
  const trimmed = path.trim();
  if (/^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  const root = projectPath.replace(/[\\/]+$/, "");
  return `${root}\\${trimmed.replace(/^[/\\]+/, "").replace(/\//g, "\\")}`;
}

export function parseJsonArtifact<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export function isRightRailQaFixtureRisk(value: string): boolean {
  return /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(value);
}

export function copyTextToClipboard(text: string): Promise<void> {
  return writeNativeClipboardText(text, {
    source: "right-rail.clipboard",
    fallbackMessage: "Native clipboard write failed; using browser clipboard fallback for right rail copy.",
    userVisible: true,
  });
}

export function createRightRailActionResult(
  action: RightRailAction,
  tone: RightRailActionResultTone,
  detail: string,
  auditRecord: AuditJournalEventRecord | null = null,
): RightRailActionResult {
  const timestamp = Date.now();
  return {
    id: `${action.id}:${timestamp}`,
    label: action.execution.label,
    detail,
    tone,
    timestamp,
    auditEventId: auditRecord?.id ?? null,
    auditCorrelationId: auditRecord?.correlationId ?? null,
    auditKind: auditRecord?.kind ?? null,
    auditTimestamp: auditRecord?.createdAt ?? null,
    routeWidget: null,
    routeLabel: null,
    routeDetail: null,
  };
}

export function createRightRailDestinationResult({
  label,
  detail,
  tone,
  auditEventId = null,
  auditCorrelationId = null,
  routeWidget = null,
  routeLabel = null,
  routeDetail = null,
}: {
  label: string;
  detail: string;
  tone: RightRailActionResultTone;
  auditEventId?: number | null;
  auditCorrelationId?: string | null;
  routeWidget?: RightRailWidgetId | null;
  routeLabel?: string | null;
  routeDetail?: string | null;
}): RightRailActionResult {
  const timestamp = Date.now();
  return {
    id: `destination:${label}:${timestamp}`,
    label,
    detail,
    tone,
    timestamp,
    auditEventId,
    auditCorrelationId,
    auditKind: null,
    auditTimestamp: null,
    routeWidget,
    routeLabel,
    routeDetail,
  };
}

export function rightRailModeForOutcomeWidget(widget: RightRailWidgetId): RightRailMode {
  return widget === "workflow" || widget === "toolkit" ? "command" : "observe";
}

export function mergeRightRailChangedFiles(
  base: readonly GitChangedFile[],
  graphFiles: readonly GitChangedFile[],
): GitChangedFile[] {
  const byPath = new Map<string, GitChangedFile>();
  for (const file of base) {
    const normalized = file.path.replace(/\\/g, "/");
    byPath.set(normalized.toLowerCase(), { ...file, path: normalized });
  }
  for (const file of graphFiles) {
    const normalized = file.path.replace(/\\/g, "/");
    const key = normalized.toLowerCase();
    byPath.set(key, { ...file, ...byPath.get(key), path: normalized });
  }
  return [...byPath.values()];
}

export function createRightRailEdgeScoreFeedbackEntry({
  item,
  score,
  grade,
  previous,
}: {
  item: RightRailEdgeScoreItem;
  score: number;
  grade: RightRailEdgeScore["grade"];
  previous?: RightRailEdgeScoreFeedbackEntry;
}): RightRailEdgeScoreFeedbackEntry {
  const now = Date.now();
  const previousScore = previous?.score ?? null;
  const delta = previousScore == null ? 0 : score - previousScore;
  const trend =
    previousScore == null ? "baseline" : delta > 0 ? "improved" : delta < 0 ? "regressed" : ("flat" as const);
  return {
    id: `${item.id}:${now}`,
    axisId: item.id,
    axisLabel: item.label,
    actionLabel: item.actionLabel,
    targetWidget: item.focusWidget,
    score,
    grade,
    previousScore,
    delta,
    trend,
    createdAt: now,
  };
}

export function deriveRightRailEdgeFeedbackAxisSummary(
  history: RightRailEdgeScoreFeedbackEntry[],
): RightRailEdgeFeedbackAxisSummary | null {
  if (history.length === 0) return null;
  const counts = new Map<
    string,
    { axisLabel: string; count: number; latestTrend: RightRailEdgeScoreFeedbackEntry["trend"] }
  >();
  for (const entry of history) {
    const current = counts.get(entry.axisId);
    counts.set(entry.axisId, {
      axisLabel: current?.axisLabel ?? entry.axisLabel,
      count: (current?.count ?? 0) + 1,
      latestTrend: current?.latestTrend ?? entry.trend,
    });
  }
  const [axisId, summary] = [...counts.entries()].sort((left, right) => right[1].count - left[1].count)[0] ?? [];
  if (!axisId || !summary) return null;
  return { axisId, axisLabel: summary.axisLabel, count: summary.count, trend: summary.latestTrend };
}

export function deriveRightRailEdgeNextBestAction(
  score: RightRailEdgeScore,
  summary: RightRailEdgeFeedbackAxisSummary | null,
): RightRailEdgeNextBestAction | null {
  const repeatedAxis = summary ? score.items.find((item) => item.id === summary.axisId) : null;
  if (repeatedAxis) return { item: repeatedAxis, reason: "repeated-axis" };
  const weakestAxis = [...score.items].sort((left, right) => left.score / left.max - right.score / right.max)[0];
  return weakestAxis ? { item: weakestAxis, reason: "weakest-axis" } : null;
}

export function formatRightRailEdgeFeedbackStaleReason(entry: RightRailEdgeScoreFeedbackEntry): string {
  return `Stale axis: ${entry.axisLabel} is no longer in the current score model.`;
}

export function deriveRightRailEdgeFeedbackStaleEntries(
  history: RightRailEdgeScoreFeedbackEntry[],
  score: RightRailEdgeScore,
): Array<{ entry: RightRailEdgeScoreFeedbackEntry; staleReason: string }> {
  return history
    .filter((entry) => !score.items.some((item) => item.id === entry.axisId || item.label === entry.axisLabel))
    .map((entry) => ({ entry, staleReason: formatRightRailEdgeFeedbackStaleReason(entry) }));
}

export function deriveRightRailEdgeFeedbackStaleGroups(
  entries: Array<{ entry: RightRailEdgeScoreFeedbackEntry; staleReason: string }>,
): RightRailEdgeFeedbackStaleGroup[] {
  const groups = new Map<string, RightRailEdgeFeedbackStaleGroup>();
  for (const { entry, staleReason } of entries) {
    const current = groups.get(entry.axisId);
    groups.set(entry.axisId, {
      axisId: entry.axisId,
      axisLabel: current?.axisLabel ?? entry.axisLabel,
      count: (current?.count ?? 0) + 1,
      score: current?.score ?? entry.score,
      grade: current?.grade ?? entry.grade,
      staleReason: current?.staleReason ?? staleReason,
    });
  }
  return [...groups.values()].filter((group) => group.count > 1);
}

export function deriveRightRailEdgeRecommendationOutcome({
  nextAction,
  prompt,
  latestFeedback,
}: {
  nextAction: RightRailEdgeNextBestAction | null;
  prompt: RightRailDestinationPrompt | null;
  latestFeedback?: RightRailEdgeScoreFeedbackEntry;
}): RightRailEdgeRecommendationOutcome | null {
  if (!nextAction || !prompt || !latestFeedback) return null;
  if (prompt.axisLabel !== nextAction.item.label) {
    return {
      status: "stale",
      label: "Recommendation changed",
      detail: `${prompt.axisLabel} was last used; ${nextAction.item.label} is now recommended.`,
    };
  }
  if (prompt.reachedAt != null) {
    return {
      status: "reached",
      label: "Destination reached",
      detail: `${prompt.actionLabel} opened ${prompt.widget}.`,
    };
  }
  return {
    status: "replayed",
    label: "Action replayed",
    detail: `${latestFeedback.axisLabel} routed toward ${latestFeedback.targetWidget}.`,
  };
}

export function RightRailDestinationPromptCard({ prompt }: { prompt: RightRailDestinationPrompt }) {
  return (
    <section className="right-panel-destination-prompt" aria-label={`${prompt.axisLabel} remediation prompt`}>
      <span className="right-panel-destination-prompt-kicker">{prompt.axisLabel} gap</span>
      <strong>{prompt.title}</strong>
      <span>{prompt.detail}</span>
      <small>{prompt.actionLabel}</small>
    </section>
  );
}

export function edgeScoreStatus(score: number, max: number): RightRailEdgeScoreItem["status"] {
  const ratio = score / max;
  if (ratio >= 0.8) return "pass";
  if (ratio >= 0.55) return "watch";
  return "gap";
}

export function deriveRightRailEdgeScore({
  pendingDecisionCount,
  liveAgentCount,
  changedFilesCount,
  auditEventCount,
  graphRiskCount,
  actionCount,
  recoverableActionCount,
}: {
  pendingDecisionCount: number;
  liveAgentCount: number;
  changedFilesCount: number;
  auditEventCount: number;
  graphRiskCount: number;
  actionCount: number;
  recoverableActionCount: number;
}): RightRailEdgeScore {
  const evidenceSignalCount = changedFilesCount + auditEventCount + graphRiskCount;
  const evidenceRoute =
    changedFilesCount > 0
      ? {
          actionLabel: "Open review",
          routeMode: "review" as const,
          focusWidget: "review-queue",
          routeTitle: "Opened review evidence",
          promptTitle: "Close the evidence gap",
          promptDetail: "Open the highest-priority diff, verify ownership, then collect review evidence.",
        }
      : auditEventCount > 0
        ? {
            actionLabel: "Open audit",
            routeMode: "observe" as const,
            focusWidget: "audit-timeline",
            routeTitle: "Opened audit evidence",
            promptTitle: "Close the evidence gap",
            promptDetail: "Select the latest audit event and trace it to the pane, workflow, or risk that produced it.",
          }
        : {
            actionLabel: "Open risks",
            routeMode: "observe" as const,
            focusWidget: "reliability",
            routeTitle: "Opened reliability evidence",
            promptTitle: "Create missing evidence",
            promptDetail:
              "Run a focused validation or recovery check so this workspace has proof instead of an empty score.",
          };
  const items: RightRailEdgeScoreItem[] = [
    {
      id: "decision",
      label: "Decision",
      score: pendingDecisionCount > 0 ? 19 : 24,
      max: 25,
      status: edgeScoreStatus(pendingDecisionCount > 0 ? 19 : 24, 25),
      detail:
        pendingDecisionCount > 0
          ? `${pendingDecisionCount} owner gate${pendingDecisionCount === 1 ? "" : "s"} surfaced`
          : "No blocking owner gate",
      actionLabel: pendingDecisionCount > 0 ? "Open inbox" : "Inspect inbox",
      routeMode: "command",
      focusWidget: "decision-inbox",
      routeTitle: "Opened decision inbox",
      routeDetail:
        pendingDecisionCount > 0
          ? `${pendingDecisionCount} owner gate${pendingDecisionCount === 1 ? "" : "s"} need attention`
          : "Decision Inbox is clear",
      promptTitle: pendingDecisionCount > 0 ? "Resolve the blocking decision" : "Decision path is clear",
      promptDetail:
        pendingDecisionCount > 0
          ? "Open the suggested inbox item, inspect its evidence, then approve, reject, or route it to the owning workflow."
          : "No owner gate is blocking progress. Keep this clear by routing new workflow gates through the inbox.",
    },
    {
      id: "evidence",
      label: "Evidence",
      score: evidenceSignalCount >= 3 ? 25 : evidenceSignalCount >= 1 ? 18 : 8,
      max: 25,
      status: edgeScoreStatus(evidenceSignalCount >= 3 ? 25 : evidenceSignalCount >= 1 ? 18 : 8, 25),
      detail: `${changedFilesCount} files · ${auditEventCount} audits · ${graphRiskCount} risks`,
      actionLabel: evidenceRoute.actionLabel,
      routeMode: evidenceRoute.routeMode,
      focusWidget: evidenceRoute.focusWidget,
      routeTitle: evidenceRoute.routeTitle,
      routeDetail: `${changedFilesCount} changed files, ${auditEventCount} audit events, ${graphRiskCount} risk nodes`,
      promptTitle: evidenceRoute.promptTitle,
      promptDetail: evidenceRoute.promptDetail,
    },
    {
      id: "recovery",
      label: "Recovery",
      score: recoverableActionCount >= 3 ? 25 : recoverableActionCount >= 1 ? 19 : 7,
      max: 25,
      status: edgeScoreStatus(recoverableActionCount >= 3 ? 25 : recoverableActionCount >= 1 ? 19 : 7, 25),
      detail: `${recoverableActionCount} guided action${recoverableActionCount === 1 ? "" : "s"}`,
      actionLabel: "Open recovery",
      routeMode: "observe",
      focusWidget: "reliability",
      routeTitle: "Opened recovery evidence",
      routeDetail: `${recoverableActionCount} guided recovery action${recoverableActionCount === 1 ? "" : "s"}`,
      promptTitle: recoverableActionCount > 0 ? "Use the recovery path" : "Add a recovery path",
      promptDetail:
        recoverableActionCount > 0
          ? "Open the reliability incident, focus the affected pane, then restart or trace the failure from the same card."
          : "Add at least one guided recovery action so failures do not leave users stranded.",
    },
    {
      id: "live",
      label: "Live",
      score: liveAgentCount > 0 ? 22 : actionCount > 0 ? 15 : 6,
      max: 25,
      status: edgeScoreStatus(liveAgentCount > 0 ? 22 : actionCount > 0 ? 15 : 6, 25),
      detail:
        liveAgentCount > 0 ? `${liveAgentCount} live run${liveAgentCount === 1 ? "" : "s"}` : "Ready, no live run",
      actionLabel: liveAgentCount > 0 ? "Watch live" : "Open processes",
      routeMode: "observe",
      focusWidget: liveAgentCount > 0 ? "live-panes" : "processes",
      routeTitle: liveAgentCount > 0 ? "Opened live panes" : "Opened process health",
      routeDetail: liveAgentCount > 0 ? `${liveAgentCount} live run${liveAgentCount === 1 ? "" : "s"}` : "No live run",
      promptTitle: liveAgentCount > 0 ? "Verify the live run" : "Start a live run",
      promptDetail:
        liveAgentCount > 0
          ? "Focus the active pane and confirm it is producing output, accepting input, and tied to the correct workspace."
          : "Start a shell, workflow, or agent run so the command center can prove live orchestration.",
    },
  ];
  const score = items.reduce((sum, item) => sum + item.score, 0);
  const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
  const weakest = [...items].sort((left, right) => left.score / left.max - right.score / right.max)[0];
  return {
    score,
    grade,
    tone: score >= 85 ? "strong" : score >= 70 ? "watch" : "gap",
    label: score >= 85 ? "Edge ready" : score >= 70 ? "Edge forming" : "Edge incomplete",
    detail: weakest ? `Weakest: ${weakest.label} - ${weakest.detail}` : "No score inputs",
    items,
  };
}
