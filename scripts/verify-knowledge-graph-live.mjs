// Live verification of the Knowledge Graph over MCP (BR): the fleet reasons over
// code STRUCTURE (User -> AuthService -> JWTProvider -> Redis), and a change's
// blast radius (impact) is known up front. Deterministic (no agent / no auth).
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

const ns = `kg-${Date.now()}`;
const N = (s) => `${ns}-${s}`;
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};
const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function main() {
  // Build User -> AuthService -> JWTProvider -> Redis (namespaced).
  await call("aether.knowledge.add_node", { id: N("AuthService"), kind: "service", file: "src/auth/service.ts" });
  await call("aether.knowledge.add_edge", { dependent: N("User"), dependency: N("AuthService") });
  await call("aether.knowledge.add_edge", { dependent: N("AuthService"), dependency: N("JWTProvider") });
  await call("aether.knowledge.add_edge", { dependent: N("JWTProvider"), dependency: N("Redis") });

  // Direct structure.
  const deps = await call("aether.knowledge.dependencies", { id: N("AuthService") });
  ok(sortedEq(deps.dependencies, [N("JWTProvider")]), "dependencies_of(AuthService) = [JWTProvider]");
  const dependents = await call("aether.knowledge.dependents", { id: N("JWTProvider") });
  ok(sortedEq(dependents.dependents, [N("AuthService")]), "dependents_of(JWTProvider) = [AuthService]");

  // Blast radius — the whole point.
  const impactRedis = await call("aether.knowledge.impact", { id: N("Redis") });
  ok(
    sortedEq(impactRedis.impact, [N("AuthService"), N("JWTProvider"), N("User")]),
    `impact(Redis) = the transitive blast radius [AuthService, JWTProvider, User] (got ${JSON.stringify(impactRedis.impact)})`,
  );
  const impactJwt = await call("aether.knowledge.impact", { id: N("JWTProvider") });
  ok(
    sortedEq(impactJwt.impact, [N("AuthService"), N("User")]),
    "impact(JWTProvider) = [AuthService, User] (not Redis, which is below it)",
  );
  const impactUser = await call("aether.knowledge.impact", { id: N("User") });
  ok(!impactUser.impact.includes(N("Redis")), "impact(User) (a leaf consumer) does not ripple downward");

  // The full graph is queryable.
  const graph = await call("aether.knowledge.graph");
  const myNodes = graph.nodes.filter((n) => n.id.startsWith(ns));
  ok(myNodes.length >= 4, `knowledge.graph returns the nodes (got ${myNodes.length})`);
  const authNode = myNodes.find((n) => n.id === N("AuthService"));
  ok(authNode?.file === "src/auth/service.ts", "node carries its file (structure linked back to source)");

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll Knowledge Graph (structure + impact over MCP) live assertions PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
