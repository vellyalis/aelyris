import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
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
  Users,
} from "lucide-react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
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
  PaneAgentSpawnRequest,
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
  type AiCliLaunchPreflightEvidence,
  type AiCliLaunchPromptContract,
  type AiCliProbeEvidence,
  deriveAiCliLaunchPlan,
} from "./shared/lib/aiCliLaunchPlanner";
import { PRODUCT_NAME } from "./shared/constants/product";
import { getAuditCorrelationId } from "./shared/lib/auditRecovery";
import {
  commandHistoryRecordsToCommandBlocks,
  type NativeCommandBlockRecord,
  nativeCommandBlockRecordsToCommandBlocks,
} from "./shared/lib/commandHistoryGraph";
import { buildContextPack } from "./shared/lib/contextPack";
import {
  clearEndedOperationalTerminal,
  type OperationalPaneSelection,
  reconcileOperationalPaneSelection,
} from "./shared/lib/operationalPaneSelection";
import { TERMINAL_COMMAND_EVIDENCE_EVENT } from "./shared/lib/terminalEvidence";
import { filterWorkspaceScopedEvents } from "./shared/lib/workspaceProfile";
import {
  buildWorkstationGraph,
  type FileProvenanceTrace,
  filterWorkstationGraph,
  listWorkstationGraphChangedFiles,
  type WorkstationGraphCommandBlock,
} from "./shared/lib/workstationGraph";
import type { AuditEventRecord, AuditJournalEventRecord } from "./shared/types/audit";
import type { CommandHistoryRecord } from "./shared/types/history";

// Right-panel + secondary UIs: lazy-loaded so they do not block first paint.
const KanbanBoard = lazy(() => import("./features/kanban/KanbanBoard").then((m) => ({ default: m.KanbanBoard })));
const AgentInspector = lazy(() =>
  import("./features/agent-inspector/AgentInspector").then((m) => ({ default: m.AgentInspector })),
);
const OrchestratorPanel = lazy(() =>
  import("./features/orchestrator/OrchestratorPanel").then((m) => ({ default: m.OrchestratorPanel })),
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
const FleetHud = lazy(() => import("./features/fleet-hud/FleetHud").then((m) => ({ default: m.FleetHud })));
const OnboardingOverlay = lazy(() =>
  import("./shared/ui/OnboardingOverlay").then((m) => ({ default: m.OnboardingOverlay })),
);

import { HistorySearchDialog, showHistorySearch } from "./features/history/HistorySearchDialog";
import { type StartAgentMeta, useAgentFleet } from "./shared/hooks/useAgentFleet";
import { useAuditEvents } from "./shared/hooks/useAuditEvents";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useKeyboardShortcuts } from "./shared/hooks/useKeyboardShortcuts";
import { useTabManager, VISUAL_QA_FALLBACK_PROJECT_PATH } from "./shared/hooks/useTabManager";
import { useTaskAgentLink } from "./shared/hooks/useTaskAgentLink";
import { useAgentFleetToasts } from "./shared/hooks/useAgentFleetToasts";
import { useTerminalNotifications } from "./shared/hooks/useTerminalNotifications";
import { useThemeApplier } from "./shared/hooks/useTheme";
import { useWorktreeActions } from "./shared/hooks/useWorktreeActions";
import { type AgentFleetSession, headlessToFleetSession } from "./shared/lib/agentFleet";
import { summarizeAgentLane } from "./shared/lib/agentLaneSummary";
import {
  type AuthenticatedPromptConsentPacket,
  deriveAuthenticatedPromptConsentPacket,
  parseAuthenticatedPromptConsentReport,
  parseAuthenticatedPromptPreflightMatrixReport,
} from "./shared/lib/authenticatedPromptConsent";
import { markFirstPaint } from "./shared/lib/bootMetrics";
import { buildDecisionInbox, type DecisionWorkflowStatus } from "./shared/lib/decisionInbox";
import {
  EDITOR_OPEN_MODE_CHANGE_EVENT,
  EDITOR_OPEN_MODE_STORAGE_KEY,
  type EditorOpenMode,
  loadEditorOpenMode,
  openGitDiffInVSCode,
  openInVSCode,
} from "./shared/lib/externalEditor";
import {
  FALLBACK_TELEMETRY_EVENT,
  type FallbackTelemetryDetail,
  formatFallbackError,
  reportInvokeFailure,
} from "./shared/lib/fallbackTelemetry";
import { allowedToolsForGuardrailProfile, describeGuardrailProfile } from "./shared/lib/guardrailPolicy";
import { writeClipboardText as writeNativeClipboardText } from "./shared/lib/nativeClipboard";
import {
  launchOrchestraPrompts,
  type OrchestraRoutingDecision,
  routeOrchestraPrompts,
} from "./shared/lib/orchestraDispatch";
import { buildOrchestraPrompts, ORCHESTRA_ROLES, type OwnershipPromptSection } from "./shared/lib/orchestrator";
import {
  deriveFinalGoalRequirementProofs,
  deriveFinalGoalResidualRisk,
  deriveFinalGoalSafeGate,
  deriveReleaseQualityGoalInputs,
  type FinalGoalRequirementProof,
  type FinalGoalResidualRisk,
  type FinalGoalSafeGate,
  parseFinalGoalAuditReport,
  parseFinalGoalSafeSummaryReport,
  parseReleaseQualityReport,
  type ReleaseQualityGoalInputs,
} from "./shared/lib/releaseQuality";
import type { GitChangedFile } from "./shared/lib/reviewQueue";
import {
  buildRightRailActionAuditPayload,
  deriveRightRailActions,
  deriveRightRailNowState,
  deriveRightRailRecommendation,
  type RightRailAction,
  type RightRailMode,
} from "./shared/lib/rightRailAdvisor";
import { deriveRightRailGoalTrack } from "./shared/lib/rightRailGoalTrack";
import {
  deriveRightRailWorkforceSummary,
  WORKFORCE_GUARDRAIL_PROFILES,
  type WorkforceGuardrailProfile,
} from "./shared/lib/rightRailWorkforce";
import { classifyCommand, formatCommandRiskSummary } from "./shared/lib/shellSafety";
import { isTauriRuntime } from "./shared/lib/tauriRuntime";
import {
  sanitizeDefaultShell,
  sanitizeTerminalCursorStyle,
  sanitizeWindowEffect,
  useAppStore,
  type WallpaperSettings,
} from "./shared/store/appStore";
import { toast } from "./shared/store/toastStore";
import type { AccentOverrides } from "./shared/themes/catppuccin";
import { type MoodMaterialOverrides, type MoodPresetId, normalizeMoodPreset } from "./shared/themes/moods";
import type { AgentSession } from "./shared/types/agent";
import type { SearchHit } from "./shared/types/history";
import { SHELL_LABELS, type ShellType, type TerminalPaneTarget } from "./shared/types/terminalPane";
import { CollapsibleSection } from "./shared/ui/CollapsibleSection";
import { ConfirmDialog, showConfirm } from "./shared/ui/ConfirmDialog";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { HandoffDialog } from "./shared/ui/HandoffDialog";
import { LazyDialog } from "./shared/ui/LazyDialog";
import { OrchestraDialog, showOrchestra } from "./shared/ui/OrchestraDialog";
import { PromptDialog } from "./shared/ui/PromptDialog";
import { SplitPane } from "./shared/ui/SplitPane";
import { ToastProvider } from "./shared/ui/Toast";
import { TooltipProvider } from "./shared/ui/Tooltip";

interface ActiveTerminalTarget {
  terminalId: string | null;
  tabId: string;
  shell: ShellType;
  label: string;
  ready: boolean;
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

type RightRailActionResultTone = "success" | "warn" | "error";
type RightRailGuardrailSelection = "Auto" | WorkforceGuardrailProfile;

type BootstrapAppConfig = {
  appearance: {
    theme: string;
    mood_preset?: string;
    opacity?: number;
    ui_font_family?: string;
    terminal_font_family?: string;
    font_size?: number;
    terminal_text_clarity?: "glass" | "balanced" | "solid";
    terminal_surface_opacity?: number;
    line_height?: number;
    ligatures?: boolean;
    window_effect?: string;
    theme_overrides?: Record<string, AccentOverrides>;
    mood_material_overrides?: Partial<Record<MoodPresetId, MoodMaterialOverrides>>;
    wallpaper_settings_by_mood?: Partial<Record<MoodPresetId, Partial<WallpaperSettings>>>;
  };
  terminal?: {
    default_shell?: string;
    cursor_style?: string;
    cursor_blink?: boolean;
  };
  ghost_diff?: {
    live_mode?: boolean;
  };
  workspace_profile?: {
    global_defaults?: {
      pane_layout?: {
        right_rail_guardrail_profile?: RightRailGuardrailSelection;
        right_rail_widgets?: Partial<Record<RightRailWidgetId, boolean>>;
      };
    };
  };
};

interface RightRailActionResult {
  id: string;
  label: string;
  detail: string;
  tone: RightRailActionResultTone;
  timestamp: number;
  auditEventId: number | null;
  auditCorrelationId: string | null;
  auditKind: string | null;
  auditTimestamp: string | null;
  routeWidget: RightRailWidgetId | null;
  routeLabel: string | null;
  routeDetail: string | null;
}

interface RightRailAiCliLaunchEvidenceState {
  evidence: AiCliProbeEvidence | null;
  preflight: AiCliLaunchPreflightEvidence | null;
}

interface RightRailRouteConfirmation {
  widget: RightRailWidgetId;
  title: string;
  detail: string;
  createdAt: number;
}

interface RightRailEdgeScoreItem {
  id: "decision" | "evidence" | "recovery" | "live";
  label: string;
  score: number;
  max: number;
  status: "pass" | "watch" | "gap";
  detail: string;
  actionLabel: string;
  routeMode: RightRailMode;
  focusWidget: string;
  routeTitle: string;
  routeDetail: string;
  promptTitle: string;
  promptDetail: string;
}

interface RightRailEdgeScore {
  score: number;
  grade: "S" | "A" | "B" | "C" | "D";
  tone: "strong" | "watch" | "gap";
  label: string;
  detail: string;
  items: RightRailEdgeScoreItem[];
}

interface RightRailDestinationPrompt {
  widget: string;
  axisLabel: string;
  title: string;
  detail: string;
  actionLabel: string;
  item: RightRailEdgeScoreItem;
  edgeScore: number;
  edgeGrade: RightRailEdgeScore["grade"];
  fromMode: RightRailMode;
  createdAt: number;
  reachedAt?: number;
}

interface RightRailEdgeScoreFeedbackEntry {
  id: string;
  axisId: string;
  axisLabel: string;
  actionLabel: string;
  targetWidget: string;
  score: number;
  grade: RightRailEdgeScore["grade"];
  previousScore: number | null;
  delta: number;
  trend: "baseline" | "improved" | "flat" | "regressed";
  createdAt: number;
}

interface RightRailEdgeFeedbackAxisSummary {
  axisId: string;
  axisLabel: string;
  count: number;
  trend: RightRailEdgeScoreFeedbackEntry["trend"];
}

interface RightRailEdgeFeedbackStaleGroup {
  axisId: string;
  axisLabel: string;
  count: number;
  score: number;
  grade: RightRailEdgeScore["grade"];
  staleReason: string;
}

interface RightRailEdgeNextBestAction {
  item: RightRailEdgeScoreItem;
  reason: "repeated-axis" | "weakest-axis";
}

interface RightRailEdgeRecommendationOutcome {
  status: "reached" | "replayed" | "stale";
  label: string;
  detail: string;
}

interface RightRailEdgeFeedbackResetNotice {
  createdAt: number;
  label: string;
  detail: string;
}

const RIGHT_RAIL_ACTION_HISTORY_LIMIT = 5;
const RIGHT_RAIL_EDGE_FEEDBACK_LIMIT = 4;
const RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX = "aelyris:right-rail-edge-feedback:";
const RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY = "aelyrisRightRailEdgeFeedback";
const RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM = "edgeLoop";
const RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID = "right-panel-edge-feedback-list";
const RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID = "right-panel-edge-feedback-stale-count-description";
const RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS: readonly RightRailEdgeScoreItem["id"][] = [
  "decision",
  "evidence",
  "recovery",
  "live",
];
const RIGHT_RAIL_EDGE_FEEDBACK_AXIS_LABELS: Record<RightRailEdgeScoreItem["id"], string> = {
  decision: "Decision",
  evidence: "Evidence",
  recovery: "Recovery",
  live: "Live",
};
const RIGHT_RAIL_EDGE_FEEDBACK_ACTION_LABELS = new Set([
  "Open inbox",
  "Inspect inbox",
  "Open review",
  "Open audit",
  "Open risks",
  "Open recovery",
  "Watch live",
  "Open processes",
]);
const RIGHT_RAIL_EDGE_FEEDBACK_TARGET_WIDGETS = new Set([
  "decision-inbox",
  "review-queue",
  "audit-timeline",
  "reliability",
  "live-panes",
  "processes",
]);
const RIGHT_RAIL_GUARDRAIL_OPTIONS: readonly RightRailGuardrailSelection[] = ["Auto", ...WORKFORCE_GUARDRAIL_PROFILES];
const RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY = "aelyris:right-rail-guardrail-selection";
const RIGHT_RAIL_GUARDRAIL_SYNC_EVENT = "aelyris:right-rail-guardrail-sync";
const RIGHT_RAIL_WIDGET_STORAGE_PREFIX = "aelyris:right-rail-widget:";
const RIGHT_RAIL_WIDGET_SYNC_EVENT = "aelyris:right-rail-widget-sync";

type RightRailWidgetId =
  | "decision-inbox"
  | "sessions"
  | "orchestrator"
  | "workflow"
  | "toolkit"
  | "context"
  | "audit-timeline"
  | "run-graph"
  | "tool-ledger"
  | "logs";
const RIGHT_RAIL_WIDGET_IDS: readonly RightRailWidgetId[] = [
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

interface RightRailWidgetFrameProps {
  widget: RightRailWidgetId;
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  focusConfirmation?: Pick<RightRailRouteConfirmation, "title" | "detail"> | null;
  children: ReactNode;
}

function isRightRailGuardrailSelection(value: string | null): value is RightRailGuardrailSelection {
  return value === "Auto" || WORKFORCE_GUARDRAIL_PROFILES.includes(value as WorkforceGuardrailProfile);
}

function loadRightRailGuardrailSelection(): RightRailGuardrailSelection {
  if (typeof window === "undefined") return "Auto";
  try {
    const saved = window.localStorage.getItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY);
    return isRightRailGuardrailSelection(saved) ? saved : "Auto";
  } catch {
    return "Auto";
  }
}

function saveRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection);
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
  void saveRightRailGuardrailSelectionToNativeConfig(selection);
}

function applyRightRailGuardrailSelection(selection: RightRailGuardrailSelection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY, selection);
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, { detail: { selection } }));
}

function hydrateRightRailGuardrailSelectionFromConfig(selection: unknown): void {
  if (typeof selection !== "string") return;
  if (isRightRailGuardrailSelection(selection)) applyRightRailGuardrailSelection(selection);
}

async function saveRightRailGuardrailSelectionToNativeConfig(selection: RightRailGuardrailSelection): Promise<void> {
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

function isRightRailWidgetId(value: string): value is RightRailWidgetId {
  return RIGHT_RAIL_WIDGET_IDS.includes(value as RightRailWidgetId);
}

function writeRightRailWidgetOpenToStorage(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`, open ? "1" : "0");
  } catch {
    /* localStorage may be unavailable in hardened webviews. */
  }
}

function applyRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } }));
}

function loadRightRailWidgetOpen(widget: RightRailWidgetId, defaultOpen: boolean): boolean {
  if (typeof window === "undefined") return defaultOpen;
  try {
    const saved = window.localStorage.getItem(`${RIGHT_RAIL_WIDGET_STORAGE_PREFIX}${widget}`);
    return saved == null ? defaultOpen : saved === "1";
  } catch {
    return defaultOpen;
  }
}

function hydrateRightRailWidgetOpenFromConfig(
  widgets: Partial<Record<RightRailWidgetId, boolean>> | null | undefined,
): void {
  if (!widgets || typeof window === "undefined") return;
  for (const [widget, open] of Object.entries(widgets)) {
    if (isRightRailWidgetId(widget) && typeof open === "boolean") {
      applyRightRailWidgetOpen(widget, open);
    }
  }
}

async function saveRightRailWidgetOpenToNativeConfig(widget: RightRailWidgetId, open: boolean): Promise<void> {
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

function saveRightRailWidgetOpen(widget: RightRailWidgetId, open: boolean): void {
  if (typeof window === "undefined") return;
  writeRightRailWidgetOpenToStorage(widget, open);
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(RIGHT_RAIL_WIDGET_SYNC_EVENT, { detail: { widget, open } }));
  }, 0);
  void saveRightRailWidgetOpenToNativeConfig(widget, open);
}

function RightRailWidgetFrame({
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

interface DevVisualQaState {
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

function formatTerminalTarget(shell: ShellType, terminalId: string | null): string {
  const shellLabel = SHELL_LABELS[shell] ?? shell;
  if (!terminalId) return `${shellLabel} · starting`;
  return `${shellLabel} · ${terminalId.slice(0, 8)}`;
}

function readDevVisualQaState(): DevVisualQaState {
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

function isExplicitDevVisualQaRequest(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("aelyrisVisualQa") === "1" || params.get("visualQa") === "1";
  } catch {
    return false;
  }
}

function shouldMirrorRightRailEdgeFeedbackHistoryUrl(): boolean {
  if (!isExplicitDevVisualQaRequest()) return false;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.has(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM);
  } catch {
    return false;
  }
}

function createDevVisualQaNegativePathAction(negativePath: DevVisualQaState["negativePath"]): RightRailAction | null {
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

function createDevVisualQaSessions(
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

function createDevVisualQaCommandBlocks(
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

const RIGHT_RAIL_ACTION_WIDGET: Partial<Record<RightRailAction["id"], string>> = {
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

const RIGHT_RAIL_ACTION_PHASE: Record<RightRailAction["id"], string> = {
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

type ProductModeId = "terminal" | "agents" | "workspace" | "review" | "git" | "context" | "history" | "settings";

const PRODUCT_MODE_RAIL: Array<{
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

const PRODUCT_MODE_ROUTES: Record<
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

const PRODUCT_MODE_INSPECTOR_SUMMARY: Record<
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

function compactRightRailOwnerId(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(-4)}`;
}

function formatRightRailPathOwner(path: string | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function formatRightRailActionOwner(action: RightRailAction): string {
  if (action.targetSessionId) return `Session ${compactRightRailOwnerId(action.targetSessionId)}`;
  if (action.targetPaneRole) return `Pane ${action.targetPaneRole}`;
  if (action.targetFilePath) return `File ${formatRightRailPathOwner(action.targetFilePath)}`;
  if (action.target.role) return `Role ${action.target.role}`;
  if (action.target.widget) return `Widget ${action.target.widget}`;
  return `${action.target.kind} ${action.target.label}`;
}

function formatInspectorProof(evidence: string | undefined, fallback: string): string {
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

async function appendRightRailActionAudit(
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

async function appendRightRailActionOutcomeAudit(
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

async function appendRightRailEdgeScoreInteractionAudit({
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

async function appendRightRailEdgeFeedbackStaleAudit({
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

function formatRightRailRecoveryDetail(action: RightRailAction, detail: string): string {
  const recovery = action.execution.recoveryStep;
  if (!recovery || detail.includes(recovery)) return detail;
  return `${detail} Recovery: ${recovery}`;
}

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rightRailWorkspaceStorageHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function rightRailEdgeFeedbackStorageKey(projectPath: string): string | null {
  const normalized = normalizeProjectPath(projectPath);
  if (!normalized) return null;
  return `${RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX}${rightRailWorkspaceStorageHash(normalized)}`;
}

function isRightRailEdgeFeedbackAxisId(value: unknown): value is RightRailEdgeScoreItem["id"] {
  return typeof value === "string" && RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS.includes(value as RightRailEdgeScoreItem["id"]);
}

function isSafeRightRailEdgeFeedbackAxisId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}

function sanitizeRightRailEdgeFeedbackAxisLabel(axisId: string, value: unknown): string {
  if (isRightRailEdgeFeedbackAxisId(axisId)) return RIGHT_RAIL_EDGE_FEEDBACK_AXIS_LABELS[axisId];
  if (typeof value !== "string") return "Legacy axis";
  const normalized = value
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
  return normalized.length > 0 ? normalized : "Legacy axis";
}

function isRightRailEdgeFeedbackTrend(value: unknown): value is RightRailEdgeScoreFeedbackEntry["trend"] {
  return value === "baseline" || value === "improved" || value === "flat" || value === "regressed";
}

function isRightRailEdgeFeedbackGrade(value: unknown): value is RightRailEdgeScore["grade"] {
  return value === "S" || value === "A" || value === "B" || value === "C" || value === "D";
}

function sanitizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeRightRailEdgeFeedbackEntry(value: unknown): RightRailEdgeScoreFeedbackEntry | null {
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

function sanitizeRightRailEdgeFeedbackHistory(history: unknown): RightRailEdgeScoreFeedbackEntry[] {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => sanitizeRightRailEdgeFeedbackEntry(entry))
    .filter((entry): entry is RightRailEdgeScoreFeedbackEntry => entry != null)
    .slice(0, RIGHT_RAIL_EDGE_FEEDBACK_LIMIT);
}

function readRightRailEdgeFeedbackHistoryState(key: string): RightRailEdgeScoreFeedbackEntry[] {
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

function readRightRailEdgeFeedbackHistoryUrl(key: string): RightRailEdgeScoreFeedbackEntry[] {
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

function writeRightRailEdgeFeedbackHistoryState(key: string, history: RightRailEdgeScoreFeedbackEntry[]): void {
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

function writeRightRailEdgeFeedbackHistoryUrl(key: string, history: RightRailEdgeScoreFeedbackEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM, JSON.stringify({ key, history }));
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* URL fallback is best-effort and still privacy-safe when unavailable */
  }
}

function clearRightRailEdgeFeedbackHistory(projectPath: string): void {
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

function loadRightRailEdgeFeedbackHistory(projectPath: string): RightRailEdgeScoreFeedbackEntry[] {
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

function saveRightRailEdgeFeedbackHistory(projectPath: string, history: RightRailEdgeScoreFeedbackEntry[]): void {
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

function resolveProjectFilePath(projectPath: string, path: string): string {
  const trimmed = path.trim();
  if (/^[a-z]:[\\/]/i.test(trimmed) || /^\\\\/.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  const root = projectPath.replace(/[\\/]+$/, "");
  return `${root}\\${trimmed.replace(/^[/\\]+/, "").replace(/\//g, "\\")}`;
}

function parseJsonArtifact<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function isRightRailQaFixtureRisk(value: string): boolean {
  return /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(value);
}

function copyTextToClipboard(text: string): Promise<void> {
  return writeNativeClipboardText(text, {
    source: "right-rail.clipboard",
    fallbackMessage: "Native clipboard write failed; using browser clipboard fallback for right rail copy.",
    userVisible: true,
  });
}

function createRightRailActionResult(
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

function createRightRailDestinationResult({
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

function rightRailModeForOutcomeWidget(widget: RightRailWidgetId): RightRailMode {
  return widget === "workflow" || widget === "toolkit" ? "command" : "observe";
}

function mergeRightRailChangedFiles(
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

function createRightRailEdgeScoreFeedbackEntry({
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

function deriveRightRailEdgeFeedbackAxisSummary(
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

function deriveRightRailEdgeNextBestAction(
  score: RightRailEdgeScore,
  summary: RightRailEdgeFeedbackAxisSummary | null,
): RightRailEdgeNextBestAction | null {
  const repeatedAxis = summary ? score.items.find((item) => item.id === summary.axisId) : null;
  if (repeatedAxis) return { item: repeatedAxis, reason: "repeated-axis" };
  const weakestAxis = [...score.items].sort((left, right) => left.score / left.max - right.score / right.max)[0];
  return weakestAxis ? { item: weakestAxis, reason: "weakest-axis" } : null;
}

function formatRightRailEdgeFeedbackStaleReason(entry: RightRailEdgeScoreFeedbackEntry): string {
  return `Stale axis: ${entry.axisLabel} is no longer in the current score model.`;
}

function deriveRightRailEdgeFeedbackStaleEntries(
  history: RightRailEdgeScoreFeedbackEntry[],
  score: RightRailEdgeScore,
): Array<{ entry: RightRailEdgeScoreFeedbackEntry; staleReason: string }> {
  return history
    .filter((entry) => !score.items.some((item) => item.id === entry.axisId || item.label === entry.axisLabel))
    .map((entry) => ({ entry, staleReason: formatRightRailEdgeFeedbackStaleReason(entry) }));
}

function deriveRightRailEdgeFeedbackStaleGroups(
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

function deriveRightRailEdgeRecommendationOutcome({
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

function RightRailDestinationPromptCard({ prompt }: { prompt: RightRailDestinationPrompt }) {
  return (
    <section className="right-panel-destination-prompt" aria-label={`${prompt.axisLabel} remediation prompt`}>
      <span className="right-panel-destination-prompt-kicker">{prompt.axisLabel} gap</span>
      <strong>{prompt.title}</strong>
      <span>{prompt.detail}</span>
      <small>{prompt.actionLabel}</small>
    </section>
  );
}

function edgeScoreStatus(score: number, max: number): RightRailEdgeScoreItem["status"] {
  const ratio = score / max;
  if (ratio >= 0.8) return "pass";
  if (ratio >= 0.55) return "watch";
  return "gap";
}

function deriveRightRailEdgeScore({
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
  const appWindowOpacity = useAppStore((s) => s.appWindowOpacity);
  const terminalSurfaceOpacity = useAppStore((s) => s.terminalSurfaceOpacity);
  const windowEffect = useAppStore((s) => s.windowEffect);
  const uiFontFamily = useAppStore((s) => s.uiFontFamily);
  const fallbackTelemetryEvents = useAppStore((s) => s.fallbackTelemetryEvents);
  const recordFallbackTelemetry = useAppStore((s) => s.recordFallbackTelemetry);
  // Apply the UI font choice to the app-chrome font variable. global.css reads
  // `--font-ui` for body text and every non-mono surface, so this is the live
  // consumer for config.appearance.ui_font_family.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--font-ui", uiFontFamily);
  }, [uiFontFamily]);
  useThemeApplier(
    themeId,
    themeOverridesForActive,
    moodPresetId,
    materialOverridesForMood,
    wallpaperForMood,
    appWindowOpacity,
    terminalSurfaceOpacity,
    windowEffect === "transparent",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFallbackTelemetry = (event: Event) => {
      const detail = (event as CustomEvent<FallbackTelemetryDetail>).detail;
      if (!detail) return;
      recordFallbackTelemetry(detail);
    };
    window.addEventListener(FALLBACK_TELEMETRY_EVENT, onFallbackTelemetry);
    return () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, onFallbackTelemetry);
  }, [recordFallbackTelemetry]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    Promise.resolve({ invoke: tauriInvoke })
      .then(({ invoke }) => invoke<BootstrapAppConfig>("load_app_config"))
      .then((cfg) => {
        if (cancelled) return;
        const store = useAppStore.getState();
        store.setThemeId(cfg.appearance.theme);
        store.setMoodPresetId(normalizeMoodPreset(cfg.appearance.mood_preset ?? store.moodPresetId));
        store.replaceThemeOverrides(cfg.appearance.theme_overrides ?? {});
        store.replaceMoodMaterialOverrides(cfg.appearance.mood_material_overrides ?? {});
        store.replaceWallpaperSettingsByMood(cfg.appearance.wallpaper_settings_by_mood ?? {});
        if (typeof cfg.appearance.opacity === "number") {
          store.setAppWindowOpacity(cfg.appearance.opacity);
        }
        store.setTerminalAppearance({
          fontFamily: cfg.appearance.terminal_font_family,
          fontSize: cfg.appearance.font_size,
          textClarity: cfg.appearance.terminal_text_clarity,
          surfaceOpacity: cfg.appearance.terminal_surface_opacity,
          lineHeight: cfg.appearance.line_height,
          ligatures: cfg.appearance.ligatures,
        });
        if (cfg.appearance.ui_font_family !== undefined) {
          store.setUiFontFamily(cfg.appearance.ui_font_family);
        }
        if (cfg.appearance.window_effect !== undefined) {
          store.setWindowEffect(sanitizeWindowEffect(cfg.appearance.window_effect));
        }
        if (cfg.terminal?.default_shell !== undefined) {
          store.setDefaultShell(sanitizeDefaultShell(cfg.terminal.default_shell));
        }
        if (cfg.terminal?.cursor_style !== undefined) {
          store.setCursorStyle(sanitizeTerminalCursorStyle(cfg.terminal.cursor_style));
        }
        if (cfg.terminal?.cursor_blink !== undefined) {
          store.setCursorBlink(cfg.terminal.cursor_blink);
        }
        store.setGhostDiffLiveMode(cfg.ghost_diff?.live_mode ?? false);
        hydrateRightRailGuardrailSelectionFromConfig(
          cfg.workspace_profile?.global_defaults?.pane_layout?.right_rail_guardrail_profile,
        );
        hydrateRightRailWidgetOpenFromConfig(cfg.workspace_profile?.global_defaults?.pane_layout?.right_rail_widgets);
      })
      .catch((err) => {
        reportInvokeFailure({
          source: "app",
          operation: "load_app_config_bootstrap",
          err,
          severity: "warning",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Boot perf marker — fires after the first React commit + one frame, so the
  // number reflects when pixels actually land on screen rather than when JS ran.
  useEffect(() => {
    const raf = requestAnimationFrame(() => markFirstPaint());
    return () => cancelAnimationFrame(raf);
  }, []);

  const devVisualQa = useMemo(readDevVisualQaState, []);

  const [editorOpenMode, setEditorOpenMode] = useState(loadEditorOpenMode);
  const [editorLine, setEditorLine] = useState<number | undefined>(undefined);
  const [openInDiff, setOpenInDiff] = useState(false);
  const [fileTreeKey, setFileTreeKey] = useState(0);
  const [quickOpenMode, setQuickOpenMode] = useState<"files" | "buffers" | null>(null);
  const [productMode, setProductMode] = useState<ProductModeId>("terminal");
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("command");
  const [rightRailFocusWidget, setRightRailFocusWidget] = useState<string | null>(null);
  const [rightRailRouteConfirmation, setRightRailRouteConfirmation] = useState<RightRailRouteConfirmation | null>(null);
  const [rightRailDestinationPrompt, setRightRailDestinationPrompt] = useState<RightRailDestinationPrompt | null>(null);
  const [rightRailEdgeFeedbackHistory, setRightRailEdgeFeedbackHistory] = useState<RightRailEdgeScoreFeedbackEntry[]>(
    [],
  );
  const [rightRailEdgeFeedbackStaleOnly, setRightRailEdgeFeedbackStaleOnly] = useState(false);
  const [rightRailEdgeFeedbackResetNotice, setRightRailEdgeFeedbackResetNotice] =
    useState<RightRailEdgeFeedbackResetNotice | null>(null);
  const [releaseQualityGoalInputs, setReleaseQualityGoalInputs] = useState<ReleaseQualityGoalInputs | null>(null);
  const [finalGoalResidualRisk, setFinalGoalResidualRisk] = useState<FinalGoalResidualRisk | null>(null);
  const [finalGoalRequirementProofs, setFinalGoalRequirementProofs] = useState<FinalGoalRequirementProof[]>([]);
  const [finalGoalSafeGate, setFinalGoalSafeGate] = useState<FinalGoalSafeGate | null>(null);
  const [authenticatedPromptConsentPacket, setAuthenticatedPromptConsentPacket] =
    useState<AuthenticatedPromptConsentPacket>(() => deriveAuthenticatedPromptConsentPacket(null));
  const [rightRailAiCliLaunchEvidence, setRightRailAiCliLaunchEvidence] = useState<RightRailAiCliLaunchEvidenceState>(
    () => ({
      evidence: null,
      preflight: null,
    }),
  );
  const [rightRailActionResult, setRightRailActionResult] = useState<RightRailActionResult | null>(null);
  const [rightRailActionHistory, setRightRailActionHistory] = useState<RightRailActionResult[]>([]);
  const [rightRailGuardrailSelection, setRightRailGuardrailSelection] = useState<RightRailGuardrailSelection>(
    loadRightRailGuardrailSelection,
  );
  const [rightRailFixtureSelectedSessionId, setRightRailFixtureSelectedSessionId] = useState<string | null>(null);
  const [paneSwitcherVisible, setPaneSwitcherVisible] = useState(false);
  const rightRailPanelRef = useRef<HTMLDivElement | null>(null);
  const rightRailActionResultTimerRef = useRef<number | null>(null);
  const rightRailRouteConfirmationTimerRef = useRef<number | null>(null);
  const rightRailEdgeFeedbackResetNoticeTimerRef = useRef<number | null>(null);
  const rightRailDestinationReachedTelemetryRef = useRef<string | null>(null);
  const rightRailEdgeScoreRef = useRef<Pick<RightRailEdgeScore, "score" | "grade">>({ score: 0, grade: "D" });
  const rightRailEdgeFeedbackHydratedKeyRef = useRef<string | null>(null);
  const rightRailEdgeFeedbackSkipSaveKeyRef = useRef<string | null>(null);
  const rightRailEdgeFeedbackStaleTelemetryRef = useRef<Set<string>>(new Set());
  const rightRailProjectPathRef = useRef("");
  const rightRailGuardrailProfileRef = useRef<WorkforceGuardrailProfile>("Research");
  const rightRailGuardrailInitialPersistRef = useRef(false);

  useEffect(() => {
    const onEditorModeChange = (event: Event) => {
      const next = (event as CustomEvent<EditorOpenMode>).detail;
      if (next === "vscode" || next === "builtin") {
        setEditorOpenMode(next);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === EDITOR_OPEN_MODE_STORAGE_KEY) {
        setEditorOpenMode(loadEditorOpenMode());
      }
    };
    window.addEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, onEditorModeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, onEditorModeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect intentionally resets fixture selection when the visual-QA scenario changes.
  useEffect(() => {
    setRightRailFixtureSelectedSessionId(null);
  }, [devVisualQa.enabled, devVisualQa.railScenario]);

  useEffect(() => {
    return () => {
      if (rightRailActionResultTimerRef.current != null) {
        window.clearTimeout(rightRailActionResultTimerRef.current);
      }
      if (rightRailRouteConfirmationTimerRef.current != null) {
        window.clearTimeout(rightRailRouteConfirmationTimerRef.current);
      }
      if (rightRailEdgeFeedbackResetNoticeTimerRef.current != null) {
        window.clearTimeout(rightRailEdgeFeedbackResetNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onSync = (event: Event) => {
      const selection = (event as CustomEvent<{ selection?: unknown }>).detail?.selection;
      if (typeof selection === "string" && isRightRailGuardrailSelection(selection)) {
        setRightRailGuardrailSelection(selection);
      }
    };
    window.addEventListener(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, onSync);
    return () => window.removeEventListener(RIGHT_RAIL_GUARDRAIL_SYNC_EVENT, onSync);
  }, []);

  useEffect(() => {
    if (!rightRailGuardrailInitialPersistRef.current) {
      rightRailGuardrailInitialPersistRef.current = true;
      if (rightRailGuardrailSelection === "Auto") return;
    }
    saveRightRailGuardrailSelection(rightRailGuardrailSelection);
  }, [rightRailGuardrailSelection]);

  const showRightRailActionResult = useCallback(
    (
      action: RightRailAction,
      tone: RightRailActionResultTone,
      detail: string,
      auditRecord: AuditJournalEventRecord | null = null,
    ) => {
      if (rightRailActionResultTimerRef.current != null) {
        window.clearTimeout(rightRailActionResultTimerRef.current);
      }
      const result = createRightRailActionResult(action, tone, detail, auditRecord);
      setRightRailActionResult(result);
      setRightRailActionHistory((history) => [result, ...history].slice(0, RIGHT_RAIL_ACTION_HISTORY_LIMIT));
      rightRailActionResultTimerRef.current = window.setTimeout(() => {
        setRightRailActionResult(null);
        rightRailActionResultTimerRef.current = null;
      }, 6_500);
    },
    [],
  );
  const showRightRailDestinationOutcome = useCallback(
    (outcome: {
      label: string;
      detail: string;
      tone: RightRailActionResultTone;
      auditEventId?: number | null;
      auditCorrelationId?: string | null;
      routeWidget?: RightRailWidgetId | null;
      routeLabel?: string | null;
      routeDetail?: string | null;
    }) => {
      if (rightRailActionResultTimerRef.current != null) {
        window.clearTimeout(rightRailActionResultTimerRef.current);
      }
      const result = createRightRailDestinationResult(outcome);
      setRightRailActionResult(result);
      setRightRailActionHistory((history) => [result, ...history].slice(0, RIGHT_RAIL_ACTION_HISTORY_LIMIT));
      rightRailActionResultTimerRef.current = window.setTimeout(() => {
        setRightRailActionResult(null);
        rightRailActionResultTimerRef.current = null;
      }, 6_500);
    },
    [],
  );
  const showRightRailRouteConfirmation = useCallback((confirmation: Omit<RightRailRouteConfirmation, "createdAt">) => {
    if (rightRailRouteConfirmationTimerRef.current != null) {
      window.clearTimeout(rightRailRouteConfirmationTimerRef.current);
    }
    setRightRailRouteConfirmation({ ...confirmation, createdAt: Date.now() });
    rightRailRouteConfirmationTimerRef.current = window.setTimeout(() => {
      setRightRailRouteConfirmation(null);
      rightRailRouteConfirmationTimerRef.current = null;
    }, 5_500);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rightRailMode retriggers focus after tab-panel content swaps while the target widget id stays the same.
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
      if (rightRailDestinationPrompt?.widget === rightRailFocusWidget) {
        const telemetryKey = `${rightRailDestinationPrompt.createdAt}:${rightRailFocusWidget}:destination-reached`;
        if (rightRailDestinationReachedTelemetryRef.current !== telemetryKey) {
          rightRailDestinationReachedTelemetryRef.current = telemetryKey;
          void appendRightRailEdgeScoreInteractionAudit({
            item: rightRailDestinationPrompt.item,
            workspaceId: rightRailProjectPathRef.current,
            fromMode: rightRailDestinationPrompt.fromMode,
            score: rightRailDestinationPrompt.edgeScore,
            grade: rightRailDestinationPrompt.edgeGrade,
            stage: "destination-reached",
          });
          setRightRailDestinationPrompt((current) =>
            current?.createdAt === rightRailDestinationPrompt.createdAt
              ? { ...current, reachedAt: Date.now() }
              : current,
          );
        }
      }
      cleanupTimer = window.setTimeout(() => {
        delete widget.dataset.railFocus;
        setRightRailFocusWidget(null);
      }, 1_400);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (cleanupTimer) window.clearTimeout(cleanupTimer);
    };
  }, [rightRailDestinationPrompt, rightRailFocusWidget, rightRailMode]);

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
    // Seed the first/new tabs from the persisted default shell (config.toml
    // terminal.default_shell, mirrored into the store/localStorage). Read once
    // via getState so the initializer is stable — useTabManager only consults
    // the value when creating the initial tab and via addTab's shell argument.
  } = useTabManager(useAppStore.getState().defaultShell);
  const activePtyId = tabActivePtyIds[activeTabId] ?? null;

  // Loop-dispatched agents → real split panes in the active terminal tab. We
  // accumulate the live agent terminals from the agent_spawned event stream and
  // hand the set to the active tab's PaneTreeContainer, which splits the active
  // pane and binds each agent's PTY (1 pane = 1 agent), so the operator watches
  // them work in genuine terminal panes.
  const [paneAgentSpawns, setPaneAgentSpawns] = useState<{
    tabId: string;
    agents: PaneAgentSpawnRequest["agents"][number][];
    sequence: number;
  } | null>(null);
  // Role → { mounted pty id, tab it was mounted in } for the most recent
  // orchestra dispatch, so a role lane card can focus its central pane in the
  // correct tab even after the operator switches tabs (WU-VP-1 DoD#6).
  const [orchestraRolePanes, setOrchestraRolePanes] = useState<Map<string, { terminalId: string; tabId: string }>>(
    () => new Map(),
  );
  // Always-current active tab id read by the identity-stable mountAgentPtyInPane
  // below, so the agent-event listener does not have to re-subscribe per tab.
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // Globally monotonic spawn-request sequence. Each tab's PaneTreeContainer only
  // processes a request whose sequence exceeds the last it handled, so deriving
  // the next sequence from the *last active tab's* request (mount A→B→A) would
  // reset it to 1 and the re-mount into A would be silently ignored. A global
  // counter keeps every tab's requests strictly increasing.
  const paneSpawnSequenceRef = useRef(0);

  // Single owner of agent-pty → central-pane mounting. Both the autonomous loop
  // (agent-event payload.terminalId) and the orchestra/manual dispatch
  // (SpawnResult.pty_id) funnel through here so the two paths can't diverge
  // (WU-VP-2). Dedups by terminalId and bumps the sequence the PaneTreeContainer
  // watches; an array argument mounts N roles in ONE tiling pass.
  const mountAgentPtyInPane = useCallback(
    (
      agents: PaneAgentSpawnRequest["agents"][number] | PaneAgentSpawnRequest["agents"][number][],
      tabId: string = activeTabIdRef.current,
    ) => {
      const incoming = Array.isArray(agents) ? agents : [agents];
      if (incoming.length === 0) return;
      // Compute the next sequence once per call (not inside the updater, which
      // React may invoke twice under StrictMode) so the counter stays monotonic.
      paneSpawnSequenceRef.current += 1;
      const nextSequence = paneSpawnSequenceRef.current;
      setPaneAgentSpawns((prev) => {
        const sameTab = prev && prev.tabId === tabId ? prev : null;
        const existing = sameTab?.agents ?? [];
        const merged = [...existing];
        for (const agent of incoming) {
          if (!merged.some((mounted) => mounted.terminalId === agent.terminalId)) merged.push(agent);
        }
        if (merged.length === existing.length) return prev;
        return { tabId, agents: merged, sequence: nextSequence };
      });
    },
    [],
  );
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void tauriListen<{
      kind?: string;
      payload?: {
        terminalId?: unknown;
        model?: unknown;
        taskId?: unknown;
        roleId?: unknown;
        backend?: unknown;
        durability?: unknown;
        branchName?: unknown;
      };
    }>(
      "agent-event",
      (event) => {
        if (cancelled) return;
        const message = event.payload;
        if (message?.kind !== "agent_spawned") return;
        const payload = message.payload;
        const terminalId = payload?.terminalId;
        if (typeof terminalId !== "string") return;
        const model = typeof payload?.model === "string" ? payload.model : "sonnet";
        const taskId = typeof payload?.taskId === "string" ? payload.taskId : undefined;
        const roleId = typeof payload?.roleId === "string" ? payload.roleId : undefined;
        const branchName = typeof payload?.branchName === "string" ? payload.branchName : undefined;
        const backend = payload?.backend === "sidecar" || payload?.backend === "native" ? payload.backend : "native";
        const durability =
          payload?.durability === "tmux-durable" || payload?.durability === "degraded"
            ? payload.durability
            : backend === "sidecar"
              ? "tmux-durable"
              : "degraded";
        const agent: PaneAgentSpawnRequest["agents"][number] = {
          terminalId,
          model,
          backend,
          durability,
          spawnedAt: new Date().toISOString(),
          ...(taskId ? { taskId } : {}),
          ...(roleId ? { roleId } : {}),
          ...(branchName ? { branchName } : {}),
        };
        mountAgentPtyInPane(agent);
      },
    )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* backend unreachable (e.g. tests) — fleet panes are best-effort */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [mountAgentPtyInPane]);

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
  const visualActiveTerminalTargetLabel = formatTerminalTarget(activeTab.shell, visualActivePtyId);

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

  const {
    sessions,
    fleetSessions,
    activeSessionId,
    setActiveSessionId,
    startAgent,
    stopAgent,
    renameSession,
    interactiveSessions,
    interactiveSessionId,
    selectInteractiveSession,
    startInteractiveSession,
    stopInteractiveSession,
    endSessionAndRemoveWorktree,
  } = useAgentFleet();

  const projectPath = activeTab.cwd ?? rootProjectPath ?? "";
  rightRailProjectPathRef.current = projectPath;
  useEffect(() => {
    const key = rightRailEdgeFeedbackStorageKey(projectPath);
    rightRailEdgeFeedbackHydratedKeyRef.current = key;
    rightRailEdgeFeedbackSkipSaveKeyRef.current = key;
    setRightRailEdgeFeedbackHistory(loadRightRailEdgeFeedbackHistory(projectPath));
  }, [projectPath]);
  useEffect(() => {
    const key = rightRailEdgeFeedbackStorageKey(projectPath);
    if (!key || rightRailEdgeFeedbackHydratedKeyRef.current !== key) return;
    if (rightRailEdgeFeedbackSkipSaveKeyRef.current === key) {
      rightRailEdgeFeedbackSkipSaveKeyRef.current = null;
      return;
    }
    saveRightRailEdgeFeedbackHistory(projectPath, rightRailEdgeFeedbackHistory);
  }, [projectPath, rightRailEdgeFeedbackHistory]);
  useEffect(() => {
    let active = true;
    let interval: number | null = null;
    if (!projectPath || !isTauriRuntime()) {
      setReleaseQualityGoalInputs(null);
      return () => {
        active = false;
      };
    }

    const releaseQualityPath = resolveProjectFilePath(projectPath, ".codex-auto/quality/release-quality-score.json");
    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => invoke<string>("read_file", { path: releaseQualityPath }))
        .then((text) => {
          if (!active) return;
          setReleaseQualityGoalInputs(deriveReleaseQualityGoalInputs(parseReleaseQualityReport(text)));
        })
        .catch((err) => {
          if (!active) return;
          setReleaseQualityGoalInputs(deriveReleaseQualityGoalInputs(null));
          reportInvokeFailure({
            source: "app",
            operation: "read_release_quality_score",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
    };
  }, [projectPath]);
  useEffect(() => {
    let active = true;
    let interval: number | null = null;
    if (!projectPath || !isTauriRuntime()) {
      setFinalGoalResidualRisk(null);
      setFinalGoalRequirementProofs([]);
      return () => {
        active = false;
      };
    }

    const finalGoalAuditPath = resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-audit.json");
    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => invoke<string>("read_file", { path: finalGoalAuditPath }))
        .then((text) => {
          if (!active) return;
          const report = parseFinalGoalAuditReport(text);
          setFinalGoalResidualRisk(deriveFinalGoalResidualRisk(report));
          setFinalGoalRequirementProofs(deriveFinalGoalRequirementProofs(report));
        })
        .catch((err) => {
          if (!active) return;
          setFinalGoalResidualRisk(deriveFinalGoalResidualRisk(null));
          setFinalGoalRequirementProofs(deriveFinalGoalRequirementProofs(null));
          reportInvokeFailure({
            source: "app",
            operation: "read_final_goal_audit",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
    };
  }, [projectPath]);
  useEffect(() => {
    let active = true;
    let interval: number | null = null;
    if (!projectPath || !isTauriRuntime()) {
      setFinalGoalSafeGate(null);
      return () => {
        active = false;
      };
    }

    const finalGoalSafePath = resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-safe-summary.json");
    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => invoke<string>("read_file", { path: finalGoalSafePath }))
        .then((text) => {
          if (!active) return;
          setFinalGoalSafeGate(deriveFinalGoalSafeGate(parseFinalGoalSafeSummaryReport(text)));
        })
        .catch((err) => {
          if (!active) return;
          setFinalGoalSafeGate(deriveFinalGoalSafeGate(null));
          reportInvokeFailure({
            source: "app",
            operation: "read_final_goal_safe_gate",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
    };
  }, [projectPath]);
  useEffect(() => {
    let active = true;
    let interval: number | null = null;
    if (!projectPath || !isTauriRuntime()) {
      setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
      return () => {
        active = false;
      };
    }

    const consentPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
    );
    const matrixPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
    );
    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          Promise.allSettled([
            invoke<string>("read_file", { path: consentPath }),
            invoke<string>("read_file", { path: matrixPath }),
          ]),
        )
        .then(([consentResult, matrixResult]) => {
          if (!active) return;
          const consentText = consentResult.status === "fulfilled" ? consentResult.value : "";
          const matrixText = matrixResult.status === "fulfilled" ? matrixResult.value : "";
          setAuthenticatedPromptConsentPacket(
            deriveAuthenticatedPromptConsentPacket(
              parseAuthenticatedPromptConsentReport(consentText),
              parseAuthenticatedPromptPreflightMatrixReport(matrixText),
            ),
          );
        })
        .catch(() => {
          if (!active) return;
          setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
        });
    };

    refresh();
    interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
    };
  }, [projectPath]);
  useEffect(() => {
    let active = true;
    let interval: number | null = null;
    if (!projectPath || !isTauriRuntime()) {
      setRightRailAiCliLaunchEvidence({ evidence: null, preflight: null });
      return () => {
        active = false;
      };
    }

    const realProbePath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
    );
    const nativeInputPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/native-terminal-input-host.json",
    );
    const imePath = resolveProjectFilePath(projectPath, ".codex-auto/production-smoke/verify-ime.json");
    const processReconnectPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
    );
    const muxLiveProcessPreservationPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/quality/mux-live-process-preservation.json",
    );
    const interactiveBoundaryPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/interactive-ai-cli-boundary.json",
    );

    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          Promise.allSettled([
            invoke<string>("read_file", { path: realProbePath }),
            invoke<string>("read_file", { path: nativeInputPath }),
            invoke<string>("read_file", { path: imePath }),
            invoke<string>("read_file", { path: processReconnectPath }),
            invoke<string>("read_file", { path: muxLiveProcessPreservationPath }),
            invoke<string>("read_file", { path: interactiveBoundaryPath }),
          ]),
        )
        .then(([realProbeResult, nativeInputResult, imeResult, processReconnectResult, muxLiveProcessPreservationResult, interactiveBoundaryResult]) => {
          if (!active) return;
          const evidence =
            realProbeResult.status === "fulfilled"
              ? parseJsonArtifact<AiCliProbeEvidence>(realProbeResult.value)
              : null;
          const nativeInputHost =
            nativeInputResult.status === "fulfilled"
              ? parseJsonArtifact<NonNullable<AiCliLaunchPreflightEvidence["nativeInputHost"]>>(nativeInputResult.value)
              : null;
          const ime =
            imeResult.status === "fulfilled"
              ? parseJsonArtifact<NonNullable<AiCliLaunchPreflightEvidence["ime"]>>(imeResult.value)
              : null;
          const processReconnect =
            processReconnectResult.status === "fulfilled"
              ? parseJsonArtifact<NonNullable<AiCliLaunchPreflightEvidence["processReconnect"]>>(
                  processReconnectResult.value,
                )
              : null;
          const muxLiveProcessPreservation =
            muxLiveProcessPreservationResult.status === "fulfilled"
              ? parseJsonArtifact<NonNullable<AiCliLaunchPreflightEvidence["muxLiveProcessPreservation"]>>(
                  muxLiveProcessPreservationResult.value,
                )
              : null;
          const interactiveBoundary =
            interactiveBoundaryResult.status === "fulfilled"
              ? parseJsonArtifact<NonNullable<AiCliLaunchPreflightEvidence["interactiveBoundary"]>>(
                  interactiveBoundaryResult.value,
                )
              : null;
          const preflight =
            nativeInputHost || ime || processReconnect || muxLiveProcessPreservation || interactiveBoundary
              ? {
                  nativeInputHost,
                  ime,
                  processReconnect,
                  muxLiveProcessPreservation,
                  interactiveBoundary,
                }
              : null;
          setRightRailAiCliLaunchEvidence({ evidence, preflight });
        })
        .catch((err) => {
          if (!active) return;
          setRightRailAiCliLaunchEvidence({ evidence: null, preflight: null });
          reportInvokeFailure({
            source: "app",
            operation: "read_ai_cli_launch_evidence",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      if (interval != null) window.clearInterval(interval);
    };
  }, [projectPath]);
  const projectName = projectPath ? (projectPath.split("/").filter(Boolean).pop() ?? PRODUCT_NAME) : PRODUCT_NAME;
  const workspaceProfile = useMemo(
    () => resolveWorkspaceProfile(projectPath || rootProjectPath || "workspace", activeTabId),
    [activeTabId, projectPath, resolveWorkspaceProfile, rootProjectPath],
  );
  const scopedOperationalAuditEvents = useMemo(
    () => filterWorkspaceScopedEvents(operationalAuditEvents, workspaceProfile),
    [operationalAuditEvents, workspaceProfile],
  );
  const handleOpenRightRailActionAudit = useCallback(
    (result: RightRailActionResult | null = rightRailActionResult) => {
      if (!result?.auditEventId && !result?.auditCorrelationId) return;
      const matchingEvent = scopedOperationalAuditEvents.find((event) => {
        if (result.auditEventId != null && event.id === result.auditEventId) return true;
        const correlationId = getAuditCorrelationId(event.metadata);
        return Boolean(
          result.auditKind &&
            result.auditCorrelationId &&
            event.action === result.auditKind &&
            correlationId === result.auditCorrelationId,
        );
      });
      const auditEventId = result.auditEventId ?? matchingEvent?.id ?? null;
      const traceId = result.auditCorrelationId ?? getAuditCorrelationId(matchingEvent?.metadata) ?? null;
      if (auditEventId != null) setSelectedAuditEventId(auditEventId);
      setSelectedAuditTraceFilter(traceId);
      showRightRailRouteConfirmation({
        widget: "audit-timeline",
        title: "Opened audit evidence",
        detail: matchingEvent?.summary ?? result.routeDetail ?? result.detail,
      });
      setRightRailMode("observe");
      setRightRailFocusWidget("audit-timeline");
    },
    [rightRailActionResult, scopedOperationalAuditEvents, showRightRailRouteConfirmation],
  );
  const handleOpenRightRailOutcomeSource = useCallback(
    (result: RightRailActionResult) => {
      if (result.auditEventId != null || result.auditCorrelationId) {
        handleOpenRightRailActionAudit(result);
        return;
      }
      if (!result.routeWidget) return;
      showRightRailRouteConfirmation({
        widget: result.routeWidget,
        title: result.routeLabel ? `Opened ${result.routeLabel}` : "Opened outcome source",
        detail: result.routeDetail ?? result.detail,
      });
      setRightRailMode(rightRailModeForOutcomeWidget(result.routeWidget));
      setRightRailFocusWidget(result.routeWidget);
    },
    [handleOpenRightRailActionAudit, showRightRailRouteConfirmation],
  );
  const handleOpenDecisionWorkflow = useCallback(
    (workflowId: string) => {
      showRightRailRouteConfirmation({
        widget: "workflow",
        title: "Opened workflow gate",
        detail: workflowId,
      });
      setRightRailMode("command");
      setRightRailFocusWidget("workflow");
    },
    [showRightRailRouteConfirmation],
  );
  const handleOpenDecisionAudit = useCallback(
    (auditEventId: number) => {
      const event = scopedOperationalAuditEvents.find((candidate) => candidate.id === auditEventId);
      const traceId = getAuditCorrelationId(event?.metadata);
      showRightRailRouteConfirmation({
        widget: "audit-timeline",
        title: "Opened audit evidence",
        detail: event?.summary ?? event?.action ?? `Audit event ${auditEventId}`,
      });
      setSelectedAuditEventId(auditEventId);
      setSelectedAuditTraceFilter(traceId);
      setRightRailMode("observe");
      setRightRailFocusWidget("audit-timeline");
    },
    [scopedOperationalAuditEvents, showRightRailRouteConfirmation],
  );
  const handleOpenRightRailEdgeScoreItem = useCallback(
    (item: RightRailEdgeScoreItem) => {
      const edgeScoreAtClick = rightRailEdgeScoreRef.current;
      setRightRailMode(item.routeMode);
      setRightRailFocusWidget(item.focusWidget);
      setRightRailEdgeFeedbackHistory((history) => {
        const nextHistory = [
          createRightRailEdgeScoreFeedbackEntry({
            item,
            score: edgeScoreAtClick.score,
            grade: edgeScoreAtClick.grade,
            previous: history[0],
          }),
          ...history,
        ].slice(0, RIGHT_RAIL_EDGE_FEEDBACK_LIMIT);
        saveRightRailEdgeFeedbackHistory(projectPath, nextHistory);
        return nextHistory;
      });
      setRightRailDestinationPrompt({
        widget: item.focusWidget,
        axisLabel: item.label,
        title: item.promptTitle,
        detail: item.promptDetail,
        actionLabel: item.actionLabel,
        item,
        edgeScore: edgeScoreAtClick.score,
        edgeGrade: edgeScoreAtClick.grade,
        fromMode: rightRailMode,
        createdAt: Date.now(),
      });
      void appendRightRailEdgeScoreInteractionAudit({
        item,
        workspaceId: projectPath,
        fromMode: rightRailMode,
        score: edgeScoreAtClick.score,
        grade: edgeScoreAtClick.grade,
        stage: "clicked",
      });
      if (isRightRailWidgetId(item.focusWidget)) {
        showRightRailRouteConfirmation({
          widget: item.focusWidget,
          title: item.routeTitle,
          detail: item.routeDetail,
        });
      }
    },
    [projectPath, rightRailMode, showRightRailRouteConfirmation],
  );
  const handleClearRightRailEdgeFeedbackHistory = useCallback(() => {
    clearRightRailEdgeFeedbackHistory(projectPath);
    rightRailEdgeFeedbackSkipSaveKeyRef.current = null;
    setRightRailEdgeFeedbackHistory([]);
    setRightRailEdgeFeedbackResetNotice({
      createdAt: Date.now(),
      label: "Score loop cleared",
      detail: "Workspace guidance was reset.",
    });
    if (rightRailEdgeFeedbackResetNoticeTimerRef.current != null) {
      window.clearTimeout(rightRailEdgeFeedbackResetNoticeTimerRef.current);
    }
    rightRailEdgeFeedbackResetNoticeTimerRef.current = window.setTimeout(() => {
      setRightRailEdgeFeedbackResetNotice(null);
      rightRailEdgeFeedbackResetNoticeTimerRef.current = null;
    }, 5_000);
  }, [projectPath]);
  useEffect(() => {
    let active = true;
    if (!projectPath || !isTauriRuntime()) {
      setWorkflowStatuses([]);
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
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
  // Single-source projection: the rail panels consume the unified fleet
  // (headless + interactive) rather than only headless sessions. AgentFleetSession
  // extends AgentSession so AgentSession[]-typed panels accept this unchanged.
  const rightRailSessions = useMemo(
    () =>
      rightRailUsesFixtures
        ? createDevVisualQaSessions(devVisualQa.railScenario, devVisualQa.projectPath || projectPath)
        : fleetSessions,
    [devVisualQa.projectPath, devVisualQa.railScenario, projectPath, rightRailUsesFixtures, fleetSessions],
  );
  const rightRailChangedFiles = useMemo(
    () => (rightRailUsesFixtures ? createDevVisualQaChangedFiles(devVisualQa.railScenario) : changedFiles),
    [changedFiles, devVisualQa.railScenario, rightRailUsesFixtures],
  );
  const rightRailFixtureCommandBlocks = useMemo(
    () =>
      rightRailUsesFixtures
        ? createDevVisualQaCommandBlocks(devVisualQa.railScenario, devVisualQa.projectPath || projectPath)
        : [],
    [devVisualQa.projectPath, devVisualQa.railScenario, projectPath, rightRailUsesFixtures],
  );
  const [rightRailCommandBlocks, setRightRailCommandBlocks] = useState<WorkstationGraphCommandBlock[]>([]);
  const rightRailTerminalIdsKey = useMemo(
    () =>
      [...new Set(visualTerminalPaneTargets.map((pane) => pane.terminalId).filter((id): id is string => Boolean(id)))]
        .sort()
        .join("|"),
    [visualTerminalPaneTargets],
  );
  const [rightRailNativeCommandBlocks, setRightRailNativeCommandBlocks] = useState<WorkstationGraphCommandBlock[]>([]);
  useEffect(() => {
    let active = true;
    if (!projectPath || rightRailUsesFixtures || !isTauriRuntime()) {
      setRightRailCommandBlocks([]);
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          invoke<CommandHistoryRecord[]>("search_command_history", {
            query: "",
            limit: 24,
          }),
        )
        .then((records) => {
          if (!active) return;
          setRightRailCommandBlocks(commandHistoryRecordsToCommandBlocks(records, rightRailChangedFiles, projectPath));
        })
        .catch((err) => {
          if (!active) return;
          setRightRailCommandBlocks([]);
          reportInvokeFailure({
            source: "app",
            operation: "search_command_history",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath, rightRailChangedFiles, rightRailUsesFixtures]);
  useEffect(() => {
    let active = true;
    const terminalIds = rightRailTerminalIdsKey ? rightRailTerminalIdsKey.split("|") : [];
    if (!projectPath || rightRailUsesFixtures || terminalIds.length === 0 || !isTauriRuntime()) {
      setRightRailNativeCommandBlocks([]);
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          Promise.all(
            terminalIds.map((id) =>
              invoke<NativeCommandBlockRecord[]>("term_command_blocks", {
                id,
                limit: 12,
              }),
            ),
          ),
        )
        .then((recordsByTerminal) => {
          if (!active) return;
          setRightRailNativeCommandBlocks(
            nativeCommandBlockRecordsToCommandBlocks(recordsByTerminal.flat(), rightRailChangedFiles, projectPath),
          );
        })
        .catch((err) => {
          if (!active) return;
          setRightRailNativeCommandBlocks([]);
          reportInvokeFailure({
            source: "app",
            operation: "term_command_blocks",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath, rightRailChangedFiles, rightRailTerminalIdsKey, rightRailUsesFixtures]);
  const rightRailGraphCommandBlocks = useMemo(
    () => [...rightRailFixtureCommandBlocks, ...rightRailCommandBlocks, ...rightRailNativeCommandBlocks],
    [rightRailCommandBlocks, rightRailFixtureCommandBlocks, rightRailNativeCommandBlocks],
  );
  const rightRailSelectedFixtureSessionExists =
    rightRailFixtureSelectedSessionId != null &&
    rightRailSessions.some((session) => session.id === rightRailFixtureSelectedSessionId);
  // Unified active id: an interactive selection takes precedence (headless
  // selection clears it, see handleSelectRightRailSession), otherwise fall back
  // to the headless active. Lets the rail highlight interactive cards too
  // (previously headless-only, so interactive selection never lit up).
  const fleetActiveSessionId = interactiveSessionId || activeSessionId;
  const rightRailActiveSessionId =
    rightRailUsesFixtures && rightRailSessions.length > 0
      ? rightRailSelectedFixtureSessionExists
        ? rightRailFixtureSelectedSessionId
        : (rightRailSessions[0]?.id ?? null)
      : fleetActiveSessionId;
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
        commandBlocks: rightRailGraphCommandBlocks,
        risks: rightRailAuditRisks,
      }),
    [
      activeTabId,
      projectPath,
      rightRailAuditRisks,
      rightRailChangedFiles,
      rightRailGraphCommandBlocks,
      rightRailSessions,
      visualTerminalPaneTargets,
    ],
  );
  const rightRailGraphChangedFiles = useMemo(() => listWorkstationGraphChangedFiles(rightRailGraph), [rightRailGraph]);
  const rightRailAllChangedFiles = useMemo(
    () => mergeRightRailChangedFiles(rightRailChangedFiles, rightRailGraphChangedFiles),
    [rightRailChangedFiles, rightRailGraphChangedFiles],
  );
  const rightRailGraphRiskNodes = useMemo(
    () => rightRailGraph.nodes.filter((node) => node.kind === "risk" || node.kind === "blocker"),
    [rightRailGraph],
  );
  const rightRailGraphReleaseRiskNodes = useMemo(
    () =>
      rightRailGraphRiskNodes.filter(
        (node) => !isRightRailQaFixtureRisk(`${node.id} ${node.label} ${node.status ?? ""}`),
      ),
    [rightRailGraphRiskNodes],
  );
  const rightRailGraphQaRiskNodes = useMemo(
    () =>
      rightRailGraphRiskNodes.filter((node) =>
        isRightRailQaFixtureRisk(`${node.id} ${node.label} ${node.status ?? ""}`),
      ),
    [rightRailGraphRiskNodes],
  );
  const rightRailGraphRiskSummaries = useMemo(
    () =>
      rightRailGraphReleaseRiskNodes.slice(0, 3).map((node) => ({
        id: node.id,
        label: node.label,
        status: node.status,
        severity: node.severity,
        source: "release" as const,
      })),
    [rightRailGraphReleaseRiskNodes],
  );
  const rightRailRuntimeFallbackEvents = useMemo(
    () =>
      fallbackTelemetryEvents.filter(
        (event) => event.userVisible !== false && (event.severity === "warning" || event.severity === "error"),
      ),
    [fallbackTelemetryEvents],
  );
  const rightRailRuntimeFallbackSummaries = useMemo(
    () =>
      rightRailRuntimeFallbackEvents.slice(0, 3).map((event) => {
        const boundaryLabel = event.nativeBoundaryEscaped && event.boundary ? ` (${event.boundary})` : "";
        return {
          id: `runtime-fallback:${event.source}:${event.operation}:${Math.round(event.timestamp)}`,
          label: `${event.source}.${event.operation}${boundaryLabel}`,
          status: event.nativeBoundaryEscaped ? `${event.severity} · native boundary escaped` : event.severity,
          severity: event.severity,
          source: "runtime" as const,
        };
      }),
    [rightRailRuntimeFallbackEvents],
  );
  const rightRailGraphQaRiskSummaries = useMemo(
    () =>
      rightRailGraphQaRiskNodes.slice(0, 3).map((node) => ({
        id: node.id,
        label: node.label,
        status: node.status,
        severity: node.severity,
        source: "qa-fixture" as const,
      })),
    [rightRailGraphQaRiskNodes],
  );
  const rightRailPrimaryChangedFile = rightRailAllChangedFiles[0] ?? null;
  const focusedRightRailGraph = useMemo(
    () =>
      filterWorkstationGraph(rightRailGraph, {
        agentId: rightRailActiveSessionId,
        paneId: selectedOperationalPaneTarget?.paneId ?? null,
      }),
    [rightRailActiveSessionId, rightRailGraph, selectedOperationalPaneTarget?.paneId],
  );
  const decisionInbox = useMemo(
    () =>
      buildDecisionInbox({
        sessions: rightRailSessions,
        auditEvents: scopedOperationalAuditEvents,
        workflows: workflowStatuses,
      }),
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
      // Populate the Knowledge Graph (code dependency map) from this project's
      // source — best-effort, off the UI thread. It persists, so it survives a
      // restart and simply re-runs on the next open if this attempt fails.
      void tauriInvoke("populate_knowledge_graph", { rootPath: normalized }).catch(() => {});
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
      window.localStorage.setItem("aelyris:onboarding-done", "true");
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

  const handleOpenCommandEvidence = useCallback(
    async (command: FileProvenanceTrace["commands"][number]) => {
      const terminalId = command.terminalId;
      if (!terminalId) return;
      const target = visualTerminalPaneTargets.find((pane) => pane.terminalId === terminalId);
      if (target) {
        selectOperationalPane(target);
        await handlePaneSwitch(target.tabId, target.paneId);
      }
      const sequence = command.endSequence ?? command.outputSequence ?? command.commandSequence ?? null;
      const historySize = command.endHistorySize ?? command.outputHistorySize ?? command.commandHistorySize ?? null;
      const screenLine = command.endScreenLine ?? command.outputScreenLine ?? command.commandScreenLine ?? null;
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent(TERMINAL_COMMAND_EVIDENCE_EVENT, {
            detail: {
              terminalId,
              sequence,
              historySize,
              screenLine,
            },
          }),
        );
      }, 0);
      showRightRailRouteConfirmation({
        widget: "run-graph",
        title: "Terminal evidence",
        detail: `${command.label} opened in its source pane.`,
      });
    },
    [handlePaneSwitch, selectOperationalPane, showRightRailRouteConfirmation, visualTerminalPaneTargets],
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
    async (prompt: string, model?: string, meta?: StartAgentMeta) => {
      try {
        const guardrailProfile = meta?.guardrailProfile ?? rightRailGuardrailProfileRef.current;
        const nextMeta: StartAgentMeta = {
          ...meta,
          guardrailProfile,
          allowedTools: meta?.allowedTools ?? allowedToolsForGuardrailProfile(guardrailProfile),
        };
        return await startAgent(prompt, projectPath, model, nextMeta);
      } catch {
        return undefined;
      }
    },
    [startAgent, projectPath],
  );

  const handleFileSelect = useCallback(
    (path: string, options: { line?: number } = {}) => {
      setOpenInDiff(false);
      if (editorOpenMode === "vscode") {
        void openInVSCode(path, { line: options.line }).catch((err) => {
          reportInvokeFailure({
            source: "editor",
            operation: "open_in_vscode",
            err,
          });
          if (options.line !== undefined) {
            setEditorLine(options.line);
          }
          openFile(path);
        });
        return;
      }
      if (options.line !== undefined) {
        setEditorLine(options.line);
      }
      openFile(path);
    },
    [editorOpenMode, openFile],
  );

  const handleOpenDiff = useCallback(
    (path: string) => {
      if (editorOpenMode === "vscode") {
        setOpenInDiff(false);
        void openGitDiffInVSCode(projectPath, path).catch((err) => {
          reportInvokeFailure({
            source: "editor",
            operation: "open_git_file_diff_in_vscode",
            err,
          });
          setOpenInDiff(true);
          openFile(path);
        });
        return;
      }
      setOpenInDiff(true);
      openFile(path);
    },
    [editorOpenMode, openFile, projectPath],
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
        const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
        await invoke("native_terminal_input_commit", {
          terminalId: activeTerminalTarget.terminalId,
          data,
          source: "command-center",
        });
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
      // Selecting a headless session clears any interactive selection so the
      // unified active id (interactiveSessionId || activeSessionId) reflects it.
      if (interactiveSessionId) selectInteractiveSession("");
      handleSelectSession(sessionId);
    },
    [handleSelectSession, interactiveSessionId, selectInteractiveSession, rightRailUsesFixtures],
  );

  const handleRightRailAction = useCallback(
    async (action: RightRailAction) => {
      const auditRecord = await appendRightRailActionAudit(action, projectPath, rightRailMode);
      const showRecoverableActionResult = async (
        tone: Extract<RightRailActionResultTone, "warn" | "error">,
        detail: string,
        outcome: "blocked" | "failed" = tone === "warn" ? "blocked" : "failed",
      ) => {
        const recoveryDetail = formatRightRailRecoveryDetail(action, detail);
        const outcomeRecord =
          (await appendRightRailActionOutcomeAudit(action, projectPath, rightRailMode, outcome, recoveryDetail)) ??
          auditRecord;
        showRightRailActionResult(action, tone, recoveryDetail, outcomeRecord);
      };
      if (action.execution.status === "blocked") {
        await showRecoverableActionResult(
          "warn",
          action.execution.disabledReason ?? action.execution.recoveryStep ?? "Action is blocked.",
        );
        return;
      }
      setRightRailMode(action.mode);
      setRightRailFocusWidget(RIGHT_RAIL_ACTION_WIDGET[action.id] ?? null);
      const pendingDecisionSessionId =
        action.id === "resolve-approvals"
          ? decisionInbox.pendingItems.find((item) => item.sessionId)?.sessionId
          : undefined;
      if (action.targetSessionId) {
        handleSelectRightRailSession(action.targetSessionId);
      } else if (pendingDecisionSessionId) {
        handleSelectRightRailSession(pendingDecisionSessionId);
      }
      if (action.targetPaneRole) {
        const pane = visualTerminalPaneTargets.find((candidate) => candidate.role === action.targetPaneRole);
        if (pane) {
          selectOperationalPane(pane);
        } else if (action.execution.operation === "focus-pane") {
          await showRecoverableActionResult("warn", "Pane target changed before it could be focused.");
          return;
        }
      }

      if (action.execution.operation === "open-primary-diff") {
        const targetPath = action.targetFilePath ?? rightRailPrimaryChangedFile?.path;
        if (!targetPath) {
          await showRecoverableActionResult("warn", "No changed file is available for diff.");
          toast.warning("No diff target", "Refresh source control and try the review action again.");
          return;
        }
        const filePath = resolveProjectFilePath(projectPath, targetPath);
        handleOpenDiff(filePath);
        showRightRailActionResult(action, "success", `Opened diff for ${targetPath}`, auditRecord);
        toast.success("Diff opened", targetPath);
        return;
      }

      if (action.execution.operation === "copy-context-pack") {
        const focusSession =
          (action.targetSessionId
            ? rightRailSessions.find((session) => session.id === action.targetSessionId)
            : null) ??
          rightRailSessions[0] ??
          null;
        const contextPack = buildContextPack({
          workspace: {
            name: projectName,
            path: projectPath,
            branch,
          },
          activeTask: focusSession
            ? {
                id: focusSession.id,
                title: focusSession.name,
                status: focusSession.status,
                nextAction: action.nextStep,
              }
            : null,
          sessions: rightRailSessions,
          changedFiles: rightRailAllChangedFiles,
          panes: visualTerminalPaneTargets.map((pane) => ({
            paneId: pane.paneId,
            terminalId: pane.terminalId,
            title: pane.title || pane.label,
            role: pane.role,
            status: pane.lifecycle,
          })),
          auditEvents: scopedOperationalAuditEvents,
          workstationGraph: rightRailGraph,
        });
        try {
          await copyTextToClipboard(contextPack.markdown);
          showRightRailActionResult(action, "success", "Copied handoff context pack to clipboard.", auditRecord);
          toast.success("Handoff copied", contextPack.threadSummary);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await showRecoverableActionResult("error", message, "failed");
          toast.error("Handoff copy failed", message);
        }
        return;
      }

      showRightRailActionResult(action, "success", action.execution.expectedResult, auditRecord);
    },
    [
      branch,
      decisionInbox.pendingItems,
      handleOpenDiff,
      handleSelectRightRailSession,
      projectName,
      projectPath,
      rightRailAllChangedFiles,
      rightRailGraph,
      rightRailMode,
      rightRailPrimaryChangedFile,
      rightRailSessions,
      scopedOperationalAuditEvents,
      selectOperationalPane,
      showRightRailActionResult,
      visualTerminalPaneTargets,
    ],
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
      return await startInteractiveSession({
        ...opts,
        cols: 120,
        rows: 30,
      });
    },
    [startInteractiveSession],
  );

  // Shared wiring for the three AgentInspector rail instances (command / review
  // / observe). Identical props, so define once and spread to avoid 13x3 drift.
  const agentInspectorProps = {
    sessions: rightRailSessions,
    activeSessionId: rightRailActiveSessionId,
    onSelectSession: handleSelectRightRailSession,
    onStartAgent: handleStartAgent,
    onStopAgent: stopAgent,
    onCreateWorktree: createWorktree,
    onRemoveWorktree: removeWorktree,
    onRenameSession: renameSession,
    interactiveSessions,
    onFocusInteractiveSession: handleFocusInteractiveSession,
    onStopInteractiveSession: stopInteractiveSession,
    onEndSessionAndRemoveWorktree: endSessionAndRemoveWorktree,
    onStartInteractiveSession: handleStartInteractiveSession,
  };

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
  // Native toasts on agent fleet transitions (→waiting_approval / →done / →error).
  // Pass fleetSessions (not sessions) — only the fleet projection carries runStatus.
  useAgentFleetToasts(fleetSessions);

  // ── Session restore (DB bookkeeping + localStorage fallback) ──

  useEffect(() => {
    if (!isTauriRuntime()) return;
    Promise.resolve({ invoke: tauriInvoke })
      .then(({ invoke }) => {
        invoke<{
          session: { id: string; name: string };
          windows: { panes: { shell_type: string; cwd: string }[] }[];
        } | null>("restore_last_session")
          .then((restored) => {
            if (!restored) return;
            // If localStorage had no saved tabs, use DB panes as fallback
            const hasSavedTabs = localStorage.getItem("aelyris:tabs");
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
    if (!isTauriRuntime()) return;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();

        // Restore window position/size
        try {
          const saved = localStorage.getItem("aelyris:windowBounds");
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
                "aelyris:windowBounds",
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
    const title = projectPath ? `${projectName} — ${PRODUCT_NAME}` : PRODUCT_NAME;
    document.title = title;
    if (!isTauriRuntime()) return;
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
  const handleProductModeSelect = useCallback(
    (mode: ProductModeId) => {
      const route = PRODUCT_MODE_ROUTES[mode];
      setProductMode(mode);
      if (route.expandSidebar) setSidebarCollapsed(false);
      if (route.rightRailMode) setRightRailMode(route.rightRailMode);
      if (route.focusWidget !== undefined) setRightRailFocusWidget(route.focusWidget);
      if (route.openHistory) showHistorySearch();
      if (route.openSettings) setSettingsVisible(true);
    },
    [setSettingsVisible, setSidebarCollapsed],
  );

  useEffect(() => {
    const onModeShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const mode = Number.isInteger(index) ? PRODUCT_MODE_RAIL[index] : undefined;
      if (!mode) return;
      event.preventDefault();
      handleProductModeSelect(mode.id);
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-product-mode="${mode.id}"]`)?.focus();
      });
    };
    window.addEventListener("keydown", onModeShortcut);
    return () => window.removeEventListener("keydown", onModeShortcut);
  }, [handleProductModeSelect]);

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
        spawnAgentPaneRequest={paneAgentSpawns?.tabId === tab.id ? paneAgentSpawns : null}
      />
    </div>
  ));

  const liveInteractiveSessionCount = interactiveSessions.filter((session) =>
    isLiveInteractiveSessionStatus(session.status),
  ).length;
  const liveInteractiveNativeFallbackCount = interactiveSessions.filter(
    (session) => isLiveInteractiveSessionStatus(session.status) && session.backend === "native",
  ).length;
  const liveAgentCount =
    rightRailSessions.filter((s) => s.status !== "idle" && s.status !== "done").length + liveInteractiveSessionCount;
  // Sessions that are blocked on a human/operator decision. `status` is the
  // legacy projection where canonical `waiting_approval`/`blocked` both fold to
  // `waiting` (see agentFleet.agentRunStatusToLegacyStatus). Mirrors the
  // attentionCount predicate in workstationSummary.buildWorkstationSummary so the
  // rail and the workstation pulse agree on what "needs attention" means.
  const attentionAgentCount = rightRailSessions.filter(
    (s) => s.status === "waiting" || s.status === "error",
  ).length;
  const rightRailModeBadges: Record<RightRailMode, number> = {
    command: decisionInbox.pendingCount > 0 ? decisionInbox.pendingCount : liveAgentCount,
    review: rightRailAllChangedFiles.length,
    observe: decisionInbox.pendingCount + liveAgentCount,
  };
  const activeRightRailMode = RIGHT_RAIL_MODES.find((mode) => mode.id === rightRailMode) ?? RIGHT_RAIL_MODES[0];
  const rightRailAiCliContextPack = useMemo(
    () =>
      buildContextPack({
        workspace: {
          name: projectName,
          path: projectPath,
          branch,
        },
        activeTask: {
          id: "right-rail-ai-cli-launch",
          title: "Auditable AI CLI launch",
          status: rightRailMode,
          nextAction: "Launch only through the sidecar command-session boundary with attached evidence.",
        },
        sessions: rightRailSessions,
        changedFiles: rightRailAllChangedFiles,
        panes: visualTerminalPaneTargets.map((pane) => ({
          paneId: pane.paneId,
          terminalId: pane.terminalId,
          title: pane.title || pane.label,
          role: pane.role,
          status: pane.lifecycle,
        })),
        auditEvents: scopedOperationalAuditEvents,
        workstationGraph: rightRailGraph,
      }),
    [
      branch,
      projectName,
      projectPath,
      rightRailAllChangedFiles,
      rightRailGraph,
      rightRailMode,
      rightRailSessions,
      scopedOperationalAuditEvents,
      visualTerminalPaneTargets,
    ],
  );
  const rightRailAiCliPromptContract = useMemo<AiCliLaunchPromptContract>(
    () => ({
      objective: `Launch an AI CLI worker for ${projectName} from the right rail with auditable provenance.`,
      contextSummary: rightRailAiCliContextPack.threadSummary,
      contextPack: {
        id: "right-rail-ai-cli-launch-context",
        title: `${projectName} AI CLI launch context`,
        source: "context-panel",
        generatedAt: rightRailAiCliContextPack.json.generatedAt,
        summary: rightRailAiCliContextPack.threadSummary,
        include: ["workspace identity", "changed files", "pane registry", "audit timeline", "workstation graph"],
        exclude: ["raw terminal output", "secrets", "credentials", "token-spending prompt transcript"],
        changedFiles: rightRailAiCliContextPack.json.changedFiles.map((file) => file.path),
        redactionCount: rightRailAiCliContextPack.json.summary.redactionCount,
      },
      expectedOutput:
        "A run trace that links provider, role, pane, file provenance, recovery actions, and final report.",
      doneCriteria: [
        "AI CLI launch uses the sidecar command-session boundary.",
        "Context pack and guardrails are attached before the first prompt.",
        "Output evidence links panes, changed files, recovery actions, and handoff context.",
      ],
      guardrails: [
        "Do not execute token-spending prompt smoke without explicit consent.",
        "Do not use native fallback for AI CLI sessions when sidecar command-session is available.",
        "Do not persist raw terminal output as prompt evidence.",
      ],
      artifacts: [
        ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
        ".codex-auto/production-smoke/native-terminal-input-host.json",
        ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
        ".codex-auto/quality/mux-live-process-preservation.json",
        ".codex-auto/production-smoke/interactive-ai-cli-boundary.json",
      ],
    }),
    [projectName, rightRailAiCliContextPack],
  );
  const rightRailAiCliLaunchPlan = useMemo(
    () =>
      deriveAiCliLaunchPlan({
        evidence: rightRailAiCliLaunchEvidence.evidence,
        interactiveSessions,
        preflight: rightRailAiCliLaunchEvidence.preflight,
        preferredProvider: activeInteractive?.cli ?? "claude",
        changedFilesCount: rightRailAllChangedFiles.length,
        pendingDecisionCount: decisionInbox.pendingCount,
        promptContract: rightRailAiCliPromptContract,
        requirePreflight: true,
        requirePromptContract: true,
        selectedPaneRole: selectedOperationalPaneTarget?.role ?? null,
      }),
    [
      activeInteractive?.cli,
      decisionInbox.pendingCount,
      interactiveSessions,
      rightRailAiCliLaunchEvidence,
      rightRailAiCliPromptContract,
      rightRailAllChangedFiles.length,
      selectedOperationalPaneTarget?.role,
    ],
  );
  const rightRailAdvisorBaseInput = {
    sessions: rightRailSessions,
    interactiveSessionCount: liveInteractiveSessionCount,
    interactiveNativeFallbackCount: liveInteractiveNativeFallbackCount,
    recentFallbackEvents: fallbackTelemetryEvents,
    changedFilesCount: rightRailAllChangedFiles.length,
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
    aiCliLaunchPlan: rightRailAiCliLaunchPlan,
  };
  const rightRailWorkforce = deriveRightRailWorkforceSummary(rightRailAdvisorBaseInput);
  const rightRailGuardrailProfile =
    rightRailGuardrailSelection === "Auto" ? rightRailWorkforce.guardrailProfile : rightRailGuardrailSelection;
  const rightRailGuardrailDescriptor = describeGuardrailProfile(rightRailGuardrailProfile);
  const rightRailGuardrailDetail =
    rightRailGuardrailSelection === "Auto"
      ? rightRailWorkforce.guardrailDetail
      : `Manual override: ${rightRailGuardrailDescriptor.detail}`;
  rightRailGuardrailProfileRef.current = rightRailGuardrailProfile;
  const rightRailAdvisorInput = {
    ...rightRailAdvisorBaseInput,
    guardrailProfile: rightRailGuardrailProfile,
  };
  const rightRailNegativePathAction = createDevVisualQaNegativePathAction(devVisualQa.negativePath);
  const rightRailBaseActions = deriveRightRailActions(rightRailAdvisorInput);
  const rightRailActions = rightRailNegativePathAction
    ? [rightRailNegativePathAction, ...rightRailBaseActions]
    : rightRailBaseActions;
  const rightRailModeActions = rightRailActions.filter((action) => action.mode === rightRailMode);
  const rightRailVisibleActions = [
    ...rightRailModeActions,
    ...rightRailActions.filter((action) => action.mode !== rightRailMode),
  ].slice(0, 3);
  const rightRailPrimaryActions = rightRailVisibleActions.slice(0, 1);
  const rightRailDeferredActionCount = Math.max(0, rightRailActions.length - rightRailPrimaryActions.length);
  const rightRailPrimaryAction = rightRailModeActions[0] ?? rightRailActions[0] ?? null;
  const rightRailRunLoopPhase = rightRailPrimaryAction ? RIGHT_RAIL_ACTION_PHASE[rightRailPrimaryAction.id] : "Run";
  const rightRailRunLoopDetail = rightRailPrimaryAction?.nextStep ?? "Ready for command";
  const rightRailRunLoopTarget = rightRailPrimaryAction?.target.label ?? activeRightRailMode.label;
  const rightRailRunLoopEvidence = rightRailPrimaryAction?.execution.evidence ?? activeRightRailMode.description;
  const rightRailRunLoopRecovery = rightRailPrimaryAction?.execution.recoveryStep ?? "No recovery step queued";
  const rightRailRunLoopTraceItems = [
    { id: "evidence", label: "Evidence", detail: rightRailRunLoopEvidence },
    { id: "target", label: "Target", detail: rightRailRunLoopTarget },
    { id: "recovery", label: "Recovery", detail: rightRailRunLoopRecovery },
  ] as const;
  const activeProductMode = PRODUCT_MODE_RAIL.find((mode) => mode.id === productMode) ?? PRODUCT_MODE_RAIL[0];
  const activeProductModeRoute = PRODUCT_MODE_ROUTES[productMode];
  const activeProductInspector = PRODUCT_MODE_INSPECTOR_SUMMARY[productMode];
  const rightRailInspectorPrimaryAction =
    rightRailPrimaryAction?.execution.label ??
    (activeProductModeRoute.openSettings
      ? "Open settings"
      : activeProductModeRoute.openHistory
        ? "Open history"
        : activeRightRailMode.label);
  const rightRailInspectorTarget =
    activeProductModeRoute.focusWidget ?? rightRailPrimaryAction?.target.widget ?? activeProductInspector.target;
  const rightRailInspectorProof = formatInspectorProof(
    rightRailPrimaryAction?.execution.evidence,
    activeProductInspector.proof ?? activeRightRailMode.description,
  );
  const rightRailInspectorProofState = rightRailPrimaryAction?.execution.status ?? "ready";
  const rightRailEdgeScore = deriveRightRailEdgeScore({
    pendingDecisionCount: decisionInbox.pendingCount,
    liveAgentCount,
    changedFilesCount: rightRailAllChangedFiles.length,
    auditEventCount: scopedOperationalAuditEvents.length,
    graphRiskCount: rightRailGraph.nodeCountByKind.risk + rightRailRuntimeFallbackEvents.length,
    actionCount: rightRailActions.length,
    recoverableActionCount: rightRailActions.filter(
      (action) => action.execution.recoveryStep || action.execution.status === "guided",
    ).length,
  });
  rightRailEdgeScoreRef.current = { score: rightRailEdgeScore.score, grade: rightRailEdgeScore.grade };
  const rightRailGoalTrack = deriveRightRailGoalTrack({
    edgeScore: rightRailEdgeScore.score,
    edgeGrade: rightRailEdgeScore.grade,
    edgeItems: rightRailEdgeScore.items,
    qualityEvidenceStatus: releaseQualityGoalInputs?.evidenceStatus,
    qualityEvidenceLabel: releaseQualityGoalInputs?.evidenceLabel,
    qualityEvidenceDetail: releaseQualityGoalInputs?.evidenceDetail,
    qualityEvidenceLocalDate: releaseQualityGoalInputs?.localDate,
    qualityEvidenceTimeZone: releaseQualityGoalInputs?.timeZone,
    aiCliLaunchPlanStatus: rightRailAiCliLaunchPlan.status,
    interactiveSessionCount: liveInteractiveSessionCount,
    interactiveNativeFallbackCount: liveInteractiveNativeFallbackCount,
    changedFilesCount: rightRailAllChangedFiles.length,
    pendingDecisionCount: decisionInbox.pendingCount,
    graphRiskCount: rightRailGraphReleaseRiskNodes.length,
    graphRiskSummaries: rightRailGraphRiskSummaries,
    runtimeFallbackCount: rightRailRuntimeFallbackEvents.length,
    runtimeFallbackSummaries: rightRailRuntimeFallbackSummaries,
    qaRiskCount: rightRailGraphQaRiskNodes.length,
    qaRiskSummaries: rightRailGraphQaRiskSummaries,
    terminalCoreReady: releaseQualityGoalInputs?.terminalCoreReady,
    commandCenterScenarioReady: releaseQualityGoalInputs?.commandCenterScenarioReady,
    themeCustomizationReady: releaseQualityGoalInputs?.themeCustomizationReady,
    authenticatedPromptConsentRequired: releaseQualityGoalInputs?.authenticatedPromptConsentRequired ?? true,
    authenticatedPromptConsentPacket,
    releaseBlockers: releaseQualityGoalInputs?.releaseBlockers,
    residualRisk: finalGoalResidualRisk,
    safeGate: finalGoalSafeGate,
    requirementProofs: finalGoalRequirementProofs,
  });
  const rightRailEssentialChecks = rightRailGoalTrack.safeGate
    ? `${rightRailGoalTrack.safeGate.proofArtifactPassCount}/${rightRailGoalTrack.safeGate.proofArtifactCount}`
    : `${rightRailGoalTrack.doneCount}/${rightRailGoalTrack.totalCount}`;
  const rightRailEvidenceDrawerSummary = `${rightRailEdgeScore.score} ${rightRailEdgeScore.grade} · ${rightRailGoalTrack.percent}% · checks ${rightRailEssentialChecks}`;
  const rightRailQueueCount = rightRailDeferredActionCount + decisionInbox.pendingCount;
  const rightRailToolkitSummary =
    rightRailQueueCount > 0 ? `${rightRailQueueCount} queued` : activeTerminalTarget.ready ? "Ready" : "No pane";
  const rightRailToolkitDetail = "Git, VS Code, worktrees";
  const rightRailWorktreeScopedCount =
    rightRailSessions.filter((session) => Boolean(session.worktree || session.workspaceScope)).length +
    interactiveSessions.filter((session) => Boolean(session.worktree_branch || session.worktree_path)).length;
  const rightRailOrchestraLanes = ORCHESTRA_ROLES.map((role) => {
    const roleSessions = rightRailSessions.filter((session) => session.role === role.id);
    const live = roleSessions.filter((session) => session.status !== "idle" && session.status !== "done").length;
    const changed = roleSessions.reduce((total, session) => total + (session.changedFileDetails?.length ?? 0), 0);
    return {
      ...role,
      live,
      total: roleSessions.length,
      changed,
      state: live > 0 ? "running" : roleSessions.length > 0 ? "ready" : "empty",
    };
  });
  const rightRailOrchestraHeadline =
    liveAgentCount > 0 ? `${liveAgentCount} active worker${liveAgentCount === 1 ? "" : "s"}` : "Ready to dispatch";
  const rightRailOrchestraDetail = `${visualTerminalPaneTargets.length} pane${
    visualTerminalPaneTargets.length === 1 ? "" : "s"
  } · ${rightRailWorktreeScopedCount} worktree${rightRailWorktreeScopedCount === 1 ? "" : "s"} · ${
    rightRailAllChangedFiles.length
  } file${rightRailAllChangedFiles.length === 1 ? "" : "s"}`;
  const rightRailAgentsSummary = summarizeAgentLane({
    attentionCount: attentionAgentCount,
    liveCount: liveAgentCount,
    totalCount: rightRailSessions.length,
  });
  const rightRailAgentsDetail = `${rightRailWorktreeScopedCount} scoped · ${rightRailOrchestraLanes.filter((lane) => lane.total > 0).length}/${
    rightRailOrchestraLanes.length
  } roles`;
  const rightRailReviewSummary =
    rightRailAllChangedFiles.length > 0
      ? `${rightRailAllChangedFiles.length} changed`
      : rightRailSessions.some((session) => session.finalReport)
        ? "Reports ready"
        : "Clean";
  const rightRailReviewDetail = "diffs, SCM, reports";
  const rightRailNowState = deriveRightRailNowState(rightRailAdvisorInput);
  const rightRailHealthDrawerSummary = `${rightRailNowState.label} · ${rightRailWorkforce.liveCount} live`;
  const rightRailGoalTrackConsentProviders = rightRailGoalTrack.consentPacket
    ? Array.from(
        new Set(
          (rightRailGoalTrack.consentPacket.providerReadiness ?? [])
            .map((entry) => entry.provider)
            .filter((provider) => provider.length > 0),
        ),
      )
    : [];
  const rightRailGoalTrackConsentProviderEnv = rightRailGoalTrack.consentPacket
    ? `AELYRIS_AUTH_PROMPT_PROVIDER=${(
        rightRailGoalTrackConsentProviders.length > 0
          ? rightRailGoalTrackConsentProviders
          : ["codex", "claude", "gemini"]
      ).join("|")}`
    : "";
  const rightRailRecommendation = deriveRightRailRecommendation(rightRailAdvisorInput);
  const rightRailRecommendedMode = rightRailRecommendation
    ? RIGHT_RAIL_MODES.find((mode) => mode.id === rightRailRecommendation.mode)
    : undefined;
  const RightRailRecommendedIcon = rightRailRecommendedMode?.icon;
  const rightRailHasBlockingDecision = decisionInbox.pendingCount > 0;
  const rightRailDecisionFocus = {
    tone: rightRailHasBlockingDecision ? ("warn" as const) : ("quiet" as const),
    label: rightRailHasBlockingDecision ? "Needs your decision" : "No decisions waiting",
    detail: rightRailHasBlockingDecision
      ? `${decisionInbox.pendingCount} human gate${decisionInbox.pendingCount === 1 ? "" : "s"} blocking forward motion`
      : "Agents and workflows can continue without your input.",
    actionLabel: rightRailHasBlockingDecision ? "Open inbox" : "View decisions",
  };
  const rightRailTruthNotice = devVisualQa.enabled
    ? {
        label: "Visual QA simulation",
        detail: [
          devVisualQa.railScenarioExplicit
            ? `${devVisualQa.railScenarioParam ?? "railState"}=${devVisualQa.railScenario} is fixture state; runtime truth is unchanged.`
            : "Fixtures are active only for this development URL.",
          devVisualQa.hasUrlEdgeLoop ? "edgeLoop is replay evidence, not current runtime state." : null,
          devVisualQa.usesDeprecatedStateAlias ? "Use railState instead of the deprecated state alias." : null,
        ]
          .filter((part): part is string => part != null)
          .join(" "),
      }
    : null;
  const handleStartRightRailOrchestra = useCallback(async () => {
    if (!projectPath) {
      toast.error("No workspace", "Open a project before dispatching an agent team.");
      return;
    }
    const defaultTask =
      rightRailPrimaryAction?.nextStep ??
      (rightRailAllChangedFiles.length > 0
        ? `Finish and review ${rightRailAllChangedFiles.length} changed file${
            rightRailAllChangedFiles.length === 1 ? "" : "s"
          } in ${projectName}.`
        : `Plan and implement the next parallel development task for ${projectName}.`);
    const changedFiles = rightRailAllChangedFiles.map((file) => file.path);
    // Fetch the SAME backend-rendered ownership context the loop injects (SSOT) so the
    // hand-launched roles are warned off the symbols other agents own. Browser-dev (no
    // backend) simply skips the consult — the launch path itself requires Tauri. A real
    // Tauri/backend FAILURE is different: it must NOT be collapsed into "0 claims"
    // (= looks parallel-safe). Track it separately so the dialog warns safety is UNKNOWN.
    let ownershipContext: OwnershipPromptSection | undefined;
    let ownershipUnavailable = false;
    if (isTauriRuntime()) {
      try {
        ownershipContext = await tauriInvoke<OwnershipPromptSection>("symbol_ownership_prompt_section", {
          files: changedFiles,
          forAgent: null,
        });
      } catch (error) {
        ownershipContext = undefined;
        ownershipUnavailable = true;
        console.error("[Orchestra] symbol_ownership_prompt_section failed", error);
      }
    }
    const result = await showOrchestra({
      defaultTask,
      defaultRoles: ["implementer", "tester", "reviewer"],
      activeClaimCount: ownershipContext?.claimCount ?? 0,
      ownershipUnavailable,
    });
    if (!result || result.roles.length === 0) return;
    const prompts = buildOrchestraPrompts({
      task: result.task,
      roles: result.roles,
      projectPath,
      changedFiles,
      pendingDecisionCount: decisionInbox.pendingCount,
      existingSessionCount: sessions.length + interactiveSessions.length,
      ownershipContext,
    });
    const routedPrompts = await routeOrchestraPrompts(
      prompts,
      (prompt) => tauriInvoke<OrchestraRoutingDecision>("route_agent", { prompt }),
      isTauriRuntime(),
    );
    const launches = await launchOrchestraPrompts(routedPrompts, projectPath, handleStartInteractiveSession);
    if (launches.length === 0) {
      toast.error("Orchestra dispatch failed", "No agent session could be started.");
      return;
    }
    // Mount each launched role as a live central pane (WU-VP-1) in one tiling
    // pass, and remember role → pane so its lane card can focus it (DoD#6).
    mountAgentPtyInPane(
      launches.map((launch) => ({
        terminalId: launch.terminalId,
        model: launch.model,
        backend: launch.backend === "sidecar" ? "sidecar" : "native",
        durability: launch.backend === "sidecar" ? "tmux-durable" : "degraded",
        spawnedAt: new Date().toISOString(),
        ...(launch.roleId ? { roleId: launch.roleId } : {}),
        ...(launch.branchName ? { branchName: launch.branchName } : {}),
      })),
      activeTabId,
    );
    setOrchestraRolePanes((prev) => {
      const next = new Map(prev);
      for (const launch of launches) next.set(launch.roleId, { terminalId: launch.terminalId, tabId: activeTabId });
      return next;
    });
    // spawn_interactive_agent selects each spawned session, and the main tab's
    // pane tree only renders while no interactive session is selected — so the
    // last-spawned agent tab would hide the panes we just mounted. Clear the
    // selection so the operator lands on the tiled role panes, not an agent tab.
    selectInteractiveSession("");
    setRightRailMode("command");
    setRightRailFocusWidget("sessions");
    toast.success(
      "Orchestra dispatched",
      `${launches.length} agent${launches.length === 1 ? "" : "s"} launched in role-scoped panes.`,
    );
  }, [
    activeTabId,
    decisionInbox.pendingCount,
    handleStartInteractiveSession,
    interactiveSessions.length,
    mountAgentPtyInPane,
    projectName,
    projectPath,
    rightRailAllChangedFiles,
    rightRailAllChangedFiles.length,
    rightRailPrimaryAction?.nextStep,
    selectInteractiveSession,
    sessions.length,
  ]);
  const renderRightRailDestinationPrompt = (widget: string) =>
    rightRailDestinationPrompt?.widget === widget ? (
      <RightRailDestinationPromptCard prompt={rightRailDestinationPrompt} />
    ) : null;
  const rightRailEdgeFeedbackStaleEntries = useMemo(
    () => deriveRightRailEdgeFeedbackStaleEntries(rightRailEdgeFeedbackHistory, rightRailEdgeScore),
    [rightRailEdgeFeedbackHistory, rightRailEdgeScore],
  );
  const rightRailEdgeFeedbackStaleIds = useMemo(
    () => new Set(rightRailEdgeFeedbackStaleEntries.map(({ entry }) => entry.id)),
    [rightRailEdgeFeedbackStaleEntries],
  );
  const rightRailEdgeFeedbackVisibleHistory = useMemo(
    () =>
      rightRailEdgeFeedbackStaleOnly
        ? rightRailEdgeFeedbackHistory.filter((entry) => rightRailEdgeFeedbackStaleIds.has(entry.id))
        : rightRailEdgeFeedbackHistory,
    [rightRailEdgeFeedbackHistory, rightRailEdgeFeedbackStaleIds, rightRailEdgeFeedbackStaleOnly],
  );
  const rightRailEdgeFeedbackStaleGroups = useMemo(
    () =>
      rightRailEdgeFeedbackStaleOnly ? deriveRightRailEdgeFeedbackStaleGroups(rightRailEdgeFeedbackStaleEntries) : [],
    [rightRailEdgeFeedbackStaleEntries, rightRailEdgeFeedbackStaleOnly],
  );
  const rightRailEdgeFeedbackStaleCount = rightRailEdgeFeedbackStaleEntries.length;
  const rightRailEdgeFeedbackStaleCountLabel = `${rightRailEdgeFeedbackStaleCount} stale score loop ${
    rightRailEdgeFeedbackStaleCount === 1 ? "entry" : "entries"
  }`;
  useEffect(() => {
    if (!projectPath || rightRailEdgeFeedbackStaleEntries.length === 0) return;
    for (const { entry, staleReason } of rightRailEdgeFeedbackStaleEntries) {
      const telemetryKey = `${projectPath}:${entry.id}:${staleReason}`;
      if (rightRailEdgeFeedbackStaleTelemetryRef.current.has(telemetryKey)) continue;
      rightRailEdgeFeedbackStaleTelemetryRef.current.add(telemetryKey);
      void appendRightRailEdgeFeedbackStaleAudit({
        entry,
        workspaceId: projectPath,
        staleReason,
      });
    }
  }, [projectPath, rightRailEdgeFeedbackStaleEntries]);
  useEffect(() => {
    if (rightRailEdgeFeedbackStaleEntries.length === 0 && rightRailEdgeFeedbackStaleOnly) {
      setRightRailEdgeFeedbackStaleOnly(false);
    }
  }, [rightRailEdgeFeedbackStaleEntries.length, rightRailEdgeFeedbackStaleOnly]);
  const rightRailEdgeFeedbackAxisSummary = deriveRightRailEdgeFeedbackAxisSummary(rightRailEdgeFeedbackHistory);
  const rightRailEdgeNextBestAction = deriveRightRailEdgeNextBestAction(
    rightRailEdgeScore,
    rightRailEdgeFeedbackAxisSummary,
  );
  const rightRailEdgeRecommendationOutcome = deriveRightRailEdgeRecommendationOutcome({
    nextAction: rightRailEdgeNextBestAction,
    prompt: rightRailDestinationPrompt,
    latestFeedback: rightRailEdgeFeedbackHistory[0],
  });

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
              <nav className="mode-rail" aria-label={`${PRODUCT_NAME} mode rail`} data-active-mode={productMode}>
                <div className="mode-rail-brand" aria-hidden="true">
                  {PRODUCT_NAME[0]}
                </div>
                <div className="mode-rail-list">
                  {PRODUCT_MODE_RAIL.map((mode) => {
                    const Icon = mode.icon;
                    const active = productMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        className="mode-rail-button"
                        data-active={active ? "true" : "false"}
                        data-product-mode={mode.id}
                        aria-pressed={active}
                        aria-label={`${mode.label}. ${mode.description} ${mode.shortcut}`}
                        title={`${mode.shortcut} - ${mode.description}`}
                        onClick={() => handleProductModeSelect(mode.id)}
                      >
                        <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                        <span className="mode-rail-label">{mode.label}</span>
                        <span className="mode-rail-shortcut">{mode.shortcut.replace("Alt+", "")}</span>
                      </button>
                    );
                  })}
                </div>
              </nav>
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
                        sessions={sessions}
                        onActivateTask={(taskId) => {
                          // Jump from a task card to its linked agent: headless
                          // agents launched here are inspector session cards (not
                          // PTY panes), so reveal the sessions inspector and select
                          // the run by its `assignedAgentId` (the session id).
                          const task = kanbanTasks.find((t) => t.id === taskId);
                          if (!task?.assignedAgentId) return;
                          // Don't switch the inspector mode for a session that
                          // has already been pruned — that reads as a dead click.
                          if (!sessions.some((s) => s.id === task.assignedAgentId)) {
                            toast.info("Agent session has ended", "This task's agent run is no longer active.");
                            return;
                          }
                          setRightRailMode("command");
                          handleSelectRightRailSession(task.assignedAgentId);
                        }}
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
                          handleFileSelect(file, { line });
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
                aria-label="Contextual inspector"
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
                  <div className="right-panel-mode-switch" role="tablist" aria-label="Inspector mode">
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
                    <span className={appStyles.rightRailPurposeKicker}>Orchestra Command</span>
                    <span className={appStyles.rightRailPurposeText}>{activeRightRailMode.description}</span>
                  </div>

                  <details className="right-panel-advanced-drawer">
                    <summary>
                      <span>Mode target</span>
                      <small>{activeProductMode.label}</small>
                    </summary>
                    <section
                      className="right-panel-inspector-hero"
                      data-product-mode={productMode}
                      data-proof-state={rightRailInspectorProofState}
                      aria-label={`${activeProductMode.label} inspector summary`}
                    >
                      <div className="right-panel-inspector-hero-head">
                        <span className="right-panel-inspector-kicker">Mode</span>
                        <strong>{activeProductMode.label}</strong>
                        <span>{activeProductMode.shortcut}</span>
                      </div>
                      <p className="right-panel-inspector-description">{activeProductMode.description}</p>
                      <dl className="right-panel-inspector-grid" aria-label="Selected mode target and proof">
                        <div data-kind="target">
                          <dt>Target</dt>
                          <dd>{activeProductInspector.target}</dd>
                        </div>
                        <div data-kind="owner">
                          <dt>Owner</dt>
                          <dd>{activeProductInspector.owner}</dd>
                        </div>
                        <div data-kind="action">
                          <dt>Action</dt>
                          <dd>{rightRailInspectorPrimaryAction}</dd>
                        </div>
                        <div data-kind="proof">
                          <dt>Proof</dt>
                          <dd>{rightRailInspectorProof}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        className="right-panel-inspector-open"
                        data-target={rightRailInspectorTarget}
                        onClick={() => handleProductModeSelect(productMode)}
                        aria-label={`Open ${activeProductMode.label} target ${rightRailInspectorTarget}`}
                        title={`${activeProductMode.label}: ${rightRailInspectorTarget}`}
                      >
                        <span>Open target</span>
                        <small>{rightRailInspectorTarget}</small>
                      </button>
                    </section>
                  </details>

                  <section
                    className="right-panel-run-loop right-panel-orchestra-command"
                    data-phase={rightRailRunLoopPhase}
                    data-mode={rightRailMode}
                    data-action-id={rightRailPrimaryAction?.id ?? "none"}
                    data-action-mode={rightRailPrimaryAction?.mode ?? "none"}
                    data-operation={rightRailPrimaryAction?.execution.operation ?? "none"}
                    data-target={rightRailRunLoopTarget}
                    data-orchestra-ready={projectPath ? "true" : "false"}
                    aria-label={`Orchestra Command: ${rightRailOrchestraHeadline}`}
                  >
                    <div className="right-panel-run-loop-main">
                      <span className="right-panel-run-loop-kicker">Orchestra Command</span>
                      <strong>{rightRailOrchestraHeadline}</strong>
                      <span>{rightRailOrchestraDetail}</span>
                    </div>
                    <ul className="right-panel-orchestra-lanes" aria-label="Role lanes">
                      {rightRailOrchestraLanes.map((lane) => {
                        const pane = orchestraRolePanes.get(lane.id);
                        const focusable = Boolean(pane);
                        return (
                          // The lane item doubles as a focus shortcut to its agent pane; a
                          // nested button would break the flex lane layout. Interactive
                          // props are only attached when a pane exists for the role.
                          <li
                            key={lane.id}
                            data-role={lane.id}
                            data-state={lane.state}
                            data-focusable={focusable ? "" : undefined}
                            style={{ "--lane-color": lane.color } as React.CSSProperties}
                            title={
                              focusable
                                ? `Focus ${lane.label} agent pane`
                                : `${lane.label}: ${lane.live} live, ${lane.total} total, ${lane.changed} changed files`
                            }
                            role={focusable ? "button" : undefined}
                            tabIndex={focusable ? 0 : undefined}
                            aria-label={focusable ? `Focus ${lane.label} agent pane` : undefined}
                            onClick={pane ? () => void handlePaneSwitch(pane.tabId, pane.terminalId) : undefined}
                            onKeyDown={
                              pane
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      void handlePaneSwitch(pane.tabId, pane.terminalId);
                                    }
                                  }
                                : undefined
                            }
                          >
                            <span>{lane.icon}</span>
                            <strong>{lane.label}</strong>
                            <small>
                              {lane.live > 0 ? `${lane.live} live` : lane.total > 0 ? `${lane.total} ready` : "open"}
                            </small>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="right-panel-orchestra-actions" role="toolbar" aria-label="Orchestra actions">
                      <button
                        type="button"
                        className="right-panel-orchestra-primary"
                        onClick={() => void handleStartRightRailOrchestra()}
                        disabled={!projectPath}
                        aria-label="Dispatch an Orchestra agent team"
                        title="Launch role-scoped agents in parallel"
                      >
                        <Users size={12} strokeWidth={1.9} aria-hidden="true" />
                        <span>Dispatch team</span>
                      </button>
                      <button
                        type="button"
                        className="right-panel-orchestra-secondary"
                        onClick={() => {
                          setRightRailMode("command");
                          setRightRailFocusWidget("sessions");
                        }}
                        aria-label="Open agent sessions"
                        title="Open the detailed Agent Inspector"
                      >
                        Agents
                      </button>
                      <button
                        type="button"
                        className="right-panel-orchestra-secondary"
                        onClick={() => {
                          setRightRailMode("command");
                          setRightRailFocusWidget("toolkit");
                        }}
                        aria-label="Open Git, VS Code, and worktree toolkit"
                        title="Open Toolkit"
                      >
                        Toolkit
                      </button>
                    </div>
                    <details className="right-panel-run-loop-disclosure" title={rightRailRunLoopDetail}>
                      <summary>
                        <span>Next route</span>
                        <small>{rightRailRunLoopTarget}</small>
                      </summary>
                      <dl className="right-panel-run-loop-trace" aria-label="Primary action trace">
                        {rightRailRunLoopTraceItems.map((item) => (
                          <div key={item.id} data-kind={item.id}>
                            <dt>{item.label}</dt>
                            <dd>{item.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    <button
                      type="button"
                      className="right-panel-run-loop-action"
                      data-execution={rightRailPrimaryAction?.execution.status ?? "ready"}
                      disabled={rightRailPrimaryAction?.execution.status === "blocked"}
                      onClick={() =>
                        rightRailPrimaryAction
                          ? void handleRightRailAction(rightRailPrimaryAction)
                          : setRightRailMode(activeRightRailMode.id)
                      }
                      aria-label={`Run loop action: ${
                        rightRailPrimaryAction?.execution.label ?? activeRightRailMode.label
                      }. Target ${rightRailRunLoopTarget}`}
                      title={`${rightRailRunLoopEvidence}. Target: ${rightRailRunLoopTarget}`}
                    >
                      <span>{rightRailPrimaryAction?.execution.label ?? activeRightRailMode.label}</span>
                      <small>{rightRailRunLoopTarget}</small>
                    </button>
                  </section>

                  {rightRailHasBlockingDecision && (
                    <button
                      type="button"
                      className="right-panel-decision-focus"
                      data-tone={rightRailDecisionFocus.tone}
                      data-has-decision={rightRailHasBlockingDecision ? "true" : "false"}
                      onClick={() => {
                        setRightRailMode("command");
                        setRightRailFocusWidget("decision-inbox");
                      }}
                      aria-label={`Decision focus: ${rightRailDecisionFocus.label}. ${rightRailDecisionFocus.detail}`}
                      title={`${rightRailDecisionFocus.label}: ${rightRailDecisionFocus.detail}`}
                    >
                      <span className="right-panel-decision-kicker">Decision</span>
                      <span className="right-panel-decision-copy">
                        <span className="right-panel-decision-label">{rightRailDecisionFocus.label}</span>
                        <span className="right-panel-decision-detail">{rightRailDecisionFocus.detail}</span>
                      </span>
                      <span className="right-panel-decision-action">{rightRailDecisionFocus.actionLabel}</span>
                    </button>
                  )}

                  {rightRailTruthNotice && (
                    <section
                      className="right-panel-truth-notice"
                      data-source="visual-qa"
                      aria-label={`${rightRailTruthNotice.label}: ${rightRailTruthNotice.detail}`}
                    >
                      <span className="right-panel-truth-notice-kicker">Truth source</span>
                      <strong>{rightRailTruthNotice.label}</strong>
                      <span>{rightRailTruthNotice.detail}</span>
                    </section>
                  )}

                  <section className="right-panel-essential-grid" aria-label="Command center essentials">
                    <button
                      type="button"
                      className="right-panel-essential-card"
                      data-tone={activeTerminalTarget.ready ? "good" : "review"}
                      onClick={() => {
                        setRightRailMode("command");
                        setRightRailFocusWidget("toolkit");
                      }}
                      aria-label={`Toolkit status: ${rightRailToolkitSummary}. ${rightRailToolkitDetail}`}
                      title={`Toolkit: ${rightRailToolkitDetail}`}
                    >
                      <span>Toolkit</span>
                      <strong>{rightRailToolkitSummary}</strong>
                      <small>{rightRailToolkitDetail}</small>
                    </button>
                    <button
                      type="button"
                      className="right-panel-essential-card"
                      data-tone={liveAgentCount > 0 ? "running" : rightRailSessions.length > 0 ? "review" : "active"}
                      onClick={() => {
                        setRightRailMode("command");
                        setRightRailFocusWidget("sessions");
                      }}
                      aria-label={`Agent lanes: ${rightRailAgentsSummary}. ${rightRailAgentsDetail}`}
                      title={`Agents: ${rightRailAgentsDetail}`}
                    >
                      <span>Agents</span>
                      <strong>{rightRailAgentsSummary}</strong>
                      <small>{rightRailAgentsDetail}</small>
                    </button>
                    <button
                      type="button"
                      className="right-panel-essential-card"
                      data-tone={rightRailAllChangedFiles.length > 0 ? "review" : "good"}
                      onClick={() => {
                        setRightRailMode("review");
                        setRightRailFocusWidget("review-queue");
                      }}
                      aria-label={`Review lane: ${rightRailReviewSummary}. ${rightRailReviewDetail}`}
                      title={`Review: ${rightRailReviewDetail}`}
                    >
                      <span>Review</span>
                      <strong>{rightRailReviewSummary}</strong>
                      <small>{rightRailReviewDetail}</small>
                    </button>
                  </section>

                  <details className="right-panel-evidence-drawer">
                    <summary>
                      <span>Evidence</span>
                      <small>{rightRailEvidenceDrawerSummary}</small>
                    </summary>
                    <section
                      className="right-panel-edge-score"
                      data-tone={rightRailEdgeScore.tone}
                      aria-label={`Command center edge score ${rightRailEdgeScore.score}`}
                    >
                      <div className="right-panel-edge-score-head">
                        <span className="right-panel-edge-score-kicker">Edge score</span>
                        <strong>{rightRailEdgeScore.score}</strong>
                        <span>{rightRailEdgeScore.grade}</span>
                      </div>
                      <span className="right-panel-edge-score-label">{rightRailEdgeScore.label}</span>
                      <span className="right-panel-edge-score-detail">{rightRailEdgeScore.detail}</span>
                      <details className="right-panel-edge-score-breakdown">
                        <summary>
                          <span>Breakdown</span>
                          <small>{rightRailEdgeScore.items.length} axes</small>
                        </summary>
                        <ul className="right-panel-edge-score-grid" aria-label="Command center score breakdown">
                          {rightRailEdgeScore.items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                className="right-panel-edge-score-item"
                                data-status={item.status}
                                onClick={() => handleOpenRightRailEdgeScoreItem(item)}
                                aria-label={`${item.label}: ${item.detail}. ${item.actionLabel}`}
                                title={`${item.routeTitle}: ${item.routeDetail}`}
                              >
                                <strong>{item.label}</strong>
                                <small>
                                  {item.score}/{item.max}
                                </small>
                                <span className="right-panel-edge-score-action">{item.actionLabel}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </section>

                    <section
                      className="right-panel-goal-track"
                      data-status={rightRailGoalTrack.status}
                      aria-label={`Final goal track: ${rightRailGoalTrack.label}`}
                    >
                      <div className="right-panel-goal-track-head">
                        <span className="right-panel-goal-track-kicker">Final goal</span>
                        <strong>{rightRailGoalTrack.percent}%</strong>
                        <span>{rightRailGoalTrack.confidenceLabel}</span>
                      </div>
                      <div
                        className="right-panel-goal-track-bar"
                        role="progressbar"
                        aria-label="Final goal progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={rightRailGoalTrack.percent}
                      >
                        <span style={{ width: `${rightRailGoalTrack.percent}%` }} />
                      </div>
                      <span
                        className="right-panel-goal-track-source"
                        data-status={rightRailGoalTrack.qualityEvidence.status}
                        data-local-date={rightRailGoalTrack.qualityEvidence.localDate ?? ""}
                        data-time-zone={rightRailGoalTrack.qualityEvidence.timeZone ?? ""}
                        title={rightRailGoalTrack.qualityEvidence.detail}
                      >
                        <strong>{rightRailGoalTrack.qualityEvidence.label}</strong>
                        <small>{rightRailGoalTrack.qualityEvidence.detail}</small>
                      </span>
                      {rightRailGoalTrack.residualRisk && (
                        <div
                          className="right-panel-goal-track-residual"
                          data-state={rightRailGoalTrack.residualRisk.state}
                          data-source={rightRailGoalTrack.residualRisk.source}
                          data-implementation-fixable-count={rightRailGoalTrack.residualRisk.implementationFixableCount}
                          data-policy-blocked-count={rightRailGoalTrack.residualRisk.policyBlockedCount}
                          data-external-blocked-count={rightRailGoalTrack.residualRisk.externalBlockedCount ?? 0}
                          title={`${rightRailGoalTrack.residualRisk.label}: ${rightRailGoalTrack.residualRisk.detail}`}
                        >
                          <strong>{rightRailGoalTrack.residualRisk.label}</strong>
                          <small>{rightRailGoalTrack.residualRisk.detail}</small>
                        </div>
                      )}
                      {rightRailGoalTrack.safeGate && (
                        <div
                          className="right-panel-goal-track-safe"
                          data-status={rightRailGoalTrack.safeGate.status}
                          data-source={rightRailGoalTrack.safeGate.source}
                          data-proof-requirement-pass-count={rightRailGoalTrack.safeGate.proofRequirementPassCount}
                          data-proof-requirement-count={rightRailGoalTrack.safeGate.proofRequirementCount}
                          data-proof-artifact-pass-count={rightRailGoalTrack.safeGate.proofArtifactPassCount}
                          data-proof-artifact-count={rightRailGoalTrack.safeGate.proofArtifactCount}
                          data-consent-blocker-count={rightRailGoalTrack.safeGate.consentBlockerCount}
                          data-non-consent-blocker-count={rightRailGoalTrack.safeGate.nonConsentBlockerCount}
                          data-no-token-prompt-sent={rightRailGoalTrack.safeGate.noTokenPromptSent ? "true" : "false"}
                          data-token-spending-prompt-executed={
                            rightRailGoalTrack.safeGate.tokenSpendingPromptExecuted ? "true" : "false"
                          }
                          data-release-hygiene-clean={
                            rightRailGoalTrack.safeGate.releaseHygieneClean ? "true" : "false"
                          }
                          data-supply-chain-audit-clean={
                            rightRailGoalTrack.safeGate.supplyChainAuditClean ? "true" : "false"
                          }
                          data-terminal-chunked-osc-live-passed={
                            rightRailGoalTrack.safeGate.terminalChunkedOscLivePassed ? "true" : "false"
                          }
                          data-native-terminal-input-host-passed={
                            rightRailGoalTrack.safeGate.nativeTerminalInputHostPassed ? "true" : "false"
                          }
                          data-native-hwnd-paste-live-passed={
                            rightRailGoalTrack.safeGate.nativeHwndPasteLivePassed ? "true" : "false"
                          }
                          data-semantic-freshness={rightRailGoalTrack.safeGate.semanticFreshness}
                          data-cycle-boundary={rightRailGoalTrack.safeGate.cycleBoundary}
                          data-local-date={rightRailGoalTrack.safeGate.localDate ?? ""}
                          data-time-zone={rightRailGoalTrack.safeGate.timeZone ?? ""}
                          title={`${rightRailGoalTrack.safeGate.label}: ${rightRailGoalTrack.safeGate.nextRequiredAction}`}
                        >
                          <strong>{rightRailGoalTrack.safeGate.label}</strong>
                          <small>
                            {rightRailGoalTrack.safeGate.detail}
                            {rightRailGoalTrack.safeGate.localDate && rightRailGoalTrack.safeGate.timeZone
                              ? ` · ${rightRailGoalTrack.safeGate.localDate} ${rightRailGoalTrack.safeGate.timeZone}`
                              : ""}
                          </small>
                        </div>
                      )}
                      {rightRailGoalTrack.externalGateActions.length > 0 && (
                        <fieldset
                          className="right-panel-goal-track-external-actions"
                          aria-label="External final goal gate actions"
                        >
                          <legend className="sr-only">Copy external gate commands</legend>
                          {rightRailGoalTrack.externalGateActions.map((action) => (
                            <button
                              type="button"
                              key={action.id}
                              className="right-panel-goal-track-external-copy"
                              data-external-gate-id={action.id}
                              data-external-gate-command={action.command}
                              data-external-gate-follow-up={action.followUpCommands.join(" && ")}
                              data-external-gate-requires-user-action={action.requiresUserAction ? "true" : "false"}
                              data-external-gate-requires-explicit-consent={
                                action.requiresExplicitConsent ? "true" : "false"
                              }
                              data-external-gate-cost-class={action.costClass}
                              title={`${action.manualAction}\n${action.powershellSnippet}`}
                              onClick={async () => {
                                try {
                                  await copyTextToClipboard(action.powershellSnippet);
                                  toast.success("External gate command copied", action.detail);
                                } catch (err) {
                                  toast.error(
                                    "External gate command copy failed",
                                    err instanceof Error ? err.message : String(err),
                                  );
                                }
                              }}
                            >
                              <ClipboardCopy size={11} aria-hidden="true" />
                              <span>{action.label}</span>
                              <small>{action.detail}</small>
                            </button>
                          ))}
                        </fieldset>
                      )}
                      {(rightRailGoalTrack.boundaryProofs.length > 0 ||
                        rightRailGoalTrack.requirementProofs.length > 0) && (
                        <details className="right-panel-goal-track-disclosure" data-kind="proofs">
                          <summary>
                            <span>Proofs</span>
                            <small>
                              {rightRailGoalTrack.boundaryProofs.length + rightRailGoalTrack.requirementProofs.length}{" "}
                              items
                            </small>
                          </summary>
                          {rightRailGoalTrack.boundaryProofs.length > 0 && (
                            <ul className="right-panel-goal-track-boundaries" aria-label="Terminal boundary proofs">
                              {rightRailGoalTrack.boundaryProofs.map((proof) => (
                                <li
                                  key={proof.id}
                                  data-boundary-id={proof.id}
                                  data-boundary-status={proof.status}
                                  data-boundary-source={proof.source}
                                  data-boundary-artifact={proof.artifactPath}
                                  data-boundary-refresh-command={proof.refreshCommand}
                                  data-boundary-cost-class={proof.costClass}
                                  title={`${proof.label}: ${proof.detail} · ${proof.artifactPath} · ${proof.refreshCommand}`}
                                >
                                  <strong>{proof.label}</strong>
                                  <small>{proof.status}</small>
                                  <button
                                    type="button"
                                    className="right-panel-goal-track-boundary-copy"
                                    aria-label={`Copy ${proof.label} boundary proof refresh command`}
                                    title={proof.refreshCommand}
                                    onClick={async () => {
                                      try {
                                        await copyTextToClipboard(proof.refreshCommand);
                                        toast.success(
                                          "Boundary proof command copied",
                                          `${proof.label}: ${proof.refreshCommand}`,
                                        );
                                      } catch (err) {
                                        toast.error(
                                          "Boundary proof command copy failed",
                                          err instanceof Error ? err.message : String(err),
                                        );
                                      }
                                    }}
                                  >
                                    <ClipboardCopy size={10} aria-hidden="true" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {rightRailGoalTrack.requirementProofs.length > 0 && (
                            <ul
                              className="right-panel-goal-track-requirements"
                              aria-label="Final goal requirement proofs"
                            >
                              {rightRailGoalTrack.requirementProofs.map((proof) => (
                                <li
                                  key={proof.id}
                                  data-requirement-id={proof.id}
                                  data-proof-status={proof.status}
                                  data-evidence-count={proof.evidence.length}
                                  title={`${proof.label}: ${proof.detail}`}
                                >
                                  <strong>{proof.label}</strong>
                                  <small>
                                    {proof.status} · {proof.evidence.length} evidence
                                  </small>
                                </li>
                              ))}
                            </ul>
                          )}
                        </details>
                      )}
                      {rightRailGoalTrack.consentPacket && (
                        <div
                          className="right-panel-goal-track-consent"
                          data-status={rightRailGoalTrack.consentPacket.status}
                          data-provider-env={rightRailGoalTrackConsentProviderEnv}
                          title={`${rightRailGoalTrack.consentPacket.command} · ${rightRailGoalTrack.consentPacket.requiredEnv} · ${rightRailGoalTrackConsentProviderEnv}`}
                        >
                          <strong>{rightRailGoalTrack.consentPacket.label}</strong>
                          <small>{rightRailGoalTrack.consentPacket.detail}</small>
                          <small>
                            {rightRailGoalTrack.consentPacket.provider} · preflight{" "}
                            {rightRailGoalTrack.consentPacket.preflightReady ? "green" : "blocked"} · prompt{" "}
                            {rightRailGoalTrack.consentPacket.safeNoPromptSent ? "not sent" : "sent"}
                          </small>
                          <details className="right-panel-goal-track-disclosure" data-kind="prompt-command">
                            <summary>
                              <span>Command</span>
                              <small>{rightRailGoalTrack.consentPacket.provider}</small>
                            </summary>
                            <dl
                              className="right-panel-goal-track-consent-command"
                              aria-label="Authenticated prompt consent command"
                            >
                              <div>
                                <dt>Command</dt>
                                <dd>{rightRailGoalTrack.consentPacket.command}</dd>
                              </div>
                              <div>
                                <dt>Env</dt>
                                <dd>{rightRailGoalTrack.consentPacket.requiredEnv || "env unavailable"}</dd>
                              </div>
                              <div>
                                <dt>Tokens</dt>
                                <dd>
                                  {rightRailGoalTrack.consentPacket.wouldSpendTokens ? "explicit consent" : "no spend"}
                                </dd>
                              </div>
                              <div>
                                <dt>Provider</dt>
                                <dd>{rightRailGoalTrackConsentProviderEnv || "provider env unavailable"}</dd>
                              </div>
                            </dl>
                          </details>
                          {rightRailGoalTrack.consentRunActions.length > 0 && (
                            <fieldset className="right-panel-goal-track-consent-actions">
                              <legend className="sr-only">Copy authenticated prompt smoke command by provider</legend>
                              {rightRailGoalTrack.consentRunActions.map((action) => (
                                <button
                                  type="button"
                                  key={action.provider}
                                  className="right-panel-goal-track-consent-copy"
                                  data-consent-run-provider={action.provider}
                                  data-consent-run-command={action.command}
                                  data-consent-run-provider-env={action.providerEnv}
                                  data-consent-run-default-provider={action.defaultProvider}
                                  data-consent-run-requires-explicit-consent={
                                    action.requiresExplicitConsent ? "true" : "false"
                                  }
                                  title={action.powershellSnippet}
                                  onClick={async () => {
                                    try {
                                      await copyTextToClipboard(action.powershellSnippet);
                                      toast.success(
                                        "Consent command copied",
                                        `${action.provider} prompt smoke command copied; review token spend before running.`,
                                      );
                                    } catch (err) {
                                      toast.error(
                                        "Consent command copy failed",
                                        err instanceof Error ? err.message : String(err),
                                      );
                                    }
                                  }}
                                >
                                  <ClipboardCopy size={11} aria-hidden="true" />
                                  <span>{action.label}</span>
                                  <small>{action.detail}</small>
                                </button>
                              ))}
                            </fieldset>
                          )}
                          {((rightRailGoalTrack.consentPacket.providerReadiness?.length ?? 0) > 0 ||
                            rightRailGoalTrack.consentPacket.artifactFreshness ||
                            rightRailGoalTrack.refreshActions.length > 0) && (
                            <details className="right-panel-goal-track-disclosure" data-kind="prompt-proof">
                              <summary>
                                <span>Preflight</span>
                                <small>
                                  {rightRailGoalTrack.consentPacket.artifactFreshness
                                    ? rightRailGoalTrack.consentPacket.artifactFreshness.label
                                    : "providers"}
                                </small>
                              </summary>
                              {(rightRailGoalTrack.consentPacket.providerReadiness?.length ?? 0) > 0 && (
                                <ul
                                  className="right-panel-goal-track-provider-matrix"
                                  aria-label="Authenticated AI CLI provider preflight readiness"
                                >
                                  {rightRailGoalTrack.consentPacket.providerReadiness?.map((entry) => (
                                    <li
                                      key={entry.provider}
                                      data-status={entry.status}
                                      title={`${entry.command} · ${entry.requiredEnv || "env unavailable"}${
                                        entry.failedChecks.length > 0
                                          ? ` · failing: ${entry.failedChecks.join(", ")}`
                                          : ""
                                      }`}
                                    >
                                      {entry.provider}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {rightRailGoalTrack.consentPacket.artifactFreshness && (
                                <div
                                  className="right-panel-goal-track-freshness-radar"
                                  data-status={rightRailGoalTrack.consentPacket.artifactFreshness.status}
                                  data-fresh-count={rightRailGoalTrack.consentPacket.artifactFreshness.freshCount}
                                  data-stale-count={rightRailGoalTrack.consentPacket.artifactFreshness.staleCount}
                                  data-total-count={rightRailGoalTrack.consentPacket.artifactFreshness.totalCount}
                                  data-next-refresh-id={
                                    rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh?.id ?? ""
                                  }
                                  data-next-refresh-command={
                                    rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh?.refreshCommand ?? ""
                                  }
                                  data-next-refresh-expires-at={
                                    rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh?.expiresAt ?? ""
                                  }
                                  title={
                                    rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh
                                      ? `${rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh.path} · ${
                                          rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh
                                            .refreshReason || "refresh proof"
                                        }`
                                      : rightRailGoalTrack.consentPacket.artifactFreshness.detail
                                  }
                                >
                                  <strong>{rightRailGoalTrack.consentPacket.artifactFreshness.label}</strong>
                                  <small>{rightRailGoalTrack.consentPacket.artifactFreshness.detail}</small>
                                </div>
                              )}
                              {rightRailGoalTrack.refreshActions.length > 0 && (
                                <fieldset className="right-panel-goal-track-artifact-refresh">
                                  <legend className="sr-only">Non-token proof refresh actions</legend>
                                  {rightRailGoalTrack.refreshActions.map((action) => (
                                    <button
                                      type="button"
                                      key={`${action.id}:${action.command}`}
                                      className="right-panel-goal-track-artifact-refresh-action"
                                      data-goal-refresh-id={action.id}
                                      data-goal-refresh-command={action.command}
                                      data-goal-refresh-path={action.path}
                                      data-goal-refresh-cost-class={action.costClass}
                                      data-goal-refresh-fresh={action.fresh ? "true" : "false"}
                                      data-goal-refresh-requires-explicit-consent={
                                        action.requiresExplicitConsent ? "true" : "false"
                                      }
                                      title={`${action.path} · ${action.reason} · ${action.command}`}
                                      onClick={async () => {
                                        try {
                                          await copyTextToClipboard(action.command);
                                          toast.success("Refresh command copied", `${action.id}: ${action.command}`);
                                        } catch (err) {
                                          toast.error(
                                            "Refresh command copy failed",
                                            err instanceof Error ? err.message : String(err),
                                          );
                                        }
                                      }}
                                    >
                                      <ClipboardCopy size={11} aria-hidden="true" />
                                      <span>{action.label}</span>
                                      <small>{action.command}</small>
                                    </button>
                                  ))}
                                </fieldset>
                              )}
                            </details>
                          )}
                        </div>
                      )}
                      <span className="right-panel-goal-track-detail">{rightRailGoalTrack.detail}</span>
                      <details className="right-panel-goal-track-disclosure" data-kind="remaining">
                        <summary>
                          <span>Remaining</span>
                          <small>
                            {rightRailGoalTrack.remainingItems[0] ??
                              `${rightRailGoalTrack.doneCount}/${rightRailGoalTrack.totalCount} milestones`}
                          </small>
                        </summary>
                        {rightRailGoalTrack.riskEvidence.length > 0 && (
                          <ul
                            className="right-panel-goal-track-risks"
                            data-source="release"
                            aria-label="Goal risk evidence"
                          >
                            {rightRailGoalTrack.riskEvidence.map((risk) => (
                              <li key={risk.id} title={`${risk.label} · ${risk.status ?? "unknown"}`}>
                                <strong>{risk.label}</strong>
                                <small>{risk.severity ?? risk.status ?? "risk"}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        {rightRailGoalTrack.runtimeFallbackEvidence.length > 0 && (
                          <ul
                            className="right-panel-goal-track-risks"
                            data-source="runtime-fallback"
                            aria-label="Goal runtime fallback evidence"
                          >
                            {rightRailGoalTrack.runtimeFallbackEvidence.map((risk) => (
                              <li key={risk.id} title={`${risk.label} · ${risk.status ?? "runtime fallback"}`}>
                                <strong>{risk.label}</strong>
                                <small>{risk.severity ?? risk.status ?? "fallback"}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        {rightRailGoalTrack.qaRiskEvidence.length > 0 && (
                          <ul
                            className="right-panel-goal-track-risks"
                            data-source="qa-fixture"
                            aria-label="Goal QA fixture risk evidence"
                          >
                            {rightRailGoalTrack.qaRiskEvidence.map((risk) => (
                              <li key={risk.id} title={`${risk.label} · ${risk.status ?? "qa fixture"}`}>
                                <strong>{risk.label}</strong>
                                <small>QA</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        <ul className="right-panel-goal-track-milestones" aria-label="Final goal milestones">
                          {rightRailGoalTrack.milestones.map((milestone) => (
                            <li
                              key={milestone.id}
                              className="right-panel-goal-track-milestone"
                              data-status={milestone.status}
                              title={`${milestone.label}: ${milestone.detail}. Evidence: ${milestone.evidence}. Remaining: ${milestone.remaining}`}
                            >
                              <strong>{milestone.label}</strong>
                              <small>{milestone.status}</small>
                            </li>
                          ))}
                        </ul>
                        {rightRailGoalTrack.remainingItems.length > 0 && (
                          <ul className="right-panel-goal-track-remaining" aria-label="Remaining goal blockers">
                            {rightRailGoalTrack.remainingItems.slice(0, 3).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </details>
                    </section>
                  </details>

                  {rightRailEdgeNextBestAction && (
                    <button
                      type="button"
                      className="right-panel-edge-next-action"
                      data-reason={rightRailEdgeNextBestAction.reason}
                      onClick={() => handleOpenRightRailEdgeScoreItem(rightRailEdgeNextBestAction.item)}
                      aria-label={`Next best Edge score action: ${rightRailEdgeNextBestAction.item.actionLabel} for ${rightRailEdgeNextBestAction.item.label}`}
                      title={`${rightRailEdgeNextBestAction.item.routeTitle}: ${rightRailEdgeNextBestAction.item.routeDetail}`}
                    >
                      <span>Next best action</span>
                      <strong>{rightRailEdgeNextBestAction.item.actionLabel}</strong>
                      <small>
                        {rightRailEdgeNextBestAction.reason === "repeated-axis" ? "Repeated axis" : "Weakest axis"}:{" "}
                        {rightRailEdgeNextBestAction.item.label}
                      </small>
                      {rightRailEdgeRecommendationOutcome && (
                        <em data-status={rightRailEdgeRecommendationOutcome.status}>
                          {rightRailEdgeRecommendationOutcome.label} - {rightRailEdgeRecommendationOutcome.detail}
                        </em>
                      )}
                    </button>
                  )}

                  <details className="right-panel-health-drawer">
                    <summary>
                      <span>Health</span>
                      <small>{rightRailHealthDrawerSummary}</small>
                    </summary>

                    <section
                      className="right-panel-now"
                      data-density="deferred"
                      data-tone={rightRailNowState.tone}
                      data-state={rightRailNowState.state}
                      aria-label={`Workspace state: ${rightRailNowState.label}`}
                    >
                      <span className="right-panel-now-kicker">State</span>
                      <span className="right-panel-now-state">{rightRailNowState.label}</span>
                      <span className="right-panel-now-detail">{rightRailNowState.detail}</span>
                    </section>

                    {rightRailEdgeFeedbackHistory.length > 0 && (
                      <section className="right-panel-edge-feedback" aria-label="Recent Edge score feedback">
                        <div className="right-panel-edge-feedback-head">
                          <span>Score loop</span>
                          <span>{rightRailEdgeFeedbackHistory.length}</span>
                          {rightRailEdgeFeedbackStaleCount > 0 && (
                            <>
                              <span className="right-panel-edge-feedback-stale-count" aria-hidden="true">
                                Stale {rightRailEdgeFeedbackStaleCount}
                              </span>
                              <span id={RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID} className="sr-only">
                                {rightRailEdgeFeedbackStaleCountLabel}
                              </span>
                            </>
                          )}
                          {rightRailEdgeFeedbackStaleCount > 0 && (
                            <button
                              type="button"
                              className="right-panel-edge-feedback-filter"
                              data-active={rightRailEdgeFeedbackStaleOnly ? "true" : "false"}
                              onClick={() => setRightRailEdgeFeedbackStaleOnly((active) => !active)}
                              aria-pressed={rightRailEdgeFeedbackStaleOnly}
                              aria-controls={RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID}
                              aria-describedby={RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID}
                              aria-label={
                                rightRailEdgeFeedbackStaleOnly
                                  ? `Show all score loop entries; ${rightRailEdgeFeedbackStaleCountLabel}`
                                  : `Show only stale score loop entries; ${rightRailEdgeFeedbackStaleCountLabel}`
                              }
                            >
                              {rightRailEdgeFeedbackStaleOnly ? "All" : "Stale only"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="right-panel-edge-feedback-clear"
                            onClick={handleClearRightRailEdgeFeedbackHistory}
                            aria-controls={RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID}
                            aria-label="Clear workspace Edge score feedback history"
                          >
                            Clear
                          </button>
                        </div>
                        {rightRailEdgeFeedbackAxisSummary && (
                          <div
                            className="right-panel-edge-feedback-summary"
                            data-axis-id={rightRailEdgeFeedbackAxisSummary.axisId}
                            data-trend={rightRailEdgeFeedbackAxisSummary.trend}
                          >
                            <span>Repeated axis</span>
                            <strong>{rightRailEdgeFeedbackAxisSummary.axisLabel}</strong>
                            <small>
                              {rightRailEdgeFeedbackAxisSummary.count} hit
                              {rightRailEdgeFeedbackAxisSummary.count === 1 ? "" : "s"} -{" "}
                              {rightRailEdgeFeedbackAxisSummary.trend}
                            </small>
                          </div>
                        )}
                        {rightRailEdgeFeedbackStaleOnly && rightRailEdgeFeedbackStaleGroups.length > 0 && (
                          <section
                            className="right-panel-edge-feedback-stale-groups"
                            aria-label={`Grouped stale score feedback, ${rightRailEdgeFeedbackStaleGroups.length} repeated ${
                              rightRailEdgeFeedbackStaleGroups.length === 1 ? "axis" : "axes"
                            }`}
                          >
                            {rightRailEdgeFeedbackStaleGroups.map((group) => (
                              <fieldset
                                key={group.axisId}
                                className="right-panel-edge-feedback-stale-group"
                                data-axis-id={group.axisId}
                              >
                                <legend>Stale group</legend>
                                <strong>{group.axisLabel}</strong>
                                <small>
                                  {group.count} entries - {group.score} - {group.grade} - {group.staleReason}
                                </small>
                              </fieldset>
                            ))}
                          </section>
                        )}
                        <div id={RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID} className="right-panel-edge-feedback-list">
                          {rightRailEdgeFeedbackVisibleHistory.map((entry) => {
                            const replayItem = rightRailEdgeScore.items.find(
                              (item) => item.id === entry.axisId || item.label === entry.axisLabel,
                            );
                            const staleReason = replayItem ? null : formatRightRailEdgeFeedbackStaleReason(entry);
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className="right-panel-edge-feedback-item"
                                data-axis-id={entry.axisId}
                                data-stale={staleReason ? "true" : "false"}
                                data-trend={entry.trend}
                                onClick={() => {
                                  if (replayItem) handleOpenRightRailEdgeScoreItem(replayItem);
                                }}
                                disabled={!replayItem}
                                aria-label={`Replay ${entry.axisLabel} score action: ${entry.actionLabel}`}
                              >
                                <span className="right-panel-edge-feedback-axis">{entry.axisLabel}</span>
                                <span className="right-panel-edge-feedback-score">
                                  {entry.score} · {entry.grade}
                                </span>
                                <span className="right-panel-edge-feedback-delta">
                                  {entry.trend === "baseline"
                                    ? "Baseline"
                                    : entry.delta > 0
                                      ? `+${entry.delta}`
                                      : `${entry.delta}`}
                                </span>
                                <span className="right-panel-edge-feedback-target">
                                  {entry.actionLabel} -&gt; {entry.targetWidget}
                                </span>
                                {staleReason && <span className="right-panel-edge-feedback-stale">{staleReason}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {rightRailEdgeFeedbackResetNotice && (
                      <section className="right-panel-edge-feedback-reset" role="status" aria-live="polite">
                        <strong>{rightRailEdgeFeedbackResetNotice.label}</strong>
                        <span>{rightRailEdgeFeedbackResetNotice.detail}</span>
                      </section>
                    )}

                    <section
                      className="right-panel-workforce"
                      data-tone={rightRailWorkforce.tone}
                      aria-label={`Agent workforce: ${rightRailWorkforce.headline}`}
                    >
                      <div className="right-panel-workforce-head">
                        <span className="right-panel-workforce-kicker">Agent workforce</span>
                        <label className="right-panel-workforce-profile-control">
                          <span className="sr-only">Guardrail profile</span>
                          <select
                            className="right-panel-workforce-profile"
                            value={rightRailGuardrailSelection}
                            onChange={(event) =>
                              setRightRailGuardrailSelection(event.currentTarget.value as RightRailGuardrailSelection)
                            }
                            aria-label={`Guardrail profile, current ${
                              rightRailGuardrailSelection === "Auto"
                                ? `Auto ${rightRailGuardrailProfile}`
                                : rightRailGuardrailProfile
                            }`}
                            title={`Guardrail: ${rightRailGuardrailDescriptor.label}`}
                          >
                            {RIGHT_RAIL_GUARDRAIL_OPTIONS.map((profile) => (
                              <option key={profile} value={profile}>
                                {profile === "Auto" ? `Auto: ${rightRailWorkforce.guardrailProfile}` : profile}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="right-panel-workforce-main">
                        <span className="right-panel-workforce-title">{rightRailWorkforce.headline}</span>
                        <span className="right-panel-workforce-detail">{rightRailWorkforce.detail}</span>
                      </div>
                      <section className="right-panel-workforce-metrics" aria-label="Workforce metrics">
                        <span>
                          <strong>{rightRailWorkforce.liveCount}</strong>
                          <small>Live</small>
                        </span>
                        <span>
                          <strong>{rightRailWorkforce.blockedCount}</strong>
                          <small>Blocked</small>
                        </span>
                        <span>
                          <strong>{rightRailWorkforce.handoffCount}</strong>
                          <small>Handoff</small>
                        </span>
                      </section>
                      <span className="right-panel-workforce-guardrail">{rightRailGuardrailDetail}</span>
                      <span className="right-panel-workforce-tools">
                        Tools: {allowedToolsForGuardrailProfile(rightRailGuardrailProfile).join(", ")}
                      </span>
                      {rightRailWorkforce.topAgents.length > 0 && (
                        <section className="right-panel-workforce-roster" aria-label="Top workforce agents">
                          {rightRailWorkforce.topAgents.map((agent) => (
                            <button
                              key={agent.id}
                              type="button"
                              className="right-panel-workforce-agent"
                              onClick={() => handleSelectRightRailSession(agent.id)}
                              title={`${agent.name}: ${agent.next}`}
                            >
                              <span className="right-panel-workforce-agent-name">{agent.name}</span>
                              <span className="right-panel-workforce-agent-role">{agent.role}</span>
                              <span className="right-panel-workforce-agent-next">{agent.next}</span>
                              <span className="right-panel-workforce-agent-meta">
                                {agent.contextPct}% · {agent.filesChanged} files
                              </span>
                            </button>
                          ))}
                        </section>
                      )}
                    </section>

                    <ErrorBoundary>
                      <Suspense fallback={null}>
                        <WorkstationPulse
                          sessions={rightRailSessions}
                          changedFilesCount={rightRailAllChangedFiles.length}
                          workstationGraph={focusedRightRailGraph}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </details>

                  {(rightRailRecommendation || rightRailVisibleActions.length > 0) && (
                    <details className="right-panel-queue-drawer">
                      <summary>
                        <span>Queue</span>
                        <small>{rightRailQueueCount} routes</small>
                      </summary>
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
                            if (matchingAction) void handleRightRailAction(matchingAction);
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

                      {rightRailVisibleActions.length > 0 && (
                        <section className="right-panel-action-stack" aria-label="Ranked next actions">
                          {rightRailVisibleActions.map((action) => {
                            const mode = RIGHT_RAIL_MODES.find((candidate) => candidate.id === action.mode);
                            const ActionIcon = mode?.icon ?? Activity;
                            const actionOwnerLabel = formatRightRailActionOwner(action);
                            return (
                              <button
                                key={action.id}
                                type="button"
                                className="right-panel-action"
                                data-tone={action.tone}
                                data-state={action.state}
                                data-mode={action.mode}
                                data-execution={action.execution.status}
                                data-guardrail={action.execution.guardrailProfile}
                                data-owner-kind={action.target.kind}
                                data-owner-label={actionOwnerLabel}
                                disabled={action.execution.status === "blocked"}
                                onClick={() => void handleRightRailAction(action)}
                                title={`${action.label}: ${action.detail}. ${action.nextStep} Expected: ${
                                  action.execution.expectedResult
                                } Evidence: ${action.execution.evidence}. Owner: ${actionOwnerLabel}. Target: ${
                                  action.target.label
                                }${
                                  action.target.reason ? ` (${action.target.reason})` : ""
                                }${action.execution.guardrailDetail ? ` Guardrail: ${action.execution.guardrailDetail}` : ""}${
                                  action.execution.disabledReason ? ` Blocked: ${action.execution.disabledReason}` : ""
                                }`}
                              >
                                <span className="right-panel-action-icon" aria-hidden="true">
                                  <ActionIcon size={12} strokeWidth={1.8} />
                                </span>
                                <span className="right-panel-action-copy">
                                  <span className="right-panel-action-label">{action.label}</span>
                                  <span className="right-panel-action-detail">{action.detail}</span>
                                  <span className="right-panel-action-why">{action.nextStep}</span>
                                  <span className="right-panel-action-outcome">
                                    {action.execution.disabledReason ??
                                      action.execution.guardrailDetail ??
                                      action.execution.evidence}
                                  </span>
                                </span>
                                <span className="right-panel-action-meta">
                                  <span className="right-panel-action-phase">{RIGHT_RAIL_ACTION_PHASE[action.id]}</span>
                                  <span className="right-panel-action-owner" title={action.target.reason}>
                                    {actionOwnerLabel}
                                  </span>
                                  <span className="right-panel-action-target">{action.target.label}</span>
                                  <span className="right-panel-action-execution">{action.execution.label}</span>
                                  {action.execution.guardrailLabel && (
                                    <span className="right-panel-action-guardrail">
                                      {action.execution.guardrailLabel}
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </section>
                      )}
                    </details>
                  )}

                  {rightRailActionResult && (
                    <section
                      className="right-panel-action-result"
                      data-tone={rightRailActionResult.tone}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <span className="right-panel-action-result-kicker">Last action</span>
                      <span className="right-panel-action-result-label">{rightRailActionResult.label}</span>
                      <span className="right-panel-action-result-detail">{rightRailActionResult.detail}</span>
                      {(rightRailActionResult.auditEventId != null ||
                        rightRailActionResult.auditCorrelationId ||
                        rightRailActionResult.routeWidget) && (
                        <button
                          type="button"
                          className="right-panel-action-result-audit"
                          onClick={() => handleOpenRightRailOutcomeSource(rightRailActionResult)}
                          aria-label={`Open source context for ${rightRailActionResult.label}`}
                          title={
                            rightRailActionResult.auditTimestamp
                              ? `Open audit context from ${rightRailActionResult.auditTimestamp}`
                              : (rightRailActionResult.routeDetail ?? "Open source context")
                          }
                        >
                          {rightRailActionResult.routeLabel ?? "Audit"}
                        </button>
                      )}
                    </section>
                  )}

                  {rightRailActionHistory.length > 0 && (
                    <section className="right-panel-action-history" aria-label="Recent right rail action history">
                      <div className="right-panel-action-history-header">
                        <span>Recent actions</span>
                        <span>{rightRailActionHistory.length}</span>
                      </div>
                      <div className="right-panel-action-history-list">
                        {rightRailActionHistory.map((result) => (
                          <div key={result.id} className="right-panel-action-history-item" data-tone={result.tone}>
                            <span className="right-panel-action-history-copy">
                              <span className="right-panel-action-history-label">{result.label}</span>
                              <span className="right-panel-action-history-detail">{result.detail}</span>
                            </span>
                            {(result.auditEventId != null || result.auditCorrelationId || result.routeWidget) && (
                              <button
                                type="button"
                                className="right-panel-action-history-audit"
                                onClick={() => handleOpenRightRailOutcomeSource(result)}
                                aria-label={`Open source context for ${result.label}`}
                                title={
                                  result.auditTimestamp
                                    ? `Open audit context from ${result.auditTimestamp}`
                                    : (result.routeDetail ?? "Open source context")
                                }
                              >
                                {result.routeLabel ?? "Audit"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

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
                            <div
                              className="bento-widget"
                              data-widget="toolkit"
                              data-rail-focus={rightRailFocusWidget === "toolkit" ? "true" : undefined}
                            >
                              {renderRightRailDestinationPrompt("toolkit")}
                              <ToolkitPanel
                                projectName={projectName}
                                onRunCommand={handleRunCommand}
                                activeTargetLabel={visualActiveTerminalTargetLabel}
                                activeTargetReady={activeTerminalTarget.ready}
                                forceExpanded={rightRailFocusWidget === "toolkit"}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        {(rightRailHasBlockingDecision || rightRailFocusWidget === "decision-inbox") && (
                          <ErrorBoundary>
                            <Suspense fallback={null}>
                              <RightRailWidgetFrame
                                widget="decision-inbox"
                                title="Decision Inbox"
                                subtitle={`${decisionInbox.pendingCount} waiting`}
                                defaultOpen={rightRailHasBlockingDecision}
                                forceOpen={rightRailFocusWidget === "decision-inbox"}
                              >
                                {renderRightRailDestinationPrompt("decision-inbox")}
                                <DecisionInboxPanel
                                  sessions={rightRailSessions}
                                  auditEvents={scopedOperationalAuditEvents}
                                  workflows={workflowStatuses}
                                  activeSessionId={rightRailActiveSessionId}
                                  onSelectSession={handleSelectRightRailSession}
                                  onOpenWorkflow={handleOpenDecisionWorkflow}
                                  onOpenAudit={handleOpenDecisionAudit}
                                />
                              </RightRailWidgetFrame>
                            </Suspense>
                          </ErrorBoundary>
                        )}
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="sessions"
                              title="Agents"
                              subtitle={`${rightRailAgentsSummary} · ${rightRailAgentsDetail}`}
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "sessions"}
                            >
                              <AgentInspector {...agentInspectorProps} />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="orchestrator"
                              title="Orchestrator"
                              subtitle="autonomy loop"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "orchestrator"}
                            >
                              <OrchestratorPanel />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="workflow"
                              title="Workflows"
                              subtitle="multi-step runs"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "workflow"}
                              focusConfirmation={
                                rightRailRouteConfirmation?.widget === "workflow" ? rightRailRouteConfirmation : null
                              }
                            >
                              <WorkflowPanel
                                projectPath={projectPath}
                                sessions={rightRailSessions}
                                onStartAgent={handleStartAgent}
                                onDestinationOutcome={showRightRailDestinationOutcome}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="context"
                              title="Context"
                              subtitle="handoff state"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "context"}
                            >
                              <ContextPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                changedFilesCount={rightRailAllChangedFiles.length}
                                changedFiles={rightRailAllChangedFiles}
                                panes={visualTerminalPaneTargets}
                                auditEvents={scopedOperationalAuditEvents}
                                projectName={projectName}
                                projectPath={projectPath}
                                branch={branch}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                      </>
                    )}

                    {rightRailMode === "review" && (
                      <>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="review-queue">
                              {renderRightRailDestinationPrompt("review-queue")}
                              <ReviewQueuePanel
                                sessions={rightRailSessions}
                                changedFiles={rightRailAllChangedFiles}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                onOpenDiff={handleOpenDiff}
                                onOpenCommandEvidence={handleOpenCommandEvidence}
                                onStartAgent={handleStartAgent}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
                              <AgentInspector {...agentInspectorProps} />
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
                            <RightRailWidgetFrame
                              widget="context"
                              title="Context"
                              subtitle="handoff state"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "context"}
                            >
                              <ContextPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                changedFilesCount={rightRailAllChangedFiles.length}
                                changedFiles={rightRailAllChangedFiles}
                                panes={visualTerminalPaneTargets}
                                auditEvents={scopedOperationalAuditEvents}
                                projectName={projectName}
                                projectPath={projectPath}
                                branch={branch}
                                density="compact"
                                workstationGraph={focusedRightRailGraph}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                      </>
                    )}

                    {rightRailMode === "observe" && (
                      <>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="processes">
                              {renderRightRailDestinationPrompt("processes")}
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
                              {renderRightRailDestinationPrompt("live-panes")}
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
                            <RightRailWidgetFrame
                              widget="audit-timeline"
                              title="Audit"
                              subtitle="events and recovery"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "audit-timeline"}
                              focusConfirmation={
                                rightRailRouteConfirmation?.widget === "audit-timeline"
                                  ? rightRailRouteConfirmation
                                  : null
                              }
                            >
                              {renderRightRailDestinationPrompt("audit-timeline")}
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
                                onDestinationOutcome={showRightRailDestinationOutcome}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="context"
                              title="Context"
                              subtitle="handoff state"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "context"}
                            >
                              <ContextPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                changedFilesCount={rightRailAllChangedFiles.length}
                                changedFiles={rightRailAllChangedFiles}
                                panes={visualTerminalPaneTargets}
                                auditEvents={scopedOperationalAuditEvents}
                                projectName={projectName}
                                projectPath={projectPath}
                                branch={branch}
                                density="compact"
                                workstationGraph={focusedRightRailGraph}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="run-graph"
                              title="Run Graph"
                              subtitle="roles and handoffs"
                              defaultOpen={false}
                              forceOpen={rightRailFocusWidget === "run-graph"}
                            >
                              <RunGraphPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <RightRailWidgetFrame
                              widget="tool-ledger"
                              title="Run Ledger"
                              subtitle="tool activity"
                              defaultOpen={false}
                            >
                              <ToolLedgerPanel
                                sessions={rightRailSessions}
                                activeSessionId={rightRailActiveSessionId}
                                onSelectSession={handleSelectRightRailSession}
                                workstationGraph={focusedRightRailGraph}
                              />
                            </RightRailWidgetFrame>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
                              <AgentInspector {...agentInspectorProps} />
                            </div>
                          </Suspense>
                        </ErrorBoundary>
                        <ErrorBoundary>
                          <Suspense fallback={null}>
                            <div className="bento-widget" data-widget="reliability">
                              {renderRightRailDestinationPrompt("reliability")}
                              <ReliabilityPanel
                                sessions={rightRailSessions}
                                panes={visualTerminalPaneTargets}
                                changedFilesCount={rightRailAllChangedFiles.length}
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
                              <RightRailWidgetFrame
                                widget="logs"
                                title="Logs"
                                subtitle="diagnostics"
                                defaultOpen={false}
                              >
                                <LogsPanel defaultCollapsed />
                              </RightRailWidgetFrame>
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
            <Suspense fallback={null}>
              <OnboardingOverlay />
              <FleetHud />
            </Suspense>
          </div>
        </ToastProvider>
    </TooltipProvider>
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
