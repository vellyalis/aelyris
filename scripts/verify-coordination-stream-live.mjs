// Live verification of the fleet coordination surface over MCP (Face 2,
// BR5/BR8): the orchestrator AI subscribes to the shared event stream and
// assigns/inspects File Ownership so parallel lanes never collide — no SQL, no
// shared file, no screen-scraping. Deterministic (no agent / no auth).
//
// Prereq: `pnpm tauri:dev` running; AETHER_API_TOKEN set to the API bearer token.
const BASE = process.env.AETHER_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.AETHER_API_TOKEN;
if (!TOKEN) {
  console.error("AETHER_API_TOKEN is required");
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

const ns = `coord-${Date.now()}`;
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

async function main() {
  const agentA = `${ns}-a`;
  const agentB = `${ns}-b`;
  const recursive = `src/${ns}/**`;
  const nested = `src/${ns}/login.ts`;

  // 1. File Ownership: assign two overlapping lanes to different agents.
  await call("aether.ownership.assign", { agentId: agentA, pattern: recursive });
  const assigned = await call("aether.ownership.assign", { agentId: agentB, pattern: nested });
  const myConflict = assigned.conflicts.find(
    (c) => c.pattern_a === recursive && c.pattern_b === nested,
  );
  ok(!!myConflict, "ownership.assign surfaces the cross-agent conflict up front");
  ok(myConflict?.agent_a === agentA && myConflict?.agent_b === agentB, "conflict names both agents");

  // 2. owner_of resolves the lane.
  const ownerOf = await call("aether.ownership.owner_of", { path: nested });
  ok(ownerOf.owner === agentA, `ownership.owner_of(${nested}) = ${agentA} (got ${ownerOf.owner})`);

  // 3. claims includes both lanes.
  const claims = await call("aether.ownership.claims");
  const mine = claims.claims.filter((c) => c.agent_id === agentA || c.agent_id === agentB);
  ok(mine.length >= 2, "ownership.claims lists the assigned lanes");

  // 4. Event stream: a task.create publishes task_created; the orchestrator reads it back.
  const taskId = `${ns}-task`;
  await call("aether.task.create", { id: taskId, title: "coordination probe" });
  const recent = await call("aether.event.recent");
  const created = recent.events.find((e) => e.kind === "task_created" && e.payload?.id === taskId);
  ok(!!created, "event.recent surfaces the task_created event (shared coordination stream)");
  ok(created?.channel === "planning", `task_created routed to the planning channel (got ${created?.channel})`);

  const planning = await call("aether.event.by_channel", { channel: "planning" });
  ok(
    planning.events.some((e) => e.kind === "task_created" && e.payload?.id === taskId),
    "event.by_channel(planning) filters the stream",
  );

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll coordination-stream (event bus + file ownership over MCP) live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
