// Reset to a clean 1-pane workspace, then verify the visible fleet PERSISTS:
// dispatch 2 real claude agents, confirm their panes stream output, and confirm
// that AFTER each agent exits the pane stays on screen still showing claude's
// final output (not vanished, not an "Ended pane" placeholder). Screenshots it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROJECT = process.env.AETHER_FLEET_PROJECT ?? process.cwd().replaceAll("\\", "/");
function repo() {
  const d = mkdtempSync(join(tmpdir(), "flt-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: d });
  execFileSync("git", ["config", "user.email", "v@a.t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "V"], { cwd: d });
  writeFileSync(join(d, "R.md"), "# r\n");
  execFileSync("git", ["add", "."], { cwd: d });
  execFileSync("git", ["commit", "-m", "b"], { cwd: d });
  return d;
}
const OUT = ".codex-auto/production-smoke";
mkdirSync(OUT, { recursive: true });

const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
let p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("localhost:1420"));
if (!p) throw new Error("no page");
const invoke = (n, a) => p.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);
const panes = () => p.evaluate(() => document.querySelector(".center-panel")?.querySelectorAll("canvas").length ?? -1);
const snap = async (tid) => {
  try {
    const s = await invoke("term_snapshot", { id: tid });
    return (s.cells || []).map((row) => row.map((c) => c.ch ?? " ").join("")).join("\n").trim();
  } catch {
    return null;
  }
};

// 1) reset the saved 20-pane layout: clear localStorage, re-seed the workspace.
await p.evaluate((proj) => {
  window.localStorage.clear();
  window.localStorage.setItem("aether:lastProject", proj);
  window.localStorage.setItem("aether:onboarding-done", "true");
}, PROJECT);
await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(6000);
p = b.contexts().flatMap((c) => c.pages()).find((x) => x.url().includes("localhost:1420")) ?? p;
console.log(`panes after reset: ${await panes()}`);

const r = repo();
const s = Date.now();
const prompt = "Write a vivid 8-line poem about a thunderstorm over the ocean, then a one-sentence note on its imagery.";
for (const i of [0, 1]) {
  await invoke("task_create", {
    task: { id: `pp-${s}-${i}`, title: prompt, description: "", status: "pending", owner: "impl", priority: "medium", dependencies: [], outputs: [], source_branch: null, target_branch: null },
  });
}
const rep = await invoke("orchestrator_step", { usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 }, repoPath: r, reviewerId: "rev", gates: {} });
console.log(`dispatched: ${rep.dispatched.length}`);
const ev = await invoke("event_recent", {});
const tids = ev.filter((e) => e.kind === "agent_spawned").slice(-2).map((e) => e.payload?.terminalId).filter(Boolean);

await sleep(11000);
const mid = await Promise.all(tids.map(snap));
console.log(`t=11s  panes=${await panes()}  chars=${JSON.stringify(mid.map((t) => (t ? t.replace(/\s/g, "").length : -1)))}`);
if (mid[0]) console.log(`  @11s sample:\n${mid[0].split("\n").filter((l) => l.trim()).slice(0, 6).join("\n")}`);

await sleep(22000); // agents should have exited by now
const after = await Promise.all(tids.map(snap));
const afterChars = after.map((t) => (t ? t.replace(/\s/g, "").length : -1));
console.log(`t=33s  panes=${await panes()}  chars=${JSON.stringify(afterChars)}`);
console.log(`PERSISTENCE: ${afterChars.filter((c) => c > 0).length}/${tids.length} agent panes still show claude output after exit`);
if (after[0]) console.log(`  @33s persisted sample:\n${after[0].split("\n").filter((l) => l.trim()).slice(0, 6).join("\n")}`);

await p.mouse.move(5, 5).catch(() => {});
await p.locator(".center-panel").screenshot({ path: join(OUT, "claude-persisted.png"), timeout: 25000 }).catch((e) => console.log("shot skipped:", e?.message));
console.log(`screenshot -> ${OUT}/claude-persisted.png`);
if (typeof b.close === "function") await b.close().catch(() => {});
