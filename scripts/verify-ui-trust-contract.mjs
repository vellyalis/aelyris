import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "ui-trust-contract.json");
const enforce = process.argv.includes("--enforce");

const sourcePaths = {
  lifecycleTypes: "src/features/terminal/pane-tree/types.ts",
  paneContainer: "src/features/terminal/pane-tree/PaneTreeContainer.tsx",
  paneRenderer: "src/features/terminal/pane-tree/PaneTreeRenderer.tsx",
  terminalInfoBar: "src/features/terminal/TerminalInfoBar.tsx",
  terminalInfoBarCss: "src/features/terminal/TerminalInfoBar.module.css",
  sidecar: "src-tauri/src/pty_sidecar.rs",
  imeInputBar: "src/features/terminal/IMEInputBar.tsx",
  appStore: "src/shared/store/appStore.ts",
  settings: "src/features/settings/Settings.tsx",
  rustSettings: "src-tauri/src/config/settings.rs",
  fleet: "src/features/agent-inspector/AgentInspector.tsx",
  runGraph: "src/features/context/RunGraphPanel.tsx",
  reviewQueue: "src/features/review/ReviewQueuePanel.tsx",
  reviewQueueModel: "src/shared/lib/reviewQueue.ts",
  reviewQueueTests: "src/__tests__/ReviewQueuePanel.test.tsx",
  decisionInbox: "src/shared/lib/decisionInbox.ts",
  decisionInboxPanel: "src/features/decision-inbox/DecisionInboxPanel.tsx",
  keyboardShortcuts: "src/shared/hooks/useKeyboardShortcuts.ts",
  shortcutRegistry: "src/shared/lib/shortcutRegistry.ts",
  appMenus: "src/features/app/useAppMenus.ts",
  decisionInboxTests: "src/__tests__/DecisionInboxPanel.test.tsx",
  toast: "src/shared/ui/Toast.tsx",
  app: "src/App.tsx",
  workspaceRegionFocus: "src/shared/lib/workspaceRegionFocus.ts",
  workspaceRegionFocusTests: "src/__tests__/workspaceRegionFocus.test.ts",
};

function source(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function add(checks, id, ok, detail, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), detail, evidence });
}

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const s = Object.fromEntries(Object.entries(sourcePaths).map(([id, path]) => [id, source(path)]));
const checks = [];

add(
  checks,
  "q1-lifecycle-prop",
  s.lifecycleTypes.includes('"reconnecting"') && s.paneRenderer.includes("lifecycle={"),
  "Pane lifecycle includes reconnecting and is passed to the terminal header.",
);
add(
  checks,
  "q1-liveness-render",
  s.terminalInfoBar.includes("data-lifecycle") && s.terminalInfoBarCss.includes("lifeBadge"),
  "Non-live pane lifecycle is rendered as a labeled status badge.",
);
add(
  checks,
  "q2-stream-state-emit",
  s.sidecar.includes("SidecarStreamState") && s.sidecar.includes("on_stream_state"),
  "The sidecar exposes reconnecting, recovered, and gone stream state emission.",
);
add(
  checks,
  "q2-stream-state-consumer",
  s.paneContainer.includes("pty-stream-state-") && s.paneContainer.includes('"reconnecting"'),
  "The pane container consumes sidecar stream state events.",
);
add(
  checks,
  "q3-paste-guard-routed",
  s.imeInputBar.includes("guardedPasteSubmit") && s.imeInputBar.includes("showConfirm"),
  "Both terminal paste paths route through the shared confirmation guard.",
);
add(
  checks,
  "q3-paste-guard-setting",
  s.appStore.includes("pasteGuard") && s.settings.includes("paste_guard") && s.rustSettings.includes("paste_guard"),
  "Paste guard has one persisted frontend setting and a Rust configuration field.",
);
add(
  checks,
  "q4-ownership-render",
  /owner/i.test(s.fleet) && /owner/i.test(s.reviewQueue),
  "Fleet and review surfaces render ownership.",
);
add(
  checks,
  "q4-blocked-reason-render",
  /blockedReason|blocked reason/i.test(s.fleet) && /blockedReason|blocked reason/i.test(s.runGraph),
  "Blocked agents expose their reason on operational surfaces.",
);
add(
  checks,
  "q5-approval-keybinding",
  s.keyboardShortcuts.includes("matchesShortcut(e, SHORTCUTS.openDecisionInbox)") &&
    s.shortcutRegistry.includes('id: "openDecisionInbox"') &&
    s.shortcutRegistry.includes('display: "Ctrl+Shift+D"') &&
    s.appMenus.includes('id: "open-decision-inbox"') &&
    s.appMenus.includes('shortcut: shortcutFor("openDecisionInbox")') &&
    s.decisionInboxPanel.includes('runDecision("approve")') &&
    s.decisionInboxPanel.includes('runDecision("deny")') &&
    s.decisionInboxPanel.includes("event.repeat") &&
    s.decisionInboxPanel.includes("ArrowDown") &&
    s.decisionInboxPanel.includes("aria-keyshortcuts") &&
    s.decisionInboxTests.includes("same latched handler") &&
    s.decisionInboxTests.includes("ignores repeat keys"),
  "The global shortcut and palette focus the inbox; item keys reuse the latched decision handler and reject repeats.",
);
add(
  checks,
  "q6-inferred-marker",
  s.reviewQueueModel.includes('ReviewInferenceSource = "log-regex" | "filename-match"') &&
    s.reviewQueueModel.includes("inference: Partial<Record<ReviewInferredState, ReviewInferenceSource>>") &&
    s.reviewQueue.includes('data-inference="true"') &&
    s.reviewQueue.includes('data-verification="evidence-backed"') &&
    s.reviewQueue.includes('"unverified"') &&
    s.reviewQueueTests.includes("blocked verdicts open command evidence") &&
    s.reviewQueueTests.includes('getAllByText("unverified")'),
  "Review states name their inference source; critical and blocked verdicts require actionable evidence or render unverified.",
);
add(
  checks,
  "q7-toast-severity-type",
  /severity|tone/.test(s.toast) && /error|warning|warn/.test(s.toast),
  "Toast severity is represented by a typed visual contract.",
);
add(
  checks,
  "q8-keyboard-complete-shell",
  s.keyboardShortcuts.includes("matchesShortcut(e, SHORTCUTS.cycleWorkspaceRegion)") &&
    s.keyboardShortcuts.includes("matchesShortcut(e, SHORTCUTS.toggleRightRail)") &&
    s.shortcutRegistry.includes('id: "cycleWorkspaceRegion"') &&
    s.shortcutRegistry.includes('id: "toggleRightRail"') &&
    s.shortcutRegistry.includes('display: "Ctrl+B %"') &&
    s.shortcutRegistry.includes("display: 'Ctrl+B \"") &&
    s.workspaceRegionFocus.includes('"sidebar", "center", "right-rail", "status-bar"') &&
    s.workspaceRegionFocusTests.includes("skips hidden regions") &&
    s.appMenus.includes('id: "toggle-right-rail"') &&
    s.appMenus.includes('id: "split-pane-right"') &&
    s.appMenus.includes('id: "split-pane-down"') &&
    s.app.includes("TERMINAL_PREFIX_COMMAND_EVENT"),
  "F6 cycles visible shell regions, the right rail has a conflict-checked toggle, and palette splits reuse the terminal prefix owner.",
);
add(
  checks,
  "q8-owned-navigation-state",
  s.appStore.includes("WORKSPACE_NAVIGATION_KEY") &&
    s.appStore.includes("hydrateWorkspaceNavigation") &&
    s.appStore.includes("persistWorkspaceNavigation") &&
    !s.app.includes('useState<ProductModeId>("terminal")') &&
    !s.app.includes('useState<RightRailMode>("command")') &&
    s.app.includes("!route.openHistory && !route.openSettings"),
  "Workspace navigation is persisted by the Zustand owner while launcher routes do not rewrite product mode.",
);

const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
const implementationComplete = failedChecks.length === 0;
const generatedAt = new Date().toISOString();
const sourceFiles = Object.values(sourcePaths).map((path) => {
  const full = join(ROOT, path);
  return { path, exists: existsSync(full), mtimeMs: existsSync(full) ? statSync(full).mtimeMs : 0 };
});
const report = {
  artifact: OUT,
  version: 1,
  generatedAt,
  localDate: localDate(),
  timeZone: "Asia/Tokyo",
  ok: enforce ? implementationComplete : true,
  status: enforce ? (implementationComplete ? "passed" : "failed") : "baseline-recorded",
  sourceFiles,
  checks,
  failedChecks,
  nextRequiredAction: implementationComplete
    ? "Run rendered and operator trust checks before claiming A3 complete."
    : `Implement the first failed phase contract without weakening checks: ${failedChecks[0]}.`,
  provenance: createEvidenceProvenance({
    root: ROOT,
    verifierPath: "scripts/verify-ui-trust-contract.mjs",
    inputPaths: ["package.json", "scripts/evidence-provenance.mjs", ...Object.values(sourcePaths)],
    generatedAt,
  }),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (enforce && !report.ok) process.exitCode = 1;
