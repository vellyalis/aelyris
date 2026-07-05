import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, ".codex-auto", "quality", "proofbook-agent-session.json");

const paths = {
  packageJson: "package.json",
  spec: "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
  index: "docs/specs/README.md",
  mod: "src-tauri/src/proofbook/mod.rs",
  agentStep: "src-tauri/src/proofbook/agent_step.rs",
  runner: "src-tauri/src/proofbook/runner.rs",
  ipc: "src-tauri/src/ipc/proofbook_commands.rs",
  apiMcp: "src-tauri/src/api/mcp.rs",
  verifier: "scripts/verify-proofbook-agent-session.mjs",
};

const full = (path) => join(ROOT, path);
const read = (path) => (existsSync(full(path)) ? readFileSync(full(path), "utf8") : "");
const mtime = (path) => (existsSync(full(path)) ? statSync(full(path)).mtimeMs : null);
const files = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]));
const normalizedSpec = files.spec.replace(/\s+/g, " ");
const normalizedIndex = files.index.replace(/\s+/g, " ");

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function check(id, ok, detail, evidence = {}) {
  return { id, status: ok ? "passed" : "failed", detail, evidence };
}

const checks = [
  check(
    "pb4-agent-step-module",
    hasAll(files.mod, [
      "mod agent_step;",
      "ProofbookAgentSessionExecutor",
      "ProofbookAgentSessionRequest",
      "ProofbookAgentSessionSpawn",
    ]) &&
      hasAll(files.agentStep, [
        "ProofbookAgentSessionExecutor",
        "execute_agent_session_step",
        "ProofbookAgentSessionRequest",
        "ProofbookAgentSessionSpawn",
        "agent_session_invalid_config",
        "agent_session_headless_not_allowed",
        "agent_session_cost_unknown",
        "agent_session_identity_mismatch",
        "agent_session_interrupted_by_restart",
      ]),
    "PB-4 has a dedicated agent_step adapter module with typed fail-closed error codes",
  ),
  check(
    "pb4-visible-headless-policy",
    hasAll(files.agentStep, [
      "visible",
      "headlessReason",
      "planner",
      "reviewer",
      "batch",
      "headless agentSession is only allowed",
      "headless agentSession requires headlessReason",
      "visibleMode",
      "costTokensStatus",
      "lifecycleArtifacts",
      "expectedArtifacts",
    ]),
    "agentSession enforces visible default, restricted headless roles, reason recording, unknown cost/tokens, and lifecycle artifact slots",
  ),
  check(
    "pb4-runner-seam",
    hasAll(files.runner, [
      "ProofbookAgentSessionExecutor",
      "start_run_with_agent_executor",
      "start_run_with_executors",
      "ProofbookStepKind::AgentSession",
      "execute_agent_session_step",
      "ProofbookStepStatus::WaitingGate | ProofbookStepStatus::Running",
      "step_running",
      "agent_session_interrupted_by_restart",
      "proofbook_runner_agent_session_spawn_records_running_ledger_metadata",
      "proofbook_runner_agent_session_requires_pb4_runtime",
      "proofbook_runner_agent_session_headless_planner_records_reason",
    ]),
    "runner injects the PB-4 agent executor, leaves spawned agentSession steps running, and tests the ledger state",
  ),
  check(
    "pb4-ipc-mcp-runtime-adapters",
    hasAll(files.ipc, [
      "IpcProofbookAgentExecutor",
      "start_run_with_agent_executor",
      "spawn_interactive_agent",
      "start_headless",
      "HeadlessSpawnSpec",
    ]) &&
      hasAll(files.apiMcp, [
        "ProofbookAgentSessionExecutor for McpProofbookExecutor",
        "start_run_with_executors",
        "Some(&executor)",
        "spawn_interactive_agent",
        "start_headless",
        "HeadlessSpawnSpec",
      ]),
    "IPC and MCP Proofbook run paths inject the existing visible/headless agent runtimes instead of creating a Proofbook-only launcher",
  ),
  check(
    "pb4-package-script",
    files.packageJson.includes(
      '"verify:proofbook:agent-session": "node scripts/verify-proofbook-agent-session.mjs"',
    ),
    "package.json exposes pnpm verify:proofbook:agent-session",
  ),
  check(
    "pb4-doc-claim-boundary",
    hasAll(normalizedSpec, [
      "PB-4 agentSession runtime",
      "not a shipped end-user Proofbook",
      "HTTP/fan-out",
      "Evidence Store",
    ]) &&
      hasAll(normalizedIndex, [
        "PB-4 agentSession runtime",
        "Proofbooks 全体の実装済みclaimではない",
      ]),
    "docs name the PB-4 runtime slice while keeping the broader Proofbook product non-claim explicit",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.proofbook-agent-session/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-proofbook-agent-session-contract" : "fail-proofbook-agent-session-contract",
  generatedAt: new Date().toISOString(),
  artifact: ".codex-auto/quality/proofbook-agent-session.json",
  sourcePaths: Object.values(paths),
  sourceMtimes: Object.fromEntries(Object.values(paths).map((path) => [path, mtime(path)])),
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) process.exit(1);
