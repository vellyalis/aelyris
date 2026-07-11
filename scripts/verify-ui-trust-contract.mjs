import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
  decisionInbox: "src/shared/lib/decisionInbox.ts",
  decisionInboxPanel: "src/features/decision-inbox/DecisionInboxPanel.tsx",
  keyboardShortcuts: "src/shared/hooks/useKeyboardShortcuts.ts",
  appMenus: "src/features/app/useAppMenus.ts",
  decisionInboxTests: "src/__tests__/DecisionInboxPanel.test.tsx",
  toast: "src/shared/ui/Toast.tsx",
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
  s.keyboardShortcuts.includes("openDecisionInbox") &&
    s.keyboardShortcuts.includes('e.key.toLowerCase() === "d"') &&
    s.appMenus.includes('id: "open-decision-inbox"') &&
    s.appMenus.includes('shortcut: "Ctrl+Shift+D"') &&
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
  /inferred|advisory/i.test(s.reviewQueue),
  "Review readiness visibly distinguishes inferred evidence.",
);
add(
  checks,
  "q7-toast-severity-type",
  /severity|tone/.test(s.toast) && /error|warning|warn/.test(s.toast),
  "Toast severity is represented by a typed visual contract.",
);

const failedChecks = checks.filter((check) => !check.ok).map((check) => check.id);
const implementationComplete = failedChecks.length === 0;
const report = {
  artifact: OUT,
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: localDate(),
  timeZone: "Asia/Tokyo",
  ok: enforce ? implementationComplete : true,
  status: enforce ? (implementationComplete ? "passed" : "failed") : "baseline-recorded",
  sourceFiles: Object.values(sourcePaths).map((path) => {
    const full = join(ROOT, path);
    return { path, exists: existsSync(full), mtimeMs: existsSync(full) ? statSync(full).mtimeMs : 0 };
  }),
  checks,
  failedChecks,
  nextRequiredAction: implementationComplete
    ? "Run rendered and operator trust checks before claiming A3 complete."
    : `Implement the first failed phase contract without weakening checks: ${failedChecks[0]}.`,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (enforce && !report.ok) process.exitCode = 1;
