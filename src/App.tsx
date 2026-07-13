import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { Activity, ClipboardCopy, Users } from "lucide-react";
import {
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
import {
  AboutDialog,
  AgentInspector,
  AuditTimelinePanel,
  CommandPalette,
  ContextPanel,
  DecisionInboxPanel,
  EditorPanel,
  FleetHud,
  HelpDialog,
  KanbanBoard,
  LivePanesPanel,
  LogsPanel,
  MergeQueuePanel,
  OnboardingOverlay,
  OrchestratorPanel,
  PaneSwitcherDialog,
  PRInspector,
  ProcessManagerPanel,
  QuickOpen,
  ReliabilityPanel,
  ReviewQueuePanel,
  RunGraphPanel,
  SCMPanel,
  SearchPanel,
  Settings,
  ToolLedgerPanel,
  ToolkitPanel,
  WatchdogDialog,
  WebInspector,
  WelcomeScreen,
  WorkflowPanel,
  WorkstationPulse,
} from "./features/app/lazyPanels";
import { useAppMenus } from "./features/app/useAppMenus";
import { useBootstrapAppConfig } from "./features/app/useBootstrapAppConfig";
import { useAuthenticatedPromptEvidence } from "./features/app/useAuthenticatedPromptEvidence";
import { useAiCliLaunchEvidence } from "./features/app/useAiCliLaunchEvidence";
import { useReleaseGoalEvidence } from "./features/app/useReleaseGoalEvidence";
import { useProjectTabLifecycle } from "./features/app/useProjectTabLifecycle";
import { useDecisionInbox } from "./features/decision-inbox/useDecisionInbox";
import { FileTree } from "./features/file-tree/FileTree";
import { ProjectHeaderBar } from "./features/header/ProjectHeaderBar";
import { useOrchestraDispatch } from "./features/orchestrator/useOrchestraDispatch";
import { StatusBar } from "./features/statusbar/StatusBar";
import { TERMINAL_PREFIX_COMMAND_EVENT } from "./features/terminal/hooks/useCanvasIME";
import { PaneTreeContainer, paneTreeStorageKey } from "./features/terminal/pane-tree";
import { WorkspaceTabs } from "./features/workspace-tabs/WorkspaceTabs";
import { PRODUCT_NAME } from "./shared/constants/product";
import {
  type AiCliLaunchPromptContract,
  deriveAiCliLaunchPlan,
} from "./shared/lib/aiCliLaunchPlanner";
import { getAuditCorrelationId } from "./shared/lib/auditRecovery";
import {
  commandHistoryRecordsToCommandBlocks,
  type NativeCommandBlockRecord,
  nativeCommandBlockRecordsToCommandBlocks,
} from "./shared/lib/commandHistoryGraph";
import { buildContextPack } from "./shared/lib/contextPack";
import { TERMINAL_COMMAND_EVIDENCE_EVENT } from "./shared/lib/terminalEvidence";
import { filterWorkspaceScopedEvents } from "./shared/lib/workspaceProfile";
import {
  buildWorkstationGraph,
  type FileProvenanceTrace,
  filterWorkstationGraph,
  listWorkstationGraphChangedFiles,
  type WorkstationGraphCommandBlock,
} from "./shared/lib/workstationGraph";
import type { CommandHistoryRecord } from "./shared/types/history";

import { HistorySearchDialog, showHistorySearch } from "./features/history/HistorySearchDialog";
import {
  appendRightRailActionAudit,
  appendRightRailActionOutcomeAudit,
  appendRightRailEdgeFeedbackStaleAudit,
  appendRightRailEdgeScoreInteractionAudit,
  clearRightRailEdgeFeedbackHistory,
  copyTextToClipboard,
  createDevVisualQaAuditEvents,
  createDevVisualQaChangedFiles,
  createDevVisualQaCommandBlocks,
  createDevVisualQaNegativePathAction,
  createDevVisualQaPanes,
  createDevVisualQaSessions,
  createRightRailEdgeScoreFeedbackEntry,
  deriveRightRailEdgeFeedbackAxisSummary,
  deriveRightRailEdgeFeedbackStaleEntries,
  deriveRightRailEdgeFeedbackStaleGroups,
  deriveRightRailEdgeNextBestAction,
  deriveRightRailEdgeRecommendationOutcome,
  deriveRightRailEdgeScore,
  formatInspectorProof,
  formatRightRailActionOwner,
  formatRightRailEdgeFeedbackStaleReason,
  formatRightRailRecoveryDetail,
  formatTerminalTarget,
  getNextRightRailMode,
  isLiveInteractiveSessionStatus,
  isRightRailQaFixtureRisk,
  isRightRailWidgetId,
  mergeRightRailChangedFiles,
  PRODUCT_MODE_INSPECTOR_SUMMARY,
  PRODUCT_MODE_RAIL,
  PRODUCT_MODE_ROUTES,
  type ProductModeId,
  RIGHT_RAIL_ACTION_PHASE,
  RIGHT_RAIL_ACTION_WIDGET,
  RIGHT_RAIL_EDGE_FEEDBACK_LIMIT,
  RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID,
  RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID,
  RIGHT_RAIL_GUARDRAIL_OPTIONS,
  RIGHT_RAIL_MODES,
  type RightRailActionResult,
  type RightRailActionResultTone,
  type RightRailDestinationPrompt,
  RightRailDestinationPromptCard,
  type RightRailEdgeFeedbackResetNotice,
  type RightRailEdgeScore,
  type RightRailEdgeScoreFeedbackEntry,
  type RightRailEdgeScoreItem,
  type RightRailGuardrailSelection,
  RightRailWidgetFrame,
  readDevVisualQaState,
  resolveProjectFilePath,
  rightRailModeForOutcomeWidget,
  saveRightRailEdgeFeedbackHistory,
  sessionTabMatches,
} from "./features/right-rail/rightRailModel";
import { useRightRailFeedbackPersistence } from "./features/right-rail/useRightRailFeedbackPersistence";
import { useRightRailActionFeedback } from "./features/right-rail/useRightRailActionFeedback";
import { useRightRailGuardrailSelection } from "./features/right-rail/useRightRailGuardrailSelection";
import { useEditorOpenMode } from "./features/editor/useEditorOpenMode";
import { usePaneRegistry } from "./features/terminal/usePaneRegistry";
import { usePaneAgentSpawns } from "./features/terminal/usePaneAgentSpawns";
import { usePaneRequestController } from "./features/terminal/usePaneRequestController";
import { useOperationalPaneSelection } from "./features/terminal/useOperationalPaneSelection";
import { type StartAgentMeta, useAgentFleet } from "./shared/hooks/useAgentFleet";
import { useAgentFleetToasts } from "./shared/hooks/useAgentFleetToasts";
import { useAuditEvents } from "./shared/hooks/useAuditEvents";
import { useGitStatus } from "./shared/hooks/useGitStatus";
import { useKeyboardShortcuts } from "./shared/hooks/useKeyboardShortcuts";
import { useTabManager } from "./shared/hooks/useTabManager";
import { useTaskAgentLink } from "./shared/hooks/useTaskAgentLink";
import { useTerminalNotifications } from "./shared/hooks/useTerminalNotifications";
import { useThemeApplier } from "./shared/hooks/useTheme";
import { useWorktreeActions } from "./shared/hooks/useWorktreeActions";
import { summarizeAgentLane } from "./shared/lib/agentLaneSummary";
import { markFirstPaint } from "./shared/lib/bootMetrics";
import {
  FALLBACK_TELEMETRY_EVENT,
  type FallbackTelemetryDetail,
  formatFallbackError,
  reportInvokeFailure,
} from "./shared/lib/fallbackTelemetry";
import { allowedToolsForGuardrailProfile, describeGuardrailProfile } from "./shared/lib/guardrailPolicy";
import { ORCHESTRA_ROLES } from "./shared/lib/orchestrator";
import {
  deriveRightRailActions,
  deriveRightRailNowState,
  deriveRightRailRecommendation,
  type RightRailAction,
  type RightRailMode,
} from "./shared/lib/rightRailAdvisor";
import { deriveRightRailGoalTrack } from "./shared/lib/rightRailGoalTrack";
import { deriveRightRailWorkforceSummary, type WorkforceGuardrailProfile } from "./shared/lib/rightRailWorkforce";
import { classifyCommand, formatCommandRiskSummary } from "./shared/lib/shellSafety";
import { isTauriRuntime } from "./shared/lib/tauriRuntime";
import {
  DEFAULT_RIGHT_PANEL_WIDTH,
  useAppStore,
} from "./shared/store/appStore";
import { toast } from "./shared/store/toastStore";
import type { SearchHit } from "./shared/types/history";
import type { ShellType, TerminalPaneTarget } from "./shared/types/terminalPane";
import { CollapsibleSection } from "./shared/ui/CollapsibleSection";
import { ConfirmDialog, showConfirm } from "./shared/ui/ConfirmDialog";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { HandoffDialog } from "./shared/ui/HandoffDialog";
import { LazyDialog } from "./shared/ui/LazyDialog";
import { OrchestraDialog } from "./shared/ui/OrchestraDialog";
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
    rightRailCollapsed,
    setRightRailCollapsed,
    productMode,
    setProductMode,
    rightRailMode,
    setRightRailMode,
    rightRailFocusWidget,
    setRightRailFocusWidget,
    hydrateWorkspaceNavigation,
    zenMode,
    setZenMode,
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
    mergeQueueVisible,
    setMergeQueueVisible,
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

  useBootstrapAppConfig();

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
  const [decisionInboxFocusRequest, setDecisionInboxFocusRequest] = useState(0);
  const [rightRailDestinationPrompt, setRightRailDestinationPrompt] = useState<RightRailDestinationPrompt | null>(null);
  const [rightRailEdgeFeedbackHistory, setRightRailEdgeFeedbackHistory] = useState<RightRailEdgeScoreFeedbackEntry[]>(
    [],
  );
  const [rightRailEdgeFeedbackStaleOnly, setRightRailEdgeFeedbackStaleOnly] = useState(false);
  const [rightRailEdgeFeedbackResetNotice, setRightRailEdgeFeedbackResetNotice] =
    useState<RightRailEdgeFeedbackResetNotice | null>(null);
  const {
    rightRailActionHistory,
    rightRailActionResult,
    rightRailRouteConfirmation,
    showRightRailActionResult,
    showRightRailDestinationOutcome,
    showRightRailRouteConfirmation,
  } = useRightRailActionFeedback();
  const { rightRailGuardrailSelection, setRightRailGuardrailSelection } = useRightRailGuardrailSelection();
  const [rightRailFixtureSelectedSessionId, setRightRailFixtureSelectedSessionId] = useState<string | null>(null);
  const [paneSwitcherVisible, setPaneSwitcherVisible] = useState(false);
  const rightRailPanelRef = useRef<HTMLDivElement | null>(null);
  const rightRailEdgeFeedbackResetNoticeTimerRef = useRef<number | null>(null);
  const rightRailDestinationReachedTelemetryRef = useRef<string | null>(null);
  const rightRailEdgeScoreRef = useRef<Pick<RightRailEdgeScore, "score" | "grade">>({ score: 0, grade: "D" });
  const rightRailEdgeFeedbackStaleTelemetryRef = useRef<Set<string>>(new Set());
  const rightRailProjectPathRef = useRef("");
  const rightRailGuardrailProfileRef = useRef<WorkforceGuardrailProfile>("Research");

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect intentionally resets fixture selection when the visual-QA scenario changes.
  useEffect(() => {
    setRightRailFixtureSelectedSessionId(null);
  }, [devVisualQa.enabled, devVisualQa.railScenario]);

  useEffect(() => {
    return () => {
      if (rightRailEdgeFeedbackResetNoticeTimerRef.current != null) {
        window.clearTimeout(rightRailEdgeFeedbackResetNoticeTimerRef.current);
      }
    };
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
  const {
    handleCloseFolder,
    handleCloseTab,
    handleOpenFolder,
    handleOpenProject,
    handleTabSwitch,
  } = useProjectTabLifecycle({
    activeTabId,
    addTabWithCwd,
    clearFiles,
    closeTab,
    setActiveTabId,
    setRootProjectPath,
    tabs,
  });
  const { activePtyId, clearActivePtyId, setTabActivePtyId, setTabPaneRegistry, tabPaneRegistries } = usePaneRegistry(
    activeTabId,
    tabs,
  );

  // Loop-dispatched agents → real split panes in the active terminal tab. We
  // accumulate the live agent terminals from the agent_spawned event stream and
  // hand the set to the active tab's PaneTreeContainer, which splits the active
  // pane and binds each agent's PTY (1 pane = 1 agent), so the operator watches
  // them work in genuine terminal panes.
  const { mountAgentPtyInPane, paneAgentSpawns } = usePaneAgentSpawns(activeTabId);

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
  const {
    clearEndedOperationalPane,
    handleSelectAuditEvent,
    handleSelectReliabilityIncident,
    handleTraceReliabilityIncident,
    selectOperationalPane,
    setSelectedAuditEventId,
    setSelectedAuditTraceFilter,
    selectedAuditEventId,
    selectedAuditTraceFilter,
    selectedOperationalPane,
    selectedOperationalPaneTarget,
  } = useOperationalPaneSelection(visualTerminalPaneTargets);

  const {
    sessions,
    fleetSessions,
    refreshAgentFleet,
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
  const rightRailAiCliLaunchEvidence = useAiCliLaunchEvidence(projectPath);
  const authenticatedPromptConsentPacket = useAuthenticatedPromptEvidence(projectPath);
  const { finalGoalRequirementProofs, finalGoalResidualRisk, finalGoalSafeGate, releaseQualityGoalInputs } =
    useReleaseGoalEvidence(projectPath);
  const { handleFileSelect, handleOpenDiff } = useEditorOpenMode({
    projectPath,
    openFile,
    setEditorLine,
    setOpenInDiff,
  });
  rightRailProjectPathRef.current = projectPath;
  useRightRailFeedbackPersistence(projectPath, rightRailEdgeFeedbackHistory, setRightRailEdgeFeedbackHistory);
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
    [
      rightRailActionResult,
      scopedOperationalAuditEvents,
      showRightRailRouteConfirmation,
      setRightRailFocusWidget,
      setRightRailMode,
    ],
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
    [handleOpenRightRailActionAudit, showRightRailRouteConfirmation, setRightRailFocusWidget, setRightRailMode],
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
    [showRightRailRouteConfirmation, setRightRailFocusWidget, setRightRailMode],
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
    [scopedOperationalAuditEvents, showRightRailRouteConfirmation, setRightRailMode, setRightRailFocusWidget],
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
    [projectPath, rightRailMode, showRightRailRouteConfirmation, setRightRailMode, setRightRailFocusWidget],
  );
  const handleClearRightRailEdgeFeedbackHistory = useCallback(() => {
    clearRightRailEdgeFeedbackHistory(projectPath);
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
  const { decisionInbox, handleDecideDecision, workflowStatuses } = useDecisionInbox({
    projectPath,
    refreshAgentFleet,
    rightRailSessions,
    rightRailUsesFixtures,
    scopedOperationalAuditEvents,
    showRightRailRouteConfirmation,
  });
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
    if (rightPanelWidth < DEFAULT_RIGHT_PANEL_WIDTH) {
      setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH);
    }
  }, [
    devVisualQa.enabled,
    devVisualQa.projectPath,
    devVisualQa.railMode,
    rightPanelWidth,
    rootProjectPath,
    setRightPanelWidth,
    setRootProjectPath,
    setRightRailMode,
  ]);

  const {
    applyPaneLayoutCommand,
    handlePaneAttach,
    handlePaneClose,
    handlePaneRename,
    handlePaneRestart,
    handlePaneRoleCycle,
    handlePaneSwitch,
    paneAttachRequest,
    paneCloseRequest,
    paneFocusRequest,
    paneLayoutRequest,
    paneRenameRequest,
    paneRestartRequest,
    paneRoleCycleRequest,
  } = usePaneRequestController({ activeTabId, handleTabSwitch, interactiveSessionId, selectInteractiveSession });

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
      // An interactive gate (e.g. a Decision Inbox approval row) must focus its
      // live TUI through the interactive selector; the headless path below would
      // instead clear the interactive selection and fail to focus the pane.
      if (fleetSessions.some((session) => session.id === sessionId && session.runtime === "interactive")) {
        selectInteractiveSession(sessionId);
        return;
      }
      // Selecting a headless session clears any interactive selection so the
      // unified active id (interactiveSessionId || activeSessionId) reflects it.
      if (interactiveSessionId) selectInteractiveSession("");
      handleSelectSession(sessionId);
    },
    [fleetSessions, handleSelectSession, interactiveSessionId, selectInteractiveSession, rightRailUsesFixtures],
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
      setRightRailMode,
      setRightRailFocusWidget,
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

  const openDecisionInbox = useCallback(() => {
    setRightRailMode("command");
    setRightRailFocusWidget("decision-inbox");
    setDecisionInboxFocusRequest((request) => request + 1);
  }, [setRightRailFocusWidget, setRightRailMode]);

  useEffect(() => {
    hydrateWorkspaceNavigation(projectPath);
  }, [hydrateWorkspaceNavigation, projectPath]);

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
    setZenMode,
    openDecisionInbox,
    setRightRailCollapsed,
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
    setMergeQueueVisible,
    setZenMode,
    openDecisionInbox,
    setRightRailCollapsed,
    splitPaneRight: () => {
      if (!visualActivePtyId) return;
      document.dispatchEvent(
        new CustomEvent(TERMINAL_PREFIX_COMMAND_EVENT, {
          detail: { terminalId: visualActivePtyId, command: "split-right" },
        }),
      );
    },
    splitPaneDown: () => {
      if (!visualActivePtyId) return;
      document.dispatchEvent(
        new CustomEvent(TERMINAL_PREFIX_COMMAND_EVENT, {
          detail: { terminalId: visualActivePtyId, command: "split-down" },
        }),
      );
    },
  });

  // ── Render ──

  // Active interactive session (if any)
  const activeInteractive = interactiveSessions.find((s) => s.id === interactiveSessionId);
  const handleProductModeSelect = useCallback(
    (mode: ProductModeId) => {
      const route = PRODUCT_MODE_ROUTES[mode];
      if (!route.openHistory && !route.openSettings) setProductMode(mode);
      if (route.expandSidebar) setSidebarCollapsed(false);
      if (route.rightRailMode) setRightRailMode(route.rightRailMode);
      if (route.focusWidget !== undefined) setRightRailFocusWidget(route.focusWidget);
      if (route.openHistory) showHistorySearch();
      if (route.openSettings) setSettingsVisible(true);
    },
    [setProductMode, setRightRailFocusWidget, setRightRailMode, setSettingsVisible, setSidebarCollapsed],
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
    [rightRailMode, setRightRailMode],
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
  const attentionAgentCount = rightRailSessions.filter((s) => s.status === "waiting" || s.status === "error").length;
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
        "Run token-spending prompt smoke only through the provider-selected operator command.",
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
  const { handleStartRightRailOrchestra, orchestraRolePanes } = useOrchestraDispatch({
    activeTabId,
    decisionInboxPendingCount: decisionInbox.pendingCount,
    handleStartInteractiveSession,
    interactiveSessionCount: interactiveSessions.length,
    mountAgentPtyInPane,
    projectName,
    projectPath,
    rightRailAllChangedFiles,
    rightRailPrimaryActionNextStep: rightRailPrimaryAction?.nextStep,
    selectInteractiveSession,
    sessionsCount: sessions.length,
    setRightRailFocusWidget,
    setRightRailMode,
  });
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
          <div
            className="app-container"
            data-density={workspaceProfile.visualDensity}
            data-zen-mode={zenMode ? "true" : "false"}
          >
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
        <div
          className="app-container"
          data-density={workspaceProfile.visualDensity}
          data-zen-mode={zenMode ? "true" : "false"}
        >
          <UpdateBanner disableAutoCheck={!isTauriRuntime()} />
          {!zenMode && (
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
          )}

          <main className="app-main">
            {!zenMode && (
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
            )}
            <nav
              className={`left-panel${sidebarCollapsed || zenMode ? " left-panel-collapsed" : ""}`}
              aria-label="Project sidebar"
              aria-hidden={sidebarCollapsed || zenMode ? "true" : undefined}
              data-workspace-region="sidebar"
              tabIndex={-1}
              data-collapsed={sidebarCollapsed || zenMode}
              style={sidebarCollapsed || zenMode ? undefined : { width: `${sidebarWidth}px` }}
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

            <section
              className="center-panel"
              aria-label="Terminal and editor"
              data-workspace-region="center"
              tabIndex={-1}
            >
              {editorArea ? (
                <SplitPane direction="vertical" defaultRatio={0.5} first={editorArea} second={terminalSurface} />
              ) : (
                terminalSurface
              )}
            </section>

            <aside
              className="right-panel"
              aria-label="Contextual inspector"
              aria-hidden={zenMode || rightRailCollapsed ? "true" : undefined}
              hidden={zenMode || rightRailCollapsed}
              data-workspace-region="right-rail"
              tabIndex={-1}
              /* `flex-basis` (not `width`) is what flex layout reads as
               * the preferred size. Setting only `width` left the
               * computed width at the CSS default (280 px) on Chromium
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
                        data-release-hygiene-clean={rightRailGoalTrack.safeGate.releaseHygieneClean ? "true" : "false"}
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
                                {rightRailGoalTrack.consentPacket.wouldSpendTokens
                                  ? "operator token spend"
                                  : "no spend"}
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
                                        rightRailGoalTrack.consentPacket.artifactFreshness.nextRefresh.refreshReason ||
                                        "refresh proof"
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
                                onDecide={handleDecideDecision}
                                focusRequestKey={decisionInboxFocusRequest}
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
                                clearEndedOperationalPane(terminalId);
                                clearActivePtyId(terminalId);
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
                            <RightRailWidgetFrame widget="logs" title="Logs" subtitle="diagnostics" defaultOpen={false}>
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
              void handleTabSwitch(id).then(
                (switched) => switched && interactiveSessionId && selectInteractiveSession(""),
              );
            }}
            onCloseTab={handleCloseTab}
            onNewTab={addTab}
            onReorderTab={reorderTab}
            interactiveSessions={interactiveSessions}
            activeInteractiveId={interactiveSessionId}
            onSelectInteractive={handleFocusInteractiveSession}
            onCloseInteractive={stopInteractiveSession}
          />

          <div data-workspace-region="status-bar" tabIndex={-1}>
            <StatusBar
              shell={activeTab.shell}
              branch={branch}
              changedCount={changedFiles.length}
              agentStatus={activeAgent ? `${activeAgent.model} · $${activeAgent.cost.toFixed(2)}` : undefined}
              terminalId={activePtyId}
              onOpenFile={handleFileSelect}
              paneCount={visualTerminalPaneTargets.length}
              rightRailMode={rightRailMode}
              rightRailWidth={rightPanelWidth}
            />
          </div>

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
          {mergeQueueVisible && (
            <LazyDialog>
              <MergeQueuePanel visible onClose={() => setMergeQueueVisible(false)} />
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
