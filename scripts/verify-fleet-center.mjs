// Verifies the CENTER fleet takeover: dispatching several agents fills the main
// .center-panel with a tiled grid of live agent terminals (1 pane = 1 agent).
// Prereq: pnpm tauri:dev (CDP 9222) + claude on PATH + a project open.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://127.0.0.1:9222";
const SHOT_DIR = "C:/tmp/aether-demo-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-center-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "v@a.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "V"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# center\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const repo = setupRepo();
  const stamp = Date.now();
  const taskIds = [0, 1, 2].map((i) => `center-${stamp}-${i}`);
  const failures = [];
  const ok = (c, m) => { if (!c) failures.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };
  const soft = (c, m) => console.log(`${c ? "PASS" : "WARN"}  (soft) ${m}`);

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no 1420 page");
    const invoke = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

    soft(await page.evaluate(() => !!document.querySelector(".center-panel")), "center-panel present (project open)");

    for (const id of taskIds) {
      await invoke("task_create", {
        task: { id, title: `Reply with: ${id.slice(-1)}`, description: "", status: "pending",
          owner: "impl", priority: "medium", dependencies: [], outputs: [], source_branch: null, target_branch: null },
      });
    }
    const report = await invoke("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo, reviewerId: "reviewer", gates: {},
    });
    console.log("dispatched:", JSON.stringify(report.dispatched));
    const dispatchedMine = taskIds.filter((id) => report.dispatched.includes(id));
    ok(dispatchedMine.length >= 2, `dispatched >=2 of my tasks into panes (got ${dispatchedMine.length})`);

    // The center panel should fill with the fleet overlay + a live terminal per agent.
    await sleep(3500);
    const centerCanvases = await page.evaluate(() => {
      const center = document.querySelector(".center-panel");
      if (!center) return -1;
      // FleetOverlay sits inside .center-panel; count the agent-terminal canvases.
      return center.querySelectorAll('[role="region"][aria-label="Autonomy fleet"] canvas').length;
    });
    console.log(`center fleet canvases: ${centerCanvases}`);
    ok(centerCanvases >= 2, `center panel filled with >=2 live agent terminals (got ${centerCanvases})`);

    const barText = await page.evaluate(() => {
      const region = document.querySelector('[role="region"][aria-label="Autonomy fleet"]');
      return region ? region.textContent : null;
    });
    console.log(`fleet bar text: ${barText ? barText.slice(0, 60) : "(none)"}`);
    ok(!!barText && /agent/i.test(barText), "fleet takeover bar is shown in the center");

    try {
      await sleep(1200);
      await page.screenshot({ path: join(SHOT_DIR, "fleet-center.png") });
      console.log(`screenshot -> ${join(SHOT_DIR, "fleet-center.png")}`);
    } catch (e) { console.log(`(soft) screenshot skipped: ${e?.message ?? e}`); }
  } finally {
    await browser.close();
  }
  if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1); }
  console.log("\nCenter fleet takeover verified");
}
main().catch((e) => { console.error(e); process.exit(1); });
