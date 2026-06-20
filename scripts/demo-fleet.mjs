// Live demo of the visible agent fleet: dispatch N agents → the active terminal
// tab splits into real panes, each running a live claude session. Screenshots
// the whole window so the flashy multi-pane fleet is visible.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://127.0.0.1:9222";
const SHOT = "C:/Users/owner/Aether_Terminal/.codex-auto/production-smoke/fleet-demo.png";
const N = Number.parseInt(process.env.FLEET_N ?? "4", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-fleet-demo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "v@a.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "V"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# fleet demo\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

// Prompts that produce a few seconds of visible streaming so the panes look alive.
const PROMPTS = [
  "Write a short haiku about the ocean, then explain it in two sentences.",
  "List 8 famous algorithms, each with a one-line description.",
  "Explain what a binary search tree is in 4 short bullet points.",
  "Write a haiku about mountains, then one about rivers.",
];

async function main() {
  mkdirSync(join(SHOT, ".."), { recursive: true });
  const repo = setupRepo();
  const stamp = Date.now();
  const tasks = Array.from({ length: N }, (_, i) => ({ id: `fleet-${stamp}-${i}`, prompt: PROMPTS[i % PROMPTS.length] }));

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no 1420 page");
    const invoke = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
    const canvases = () =>
      page.evaluate(() => document.querySelector(".center-panel")?.querySelectorAll("canvas").length ?? -1);

    const before = await canvases();
    console.log(`panes before: ${before}`);

    for (const t of tasks) {
      await invoke("task_create", {
        task: {
          id: t.id,
          title: t.prompt,
          description: "",
          status: "pending",
          owner: "impl",
          priority: "medium",
          dependencies: [],
          outputs: [],
          source_branch: null,
          target_branch: null,
        },
      });
    }

    const report = await invoke("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo,
      reviewerId: "reviewer",
      gates: {},
    });
    console.log("dispatched:", JSON.stringify(report.dispatched));

    // Let the panes split and the agents stream a little.
    await sleep(6000);
    const after = await canvases();
    console.log(`panes after: ${after}`);

    await page.screenshot({ path: SHOT, timeout: 90000 });
    console.log(`screenshot -> ${SHOT}`);
    console.log(`RESULT panes ${before} -> ${after}, dispatched ${report.dispatched.length}`);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error("DEMO ERROR", e?.message ?? e);
  process.exit(1);
});
