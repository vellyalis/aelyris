// Live verification of the Shared Brain surface over MCP (BR5/BR6): the shared
// ADR (project decisions every agent aligns to) and the Intent Bus (proposals
// shared before acting). Deterministic (no agent / no auth).
//
// Prereq: `pnpm tauri:dev` running; QUORUM_API_TOKEN set to the API bearer token.
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

const ns = `sb-${Date.now()}`;
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

async function main() {
  // --- Shared ADR (Context Store) ---
  const key = `${ns}-auth_method`;
  const setRes = await call("aether.context.set", { key, value: "jwt" });
  ok(setRes.change?.value === "jwt", "context.set records the decision");

  const all = await call("aether.context.all");
  ok(all.decisions[key] === "jwt", "context.all surfaces the shared ADR (world-model snapshot)");
  const got = await call("aether.context.get", { key });
  ok(got.value === "jwt", "context.get reads one decision back");

  const recent = await call("aether.event.recent");
  ok(
    recent.events.some((e) => e.kind === "decision_changed" && e.payload?.key === key),
    "context.set publishes decision_changed to the shared stream",
  );

  // Idempotent set is a no-op (must not spam the fleet).
  const again = await call("aether.context.set", { key, value: "jwt" });
  ok(again.change === null, "identical context.set is a no-op (no duplicate broadcast)");

  // --- Intent Bus (pre-fact deliberation) ---
  const proposed = await call("aether.intent.propose", {
    agentId: `${ns}-claude`,
    proposal: "switch auth_method to JWT",
    targets: ["src/auth/**"],
  });
  const intentId = proposed.intent.id;
  ok(proposed.intent.status === "open", "intent.propose stores an open proposal");

  const open = await call("aether.intent.list");
  ok(
    open.intents.some((i) => i.id === intentId),
    "intent.list surfaces the open proposal (the deliberation queue)",
  );
  const recent2 = await call("aether.event.recent");
  ok(
    recent2.events.some((e) => e.kind === "intent_declared"),
    "intent.propose publishes intent_declared to the stream (peers react pre-action)",
  );

  const resolved = await call("aether.intent.resolve", { id: intentId, status: "accepted" });
  ok(resolved.intent?.status === "accepted", "intent.resolve converges the proposal");
  const openAfter = await call("aether.intent.list");
  ok(!openAfter.intents.some((i) => i.id === intentId), "resolved intent leaves the open queue");

  // --- Blocker channel ("what am I stuck on") ---
  const summary = `${ns} stuck on JWT refresh`;
  await call("aether.agent.report_blocker", {
    sessionId: `${ns}-sess`,
    summary,
    needs: "decision on token TTL",
  });
  const recent3 = await call("aether.event.recent");
  const blocker = recent3.events.find((e) => e.kind === "blocker_raised" && e.payload?.summary === summary);
  ok(!!blocker, "report_blocker publishes blocker_raised to the stream (the 'what am I stuck on' channel)");
  ok(blocker?.payload?.needs === "decision on token TTL", "the blocker carries what it needs to be unblocked");

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll Shared Brain (ADR + Intent Bus over MCP) live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
