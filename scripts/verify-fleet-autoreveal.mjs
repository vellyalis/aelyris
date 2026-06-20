// Verifies the fleet AUTO-REVEAL: dispatching an agent force-opens the
// (initially collapsed) Orchestrator widget on its own, so the operator sees
// the pane without touching the panel. Prereq: pnpm tauri:dev (CDP 9222).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://127.0.0.1:9222";
const SHOT_DIR = "C:/tmp/aether-demo-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-reveal-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "v@a.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "V"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# reveal\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const repo = setupRepo();
  const taskId = `reveal-${Date.now()}`;
  const failures = [];
  const ok = (c, m) => { if (!c) failures.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no 1420 page");
    const invoke = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
    const widgetOpen = () =>
      page.evaluate(() => !!document.querySelector('[data-widget="orchestrator"][data-open="true"]'));

    // Establish a closed baseline (the real default): collapse the widget.
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent("aether:right-rail-widget-sync", { detail: { widget: "orchestrator", open: false } })));
    await sleep(400);
    const beforeOpen = await widgetOpen();
    ok(!beforeOpen, "baseline: Orchestrator widget is collapsed before dispatch");

    // Dispatch an agent WITHOUT opening the panel ourselves.
    await invoke("task_create", {
      task: { id: taskId, title: "Reply with: hi", description: "", status: "pending",
        owner: "impl", priority: "medium", dependencies: [], outputs: [], source_branch: null, target_branch: null },
    });
    const report = await invoke("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo, reviewerId: "reviewer", gates: {},
    });
    ok(Array.isArray(report.dispatched) && report.dispatched.includes(taskId), `dispatched ${taskId}`);

    // The AgentSpawned event should have force-opened the widget on its own.
    await sleep(2500);
    const afterOpen = await widgetOpen();
    ok(afterOpen, "Orchestrator widget AUTO-OPENED after the agent spawned (no manual open)");

    const canvases = await page.evaluate(() => {
      const body = document.querySelector('[data-widget="orchestrator"] .right-panel-widget-frame-body');
      return body ? body.querySelectorAll("canvas").length : -1;
    });
    console.log(`fleet canvases after auto-reveal: ${canvases}`);
    ok(canvases >= 1, `FleetGrid mounted a live agent pane after auto-reveal (got ${canvases})`);

    try {
      await sleep(1500);
      await page.screenshot({ path: join(SHOT_DIR, "fleet-autoreveal.png") });
      console.log(`screenshot -> ${join(SHOT_DIR, "fleet-autoreveal.png")}`);
    } catch (e) { console.log(`(soft) screenshot skipped: ${e?.message ?? e}`); }
  } finally {
    await browser.close();
  }
  if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1); }
  console.log("\nFleet auto-reveal verified");
}
main().catch((e) => { console.error(e); process.exit(1); });
