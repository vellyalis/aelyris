// Prove the AgentInspector's hand-spawned agent now runs the LIVE INTERACTIVE
// claude TUI (drop -p), aligned with the visible fleet — not a headless dump.
// Drives the real `spawn_interactive_agent` IPC (the exact path the AgentInspector
// "new agent" button uses), then screenshots the page and checks the agent
// actually consumed its prompt (file built in its worktree).
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
const fails = [];
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails.push(m); };

const repo = mkdtempSync(join(tmpdir(), "aether-inspector-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "inspector@aether.test");
git(repo, "config", "user.name", "Inspector");
writeFileSync(join(repo, "README.md"), "# inspector demo\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

const BRANCH = "agent/inspector-tui";
const FILE = "INSPECTOR_HELLO.md";
const PROMPT = `Create a file named ${FILE} containing a single friendly one-line greeting, then you are done.`;

const browser = await chromium.connectOverCDP(CDP);
try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const inv = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  const before = await inv("list_interactive_agents", {});
  console.log("interactive sessions before:", before.length);

  // The exact IPC the AgentInspector "new agent" button calls (useInteractiveAgent.ts).
  const res = await inv("spawn_interactive_agent", {
    cwd: repo,
    model: "sonnet",
    initialPrompt: PROMPT,
    branchName: BRANCH,
    cols: 120,
    rows: 32,
  });
  console.log("spawned:", JSON.stringify(res));
  ok(!!res.session_id, "spawn_interactive_agent returned a session");
  const wtPath = res.worktree_path;
  ok(!!wtPath && existsSync(wtPath), `worktree created on disk (${wtPath})`);

  await sleep(6000);
  await page.screenshot({ path: "C:/tmp/inspector-01-6s.png" });
  const mid = await inv("list_interactive_agents", {});
  ok(mid.length === before.length + 1, `session registered (${before.length} -> ${mid.length})`);
  console.log("session status @6s:", mid.find((s) => s.id === res.session_id)?.status);

  await sleep(10000);
  await page.screenshot({ path: "C:/tmp/inspector-02-16s.png" });

  // The agent must actually CONSUME the prompt (proves no -p needed for delivery).
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && !existsSync(join(wtPath, FILE))) {
    await sleep(4000);
    console.log("  building", FILE, "=", existsSync(join(wtPath, FILE)) ? "built" : "...");
  }
  ok(existsSync(join(wtPath, FILE)), `interactive agent consumed its prompt and built ${FILE}`);
  await page.screenshot({ path: "C:/tmp/inspector-03-built.png" });

  // Clean up: stop the session (proves stop path ends a persistent interactive session).
  await inv("stop_interactive_agent", { id: res.session_id });
  await sleep(1500);
  const after = await inv("list_interactive_agents", {});
  console.log("sessions after stop:", after.length, "statuses:", JSON.stringify(after.map((s) => s.status)));

  console.log("\nSHOTS: C:/tmp/inspector-01-6s.png, 02-16s.png, 03-built.png");
  console.log("repo:", repo);
  console.log(fails.length === 0 ? "\nINSPECTOR INTERACTIVE PASS" : `\n${fails.length} FAILED`);
  await browser.close();
  process.exit(fails.length === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
