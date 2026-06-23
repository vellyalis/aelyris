// Live runtime proof of the symbol-ownership feature (master 624e901), driven
// through the REAL running app over CDP -> Tauri IPC. Three parts:
//   1. The runtime claim surface (symbol_claim/claims/conflicts/release) — the
//      live SymbolOwnership map + conflict surfacing. NO agent spawn.
//   2. The live-map dispatch gate BLOCK path — claim a range via IPC, then declare
//      an overlapping-symbol task and orchestrator_step: it must NOT dispatch
//      (symbol_blocking fired). Proves the §6.5 live consult end-to-end, NO spawn.
//   3. The declared-symbol gate via orchestrator_step — same file DISJOINT symbols
//      co-dispatch, OVERLAPPING serialize. Spawns real agents (we only assert which
//      were dispatched, then the app is shut down by the caller).
//
// Prereq: pnpm tauri:dev (CDP 9222), claude on PATH + authenticated (part 3 only).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const CDP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

const repo = mkdtempSync(join(tmpdir(), "aether-sym-"));
git(repo, "init", "-b", "main");
git(repo, "config", "user.email", "sym@aether.test");
git(repo, "config", "user.name", "Sym");
writeFileSync(join(repo, "README.md"), "# sym demo\n");
git(repo, "add", ".");
git(repo, "commit", "-m", "init");

const uniq = String(process.pid);
const browser = await chromium.connectOverCDP(CDP);
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failures += 1;
};

try {
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no 1420 page (is pnpm tauri:dev running?)");
  const inv = (n, a = {}) =>
    page.evaluate(([nn, aa]) => window.__TAURI_INTERNALS__.invoke(nn, aa), [n, a]);

  const sym = (path, symbol, startLine, endLine, mode, confidence) => ({
    path,
    symbol,
    range: { startLine, endLine },
    mode,
    confidence,
  });
  const claim = (claimId, agentId, path, startLine, endLine, mode, confidence) =>
    inv("symbol_claim", {
      claimId,
      agentId,
      taskId: null,
      path,
      symbol: `fn_${startLine}`,
      startLine,
      endLine,
      mode,
      confidence,
      leaseSecs: 600,
    });

  // Clean any prior symbol claims from earlier runs so the surface starts empty.
  for (const c of await inv("symbol_claims", {})) await inv("symbol_release", { claimId: c.claim_id ?? c.claimId });

  // ───────────────────────────── Part 1: claim surface ─────────────────────
  console.log("\n== Part 1: runtime claim surface (no spawn) ==");
  const a = await claim(`a-${uniq}`, "agent-a", "src/x.rs", 40, 60, "write", "lsp");
  check(a.outcome === "granted", `first write claim 40-60 granted (got ${a.outcome})`);
  let claims = await inv("symbol_claims", {});
  check(claims.length === 1, `claims shows 1 live claim (got ${claims.length})`);

  // Overlapping EXACT write by another agent -> blocked, NOT recorded.
  const b = await claim(`b-${uniq}`, "agent-b", "src/x.rs", 50, 55, "write", "lsp");
  check(b.outcome === "blocked", `overlapping exact write 50-55 blocked (got ${b.outcome})`);
  check(Array.isArray(b.conflicts) && b.conflicts.length >= 1, "blocked outcome carries conflicts");
  claims = await inv("symbol_claims", {});
  check(claims.length === 1, `blocked claim was NOT recorded (still 1, got ${claims.length})`);

  // Disjoint write -> granted, no conflict.
  const c = await claim(`c-${uniq}`, "agent-c", "src/x.rs", 1, 20, "write", "lsp");
  check(c.outcome === "granted", `disjoint write 1-20 granted (got ${c.outcome})`);
  let conflicts = await inv("symbol_conflicts", {});
  check(conflicts.length === 0, `disjoint claims -> 0 conflicts (got ${conflicts.length})`);

  // Inferred (diff-hunk) overlap -> warned (recorded) + a warn-severity conflict.
  const d = await claim(`d-${uniq}`, "agent-d", "src/x.rs", 45, 55, "write", "diff-hunk");
  check(d.outcome === "warned", `inferred diff-hunk overlap warned, not blocked (got ${d.outcome})`);
  conflicts = await inv("symbol_conflicts", {});
  check(
    conflicts.some((x) => x.severity === "warn"),
    `a warn-severity conflict is surfaced (got ${JSON.stringify(conflicts.map((x) => x.severity))})`,
  );

  // Release everything; surface empties.
  for (const cl of await inv("symbol_claims", {})) await inv("symbol_release", { claimId: cl.claim_id ?? cl.claimId });
  check((await inv("symbol_claims", {})).length === 0, "after release: 0 live claims");

  // ───────────────── Part 2: live-map gate BLOCK path (no spawn) ────────────
  console.log("\n== Part 2: live-map dispatch gate blocks an overlapping task (no spawn) ==");
  // Fail any non-terminal tasks so dispatch is deterministic.
  for (const t of await inv("task_list", {}))
    if (!["done", "failed"].includes(t.status)) {
      try { await inv("task_transition", { id: t.id, to: "failed" }); } catch {}
    }
  // A running agent's LIVE claim on src/x.rs 40-60.
  await claim(`live-${uniq}`, "agent-live", "src/x.rs", 40, 60, "write", "lsp");
  const blkBranch = `feat/sym-blk-${uniq}`;
  await inv("create_worktree", { repoPath: repo, branchName: blkBranch });
  const blkId = `task-symblk-${uniq}`;
  await inv("task_create", {
    task: {
      id: blkId,
      title: "overlapping-symbol task (should be blocked by the live claim)",
      description: "",
      status: "pending",
      owner: `worker-blk-${uniq}`,
      model: "sonnet",
      priority: "medium",
      dependencies: [],
      outputs: ["src/x.rs"],
      symbols: [sym("src/x.rs", "fn_50", 50, 55, "write", "lsp")],
      source_branch: blkBranch,
      target_branch: "main",
    },
  });
  const rBlk = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  check(
    !rBlk.dispatched.includes(blkId),
    `task with a symbol overlapping a LIVE claim was NOT dispatched (dispatched=${JSON.stringify(rBlk.dispatched)})`,
  );
  // Release the live claim; the same task should now dispatch (proves it was the
  // live claim, not something else, that blocked it). This DOES spawn 1 agent.
  for (const cl of await inv("symbol_claims", {})) await inv("symbol_release", { claimId: cl.claim_id ?? cl.claimId });
  const rUnblk = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  check(
    rUnblk.dispatched.includes(blkId),
    `after releasing the live claim the SAME task dispatches (dispatched=${JSON.stringify(rUnblk.dispatched)})`,
  );

  // ──────────── Part 3: declared-symbol co-dispatch vs serialize (spawns) ───
  console.log("\n== Part 3: declared-symbol gate via orchestrator_step (spawns agents) ==");
  for (const t of await inv("task_list", {}))
    if (!["done", "failed"].includes(t.status)) {
      try { await inv("task_transition", { id: t.id, to: "failed" }); } catch {}
    }
  const mkTask = async (id, file, range) => {
    const branch = `feat/${id}`;
    await inv("create_worktree", { repoPath: repo, branchName: branch });
    await inv("task_create", {
      task: {
        id,
        title: id,
        description: "",
        status: "pending",
        owner: id,
        model: "sonnet",
        priority: "medium",
        dependencies: [],
        outputs: [file],
        symbols: [sym(file, `fn_${range[0]}`, range[0], range[1], "write", "lsp")],
        source_branch: branch,
        target_branch: "main",
      },
    });
  };
  // Two tasks, SAME file, DISJOINT symbols -> both co-dispatch.
  await mkTask(`sym-dj-a-${uniq}`, "src/dj.rs", [1, 20]);
  await mkTask(`sym-dj-b-${uniq}`, "src/dj.rs", [40, 60]);
  const rDj = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  check(
    rDj.dispatched.includes(`sym-dj-a-${uniq}`) && rDj.dispatched.includes(`sym-dj-b-${uniq}`),
    `same file + DISJOINT symbols co-dispatch in parallel (dispatched=${JSON.stringify(rDj.dispatched)})`,
  );

  // Fail those, then two tasks SAME file OVERLAPPING symbols -> only one dispatches.
  for (const t of await inv("task_list", {}))
    if (!["done", "failed"].includes(t.status)) {
      try { await inv("task_transition", { id: t.id, to: "failed" }); } catch {}
    }
  await mkTask(`sym-ov-a-${uniq}`, "src/ov.rs", [1, 30]);
  await mkTask(`sym-ov-b-${uniq}`, "src/ov.rs", [20, 50]);
  const rOv = await inv("orchestrator_step", {
    usage: { active_agents: 0, tokens_used: 0, cost_usd: 0, runtime_secs: 0 },
    repoPath: repo,
    reviewerId: "reviewer",
    gates: {},
  });
  const ovDispatched = [`sym-ov-a-${uniq}`, `sym-ov-b-${uniq}`].filter((id) => rOv.dispatched.includes(id));
  check(
    ovDispatched.length === 1,
    `same file + OVERLAPPING symbols serialize (exactly 1 dispatched, got ${JSON.stringify(ovDispatched)})`,
  );

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — symbol-ownership live verification`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  await browser.close();
  process.exit(1);
}
