import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, ".codex-auto", "quality", "proofbook-runner.json");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const hasAll = (text, needles) => needles.every((needle) => text.includes(needle));
const mtime = (path) => (existsSync(join(ROOT, path)) ? statSync(join(ROOT, path)).mtimeMs : null);

const paths = {
  spec: "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
  index: "docs/specs/README.md",
  packageJson: "package.json",
  mod: "src-tauri/src/proofbook/mod.rs",
  ledger: "src-tauri/src/proofbook/ledger.rs",
  runner: "src-tauri/src/proofbook/runner.rs",
  shell: "src-tauri/src/proofbook/step_shell.rs",
  wait: "src-tauri/src/proofbook/step_wait.rs",
  manualGate: "src-tauri/src/proofbook/step_manual_gate.rs",
  ipc: "src-tauri/src/ipc/proofbook_commands.rs",
  apiMcp: "src-tauri/src/api/mcp.rs",
  apiMod: "src-tauri/src/api/mod.rs",
  lib: "src-tauri/src/lib.rs",
  verifier: "scripts/verify-proofbook-runner.mjs",
};

const files = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, existsSync(join(ROOT, path)) ? read(path) : ""]),
);
const normalizedSpec = files.spec.replace(/\s+/g, " ");
const normalizedIndex = files.index.replace(/\s+/g, " ");

function check(id, ok, detail, evidence = {}) {
  return { id, status: ok ? "passed" : "failed", detail, evidence };
}

const checks = [
  check(
    "pb2-runner-files-exist",
    ["ledger", "runner", "shell", "wait", "manualGate"].every((key) => files[key].length > 0),
    "PB-2 runner spine files exist under src-tauri/src/proofbook",
  ),
  check(
    "pb2-module-exports-runner-spine",
    hasAll(files.mod, [
      "mod ledger;",
      "mod runner;",
      "mod step_shell;",
      "mod step_wait;",
      "mod step_manual_gate;",
      "ProofbookMcpToolExecutor",
      "ProofbookStepOutcome",
      "ProofbookRunner",
      "PROOFBOOK_RUN_SCHEMA_V1",
    ]),
    "Proofbook module exports the PB-2 runner/ledger spine through the single proofbook contract surface",
  ),
  check(
    "pb2-ledger-contract",
    hasAll(files.ledger, [
      "aelyris.proofbook_run.v1",
      "ProofbookRunLedger",
      "events",
      "steps",
      "artifacts",
      "decisions",
      "residual_blockers",
      "definition_hash",
      "input_hash",
      "write_ledger",
      "rename",
      "sha256",
      "redaction_count",
      ".aelyris",
      "proofbook-runs",
      "hash_bytes(relative.as_bytes())",
    ]),
    "Ledger records run schema, hashes, append events, artifact refs, decisions, blockers, redaction, and atomic JSON persistence",
  ),
  check(
    "pb2-runner-state-machine",
    hasAll(files.runner, [
      "start_run",
      "drive_run",
      "settle_run",
      "restore_project",
      "deterministic queue",
      "interrupted_by_restart",
      "not_implemented",
      "ProofbookRunStatus::WaitingGate",
      "ProofbookStepStatus::Running",
      "definition_changed_after_gate",
      "validation_failed_after_gate",
    ]),
    "Runner starts after PB-1 validation, writes before execution, settles required proof, and hydrates running steps fail-closed",
  ),
  check(
    "pb2-shell-verifier-policy",
    hasAll(files.shell, [
      "classify_command",
      "CommandRiskSeverity::Deny",
      "CommandRiskSeverity::Review",
      "blocked_by_policy",
      "commandRisk",
      "hidden_command",
      "expectedArtifact",
      "expectedArtifacts",
      "write_text_artifact",
      "record_existing_artifact",
    ]),
    "shell/verifier steps use command-risk classification, gate review commands, deny destructive commands, and record artifacts",
  ),
  check(
    "pb2-wait-manual-gate",
    hasAll(files.wait, ["intervalMs", "timeoutMs", "thread::sleep", "wait_timeout"]) &&
      hasAll(files.manualGate, ["manualGate", "gateHash", "gate_hash", "ProofbookGateDecision", "approve", "reject"]),
    "waitFor is bounded and manualGate records gate hash plus auditable decisions",
  ),
  check(
    "pb2-ipc-runner-adapters",
    hasAll(files.ipc, [
      "start_proofbook_run",
      "proofbook_run_status",
      "list_proofbook_runs",
      "cancel_proofbook_run",
      "resolve_proofbook_manual_gate",
      "proofbook-updated",
    ]),
    "IPC exposes PB-2 local runner adapters without adding MCP Proofbook verbs",
  ),
  check(
    "pb2-tauri-wiring",
    hasAll(files.lib, [
      "manage(proofbook::ProofbookRunner::new())",
      "ipc::start_proofbook_run",
      "ipc::proofbook_run_status",
      "ipc::list_proofbook_runs",
      "ipc::cancel_proofbook_run",
      "ipc::resolve_proofbook_manual_gate",
    ]),
    "Tauri manages the Proofbook runner and registers runner IPC commands",
  ),
  check(
    "pb3-mcp-catalog-dispatch",
    hasAll(files.apiMcp, [
      "aelyris.proofbook.list",
      "aelyris.proofbook.get",
      "aelyris.proofbook.validate",
      "aelyris.proofbook.run",
      "aelyris.proofbook.status",
      "aelyris.proofbook.cancel",
      "aelyris.proofbook.approve_gate",
      "aelyris.proofbook.reject_gate",
      "McpProofbookExecutor",
      "input_schema_for_tool(&tool_name)",
      "validate_tool_arguments(&tool_name, &arguments, &schema)",
      "governance.authorize(actor, &tool_name)",
      "call_mcp_tool_on_fresh_runtime",
      "mcp_schema_violation",
      "mcp_governance_denied",
      "proofbook_mcp_recursion_not_supported",
      "pendingDecisionId",
      "proofbook_mcp_verbs_are_cataloged_and_scoped",
      "proofbook_mcp_run_executes_free_mcp_tool_step_through_tools_call",
      "proofbook_gated_mcp_tool_waits_and_stale_gate_hash_fails_closed",
    ]),
    "PB-3 MCP face registers Proofbook verbs, delegates mcpTool through the shared schema/governance dispatch path, and tests the gated wait/fail-closed behavior",
  ),
  check(
    "pb3-runner-mcp-executor-seam",
    hasAll(files.runner, [
      "ProofbookMcpToolExecutor",
      "start_run_with_mcp_executor",
      "resolve_gate_with_mcp_executor",
      "ProofbookStepKind::McpTool",
      "Proofbook mcpTool steps require the PB-3 MCP runtime",
      "resolving Proofbook MCP tool gates requires the MCP runtime",
      "proofbook_gate_rejected",
    ]) &&
      hasAll(files.apiMod, ["proofbook_runner", "with_proofbook_runner"]) &&
      hasAll(files.lib, ["state::<proofbook::ProofbookRunner>()", "with_proofbook_runner(proofbook_runner)"]),
    "Runner exposes a narrow PB-3 executor seam and the MCP ApiState receives the managed Tauri Proofbook runner instead of creating a second runner",
  ),
  check(
    "pb2-package-verifier-script",
    files.packageJson.includes('"verify:proofbook:runner": "node scripts/verify-proofbook-runner.mjs"'),
    "package.json exposes pnpm verify:proofbook:runner",
  ),
  check(
    "pb2-pb3-doc-claim-boundary",
    hasAll(normalizedSpec, [
      "PB-2 local backend runner/ledger",
      "PB-3 MCP integration slice",
      "Proofbook canvas",
      "create/update/distill",
      "not a shipped end-user Proofbook product",
    ]) &&
      hasAll(normalizedIndex, [
        "PB-2 local backend runner/ledger",
        "PB-3 MCP integration slice",
        "Proofbooks 全体の実装済みclaimではない",
      ]),
    "Docs distinguish the implemented PB-2/PB-3 runtime slices from unimplemented product/UI/future-step capabilities",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.proofbook-runner/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-proofbook-runner-contract" : "fail-proofbook-runner-contract",
  generatedAt: new Date().toISOString(),
  artifact: ".codex-auto/quality/proofbook-runner.json",
  sourcePaths: Object.values(paths),
  sourceMtimes: Object.fromEntries(Object.values(paths).map((path) => [path, mtime(path)])),
  checks,
};

mkdirSync(join(ROOT, ".codex-auto", "quality"), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) process.exit(1);
