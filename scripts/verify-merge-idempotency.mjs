// LIVE verification of P0-3 merge idempotency against a running Aether MCP server.
// Proves, end-to-end over /mcp, that:
//   (A) a duplicate aether.request_merge (same task + same source/target commits)
//       returns the ORIGINAL intent id — no second row, no second merge; and
//   (B) approving an intent whose target ALREADY contains the reviewed source
//       commit is idempotent (status "merged", not an error).
//
// Operator-run (it needs a live server + creates a temp git repo it can reach):
//   pnpm tauri:dev   # in another terminal; export QUORUM_API_TOKEN
//   node scripts/verify-merge-idempotency.mjs
//
// The headless regression guard for the same invariants is the STATIC
// scripts/verify-security-mcp-merge-intent-binding.mjs plus the cargo tests.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.QUORUM_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.QUORUM_API_TOKEN;
if (!TOKEN) {
  console.error("QUORUM_API_TOKEN is required (start `pnpm tauri:dev` and export it)");
  process.exit(2);
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

let rpcId = 0;
// POST a JSON-RPC tools/call to /mcp and return the tool's STRUCTURED output.
// The /mcp transport wraps the handler JSON under result.structuredContent (with
// a sibling result.isError) — see src-tauri/src/api/mcp.rs — so we unwrap that,
// not result.result.
async function toolCall(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${name} JSON-RPC error: ${JSON.stringify(body.error)}`);
  return { ok: body.result?.isError === false, data: body.result?.structuredContent };
}

const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

// Build a throwaway repo: main at base; feature one commit ahead.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-merge-idem-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@test");
  git(dir, "config", "user.name", "Test");
  fs.writeFileSync(path.join(dir, "a.txt"), "base");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-m", "base");
  git(dir, "branch", "feature");
  git(dir, "switch", "feature");
  fs.writeFileSync(path.join(dir, "b.txt"), "feature");
  git(dir, "add", "b.txt");
  git(dir, "commit", "-m", "feat");
  git(dir, "switch", "main");
  return dir;
}

async function main() {
  // (A) duplicate request_merge is idempotent.
  const repoA = makeRepo();
  try {
    const reqArgs = {
      taskId: `idem-${rpcId}`,
      repoPath: repoA,
      sourceBranch: "feature",
      targetBranch: "main",
    };
    const first = await toolCall("aether.request_merge", reqArgs);
    const id1 = first.data?.intentId;
    ok(first.ok && typeof id1 === "string" && id1.length > 0, "request_merge returns an intent id");
    const second = await toolCall("aether.request_merge", reqArgs);
    ok(
      second.data?.intentId === id1,
      "a duplicate request_merge returns the SAME intent id (no second row)",
    );
  } finally {
    fs.rmSync(repoA, { recursive: true, force: true });
  }

  // (B) approving an intent whose target ALREADY contains the reviewed source
  // commit reports "merged" (idempotent), not an error — and the SAME intent
  // cannot then be re-approved (no double-merge). Pre-merge feature into main.
  const repoB = makeRepo();
  try {
    git(repoB, "merge", "--ff-only", "feature"); // main now contains feature
    const reqArgs = {
      taskId: `already-${rpcId}`,
      repoPath: repoB,
      sourceBranch: "feature",
      targetBranch: "main",
    };
    const intent = await toolCall("aether.request_merge", reqArgs);
    const id = intent.data?.intentId;
    ok(typeof id === "string", "request_merge on an already-merged pair still queues an intent");
    const approved = await toolCall("aether.review.approve", { intentId: id });
    ok(
      approved.ok && approved.data?.status === "merged",
      "approving an intent whose target already contains the reviewed commit is idempotent (status: merged)",
    );
    // A second approve on the now-merged intent is rejected (no double-merge).
    const reapprove = await toolCall("aether.review.approve", { intentId: id });
    ok(
      reapprove.ok === false,
      "a merged intent cannot be re-approved (the claim is single-winner)",
    );
  } finally {
    fs.rmSync(repoB, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n${failures.length} merge-idempotency assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll P0-3 merge-idempotency live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
