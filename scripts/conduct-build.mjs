// CONDUCTOR demo: an external Claude (this script standing in for the orchestrator
// LLM) drives the Aether runtime end-to-end over the IPC face — decomposes a
// one-line goal into worktree-backed tasks, dispatches a worker fleet (real
// claude CLIs, visible in split panes, auto-accepting edits), then reviews and
// merges their work to main. Proves: human -> conductor -> Agent Runtime -> AI fleet.
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

const repo = mkdtempSync(join(tmpdir(), "aether-build-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "conductor@aether.test");
git(repo, "config", "user.name", "Conductor");
writeFileSync(join(repo, "README.md"), "# demo project\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

// The conductor's decomposition of "build a tiny greeting project".
const TASKS = [
  { id: "task-greeting", owner: "worker-a", branch: "feat/greeting", file: "GREETING.md",
    title: "Create a file named GREETING.md containing a single friendly one-line greeting. Only create that file." },
  { id: "task-farewell", owner: "worker-b", branch: "feat/farewell", file: "FAREWELL.md",
    title: "Create a file named FAREWELL.md containing a single one-line farewell. Only create that file." },
];

const browser = await chromium.connectOverCDP(CDP);
try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const inv = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  console.log("CONDUCTOR: shared decisions (ADR) ->");
  await inv("context_set", { key: "language", value: "markdown" });
  await inv("context_set", { key: "style", value: "concise and friendly" });

  console.log("CONDUCTOR: create worktrees + decompose into tasks ->");
  const wt = {};
  for (const t of TASKS) {
    const info = await inv("create_worktree", { repoPath: repo, branchName: t.branch });
    wt[t.id] = info.path;
    await inv("task_create", { task: { id: t.id, title: t.title, description: "", status: "pending",
      owner: t.owner, model: "sonnet", priority: "medium", dependencies: [], outputs: [t.file],
      source_branch: t.branch, target_branch: "main" } });
  }
  console.log("  worktrees:", JSON.stringify(wt));

  const step = (gates = {}) => inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo, reviewerId: "reviewer", gates,
  });
  const statuses = async () => Object.fromEntries(
    (await inv("task_list", {})).filter((t) => TASKS.some((x) => x.id === t.id)).map((t) => [t.id, t.status]));
  const fileReady = (t) => existsSync(join(wt[t.id], t.file));

  console.log("CONDUCTOR: dispatch fleet (workers build in visible split panes) ->");
  let rep = await step();
  console.log("  dispatched:", JSON.stringify(rep.dispatched), "state:", rep.state);

  console.log("CONDUCTOR: waiting for workers to write their files ->");
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && !TASKS.every(fileReady)) {
    await sleep(4000);
    console.log("  ", TASKS.map((t) => `${t.file}=${fileReady(t) ? "built" : "..."}`).join("  "),
      " tasks:", JSON.stringify(await statuses()));
  }
  console.log("  workers built:", JSON.stringify(TASKS.filter(fileReady).map((t) => t.id)));

  // NOTE: the conductor NO LONGER commits the workers' worktrees. The autonomy
  // loop now commits each green-reviewed task's worktree itself (inside
  // LoopPortsAdapter::merge, via git::commit_worktree) before merging — proving
  // dispatch -> build -> COMMIT (by the loop) -> review -> merge end-to-end with
  // no external git mutation of the worktrees.

  console.log("CONDUCTOR: review (all-green); the loop commits each worktree then the Reviewer merges to main ->");
  const green = { tests_pass: true, lint_pass: true, types_pass: true, design_consistent: true, context_aligned: true };
  for (let i = 0; i < 8; i++) {
    const gates = Object.fromEntries(TASKS.filter(fileReady).map((t) => [t.id, green]));
    rep = await step(gates);
    console.log(`  step ${i}: merged=${JSON.stringify(rep.merged)} rejected=${JSON.stringify(rep.rejected)} state=${rep.state} tasks=${JSON.stringify(await statuses())}`);
    if (rep.state === "complete") break;
    await sleep(1500);
  }

  console.log("\n=== main branch artifacts (built by the AI fleet) ===");
  const present = {};
  for (const t of TASKS) {
    try { present[t.file] = git(repo, "show", `main:${t.file}`); }
    catch { present[t.file] = "(absent)"; }
    console.log(`--- ${t.file} ---\n${present[t.file]}`);
  }
  const ok = TASKS.every((t) => present[t.file] !== "(absent)");
  console.log(ok
    ? "\nEND-TO-END: conductor -> fleet -> review -> merge. AI workers built files merged to main."
    : "\nINCOMPLETE — see logs above (likely worker file-write or merge).");
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
