// Verifies the agent ACTUALLY RUNS in a real split pane: the active terminal
// splits, and the agent pane streams real claude output (not a model-rejection
// error). Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://127.0.0.1:9222";
const SHOT_DIR = "C:/tmp/aether-demo-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-work-"));
  for (const a of [["init", "-b", "main"], ["config", "user.email", "v@a.test"], ["config", "user.name", "V"]])
    execFileSync("git", a, { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# w\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "b"], { cwd: dir });
  return dir;
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const repo = setupRepo();
  const id = `work-${Date.now()}`;
  const failures = [];
  const ok = (c, m) => { if (!c) failures.push(m); console.log(`${c ? "PASS" : "FAIL"}  ${m}`); };

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no 1420 page");
    const inv = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
    const center = () => page.evaluate(() => {
      const c = document.querySelector(".center-panel");
      return c ? c.querySelectorAll("canvas").length : -1;
    });
    const snap = async (term) => {
      const s = await inv("term_snapshot", { id: term }).catch(() => null);
      if (!s || !Array.isArray(s.cells)) return "";
      return s.cells.map((row) => row.map((x) => x.ch ?? " ").join("")).join("\n")
        .split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.length).join("\n");
    };

    const before = await center();
    await inv("task_create", {
      task: { id, title: "Write a concise 150-word explanation of how TCP guarantees reliable delivery",
        description: "", status: "pending", owner: "impl", priority: "medium",
        dependencies: [], outputs: [], source_branch: null, target_branch: null },
    });
    const rep = await inv("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo, reviewerId: "rev", gates: {},
    });
    ok(rep.dispatched.includes(id), `dispatched ${id}`);
    const ev = await inv("event_recent", {});
    const term = (ev || []).find((e) => e.kind === "agent_spawned" && e.payload?.taskId === id)?.payload?.terminalId;
    ok(!!term, "agent_spawned carries a terminalId");

    const after = await center();
    ok(after > before, `terminal split into a real pane (${before} -> ${after})`);

    // Poll the agent pane: it must show REAL output, never the model-rejection error.
    let text = "";
    let sawModelError = false;
    for (let i = 0; i < 12; i++) {
      await sleep(2500);
      text = await snap(term);
      if (/issue with the selected model|may not exist/i.test(text)) sawModelError = true;
      if (text.replace(/\s/g, "").length > 60) break; // real content streaming
    }
    console.log(`\n--- agent pane snapshot ---\n${text.slice(0, 600)}\n---------------------------`);
    ok(!sawModelError, "agent pane does NOT show a model-rejection error");
    ok(text.replace(/\s/g, "").length > 60, "agent pane shows real streamed output (the agent is working)");

    try { await page.screenshot({ path: join(SHOT_DIR, "fleet-working.png"), timeout: 90000 }); console.log("shot ok"); }
    catch (e) { console.log(`(soft) screenshot skipped: ${e?.message ?? e}`); }
  } finally {
    await browser.close();
  }
  if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1); }
  console.log("\nAgent visibly working in a real split pane — verified");
}
main().catch((e) => { console.error(e); process.exit(1); });
