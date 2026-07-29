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
          "pnpm.cmd exec vitest run src/__tests__/useAppShellStore.test.tsx --configLoader native --reporter=json",
        ]
      : [
          "exec",
          "vitest",
          "run",
          "src/__tests__/useAppShellStore.test.tsx",
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
  const expectedTest = testReport.testResults
    ?.flatMap((result) => result.assertionResults ?? [])
    .find(
      (assertion) =>
        assertion.fullName ===
        "useAppShellStore does not rerender the shell owner for an unrelated store mutation",
    );
  if (!testReport.success || expectedTest?.status !== "passed") {
    throw new Error("The required App shell subscription behavior test did not execute and pass.");
  }
  scenarios.push({
    id: "app-shell-store-subscription-behavior",
    status: "pass",
    test: expectedTest.fullName,
  });
} catch (error) {
  failed = true;
  scenarios.push({
    id: "app-shell-store-subscription-behavior",
    status: "fail",
    error: error instanceof Error ? error.message : String(error),
  });
}
const paths = {
  app: "src/App.tsx",
  appShellStore: "src/features/app/useAppShellStore.ts",
  appShellStoreTest: "src/__tests__/useAppShellStore.test.tsx",
  model: "src/features/right-rail/rightRailModel.tsx",
  audit: "src/features/right-rail/rightRailAudit.ts",
  visualQa: "src/features/right-rail/rightRailVisualQa.ts",
  widgetFrame: "src/features/right-rail/rightRailWidgetFrame.tsx",
  actionFeedback: "src/features/right-rail/useRightRailActionFeedback.ts",
  guardrailSelection: "src/features/right-rail/useRightRailGuardrailSelection.ts",
  editorOpenMode: "src/features/editor/useEditorOpenMode.ts",
  paneRegistry: "src/features/terminal/usePaneRegistry.ts",
  paneAgentSpawns: "src/features/terminal/usePaneAgentSpawns.ts",
  paneRequestController: "src/features/terminal/usePaneRequestController.ts",
  operationalPaneSelection: "src/features/terminal/useOperationalPaneSelection.ts",
  releaseGoalEvidence: "src/features/app/useReleaseGoalEvidence.ts",
  authenticatedPromptEvidence: "src/features/app/useAuthenticatedPromptEvidence.ts",
  aiCliLaunchEvidence: "src/features/app/useAiCliLaunchEvidence.ts",
  projectTabLifecycle: "src/features/app/useProjectTabLifecycle.ts",
  appMenus: "src/features/app/useAppMenus.ts",
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
  releaseGoalEvidence: 88,
  authenticatedPromptEvidence: 66,
  aiCliLaunchEvidence: 68,
  bootstrapHook: 53,
  config: 34,
  appMenus: 989,
  appShellStore: 60,
  decisionInbox: 134,
  orchestraDispatch: 169,
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
  ["app-baseline-lowered", source.app.split(/\r?\n/).length <= 4215, { lines: source.app.split(/\r?\n/).length, ceiling: 4215 }],
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
  ["right-rail-baseline-lowered", source.model.split(/\r?\n/).length <= 688, { lines: source.model.split(/\r?\n/).length, ceiling: 688 }],
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
  ["right-rail-types-owned", source.model.includes('from "./rightRailTypes"') && source.types.includes("export interface RightRailEdgeScore"), {}],
  ["feedback-lifecycle-owned", source.app.includes("useRightRailFeedbackPersistence(") && source.feedbackHook.includes("skipSaveKeyRef"), {}],
  ["feedback-contract-owned", source.model.includes('from "./rightRailFeedbackContract"') && source.feedbackContract.includes("RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX"), {}],
  ["feedback-storage-owned", source.model.includes('from "./rightRailFeedbackPersistence"') && source.feedbackStorage.includes("rightRailWorkspaceStorageHash"), {}],
  ["right-rail-audit-owned", source.model.includes('export * from "./rightRailAudit"') && source.audit.includes("export async function appendRightRailActionAudit"), {}],
  ["right-rail-visual-qa-owned", source.model.includes('export * from "./rightRailVisualQa"') && source.visualQa.includes("export function readDevVisualQaState") && source.visualQa.includes("export function createDevVisualQaCommandBlocks") && source.visualQa.includes("export function createDevVisualQaPanes"), {}],
  ["right-rail-widget-frame-owned", source.model.includes('export * from "./rightRailWidgetFrame"') && source.widgetFrame.includes("export function RightRailWidgetFrame"), {}],
  ["right-rail-action-feedback-owned", source.app.includes("useRightRailActionFeedback()") && source.actionFeedback.includes("export function useRightRailActionFeedback"), {}],
  ["right-rail-guardrail-selection-owned", source.app.includes("useRightRailGuardrailSelection()") && source.guardrailSelection.includes("export function useRightRailGuardrailSelection") && source.guardrailSelection.includes("RIGHT_RAIL_GUARDRAIL_SYNC_EVENT") && source.guardrailSelection.includes("saveRightRailGuardrailSelection"), {}],
  ["editor-open-mode-owned", source.app.includes("useEditorOpenMode({") && source.editorOpenMode.includes("export function useEditorOpenMode") && source.editorOpenMode.includes("EDITOR_OPEN_MODE_CHANGE_EVENT") && source.editorOpenMode.includes('operation: "open_git_file_diff_in_vscode"'), {}],
  ["pane-registry-owned", source.app.includes("usePaneRegistry(") && source.paneRegistry.includes("export function usePaneRegistry") && source.paneRegistry.includes("paneRegistryEqual") && source.paneRegistry.includes("clearActivePtyId"), {}],
  ["pane-agent-spawns-owned", source.app.includes("usePaneAgentSpawns(activeTabId)") && source.paneAgentSpawns.includes("export function usePaneAgentSpawns") && source.paneAgentSpawns.includes("sequenceRef.current += 1") && source.paneAgentSpawns.includes("mounted.terminalId === agent.terminalId"), {}],
  ["pane-request-controller-owned", source.app.includes("usePaneRequestController({") && source.paneRequestController.includes("export function usePaneRequestController") && source.paneRequestController.includes("Restart target tab is unavailable.") && source.paneRequestController.includes("onComplete: (error)"), {}],
  ["operational-pane-selection-owned", source.app.includes("useOperationalPaneSelection(visualTerminalPaneTargets)") && source.operationalPaneSelection.includes("export function useOperationalPaneSelection") && source.operationalPaneSelection.includes("reconcileOperationalPaneSelection(selected, panes)") && source.operationalPaneSelection.includes("setSelectedAuditTraceFilter(correlationId)"), {}],
  ["release-goal-evidence-owned", source.app.includes("useReleaseGoalEvidence(projectPath)") && source.releaseGoalEvidence.includes("export function useReleaseGoalEvidence") && source.releaseGoalEvidence.includes("final-goal-safe-summary.json") && source.releaseGoalEvidence.includes("deriveFinalGoalRequirementProofs(null)"), {}],
  ["authenticated-prompt-evidence-owned", source.app.includes("useAuthenticatedPromptEvidence(projectPath)") && source.authenticatedPromptEvidence.includes("export function useAuthenticatedPromptEvidence") && source.authenticatedPromptEvidence.includes("Promise.allSettled") && source.authenticatedPromptEvidence.includes("deriveAuthenticatedPromptConsentPacket(null)"), {}],
  ["ai-cli-launch-evidence-owned", source.app.includes("useAiCliLaunchEvidence(projectPath)") && source.aiCliLaunchEvidence.includes("export function useAiCliLaunchEvidence") && source.aiCliLaunchEvidence.includes("Promise.allSettled") && source.aiCliLaunchEvidence.includes("read_ai_cli_launch_evidence"), {}],
  ["project-tab-lifecycle-owned", source.app.includes("useProjectTabLifecycle({") && source.projectTabLifecycle.includes("export function useProjectTabLifecycle") && source.projectTabLifecycle.includes("confirmDiscardUnsavedFiles") && source.projectTabLifecycle.includes("deletePaneTreeSnapshotFromBackend(storageKey)"), {}],
]) {
  scenarios.push({ id, status: ok ? "pass" : "fail", ...evidence });
  failed ||= !ok;
}
const generatedAt = new Date().toISOString();
const report = { schema: "aelyris.a6-frontend-ratchet/v1", status: failed ? "failed" : "pass-a6.2a-frontend-owner-extraction", sliceComplete: !failed, phaseComplete: false, scenarios, generatedAt, provenance: createEvidenceProvenance({ root, verifierPath: "scripts/verify-a6-frontend-ratchet.mjs", inputPaths: ["scripts/evidence-provenance.mjs", ...Object.values(paths), "scripts/verify-a6-modularity-inventory.mjs", "package.json"], generatedAt }) };
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
