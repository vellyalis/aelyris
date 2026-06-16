// Live verification of the native MCP endpoint (JSON-RPC 2.0 over Streamable HTTP)
// so Aether registers as a standard MCP server. POST /mcp with JSON-RPC; checks
// initialize / tools.list / tools.call / notifications / errors conform.
//
// Prereq: `pnpm tauri:dev` running; AETHER_API_TOKEN set to the API bearer token.
const BASE = process.env.AETHER_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.AETHER_API_TOKEN;
if (!TOKEN) {
  console.error("AETHER_API_TOKEN is required");
  process.exit(2);
}

function post(payload) {
  return fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
const rpc = (method, params, id) => post({ jsonrpc: "2.0", id, method, params });

const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
};

async function main() {
  // 1. initialize
  const init = await (await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} }, 1)).json();
  ok(init.jsonrpc === "2.0" && init.id === 1, "initialize is valid JSON-RPC 2.0 (echoes id)");
  ok(init.result?.serverInfo?.name === "aether-terminal", "serverInfo.name = aether-terminal");
  ok(!!init.result?.capabilities?.tools, "advertises the tools capability");
  ok(typeof init.result?.instructions === "string" && init.result.instructions.length > 80, "ships orchestration instructions");

  // 2. tools/list
  const list = await (await rpc("tools/list", {}, 2)).json();
  ok(Array.isArray(list.result?.tools) && list.result.tools.length >= 50, `tools/list returns the verb catalog (${list.result?.tools?.length})`);
  ok(list.result.tools.some((t) => t.name === "aether.orchestrator.step"), "catalog includes orchestrator.step");
  ok(list.result.tools.some((t) => t.name === "aether.knowledge.impact"), "catalog includes knowledge.impact");

  // 3. tools/call round-trip (context.set then context.get over JSON-RPC)
  const ns = `rpc-${Date.now()}`;
  await rpc("tools/call", { name: "aether.context.set", arguments: { key: `${ns}-k`, value: "v" } }, 3);
  const call = await (await rpc("tools/call", { name: "aether.context.get", arguments: { key: `${ns}-k` } }, 4)).json();
  ok(call.result?.isError === false, "tools/call succeeds (isError:false)");
  ok(call.result?.structuredContent?.value === "v", "tools/call returns structuredContent");
  ok(JSON.parse(call.result.content[0].text).value === "v", "content[0].text is the JSON-serialized result");

  // 4. notification (no id) -> no JSON-RPC response (202)
  const notif = await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  ok(notif.status === 202, "a notification (no id) gets 202 with no body");

  // 5. unknown method -> JSON-RPC protocol error
  const bad = await (await rpc("bogus/method", {}, 5)).json();
  ok(bad.error?.code === -32601, "unknown method -> JSON-RPC error -32601");

  // 6. tool-level error -> result with isError:true (NOT a protocol error)
  const toolErr = await (await rpc("tools/call", { name: "aether.task.transition", arguments: { id: `${ns}-missing`, to: "running" } }, 6)).json();
  ok(toolErr.result?.isError === true && !toolErr.error, "a tool error surfaces as result.isError:true, not a JSON-RPC error");

  if (failures.length) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll native MCP (JSON-RPC 2.0) live assertions PASSED — Aether is registerable as a standard MCP server");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
