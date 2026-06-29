// Two-phase live replay verifier for shared-brain restart durability.
//
// Usage:
//   QUORUM_API_TOKEN=... node scripts/verify-shared-brain-restart-replay.mjs --phase seed
//   # restart Aether Terminal
//   QUORUM_API_TOKEN=... node scripts/verify-shared-brain-restart-replay.mjs --phase verify --id <printed-id>
//
// It verifies that Context Store, durable event log, file ownership, symbol
// ownership, and aether.shared_brain.snapshot survive the process boundary.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const BASE = process.env.QUORUM_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.QUORUM_API_TOKEN;
const OUT = join(ROOT, ".codex-auto", "quality", "shared-brain-restart-replay.json");
const SEED = join(ROOT, ".codex-auto", "quality", "shared-brain-restart-replay-seed.json");

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const phase = arg("phase", "verify");
const id = arg("id", process.env.AETHER_RESTART_REPLAY_ID);

if (!TOKEN) {
  const report = {
    schema: "aether.shared-brain-restart-replay/v1",
    phase,
    ok: false,
    status: "environment-blocked",
    strictPass: false,
    generatedAt: new Date().toISOString(),
    blockers: [
      {
        capability: "aether-api-token",
        message: "QUORUM_API_TOKEN is required for the two-phase live restart replay verifier",
        phase: "host-preflight",
        command: "node scripts/verify-shared-brain-restart-replay.mjs",
      },
    ],
    nextAction:
      "Run the seed phase against a live authenticated Aether API, restart Aether Terminal, then run the verify phase with the printed id.",
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.error("QUORUM_API_TOKEN is required");
  process.exit(1);
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

function seedFor(runId) {
  return {
    id: runId,
    decisionKey: `restartReplay.${runId}.decision`,
    decisionValue: `durable-${runId}`,
    agentId: `restart-replay-agent-${runId}`,
    filePattern: `src/restart-replay/${runId}/**`,
    claimId: `restart-replay:${runId}:symbol`,
    symbolPath: `src/restart-replay/${runId}/worker.rs`,
    symbol: "restart_replay_worker",
  };
}

function loadSeed() {
  if (id) return seedFor(id);
  try {
    return JSON.parse(readFileSync(SEED, "utf8"));
  } catch {
    throw new Error("--id is required for verify when no seed file exists");
  }
}

function ok(condition, message, failures) {
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
  if (!condition) failures.push(message);
}

async function seed() {
  const runId = id ?? `${Date.now()}`;
  const seed = seedFor(runId);
  await call("aether.context.set", { key: seed.decisionKey, value: seed.decisionValue });
  await call("aether.ownership.assign", { agentId: seed.agentId, pattern: seed.filePattern });
  await call("aether.symbol.claim", {
    claimId: seed.claimId,
    agentId: seed.agentId,
    taskId: `restart-replay-task-${runId}`,
    path: seed.symbolPath,
    symbol: seed.symbol,
    startLine: 1,
    endLine: 8,
    mode: "write",
    confidence: "parser",
    leaseSecs: 86400,
  });
  await call("aether.agent.report_blocker", {
    sessionId: seed.agentId,
    summary: `restart replay marker ${runId}`,
    needs: "verify after restart",
  });
  const snapshot = await call("aether.shared_brain.snapshot", { workspaceId: `restart-${runId}` });
  const failures = [];
  ok(snapshot.decisions?.[seed.decisionKey] === seed.decisionValue, "seed snapshot includes decision", failures);
  ok(
    snapshot.ownership?.some((claim) => claim.path === seed.filePattern && claim.ownerSessionId === seed.agentId),
    "seed snapshot includes file ownership",
    failures,
  );
  ok(
    snapshot.ownership?.some((claim) => claim.claimId === seed.claimId && claim.symbol === seed.symbol),
    "seed snapshot includes symbol ownership",
    failures,
  );
  if (failures.length > 0) throw new Error(`${failures.length} seed assertion(s) failed`);
  mkdirSync(dirname(SEED), { recursive: true });
  writeFileSync(SEED, `${JSON.stringify(seed, null, 2)}\n`);
  writeFileSync(
    OUT,
    `${JSON.stringify({ schema: "aether.shared-brain-restart-replay/v1", phase: "seed", ok: true, seed }, null, 2)}\n`,
  );
  console.log(`\nSeeded restart replay id: ${runId}`);
  console.log(
    `Restart Aether Terminal, then run: node scripts/verify-shared-brain-restart-replay.mjs --phase verify --id ${runId}`,
  );
}

async function verify() {
  const seed = loadSeed();
  const failures = [];
  const all = await call("aether.context.all");
  ok(all.decisions?.[seed.decisionKey] === seed.decisionValue, "context decision survived restart", failures);

  const file = await call("aether.ownership.claims");
  ok(
    file.claims?.some((claim) => claim.agent_id === seed.agentId && claim.pattern === seed.filePattern),
    "file ownership survived restart",
    failures,
  );

  const symbols = await call("aether.symbol.claims");
  ok(
    symbols.claims?.some((claim) => claim.claim_id === seed.claimId && claim.symbol === seed.symbol),
    "symbol ownership survived restart",
    failures,
  );

  const events = await call("aether.event.since", { afterSeq: 0, limit: 1000 });
  ok(
    events.events?.some((event) => event.kind === "blocker_raised" && event.payload?.sessionId === seed.agentId),
    "durable event log replays restart marker",
    failures,
  );

  const snapshot = await call("aether.shared_brain.snapshot", { workspaceId: `restart-${seed.id}` });
  ok(
    snapshot.decisions?.[seed.decisionKey] === seed.decisionValue,
    "shared_brain snapshot includes restored decision",
    failures,
  );
  ok(
    snapshot.ownership?.some((claim) => claim.path === seed.filePattern && claim.ownerSessionId === seed.agentId),
    "shared_brain snapshot includes restored file ownership",
    failures,
  );
  ok(
    snapshot.ownership?.some((claim) => claim.claimId === seed.claimId && claim.symbol === seed.symbol),
    "shared_brain snapshot includes restored symbol ownership",
    failures,
  );

  const report = {
    schema: "aether.shared-brain-restart-replay/v1",
    phase: "verify",
    ok: failures.length === 0,
    seed,
    failures,
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) throw new Error(`${failures.length} verify assertion(s) failed`);
  console.log("\nAll shared-brain restart replay assertions PASSED");
}

if (phase === "seed") {
  await seed();
} else if (phase === "verify") {
  await verify();
} else {
  throw new Error(`unknown --phase ${phase}; expected seed or verify`);
}
