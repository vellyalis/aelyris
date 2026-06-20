// Verifies REAL pane-tree splits: dispatching agents splits the active terminal
// tab into genuine panes (more TerminalCanvas in .center-panel), with NO overlay.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://127.0.0.1:9222";
const SHOT_DIR = "C:/tmp/aether-demo-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-split-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "v@a.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "V"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# split\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const repo = setupRepo();
  const stamp = Date.now();
  const ids = [0, 1].map((i) => `split-${stamp}-${i}`);
  const failures = [];
  const ok = (c, m) => { if (!c) failures.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no 1420 page");
    const invoke = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
    const centerCanvases = () =>
      page.evaluate(() => {
        const c = document.querySelector(".center-panel");
        return c ? c.querySelectorAll("canvas").length : -1;
      });

    const before = await centerCanvases();
    console.log(`center-panel canvases before: ${before}`);
    ok(before >= 1, "active terminal tab has at least one pane before dispatch");

    for (const id of ids) {
      await invoke("task_create", {
        task: { id, title: `Reply with: ${id.slice(-1)}`, description: "", status: "pending",
          owner: "impl", priority: "medium", dependencies: [], outputs: [], source_branch: null, target_branch: null },
      });
    }
    const report = await invoke("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo, reviewerId: "reviewer", gates: {},
    });
    const dispatched = ids.filter((id) => report.dispatched.includes(id));
    console.log("dispatched:", JSON.stringify(report.dispatched));
    ok(dispatched.length >= 2, `dispatched >=2 agents (got ${dispatched.length})`);

    // The active terminal tab should have SPLIT into real panes (more canvases).
    await sleep(4000);
    const after = await centerCanvases();
    console.log(`center-panel canvases after: ${after}`);
    ok(after >= before + 2, `active terminal split into real agent panes (${before} -> ${after})`);

    // And there must be NO overlay (the rejected approach).
    const overlay = await page.evaluate(
      () => !!document.querySelector('[role="region"][aria-label="Autonomy fleet"]'),
    );
    ok(!overlay, "no overlay layer (panes are real splits, not a front layer)");

    try {
      await sleep(1200);
      await page.screenshot({ path: join(SHOT_DIR, "fleet-split.png"), timeout: 90000 });
      console.log(`screenshot -> ${join(SHOT_DIR, "fleet-split.png")}`);
    } catch (e) { console.log(`(soft) screenshot skipped: ${e?.message ?? e}`); }
  } finally {
    await browser.close();
  }
  if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1); }
  console.log("\nReal pane-tree split verified");
}
main().catch((e) => { console.error(e); process.exit(1); });
