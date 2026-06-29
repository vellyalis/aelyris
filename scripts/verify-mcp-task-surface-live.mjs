// Live verification of the MCP Task Graph + orchestrator surface (Face 2,
// BR4/BR9) against the running Aelyris API. Proves the orchestrator AI can
// decompose, assign, and inspect work over MCP HTTP, operating on the same
// Arc<TaskManager> the cockpit shows (one source of truth).
//
// Prereq: `pnpm tauri:dev` running; AELYRIS_API_TOKEN set to the API bearer token
// (printed at startup as "generated ephemeral token: <uuid>" when unset).
// Run: AELYRIS_API_TOKEN=<token> node scripts/verify-mcp-task-surface-live.mjs
const BASE = process.env.AELYRIS_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.AELYRIS_API_TOKEN;
if (!TOKEN) {
  console.error("AELYRIS_API_TOKEN is required (the API bearer token from the dev log)");
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

const id = `mcp-task-${Date.now()}`;
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

// 1. Create an assigned task with branch bindings over MCP.
const created = await call("aelyris.task.create", {
  id,
  title: "auth API",
  owner: "claude",
  priority: "high",
  sourceBranch: "agent/auth",
  targetBranch: "main",
});
ok(created.created === true, "task.create returns created=true");
ok(
  Array.isArray(created.changed) && created.changed.includes(id),
  `task.create gate promoted ${id} to ready (changed=${JSON.stringify(created.changed)})`,
);

// 2. It shows up in the shared graph with its assignment + branch bindings.
const listed = await call("aelyris.task.list");
const found = listed.tasks.find((t) => t.id === id);
ok(found?.owner === "claude", `task.list shows ${id} owned by claude`);
ok(
  found?.source_branch === "agent/auth" && found?.target_branch === "main",
  "branch bindings persisted",
);
ok(found?.status === "ready", `root task is ready after the gate (got ${found?.status})`);

// 3. The scheduler plans to dispatch it.
const planned = await call("aelyris.orchestrator.plan", { activeAgents: 0 });
ok(planned.plan.state === "active", `orchestrator.plan state active (got ${planned.plan.state})`);
ok(
  planned.plan.to_dispatch.includes(id),
  `plan dispatches ${id} (got ${JSON.stringify(planned.plan.to_dispatch)})`,
);

// 4. Transition it through the lifecycle over MCP.
const ran = await call("aelyris.task.transition", { id, to: "running" });
ok(ran.to === "running", "task.transition -> running");
const listed2 = await call("aelyris.task.list");
ok(
  listed2.tasks.find((t) => t.id === id)?.status === "running",
  "graph reflects the running transition",
);

if (failures.length) {
  console.error(`\n${failures.length} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll MCP task-surface live assertions PASSED");
