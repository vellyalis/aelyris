import { Activity, Bot, GitCompare, type LucideIcon, Radio } from "lucide-react";
import { MotionConfig } from "motion/react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import appStyles from "./App.module.css";
import { AgentTerminal } from "./features/agent-terminal";
import { UpdateBanner } from "./features/app/UpdateBanner";
import { useAppMenus } from "./features/app/useAppMenus";
import { FileTree } from "./features/file-tree/FileTree";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TERMINAL_PREFIX_COMMAND_EVENT } from "./features/terminal/hooks/useCanvasIME";
import type { PaneSwitcherEntry } from "./features/terminal/pane-tree";
import {
  deletePaneTreeSnapshot,
  deletePaneTreeSnapshotFromBackend,
  PaneTreeContainer,
  paneTreeStorageKey,
} from "./features/terminal/pane-tree";
import type {
  PaneAttachRequest,
  PaneCloseRequest,
  PaneFocusRequest,
  PaneLayoutCommand,
  PaneLayoutRequest,
  PaneRenameRequest,
  PaneRestartRequest,
  PaneRoleCycleRequest,
} from "./features/terminal/pane-tree/PaneTreeContainer";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import {
  clearEndedOperationalTerminal,
  type OperationalPaneSelection,
  reconcileOperationalPaneSelection,
} from "./shared/lib/operationalPaneSelection";
import { filterWorkspaceScopedEvents } from "./shared/lib/workspaceProfile";
import { buildWorkstationGraph, filterWorkstationGraph } from "./shared/lib/workstationGraph";
import type { AuditEventRecord } from "./shared/types/audit";

// Right-panel + secondary UIs: lazy-loaded so they do not block first paint.
const KanbanBoard = lazy(() => import("./features/kanban/KanbanBoard").then((m) => ({ default: m.KanbanBoard })));
const AgentInspector = lazy(() =>
  import("./features/agent-inspector/AgentInspector").then((m) => ({ default: m.AgentInspector })),
);
const ToolkitPanel = lazy(() => import("./features/toolkit/ToolkitPanel").then((m) => ({ default: m.ToolkitPanel })));
const WorkflowPanel = lazy(() =>
  import("./features/workflow/WorkflowPanel").then((m) => ({ default: m.WorkflowPanel })),
);
const ContextPanel = lazy(() => import("./features/context/ContextPanel").then((m) => ({ default: m.ContextPanel })));
const DecisionInboxPanel = lazy(() =>
  import("./features/decision-inbox").then((m) => ({ default: m.DecisionInboxPanel })),
);
const WorkstationPulse = lazy(() =>
  import("./features/context/WorkstationPulse").then((m) => ({ default: m.WorkstationPulse })),
);
const RunGraphPanel = lazy(() =>
  import("./features/context/RunGraphPanel").then((m) => ({ default: m.RunGraphPanel })),
);
const ToolLedgerPanel = lazy(() =>
  import("./features/context/ToolLedgerPanel").then((m) => ({ default: m.ToolLedgerPanel })),
);
const AuditTimelinePanel = lazy(() =>
  import("./features/context/AuditTimelinePanel").then((m) => ({ default: m.AuditTimelinePanel })),
);
const LivePanesPanel = lazy(() =>
  import("./features/context/LivePanesPanel").then((m) => ({ default: m.LivePanesPanel })),
);
const ReliabilityPanel = lazy(() =>
  import("./features/context/ReliabilityPanel").then((m) => ({ default: m.ReliabilityPanel })),
);
const LogsPanel = lazy(() => import("./features/logs/LogsPanel").then((m) => ({ default: m.LogsPanel })));
const ProcessManagerPanel = lazy(() =>
  import("./features/process-manager").then((m) => ({ default: m.ProcessManagerPanel })),
);
const ReviewQueuePanel = lazy(() =>
  import("./features/review/ReviewQueuePanel").then((m) => ({ default: m.ReviewQueuePanel })),
);
const SCMPanel = lazy(() => import("./features/scm/SCMPanel").then((m) => ({ default: m.SCMPanel })));
const QuickOpen = lazy(() => import("./features/quick-open/QuickOpen").then((m) => ({ default: m.QuickOpen })));

const EditorPanel = lazy(() => import("./features/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })));
const CommandPalette = lazy(() =>
  import("./features/command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const PaneSwitcherDialog = lazy(() =>
  import("./features/terminal/pane-switcher").then((m) => ({ default: m.PaneSwitcherDialog })),
);
const Settings = lazy(() => import("./features/settings/Settings").then((m) => ({ default: m.Settings })));
const WatchdogDialog = lazy(() =>
  import("./features/watchdog/WatchdogDialog").then((m) => ({ default: m.WatchdogDialog })),
);
const WelcomeScreen = lazy(() =>
  import("./features/welcome/WelcomeScreen").then((m) => ({ default: m.WelcomeScreen })),
);
const SearchPanel = lazy(() => import("./features/search/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const AboutDialog = lazy(() => import("./features/about/AboutDialog").then((m) => ({ default: m.AboutDialog })));
const HelpDialog = lazy(() => import("./features/help/HelpDialog").then((m) => ({ default: m.HelpDialog })));
const PRInspector = lazy(() => import("./features/pr-inspector/PRInspector").then((m) => ({ default: m.PRInspector })));
const WebInspector = lazy(() =>
  import("./features/web-inspector/WebInspector").then((m) => ({ default: m.WebInspector })),
);

import { HistorySearchDialog } from "./features/history/HistorySearchDialog";
import { useAgentManager } from "./shared/hooks/useAgentManager";
import { useAuditEvents } from "./shared/hooks/useAuditEvents";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useInteractiveAgent } from "./shared/hooks/useInteractiveAgent";
import { useKeyboardShortcuts } from "./shared/hooks/useKeyboardShortcuts";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useTaskAgentLink } from "./shared/hooks/useTaskAgentLink";
import { useTerminalNotifications } from "./shared/hooks/useTerminalNotifications";
import { useThemeApplier } from "./shared/hooks/useTheme";
import { useWorktreeActions } from "./shared/hooks/useWorktreeActions";
import { markFirstPaint } from "./shared/lib/bootMetrics";
import { buildDecisionInbox, type DecisionWorkflowStatus } from "./shared/lib/decisionInbox";
import { formatFallbackError, reportInvokeFailure } from "./shared/lib/fallbackTelemetry";
import {
  deriveRightRailActions,
  deriveRightRailNowState,
  deriveRightRailRecommendation,
  type RightRailAction,
  type RightRailMode,
} from "./shared/lib/rightRailAdvisor";
import { classifyCommand, formatCommandRiskSummary } from "./shared/lib/shellSafety";
import { useAppStore } from "./shared/store/appStore";
import { toast } from "./shared/store/toastStore";
import type { AgentSession } from "./shared/types/agent";
import type { SearchHit } from "./shared/types/history";
import { CollapsibleSection } from "./shared/ui/CollapsibleSection";
import { ConfirmDialog, showConfirm } from "./shared/ui/ConfirmDialog";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { HandoffDialog } from "./shared/ui/HandoffDialog";
import { LazyDialog } from "./shared/ui/LazyDialog";
import { OnboardingOverlay } from "./shared/ui/OnboardingOverlay";
import { OrchestraDialog } from "./shared/ui/OrchestraDialog";
import { PromptDialog } from "./shared/ui/PromptDialog";
import { SplitPane } from "./shared/ui/SplitPane";
import { ToastProvider } from "./shared/ui/Toast";
import { TooltipProvider } from "./shared/ui/Tooltip";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

interface ActiveTerminalTarget {
  terminalId: string | null;
  tabId: string;
  shell: ShellType;
  label: string;
  ready: boolean;
}

export interface TerminalPaneTarget extends PaneSwitcherEntry {
  tabId: string;
  tabLabel: string;
  tabShell: ShellType;
  tabCwd?: string;
}

interface AppPaneFocusRequest extends PaneFocusRequest {
  tabId: string;
}

interface AppPaneCloseRequest extends PaneCloseRequest {
  tabId: string;
}

interface AppPaneRestartRequest extends PaneRestartRequest {
  tabId: string;
}

interface AppPaneAttachRequest extends PaneAttachRequest {
  tabId: string;
}

interface AppPaneRenameRequest extends PaneRenameRequest {
  tabId: string;
}

interface AppPaneRoleCycleRequest extends PaneRoleCycleRequest {
  tabId: string;
}

interface AppPaneLayoutRequest extends PaneLayoutRequest {
  tabId: string;
}

interface DevVisualQaState {
  enabled: boolean;
  attachFixture: boolean;
  diagnosticsEnabled: boolean;
  incidentFixtures: boolean;
  projectPath: string;
  railMode: RightRailMode;
  railScenario: "idle" | "running" | "blocked" | "review" | "conductor" | "unhealthy";
  railScenarioExplicit: boolean;
}

function formatTerminalTarget(shell: ShellType, terminalId: string | null): string {
  const shellLabel = SHELL_LABELS[shell] ?? shell;
  if (!terminalId) return `${shellLabel} · no active pane`;
  return `${shellLabel} · ${terminalId.slice(0, 8)}`;
}

function readDevVisualQaState(): DevVisualQaState {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return {
      enabled: false,
      attachFixture: false,
      diagnosticsEnabled: false,
      incidentFixtures: false,
      projectPath: "",
      railMode: "observe",
      railScenario: "idle",
      railScenarioExplicit: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  let storedEnabled = false;
  let storedProject: string | null = null;
  try {
    storedEnabled = window.localStorage.getItem("aether:visualQa") === "1";
    storedProject = window.localStorage.getItem("aether:visualQaProject");
  } catch {
    /* storage may be unavailable in private/test contexts */
  }
  const enabled = params.get("aetherVisualQa") === "1" || params.get("visualQa") === "1" || storedEnabled;
  if (!enabled)
    return {
      enabled: false,
      attachFixture: false,
      diagnosticsEnabled: false,
      incidentFixtures: false,
      projectPath: "",
      railMode: "observe",
      railScenario: "idle",
      railScenarioExplicit: false,
    };
  const attachFixture = params.get("attachFixture") === "1" || params.get("processAttach") === "1";
  const diagnosticsEnabled = params.get("diagnostics") === "1" || params.get("logs") === "1";
  const incidentFixtures = params.get("incidents") === "1" || params.get("auditRisk") === "1";
  const projectPath = params.get("projectPath") || storedProject || "C:/Users/owner/Aether_Terminal";
  const requestedRail = params.get("rail");
  const requestedScenario = params.get("railState") ?? params.get("state") ?? params.get("scenario");
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
    projectPath: projectPath.replace(/\\/g, "/"),
    railMode,
    railScenario,
    railScenarioExplicit,
  };
}

function createDevVisualQaSessions(scenario: DevVisualQaState["railScenario"], projectPath: string): AgentSession[] {
  const now = Date.now();
  const worktree = {
    name: "aether-command-center",
    path: `${projectPath}/.aether/worktrees/command-center`,
    branch: "feature/command-center",
    is_main: false,
    head_sha: "qa12345",
    status: "Modified" as const,
  };
  const base = (id: string, overrides: Partial<AgentSession> = {}): AgentSession => ({
    id,
    name: id,
    status: "coding",
    model: "claude-sonnet",
    prompt: "Harden Aether Command Center",
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
        blockedReason: "Approval required for file-system write",
        nextActor: "owner",
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

function createDevVisualQaChangedFiles(
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

function createDevVisualQaAuditEvents(): AuditEventRecord[] {
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

function createDevVisualQaPanes(
  projectPath: string,
  tabId: string,
  tabLabel: string,
  tabShell: ShellType,
  attachFixture = false,
): TerminalPaneTarget[] {
  const cwd = projectPath || "C:/Users/owner/Aether_Terminal";
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

const RIGHT_RAIL_MODES: Array<{
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
    label: "Changes",
    title: "Review agent output, source changes, and commits",
    description: "Inspect changed files, agent output, and commit readiness.",
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

const RIGHT_RAIL_ACTION_WIDGET: Partial<Record<RightRailAction["id"], string>> = {
  "handoff-context": "context",
  "resolve-approvals": "decision-inbox",
  "recover-attention": "sessions",
  "inspect-risk": "reliability",
  "focused-review": "review-queue",
  "collect-final-report": "review-queue",
  "trace-provenance": "run-graph",
  "review-queue": "review-queue",
  "track-selected": "live-panes",
  "parallel-run": "sessions",
  "open-conductor": "run-graph",
  "inspect-context": "context",
  "ready-command": "toolkit",
  "track-run": "processes",
};

function getNextRightRailMode(current: RightRailMode, key: string): RightRailMode | null {
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

const CLOSED_INTERACTIVE_STATUSES = new Set(["idle", "done", "complete", "completed", "stopped", "exited", "closed"]);

function isLiveInteractiveSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 && !CLOSED_INTERACTIVE_STATUSES.has(normalized);
}

function normalizeProjectPath(path?: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function sameOrNestedPath(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function sessionTabMatches(session: AgentSession, tabCwd?: string): boolean {
  const normalizedTabCwd = normalizeProjectPath(tabCwd);
  if (!normalizedTabCwd) return false;
  const candidates = [session.workspaceScope, session.worktree?.path]
    .map((path) => normalizeProjectPath(path))
    .filter((path): path is string => path != null);
  return candidates.some((candidate) => sameOrNestedPath(candidate, normalizedTabCwd));
}

export function App() {
  const {
    themeId,
    moodPresetId,
    rootProjectPath,
    setRootProjectPath,
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    rightPanelWidth,
    setRightPanelWidth,
    paletteVisible,
    setPaletteVisible,
    settingsVisible,
    setSettingsVisible,
    watchdogVisible,
    setWatchdogVisible,
    searchVisible,
    setSearchVisible,
    aboutVisible,
    setAboutVisible,
    helpVisible,
    setHelpVisible,
    webInspectorVisible,
    setWebInspectorVisible,
    prInspectorVisible,
    setPrInspectorVisible,
    openFiles,
    activeFile,
    openFile,
    closeFile,
    clearFiles,
    setActiveFile,
    kanbanTasks,
    moveKanbanTask,
    contextWarnPct,
    resolveWorkspaceProfile,
    setWorkspaceThreadRunState,
  } = useAppStore();
  const themeOverridesForActive = useAppStore((s) => s.themeOverrides[themeId]);
  const materialOverridesForMood = useAppStore((s) => s.moodMaterialOverrides[moodPresetId]);
  const wallpaperForMood = useAppStore((s) => s.wallpaperSettingsByMood[moodPresetId]);
  useThemeApplier(themeId, themeOverridesForActive, moodPresetId, materialOverridesForMood, wallpaperForMood);

  // Boot perf marker — fires after the first React commit + one frame, so the
  // number reflects when pixels actually land on screen rather than when JS ran.
  useEffect(() => {
    const raf = requestAnimationFrame(() => markFirstPaint());
    return () => cancelAnimationFrame(raf);
  }, []);

  const devVisualQa = useMemo(readDevVisualQaState, []);

  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);
  const [fileTreeKey, setFileTreeKey] = useState(0);
  const [quickOpenMode, setQuickOpenMode] = useState<"files" | "buffers" | null>(null);
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("command");
  const [rightRailFocusWidget, setRightRailFocusWidget] = useState<string | null>(null);
  const [rightRailFixtureSelectedSessionId, setRightRailFixtureSelectedSessionId] = useState<string | null>(null);
  const [paneSwitcherVisible, setPaneSwitcherVisible] = useState(false);
  const rightRailPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRightRailFixtureSelectedSessionId(null);
  }, [devVisualQa.enabled, devVisualQa.railScenario]);

  useEffect(() => {
    if (!rightRailFocusWidget) return;
    let cleanupTimer: number | undefined;
    const raf = window.requestAnimationFrame(() => {
      const widget = Array.from(rightRailPanelRef.current?.querySelectorAll<HTMLElement>("[data-widget]") ?? []).find(
        (candidate) => candidate.dataset.widget === rightRailFocusWidget,
      );
      if (!widget) return;
      widget.scrollIntoView({ block: "nearest", behavior: "smooth" });
      widget.dataset.railFocus = "true";
      cleanupTimer = window.setTimeout(() => {
        delete widget.dataset.railFocus;
        setRightRailFocusWidget(null);
      }, 1_400);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
    };
  }, [rightRailFocusWidget, rightRailMode]);

  // Map<tabId, focused-pane PTY id>. Each `<PaneTreeContainer>` reports
  // its tab's focused-pane PTY id through `onActiveTerminalChange`; the
  // status-bar inline-image budget badge reads `tabActivePtyIds[active
  // TabId]` so it polls the correct backend session. PTY id ≠ Tab UUID
  // — `spawn_terminal` returns a freshly-allocated id that lives in the
  // pane-tree's private `terminalIds` map, so this lift is the only way
  // to thread it through to global UI without leaking pane-tree state.
  const [tabActivePtyIds, setTabActivePtyIds] = useState<Record<string, string | null>>({});
  const setTabActivePtyId = useCallback((tabId: string, ptyId: string | null) => {
    setTabActivePtyIds((prev) => {
      if (prev[tabId] === ptyId) return prev;
      return { ...prev, [tabId]: ptyId };
    });
  }, []);
  const [tabPaneRegistries, setTabPaneRegistries] = useState<Record<string, PaneSwitcherEntry[]>>({});
  const [paneFocusRequest, setPaneFocusRequest] = useState<AppPaneFocusRequest | null>(null);
  const [paneCloseRequest, setPaneCloseRequest] = useState<AppPaneCloseRequest | null>(null);
  const [paneRestartRequest, setPaneRestartRequest] = useState<AppPaneRestartRequest | null>(null);
  const [paneAttachRequest, setPaneAttachRequest] = useState<AppPaneAttachRequest | null>(null);
  const [paneRenameRequest, setPaneRenameRequest] = useState<AppPaneRenameRequest | null>(null);
  const [paneRoleCycleRequest, setPaneRoleCycleRequest] = useState<AppPaneRoleCycleRequest | null>(null);
  const [paneLayoutRequest, setPaneLayoutRequest] = useState<AppPaneLayoutRequest | null>(null);
  const [selectedAuditEventId, setSelectedAuditEventId] = useState<number | null>(null);
  const [selectedAuditTraceFilter, setSelectedAuditTraceFilter] = useState<string | null>(null);
  const [selectedOperationalPane, setSelectedOperationalPane] = useState<OperationalPaneSelection | null>(null);
  const setTabPaneRegistry = useCallback((tabId: string, panes: PaneSwitcherEntry[]) => {
    setTabPaneRegistries((prev) => {
      if (paneRegistryEqual(prev[tabId] ?? [], panes)) return prev;
      return { ...prev, [tabId]: panes };
    });
  }, []);

  const {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    addTabWithCwd,
    activityTabs,
    markTabActivity,
    reorderTab,
  } = useTabManager("powershell");
  const activePtyId = tabActivePtyIds[activeTabId] ?? null;
  const activeTerminalTarget = useMemo<ActiveTerminalTarget>(
    () => ({
      terminalId: activePtyId,
      tabId: activeTabId,
      shell: activeTab.shell,
      label: formatTerminalTarget(activeTab.shell, activePtyId),
      ready: Boolean(activePtyId),
    }),
    [activePtyId, activeTab.shell, activeTabId],
  );
  const terminalPaneTargets = useMemo<TerminalPaneTarget[]>(
    () =>
      tabs.flatMap((tab) =>
        (tabPaneRegistries[tab.id] ?? []).map((pane) => ({
          ...pane,
          tabId: tab.id,
          tabLabel: tab.label,
          tabShell: tab.shell,
          tabCwd: tab.cwd,
        })),
      ),
    [tabPaneRegistries, tabs],
  );
  const visualTerminalPaneTargets = useMemo<TerminalPaneTarget[]>(() => {
    if (!devVisualQa.enabled) return terminalPaneTargets;
    if (terminalPaneTargets.some((pane) => pane.terminalId)) return terminalPaneTargets;
    return createDevVisualQaPanes(
      devVisualQa.projectPath,
      activeTabId,
      activeTab.label,
      activeTab.shell,
      devVisualQa.attachFixture,
    );
  }, [
    activeTab.label,
    activeTab.shell,
    activeTabId,
    devVisualQa.attachFixture,
    devVisualQa.enabled,
    devVisualQa.projectPath,
    terminalPaneTargets,
  ]);
  const visualActivePtyId =
    activePtyId ??
    (devVisualQa.enabled && visualTerminalPaneTargets.length > 0 ? visualTerminalPaneTargets[0].terminalId : null);

  useEffect(() => {
    const onPrefixCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string; command?: string }>).detail;
      if (detail?.command !== "new-window") return;
      const source = terminalPaneTargets.find((pane) => pane.terminalId === detail.terminalId);
      const shell = source?.tabShell ?? activeTab.shell;
      const cwd = source?.tabCwd ?? activeTab.cwd;
      if (cwd) {
        addTabWithCwd(shell, cwd);
      } else {
        addTab(shell);
      }
    };
    document.addEventListener(TERMINAL_PREFIX_COMMAND_EVENT, onPrefixCommand);
    return () => document.removeEventListener(TERMINAL_PREFIX_COMMAND_EVENT, onPrefixCommand);
  }, [activeTab.cwd, activeTab.shell, addTab, addTabWithCwd, terminalPaneTargets]);
  const visualAuditEvents = useMemo(
    () =>
      devVisualQa.incidentFixtures || devVisualQa.railScenario === "blocked" || devVisualQa.railScenario === "unhealthy"
        ? createDevVisualQaAuditEvents()
        : undefined,
    [devVisualQa.incidentFixtures, devVisualQa.railScenario],
  );
  const auditStream = useAuditEvents({ enabled: visualAuditEvents === undefined, limit: 40, pollMs: 3_000 });
  const operationalAuditEvents = visualAuditEvents ?? auditStream.entries;
  const [workflowStatuses, setWorkflowStatuses] = useState<DecisionWorkflowStatus[]>([]);
  const selectedOperationalPaneTarget = useMemo(
    () =>
      selectedOperationalPane
        ? visualTerminalPaneTargets.find(
            (pane) => pane.tabId === selectedOperationalPane.tabId && pane.paneId === selectedOperationalPane.paneId,
          )
        : undefined,
    [selectedOperationalPane, visualTerminalPaneTargets],
  );

  const selectOperationalPane = useCallback((pane?: TerminalPaneTarget) => {
    setSelectedOperationalPane(
      pane
        ? {
            tabId: pane.tabId,
            paneId: pane.paneId,
            terminalId: pane.terminalId,
          }
        : null,
    );
  }, []);

  useEffect(() => {
    setSelectedOperationalPane((selected) => reconcileOperationalPaneSelection(selected, visualTerminalPaneTargets));
  }, [visualTerminalPaneTargets]);

  const handleSelectAuditEvent = useCallback(
    (entry: AuditEventRecord, pane?: TerminalPaneTarget) => {
      setSelectedAuditEventId(entry.id);
      selectOperationalPane(pane);
    },
    [selectOperationalPane],
  );

  const handleSelectReliabilityIncident = useCallback(
    (incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [selectOperationalPane],
  );

  const handleTraceReliabilityIncident = useCallback(
    (correlationId: string, incident: { eventId: number; pane?: TerminalPaneTarget }) => {
      setSelectedAuditTraceFilter(correlationId);
      setSelectedAuditEventId(incident.eventId);
      selectOperationalPane(incident.pane);
    },
    [selectOperationalPane],
  );

  // Prune `tabActivePtyIds` entries whose tab has been closed. Without
  // this the map grows unboundedly across the lifetime of the session
  // — minor in practice but trivial to guard against.
  useEffect(() => {
    const liveIds = new Set(tabs.map((t) => t.id));
    setTabActivePtyIds((prev) => {
      let mutated = false;
      const next: Record<string, string | null> = {};
      for (const [id, ptyId] of Object.entries(prev)) {
        if (liveIds.has(id)) {
          next[id] = ptyId;
        } else {
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
    setTabPaneRegistries((prev) => {
      let mutated = false;
      const next: Record<string, PaneSwitcherEntry[]> = {};
      for (const [id, panes] of Object.entries(prev)) {
        if (liveIds.has(id)) {
          next[id] = panes;
        } else {
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [tabs]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length > 1 && tabs.some((tab) => tab.id === tabId)) {
        const storageKey = paneTreeStorageKey(tabId);
        deletePaneTreeSnapshot(storageKey);
        void deletePaneTreeSnapshotFromBackend(storageKey);
      }
      closeTab(tabId);
    },
    [closeTab, tabs],
  );

  const { sessions, activeSessionId, setActiveSessionId, startAgent, stopAgent, renameSession } = useAgentManager();
  const {
    sessions: interactiveSessions,
    activeSessionId: interactiveSessionId,
    selectSession: selectInteractiveSession,
    startSession: startInteractiveSession,
    stopSession: stopInteractiveSession,
    endSessionAndRemoveWorktree,
  } = useInteractiveAgent();

  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  const projectName = projectPath ? (projectPath.split("/").filter(Boolean).pop() ?? "Aether") : "Aether";
  const workspaceProfile = useMemo(
    () => resolveWorkspaceProfile(projectPath || rootProjectPath || "workspace", activeTabId),
    [activeTabId, projectPath, resolveWorkspaceProfile, rootProjectPath],
  );
  const scopedOperationalAuditEvents = useMemo(
    () => filterWorkspaceScopedEvents(operationalAuditEvents, workspaceProfile),
    [operationalAuditEvents, workspaceProfile],
  );

  useEffect(() => {
    let active = true;
    if (!projectPath) {
      setWorkflowStatuses([]);
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<DecisionWorkflowStatus[]>("list_running_workflows", { projectPath }))
        .then((statuses) => {
          if (active) setWorkflowStatuses(statuses);
        })
        .catch((err) => {
          if (!active) return;
          reportInvokeFailure({
            source: "app",
            operation: "list_running_workflows",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    setWorkspaceThreadRunState(projectPath, activeTabId, {
      status: "active",
      activePaneId: visualActivePtyId,
      lastActiveAt: new Date().toISOString(),
    });
  }, [activeTabId, projectPath, setWorkspaceThreadRunState, visualActivePtyId]);

  // ── Derived state ──

  const { branch, changedFiles, refresh: refreshGitStatus } = useGitStatus(projectPath);
  const rightRailUsesFixtures = devVisualQa.enabled && devVisualQa.railScenarioExplicit;
  const rightRailSessions = useMemo(
    () =>
      rightRailUsesFixtures
        ? createDevVisualQaSessions(devVisualQa.railScenario, devVisualQa.projectPath || projectPath)
        : sessions,
    [devVisualQa.projectPath, devVisualQa.railScenario, projectPath, rightRailUsesFixtures, sessions],
  );
  const rightRailChangedFiles = useMemo(
    () =>
      rightRailUsesFixtures
        ? createDevVisualQaChangedFiles(devVisualQa.railScenario)
        : changedFiles,
    [changedFiles, devVisualQa.railScenario, rightRailUsesFixtures],
  );
  const rightRailSelectedFixtureSessionExists =
    rightRailFixtureSelectedSessionId != null &&
    rightRailSessions.some((session) => session.id === rightRailFixtureSelectedSessionId);
  const rightRailActiveSessionId =
    rightRailUsesFixtures && rightRailSessions.length > 0
      ? rightRailSelectedFixtureSessionExists
        ? rightRailFixtureSelectedSessionId
        : (rightRailSessions[0]?.id ?? null)
      : activeSessionId;
  const rightRailAuditRisks = useMemo(
    () =>
      scopedOperationalAuditEvents
        .filter((event) => event.severity === "warn" || event.severity === "error")
        .slice(0, 20)
        .map((event) => ({
          id: `audit-${event.id}`,
          title: event.summary || event.action,
          status: "open",
          severity: event.severity,
          agentId:
            event.entityType === "agent" && event.entityId
              ? event.entityId
              : typeof event.metadata.agentId === "string"
                ? event.metadata.agentId
                : undefined,
          filePath:
            typeof event.metadata.filePath === "string"
              ? event.metadata.filePath
              : typeof event.metadata.path === "string"
                ? event.metadata.path
                : undefined,
        })),
    [scopedOperationalAuditEvents],
  );
  const rightRailGraph = useMemo(
    () =>
      buildWorkstationGraph({
        workspaceId: projectPath || "workspace",
        threadId: activeTabId,
        sessions: rightRailSessions,
        panes: visualTerminalPaneTargets.map((pane) => ({
          paneId: pane.paneId,
          terminalId: pane.terminalId,
          title: pane.title || pane.label,
          role: pane.role,
          status: pane.lifecycle,
        })),
        changedFiles: rightRailChangedFiles,
        risks: rightRailAuditRisks,
      }),
    [activeTabId, projectPath, rightRailAuditRisks, rightRailChangedFiles, rightRailSessions, visualTerminalPaneTargets],
  );
  const focusedRightRailGraph = useMemo(
    () =>
      filterWorkstationGraph(rightRailGraph, {
        agentId: rightRailActiveSessionId,
        paneId: selectedOperationalPaneTarget?.paneId ?? null,
      }),
    [rightRailActiveSessionId, rightRailGraph, selectedOperationalPaneTarget?.paneId],
  );
  const decisionInbox = useMemo(
    () => buildDecisionInbox({ sessions: rightRailSessions, auditEvents: scopedOperationalAuditEvents, workflows: workflowStatuses }),
    [rightRailSessions, scopedOperationalAuditEvents, workflowStatuses],
  );
  const activeAgent = sessions.find((s) => s.id === activeSessionId);
  const headerStatus = activeAgent
    ? activeAgent.status === "thinking" || activeAgent.status === "generating"
      ? "thinking"
      : activeAgent.status === "coding"
        ? "edit"
        : activeAgent.status === "error"
          ? "error"
          : activeAgent.status === "waiting"
            ? "waiting"
            : activeAgent.status === "done"
              ? "done"
              : "idle"
    : "idle";

  const handleRefresh = useCallback(() => {
    refreshGitStatus();
    setFileTreeKey((k) => k + 1);
  }, [refreshGitStatus]);

  const confirmDiscardUnsavedFiles = useCallback(async (action: string) => {
    const count = useAppStore.getState().unsavedFiles.size;
    if (count === 0) return true;
    return showConfirm({
      title: "Unsaved changes",
      description: `${count} file(s) have unsaved changes. ${action}?`,
      confirmLabel: "Discard",
      tone: "danger",
    });
  }, []);

  // ── Extracted hooks ──

  const { createWorktree, removeWorktree } = useWorktreeActions({
    projectPath,
    sessions,
    addTabWithCwd,
    stopAgent,
    onRefresh: handleRefresh,
  });

  const { agentStatuses } = useTaskAgentLink({
    sessions,
    kanbanTasks,
    moveKanbanTask,
  });

  // ── Handlers ──

  const handleOpenProject = useCallback(
    async (path: string) => {
      if (!(await confirmDiscardUnsavedFiles("Open another project and discard them"))) return;
      const normalized = path.replace(/\\/g, "/");
      setRootProjectPath(normalized);
      addTabWithCwd("powershell", normalized);
      clearFiles();
    },
    [addTabWithCwd, clearFiles, confirmDiscardUnsavedFiles, setRootProjectPath],
  );

  const handleCloseFolder = useCallback(async () => {
    if (!(await confirmDiscardUnsavedFiles("Close this project and discard them"))) return;
    setRootProjectPath(null);
    clearFiles();
  }, [clearFiles, confirmDiscardUnsavedFiles, setRootProjectPath]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        await handleOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch {
      /* cancelled or not in Tauri */
    }
  }, [handleOpenProject]);

  useEffect(() => {
    if (!devVisualQa.enabled) return;
    try {
      window.localStorage.setItem("aether:onboarding-done", "true");
    } catch {
      /* storage may be unavailable in private/test contexts */
    }
    if (!rootProjectPath) {
      setRootProjectPath(devVisualQa.projectPath);
    }
    setRightRailMode(devVisualQa.railMode);
    if (rightPanelWidth < 340) {
      setRightPanelWidth(340);
    }
  }, [
    devVisualQa.enabled,
    devVisualQa.projectPath,
    devVisualQa.railMode,
    rightPanelWidth,
    rootProjectPath,
    setRightPanelWidth,
    setRootProjectPath,
  ]);

  const handleTabSwitch = useCallback(
    async (tabId: string) => {
      if (tabId === activeTabId) return true;
      if (!(await confirmDiscardUnsavedFiles("Switch tabs and discard them"))) return false;
      setActiveTabId(tabId);
      clearFiles();
      return true;
    },
    [activeTabId, clearFiles, confirmDiscardUnsavedFiles, setActiveTabId],
  );

  const handlePaneSwitch = useCallback(
    async (tabId: string, paneId: string) => {
      const switched = tabId === activeTabId ? true : await handleTabSwitch(tabId);
      if (!switched) return;
      if (interactiveSessionId) selectInteractiveSession("");
      setPaneFocusRequest((prev) => ({
        tabId,
        paneId,
        sequence: (prev?.sequence ?? 0) + 1,
      }));
    },
    [activeTabId, handleTabSwitch, interactiveSessionId, selectInteractiveSession],
  );

  const handleFocusOperationalPane = useCallback(
    async (tabId: string, paneId: string) => {
      const target = visualTerminalPaneTargets.find((pane) => pane.tabId === tabId && pane.paneId === paneId);
      if (target) selectOperationalPane(target);
      await handlePaneSwitch(tabId, paneId);
    },
    [handlePaneSwitch, selectOperationalPane, visualTerminalPaneTargets],
  );

  const focusAdjacentPane = useCallback(
    async (delta: 1 | -1) => {
      if (visualTerminalPaneTargets.length <= 1) return;
      const currentIndex = findActivePaneIndex(visualTerminalPaneTargets, activeTabId, visualActivePtyId);
      const baseIndex =
        currentIndex >= 0
          ? currentIndex
          : Math.max(
              0,
              visualTerminalPaneTargets.findIndex((pane) => pane.tabId === activeTabId),
            );
      const nextIndex = (baseIndex + delta + visualTerminalPaneTargets.length) % visualTerminalPaneTargets.length;
      const target = visualTerminalPaneTargets[nextIndex];
      if (!target) return;
      await handlePaneSwitch(target.tabId, target.paneId);
      selectOperationalPane(target);
    },
    [activeTabId, handlePaneSwitch, selectOperationalPane, visualActivePtyId, visualTerminalPaneTargets],
  );

  const applyPaneLayoutCommand = useCallback(
    (command: PaneLayoutCommand, tabId = activeTabId) => {
      setPaneLayoutRequest((prev) => ({
        tabId,
        command,
        sequence: (prev?.sequence ?? 0) + 1,
      }));
    },
    [activeTabId],
  );

  const handlePaneClose = useCallback((tabId: string, paneId: string) => {
    setPaneCloseRequest((prev) => ({
      tabId,
      paneId,
      sequence: (prev?.sequence ?? 0) + 1,
    }));
  }, []);

  const handlePaneRestart = useCallback(
    async (tabId: string, paneId: string) => {
      const switched = tabId === activeTabId ? true : await handleTabSwitch(tabId);
      if (!switched) {
        throw new Error("Restart target tab is unavailable.");
      }
      await new Promise<void>((resolve, reject) => {
        setPaneRestartRequest((prev) => ({
          tabId,
          paneId,
          sequence: (prev?.sequence ?? 0) + 1,
          onComplete: (error) => {
            if (error) {
              reject(new Error(error));
              return;
            }
            resolve();
          },
        }));
      });
    },
    [activeTabId, handleTabSwitch],
  );

  const handlePaneAttach = useCallback(
    async (tabId: string, paneId: string, terminalId: string) => {
      const switched = tabId === activeTabId ? true : await handleTabSwitch(tabId);
      if (!switched) {
        throw new Error("Attach target tab is unavailable.");
      }
      await new Promise<void>((resolve, reject) => {
        setPaneAttachRequest((prev) => ({
          tabId,
          paneId,
          terminalId,
          sequence: (prev?.sequence ?? 0) + 1,
          onComplete: (error) => {
            if (error) {
              reject(new Error(error));
              return;
            }
            resolve();
          },
        }));
      });
    },
    [activeTabId, handleTabSwitch],
  );

  const handlePaneRename = useCallback(
    async (tabId: string, paneId: string, title: string | null) => {
      const switched = tabId === activeTabId ? true : await handleTabSwitch(tabId);
      if (!switched) return;
      setPaneRenameRequest((prev) => ({
        tabId,
        paneId,
        title,
        sequence: (prev?.sequence ?? 0) + 1,
      }));
    },
    [activeTabId, handleTabSwitch],
  );

  const handlePaneRoleCycle = useCallback(
    async (tabId: string, paneId: string) => {
      const switched = tabId === activeTabId ? true : await handleTabSwitch(tabId);
      if (!switched) return;
      setPaneRoleCycleRequest((prev) => ({
        tabId,
        paneId,
        sequence: (prev?.sequence ?? 0) + 1,
      }));
    },
    [activeTabId, handleTabSwitch],
  );

  const handleStartAgent = useCallback(
    async (
      prompt: string,
      model?: string,
      meta?: { role?: import("./shared/lib/orchestrator").OrchestraRoleId; handoffFrom?: string },
    ) => {
      try {
        return await startAgent(prompt, projectPath, model, meta);
      } catch {
        return undefined;
      }
    },
    [startAgent, projectPath],
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      setOpenInDiff(false);
      openFile(path);
    },
    [openFile],
  );

  const handleOpenDiff = useCallback(
    (path: string) => {
      setOpenInDiff(true);
      openFile(path);
    },
    [openFile],
  );

  const unsavedFiles = useAppStore((s) => s.unsavedFiles);
  const handleCloseFile = useCallback(
    async (path: string) => {
      if (unsavedFiles.has(path)) {
        const ok = await showConfirm({
          title: "Unsaved changes",
          description: "You have unsaved changes. Close anyway?",
          confirmLabel: "Close",
          tone: "danger",
        });
        if (!ok) return;
      }
      closeFile(path);
    },
    [closeFile, unsavedFiles],
  );

  const writeToActiveTerminal = useCallback(
    async (data: string, unavailableDetail = "Click a terminal pane before sending commands.") => {
      if (!activeTerminalTarget.terminalId) {
        toast.error("No active terminal", unavailableDetail);
        return false;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("write_terminal", { id: activeTerminalTarget.terminalId, data });
        return true;
      } catch (err) {
        toast.error("Terminal write failed", String(err));
        return false;
      }
    },
    [activeTerminalTarget.terminalId],
  );

  const handleRunCommand = useCallback(
    async (command: string) => {
      const risk = classifyCommand(command, {
        workspaceRoot: workspaceProfile.workspaceRoot,
        safePaths: workspaceProfile.safePaths,
      });
      if (risk.requiresApproval) {
        const ok = await showConfirm({
          title: "Command risk review",
          description: formatCommandRiskSummary(risk),
          confirmLabel: risk.severity === "deny" ? "Run anyway" : "Run command",
          tone: risk.severity === "deny" ? "danger" : "default",
        });
        if (!ok) {
          toast.error("Command not sent", "The command risk firewall cancelled the terminal write.");
          return;
        }
      }
      await writeToActiveTerminal(`${command}\r`);
    },
    [workspaceProfile.safePaths, workspaceProfile.workspaceRoot, writeToActiveTerminal],
  );

  /**
   * Ctrl+R history hit → stage the command at the current prompt without
   * pressing Enter. Matches fish/zsh `history-pager` behaviour so the user
   * can still edit before running.
   */
  const handleHistoryAccept = useCallback(
    async (hit: SearchHit) => {
      await writeToActiveTerminal(hit.entry.command, "Click a terminal pane before staging a history command.");
    },
    [writeToActiveTerminal],
  );

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      const agent = sessions.find((s) => s.id === sessionId);
      if (agent) {
        const matchTab = tabs.find((t) => sessionTabMatches(agent, t.cwd));
        if (matchTab) void handleTabSwitch(matchTab.id);
      }
    },
    [sessions, tabs, setActiveSessionId, handleTabSwitch],
  );

  const handleSelectRightRailSession = useCallback(
    (sessionId: string) => {
      if (rightRailUsesFixtures) {
        setRightRailFixtureSelectedSessionId(sessionId);
        return;
      }
      handleSelectSession(sessionId);
    },
    [handleSelectSession, rightRailUsesFixtures],
  );

  const handleRightRailAction = useCallback(
    (action: RightRailAction) => {
      setRightRailMode(action.mode);
      setRightRailFocusWidget(RIGHT_RAIL_ACTION_WIDGET[action.id] ?? null);
      if (action.targetSessionId) {
        handleSelectRightRailSession(action.targetSessionId);
      }
      if (action.targetPaneRole) {
        const pane = visualTerminalPaneTargets.find((candidate) => candidate.role === action.targetPaneRole);
        if (pane) selectOperationalPane(pane);
      }
    },
    [handleSelectRightRailSession, selectOperationalPane, visualTerminalPaneTargets],
  );

  // ── Interactive agent session handlers ──

  const handleFocusInteractiveSession = useCallback(
    (sessionId: string) => {
      selectInteractiveSession(sessionId);
    },
    [selectInteractiveSession],
  );

  const handleStartInteractiveSession = useCallback(
    async (opts: { cwd: string; model?: string; initialPrompt?: string; branchName?: string }) => {
      await startInteractiveSession({
        ...opts,
        cols: 120,
        rows: 30,
      });
    },
    [startInteractiveSession],
  );

  // ── Keyboard shortcuts (extracted hook) ──

  useKeyboardShortcuts({
    projectPath,
    tabs,
    addTab,
    closeTab: handleCloseTab,
    activeTabId,
    setActiveTabId,
    activeFile,
    sessions,
    activeSessionId,
    setActiveSessionId,
    setPaletteVisible,
    setSettingsVisible,
    setSearchVisible,
    handleOpenFolder,
    handleCloseFile,
    handleFileSelect,
    handleStartAgent,
    setQuickOpenMode,
    openPaneSwitcher: () => setPaneSwitcherVisible(true),
    focusNextPane: () => focusAdjacentPane(1),
    focusPreviousPane: () => focusAdjacentPane(-1),
    setHelpVisible,
    setSidebarCollapsed,
  });

  // ── Terminal notifications (bell → tab badge + Windows toast) ──

  useTerminalNotifications({ activeTabId, tabs, onTabActivity: markTabActivity });

  // ── Session restore (DB bookkeeping + localStorage fallback) ──

  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        invoke<{
          session: { id: string; name: string };
          windows: { panes: { shell_type: string; cwd: string }[] }[];
        } | null>("restore_last_session")
          .then((restored) => {
            if (!restored) return;
            // If localStorage had no saved tabs, use DB panes as fallback
            const hasSavedTabs = localStorage.getItem("aether:tabs");
            if (!hasSavedTabs && restored.windows.length > 0) {
              for (const win of restored.windows) {
                for (const pane of win.panes) {
                  const shell = (pane.shell_type as ShellType) || "powershell";
                  if (pane.cwd) {
                    addTabWithCwd(shell, pane.cwd);
                  }
                }
              }
            }
          })
          .catch(() => {
            /* DB not available or no session */
          });
      })
      .catch(() => {});
  }, [addTabWithCwd]);

  // ── Window setup ──

  useEffect(() => {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();

        // Restore window position/size
        try {
          const saved = localStorage.getItem("aether:windowBounds");
          if (saved) {
            const { x, y, width, height, maximized } = JSON.parse(saved);
            if (width > 0 && height > 0) {
              import("@tauri-apps/api/dpi")
                .then(({ LogicalPosition: LP, LogicalSize: LS }) => {
                  win.setPosition(new LP(x, y)).catch(() => {});
                  win.setSize(new LS(width, height)).catch(() => {});
                })
                .catch(() => {});
            }
            if (maximized) win.maximize().catch(() => {});
          }
        } catch {
          /* ignore */
        }

        win.show().catch(() => {});

        /* `forceClose` short-circuits the unsaved-files confirm on the
         * NEXT close request. Codex review (round 7) caught the
         * loop: after the user confirms, this callback called
         * `win.close()` which re-fires `onCloseRequested`; the
         * unsaved set is unchanged so the confirm shows again. By
         * flipping `forceClose` before the second `close()`, the
         * second pass falls through and Tauri proceeds to destroy
         * the window. */
        let forceClose = false;
        win
          .onCloseRequested(async (event) => {
            /* Force-close short-circuit MUST run before any await — Codex
             * review (round 8) flagged that putting the guard after the
             * bounds-saving IPCs lets the second close (post-confirm) hang
             * if `outerPosition()` / `outerSize()` / `isMaximized()` stall.
             * In that scenario the user has confirmed the unsaved-files
             * prompt but the window never destroys. Synchronous early
             * return on the second pass guarantees Tauri proceeds to
             * destroy; bounds for the *first* close still get saved as
             * normal, and on confirmed unsaved-close we accept losing
             * the bounds save (acceptable trade vs. a stuck window). */
            if (forceClose) return;

            // Save window position/size before close
            try {
              const pos = await win.outerPosition();
              const size = await win.outerSize();
              const maximized = await win.isMaximized();
              localStorage.setItem(
                "aether:windowBounds",
                JSON.stringify({
                  x: pos.x,
                  y: pos.y,
                  width: size.width,
                  height: size.height,
                  maximized,
                }),
              );
            } catch {
              /* ignore */
            }

            const { unsavedFiles } = useAppStore.getState();
            if (unsavedFiles.size > 0) {
              // Preserve the native close-request semantics (synchronous
              // preventDefault) while still showing the themed confirm
              // asynchronously. If the user confirms, we tear the window
              // down ourselves.
              event.preventDefault();
              const ok = await showConfirm({
                title: "Unsaved changes",
                description: `${unsavedFiles.size} file(s) have unsaved changes. Close anyway?`,
                confirmLabel: "Close",
                tone: "danger",
              });
              if (ok) {
                forceClose = true;
                await win.close();
              }
            }
          })
          .catch((err) => {
            reportInvokeFailure({
              source: "app",
              operation: "onCloseRequested",
              err,
              severity: "error",
              userVisible: true,
            });
            toast.error("Close guard unavailable", formatFallbackError(err));
          });
      })
      .catch((err) => {
        reportInvokeFailure({
          source: "app",
          operation: "window_setup",
          err,
          severity: "warning",
        });
      });
  }, []);

  useEffect(() => {
    const title = projectPath ? `${projectName} — Aether Terminal` : "Aether Terminal";
    document.title = title;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        getCurrentWindow()
          .setTitle(title)
          .catch(() => {});
      })
      .catch(() => {});
  }, [projectName, projectPath]);

  // ── Command palette commands ──

  const { commands, menus } = useAppMenus({
    addTab,
    closeTab: handleCloseTab,
    switchTab: handleTabSwitch,
    tabs,
    switchPane: handlePaneSwitch,
    focusNextPane: () => focusAdjacentPane(1),
    focusPreviousPane: () => focusAdjacentPane(-1),
    movePaneNext: () => applyPaneLayoutCommand("move-next"),
    movePanePrevious: () => applyPaneLayoutCommand("move-previous"),
    rotatePanesNext: () => applyPaneLayoutCommand("rotate-next"),
    rotatePanesPrevious: () => applyPaneLayoutCommand("rotate-previous"),
    equalizePanes: () => applyPaneLayoutCommand("equalize"),
    tilePanes: () => applyPaneLayoutCommand("tiled"),
    syncPanesOn: () => applyPaneLayoutCommand("sync-panes-on"),
    syncPanesOff: () => applyPaneLayoutCommand("sync-panes-off"),
    openPaneSwitcher: () => setPaneSwitcherVisible(true),
    panes: visualTerminalPaneTargets,
    activeTabId,
    activeFile,
    projectPath,
    handleFileSelect,
    handleCloseFile,
    handleOpenFolder,
    handleCloseFolder,
    handleStartAgent,
    setPaletteVisible,
    setSettingsVisible,
    setSearchVisible,
    setWatchdogVisible,
    setAboutVisible,
    setHelpVisible,
    setWebInspectorVisible,
    setPrInspectorVisible,
  });

  // ── Render ──

  // Active interactive session (if any)
  const activeInteractive = interactiveSessions.find((s) => s.id === interactiveSessionId);
  const handleRightRailModeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const nextMode = getNextRightRailMode(rightRailMode, event.key);
      if (!nextMode) return;
      event.preventDefault();
      setRightRailMode(nextMode);
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-right-rail-mode="${nextMode}"]`)?.focus();
      });
    },
    [rightRailMode],
  );

  const terminalTabs = tabs.map((tab) => (
    <div key={tab.id} className={appStyles.terminalTabPane} data-active={tab.id === activeTabId && !activeInteractive}>
      <PaneTreeContainer
        shell={tab.shell}
        cwd={tab.cwd}
        layoutStorageKey={paneTreeStorageKey(tab.id)}
        switcherWindowLabel={tab.label}
        projectPath={tab.cwd ?? rootProjectPath ?? ""}
        onActiveTerminalChange={(terminalId) => {
          setTabActivePtyId(tab.id, terminalId);
        }}
        onPaneRegistryChange={(panes) => {
          setTabPaneRegistry(tab.id, panes);
        }}
        focusPaneRequest={paneFocusRequest?.tabId === tab.id ? paneFocusRequest : null}
        closePaneRequest={paneCloseRequest?.tabId === tab.id ? paneCloseRequest : null}
        restartPaneRequest={paneRestartRequest?.tabId === tab.id ? paneRestartRequest : null}
        attachPaneRequest={paneAttachRequest?.tabId === tab.id ? paneAttachRequest : null}
        renamePaneRequest={paneRenameRequest?.tabId === tab.id ? paneRenameRequest : null}
        cyclePaneRoleRequest={paneRoleCycleRequest?.tabId === tab.id ? paneRoleCycleRequest : null}
        layoutRequest={paneLayoutRequest?.tabId === tab.id ? paneLayoutRequest : null}
      />
    </div>
  ));

  if (!rootProjectPath) {
    return (
      <TooltipProvider>
        <ToastProvider>
          <div className="app-container" data-density={workspaceProfile.visualDensity}>
            <Suspense fallback={null}>
              <WelcomeScreen onOpenProject={handleOpenProject} onOpenSettings={() => setSettingsVisible(true)} />
            </Suspense>
            {/* Settings is reachable before a project is open (theme /
             * default shell pick on first run). Same LazyDialog wrapper
             * as the post-project path so a chunk-load failure shows a
             * retry panel instead of a silent click. */}
            {settingsVisible && (
              <LazyDialog>
                <Settings visible onClose={() => setSettingsVisible(false)} />
              </LazyDialog>
            )}
          </div>
        </ToastProvider>
      </TooltipProvider>
    );
  }

  const liveInteractiveSessionCount = interactiveSessions.filter((session) =>
    isLiveInteractiveSessionStatus(session.status),
  ).length;
  const liveAgentCount =
    rightRailSessions.filter((s) => s.status !== "idle" && s.status !== "done").length + liveInteractiveSessionCount;
  const rightRailModeBadges: Record<RightRailMode, number> = {
    command: decisionInbox.pendingCount > 0 ? decisionInbox.pendingCount : liveAgentCount,
    review: rightRailChangedFiles.length,
    observe: decisionInbox.pendingCount + liveAgentCount,
  };
  const rightRailAdvisorInput = {
    sessions: rightRailSessions,
    interactiveSessionCount: liveInteractiveSessionCount,
    changedFilesCount: rightRailChangedFiles.length,
    contextWarnPct,
    currentMode: rightRailMode,
    pendingDecisionCount: decisionInbox.pendingCount,
    workstationGraph: rightRailGraph,
    selectedPane: selectedOperationalPaneTarget
      ? {
          role: selectedOperationalPaneTarget.role,
          title: selectedOperationalPaneTarget.title,
          label: selectedOperationalPaneTarget.label,
        }
      : null,
  };
  const rightRailActions = deriveRightRailActions(rightRailAdvisorInput);
  const rightRailNowState = deriveRightRailNowState(rightRailAdvisorInput);
  const rightRailRecommendation = deriveRightRailRecommendation(rightRailAdvisorInput);
  const rightRailRecommendedMode = rightRailRecommendation
    ? RIGHT_RAIL_MODES.find((mode) => mode.id === rightRailRecommendation.mode)
    : undefined;
  const RightRailRecommendedIcon = rightRailRecommendedMode?.icon;
  const activeRightRailMode = RIGHT_RAIL_MODES.find((mode) => mode.id === rightRailMode) ?? RIGHT_RAIL_MODES[0];
  const terminalSurface = (
    <div className={appStyles.terminalContainer}>
      {terminalTabs}
      {activeInteractive && (
        <div className={appStyles.terminalTabPane} data-active>
          <AgentTerminal
            ptyId={activeInteractive.pty_id}
            cli={activeInteractive.cli}
            status={
              activeInteractive.status as "idle" | "thinking" | "coding" | "generating" | "waiting" | "error" | "done"
            }
            model={activeInteractive.model}
            cost={activeInteractive.cost}
          />
        </div>
      )}
    </div>
  );
  const editorArea = activeFile ? (
    <div className={appStyles.editorArea}>
      <div className={appStyles.editorTabsBar}>
        {openFiles.map((f) => {
          const name = f.split(/[\\/]/).pop() ?? f;
          // Editor tab = row container + inline close affordance. Two nested
          // <button>s would be invalid HTML, so the outer is a tab-role div
          // with keyboard activation; the inner × is a real button.
          return (
            <div
              key={f}
              className={appStyles.editorTab}
              role="tab"
              tabIndex={0}
              aria-selected={f === activeFile}
              data-active={f === activeFile}
              onClick={() => setActiveFile(f)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveFile(f);
                }
              }}
            >
              {name}
              <button
                type="button"
                className={appStyles.editorTabClose}
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseFile(f);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className={appStyles.editorLoading}>Loading editor...</div>}>
          <EditorPanel
            filePath={activeFile}
            onClose={() => {
              if (activeFile) void handleCloseFile(activeFile);
            }}
            projectPath={projectPath}
            initialLine={editorLine}
            initialDiffMode={openInDiff}
            onStartAgent={handleStartAgent}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  ) : null;

  return (
    /* MotionConfig reducedMotion="user" tells every motion.* child in the
     * tree to honor the OS prefers-reduced-motion setting. CSS already
     * zeroes transition-duration and transform on :hover under that
     * query — this adds the missing JS-side respect for Framer-driven
     * springs across CommandPalette/WelcomeScreen/SearchPanel/PRInspector/
     * WebInspector/OnboardingOverlay. */
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <ToastProvider>
          <div className="app-container" data-density={workspaceProfile.visualDensity}>
            <UpdateBanner />
            <ProjectHeaderBar
              projectName={projectName}
              branch={branch}
              changedCount={changedFiles.length}
              status={headerStatus as "idle" | "edit" | "thinking" | "error" | "waiting" | "done"}
              activeAgent={activeAgent ? { model: activeAgent.model, cost: activeAgent.cost } : null}
              onOpenSettings={() => setSettingsVisible(true)}
              onRefresh={handleRefresh}
              menus={menus}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            />

            <main className="app-main">
              <nav
                className={`left-panel${sidebarCollapsed ? " left-panel-collapsed" : ""}`}
                aria-label="Project sidebar"
                data-collapsed={sidebarCollapsed}
                style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
              >
                <CollapsibleSection storageKey="files" title="Files" defaultOpen>
                  <ErrorBoundary>
                    <FileTree
                      key={fileTreeKey}
                      rootPath={projectPath}
                      onFileSelect={handleFileSelect}
                      onOpenDiff={handleOpenDiff}
                      changedFiles={changedFiles}
                    />
                  </ErrorBoundary>
                </CollapsibleSection>
                <CollapsibleSection storageKey="tasks" title="Tasks" defaultOpen={false}>
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <KanbanBoard
                        onStartAgent={handleStartAgent}
                        projectPath={projectPath}
                        agentStatuses={agentStatuses}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </CollapsibleSection>
                <CollapsibleSection storageKey="source-control" title="Source Control" defaultOpen={false}>
                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <SCMPanel projectPath={projectPath} onOpenFile={handleFileSelect} onOpenDiff={handleOpenDiff} />
                    </Suspense>
                  </ErrorBoundary>
                </CollapsibleSection>
                {searchVisible && (
                  <Suspense fallback={null}>
                    <ErrorBoundary>
                      <SearchPanel
                        visible
                        rootPath={projectPath}
                        onClose={() => setSearchVisible(false)}
                        onResultClick={(file, line) => {
                          handleFileSelect(file);
                          setEditorLine(line);
                        }}
                      />
                    </ErrorBoundary>
                  </Suspense>
                )}
                <hr
                  className="left-panel-resize-handle"
                  aria-orientation="vertical"
                  aria-label="Resize sidebar"
                  aria-valuemin={200}
                  aria-valuemax={480}
                  aria-valuenow={sidebarWidth}
                  tabIndex={0}
                  onPointerDown={(e) => {
                    // Drag-to-resize. We capture the pointer on the handle so
                    // the move events keep coming even if the cursor leaves
                    // the handle's bounds (large drags).
                    const startX = e.clientX;
                    const startWidth = sidebarWidth;
                    const handleEl = e.currentTarget;
                    handleEl.setPointerCapture(e.pointerId);
                    document.body.style.cursor = "col-resize";
                    const onMove = (ev: PointerEvent) => {
                      setSidebarWidth(startWidth + (ev.clientX - startX));
                    };
                    const onUp = () => {
                      document.body.style.cursor = "";
                      handleEl.releasePointerCapture(e.pointerId);
                      handleEl.removeEventListener("pointermove", onMove);
                      handleEl.removeEventListener("pointerup", onUp);
                    };
                    handleEl.addEventListener("pointermove", onMove);
                    handleEl.addEventListener("pointerup", onUp);
                  }}
                  onKeyDown={(e) => {
                    // Keyboard accessibility — Arrow keys nudge the
                    // sidebar by 16 px, Shift+Arrow by 64 px.
                    const step = e.shiftKey ? 64 : 16;
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      setSidebarWidth(sidebarWidth - step);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      setSidebarWidth(sidebarWidth + step);
                    }
                  }}
                />
              </nav>

              <section className="center-panel" aria-label="Terminal and editor">
                {editorArea ? (
                  <SplitPane direction="vertical" defaultRatio={0.5} first={editorArea} second={terminalSurface} />
                ) : (
                  terminalSurface
                )}
              </section>

              <aside
                className="right-panel"
                aria-label="Agent inspector"
                /* `flex-basis` (not `width`) is what flex layout reads as
                 * the preferred size. Setting only `width` left the
                 * computed width at the CSS default (320 px) on Chromium
                 * even with `flex-shrink: 0`, because `flex-basis: auto`
                 * resolved against the *original* declared width rather
                 * than re-resolving on inline-style change. Driving
                 * basis directly is the canonical fix and matches how
                 * VS Code / Linear size their resizable side panels. */
                style={{ flexBasis: `${rightPanelWidth}px`, width: `${rightPanelWidth}px` }}
              >
                <hr
                  className="right-panel-resize-handle"
                  aria-orientation="vertical"
                  aria-label="Resize agent inspector panel"
                  aria-valuemin={260}
                  aria-valuemax={480}
                  aria-valuenow={rightPanelWidth}
                  tabIndex={0}
                  onPointerDown={(e) => {
                    // Mirror of the left-panel handle. Handle lives on the
                    // panel's LEFT edge, so dragging *left* (negative dx)
                    // makes the panel WIDER — invert the sign vs. the
                    // sidebar handler.
                    const startX = e.clientX;
                    const startWidth = rightPanelWidth;
                    const handleEl = e.currentTarget;
                    handleEl.setPointerCapture(e.pointerId);
                    document.body.style.cursor = "col-resize";
                    const onMove = (ev: PointerEvent) => {
                      setRightPanelWidth(startWidth - (ev.clientX - startX));
                    };
                    const onUp = () => {
                      document.body.style.cursor = "";
                      handleEl.releasePointerCapture(e.pointerId);
                      handleEl.removeEventListener("pointermove", onMove);
                      handleEl.removeEventListener("pointerup", onUp);
                    };
                    handleEl.addEventListener("pointermove", onMove);
                    handleEl.addEventListener("pointerup", onUp);
                  }}
                  onKeyDown={(e) => {
                    // Inverted vs. left-panel: handle on LEFT edge, so
                    // ArrowLeft *grows* the panel toward the centre and
                    // ArrowRight shrinks it. Shift accelerates 16→64 px.
                    const step = e.shiftKey ? 64 : 16;
                    if (e.key === "ArrowLeft") {
                      e.preventDefault();
                      setRightPanelWidth(rightPanelWidth + step);
                    } else if (e.key === "ArrowRight") {
                      e.preventDefault();
                      setRightPanelWidth(rightPanelWidth - step);
                    }
                  }}
                />
                <div className="right-panel-content">
                  <div className="right-panel-mode-switch" role="tablist" aria-label="Right rail mode">
                    {RIGHT_RAIL_MODES.map((mode) => {
                      const Icon = mode.icon;
                      const badge = rightRailModeBadges[mode.id];
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          role="tab"
                          id={`right-rail-tab-${mode.id}`}
                          className="right-panel-mode-tab"
                          data-active={rightRailMode === mode.id}
                          data-has-badge={badge > 0 ? "true" : undefined}
                          data-right-rail-mode={mode.id}
                          aria-selected={rightRailMode === mode.id}
                          aria-controls="right-rail-panel"
                          aria-label={`${mode.label}: ${mode.description}`}
                          tabIndex={rightRailMode === mode.id ? 0 : -1}
                          title={`${mode.title}. ${mode.description}`}
                          onClick={() => setRightRailMode(mode.id)}
                          onKeyDown={handleRightRailModeKeyDown}
                        >
                          <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
                          <span>{mode.label}</span>
                          {badge > 0 && <span className="right-panel-mode-badge">{badge}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div id="right-rail-purpose" className={appStyles.rightRailPurpose}>
                    <span className={appStyles.rightRailPurposeKicker}>Project tools</span>
                    <span className={appStyles.rightRailPurposeText}>{activeRightRailMode.description}</span>
                  </div>

                  <section
                    className="right-panel-now"
                    data-tone={rightRailNowState.tone}
                    data-state={rightRailNowState.state}
                    aria-label={`Workspace state: ${rightRailNowState.label}`}
                  >
                    <span className="right-panel-now-kicker">Now</span>
                    <span className="right-panel-now-state">{rightRailNowState.label}</span>
                    <span className="right-panel-now-detail">{rightRailNowState.detail}</span>
                  </section>

                  {rightRailRecommendation && rightRailRecommendedMode && RightRailRecommendedIcon && (
                    <button
                      type="button"
                      className="right-panel-advisor"
                      data-tone={rightRailRecommendation.tone}
                      onClick={() => {
                        const matchingAction = rightRailActions.find(
                          (action) =>
                            action.mode === rightRailRecommendation.mode &&
                            action.label === rightRailRecommendation.label &&
                            action.detail === rightRailRecommendation.detail,
                        );
                        if (matchingAction) handleRightRailAction(matchingAction);
                        else setRightRailMode(rightRailRecommendation.mode);
                      }}
                      title={`Switch to ${rightRailRecommendedMode.label}: ${rightRailRecommendation.detail}`}
                    >
                      <span className="right-panel-advisor-kicker">Suggested</span>
                      <span className="right-panel-advisor-icon" aria-hidden="true">
                        <RightRailRecommendedIcon size={12} strokeWidth={1.8} />
                      </span>
                      <span className="right-panel-advisor-copy">
                        <span className="right-panel-advisor-label">{rightRailRecommendation.label}</span>
                        <span className="right-panel-advisor-detail">{rightRailRecommendation.detail}</span>
                      </span>
                      <span className="right-panel-advisor-target">{rightRailRecommendedMode.label}</span>
                    </button>
                  )}

                  {rightRailActions.length > 0 && (
                    <div className="right-panel-action-stack" aria-label="Ranked next actions">
                      {rightRailActions.slice(0, 4).map((action) => {
                        const mode = RIGHT_RAIL_MODES.find((candidate) => candidate.id === action.mode);
                        const ActionIcon = mode?.icon ?? Activity;
                        return (
                          <button
                            key={action.id}
                            type="button"
                            className="right-panel-action"
                            data-tone={action.tone}
                            data-state={action.state}
                            onClick={() => handleRightRailAction(action)}
                            title={`${action.label}: ${action.detail}`}
                          >
                            <span className="right-panel-action-icon" aria-hidden="true">
                              <ActionIcon size={12} strokeWidth={1.8} />
                            </span>
                            <span className="right-panel-action-copy">
                              <span className="right-panel-action-label">{action.label}</span>
                              <span className="right-panel-action-detail">{action.detail}</span>
                            </span>
                            <span className="right-panel-action-target">{mode?.label ?? action.mode}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <ErrorBoundary>
                    <Suspense fallback={null}>
                      <WorkstationPulse
                        sessions={rightRailSessions}
                        changedFilesCount={rightRailChangedFiles.length}
                        workstationGraph={focusedRightRailGraph}
                      />
                    </Suspense>
                  </ErrorBoundary>

                  <div
                    id="right-rail-panel"
                    ref={rightRailPanelRef}
                    className="right-panel-stack"
                    data-mode={rightRailMode}
                    role="tabpanel"
                    aria-labelledby={`right-rail-tab-${rightRailMode}`}
                    aria-describedby="right-rail-purpose"
                  >
                    {rightRailMode === "command" && (
                      <>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="decision-inbox">
                              <DecisionInboxPanel
                                sessions={rightRailSessions}
                                auditEvents={scopedOperationalAuditEvents}
                                workflows={workflowStatuses}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
                              <AgentInspector
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                onStartAgent={handleStartAgent}
                                onStopAgent={stopAgent}
                                onCreateWorktree={createWorktree}
                                onRemoveWorktree={removeWorktree}
                                onRenameSession={renameSession}
                                interactiveSessions={interactiveSessions}
                                onFocusInteractiveSession={handleFocusInteractiveSession}
                                onStopInteractiveSession={stopInteractiveSession}
                                onEndSessionAndRemoveWorktree={endSessionAndRemoveWorktree}
                                onStartInteractiveSession={handleStartInteractiveSession}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="workflow">
                              <WorkflowPanel
                                projectPath={projectPath}
                                sessions={rightRailSessions}
                                onStartAgent={handleStartAgent}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <div className="right-panel-bottom-grid">
                          <ErrorBoundary>
                            <Suspense fallback={null}>
                              <div className="bento-widget" data-widget="toolkit">
                                <ToolkitPanel
                                  projectName={projectName}
                                  onRunCommand={handleRunCommand}
                                  activeTargetLabel={activeTerminalTarget.label}
                                  activeTargetReady={activeTerminalTarget.ready}
                                />
                              </div>
                            </Suspense>
                          </ErrorBoundary>
                          <ErrorBoundary>
                            <Suspense fallback={null}>
                              <div className="bento-widget" data-widget="context">
                                <ContextPanel
                                  sessions={rightRailSessions}
                                  activeSessionId={rightRailActiveSessionId}
                                  changedFilesCount={rightRailChangedFiles.length}
                                  changedFiles={rightRailChangedFiles}
                                  panes={visualTerminalPaneTargets}
                                  auditEvents={scopedOperationalAuditEvents}
                                  projectName={projectName}
                                  projectPath={projectPath}
                                  branch={branch}
                                  workstationGraph={focusedRightRailGraph}
                                />
                              </div>
                            </Suspense>
                          </ErrorBoundary>
                        </div>
                      </>
                    )}

                    {rightRailMode === "review" && (
                      <>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="review-queue">
                              <ReviewQueuePanel
                                sessions={rightRailSessions}
                                changedFiles={rightRailChangedFiles}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                onOpenDiff={handleOpenDiff}
                                onStartAgent={handleStartAgent}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
                              <AgentInspector
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                onStartAgent={handleStartAgent}
                                onStopAgent={stopAgent}
                                onCreateWorktree={createWorktree}
                                onRemoveWorktree={removeWorktree}
                                onRenameSession={renameSession}
                                interactiveSessions={interactiveSessions}
                                onFocusInteractiveSession={handleFocusInteractiveSession}
                                onStopInteractiveSession={stopInteractiveSession}
                                onEndSessionAndRemoveWorktree={endSessionAndRemoveWorktree}
                                onStartInteractiveSession={handleStartInteractiveSession}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="scm">
                              <SCMPanel
                                projectPath={projectPath}
                                onOpenFile={handleFileSelect}
                                onOpenDiff={handleOpenDiff}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="context">
                              <ContextPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                changedFilesCount={rightRailChangedFiles.length}
                                changedFiles={rightRailChangedFiles}
                                panes={visualTerminalPaneTargets}
                                auditEvents={scopedOperationalAuditEvents}
                                projectName={projectName}
                                projectPath={projectPath}
                                branch={branch}
                                density="compact"
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                      </>
                    )}

                    {rightRailMode === "observe" && (
                      <>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="processes">
                              <ProcessManagerPanel
                                panes={visualTerminalPaneTargets}
                                activeTerminalId={visualActivePtyId}
                                highlightedPaneId={selectedOperationalPane?.paneId ?? null}
                                highlightedTerminalId={selectedOperationalPane?.terminalId ?? null}
                                onFocusPane={handleFocusOperationalPane}
                                onClosePane={handlePaneClose}
                                onRestartPane={handlePaneRestart}
                                onAttachProcess={handlePaneAttach}
                                onProcessEnded={(terminalId) => {
                                  setSelectedOperationalPane((selected) =>
                                    clearEndedOperationalTerminal(selected, terminalId),
                                  );
                                  setTabActivePtyIds((prev) => {
                                    let changed = false;
                                    const next = { ...prev };
                                    for (const [tabId, ptyId] of Object.entries(next)) {
                                      if (ptyId === terminalId) {
                                        next[tabId] = null;
                                        changed = true;
                                      }
                                    }
                                    return changed ? next : prev;
                                  });
                                }}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="live-panes">
                              <LivePanesPanel
                                panes={visualTerminalPaneTargets}
                                highlightedPaneId={selectedOperationalPane?.paneId ?? null}
                                highlightedTerminalId={selectedOperationalPane?.terminalId ?? null}
                                onFocusPane={handleFocusOperationalPane}
                                onAttachPane={handlePaneAttach}
                                onSelectPane={selectOperationalPane}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="audit-timeline">
                              <AuditTimelinePanel
                                auditEvents={scopedOperationalAuditEvents}
                                auditError={visualAuditEvents === undefined ? auditStream.error : null}
                                auditReady={visualAuditEvents === undefined ? auditStream.ready : true}
                                panes={visualTerminalPaneTargets}
                                selectedEventId={selectedAuditEventId}
                                traceFilter={selectedAuditTraceFilter}
                                workstationGraph={focusedRightRailGraph}
                                onFocusPane={handleFocusOperationalPane}
                                onRestartPane={handlePaneRestart}
                                onSelectEvent={handleSelectAuditEvent}
                                onTraceFilterChange={setSelectedAuditTraceFilter}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="context">
                              <ContextPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                changedFilesCount={rightRailChangedFiles.length}
                                changedFiles={rightRailChangedFiles}
                                panes={visualTerminalPaneTargets}
                                auditEvents={scopedOperationalAuditEvents}
                                projectName={projectName}
                                projectPath={projectPath}
                                branch={branch}
                                density="compact"
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="run-graph">
                              <RunGraphPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="tool-ledger">
                              <ToolLedgerPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
                              <AgentInspector
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                onStartAgent={handleStartAgent}
                                onStopAgent={stopAgent}
                                onCreateWorktree={createWorktree}
                                onRemoveWorktree={removeWorktree}
                                onRenameSession={renameSession}
                                interactiveSessions={interactiveSessions}
                                onFocusInteractiveSession={handleFocusInteractiveSession}
                                onStopInteractiveSession={stopInteractiveSession}
                                onEndSessionAndRemoveWorktree={endSessionAndRemoveWorktree}
                                onStartInteractiveSession={handleStartInteractiveSession}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="reliability">
                              <ReliabilityPanel
                                sessions={rightRailSessions}
                                panes={visualTerminalPaneTargets}
                                changedFilesCount={rightRailChangedFiles.length}
                                auditEvents={scopedOperationalAuditEvents}
                                workstationGraph={focusedRightRailGraph}
                                selectedEventId={selectedAuditEventId}
                                onFocusPane={handleFocusOperationalPane}
                                onRestartPane={handlePaneRestart}
                                onSelectIncident={handleSelectReliabilityIncident}
                                onTraceIncident={handleTraceReliabilityIncident}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        {devVisualQa.diagnosticsEnabled && (
                          <ErrorBoundary>
                            <Suspense fallback={null}>
                              <div className="bento-widget" data-widget="logs">
                                <LogsPanel defaultCollapsed />
                              </div>
                            </Suspense>
                          </ErrorBoundary>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </aside>
            </main>

            <WorkspaceTabs
              tabs={tabs}
              activeTabId={activeTabId}
              activityTabs={activityTabs}
              onSelectTab={(id) => {
                if (interactiveSessionId) selectInteractiveSession("");
                void handleTabSwitch(id);
              }}
              onCloseTab={handleCloseTab}
              onNewTab={addTab}
              onReorderTab={reorderTab}
              interactiveSessions={interactiveSessions}
              activeInteractiveId={interactiveSessionId}
              onSelectInteractive={handleFocusInteractiveSession}
              onCloseInteractive={stopInteractiveSession}
            />

            <StatusBar
              shell={activeTab.shell}
              branch={branch}
              changedCount={changedFiles.length}
              agentStatus={activeAgent ? `${activeAgent.model} · $${activeAgent.cost.toFixed(2)}` : undefined}
              terminalId={activePtyId}
              paneCount={visualTerminalPaneTargets.length}
              rightRailMode={rightRailMode}
              rightRailWidth={rightPanelWidth}
            />

            {paletteVisible && (
              <LazyDialog>
                <CommandPalette visible onClose={() => setPaletteVisible(false)} commands={commands} />
              </LazyDialog>
            )}
            {settingsVisible && (
              <LazyDialog>
                <Settings visible onClose={() => setSettingsVisible(false)} />
              </LazyDialog>
            )}
            {watchdogVisible && (
              <LazyDialog>
                <WatchdogDialog visible onClose={() => setWatchdogVisible(false)} />
              </LazyDialog>
            )}
            {aboutVisible && (
              <LazyDialog>
                <AboutDialog visible onClose={() => setAboutVisible(false)} />
              </LazyDialog>
            )}
            {helpVisible && (
              <LazyDialog>
                <HelpDialog visible onClose={() => setHelpVisible(false)} />
              </LazyDialog>
            )}
            {webInspectorVisible && (
              <LazyDialog>
                <WebInspector visible onClose={() => setWebInspectorVisible(false)} />
              </LazyDialog>
            )}
            {prInspectorVisible && (
              <LazyDialog>
                <PRInspector
                  visible
                  projectPath={projectPath}
                  onClose={() => setPrInspectorVisible(false)}
                  onStartReview={handleStartAgent}
                />
              </LazyDialog>
            )}
            {quickOpenMode && (
              <LazyDialog>
                <QuickOpen
                  projectPath={projectPath}
                  openFiles={openFiles}
                  onSelectFile={handleFileSelect}
                  onClose={() => setQuickOpenMode(null)}
                  initialMode={quickOpenMode}
                />
              </LazyDialog>
            )}
            {paneSwitcherVisible && (
              <LazyDialog>
                <PaneSwitcherDialog
                  visible
                  panes={visualTerminalPaneTargets}
                  activeTabId={activeTabId}
                  activeTerminalId={visualActivePtyId}
                  onFocusPane={handleFocusOperationalPane}
                  onRestartPane={handlePaneRestart}
                  onClosePane={handlePaneClose}
                  onRenamePane={handlePaneRename}
                  onCyclePaneRole={handlePaneRoleCycle}
                  onClose={() => setPaneSwitcherVisible(false)}
                />
              </LazyDialog>
            )}
            <PromptDialog />
            <ConfirmDialog />
            <HandoffDialog />
            <OrchestraDialog />
            <HistorySearchDialog onAccept={handleHistoryAccept} defaultCwdPrefix={projectPath || undefined} />
            <OnboardingOverlay />
          </div>
        </ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}

function paneRegistryEqual(a: PaneSwitcherEntry[], b: PaneSwitcherEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return (
      !!right &&
      left.paneId === right.paneId &&
      left.terminalId === right.terminalId &&
      left.lifecycle === right.lifecycle &&
      left.index === right.index &&
      left.shell === right.shell &&
      left.cwd === right.cwd &&
      left.title === right.title &&
      left.role === right.role &&
      left.label === right.label &&
      left.route === right.route
    );
  });
}

function findActivePaneIndex(
  panes: readonly TerminalPaneTarget[],
  activeTabId: string,
  activeTerminalId: string | null,
): number {
  if (activeTerminalId) {
    const ptyIndex = panes.findIndex((pane) => pane.terminalId === activeTerminalId);
    if (ptyIndex >= 0) return ptyIndex;
  }
  return panes.findIndex((pane) => pane.tabId === activeTabId);
}
