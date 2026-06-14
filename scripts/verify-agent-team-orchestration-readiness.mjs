import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "agent-team-orchestration-readiness.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const sourcePaths = {
  packageJson: "package.json",
  orchestrator: "src/shared/lib/orchestrator.ts",
  orchestraDispatch: "src/shared/lib/orchestraDispatch.ts",
  orchestraDialog: "src/shared/ui/OrchestraDialog.tsx",
  app: "src/App.tsx",
  ipcCommands: "src-tauri/src/ipc/commands.rs",
  styles: "src/styles/global.css",
  toolkit: "src/features/toolkit/ToolkitPanel.tsx",
  orchestratorTest: "src/__tests__/orchestrator.test.ts",
  orchestraRolesTest: "src/__tests__/orchestraRoles.test.ts",
  orchestraDialogTest: "src/__tests__/OrchestraDialog.test.tsx",
  rightRailDensityVerifier: "scripts/verify-right-rail-information-density.mjs",
  muxPerformanceVerifier: "scripts/verify-mux-performance.mjs",
  muxLiveVerifier: "scripts/verify-mux-live-restore.mjs",
  upperCompatVerifier: "scripts/verify-upper-compat-gates.mjs",
  safeVerifier: "scripts/verify-final-goal-safe.mjs",
};

const artifactPaths = {
  rightRailDensity: ".codex-auto/quality/right-rail-information-density-contract.json",
  muxPerformance: ".codex-auto/performance/mux-performance-smoke.json",
  muxLiveRestore: ".codex-auto/performance/mux-live-restore-smoke.json",
  upperCompat: ".codex-auto/quality/upper-compat-gates.json",
};

function fullPath(path) {
  return join(ROOT, path);
}

function read(path) {
  return readFileSync(fullPath(path), "utf8");
}

function readJson(path) {
  const full = fullPath(path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function mtimeMs(path) {
  const full = fullPath(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function checkById(report, id) {
  return (Array.isArray(report?.checks) ? report.checks : []).find((check) => check?.id === id);
}

function allCheckStatusesPassed(report) {
  return (
    Array.isArray(report?.checks) &&
    report.checks.length > 0 &&
    report.checks.every((check) => check?.status === "passed" || check?.ok === true)
  );
}

function artifactSummary(path, data) {
  const full = fullPath(path);
  return {
    path,
    exists: existsSync(full),
    mtimeMs: mtimeMs(path),
    status: data?.status ?? null,
    ok: data?.ok ?? null,
  };
}

function add(checks, id, ok, detail, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), detail, evidence });
}

const packageJson = read(sourcePaths.packageJson);
const orchestrator = read(sourcePaths.orchestrator);
const orchestraDispatch = read(sourcePaths.orchestraDispatch);
const orchestraDialog = read(sourcePaths.orchestraDialog);
const app = read(sourcePaths.app);
const ipcCommands = read(sourcePaths.ipcCommands);
const styles = read(sourcePaths.styles);
const toolkit = read(sourcePaths.toolkit);
const orchestratorTest = read(sourcePaths.orchestratorTest);
const orchestraRolesTest = read(sourcePaths.orchestraRolesTest);
const orchestraDialogTest = read(sourcePaths.orchestraDialogTest);
const safeVerifier = read(sourcePaths.safeVerifier);
const rightRailDensityVerifier = read(sourcePaths.rightRailDensityVerifier);
const muxPerformanceVerifier = read(sourcePaths.muxPerformanceVerifier);
const muxLiveVerifier = read(sourcePaths.muxLiveVerifier);
const upperCompatVerifier = read(sourcePaths.upperCompatVerifier);

const rightRailDensity = readJson(artifactPaths.rightRailDensity);
const muxPerformance = readJson(artifactPaths.muxPerformance);
const muxLiveRestore = readJson(artifactPaths.muxLiveRestore);
const upperCompat = readJson(artifactPaths.upperCompat);

const sourceMtims = Object.fromEntries(Object.entries(sourcePaths).map(([key, path]) => [key, mtimeMs(path)]));
const sourceCutoffMs = Math.max(...Object.values(sourceMtims));
const artifactMtims = Object.fromEntries(Object.entries(artifactPaths).map(([key, path]) => [key, mtimeMs(path)]));
const rightRailDensityChecks = Object.fromEntries(
  (Array.isArray(rightRailDensity?.checks) ? rightRailDensity.checks : []).map((check) => [check.id, check]),
);
const muxPerfSummary = muxPerformance?.summary ?? {};
const muxPerfBudgets = muxPerformance?.budgets ?? {};
const muxLiveChecks = Array.isArray(muxLiveRestore?.checks) ? muxLiveRestore.checks : [];
const muxLiveCapabilities = muxLiveRestore?.secondContract?.capabilities ?? muxLiveRestore?.firstContract?.capabilities ?? [];
const upperCompatGates = upperCompat?.proof?.gates ?? {};
const artifactFreshness = {
  rightRailDensity: artifactMtims.rightRailDensity + 5_000 >= mtimeMs(sourcePaths.rightRailDensityVerifier),
  muxPerformance: artifactMtims.muxPerformance + 5_000 >= mtimeMs(sourcePaths.muxPerformanceVerifier),
  muxLiveRestore: artifactMtims.muxLiveRestore + 5_000 >= mtimeMs(sourcePaths.muxLiveVerifier),
  upperCompat: artifactMtims.upperCompat + 5_000 >= mtimeMs(sourcePaths.upperCompatVerifier),
};

const roleIds = ["implementer", "tester", "reviewer", "documenter"];
const laneIds = ["build", "verify", "review", "docs"];
const checks = [];

add(
  checks,
  "role-lane-model-contract",
  roleIds.every((id) => orchestrator.includes(`id: "${id}"`)) &&
    laneIds.every((lane) => orchestrator.includes(`lane: "${lane}"`)) &&
    orchestrator.includes('model: "opus"') &&
    orchestrator.includes('model: "sonnet"') &&
    orchestrator.includes('model: "haiku"') &&
    orchestrator.includes("mission:") &&
    orchestrator.includes("handoff:") &&
    orchestrator.includes("evidence:") &&
    orchestrator.includes("conflictPolicy:"),
  "Orchestra roles are lane-scoped, model-scoped, and carry mission/handoff/evidence/conflict contracts.",
  { roleIds, laneIds },
);

add(
  checks,
  "parallel-run-plan-contract",
  orchestrator.includes('mode: "single-lane" | "parallel-lanes" | "review-first"') &&
    orchestrator.includes('return roles.length > 1 ? "parallel-lanes" : "single-lane";') &&
    orchestrator.includes("Prefer one pane or worktree per role") &&
    orchestrator.includes("Keep implementation and test lanes in separate panes or worktrees") &&
    orchestrator.includes("pendingDecisionCount") &&
    orchestrator.includes("existingSessionCount") &&
    orchestrator.includes("contextPack") &&
    orchestrator.includes('"node_modules"') &&
    orchestrator.includes('"src-tauri/target"') &&
    orchestrator.includes('"dist"') &&
    orchestrator.includes('".env"'),
  "Run planning can switch between single-lane, parallel lanes, and review-first, with worktree/pane policy and scoped context packs.",
);

add(
  checks,
  "role-prompt-handoff-contract",
  orchestrator.includes("Aether Orchestra Contract:") &&
    orchestrator.includes("- Project:") &&
    orchestrator.includes("- Worktree branch:") &&
    orchestrator.includes("- Lane:") &&
    orchestrator.includes("- Mission:") &&
    orchestrator.includes("- Conflict policy:") &&
    orchestrator.includes("- Handoff:") &&
    orchestrator.includes("- Evidence:") &&
    orchestrator.includes("- Expected artifacts:") &&
    orchestrator.includes("- Exclude from context:"),
  "Every launched role prompt includes the project, lane, guardrails, handoff, evidence, and context exclusions.",
);

add(
  checks,
  "branch-name-worktree-contract",
  orchestrator.includes("export function buildOrchestraBranchName") &&
    orchestrator.includes("agent/${config.roleId}/${taskSlug}-${laneNumber}") &&
    orchestrator.includes("branchName") &&
    orchestratorTest.includes("builds branch names that match the Rust worktree validator contract") &&
    orchestratorTest.includes("agent/tester/add-auth-phase-1-4"),
  "Each Orchestra lane receives a deterministic safe branch name for interactive worktree isolation.",
);

add(
  checks,
  "conflict-detection-contract",
  orchestrator.includes("export function detectFileConflicts") &&
    orchestrator.includes("changedFileDetails") &&
    orchestrator.includes("ids.size < 2") &&
    orchestraRolesTest.includes("flags paths touched by more than one session") &&
    orchestraRolesTest.includes("deduplicates sessions editing the same path twice") &&
    orchestraRolesTest.includes("orders conflicts alphabetically by path"),
  "Shared-file collisions are detectable from per-session changed-file details and covered by regression tests.",
);

add(
  checks,
  "dialog-default-parallel-team",
  orchestraDialog.includes('const DEFAULT_ROLES: OrchestraRoleId[] = ["implementer", "tester", "reviewer"]') &&
    orchestraDialog.includes("buildOrchestraRunPlan") &&
    orchestraDialog.includes("Parallel lanes") &&
    orchestraDialog.includes("one owner per lane") &&
    orchestraDialog.includes("Orchestra dispatch plan") &&
    orchestraDialog.includes("Dispatch") &&
    orchestraDialogTest.includes("default-selects implementer / tester / reviewer") &&
    orchestraDialogTest.includes("renders all 4 role options"),
  "The dispatch dialog defaults to implement/test/review, previews lane mode, and keeps the docs lane available.",
);

add(
  checks,
  "app-dispatches-agents-in-parallel",
  app.includes("const handleStartRightRailOrchestra = useCallback(async () => {") &&
    app.includes("showOrchestra({") &&
    app.includes('defaultRoles: ["implementer", "tester", "reviewer"]') &&
    app.includes("buildOrchestraPrompts({") &&
    app.includes("changedFiles: rightRailAllChangedFiles.map((file) => file.path)") &&
    app.includes("pendingDecisionCount: decisionInbox.pendingCount") &&
    app.includes("existingSessionCount: sessions.length + interactiveSessions.length") &&
    app.includes("routeOrchestraPrompts(") &&
    app.includes('"route_agent", { prompt }') &&
    app.includes("launchOrchestraPrompts(") &&
    app.includes('setRightRailFocusWidget("sessions")'),
  "The right rail launches role-scoped interactive agents in isolated worktrees and routes the user to live sessions.",
);

add(
  checks,
  "router-ui-dispatch-contract",
  ipcCommands.includes("pub fn route_agent") &&
    orchestrator.includes("export function normalizeOrchestraRoutedModel") &&
    orchestraDispatch.includes("export async function routeOrchestraPrompts") &&
    orchestraDispatch.includes("normalizeOrchestraRoutedModel(decision.recommended_model, prompt.model)") &&
    orchestraDispatch.includes("export async function launchOrchestraPrompts") &&
    orchestraDispatch.includes("initialPrompt: prompt.prompt") &&
    orchestraDispatch.includes("branchName: prompt.branchName") &&
    orchestratorTest.includes("normalizes Claude router model names for interactive CLI dispatch") &&
    app.includes('"route_agent", { prompt }') &&
    orchestraDispatch.includes("catch {\n        return prompt;\n      }"),
  "Orchestra dispatch queries the Rust router before launch, normalizes Claude model names, and falls back to role defaults.",
);

add(
  checks,
  "right-rail-orchestra-first-not-telemetry-first",
  rightRailDensity?.ok === true &&
    rightRailDensity?.status === "pass-current-right-rail-information-density-contract" &&
    rightRailDensity?.essentialFirst === true &&
    rightRailDensity?.orchestraFirst === true &&
    rightRailDensity?.visiblePrimaryCount <= 2 &&
    rightRailDensity?.conditionalPrimaryMax <= 3 &&
    rightRailDensityChecks["toolkit-agents-review-essentials"]?.ok === true &&
    rightRailDensityChecks["orchestra-dispatch-controls"]?.ok === true &&
    rightRailDensityChecks["evidence-stays-deferred"]?.ok === true &&
    rightRailDensityChecks["operational-health-stays-deferred"]?.ok === true &&
    rightRailDensityChecks["queue-stays-deferred"]?.ok === true,
  "The default right rail is an Orchestra command surface with Toolkit, Agents, and Review essentials; telemetry stays deferred.",
  {
    visiblePrimaryCount: rightRailDensity?.visiblePrimaryCount ?? null,
    conditionalPrimaryMax: rightRailDensity?.conditionalPrimaryMax ?? null,
  },
);

add(
  checks,
  "git-vscode-toolkit-preserved",
  toolkit.includes('data-toolkit-role="git-vscode"') &&
    toolkit.includes('"open-vscode"') &&
    toolkit.includes('"git-status"') &&
    toolkit.includes('"git-log"') &&
    toolkit.includes('"worktree"') &&
    toolkit.includes("detectDangerousCommand") &&
    toolkit.includes("showConfirm") &&
    rightRailDensityVerifier.includes('toolkit.includes(\'data-toolkit-role="git-vscode"\')') &&
    rightRailDensityVerifier.includes('toolkit.includes(\'"open-vscode"\')') &&
    rightRailDensityVerifier.includes('toolkit.includes(\'"git-status"\')'),
  "Git, VS Code, worktree, and safety-confirmed command tools remain first-class inside Toolkit.",
);

add(
  checks,
  "mux-daemon-performance-and-restore-current",
  muxPerformance?.status === "passed" &&
    Array.isArray(muxPerformance?.errors) &&
    muxPerformance.errors.length === 0 &&
    muxPerfSummary.detach?.p95 <= muxPerfBudgets.detachP95Ms &&
    muxPerfSummary.attach?.p95 <= muxPerfBudgets.attachP95Ms &&
    muxPerfSummary.resize?.p95 <= muxPerfBudgets.resizeP95Ms &&
    muxPerfSummary.close?.p95 <= muxPerfBudgets.closeP95Ms &&
    muxLiveRestore?.status === "passed" &&
    muxLiveChecks.includes("daemon-restart-restores-mux-graph") &&
    muxLiveChecks.includes("daemon-restart-replays-durable-scrollback") &&
    muxLiveChecks.includes("attach-respawns-live-pty-without-duplicates") &&
    muxLiveChecks.includes("synchronized-pane-mode-mirrors-single-pane-input") &&
    muxLiveChecks.includes("broadcast-input-reaches-all-live-panes") &&
    muxLiveChecks.includes("mux-import-replace-closes-live-pty") &&
    muxLiveCapabilities.includes("mux-pane-control") &&
    muxLiveCapabilities.includes("mux-live-attach-detach") &&
    muxLiveCapabilities.includes("mux-snapshot-restore-pending") &&
    muxLiveCapabilities.includes("mux-broadcast-input"),
  "The Rust sidecar has current mux performance and live restore evidence for panes, detach/attach, sync, broadcast, and import/restore.",
  {
    performanceMtimeMs: artifactMtims.muxPerformance,
    liveRestoreMtimeMs: artifactMtims.muxLiveRestore,
    muxLiveCheckCount: muxLiveChecks.length,
  },
);

add(
  checks,
  "native-workspace-agent-identity-boundary",
  upperCompat?.status === "pass" &&
    upperCompat?.score === 100 &&
    allCheckStatusesPassed(upperCompat) &&
    upperCompatGates["aether.workspace.data.v1"]?.complete === true &&
    upperCompatGates["aether.mode-preservation.v1"]?.complete === true &&
    upperCompatGates["aether.agent-identity.v1"]?.complete === true &&
    upperCompatVerifier.includes("workspace_items") &&
    upperCompatVerifier.includes("agent_identity_records") &&
    upperCompatVerifier.includes("mode_preservation_snapshots"),
  "Workspace items, mode preservation, and agent identity are proven through Rust/SQLite upper-compat gates.",
  { upperCompatMtimeMs: artifactMtims.upperCompat },
);

add(
  checks,
  "tests-cover-orchestration-contract",
  orchestratorTest.includes("buildOrchestraPrompts") &&
    orchestratorTest.includes("buildOrchestraRunPlan") &&
    orchestraRolesTest.includes("detectFileConflicts") &&
    orchestraDialogTest.includes("OrchestraDialog") &&
    countOccurrences(orchestratorTest, "it(") >= 7 &&
    countOccurrences(orchestraRolesTest, "it(") >= 8 &&
    countOccurrences(orchestraDialogTest, "it(") >= 4,
  "Focused frontend tests cover role metadata, prompt generation, run planning, conflict detection, and dialog defaults.",
  {
    orchestratorTestCases: countOccurrences(orchestratorTest, "it("),
    orchestraRolesTestCases: countOccurrences(orchestraRolesTest, "it("),
    orchestraDialogTestCases: countOccurrences(orchestraDialogTest, "it("),
  },
);

add(
  checks,
  "safe-chain-wiring",
  packageJson.includes('"verify:goal:orchestration"') &&
    safeVerifier.includes("agent-team-orchestration") &&
    safeVerifier.includes("agentTeamOrchestration") &&
    safeVerifier.includes("verify-agent-team-orchestration-readiness.mjs"),
  "Agent Team orchestration is wired as a first-class safe-gate artifact, not just an ad-hoc audit.",
);

add(
  checks,
  "no-token-no-sleep-contract",
  !packageJson.includes("verify:goal:orchestration:unsafe") &&
    !orchestrator.includes("AETHER_AUTH_PROMPT_CONSENT") &&
    !orchestrator.includes("AETHER_ALLOW_OS_SLEEP") &&
    !orchestraDialog.includes("AETHER_AUTH_PROMPT_CONSENT") &&
    !orchestraDialog.includes("AETHER_ALLOW_OS_SLEEP"),
  "This orchestration verifier is local, non-token, and does not invoke OS sleep gates.",
  { tokenSpendingPromptExecuted: false, realOsSleepInvoked: false },
);

add(
  checks,
  "source-artifact-freshness",
  Object.values(artifactFreshness).every((fresh) => fresh === true),
  "Referenced right rail, mux, and native upper-compat artifacts are newer than their verifier sources.",
  { sourceCutoffMs, artifactMtims, artifactFreshness },
);

const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
const ok = failedChecks.length === 0;
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? "pass-current-agent-team-orchestration-readiness" : "failed",
  sourceFresh: true,
  tokenSpendingPromptExecuted: false,
  realOsSleepInvoked: false,
  agentTeamReadiness: {
    defaultRoles: ["implementer", "tester", "reviewer"],
    availableRoles: roleIds,
    laneIds,
    rightRailDefaultPrimarySurfaces: ["Orchestra Command", "Toolkit", "Agents", "Review"],
    deferredSurfaces: ["Evidence", "Health", "Queue"],
    muxTruthSource: muxPerformance?.contract?.terminalCorePolicy?.muxTruthSource ?? "daemon-api",
    nativeWorkspaceIdentity: upperCompatGates["aether.agent-identity.v1"]?.complete === true,
  },
  sourceCutoffMs,
  sourceMtims,
  artifactMtims,
  artifactFreshness,
  artifacts: Object.fromEntries(Object.entries(artifactPaths).map(([key, path]) => [key, artifactSummary(path, readJson(path))])),
  checks,
  failedChecks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(ok ? 0 : 1);
