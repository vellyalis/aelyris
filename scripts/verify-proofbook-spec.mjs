import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "proofbook-spec.json");

const paths = {
  spec: "docs/specs/PROOFBOOK_AUTOMATION_SPEC.md",
  pb1DetailedDesign: "docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md",
  mcpToolSurface: "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
};

const stepTypes = [
  "`shell`",
  "`verifier`",
  "`mcpTool`",
  "`agentSession`",
  "`http`",
  "`manualGate`",
  "`waitFor`",
  "`fanOut`",
  "`subProofbook`",
  "`evidence.write` / `evidence.read`",
];

const mcpVerbs = [
  "aelyris.proofbook.list",
  "aelyris.proofbook.get",
  "aelyris.proofbook.validate",
  "aelyris.proofbook.run",
  "aelyris.proofbook.status",
  "aelyris.proofbook.cancel",
  "aelyris.proofbook.approve_gate",
  "aelyris.proofbook.reject_gate",
  "aelyris.proofbook.create",
  "aelyris.proofbook.update",
  "aelyris.proofbook.distill",
];

const roadmapIds = ["PB-0", "PB-1", "PB-2", "PB-3", "PB-4", "PB-5", "PB-6", "PB-7"];
const detailedDesignIds = ["PB-1D", "PB-2D", "PB-3D", "PB-4D", "PB-5D", "PB-6D", "PB-7D"];

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  const full = fullPath(path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function mtime(path) {
  const full = fullPath(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function missingFrom(text, needles) {
  return needles.filter((needle) => !text.includes(needle));
}

function missingFromNormalized(text, needles) {
  const normalized = normalize(text);
  return needles.filter((needle) => !normalized.includes(normalize(needle)));
}

function check(id, passed, detail, evidence = {}) {
  return {
    id,
    status: passed ? "passed" : "failed",
    detail,
    evidence,
  };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const spec = readText(paths.spec);
const pb1DetailedDesign = readText(paths.pb1DetailedDesign);
const mcpToolSurface = readText(paths.mcpToolSurface);
const specIndex = readText(paths.specIndex);
const packageJson = readText(paths.packageJson);
const normalizedSpec = normalize(spec);
const normalizedIndex = normalize(specIndex);
const normalizedMcpToolSurface = normalize(mcpToolSurface);

const missingStepTypes = missingFrom(spec, stepTypes);
const missingMcpVerbs = missingFrom(spec, mcpVerbs);
const missingRoadmapSections = roadmapIds.filter((id) => !new RegExp(`### ${id}\\b`).test(spec));
const missingGoalPackets = roadmapIds.filter((id) => !new RegExp(`### ${id} \`/goal\``).test(spec));
const missingDetailedDesignIds = detailedDesignIds.filter((id) => !spec.includes(id));
const requiredDevelopmentMethodClauses = [
  "PB-1 through PB-7 must not jump directly from roadmap text to implementation.",
  "Each implementation phase has a required **PB-ND detailed design gate** before runtime/UI code for that phase may land.",
  "The design gate is its own phase and keeps the same repo rule: one phase = one explicit commit.",
  "Runtime implementation for PB-N is not in scope until PB-ND is green.",
  "A phase that adds code without its PB-ND design gate is incomplete even if tests pass.",
  "Proofbook development is **contract-first, existing-spine vertical slices**.",
  "The single Proofbook contract spine is `src-tauri/src/proofbook`; IPC, MCP, and UI are adapters only.",
  "No phase may add a second dispatcher, command policy, persistence authority, proof format, frontend-only executable schema, or MCP catalog path.",
  "Unsupported future step types must fail closed with explicit `unsupported_step_type` or `not_implemented` status",
  "UI work must trail backend contracts",
  "Each PB phase exits debt-zero",
  "no orphan stubs",
  "TODO placeholders",
  "duplicate schemas",
  "fake-success paths",
  "alternate dispatchers",
  "owner modules and exact file scope",
  "schema/data model changes and typed error taxonomy",
  "lifecycle or state-machine transitions",
  "verifier commands, artifact paths, and focused test matrix",
  "migration/compatibility/debt boundaries",
  "claim boundary and stop conditions",
];
const missingDevelopmentMethodClauses = missingFromNormalized(spec, requiredDevelopmentMethodClauses);
const requiredAuthorityDelegationClauses = [
  "Authority delegation matrix:",
  "`shell` / `verifier`",
  "Existing command-risk policy plus repo proof artifact chain.",
  "`mcpTool`",
  "Existing schema-enforced `tools/call` path, governance, and audit.",
  "`agentSession`",
  "Existing visible pane/session lifecycle runtime; headless only for planner/reviewer/batch.",
  "`http`",
  "Bounded request path with secret references and GATED external execution unless read-only.",
  "`manualGate`",
  "Existing auditable decision/gate model; no auto-approval replacement.",
  "`waitFor`",
  "Bounded polling over files/artifacts/MCP results with timeout and interval.",
  "`fanOut`",
  "Existing or mirrored ownership/conflict preflight; overlapping write lanes serialize or reject.",
  "`subProofbook`",
  "Child run ledger with lineage and max-depth enforcement.",
  "`evidence.write` / `evidence.read`",
  "Run ledger and artifact refs first; Evidence Store is only a later projection.",
  "Distillation",
  "Proposed diff plus risk summary only; no automatic source mutation.",
  "IPC/MCP/UI adapters",
  "Delegate to Rust proofbook contracts and runner state; no duplicate source of truth.",
];
const missingAuthorityDelegationClauses = missingFromNormalized(spec, requiredAuthorityDelegationClauses);
const requiredPhaseFailClosedClauses = [
  "PB-1 implementation cannot add a runner or execute a Proofbook.",
  "PB-2 executes only `shell`, `verifier`, `waitFor`, and `manualGate`",
  "MCP, HTTP, agent, fan-out, subProofbook, and distill steps remain explicit `not_implemented`/`unsupported_step_type`.",
  "PB-3 may add runtime MCP tool steps and list/get/validate/run/status/cancel verbs, but create/update/distill stay excluded until PB-6.",
  "PB-6 emits patch proposals only",
  "source Proofbooks are never mutated automatically.",
  "PB-7 keeps raw run ledgers as primary evidence",
  "Evidence Store is a projection only",
];
const missingPhaseFailClosedClauses = missingFromNormalized(spec, requiredPhaseFailClosedClauses);
const requiredPb1dClauses = [
  "### PB-1D - Detailed Design Gate: Schema, Parser, And Validation",
  "PB-1D is a docs/verifier gate only.",
  "It does not create `src-tauri/src/proofbook`, IPC handlers, MCP verbs, a runner, run ledgers, UI, DB tables, or executable Proofbooks.",
  "`src-tauri/src/proofbook/types.rs`",
  "`src-tauri/src/proofbook/errors.rs`",
  "`src-tauri/src/proofbook/parser.rs`",
  "`src-tauri/src/proofbook/validator.rs`",
  "`src-tauri/src/ipc/proofbook_commands.rs`",
  "`runner.rs`, `ledger.rs`, `agent_step.rs`, `settlement.rs`, `distill.rs`,",
  "`src-tauri/src/api/mcp.rs`, frontend UI files, database migrations, external command execution, and any Proofbook run state.",
  "`mod.rs` exports the schema/parser/validator contract and typed errors.",
  "`types.rs` owns serializable schema types:",
  "`errors.rs` owns `ProofbookError`, `ProofbookErrorCode`, and structured error fields.",
  "`parser.rs` owns discovery and YAML parsing from `.aelyris/proofbooks/*.proofbook.yaml`",
  "`validator.rs` owns static validation over parsed definitions",
  "Accepted schema version is exactly `aelyris.proofbook.v1`.",
  "Definition ids and step ids are ASCII slug identifiers:",
  "Step kinds are the planned taxonomy:",
  "Secret values are always references.",
  "Typed error taxonomy:",
  "Every error carries `code`, `message`, optional `definitionId`, optional `stepId`, optional `field`, and optional `path`.",
  "No-runner and fail-closed boundary:",
  "PB-1 cannot create `runId`, write `.aelyris/proofbook-runs`, execute",
  "PB-1 IPC may list definitions and return validation reports only.",
  "Recognized future step types are parseable for static validation but remain non-executable until their owning PB phase.",
  "Focused Rust test matrix for PB-1:",
  "valid minimal `.proofbook.yaml` parses and validates with a stable summary",
  "any PB-1 execution-shaped request fails with `runtime_not_available`",
  "Verifier and artifact expectations:",
  "passing `spec-pb1d-detailed-design` check before PB-1 implementation starts.",
  "cargo test --manifest-path src-tauri\\Cargo.toml proofbook --lib",
  "PB-1D claim boundary:",
  "Proofbook definitions still cannot run",
];
const pb1dErrorCodes = [
  "`invalid_project_path`",
  "`path_outside_project`",
  "`proofbook_dir_missing`",
  "`io_error`",
  "`yaml_parse_error`",
  "`unsupported_schema_version`",
  "`missing_required_field`",
  "`invalid_identifier`",
  "`duplicate_id`",
  "`unknown_step_type`",
  "`missing_dependency`",
  "`cycle_detected`",
  "`missing_settlement`",
  "`invalid_secret_ref`",
  "`runtime_not_available`",
];
const missingPb1dClauses = missingFromNormalized(spec, requiredPb1dClauses);
const missingPb1dErrorCodes = missingFrom(spec, pb1dErrorCodes);
const requiredPb2dClauses = [
  "### PB-2D - Detailed Design Gate: Run Ledger And Deterministic Steps",
  "Status: docs/verifier gate only. PB-2D does not create `runner.rs`,",
  "Runtime implementation for PB-2 is out of scope until this section is present",
  "`spec-pb2d-detailed-design` check.",
  "PB-2D owner scope:",
  "`src-tauri/src/proofbook/runner.rs`",
  "`src-tauri/src/proofbook/ledger.rs`",
  "`src-tauri/src/proofbook/step_shell.rs`",
  "`src-tauri/src/proofbook/step_wait.rs`",
  "`src-tauri/src/proofbook/step_manual_gate.rs`",
  "minimal `src/features/proofbook/` run/status",
  "PB-2 still must not touch `src-tauri/src/api/mcp.rs`",
  "Module ownership:",
  "`runner.rs` owns the run state machine, topological ready queue, cancellation,",
  "`ledger.rs` owns `aelyris.proofbook_run.v1`, atomic JSON persistence,",
  "append-only event records",
  "SHA-256",
  "secret redaction",
  "`step_shell.rs` owns `shell` and `verifier` command execution through the",
  "existing command-risk policy",
  "`step_wait.rs` owns PB-2 `waitFor` over files, expected artifacts, and prior",
  "Polling MCP results is deferred to PB-3D.",
  "`step_manual_gate.rs` owns `manualGate` pause/resume records, expected gate",
  "no-auto-approval boundary",
  "PB-2 run ledger contract:",
  "Every run writes `.aelyris/proofbook-runs/<run-id>.json` before the first step",
  ".aelyris/proofbook-runs/artifacts/<run-id>/",
  "Ledger schema is exactly `aelyris.proofbook_run.v1`.",
  "`definitionHash`, `inputHash`, `events`, `steps`, `artifacts`, `decisions`,",
  "Artifact refs include `path`, `kind`, `sizeBytes`, `sha256`, `redactionCount`,",
  "Hashes are over the redacted persisted bytes.",
  "token-bearing",
  "private keys are never written to ledger or",
  '`error.code="interrupted_by_restart"`',
  "PB-2 state machine:",
  "Run statuses: `pending`, `running`, `waiting_gate`, `passed`, `failed`,",
  "Step statuses: `pending`, `running`, `passed`, `failed`, `skipped`,",
  "deterministic topological ready queue with concurrency `1`.",
  "Cancellation appends a cancellation event",
  "Settlement requires all configured `requiredSteps` to pass",
  "PB-2 executable step scope:",
  "`shell`: executes a local command in a contained cwd only after command-risk",
  "`verifier`: a `shell` specialization",
  "`waitFor`: polls files, expected artifacts, or prior step status with required",
  "`manualGate`: pauses with `gateId`, `gateHash`, options, default, risk, and",
  "Resolve requires the expected `gateHash`; stale or mismatched",
  "Unsupported PB-2 behavior:",
  "`mcpTool`, `agentSession`, `http`, `fanOut`, `subProofbook`,",
  "`evidence.write`, `evidence.read`, create/update, and distill are not",
  '`error.code="not_implemented"`',
  "must never write passed ledger",
  "Non-taxonomy step kinds are still rejected by PB-1 validation as",
  "`unknown_step_type`",
  "PB-2 focused test matrix:",
  "writes the ledger before execution",
  "command-risk GATED command transitions to `waiting_gate` before spawn",
  "rejects stale",
  "unsupported PB-2 step kinds produce `not_implemented` without fake success",
  "converts dead `running` steps to `interrupted_by_restart`",
  "UI tests render Rust runner status only and cannot start executable mock flows.",
  "Verifier and artifact expectations:",
  "PB-2D uses `pnpm verify:proofbook:spec`, which writes",
  "`spec-pb2d-detailed-design` check.",
  "cargo test --manifest-path src-tauri\\Cargo.toml proofbook --lib",
  "`pnpm verify:proofbook:runner`",
  ".codex-auto/quality/proofbook-runner.json",
  "pnpm verify:goal:docs",
  "PB-2D claim boundary:",
  "Proofbooks still cannot run until PB-2 runtime code",
  "limited to local `shell`, `verifier`, `waitFor`, and `manualGate` runs",
  "PB-2D stop conditions:",
  "bypass command-risk policy",
  "raw secrets, token-bearing transcripts, signing material, or private",
  "executable mock flows before Rust runner state",
  "JSON-file ledgers cannot preserve append-only event history with",
];
const missingPb2dClauses = missingFromNormalized(spec, requiredPb2dClauses);
const requiredPb3dClauses = [
  "### PB-3D - Detailed Design Gate: MCP Tool Step And Proofbook MCP Verbs",
  "Status: completed docs/verifier design gate.",
  "PB-3D fixed the MCP integration",
  "`pnpm verify:proofbook:spec` were green.",
  "PB-3 runtime scope is tracked in the",
  "PB-3D owner scope:",
  "`src-tauri/src/api/mcp.rs`",
  "`src-tauri/src/proofbook/runner.rs`",
  "`src-tauri/src/proofbook/ledger.rs` only if existing `structuredOutput`,",
  "`docs/specs/MCP_TOOL_SURFACE_SPEC.md`",
  "PB-3 must not implement Proofbook `create`, `update`, or `distill`",
  "PB-3 must not execute HTTP, agentSession, fanOut, subProofbook, or",
  "Module ownership:",
  "`src-tauri/src/api/mcp.rs` owns the MCP catalog rows, inputSchema definitions,",
  "PB-3 must reuse `tool_names()`, `tools_list()`, `input_schema_for_tool()`,",
  "`validate_tool_arguments()`, `schema_tool_error()`, the governance choke point,",
  "It must not create a second MCP",
  "dispatcher, a second schema validator, or a Proofbook-only catalog.",
  "`src-tauri/src/proofbook/runner.rs` remains the run state-machine owner.",
  "delegates all MCP schema/governance/tool dispatch decisions back through the `mcp.rs`",
  "`src-tauri/src/proofbook/ledger.rs` remains the ledger schema owner.",
  "Any ledger field addition",
  "requires the spec, verifier, and focused tests in the same phase.",
  "PB-3 MCP verb contract:",
  "`aelyris.proofbook.list`",
  "`aelyris.proofbook.get`",
  "`aelyris.proofbook.validate`",
  "`aelyris.proofbook.run`",
  "`aelyris.proofbook.status`",
  "`aelyris.proofbook.cancel`",
  "`aelyris.proofbook.approve_gate`",
  "`aelyris.proofbook.reject_gate`",
  "All PB-3 verbs must use `additionalProperties:false` inputSchema objects",
  "`catalog_and_schemas_list_exactly_the_same_verbs` catches drift.",
  "The MCP face",
  "may retrieve the managed runner through the Tauri `AppHandle` already stored in",
  "sidecar/test modes with no attached runtime fail closed",
  "PB-3 `mcpTool` step contract:",
  "`type: mcpTool`, `toolName`, and `arguments` object",
  "mcp_tool_not_found",
  "`mcpTool` may not target `aelyris.proofbook.*` verbs in PB-3.",
  "proofbook_mcp_recursion_not_supported",
  "error.code=\"mcp_schema_violation\"",
  "machine-correctable `schema_violation` payload",
  "error.code=\"mcp_governance_denied\"",
  "GATED tools do not fake success.",
  "`kind:\"mcpTool\"`, `toolName`, `safety`, `gateId`, `gateHash`,",
  "`argumentsHash`, and `pendingDecisionId`",
  "PB-3 pending decision shape:",
  "`gateHash`: hash over `runId`, `stepId`, `toolName`, canonicalized",
  "PB-3 restart/replay behavior:",
  "Waiting `mcpTool` gates stay `waiting_gate` after hydration",
  "no MCP tool is re-dispatched automatically on restart.",
  "PB-3 focused test matrix:",
  "excludes `aelyris.proofbook.create`, `aelyris.proofbook.update`, and",
  "`aelyris.proofbook.distill`",
  "malformed Proofbook MCP calls return the existing structured",
  "governance denial blocks a Proofbook MCP verb before runner code executes",
  "recursive `aelyris.proofbook.*` `mcpTool` targets fail",
  "Verifier and artifact expectations:",
  "PB-3 implementation must pass `cargo test --manifest-path src-tauri\\Cargo.toml",
  "mcp --lib`",
  "cargo test --manifest-path src-tauri\\Cargo.toml proofbook",
  "PB-3 docs changes must keep `pnpm verify:goal:docs` green.",
  "PB-3D claim boundary:",
  "After PB-3D, the safe claim was that the MCP integration design gate was",
  "After PB-3 runtime work, the safe claim remains",
  "PB-3 MCP integration slice may expose",
  "Create/update/distill, HTTP,",
  "flows remain future PB phases.",
  "PB-3D stop conditions:",
  "bypass `tools_call` inputSchema validation, governance, or",
  "second MCP dispatcher, Proofbook-only catalog, or duplicate schema",
  "cannot reach the managed `ProofbookRunner` without a new",
  "GATED MCP tool would need to be recorded as passed before",
  "Proofbook can call `aelyris.proofbook.*` recursively",
];
const missingPb3dClauses = missingFromNormalized(spec, requiredPb3dClauses);
const requiredPb4dClauses = [
  "### PB-4D - Detailed Design Gate: Agent Session Step",
  "Status: docs/verifier gate only.",
  "PB-4D defines the agentSession runtime",
  "`spec-pb4d-detailed-design` verifier check are green.",
  "PB-4D owner scope:",
  "`src-tauri/src/proofbook/agent_step.rs`",
  "`src-tauri/src/proofbook/runner.rs`",
  "`src-tauri/src/proofbook/ledger.rs` only if existing session, pane, worktree,",
  "minimal `src/features/proofbook/` run/status UI proof surface.",
  "`docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` if PB-4 changes the",
  "PB-4 must not implement HTTP, fanOut, subProofbook, distill, Evidence Store,",
  "PB-4 must not add a second",
  "agent dispatcher, a second session lifecycle owner, or frontend-only executable",
  "Module ownership:",
  "`agent_step.rs` owns the `agentSession` step adapter over the existing visible",
  "must call the same spawn/session lifecycle",
  "`runner.rs` remains the deterministic run state-machine owner.",
  "`ledger.rs` remains the proof schema owner.",
  "`src/features/proofbook/` may render run status, session links, pane links,",
  "must not synthesize",
  "PB-4 visible-vs-headless policy:",
  "`agentSession` for implementation roles defaults to a visible PTY pane.",
  "Visible agent paths must use the interactive TUI",
  "must not add `-p` or",
  "`--print`.",
  "Headless mode is allowed only for planner, reviewer, or batch roles",
  "headless implementation work fails",
  "agent_session_headless_not_allowed",
  "PB-4 `agentSession` step schema:",
  "Required fields: `type: agentSession`, `id`, `task`, and either `role` or",
  "Optional fields: `provider`, `model`, `repoPath`, `branch`, `worktreePath`,",
  "agent_session_invalid_config",
  "PB-4 pane/session/worktree linkage:",
  "The ledger records `sessionId`, `paneId`, `ptyId`, `backend`, `provider`,",
  "`worktreeBranch`, and",
  "agent_session_identity_mismatch",
  "PB-4 lifecycle artifact refs:",
  "summary, checkpoint, handoff, resume,",
  "agent_session_interrupted_by_restart",
  "First-file-exists is",
  "not enough for an `agentSession` pass.",
  "PB-4 cost/token handling:",
  "costTokensStatus:\"unknown\"",
  "agent_session_cost_unknown",
  "PB-4 stop/error semantics:",
  "Spawn failure, missing runtime, denied policy, invalid config, identity",
  "Operator cancellation appends a cancellation event",
  "PB-4 focused test matrix:",
  "implementation role defaults to visible PTY and rejects `-p` / `--print`",
  "planner/reviewer/batch may be headless only with a recorded",
  "UI tests render Rust runner session state and cannot start executable mock",
  "Verifier and artifact expectations:",
  "PB-4D uses `pnpm verify:proofbook:spec`, which writes",
  "`spec-pb4d-detailed-design` check.",
  "`pnpm verify:proofbook:agent-session`",
  "cargo test --manifest-path src-tauri\\Cargo.toml",
  "proofbook --lib",
  "`pnpm verify:goal:docs`",
  "PB-4D claim boundary:",
  "After PB-4D, the safe claim is only that the agentSession design gate is",
  "Proofbook agent",
  "execution until the PB-4 runtime slice",
  "PB-4D stop conditions:",
  "add `-p` / `--print` to visible agent panes",
  "Proofbook-only agent launcher",
  "frontend-only state",
  "cost/token caps require estimates",
  "raw prompt transcripts, token-bearing output, signing material, or",
];
const missingPb4dClauses = missingFromNormalized(spec, requiredPb4dClauses);
const requiredPb3dMcpSurfaceClauses = [
  "### 3.8 Proofbook domain (PB-3 runtime slice)",
  "Rows in this section describe the scoped PB-3 runtime slice",
  "not a shipped",
  "create/update/distill",
  "existing `tools/call` schema/governance/dispatch path",
  "They do not create a",
  "second dispatcher, a second catalog, or a Proofbook-only schema validator.",
  "`aelyris.proofbook.list`",
  "`aelyris.proofbook.get`",
  "`aelyris.proofbook.validate`",
  "`aelyris.proofbook.run`",
  "`aelyris.proofbook.status`",
  "`aelyris.proofbook.cancel`",
  "`aelyris.proofbook.approve_gate`",
  "`aelyris.proofbook.reject_gate`",
  "PB-3 deliberately excludes `aelyris.proofbook.create`,",
  "`aelyris.proofbook.update`, and `aelyris.proofbook.distill`.",
  "`mcpTool` step semantics:",
  "same inputSchema validator that",
  "guards external `tools/call`",
  "schema_violation",
  "same governance choke point as external MCP",
  "mcp_governance_denied",
  "GATED target tools transition the Proofbook run to `waiting_gate`",
  "`kind:\"mcpTool\"`, `toolName`, `safety`,",
  "`gateId`, `gateHash`, `argumentsHash`, and any `pendingDecisionId`",
  "PB-3 `mcpTool` cannot call `aelyris.proofbook.*`",
  "PB-3 drift tests must prove all Proofbook rows have `additionalProperties:false`",
  "prove the PB-6 mutation verbs are still absent.",
];
const missingPb3dMcpSurfaceClauses = missingFromNormalized(mcpToolSurface, requiredPb3dMcpSurfaceClauses);
const requiredPb1dIntegrationClauses = [
  "`docs/specs/PROOFBOOK_PB1_DETAILED_DESIGN.md` is the PB-1 implementation blueprint.",
  "For PB-1 implementation conflicts, `PROOFBOOK_PB1_DETAILED_DESIGN.md` wins inside the PB-1 file scope and focused test matrix.",
  "`PROOFBOOK_AUTOMATION_SPEC.md` remains the authority for product requirements, phase roadmap, claim boundary, and PB-2+ behavior.",
  "Any change to PB-1 implementation scope must update this spec, the detailed design, and `scripts/verify-proofbook-spec.mjs` in the same phase.",
];
const missingPb1dIntegrationClauses = missingFromNormalized(spec, requiredPb1dIntegrationClauses);
const requiredPb1dBlueprintClauses = [
  "Source-of-truth precedence:",
  "`PROOFBOOK_AUTOMATION_SPEC.md` remains the parent authority for product requirements, Scape differentiation, phase roadmap, claim boundary, and PB-2+ behavior.",
  "`PROOFBOOK_PB1_DETAILED_DESIGN.md` is the authority for PB-1 implementation details within the file scope, wiring, error taxonomy, and focused test matrix documented here.",
  "If the two documents conflict inside PB-1 implementation scope, update both documents and `scripts/verify-proofbook-spec.mjs` in the same phase before coding.",
  "Status: **design gate only",
  "Companion to (does not replace) `PROOFBOOK_AUTOMATION_SPEC.md`.",
  "ProofbookError は thiserror + Serialize",
  "schema struct は rename_all=camelCase",
  "step.kind は String で保持し validator で from_wire 解決して unknown_step_type を出す。",
  "runner/ledger/MCP/UI/.manage は作らない。",
];
const missingPb1dBlueprintClauses = missingFromNormalized(pb1DetailedDesign, requiredPb1dBlueprintClauses);
const requiredPb1dIndexClauses = [
  "[PROOFBOOK_PB1_DETAILED_DESIGN.md](./PROOFBOOK_PB1_DETAILED_DESIGN.md)",
  "PB-1 implementation blueprint",
  "PB-1 schema/parser/validator + list/validate IPC",
  "Proofbooks 実装済みclaimではない",
];
const missingPb1dIndexClauses = missingFromNormalized(specIndex, requiredPb1dIndexClauses);
const goalPacketsWithoutDesignGate = roadmapIds
  .filter((id) => id !== "PB-0")
  .filter((id) => {
    const phaseNumber = id.slice(3);
    const section =
      spec.match(new RegExp(`### ${id} \`/goal\`([\\s\\S]*?)(?=\\n### PB-\\d+ \`/goal\`|\\n## \\d+\\.|$)`))?.[1] ?? "";
    return !section.includes(`PB-${phaseNumber}D detailed design gate`) || !section.includes("green");
  });
const requiredSafetyClauses = [
  "Proofbooks must not introduce a second authority path.",
  "MCP steps use the MCP governance choke point.",
  "Terminal/agent input steps use the existing command-risk policy.",
  "Secrets are references, not values.",
  "Ledger output must redact known token patterns and secret values before persistence.",
  "manualGate` decisions are append-only and auditable.",
  "Fan-out cannot bypass ownership/conflict checks.",
];
const missingSafetyClauses = missingFromNormalized(spec, requiredSafetyClauses);

const forbiddenImplementedClaims = [
  /\bProofbooks?\s+(?:are|is)\s+(?:implemented|shipped|available|complete|release-ready)\b/i,
  /\bProofbook\s+(?:schema|runner|canvas|distillation|MCP verbs?)\s+(?:is|are)\s+(?:implemented|shipped|complete)\b/i,
  /\bimplemented\s+Proofbooks?\b/i,
  /\bshipped\s+Proofbooks?\b/i,
];
const claimScanSources = [
  paths.spec,
  paths.specIndex,
  "README.md",
  "docs/README.md",
  "docs/PUBLICATION_READINESS.md",
  "docs/requirements.md",
].map((path) => ({ path, text: readText(path) }));
const implementedClaimHits = [];
for (const { path, text } of claimScanSources) {
  for (const pattern of forbiddenImplementedClaims) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(globalPattern)) {
      const lineStart = text.lastIndexOf("\n", match.index ?? 0) + 1;
      const lineEnd = text.indexOf("\n", match.index ?? 0);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const prefix = line.slice(0, Math.max(0, (match.index ?? 0) - lineStart));
      if (/\b(?:do not claim|no product claim says|not claim)\b/i.test(prefix)) continue;
      if (line.includes("before PB gates exist")) continue;
      implementedClaimHits.push({
        path,
        pattern: pattern.toString(),
        match: match[0],
      });
    }
  }
}

const checks = [
  check(
    "pb0-files-exist",
    existsSync(fullPath(paths.spec)) &&
      existsSync(fullPath(paths.specIndex)) &&
      existsSync(fullPath(paths.packageJson)),
    "PB-0 authority files exist",
    { paths },
  ),
  check(
    "spec-claim-boundary",
    includesAll(normalizedSpec, [
      "Status: proposal / implementation roadmap with scoped PB runtime slices. Not a shipped capability.",
      "## 0. Claim Boundary",
      "Do not claim Proofbooks as implemented until the matching verifier is green.",
      "PB-1 static Proofbook schema/parser/validator plus read-only list/validate IPC,",
      "PB-2 local backend runner/ledger for `shell`, `verifier`, `waitFor`, and",
      "PB-3 MCP integration slice",
      "not a shipped end-user Proofbook",
      "Proofbook canvas, create/update/distill",
    ]),
    "Proofbook spec keeps the proposal/not-shipped claim boundary explicit",
  ),
  check(
    "spec-step-taxonomy",
    missingStepTypes.length === 0 && spec.includes("## 5. Step Types"),
    "Proofbook spec defines the required step taxonomy",
    { missingStepTypes },
  ),
  check(
    "spec-safety-governance",
    missingSafetyClauses.length === 0 && spec.includes("## 7. Safety And Governance"),
    "Proofbook spec ties execution to existing governance, audit, redaction, and ownership safety",
    { missingSafetyClauses },
  ),
  check(
    "spec-mcp-verbs",
    missingMcpVerbs.length === 0 && spec.includes("## 8. MCP Face"),
    "Proofbook spec lists the planned MCP verbs without making them PB-0 implementation claims",
    { missingMcpVerbs },
  ),
  check(
    "spec-roadmap",
    missingRoadmapSections.length === 0 && spec.includes("## 11. Roadmap"),
    "Proofbook spec has PB-0 through PB-7 roadmap sections",
    { missingRoadmapSections },
  ),
  check(
    "spec-design-first-development-method",
    missingDevelopmentMethodClauses.length === 0 && missingDetailedDesignIds.length === 0,
    "Proofbook spec requires contract-first PB-ND detailed design gates before PB-1 through PB-7 implementation",
    { missingDevelopmentMethodClauses, missingDetailedDesignIds },
  ),
  check(
    "spec-authority-delegation-matrix",
    missingAuthorityDelegationClauses.length === 0,
    "Proofbook spec maps each step/surface to an existing Aelyris authority path instead of a parallel stack",
    { missingAuthorityDelegationClauses },
  ),
  check(
    "spec-phase-fail-closed-contract",
    missingPhaseFailClosedClauses.length === 0,
    "Proofbook roadmap keeps unsupported future behavior fail-closed and prevents fake success across PB-1 through PB-7",
    { missingPhaseFailClosedClauses },
  ),
  check(
    "spec-pb1d-detailed-design",
    missingPb1dClauses.length === 0 && missingPb1dErrorCodes.length === 0,
    "Proofbook spec defines PB-1D schema/parser/validator ownership, typed errors, no-runner boundary, test matrix, verifier artifact, and claim boundary before PB-1 runtime code",
    { missingPb1dClauses, missingPb1dErrorCodes },
  ),
  check(
    "spec-pb2d-detailed-design",
    missingPb2dClauses.length === 0,
    "Proofbook spec defines PB-2D runner/ledger/manualGate/waitFor/static-step design, fail-closed unsupported behavior, artifact hashing/redaction, test matrix, verifier artifact, and claim boundary before PB-2 runtime code",
    { missingPb2dClauses },
  ),
  check(
    "spec-pb3d-detailed-design",
    missingPb3dClauses.length === 0 && missingPb3dMcpSurfaceClauses.length === 0,
    "Proofbook spec and MCP surface define the PB-3D MCP tool-step contract and the bounded PB-3 runtime slice without claiming a shipped Proofbook product",
    { missingPb3dClauses, missingPb3dMcpSurfaceClauses },
  ),
  check(
    "spec-pb4d-detailed-design",
    missingPb4dClauses.length === 0,
    "Proofbook spec defines PB-4D agentSession ownership, visible-vs-headless policy, pane/session/worktree linkage, lifecycle artifacts, cost/token unknown handling, stop/error semantics, UI proof surface, test matrix, verifier artifact, and claim boundary before PB-4 runtime code",
    { missingPb4dClauses },
  ),
  check(
    "spec-pb1d-blueprint-integrated",
    existsSync(fullPath(paths.pb1DetailedDesign)) &&
      missingPb1dIntegrationClauses.length === 0 &&
      missingPb1dBlueprintClauses.length === 0 &&
      missingPb1dIndexClauses.length === 0,
    "Proofbook PB-1 detailed design is explicitly integrated as the PB-1 implementation blueprint without replacing the parent automation spec",
    { missingPb1dIntegrationClauses, missingPb1dBlueprintClauses, missingPb1dIndexClauses },
  ),
  check(
    "spec-goal-packets",
    missingGoalPackets.length === 0 &&
      goalPacketsWithoutDesignGate.length === 0 &&
      spec.includes("## 12. Pasteable `/goal` Packets"),
    "Proofbook spec includes pasteable /goal packets for each roadmap phase and routes PB-1 through PB-7 through PB-ND detailed design gates first",
    { missingGoalPackets, goalPacketsWithoutDesignGate },
  ),
  check(
    "spec-indexed-as-proposal",
    includesAll(specIndex, [
      "[PROOFBOOK_AUTOMATION_SPEC.md](./PROOFBOOK_AUTOMATION_SPEC.md)",
      "proposal / automation roadmap",
      "PB-2 local backend runner/ledger",
      "PB-3 MCP integration slice",
      "未実装の設計 target",
      "Proofbooks 全体の実装済みclaimではない",
    ]),
    "spec index lists Proofbooks as a scoped implementation roadmap, not a shipped capability",
  ),
  check(
    "package-script-present",
    packageJson.includes('"verify:proofbook:spec": "node scripts/verify-proofbook-spec.mjs"'),
    "package.json exposes pnpm verify:proofbook:spec",
  ),
  check(
    "no-implemented-product-claim",
    implementedClaimHits.length === 0 &&
      normalizedSpec.includes("Proofbook automation design proposal") &&
      normalizedSpec.includes("not a shipped end-user Proofbook") &&
      normalizedSpec.includes("PB-3 MCP integration slice") &&
      normalizedSpec.includes("Proofbook UI, create/update/distill") &&
      normalizedIndex.includes("Proofbooks 全体の実装済みclaimではない"),
    "public docs distinguish the PB-2/PB-3 runtime slices from a shipped Proofbook product",
    { implementedClaimHits },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.proofbook-spec/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-proofbook-spec-contract" : "fail-proofbook-spec-contract",
  generatedAt: new Date().toISOString(),
  sourcePaths: [
    paths.spec,
    paths.pb1DetailedDesign,
    paths.mcpToolSurface,
    paths.specIndex,
    paths.packageJson,
    "scripts/verify-proofbook-spec.mjs",
  ],
  sourceCutoffMs: Math.max(
    mtime(paths.spec),
    mtime(paths.pb1DetailedDesign),
    mtime(paths.mcpToolSurface),
    mtime(paths.specIndex),
    mtime(paths.packageJson),
    mtime("scripts/verify-proofbook-spec.mjs"),
  ),
  summary:
    failed.length === 0
      ? "Proofbook spec/index/MCP/package contract is present and keeps the PB-2 backend slice plus PB-3 MCP runtime slice distinct from a shipped Proofbook product."
      : `${failed.length} Proofbook PB-0 contract checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
