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
const paths = { app: "src/App.tsx", model: "src/features/right-rail/rightRailModel.tsx", audit: "src/features/right-rail/rightRailAudit.ts", visualQa: "src/features/right-rail/rightRailVisualQa.ts", widgetFrame: "src/features/right-rail/rightRailWidgetFrame.tsx", actionFeedback: "src/features/right-rail/useRightRailActionFeedback.ts", guardrailSelection: "src/features/right-rail/useRightRailGuardrailSelection.ts", editorOpenMode: "src/features/editor/useEditorOpenMode.ts", paneRegistry: "src/features/terminal/usePaneRegistry.ts", paneAgentSpawns: "src/features/terminal/usePaneAgentSpawns.ts", paneRequestController: "src/features/terminal/usePaneRequestController.ts", operationalPaneSelection: "src/features/terminal/useOperationalPaneSelection.ts", releaseGoalEvidence: "src/features/app/useReleaseGoalEvidence.ts", authenticatedPromptEvidence: "src/features/app/useAuthenticatedPromptEvidence.ts", lazy: "src/features/app/lazyPanels.tsx", config: "src/features/right-rail/bootstrapAppConfig.ts", bootstrapHook: "src/features/app/useBootstrapAppConfig.ts", types: "src/features/right-rail/rightRailTypes.ts", feedbackHook: "src/features/right-rail/useRightRailFeedbackPersistence.ts", feedbackContract: "src/features/right-rail/rightRailFeedbackContract.ts", feedbackStorage: "src/features/right-rail/rightRailFeedbackPersistence.ts" };
const source = Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, readFileSync(join(root, path), "utf8")]));
for (const [id, ok, evidence] of [
  ["app-baseline-lowered", source.app.split(/\r?\n/).length <= 4397, { lines: source.app.split(/\r?\n/).length, ceiling: 4397 }],
  ["right-rail-baseline-lowered", source.model.split(/\r?\n/).length <= 688, { lines: source.model.split(/\r?\n/).length, ceiling: 688 }],
  ["lazy-registry-owned", source.app.includes('from "./features/app/lazyPanels"') && source.lazy.includes("export const AgentInspector = lazy"), {}],
  ["bootstrap-schema-owned", source.model.includes('from "./bootstrapAppConfig"') && source.config.includes("export type BootstrapAppConfig"), {}],
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
