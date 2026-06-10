import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
const css = readFileSync(join(root, "src", "styles", "global.css"), "utf8");
const plan = readFileSync(join(root, "docs", "CLAUGE_UI_REFRESH_FINAL_GOAL_2026-05-26.md"), "utf8");
const sourceAudit = readFileSync(join(root, "docs", "CLAUGE_SOURCE_AUDIT_GOOD_PARTS_2026-05-27.md"), "utf8");

const requiredModes = ["terminal", "agents", "workspace", "review", "git", "context", "history", "settings"];
const checks = [
  {
    id: "final-goal-doc",
    label: "Clauge-inspired final goal is documented",
    pass:
      plan.includes("Left Mode Rail -> Center Work Surface -> Right Contextual Inspector") &&
      plan.includes("native-first hybrid") &&
      plan.includes("Phase 1: Visible Shell Recomposition") &&
      plan.includes("Phase 5: Product Edge Upgrade"),
  },
  {
    id: "source-informed-good-parts",
    label: "Clauge source audit is recorded before claiming upper compatibility",
    pass:
      plan.includes("CLAUGE_SOURCE_AUDIT_GOOD_PARTS_2026-05-27.md") &&
      sourceAudit.includes("Commit inspected: `1aceff9f014eb997ba5b21eabf93f23c0da2b71c`") &&
      sourceAudit.includes("Do not copy Clauge") &&
      sourceAudit.includes("src/routes/+page.svelte") &&
      sourceAudit.includes("src/lib/components/sidebar/Sidebar.svelte") &&
      sourceAudit.includes("src/lib/components/topbar/Topbar.svelte") &&
      sourceAudit.includes("src/lib/components/ai/AIPanel.svelte") &&
      sourceAudit.includes("src/lib/modes/agent/components/AgentNav.svelte") &&
      sourceAudit.includes("Mode state preservation") &&
      sourceAudit.includes("Per-mode AI") &&
      sourceAudit.includes("Cross-mode history") &&
      sourceAudit.includes("aether.mcp.server.v1") &&
      sourceAudit.includes("aether.workspace.data.v1") &&
      sourceAudit.includes("aether.mode-preservation.v1") &&
      sourceAudit.includes("aether.history.search.v1") &&
      sourceAudit.includes("aether.agent-identity.v1") &&
      sourceAudit.includes("upper compatibility inside Aether's terminal-first domain"),
  },
  {
    id: "visible-mode-rail",
    label: "Visible mode rail is rendered in the app shell",
    pass:
      app.includes("const PRODUCT_MODE_RAIL") &&
      app.includes('className="mode-rail"') &&
      app.includes('data-product-mode={mode.id}') &&
      css.includes(".mode-rail") &&
      css.includes(".mode-rail-button"),
  },
  {
    id: "all-eight-modes",
    label: "All 8 Clauge-inspired Aether modes exist",
    pass: requiredModes.every((mode) => app.includes(`id: "${mode}"`)),
  },
  {
    id: "mode-shortcuts",
    label: "Alt+1 through Alt+8 mode shortcuts are wired",
    pass:
      ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"].every((shortcut) =>
        app.includes(`shortcut: "${shortcut}"`),
      ) &&
      app.includes("window.addEventListener(\"keydown\", onModeShortcut)") &&
      app.includes("handleProductModeSelect(mode.id)"),
  },
  {
    id: "mode-routing",
    label: "Modes route to concrete inspector targets or dialogs",
    pass:
      app.includes("const PRODUCT_MODE_ROUTES") &&
      app.includes('terminal: { rightRailMode: "observe", focusWidget: "live-panes" }') &&
      app.includes('agents: { rightRailMode: "command", focusWidget: "sessions" }') &&
      app.includes('workspace: { rightRailMode: "command", focusWidget: "workflow", expandSidebar: true }') &&
      app.includes('git: { rightRailMode: "review", focusWidget: "scm" }') &&
      app.includes("showHistorySearch()") &&
      app.includes("setSettingsVisible(true)"),
  },
  {
    id: "inspector-copy",
    label: "Right rail is presented as a contextual inspector",
    pass:
      app.includes('aria-label="Contextual inspector"') &&
      app.includes('aria-label="Inspector mode"') &&
      app.includes(">Inspector</span>") &&
      !app.includes(">Project tools</span>") &&
      !app.includes("Mission Control"),
  },
  {
    id: "inspector-summary",
    label: "Inspector top section explains mode, target, owner, action, and proof",
    pass:
      app.includes("const PRODUCT_MODE_INSPECTOR_SUMMARY") &&
      app.includes("function formatInspectorProof") &&
      app.includes('className="right-panel-inspector-hero"') &&
      app.includes("rightRailInspectorPrimaryAction") &&
      app.includes("rightRailInspectorProof") &&
      app.includes('data-proof-state={rightRailInspectorProofState}') &&
      app.includes('aria-label="Selected mode target and proof"') &&
      css.includes(".right-panel-inspector-hero") &&
      css.includes(".right-panel-inspector-grid") &&
      css.includes(".right-panel-inspector-open") &&
      css.includes(':root[data-mood="aether-sakura"] .right-panel-inspector-hero'),
  },
  {
    id: "sakura-mode-rail",
    label: "Sakura mode rail avoids gray bleed",
    pass:
      css.includes(':root[data-mood="aether-sakura"] .mode-rail') &&
      css.includes("rgba(255, 246, 250, 0.88)") &&
      css.includes(':root[data-mood="aether-sakura"] .mode-rail-button[data-active="true"]'),
  },
  {
    id: "accessibility-and-resize",
    label: "Mode rail has accessibility and responsive guardrails",
    pass:
      app.includes('aria-label="Aether mode rail"') &&
      app.includes("aria-pressed={active}") &&
      css.includes(".mode-rail-button:focus-visible") &&
      css.includes("@media (max-width: 860px)") &&
      css.includes("@media (max-width: 720px)") &&
      css.includes("@media (forced-colors: active)"),
  },
];

const passed = checks.filter((check) => check.pass).length;
const total = checks.length;
const percent = Math.round((passed / total) * 100);
const report = {
  schema: "aether.clauge-ui-refresh-contract.v1",
  status: passed === total ? "passed" : "failed",
  percent,
  passed,
  total,
  checks,
  nextOpenPhases:
    passed === total
      ? ["theme-and-customization-qa", "terminal-trust-preservation", "product-edge-upgrade"]
      : checks.filter((check) => !check.pass).map((check) => check.id),
};

const outDir = join(root, ".codex-auto", "quality");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "clauge-ui-refresh-contract.json"), JSON.stringify(report, null, 2));

if (report.status !== "passed") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Clauge UI refresh contract: ${percent}% (${passed}/${total})`);
