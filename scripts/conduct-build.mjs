// CONDUCTOR demo: an external Claude (this script standing in for the orchestrator
// LLM) drives the Aether runtime end-to-end over the IPC face — decomposes a
// one-line goal into worktree-backed tasks, dispatches a worker fleet (real
// claude CLIs, visible in split panes, auto-accepting edits), then reviews and
// merges their work to main. Proves: human -> conductor -> Agent Runtime -> AI fleet.
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
// A tiny Rust crate so the REAL reviewer's gates (cargo test/clippy/check) can
// actually run and pass — a markdown file has no quality gate to prove, and the
// reviewer never assumes-green for an ungated change.
writeFileSync(join(repo, "Cargo.toml"),
  '[package]\nname = "greeting-demo"\nversion = "0.1.0"\nedition = "2021"\n');
mkdirSync(join(repo, "src"), { recursive: true });
writeFileSync(join(repo, "src", "lib.rs"), "//! greeting demo crate\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init crate");

// The conductor's decomposition: each worker adds a passing, clippy-clean
// integration test under tests/ (disjoint file lanes) that `cargo test` compiles
// and runs in the worktree — real evidence for the reviewer to gate on.
const TASKS = [
  { id: "task-greeting", owner: "worker-a", branch: "feat/greeting", file: "tests/greeting.rs",
    title: "Create a Rust integration test at tests/greeting.rs. Add a helper `fn greet() -> String` that returns a friendly one-line greeting containing the word \"friend\", and a #[test] function that calls it and asserts the result contains \"friend\". Build the string at runtime via the helper — do NOT call is_empty() on a string literal (clippy rejects that under -D warnings). It must compile, pass `cargo test`, and be clippy-clean. Only create that file." },
  { id: "task-farewell", owner: "worker-b", branch: "feat/farewell", file: "tests/farewell.rs",
    title: "Create a Rust integration test at tests/farewell.rs. Add a helper `fn farewell() -> String` that returns a one-line farewell containing the word \"bye\", and a #[test] function that calls it and asserts the result contains \"bye\". Build the string at runtime via the helper — do NOT call is_empty() on a string literal (clippy rejects that under -D warnings). It must compile, pass `cargo test`, and be clippy-clean. Only create that file." },
];

const browser = await chromium.connectOverCDP(CDP);
try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page");
  const inv = (n, a) => page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  console.log("CONDUCTOR: shared decisions (ADR) ->");
  await inv("context_set", { key: "language", value: "rust" });
  await inv("context_set", { key: "style", value: "concise and tested" });

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

  console.log("CONDUCTOR: commit each worker's output on its branch ->");
  for (const t of TASKS) {
    if (!fileReady(t)) continue;
    try { git(wt[t.id], "add", "-A"); git(wt[t.id], "commit", "-m", `${t.owner}: add ${t.file}`); }
    catch (e) { console.log("  commit skip", t.id, String(e).slice(0, 80)); }
  }

  // REAL review: per branch, run the project's cargo gates in its worktree AND
  // ask the LLM to judge the diff against the shared decisions + task. The gates
  // it returns (not a hand-canned "green") are what the loop merges on. Run once
  // — the verdict for a committed branch is deterministic.
  console.log("CONDUCTOR: REAL review (cargo gates + LLM judge per branch) ->");
  const gates = {};
  for (const t of TASKS.filter(fileReady)) {
    const rv = await inv("review_branch", {
      repoPath: repo, sourceBranch: t.branch, targetBranch: "main",
      taskTitle: t.title, reviewerId: "reviewer", implementerId: t.owner, model: "sonnet",
    });
    gates[t.id] = rv.gates;
    console.log(`  review ${t.id}: ${rv.verdict.verdict} (mergeOk=${rv.mergeOk})`,
      rv.reasons.length ? JSON.stringify(rv.reasons) : "");
  }

  console.log("CONDUCTOR: Reviewer merges every branch the real review cleared ->");
  // Bound runaway re-planning: a re-decomposed subtask can itself fail and escalate,
  // so cap total re-plans per run to keep the LLM-call/API cost finite.
  const MAX_REPLANS = 3;
  let replanCount = 0;
  for (let i = 0; i < 8; i++) {
    rep = await step(gates);
    console.log(`  step ${i}: merged=${JSON.stringify(rep.merged)} rejected=${JSON.stringify(rep.rejected)} state=${rep.state} tasks=${JSON.stringify(await statuses())}`);
    // MID-RUN RE-PLAN (gap #3): a task that exhausts its retry budget raises an
    // `escalate_to_planner` escalation. Rather than wait for a human, the conductor
    // asks the Planner to re-decompose it into subtasks and splice them in — the
    // build resumes itself. (The happy path above never times out, so this is the
    // documented reaction, not a step the demo normally reaches.)
    for (const e of rep.escalations ?? []) {
      if (e.action !== "escalate_to_planner") continue;
      if (replanCount >= MAX_REPLANS) {
        console.log(`  escalation: ${e.task_id} -> RE-PLAN SKIPPED (cap ${MAX_REPLANS} reached)`);
        continue;
      }
      replanCount++;
      console.log(`  escalation: ${e.task_id} exhausted '${e.reason}' -> RE-PLAN (${replanCount}/${MAX_REPLANS})`);
      const rp = await inv("replan_task", { taskId: e.task_id, model: "sonnet" });
      console.log(`  re-planned ${rp.failedTask} -> subtasks ${JSON.stringify(rp.subtaskIds)}, rewired ${JSON.stringify(rp.rewiredDependents)}`);
    }
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
