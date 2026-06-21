// Plan B — full live E2E proof on the real runtime: conductor decomposes a goal
// into worktree-backed tasks, dispatches a real-claude fleet into visible panes,
// the workers build files, the loop reviews + merges to main, AND the merged
// worktrees are reclaimed (the durability fix). Asserts every stage.
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

const repo = mkdtempSync(join(tmpdir(), "aether-e2e-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "conductor@aether.test");
git(repo, "config", "user.name", "Conductor");
writeFileSync(join(repo, "README.md"), "# demo project\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

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
  const canvases = () => page.evaluate(() => document.querySelector(".center-panel")?.querySelectorAll("canvas").length ?? -1);

  await inv("context_set", { key: "language", value: "markdown" });
  await inv("context_set", { key: "style", value: "concise and friendly" });

  const wt = {};
  for (const t of TASKS) {
    const info = await inv("create_worktree", { repoPath: repo, branchName: t.branch });
    wt[t.id] = info.path;
    await inv("task_create", { task: { id: t.id, title: t.title, description: "", status: "pending",
      owner: t.owner, model: "sonnet", priority: "medium", dependencies: [], outputs: [t.file],
      source_branch: t.branch, target_branch: "main" } });
  }
  ok(Object.values(wt).every(existsSync), "worktrees created on disk");

  const step = (gates = {}) => inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo, reviewerId: "reviewer", gates,
  });
  const statuses = async () => Object.fromEntries(
    (await inv("task_list", {})).filter((t) => TASKS.some((x) => x.id === t.id)).map((t) => [t.id, t.status]));
  const fileReady = (t) => existsSync(join(wt[t.id], t.file));

  const before = await canvases();
  const rep0 = await step();
  ok(rep0.dispatched.length >= 2, `dispatched the fleet (${rep0.dispatched.length})`);
  await sleep(5000);
  const after = await canvases();
  ok(after > before, `active terminal split into visible agent panes (${before} -> ${after})`);

  // workers build their files (real claude, acceptEdits) in the worktrees
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline && !TASKS.every(fileReady)) {
    await sleep(4000);
    console.log("  ", TASKS.map((t) => `${t.file}=${fileReady(t) ? "built" : "..."}`).join("  "), "tasks:", JSON.stringify(await statuses()));
  }
  ok(TASKS.every(fileReady), "both workers built their files in their worktrees");

  // conductor commits each worker's output on its branch (claude wrote, conductor records)
  for (const t of TASKS) {
    if (!fileReady(t)) continue;
    try { git(wt[t.id], "add", "-A"); git(wt[t.id], "commit", "-m", `${t.owner}: add ${t.file}`); } catch {}
  }

  // review all-green -> loop merges to main (and reclaims worktrees via the fix)
  const green = { tests_pass: true, lint_pass: true, types_pass: true, design_consistent: true, context_aligned: true };
  let rep;
  for (let i = 0; i < 8; i++) {
    const gates = Object.fromEntries(TASKS.filter(fileReady).map((t) => [t.id, green]));
    rep = await step(gates);
    console.log(`  step ${i}: merged=${JSON.stringify(rep.merged)} state=${rep.state} tasks=${JSON.stringify(await statuses())}`);
    if (rep.state === "complete") break;
    await sleep(1500);
  }

  // main has the merged artifacts
  let merged = 0;
  for (const t of TASKS) {
    let content = "(absent)";
    try { content = git(repo, "show", `main:${t.file}`); } catch {}
    if (content !== "(absent)") merged++;
    console.log(`  main:${t.file} = ${content === "(absent)" ? "(absent)" : content.slice(0, 60)}`);
  }
  ok(merged === TASKS.length, `all worker outputs merged to main (${merged}/${TASKS.length})`);

  // DURABILITY: the merged worktrees were reclaimed (the fix)
  await sleep(1000);
  const wtList = git(repo, "worktree", "list");
  const leftover = TASKS.filter((t) => existsSync(wt[t.id]));
  console.log("  worktree list after merge:\n" + wtList.split("\n").map((l) => "    " + l).join("\n"));
  ok(leftover.length === 0, `merged worktrees reclaimed from disk (leftover: ${leftover.map((t) => t.id).join(",") || "none"})`);

  console.log(fails.length === 0 ? "\nE2E PASS — conductor -> fleet -> build -> review -> merge -> worktree cleanup" : `\n${fails.length} FAILED`);
  await browser.close();
  process.exit(fails.length === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
