// Live verification of the MCP-driven autonomy step (Face 2, BR9) against the
// running Aether API: an orchestrator AI drives one loop step over MCP and a
// task awaiting review with a green verdict (reviewer != owner) is MERGED into
// its target branch by a REAL git merge — the same loop the cockpit runs.
//
// Deterministic (no real agent / no auth): the task is pre-placed in review.
// Prereq: `pnpm tauri:dev` running; QUORUM_API_TOKEN set to the API bearer token.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.QUORUM_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.QUORUM_API_TOKEN;
if (!TOKEN) {
  console.error("QUORUM_API_TOKEN is required");
  process.exit(2);
}

async function call(name, args = {}) {
  const res = await fetch(`${BASE}/mcp/tools/call`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  if (!res.ok) throw new Error(`${name} -> HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`${name} -> not ok: ${JSON.stringify(json)}`);
  return json.result;
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aether-loop-"));
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
  return { dir, featureTip, mainBefore: git(dir, "rev-parse", "main") };
}

async function main() {
  const repo = setupRepo();
  const id = `loop-${Date.now()}`;
  const failures = [];
  const ok = (cond, msg) => {
    if (!cond) failures.push(msg);
    console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  };

  try {
    // Orchestrator assigns the task to an implementer, bound feature -> main.
    await call("aether.task.create", {
      id,
      title: "loop merge",
      owner: "impl-agent",
      sourceBranch: "feature",
      targetBranch: "main",
    });
    await call("aether.task.transition", { id, to: "running" });
    await call("aether.task.transition", { id, to: "review" });

    // One autonomy step with a green verdict from a distinct reviewer.
    const stepped = await call("aether.orchestrator.step", {
      repoPath: repo.dir,
      reviewerId: "reviewer-agent",
      activeAgents: 0,
      gates: {
        [id]: {
          tests_pass: true,
          lint_pass: true,
          types_pass: true,
          design_consistent: true,
          context_aligned: true,
        },
      },
    });

    ok(stepped.report.merged.includes(id), `step merged ${id} (got ${JSON.stringify(stepped.report.merged)})`);
    ok(stepped.report.state === "complete", `loop complete (got ${stepped.report.state})`);

    const tasks = await call("aether.task.list");
    ok(tasks.tasks.find((t) => t.id === id)?.status === "done", "task is done in the shared graph");

    const mainAfter = git(repo.dir, "rev-parse", "main");
    ok(mainAfter === repo.featureTip, `real merge moved main to the feature tip (${mainAfter.slice(0, 8)})`);
    ok(mainAfter !== repo.mainBefore, "main advanced from its pre-merge commit");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll autonomy-loop (MCP step + real merge) live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
