// Live verification of the `orchestrator_step` IPC command (BR9) against the
// running Tauri dev build over CDP. Proves the autonomy loop's review->merge
// pass connects to real I/O end-to-end: a task awaiting review, with a green
// reviewer verdict and reviewer != owner, is merged into its target branch by a
// REAL git merge, and the task reaches `done`.
//
// Prereq: `pnpm tauri:dev` running (CDP on 9222). Run: node scripts/verify-orchestrator-step-live.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP_URL = "http://localhost:9222";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A temp repo with `feature` one commit ahead of `main`, `main` checked out. */
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-orch-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "verify@aether.test");
  git(dir, "config", "user.name", "Aether Verify");
  writeFileSync(join(dir, "a.txt"), "A");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-m", "base");
  git(dir, "branch", "feature");
  git(dir, "checkout", "feature");
  writeFileSync(join(dir, "b.txt"), "B");
  git(dir, "add", "b.txt");
  git(dir, "commit", "-m", "feature work");
  const featureTip = git(dir, "rev-parse", "feature");
  git(dir, "checkout", "main");
  const mainBefore = git(dir, "rev-parse", "main");
  return { dir, featureTip, mainBefore };
}

async function main() {
  const repo = setupRepo();
  const taskId = `orch-step-${Date.now()}`;
  const failures = [];
  const ok = (cond, msg) => {
    if (!cond) failures.push(msg);
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  };

  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes("localhost:1420"));
    if (!page) throw new Error("no localhost:1420 webview page found over CDP");

    const invoke = (name, args) =>
      page.evaluate(([n, a]) => window.__TAURI_INTERNALS__.invoke(n, a), [name, args]);

    // 1. Create a task bound to feature->main, owned by the implementer.
    await invoke("task_create", {
      task: {
        id: taskId,
        title: "verify orchestrator_step",
        description: "live merge proof",
        status: "pending",
        owner: "impl-agent",
        priority: "medium",
        dependencies: [],
        outputs: [],
        source_branch: "feature",
        target_branch: "main",
      },
    });
    // 2. Drive it into review (pending->ready by the gate, then ->running->review).
    await invoke("task_transition", { id: taskId, to: "running" });
    await invoke("task_transition", { id: taskId, to: "review" });

    // 3. Step the loop with a green verdict from a distinct reviewer.
    const report = await invoke("orchestrator_step", {
      usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
      repoPath: repo.dir,
      reviewerId: "reviewer-agent",
      gates: {
        [taskId]: {
          tests_pass: true,
          lint_pass: true,
          types_pass: true,
          design_consistent: true,
          context_aligned: true,
        },
      },
    });

    ok(Array.isArray(report.merged) && report.merged.includes(taskId), `step report merged includes ${taskId} (got ${JSON.stringify(report.merged)})`);
    ok(report.rejected.length === 0, `nothing rejected (got ${JSON.stringify(report.rejected)})`);
    ok(report.state === "complete", `loop state complete after the only task merged (got ${report.state})`);

    // 4. The task is Done in the live graph.
    const tasks = await invoke("task_list", {});
    const task = tasks.find((t) => t.id === taskId);
    ok(task && task.status === "done", `task ${taskId} is done (got ${task && task.status})`);

    // 5. The REAL git merge moved main to the feature tip (fast-forward).
    const mainAfter = git(repo.dir, "rev-parse", "main");
    ok(mainAfter !== repo.mainBefore, "main advanced from its pre-merge commit");
    ok(mainAfter === repo.featureTip, `main now points at the feature tip (${mainAfter.slice(0, 8)} == ${repo.featureTip.slice(0, 8)})`);
  } finally {
    await browser.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll orchestrator_step live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
