import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance, validateEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const read = (path) => readFileSync(join(root, path), "utf8");

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`unmatched brace at offset ${openIndex}`);
}

function bracedBodyAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`missing marker: ${marker}`);
  const openIndex = source.indexOf("{", markerIndex + marker.length);
  if (openIndex < 0) throw new Error(`missing body for: ${marker}`);
  return source.slice(openIndex + 1, findMatchingBrace(source, openIndex));
}

const snakeCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
const camelCase = (value) => value.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
const sortedUnique = (values) => [...new Set(values)].sort();
const exactSet = (actual, expected) =>
  actual.length === new Set(actual).size && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

function rustTaggedEnumContract(source, name) {
  const body = bracedBodyAfter(source, `pub enum ${name}`);
  const contract = new Map();
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const variant = lines[index].match(/^ {4}([A-Z][A-Za-z0-9_]*)\s*(,|\{)\s*$/);
    if (!variant) continue;
    const fields = [];
    if (variant[2] === "{") {
      index += 1;
      while (index < lines.length && !/^ {4}},\s*$/.test(lines[index])) {
        const field = lines[index].match(/^ {8}([a-z_][a-z0-9_]*):/);
        if (field) fields.push(field[1]);
        index += 1;
      }
    }
    contract.set(snakeCase(variant[1]), sortedUnique(fields));
  }
  return contract;
}

function tsTaggedUnionContract(source, name) {
  const marker = `export type ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing TS union: ${name}`);
  const end = source.indexOf("\nexport ", start + marker.length);
  const body = source.slice(start + marker.length, end < 0 ? source.length : end);
  const contract = new Map();
  const variantPattern = /\|\s*\{/g;
  for (const match of body.matchAll(variantPattern)) {
    const openIndex = match.index + match[0].lastIndexOf("{");
    const objectBody = body.slice(openIndex + 1, findMatchingBrace(body, openIndex));
    const code = objectBody.match(/\bcode:\s*"([^"]+)"/)?.[1];
    if (!code) throw new Error(`missing code in TS ${name} variant`);
    const fields = [...objectBody.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
      .map((field) => field[1])
      .filter((field) => field !== "code");
    if (contract.has(code)) throw new Error(`duplicate TS ${name} code: ${code}`);
    contract.set(code, sortedUnique(fields));
  }
  return contract;
}

function exactTaggedContract(left, right) {
  if (!exactSet([...left.keys()], [...right.keys()])) return false;
  return [...left].every(([code, fields]) => exactSet(fields, right.get(code) ?? []));
}

function rustStructWireFields(source, name) {
  const body = bracedBodyAfter(source, `pub struct ${name}`);
  return [...body.matchAll(/^\s*pub\s+([a-z_][a-z0-9_]*)\s*:/gm)].map((field) => camelCase(field[1]));
}

function tsInterfaceShape(source, name) {
  const marker = `export interface ${name}`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`missing TS interface: ${name}`);
  const openIndex = source.indexOf("{", markerIndex + marker.length);
  const body = source.slice(openIndex + 1, findMatchingBrace(source, openIndex));
  const fields = [];
  const optional = [];
  for (const match of body.matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:/gm)) {
    fields.push(match[1]);
    if (match[2]) optional.push(match[1]);
  }
  return { fields, optional };
}

function tsConstStringArray(source, name) {
  const marker = `export const ${name} = [`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing TS const array: ${name}`);
  const end = source.indexOf("] as const", start + marker.length);
  if (end < 0) throw new Error(`unterminated TS const array: ${name}`);
  return [...source.slice(start + marker.length, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function topLevelQuotedKeys(source, openIndex) {
  const endIndex = findMatchingBrace(source, openIndex);
  const keys = [];
  let depth = 1;
  let quoteStart = -1;
  let escaped = false;
  for (let index = openIndex + 1; index < endIndex; index += 1) {
    const char = source[index];
    if (quoteStart >= 0) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        const value = source.slice(quoteStart, index);
        quoteStart = -1;
        if (depth === 1) {
          let cursor = index + 1;
          while (/\s/.test(source[cursor])) cursor += 1;
          if (source[cursor] === ":") keys.push(value);
        }
      }
      continue;
    }
    if (char === '"') {
      quoteStart = index + 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
  }
  return keys;
}
const state = read("src-tauri/src/startup_reconciliation.rs");
const lib = read("src-tauri/src/lib.rs");
const terminal = read("src-tauri/src/ipc/commands.rs");
const interactive = read("src-tauri/src/ipc/interactive_commands.rs");
const ptyManager = read("src-tauri/src/pty/manager.rs");
const migrations = read("src-tauri/src/db/migrations.rs");
const queries = read("src-tauri/src/db/queries.rs");
const checkpointRepo = read("src-tauri/src/persistence/session_checkpoint_repo.rs");
const interactiveManager = read("src-tauri/src/agent/interactive.rs");
const lifecycle = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const durableFile = read("src-tauri/src/durable_file.rs");
const settings = read("src-tauri/src/config/settings.rs");
const muxStore = read("src-tauri/src/mux/store.rs");
const workflow = read("src-tauri/src/workflow/executor.rs");
const proofbookLedger = read("src-tauri/src/proofbook/ledger.rs");
const contextManager = read("src-tauri/src/context_store/manager.rs");
const taskManager = read("src-tauri/src/task/manager.rs");
const taskGraph = read("src-tauri/src/task/graph.rs");
const executionTypes = read("src-tauri/src/task/execution.rs");
const workExecutionRepo = read("src-tauri/src/persistence/work_execution_repo.rs");
const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const ownershipRepo = read("src-tauri/src/persistence/ownership_repo.rs");
const eventBus = read("src-tauri/src/event_bus/manager.rs");
const eventTypes = read("src-tauri/src/event_bus/mod.rs");
const eventRepo = read("src-tauri/src/persistence/event_repo.rs");
const eventCommands = read("src-tauri/src/ipc/event_commands.rs");
const contextCommands = read("src-tauri/src/ipc/context_commands.rs");
const mcp = read("src-tauri/src/api/mcp.rs");
const eventTypesTs = read("src/shared/types/eventBus.ts");
const mcpSpec = read("docs/specs/MCP_TOOL_SURFACE_SPEC.md");
const hardeningReadme = read("docs/hardening/00_README.md");
const hardeningSpec = read("docs/hardening/02_SPEC.md");
const remediationPlan = read("docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md");
const packageJson = JSON.parse(read("package.json"));
const acceptancePath = join(root, ".codex-auto", "quality", "a4-durability-acceptance.json");
const acceptance = existsSync(acceptancePath) ? JSON.parse(readFileSync(acceptancePath, "utf8")) : null;
const acceptanceProvenance = acceptance
  ? validateEvidenceProvenance({ root, artifact: acceptance })
  : { ok: false, errors: ["missing-acceptance-artifact"] };

const expectedEventTools = [
  "aelyris.event.recent",
  "aelyris.event.by_channel",
  "aelyris.event.since",
  "aelyris.event.poll",
  "aelyris.event.ack",
];
const expectedStructuredErrorTools = ["aelyris.event.since", "aelyris.event.poll", "aelyris.event.ack"];
const expectedV3EventTriggers = [
  "trg_agent_events_identity_required",
  "trg_agent_events_immutable",
  "trg_agent_events_no_delete",
  "trg_agent_events_advance_high_water",
  "trg_event_stream_state_no_delete",
  "trg_event_stream_state_monotonic",
  "trg_event_consumer_cursor_insert_valid",
  "trg_event_consumer_cursor_identity_immutable",
  "trg_event_consumer_cursor_monotonic",
  "trg_event_consumer_cursor_binding_valid",
  "trg_event_consumer_cursor_no_delete",
];

const rustEventErrors = rustTaggedEnumContract(eventTypes, "EventBusError");
const tsEventErrors = tsTaggedUnionContract(eventTypesTs, "EventBusError");
const syntheticRustErrorDrift = rustTaggedEnumContract(
  eventTypes.replace("    AckRegression {", "    SyntheticVerifierDrift,\n    AckRegression {"),
  "EventBusError",
);
const syntheticTsErrorDrift = tsTaggedUnionContract(
  eventTypesTs.replace(
    '  | { code: "ack_regression";',
    '  | { code: "synthetic_verifier_drift" }\n  | { code: "ack_regression";',
  ),
  "EventBusError",
);

const expectedCoreWireShapes = {
  AgentEvent: { fields: ["eventId", "kind", "channel", "payload"], optional: ["payload"] },
  EventBatch: { fields: ["afterSeq", "events", "status"], optional: [] },
  AckReceipt: { fields: ["consumerId", "ackSeq", "eventId", "alreadyAcked"], optional: [] },
};
const coreWireShapesExact = Object.entries(expectedCoreWireShapes).every(([name, expected]) => {
  const rustFields = rustStructWireFields(eventTypes, name);
  const tsShape = tsInterfaceShape(eventTypesTs, name);
  return (
    exactSet(rustFields, expected.fields) &&
    exactSet(tsShape.fields, expected.fields) &&
    exactSet(tsShape.optional, expected.optional)
  );
});
const seqEventShapeExact =
  exactSet(rustStructWireFields(eventTypes, "SeqEvent"), ["seq", "event"]) &&
  eventTypes.includes("#[serde(flatten)]\n    pub event: AgentEvent") &&
  eventTypesTs.includes("export interface SeqEvent extends AgentEvent") &&
  exactSet(tsInterfaceShape(eventTypesTs, "SeqEvent").fields, ["seq"]);

const envelopeFunction = mcp.slice(
  mcp.indexOf("fn event_bus_error_response("),
  mcp.indexOf("pub(super) async fn tools_call("),
);
const envelopeMacro = envelopeFunction.indexOf("serde_json::json!({");
const envelopeOpen = envelopeFunction.indexOf("{", envelopeMacro);
const envelopeErrorKey = envelopeFunction.indexOf('"error":', envelopeOpen);
const envelopeErrorOpen = envelopeFunction.indexOf("{", envelopeErrorKey);
const envelopeOuterFields = topLevelQuotedKeys(envelopeFunction, envelopeOpen);
const envelopeErrorFields = topLevelQuotedKeys(envelopeFunction, envelopeErrorOpen);
const tsMcpErrorShape = tsInterfaceShape(eventTypesTs, "EventBusMcpError");
const tsMcpFailureShape = tsInterfaceShape(eventTypesTs, "EventBusMcpFailure");

const catalogBody = mcp.slice(mcp.indexOf("fn build_tools_list_value()"), mcp.indexOf("fn tools_list_value()"));
const catalogEventTools = [...catalogBody.matchAll(/"name":\s*"(aelyris\.event\.[a-z_]+)"/g)].map((match) => match[1]);
const toolsCallBody = mcp.slice(
  mcp.indexOf("pub(super) async fn tools_call("),
  mcp.indexOf("pub(super) async fn mcp_rpc("),
);
const structuredErrorCallTools = [
  ...toolsCallBody.matchAll(/event_bus_error_response\(\s*"(aelyris\.event\.[a-z_]+)"/g),
].map((match) => match[1]);
const tsEventTools = tsConstStringArray(eventTypesTs, "EVENT_BUS_MCP_TOOLS");
const tsStructuredErrorTools = tsConstStringArray(eventTypesTs, "EVENT_BUS_STRUCTURED_ERROR_TOOLS");
const eventSpecStart = mcpSpec.indexOf("### 3.7.1 Event Bus domain (A4.8 durable delivery)");
const eventSpecEnd = mcpSpec.indexOf("\n---", eventSpecStart);
const eventSpec = mcpSpec.slice(eventSpecStart, eventSpecEnd);
const documentedEventTools = [...eventSpec.matchAll(/^\| `(aelyris\.event\.[a-z_]+)`/gm)].map((match) => match[1]);
const structuredErrorParagraphStart = eventSpec.indexOf("The durable `aelyris.event.since`");
const documentedStructuredErrorTools = [
  ...eventSpec
    .slice(structuredErrorParagraphStart, eventSpec.indexOf("operations use the same", structuredErrorParagraphStart))
    .matchAll(/`(aelyris\.event\.[a-z_]+)`/g),
].map((match) => match[1]);
const eventErrorSampleStart = eventSpec.indexOf("```json") + "```json".length;
const eventErrorSampleEnd = eventSpec.indexOf("```", eventErrorSampleStart);
const documentedEventErrorSample = JSON.parse(eventSpec.slice(eventErrorSampleStart, eventErrorSampleEnd));

const v3Start = migrations.indexOf('const V3_SCHEMA: &str = "');
const v3End = migrations.indexOf('";\n\nconst V4_SCHEMA', v3Start);
const v3Schema = migrations.slice(v3Start, v3End);
const actualV3EventTriggers = [...v3Schema.matchAll(/CREATE TRIGGER (trg_[a-z0-9_]+)/g)].map((match) => match[1]);
const hardeningV3Start = hardeningSpec.indexOf("-- A4.8 migration v3");
const hardeningV3End = hardeningSpec.indexOf("```", hardeningV3Start);
const hardeningV3 = hardeningSpec.slice(hardeningV3Start, hardeningV3End);
const documentedV3EventTriggers = [...hardeningV3.matchAll(/^-- {3}(trg_[a-z0-9_]+)\r?$/gm)].map((match) => match[1]);

const adoption = lib.indexOf("ipc::adopt_sidecar_terminals");
const restore = lib.indexOf("ipc::restore_interactive_sessions");
const reconcile = lib.indexOf("ipc::reconcile_session_handoffs_on_boot");
const ready = lib.indexOf("state.complete(adopted, restored, reconciled)");

const checks = {
  numberedSchemaVersion:
    migrations.includes("CURRENT_SCHEMA_VERSION: i64 = 4") &&
    migrations.includes('pragma_update(None, "user_version", 1)') &&
    migrations.includes('pragma_update(None, "user_version", 2)') &&
    migrations.includes('pragma_update(None, "user_version", 3)') &&
    migrations.includes('pragma_update(None, "user_version", 4)') &&
    migrations.includes('execute_batch("BEGIN IMMEDIATE")') &&
    migrations.includes('execute_batch("ROLLBACK")'),
  newerSchemaFailsClosed:
    migrations.includes("version > CURRENT_SCHEMA_VERSION") &&
    migrations.includes("newer_schema_is_rejected_without_mutation"),
  legacyBackupBeforeMigration:
    queries.includes("create_pre_migration_backup(&conn, path)?") &&
    queries.includes('query_row("PRAGMA quick_check"') &&
    queries.includes('conn.execute("VACUUM INTO ?1"') &&
    queries.includes("file_open_backs_up_legacy_schema_once_before_versioned_migration"),
  typedStartupOwner:
    state.includes("pub enum StartupReconciliationPhase") &&
    state.includes("pub struct StartupReconciliationReport") &&
    state.includes("pub struct StartupReconciliationState"),
  terminalStartupTransitions:
    state.includes("failure_is_terminal_and_cannot_be_overwritten_by_late_success") &&
    state.includes("timeout_fails_only_a_pending_state"),
  boundedStartup: state.includes("STARTUP_RECONCILIATION_TIMEOUT_SECS: u64 = 15") && lib.includes("fail_if_pending()"),
  reconciliationOrder: adoption >= 0 && adoption < restore && restore < reconcile && reconcile < ready,
  databaseReadinessPrecedesCompletion:
    lib.indexOf(".mark_database_ready()") >= 0 &&
    lib.indexOf(".mark_database_ready()") < adoption &&
    state.includes("cannot complete before database readiness"),
  allSpawnFacesFailClosed:
    terminal.match(/require_spawn_admitted\(\)\?/g)?.length >= 2 &&
    interactive.includes("require_spawn_admitted()?") &&
    ptyManager.includes("with_startup_reconciliation") &&
    ptyManager.includes("state.require_spawn_admitted()?") &&
    lib.includes("with_startup_reconciliation(startup_reconciliation.clone())") &&
    state.includes("startup_reconciliation_pending") &&
    state.includes("startup_reconciliation_failed") &&
    state.includes("production_pty_owner_rejects_spawn_before_reconciliation"),
  typedStatusIsPublished:
    terminal.includes("pub fn startup_reconciliation_status") && lib.includes("ipc::startup_reconciliation_status"),
  approvalCheckpointSchema:
    migrations.includes("ALTER TABLE session_checkpoints ADD COLUMN approval_prompt TEXT") &&
    checkpointRepo.includes("pub approval_prompt: Option<String>") &&
    lifecycle.includes("approval_prompt: checkpoint.approval_prompt.clone()") &&
    migrations.includes("version_one_upgrades_to_approval_checkpoint_schema"),
  automaticMutationCheckpointing:
    interactiveManager.includes("attach_checkpoint_db") &&
    checkpointRepo.includes("pub fn append_checkpoint") &&
    interactiveManager.includes("SessionCheckpointRepo::append_checkpoint") &&
    lifecycle.includes("SessionCheckpointRepo::append_checkpoint") &&
    interactiveManager.includes("self.persist_snapshot(&info)?") &&
    interactiveManager.includes("self.persist_snapshot(session)?") &&
    interactiveManager.includes("self.persist_snapshot(&candidate)?") &&
    interactiveManager.includes("durable_mutations_append_identity_status_lineage_and_approval_checkpoints"),
  mutationFailureRollsBack:
    interactiveManager.includes("checkpoint_failure_rolls_back_in_memory_mutation") &&
    interactiveManager.includes("persist interactive session checkpoint") &&
    interactive.includes("close_interactive_pty(&app, &pty_id).await"),
  authoritativeManagersPersistBeforePublish:
    contextManager.includes("DecisionRepo::upsert(database, &key, &value)") &&
    contextManager.indexOf("DecisionRepo::upsert(database, &key, &value)") <
      contextManager.indexOf("Ok(store.set(key, value))") &&
    taskManager.includes("self.persist_graph(&staging)?") &&
    taskManager.indexOf("self.persist_graph(&staging)?") <
      taskManager.indexOf("Self::publish_mutation(&mut state, staging)") &&
    taskGraph.includes("Persistence(String)"),
  authoritativeMutationFailureIsExecuted:
    contextManager.includes("persistence_failure_does_not_publish_a_set_or_remove") &&
    contextManager.includes("production_mode_rejects_mutation_until_durability_is_attached") &&
    taskManager.includes("persistence_failure_does_not_publish_staged_graph_mutation") &&
    taskManager.includes("autonomy_persistence_failure_keeps_prior_graph_and_releases_lease") &&
    taskManager.includes("production_mode_rejects_mutation_until_durability_is_attached"),
  executionAttemptGenerationAndFence:
    migrations.includes("CREATE TABLE work_execution_attempts (") &&
    migrations.includes("trg_work_execution_attempts_identity_immutable") &&
    migrations.includes("trg_work_execution_attempts_merge_intent_one_way") &&
    migrations.includes("trg_work_execution_attempts_no_delete") &&
    executionTypes.includes("pub struct ExecutionIdentity") &&
    executionTypes.includes("pub struct ExecutionToken") &&
    executionTypes.includes("pub enum ExecutionEffect") &&
    workExecutionRepo.includes("Uuid::now_v7()") &&
    workExecutionRepo.includes("load_rejects_non_v7_or_noncanonical_generated_execution_identities") &&
    workExecutionRepo.includes("visible_execution_load_requires_canonical_uuid_v7_pty_identity") &&
    taskManager.includes("pub fn reserve_execution(") &&
    taskManager.includes("crash_boundary_matrix_reloads_each_fence_and_blocks_blind_successor") &&
    loopPorts.includes("execution_reservation_commits_outbox_and_claim_ids_before_first_effect") &&
    loopPorts.includes("stale_full_token_completion_is_quarantined_before_pure_loop_projection") &&
    loopPorts.includes("request_durable_intent(") &&
    loopPorts.includes("ExecutionEffect::Finalization") &&
    ownershipRepo.includes("replace_file_claims_for_task"),
  allFacesPropagateContextPersistenceFailure:
    contextCommands.includes("Result<Option<DecisionChange>, String>") &&
    contextCommands.includes("manager.set(key, value)?") &&
    contextCommands.includes("manager.remove(&key)?") &&
    mcp.includes("store.set(key, value).map_err(ApiError::Internal)?") &&
    mcp.includes("store.remove(&key).map_err(ApiError::Internal)?"),
  productionFallbackCannotAcknowledgeAuthoritativeMutation:
    lib.includes("TaskManager::new_durable()") &&
    lib.includes("ContextStoreManager::new_durable()") &&
    !lib
      .slice(lib.indexOf("if let Ok(mem_db)"), lib.indexOf("// Runtime Hardening P1"))
      .includes("restore_context_store") &&
    !lib.slice(lib.indexOf("if let Ok(mem_db)"), lib.indexOf("// Runtime Hardening P1")).includes("restore_task_graph"),
  eventOutboxCommitsBeforeCache:
    lib.includes("EventBus::new_durable()") &&
    eventBus.includes("EventRepo::append(database, &event)") &&
    eventBus.indexOf("EventRepo::append(database, &event)") <
      eventBus.lastIndexOf("self.lock().publish(event.clone())") &&
    !eventBus.includes("MAX_PENDING") &&
    !eventBus.includes("VecDeque<AgentEvent>") &&
    eventRepo.includes('execute_batch("BEGIN IMMEDIATE")') &&
    eventRepo.includes('execute_batch("COMMIT")') &&
    eventBus.includes("append_failure_is_not_cached_or_acknowledged_across_process_exit"),
  eventIdentityAndDurableConsumerAck:
    v3Schema.includes("ALTER TABLE agent_events ADD COLUMN event_id TEXT;") &&
    v3Schema.includes("CREATE TABLE event_stream_state (") &&
    v3Schema.includes("CREATE TABLE event_consumer_cursors (") &&
    exactSet(actualV3EventTriggers, expectedV3EventTriggers) &&
    eventTypes.includes("pub event_id: String") &&
    eventRepo.includes("pub fn poll_consumer") &&
    eventRepo.includes("pub fn ack(") &&
    eventRepo.includes("consumer_crash_before_and_after_ack_has_at_least_once_truth"),
  eventGapAndCorruptionFailClosed:
    eventTypes.includes("CorruptRow") &&
    eventTypes.includes("StreamInvariant") &&
    eventTypes.includes("CursorOutOfRange") &&
    eventTypes.includes("ConsumerCursorCorrupt") &&
    eventTypes.includes("Gap {") &&
    eventTypes.includes("QueryFailed") &&
    eventRepo.includes("fn inspect_stream") &&
    eventRepo.includes("fn validate_consumer_cursor") &&
    eventRepo.includes("corrupt_row_fails_closed_instead_of_skipping") &&
    eventRepo.includes("corrupt_or_deleted_trailing_row_never_returns_empty_complete") &&
    eventRepo.includes("future_and_identity_corrupt_consumer_cursors_fail_closed") &&
    eventRepo.includes("cursor_bound_event_identity_corruption_fails_closed") &&
    eventRepo.includes("gap_is_typed_and_never_an_apparently_complete_batch") &&
    eventBus.includes("query_failure_and_corrupt_rows_are_typed_non_success"),
  eventProducerAndConsumerAdaptersPropagateTruth:
    eventCommands.includes("pub(crate) fn publish_and_emit") &&
    eventCommands.includes("bus.publish(event.clone())") &&
    eventCommands.includes(".map_err(|error| error.to_string())?") &&
    mcp.includes('"aelyris.event.poll"') &&
    mcp.includes('"aelyris.event.ack"') &&
    mcp.includes('"deliveryContract": "at_least_once"') &&
    mcp.includes("durable_event_consumer_poll_and_ack_use_at_least_once_identity"),
  sessionLifecycleProducerFailureIsNotDiscarded:
    lifecycle.includes("fn publish_session_lifecycle_event(") &&
    lifecycle.includes(") -> Result<(), String>") &&
    lifecycle.includes("aelyris.session-lifecycle-event-failure/v1") &&
    lifecycle.includes('"partialSuccess": true') &&
    lifecycle.includes('"reconciliationRequired": true') &&
    lifecycle.includes("boot_reconciliation_incomplete") &&
    lifecycle.includes("lifecycle_publish_failure_is_structured_partial_success_not_silent_success") &&
    !lifecycle.includes("session lifecycle event was not durably published"),
  eventMcpErrorsStayStructured:
    exactTaggedContract(rustEventErrors, tsEventErrors) &&
    exactSet(envelopeOuterFields, ["schema", "tool", "ok", "error"]) &&
    exactSet(envelopeErrorFields, ["schema", "domain", "retryable", "deliveryContract", "eventBusError"]) &&
    envelopeFunction.includes('"schema": "aelyris.mcp.server.v1"') &&
    envelopeFunction.includes('"tool": tool') &&
    envelopeFunction.includes('"ok": false') &&
    envelopeFunction.includes('"schema": "aelyris.event-bus.error/v1"') &&
    envelopeFunction.includes('"domain": "event_bus"') &&
    envelopeFunction.includes('"deliveryContract": "at_least_once"') &&
    envelopeFunction.includes('"eventBusError": error') &&
    mcp.includes("every_event_bus_error_variant_has_the_stable_structured_mcp_envelope") &&
    mcp.includes("event_tools_preserve_corruption_gap_query_and_ack_mismatch_structure") &&
    mcp.includes("native_mcp_event_error_keeps_matching_text_and_structured_content"),
  eventRustTsWireShapesAreExact:
    coreWireShapesExact &&
    seqEventShapeExact &&
    exactSet(tsMcpErrorShape.fields, ["schema", "domain", "retryable", "deliveryContract", "eventBusError"]) &&
    tsMcpErrorShape.optional.length === 0 &&
    exactSet(tsMcpFailureShape.fields, ["schema", "tool", "ok", "error"]) &&
    tsMcpFailureShape.optional.length === 0,
  eventMcpToolSetsAreExact:
    exactSet(catalogEventTools, expectedEventTools) &&
    exactSet(tsEventTools, expectedEventTools) &&
    exactSet(documentedEventTools, expectedEventTools) &&
    exactSet(sortedUnique(structuredErrorCallTools), expectedStructuredErrorTools) &&
    exactSet(tsStructuredErrorTools, expectedStructuredErrorTools) &&
    exactSet(documentedStructuredErrorTools, expectedStructuredErrorTools),
  eventV3PhysicalMigrationContractIsExact:
    v3Schema.includes("ALTER TABLE agent_events ADD COLUMN event_id TEXT;") &&
    !v3Schema.includes("ALTER TABLE agent_events ADD COLUMN event_id TEXT NOT NULL") &&
    v3Schema.includes("UPDATE agent_events SET event_id = 'legacy:' || seq WHERE event_id IS NULL;") &&
    v3Schema.includes("CREATE UNIQUE INDEX idx_agent_events_event_id ON agent_events(event_id);") &&
    !v3Schema.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_event_id") &&
    v3Schema.includes("CREATE TABLE event_stream_state (") &&
    !v3Schema.includes("CREATE TABLE IF NOT EXISTS event_stream_state") &&
    v3Schema.includes("CREATE TABLE event_consumer_cursors (") &&
    !v3Schema.includes("CREATE TABLE IF NOT EXISTS event_consumer_cursors") &&
    exactSet(actualV3EventTriggers, expectedV3EventTriggers) &&
    hardeningV3.includes("ALTER TABLE agent_events ADD COLUMN event_id TEXT;") &&
    !hardeningV3.includes("event_id     TEXT NOT NULL") &&
    hardeningV3.includes("UPDATE agent_events SET event_id = 'legacy:' || seq WHERE event_id IS NULL;") &&
    hardeningV3.includes("CREATE UNIQUE INDEX idx_agent_events_event_id ON agent_events(event_id);") &&
    !hardeningV3.includes("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_event_id") &&
    hardeningV3.includes("CREATE TABLE event_stream_state (") &&
    !hardeningV3.includes("CREATE TABLE IF NOT EXISTS event_stream_state") &&
    hardeningV3.includes("CREATE TABLE event_consumer_cursors (") &&
    !hardeningV3.includes("CREATE TABLE IF NOT EXISTS event_consumer_cursors") &&
    hardeningV3.includes("SQLite ADD COLUMN is nullable") &&
    hardeningV3.includes("intentionally do not use IF NOT EXISTS") &&
    exactSet(documentedV3EventTriggers, expectedV3EventTriggers),
  eventVerifierParsersRejectSyntheticDrift:
    !exactTaggedContract(syntheticRustErrorDrift, tsEventErrors) &&
    !exactTaggedContract(rustEventErrors, syntheticTsErrorDrift),
  eventFourLayerContractIsSynchronized:
    mcpSpec.includes("### 3.7.1 Event Bus domain (A4.8 durable delivery)") &&
    exactSet(documentedEventTools, expectedEventTools) &&
    exactSet(Object.keys(documentedEventErrorSample), ["schema", "tool", "ok", "error"]) &&
    documentedEventErrorSample.schema === "aelyris.mcp.server.v1" &&
    documentedEventErrorSample.tool === "aelyris.event.since" &&
    documentedEventErrorSample.ok === false &&
    exactSet(Object.keys(documentedEventErrorSample.error), [
      "schema",
      "domain",
      "retryable",
      "deliveryContract",
      "eventBusError",
    ]) &&
    documentedEventErrorSample.error.schema === "aelyris.event-bus.error/v1" &&
    documentedEventErrorSample.error.domain === "event_bus" &&
    documentedEventErrorSample.error.deliveryContract === "at_least_once" &&
    exactSet(documentedV3EventTriggers, expectedV3EventTriggers) &&
    hardeningReadme.includes("process-local pending/retry bufferは存在しない") &&
    !hardeningReadme.includes("pendingは次publishで再試行") &&
    exactTaggedContract(rustEventErrors, tsEventErrors) &&
    coreWireShapesExact &&
    exactSet(tsEventTools, expectedEventTools) &&
    exactSet(tsStructuredErrorTools, expectedStructuredErrorTools) &&
    remediationPlan.includes("### **A4.9** Complete - Durable Execution Attempt And Effect Fence") &&
    remediationPlan.includes("### **A4.10** Active - All-Authority Startup Reconciliation"),
  crashSafeReplacementOwner:
    durableFile.includes("pub fn atomic_write") &&
    durableFile.includes("file.sync_all()") &&
    durableFile.includes("ReplaceFileW") &&
    durableFile.includes("replacement_failure_keeps_last_committed_version") &&
    !workflow.includes("remove_file(&path)") &&
    !proofbookLedger.includes("remove_file(&path)"),
  allFileStoresUseDurabilityOwner:
    settings.includes("crate::durable_file::atomic_write") &&
    muxStore.includes("crate::durable_file::atomic_write") &&
    workflow.includes("crate::durable_file::atomic_write") &&
    proofbookLedger.includes("crate::durable_file::atomic_write") &&
    queries.includes("crate::durable_file::enforce_global_retention"),
  globalRetentionFailsClosed:
    durableFile.includes("pub fn enforce_global_retention") &&
    durableFile.includes("durability quota exceeded") &&
    durableFile.includes("quota_removes_recovery_before_rejecting_primary_data") &&
    durableFile.includes(".pre-migration-v") &&
    durableFile.includes("DEFAULT_DURABILITY_QUOTA_BYTES"),
  fullAcceptanceMatrix:
    packageJson.scripts?.["verify:a4:durability:acceptance"] === "node scripts/verify-a4-durability-acceptance.mjs" &&
    acceptance?.status === "pass-current-a4-durability-evidence" &&
    acceptance?.schema === "aelyris.a4-durability-acceptance/v5" &&
    acceptance?.completedThrough === "A4.9" &&
    acceptance?.repoOwnedComplete === false &&
    acceptance?.phaseComplete === false &&
    acceptance?.scenarios?.length === 21 &&
    acceptance.scenarios.every((scenario) => scenario.status === "pass") &&
    [
      "work-execution-attempt-generation-and-load-integrity",
      "execution-fence-crash-boundaries-and-stale-token",
      "event-outbox-append-query-gap-and-consumer-ack",
      "event-mcp-structured-error-and-catalog-contract",
      "session-lifecycle-event-publish-failure-truth",
      "event-typescript-wire-mirror",
    ].every((id) => acceptance.scenarios.some((scenario) => scenario.id === id)) &&
    acceptance?.externalProof?.codexWatchdogSleepGapStatus === "excluded-non-product-helper" &&
    acceptanceProvenance.ok,
  packageEntryPoint: packageJson.scripts?.["verify:a4:durability"] === "node scripts/verify-a4-durability-contract.mjs",
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failures.length > 0) {
  throw new Error(`A4 durability contract failed: ${failures.join(", ")}`);
}

const generatedAt = new Date().toISOString();
const output = join(root, ".codex-auto", "quality", "a4-durability-contract.json");
const report = {
  schema: "aelyris.a4-durability-contract/v5",
  status: "pass-current-a4-durability-contract",
  activeSlice: "A4.10",
  completedSlice: "A4.9",
  phaseComplete: false,
  remainingSlices: ["A4.10", "A4.11", "A4.12"],
  externalProof: acceptance.externalProof,
  checks,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a4-durability-contract.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "scripts/verify-a4-durability-acceptance.mjs",
      "scripts/verify-session-checkpoint-restore.mjs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/ipc/commands.rs",
      "src-tauri/src/ipc/interactive_commands.rs",
      "src-tauri/src/pty/manager.rs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/db/queries.rs",
      "src-tauri/src/persistence/session_checkpoint_repo.rs",
      "src-tauri/src/agent/interactive.rs",
      "src-tauri/src/context_store/manager.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/task/graph.rs",
      "src-tauri/src/task/execution.rs",
      "src-tauri/src/persistence/work_execution_repo.rs",
      "src-tauri/src/control/loop_ports.rs",
      "src-tauri/src/persistence/ownership_repo.rs",
      "src-tauri/src/event_bus/mod.rs",
      "src-tauri/src/event_bus/manager.rs",
      "src-tauri/src/persistence/event_repo.rs",
      "src-tauri/src/ipc/event_commands.rs",
      "src-tauri/src/ipc/context_commands.rs",
      "src-tauri/src/api/mcp.rs",
      "src-tauri/src/ipc/session_lifecycle_commands.rs",
      "src/shared/types/eventBus.ts",
      "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
      "docs/hardening/00_README.md",
      "docs/hardening/02_SPEC.md",
      "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
      "src-tauri/src/durable_file.rs",
      "src-tauri/src/config/settings.rs",
      "src-tauri/src/mux/store.rs",
      "src-tauri/src/workflow/executor.rs",
      "src-tauri/src/proofbook/ledger.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: output, ...report }, null, 2));
