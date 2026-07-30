import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a6-frontend-ratchet.json");
const scenarios = [];
let failed = false;
try {
  const program = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd exec tsc --noEmit"] : ["exec", "tsc", "--noEmit"];
  execFileSync(program, args, { cwd: root, stdio: "pipe", windowsHide: true, timeout: 180_000 });
  scenarios.push({ id: "typescript-contract", status: "pass" });
} catch (error) {
  failed = true;
  scenarios.push({ id: "typescript-contract", status: "fail", error: error instanceof Error ? error.message : String(error) });
}
try {
  const program = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          "pnpm.cmd exec vitest run src/__tests__/useAppShellStore.test.tsx src/__tests__/useProjectTabLifecycle.test.tsx src/__tests__/KeyboardShortcutsTerminalFocus.test.tsx src/__tests__/useReleaseGoalEvidence.test.tsx src/__tests__/useAuthenticatedPromptEvidence.test.tsx src/__tests__/useAiCliLaunchEvidence.test.tsx src/__tests__/usePaneRequestController.test.tsx src/__tests__/usePaneAgentSpawns.test.tsx src/__tests__/usePaneRegistry.test.tsx src/__tests__/useOperationalPaneSelection.test.tsx src/__tests__/PaneTreeContainerActiveTerminal.test.tsx src/__tests__/useTerminalMenuCommands.test.tsx src/__tests__/RightRailShell.test.tsx --configLoader native --reporter=json",
        ]
      : [
          "exec",
          "vitest",
          "run",
          "src/__tests__/useAppShellStore.test.tsx",
          "src/__tests__/useProjectTabLifecycle.test.tsx",
          "src/__tests__/KeyboardShortcutsTerminalFocus.test.tsx",
          "src/__tests__/useReleaseGoalEvidence.test.tsx",
          "src/__tests__/useAuthenticatedPromptEvidence.test.tsx",
          "src/__tests__/useAiCliLaunchEvidence.test.tsx",
          "src/__tests__/usePaneRequestController.test.tsx",
          "src/__tests__/usePaneAgentSpawns.test.tsx",
          "src/__tests__/usePaneRegistry.test.tsx",
          "src/__tests__/useOperationalPaneSelection.test.tsx",
          "src/__tests__/PaneTreeContainerActiveTerminal.test.tsx",
          "src/__tests__/useTerminalMenuCommands.test.tsx",
          "src/__tests__/RightRailShell.test.tsx",
          "--configLoader",
          "native",
          "--reporter=json",
        ];
  const output = execFileSync(program, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 180_000,
  });
  const testReport = JSON.parse(output);
  const assertions = testReport.testResults?.flatMap((result) => result.assertionResults ?? []) ?? [];
  const behaviorRequirements = [
    {
      id: "app-shell-store-subscription-behavior",
      tests: ["useAppShellStore does not rerender the shell owner for an unrelated store mutation"],
    },
    {
      id: "project-tab-lifecycle-behavior",
      tests: [
        "useProjectTabLifecycle opens a project only after confirmation and clears active context after the tab transition",
        "useProjectTabLifecycle switches tabs only after confirmation and preserves every active-context owner on cancel",
        "useProjectTabLifecycle closes the folder only after confirmation and detaches the effective project path",
        "useProjectTabLifecycle closes an inactive tab without discarding active editor or interactive context",
        "useProjectTabLifecycle closes the active tab only after confirmation and commits cleanup after the tab transition",
      ],
    },
    {
      id: "project-tab-shortcut-routing-behavior",
      tests: [
        "useKeyboardShortcuts terminal focus routes Ctrl+Tab and Ctrl+Shift+Tab through the guarded project-tab switch callback",
      ],
    },
    {
      id: "evidence-generation-behavior",
      tests: [
        "useReleaseGoalEvidence adopts all three files as one snapshot and fails closed on a partial generation",
        "useReleaseGoalEvidence suppresses overlap and rejects the old project generation after a project change",
        "useAuthenticatedPromptEvidence suppresses overlap and rejects completion from an old project or unmounted owner",
        "useAiCliLaunchEvidence suppresses overlap and rejects completion from an old project or unmounted owner",
        "useAiCliLaunchEvidence retains the existing partial preflight contract within one completed generation",
      ],
    },
    {
      id: "pane-request-lifecycle-behavior",
      tests: [
        "usePaneRequestController continues dispatching after the StrictMode effect rehearsal",
        "usePaneRequestController serializes concurrent restart requests FIFO and settles each callback exactly once",
        "usePaneRequestController advances after failure and preserves acceptance order across asynchronous tab routing",
        "usePaneRequestController waits for real completion before publishing the next synchronous loss-intolerant request",
        "usePaneRequestController rejects timed-out accepted work with a typed cancellation",
        "usePaneRequestController holds the FIFO lane until timed-out backend work actually completes",
        "usePaneRequestController settles later accepted work while a hung backend lane remains quarantined",
        "usePaneRequestController settles accepted work when its tab is removed",
        "usePaneRequestController settles accepted work on unmount and ignores a later consumer completion",
        "usePaneRequestController keeps focus latest-wins when tab transitions complete out of order",
        "usePaneRequestController settles pending focus on timeout, tab removal, and unmount",
        "usePaneRequestController reports focus failure only after the pane consumer rejects the target",
      ],
    },
    {
      id: "pane-state-owner-behavior",
      tests: [
        "usePaneAgentSpawns retains the explicit initiating tab when an agent-spawn event arrives after a tab switch",
        "usePaneAgentSpawns fails closed when an autonomous spawn event has no initiating tab owner",
        "usePaneAgentSpawns routes a delayed autonomous event through one unambiguous repo owner",
        "usePaneAgentSpawns retains unconsumed batches for two initiating tabs without cross-tab overwrite",
        "usePaneRegistry removes active-PTY and registry state together when a tab is removed",
        "useOperationalPaneSelection clears a selected pane after registry cleanup removes its owner",
        "useOperationalPaneSelection refreshes the selected terminal identity without changing pane ownership",
        "useOperationalPaneSelection does not resurrect a removed pane from a late selection callback",
        "useOperationalPaneSelection clears pane and audit selections when the project owner changes",
        "useOperationalPaneSelection rejects retained selection callbacks from a previous project owner",
      ],
    },
    {
      id: "pane-tree-settlement-behavior",
      tests: [
        "PaneTreeContainer onActiveTerminalChange settles a close request only after the mux close finishes",
        "PaneTreeContainer onActiveTerminalChange settles focus requests only after resolving the target pane",
        "PaneTreeContainer onActiveTerminalChange settles missing and unmounted close requests exactly once",
        "PaneTreeContainer onActiveTerminalChange settles layout requests after backend success and failure",
        "PaneTreeContainer onActiveTerminalChange settles rename and role requests on success and missing targets",
      ],
    },
    {
      id: "terminal-menu-command-composition-behavior",
      tests: [
        "useTerminalMenuCommands exposes the terminal command and menu contract from one owner",
        "useTerminalMenuCommands opens the pane switcher without prompting for a fallback target",
        "useTerminalMenuCommands does not report focus success when the pane owner rejects the target",
        "useTerminalMenuCommands rechecks broadcast targets after confirmation before sending",
        "useTerminalMenuCommands normalizes the exact targeted-send payload",
        "useTerminalMenuCommands normalizes the exact confirmed broadcast payload",
        "useTerminalMenuCommands refreshes close-tab command ownership after the active tab changes",
      ],
    },
    {
      id: "right-rail-shell-composition-behavior",
      tests: [
        "RightRailShell projects shell geometry, active mode, badges, and content from one typed view model",
        "RightRailShell routes mode click and keyboard navigation through the action contract",
        "RightRailShell routes keyboard resizing through the width action without owning duplicate width state",
        "RightRailShell routes pointer resizing with the inverted rail delta and releases its drag owner",
        "RightRailShell projects the existing zen or collapsed visibility decision without rederiving it",
      ],
    },
  ];
  for (const requirement of behaviorRequirements) {
    const missingOrFailing = requirement.tests.filter(
      (fullName) => assertions.find((assertion) => assertion.fullName === fullName)?.status !== "passed",
    );
    const passed = testReport.success && missingOrFailing.length === 0;
    scenarios.push({
      id: requirement.id,
      status: passed ? "pass" : "fail",
      tests: requirement.tests,
      ...(passed ? {} : { missingOrFailing }),
    });
    failed ||= !passed;
  }
} catch (error) {
  failed = true;
  const detail = error instanceof Error ? error.message : String(error);
  scenarios.push(
    { id: "app-shell-store-subscription-behavior", status: "fail", error: detail },
    { id: "project-tab-lifecycle-behavior", status: "fail", error: detail },
    { id: "project-tab-shortcut-routing-behavior", status: "fail", error: detail },
    { id: "evidence-generation-behavior", status: "fail", error: detail },
    { id: "pane-request-lifecycle-behavior", status: "fail", error: detail },
    { id: "pane-state-owner-behavior", status: "fail", error: detail },
    { id: "pane-tree-settlement-behavior", status: "fail", error: detail },
    { id: "terminal-menu-command-composition-behavior", status: "fail", error: detail },
    { id: "right-rail-shell-composition-behavior", status: "fail", error: detail },
  );
}
const paths = {
  app: "src/App.tsx",
  appShellStore: "src/features/app/useAppShellStore.ts",
  appShellStoreTest: "src/__tests__/useAppShellStore.test.tsx",
  projectTabLifecycleTest: "src/__tests__/useProjectTabLifecycle.test.tsx",
  keyboardShortcuts: "src/shared/hooks/useKeyboardShortcuts.ts",
  keyboardShortcutsTest: "src/__tests__/KeyboardShortcutsTerminalFocus.test.tsx",
  model: "src/features/right-rail/rightRailModel.tsx",
  rightRailShell: "src/features/right-rail/RightRailShell.tsx",
  rightRailShellContract: "src/features/right-rail/rightRailShellContract.ts",
  rightRailShellTest: "src/__tests__/RightRailShell.test.tsx",
  audit: "src/features/right-rail/rightRailAudit.ts",
  visualQa: "src/features/right-rail/rightRailVisualQa.ts",
  widgetFrame: "src/features/right-rail/rightRailWidgetFrame.tsx",
  actionFeedback: "src/features/right-rail/useRightRailActionFeedback.ts",
  guardrailSelection: "src/features/right-rail/useRightRailGuardrailSelection.ts",
  editorOpenMode: "src/features/editor/useEditorOpenMode.ts",
  paneRegistry: "src/features/terminal/usePaneRegistry.ts",
  paneRegistryTest: "src/__tests__/usePaneRegistry.test.tsx",
  paneAgentSpawns: "src/features/terminal/usePaneAgentSpawns.ts",
  paneAgentSpawnsTest: "src/__tests__/usePaneAgentSpawns.test.tsx",
  paneRequestController: "src/features/terminal/usePaneRequestController.ts",
  paneRequestControllerTest: "src/__tests__/usePaneRequestController.test.tsx",
  operationalPaneSelection: "src/features/terminal/useOperationalPaneSelection.ts",
  operationalPaneSelectionTest: "src/__tests__/useOperationalPaneSelection.test.tsx",
  paneTreeContainer: "src/features/terminal/pane-tree/PaneTreeContainer.tsx",
  paneTreeContainerTest: "src/__tests__/PaneTreeContainerActiveTerminal.test.tsx",
  releaseGoalEvidence: "src/features/app/useReleaseGoalEvidence.ts",
  releaseGoalEvidenceTest: "src/__tests__/useReleaseGoalEvidence.test.tsx",
  authenticatedPromptEvidence: "src/features/app/useAuthenticatedPromptEvidence.ts",
  authenticatedPromptEvidenceTest: "src/__tests__/useAuthenticatedPromptEvidence.test.tsx",
  aiCliLaunchEvidence: "src/features/app/useAiCliLaunchEvidence.ts",
  aiCliLaunchEvidenceTest: "src/__tests__/useAiCliLaunchEvidence.test.tsx",
  orchestratorCommands: "src-tauri/src/ipc/orchestrator_commands.rs",
  projectTabLifecycle: "src/features/app/useProjectTabLifecycle.ts",
  appMenus: "src/features/app/useAppMenus.ts",
  terminalMenuCommands: "src/features/app/useTerminalMenuCommands.ts",
  terminalMenuCommandsTest: "src/__tests__/useTerminalMenuCommands.test.tsx",
  decisionInbox: "src/features/decision-inbox/useDecisionInbox.ts",
  orchestraDispatch: "src/features/orchestrator/useOrchestraDispatch.ts",
  lazy: "src/features/app/lazyPanels.tsx",
  config: "src/features/right-rail/bootstrapAppConfig.ts",
  bootstrapHook: "src/features/app/useBootstrapAppConfig.ts",
  types: "src/features/right-rail/rightRailTypes.ts",
  projectArtifacts: "src/shared/lib/projectArtifacts.ts",
  projectArtifactsTest: "src/__tests__/projectArtifacts.test.ts",
  feedbackHook: "src/features/right-rail/useRightRailFeedbackPersistence.ts",
  feedbackContract: "src/features/right-rail/rightRailFeedbackContract.ts",
  feedbackStorage: "src/features/right-rail/rightRailFeedbackPersistence.ts",
};
const source = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, readFileSync(join(root, path), "utf8")]));
for (const [id, ceiling] of Object.entries({
  projectArtifacts: 17,
  releaseGoalEvidence: 139,
  authenticatedPromptEvidence: 78,
  aiCliLaunchEvidence: 78,
  paneRegistry: 78,
  paneAgentSpawns: 130,
  paneRequestController: 375,
  operationalPaneSelection: 123,
  paneTreeContainer: 1691,
  bootstrapHook: 53,
  config: 34,
  appMenus: 433,
  terminalMenuCommands: 639,
  appShellStore: 60,
  keyboardShortcuts: 261,
  decisionInbox: 134,
  orchestraDispatch: 169,
  rightRailShell: 107,
  rightRailShellContract: 14,
})) {
  const lines = source[id].split(/\r?\n/).length;
  const ok = lines <= ceiling;
  scenarios.push({ id: `${id}-non-growth`, status: ok ? "pass" : "fail", lines, ceiling });
  failed ||= !ok;
}
const appRightRailModelImport =
  source.app.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/features\/right-rail\/rightRailModel["'];/)?.[1] ?? "";
const uncommentedAppSource = source.app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const appStoreImport =
  uncommentedAppSource.match(
    /import\s*\{(?<bindings>[^}]*)\}\s*from\s*["']\.\/shared\/store\/appStore["'];/,
  )?.groups?.bindings ?? "";
const useAppStoreLocalNames = appStoreImport
  .split(",")
  .map((binding) => binding.trim().match(/^useAppStore(?:\s+as\s+(?<alias>[A-Za-z_$][\w$]*))?$/))
  .filter(Boolean)
  .map((binding) => binding.groups?.alias ?? "useAppStore");
const selectorlessAppSubscription =
  useAppStoreLocalNames.length === 0 ||
  useAppStoreLocalNames.some((localName) =>
    new RegExp(`\\b${localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\s*\\)`).test(
      uncommentedAppSource,
    ),
  );
const genericOwnersImportingRightRailModel = [
  "releaseGoalEvidence",
  "authenticatedPromptEvidence",
  "aiCliLaunchEvidence",
  "bootstrapHook",
  "config",
  "decisionInbox",
  "orchestraDispatch",
].filter((id) => source[id].includes("rightRailModel"));
for (const [id, ok, evidence] of [
  ["app-composition-non-growth", source.app.split(/\r?\n/).length <= 4155, { lines: source.app.split(/\r?\n/).length, ceiling: 4155 }],
  [
    "app-shell-store-subscription-narrow",
    source.app.includes('import { useAppShellStore } from "./features/app/useAppShellStore"') &&
      source.app.includes("} = useAppShellStore();") &&
      !selectorlessAppSubscription &&
      source.appShellStore.includes('import { useShallow } from "zustand/react/shallow"') &&
      source.appShellStore.includes("useAppStore(") &&
      source.appShellStore.includes("useShallow((state) => ({") &&
      source.appShellStoreTest.includes("does not rerender the shell owner for an unrelated store mutation"),
    {},
  ],
  ["right-rail-baseline-lowered", source.model.split(/\r?\n/).length <= 666, { lines: source.model.split(/\r?\n/).length, ceiling: 666 }],
  ["neutral-project-artifact-utilities-owned",
    source.projectArtifacts.includes("export function resolveProjectFilePath") &&
      source.projectArtifacts.includes("export function parseJsonArtifact") &&
      source.projectArtifactsTest.includes("preserves absolute Windows, UNC, and POSIX paths") &&
      source.projectArtifactsTest.includes("returns null for whitespace and invalid JSON"),
    {}],
  ["right-rail-model-does-not-own-generic-artifacts",
    !source.model.includes("function resolveProjectFilePath") &&
      !source.model.includes("function parseJsonArtifact") &&
      !source.model.includes("projectArtifacts"),
    {}],
  ["generic-app-artifacts-use-neutral-owner",
    source.app.includes('from "./shared/lib/projectArtifacts"') &&
      !appRightRailModelImport.includes("resolveProjectFilePath") &&
      !appRightRailModelImport.includes("parseJsonArtifact") &&
      source.releaseGoalEvidence.includes('from "../../shared/lib/projectArtifacts"') &&
      source.authenticatedPromptEvidence.includes('from "../../shared/lib/projectArtifacts"') &&
      source.aiCliLaunchEvidence.includes('from "../../shared/lib/projectArtifacts"') &&
      genericOwnersImportingRightRailModel.length === 0,
    { genericOwnersImportingRightRailModel }],
  ["bootstrap-contracts-use-declaration-owners",
    source.config.includes('from "./rightRailTypes"') &&
      source.bootstrapHook.includes('from "../right-rail/rightRailWidgetFrame"') &&
      source.aiCliLaunchEvidence.includes('from "../right-rail/rightRailTypes"') &&
      !source.model.includes("BootstrapAppConfig"),
    {}],
  ["lazy-registry-owned", source.app.includes('from "./features/app/lazyPanels"') && source.lazy.includes("export const AgentInspector = lazy"), {}],
  ["bootstrap-schema-owned",
    source.bootstrapHook.includes('from "../right-rail/bootstrapAppConfig"') &&
      source.config.includes("export type BootstrapAppConfig") &&
      !source.model.includes("BootstrapAppConfig"),
    {}],
  ["bootstrap-effects-owned", source.app.includes("useBootstrapAppConfig()") && source.bootstrapHook.includes('invoke<BootstrapAppConfig>("load_app_config")'), {}],
  [
    "right-rail-types-owned",
    source.model.includes('from "./rightRailTypes"') &&
      !source.model.includes('export type * from "./rightRailTypes"') &&
      source.types.includes("export interface RightRailEdgeScore"),
    {},
  ],
  ["feedback-lifecycle-owned", source.app.includes("useRightRailFeedbackPersistence(") && source.feedbackHook.includes("skipSaveKeyRef"), {}],
  [
    "feedback-contract-owned",
    source.app.includes('from "./features/right-rail/rightRailFeedbackContract"') &&
      !source.model.includes('export * from "./rightRailFeedbackContract"') &&
      source.feedbackContract.includes("RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX"),
    {},
  ],
  ["feedback-storage-owned", source.model.includes('from "./rightRailFeedbackPersistence"') && source.feedbackStorage.includes("rightRailWorkspaceStorageHash"), {}],
  [
    "right-rail-audit-owned",
    source.app.includes('from "./features/right-rail/rightRailAudit"') &&
      !source.model.includes('export * from "./rightRailAudit"') &&
      source.audit.includes("export async function appendRightRailActionAudit"),
    {},
  ],
  [
    "right-rail-visual-qa-owned",
    source.app.includes('from "./features/right-rail/rightRailVisualQa"') &&
      !source.model.includes('export * from "./rightRailVisualQa"') &&
      source.visualQa.includes("export function readDevVisualQaState") &&
      source.visualQa.includes("export function createDevVisualQaCommandBlocks") &&
      source.visualQa.includes("export function createDevVisualQaPanes"),
    {},
  ],
  [
    "right-rail-widget-frame-owned",
    source.app.includes('from "./features/right-rail/rightRailWidgetFrame"') &&
      !source.model.includes('export * from "./rightRailWidgetFrame"') &&
      source.widgetFrame.includes("export function RightRailWidgetFrame"),
    {},
  ],
  [
    "right-rail-runtime-barrel-closed",
    !source.model.includes("export * from") &&
      source.feedbackHook.includes('from "./rightRailFeedbackPersistence"') &&
      source.guardrailSelection.includes('from "./rightRailWidgetFrame"') &&
      source.actionFeedback.includes('from "./rightRailTypes"'),
    {},
  ],
  [
    "right-rail-shell-contract-owned",
    source.app.includes('import { RightRailShell } from "./features/right-rail/RightRailShell"') &&
      source.app.includes("<RightRailShell") &&
      source.app.includes("onWidthChange: setRightPanelWidth") &&
      source.app.includes("onModeChange: setRightRailMode") &&
      source.rightRailShellContract.includes("export interface RightRailShellViewModel") &&
      source.rightRailShellContract.includes("export interface RightRailShellActions") &&
      source.rightRailShell.includes("export interface RightRailShellProps") &&
      source.rightRailShell.includes("getNextRightRailMode(activeMode, event.key)") &&
      source.rightRailShellTest.includes("without owning duplicate width state"),
    {},
  ],
  ["right-rail-action-feedback-owned", source.app.includes("useRightRailActionFeedback()") && source.actionFeedback.includes("export function useRightRailActionFeedback"), {}],
  ["right-rail-guardrail-selection-owned", source.app.includes("useRightRailGuardrailSelection()") && source.guardrailSelection.includes("export function useRightRailGuardrailSelection") && source.guardrailSelection.includes("RIGHT_RAIL_GUARDRAIL_SYNC_EVENT") && source.guardrailSelection.includes("saveRightRailGuardrailSelection"), {}],
  ["editor-open-mode-owned", source.app.includes("useEditorOpenMode({") && source.editorOpenMode.includes("export function useEditorOpenMode") && source.editorOpenMode.includes("EDITOR_OPEN_MODE_CHANGE_EVENT") && source.editorOpenMode.includes('operation: "open_git_file_diff_in_vscode"'), {}],
  [
    "terminal-menu-command-owner",
    source.appMenus.includes('from "./useTerminalMenuCommands"') &&
      source.appMenus.includes("...terminalCommands") &&
      source.appMenus.includes("terminalMenu,") &&
      !source.appMenus.includes('id: "switch-terminal-pane"') &&
      source.terminalMenuCommands.includes("export function useTerminalMenuCommands") &&
      source.terminalMenuCommandsTest.includes(
        "rechecks broadcast targets after confirmation before sending",
      ),
    {},
  ],
  ["pane-registry-owned", source.app.includes("usePaneRegistry(") && source.paneRegistry.includes("export function usePaneRegistry") && source.paneRegistry.includes("paneRegistryEqual") && source.paneRegistry.includes("clearActivePtyId"), {}],
  ["pane-agent-spawns-owned",
    source.app.includes("usePaneAgentSpawns(paneAgentSpawnOwners)") &&
      source.app.includes("spawnAgentPaneRequest={paneAgentSpawnsByTab[tab.id] ?? null}") &&
      source.paneAgentSpawns.includes("export function usePaneAgentSpawns") &&
      source.paneAgentSpawns.includes("resolveEventOwnerTabId") &&
      source.paneAgentSpawns.includes("paneAgentSpawnsByTab") &&
      source.paneAgentSpawnsTest.includes("without cross-tab overwrite") &&
      source.orchestratorCommands.includes('"repoPath": &event_repo_path'),
    {}],
  ["pane-request-controller-owned",
    source.app.includes("usePaneRequestController({") &&
      source.app.includes("liveTabIds,") &&
      source.paneRequestController.includes("export function usePaneRequestController") &&
      source.paneRequestController.includes("useSerializedPaneRequest") &&
      source.paneRequestController.includes("PaneRequestCancelledError") &&
      source.paneRequestController.includes("onComplete") &&
      source.paneRequestControllerTest.includes("settles each callback exactly once"),
    {}],
  ["operational-pane-selection-owned",
    source.app.includes("useOperationalPaneSelection(visualTerminalPaneTargets, projectPath)") &&
      source.operationalPaneSelection.includes("export function useOperationalPaneSelection") &&
      source.operationalPaneSelection.includes("reconcileOperationalPaneSelection(selected, panes)") &&
      source.operationalPaneSelection.includes("currentOwnerKeyRef.current === ownerKey") &&
      source.operationalPaneSelectionTest.includes("rejects retained selection callbacks from a previous project owner"),
    {}],
  ["release-goal-evidence-owned", source.app.includes("useReleaseGoalEvidence(projectPath)") && source.releaseGoalEvidence.includes("export function useReleaseGoalEvidence") && source.releaseGoalEvidence.includes("final-goal-safe-summary.json") && source.releaseGoalEvidence.includes("deriveFinalGoalRequirementProofs(null)"), {}],
  ["authenticated-prompt-evidence-owned", source.app.includes("useAuthenticatedPromptEvidence(projectPath)") && source.authenticatedPromptEvidence.includes("export function useAuthenticatedPromptEvidence") && source.authenticatedPromptEvidence.includes("Promise.allSettled") && source.authenticatedPromptEvidence.includes("deriveAuthenticatedPromptConsentPacket(null)"), {}],
  ["ai-cli-launch-evidence-owned", source.app.includes("useAiCliLaunchEvidence(projectPath)") && source.aiCliLaunchEvidence.includes("export function useAiCliLaunchEvidence") && source.aiCliLaunchEvidence.includes("Promise.allSettled") && source.aiCliLaunchEvidence.includes("read_ai_cli_launch_evidence"), {}],
  ["project-tab-lifecycle-owned",
    source.app.includes("useProjectTabLifecycle({") &&
      source.app.includes("resolveEffectiveProjectPath(rootProjectPath, activeTab.cwd)") &&
      source.projectTabLifecycle.includes("export function useProjectTabLifecycle") &&
      source.projectTabLifecycle.includes("confirmDiscardUnsavedFiles") &&
      source.projectTabLifecycle.includes('confirmDiscardUnsavedFiles("Close this tab and discard them")') &&
      source.projectTabLifecycle.includes("deletePaneTreeSnapshotFromBackend(storageKey)") &&
      source.projectTabLifecycleTest.includes("preserves every active-context owner on cancel") &&
      source.projectTabLifecycleTest.includes("detaches the effective project path"),
    {}],
  ["project-tab-shortcut-routing-owned",
    source.app.includes("switchTab: handleTabSwitch") &&
      source.keyboardShortcuts.includes("void switchTab(tabs[next].id)") &&
      !source.keyboardShortcuts.includes("setActiveTabId") &&
      source.keyboardShortcutsTest.includes(
        "routes Ctrl+Tab and Ctrl+Shift+Tab through the guarded project-tab switch callback",
      ),
    {}],
]) {
  scenarios.push({ id, status: ok ? "pass" : "fail", ...evidence });
  failed ||= !ok;
}
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-frontend-ratchet/v1",
  contractVersion: "a6.2f-component-command-composition/v2",
  status: failed ? "failed" : "pass-a6.2f-right-rail-shell-contract",
  completedSlice: failed ? null : "A6.2e4",
  activeSlice: "A6.2f",
  checkpoint: failed ? null : "right-rail-shell-contract",
  sliceComplete: false,
  phaseComplete: false,
  scenarios,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a6-frontend-ratchet.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      ...Object.values(paths),
      "scripts/verify-a6-modularity-inventory.mjs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
