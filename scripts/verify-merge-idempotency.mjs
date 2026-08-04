// LIVE compatibility verification against a running Aelyris MCP server.
//
// Generic merge idempotency is now owned internally by the backend-created,
// exact-candidate MergeIntent path. The legacy MCP request/approve names remain
// cataloged only to fail closed. This live check proves those compatibility
// calls cannot create an unresolved intent or merge anything.
//
// Operator-run:
//   pnpm tauri:dev   # in another terminal; export AELYRIS_API_TOKEN
//   node scripts/verify-merge-idempotency.mjs
import process from "node:process";

const BASE = process.env.AELYRIS_API_URL ?? "http://127.0.0.1:9333";
const TOKEN = process.env.AELYRIS_API_TOKEN;
if (!TOKEN) {
  console.error("AELYRIS_API_TOKEN is required (start `pnpm tauri:dev` and export it)");
  process.exit(2);
}

let rpcId = 0;
async function rawToolCall(name, args) {
  const response = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return response.json();
}

function toolSucceeded(body) {
  return body.error == null && body.result?.isError === false;
}

function toolPayload(body) {
  return body.result?.structuredContent;
}

function errorText(body) {
  return JSON.stringify(body.error ?? body.result?.structuredContent ?? body);
}

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
  console.log(`${condition ? "PASS" : "FAIL"}  ${message}`);
}

async function pendingIntentIds() {
  const body = await rawToolCall("aelyris.list_pending_approvals", {});
  if (!toolSucceeded(body)) throw new Error(`pending list failed: ${errorText(body)}`);
  return (toolPayload(body)?.mergeIntents ?? []).map((intent) => intent.intentId).sort();
}

async function main() {
  const before = await pendingIntentIds();

  const request = await rawToolCall("aelyris.request_merge", {
    taskId: `retired-${Date.now()}`,
    repoPath: "C:/does-not-need-to-exist",
    sourceBranch: "feature",
    targetBranch: "main",
  });
  assert(!toolSucceeded(request), "retired request_merge fails closed");
  assert(errorText(request).includes("retired"), "request_merge explains that the authority is retired");

  const approve = await rawToolCall("aelyris.review.approve", {
    intentId: `merge:retired:${Date.now()}`,
  });
  assert(!toolSucceeded(approve), "retired review.approve fails closed");
  assert(errorText(approve).includes("retired"), "review.approve explains that raw approval is retired");

  const after = await pendingIntentIds();
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    "retired request/approve calls create no durable unresolved merge intent",
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} retired-merge compatibility assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll retired raw-merge compatibility assertions PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
