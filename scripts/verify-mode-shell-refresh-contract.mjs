import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
const css = readFileSync(join(root, "src", "styles", "global.css"), "utf8");

const requiredModes = ["terminal", "agents", "workspace", "review", "git", "context", "history", "settings"];
const checks = [
  {
    id: "visible-mode-rail",
    label: "Visible mode rail is rendered in the app shell",
    pass:
      app.includes("const PRODUCT_MODE_RAIL") &&
      app.includes('className="mode-rail"') &&
      app.includes("data-product-mode={mode.id}") &&
      css.includes(".mode-rail") &&
      css.includes(".mode-rail-button"),
  },
  {
    id: "all-eight-modes",
    label: "All 8 Aelyris shell modes exist",
    pass: requiredModes.every((mode) => app.includes(`id: "${mode}"`)),
  },
  {
    id: "mode-shortcuts",
    label: "Alt+1 through Alt+8 mode shortcuts are wired",
    pass:
      ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"].every((shortcut) =>
        app.includes(`shortcut: "${shortcut}"`),
      ) &&
      app.includes('window.addEventListener("keydown", onModeShortcut)') &&
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
    label: "Right rail is presented as an Orchestra contextual inspector",
    pass:
      app.includes('aria-label="Contextual inspector"') &&
      app.includes('aria-label="Inspector mode"') &&
      app.includes(">Orchestra Command</span>") &&
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
      app.includes("data-proof-state={rightRailInspectorProofState}") &&
      app.includes('aria-label="Selected mode target and proof"') &&
      css.includes(".right-panel-inspector-hero") &&
      css.includes(".right-panel-inspector-grid") &&
      css.includes(".right-panel-inspector-open") &&
      css.includes(':root[data-mood="aelyris-sakura"] .right-panel-inspector-hero'),
  },
  {
    id: "sakura-mode-rail",
    label: "Sakura mode rail avoids gray bleed",
    pass:
      css.includes(':root[data-mood="aelyris-sakura"] .mode-rail') &&
      css.includes("rgba(255, 246, 250, 0.88)") &&
      css.includes(':root[data-mood="aelyris-sakura"] .mode-rail-button[data-active="true"]'),
  },
  {
    id: "accessibility-and-resize",
    label: "Mode rail has accessibility and responsive guardrails",
    pass:
      app.includes('aria-label={`${PRODUCT_NAME} mode rail`}') &&
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
  schema: "aelyris.mode-shell-refresh-contract.v1",
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
writeFileSync(join(outDir, "mode-shell-refresh-contract.json"), JSON.stringify(report, null, 2));

if (report.status !== "passed") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Mode shell refresh contract: ${percent}% (${passed}/${total})`);