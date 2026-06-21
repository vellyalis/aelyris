// Live CDP verification for the Fleet HUD. Drives the HUD synthetically — a
// running task + a published `agent_spawned` event per agent — so it exercises
// the exact data path (task graph status ⨝ spawn event) WITHOUT spawning real
// claude PTYs (which are flaky under heavy WebView2 load). Asserts the floating
// HUD renders one bucketed card per live agent, then screenshots it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const SHOT = ".codex-auto/production-smoke/fleet-hud.png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const ok = (c, m) => {
  if (!c) failures.push(m);
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
};

// taskId, title, target status (drives the card bucket), model.
const AGENTS = [
  { title: "Build auth API", status: "running", model: "sonnet" },
  { title: "Refactor login UI", status: "running", model: "sonnet" },
  { title: "Write e2e tests", status: "running", model: "haiku" },
  { title: "Review pull request", status: "review", model: "opus" },
  { title: "Resolve merge conflict", status: "failed", model: "sonnet" },
];

const browser = await chromium.connectOverCDP(CDP);
try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const invoke = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  // Self-gating (hidden with no agents) is asserted by the unit test; here it is
  // informational since a long-lived dev session may retain prior cards.
  const hiddenBefore = await page.evaluate(() => !document.querySelector('[data-testid="fleet-hud"]'));
  console.log(`${hiddenBefore ? "PASS" : "NOTE"}  HUD hidden before dispatch${hiddenBefore ? "" : " (prior in-session cards retained)"}`);

  const stamp = Date.now();
  const ids = AGENTS.map((_, i) => `hud-${stamp}-${i}`);
  for (let i = 0; i < AGENTS.length; i++) {
    const a = AGENTS[i];
    // create (root → ready), then transition into the active status, then
    // publish the spawn so the HUD records the agent (model + start time).
    await invoke("task_create", {
      task: { id: ids[i], title: a.title, description: "", status: "pending", owner: "impl", model: a.model, priority: "medium", dependencies: [], outputs: [], source_branch: null, target_branch: null },
    });
    await invoke("task_transition", { id: ids[i], to: "running" }).catch(() => {});
    if (a.status !== "running") await invoke("task_transition", { id: ids[i], to: a.status }).catch(() => {});
    await invoke("event_publish", {
      kind: "agent_spawned",
      channel: null,
      payload: { taskId: ids[i], terminalId: `term-${i}`, model: a.model },
    });
  }

  await page.waitForSelector('[data-testid="fleet-hud"]', { timeout: 15000 });
  ok(true, "HUD appears once agents are live");

  await page.waitForFunction((min) => document.querySelectorAll('[data-testid="fleet-hud-card"]').length >= min, AGENTS.length, { timeout: 15000 });
  const cards = await page.locator('[data-testid="fleet-hud-card"]').count();
  ok(cards >= AGENTS.length, `HUD shows one card per live agent (got ${cards}/${AGENTS.length})`);

  const text = (await page.locator('[data-testid="fleet-hud"]').textContent()) ?? "";
  ok(/Fleet/i.test(text), "HUD header reads 'Fleet'");
  ok(/running/i.test(text), "HUD header shows a running count");
  ok(/attn/i.test(text), "HUD header shows an attention count (1 failed agent)");

  // Buckets present + needs-attention (error) sorted ahead of plain running.
  const buckets = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="fleet-hud-card"]')].map((e) => e.getAttribute("data-bucket")),
  );
  ok(buckets[0] === "error" || buckets[0] === "attention", `needs-attention card sorted first (order: ${buckets.join(",")})`);
  ok(buckets.includes("review"), "a review card is present");
  ok(buckets.includes("error"), "the failed agent shows as an error card");

  mkdirSync(join(SHOT, ".."), { recursive: true });
  await sleep(1200);
  await page.screenshot({ path: SHOT, timeout: 90000 });
  console.log(`screenshot -> ${SHOT}`);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} FAILED`);
  process.exit(1);
}
console.log("\nFleet HUD verified");
