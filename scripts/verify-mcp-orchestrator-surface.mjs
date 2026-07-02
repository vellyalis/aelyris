import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const qualityDir = path.join(root, ".codex-auto", "quality");
fs.mkdirSync(qualityDir, { recursive: true });

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const api = read("src-tauri/src/api/mod.rs");
const apiMcp = read("src-tauri/src/api/mcp.rs");
const lib = read("src-tauri/src/lib.rs");
const merge = read("src-tauri/src/control/merge.rs");
const gitMod = read("src-tauri/src/git/mod.rs");
const gitMerge = read("src-tauri/src/git/merge.rs");
const ipcCommands = read("src-tauri/src/ipc/commands.rs");
const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const autonomy = read("src-tauri/src/orchestrator/autonomy.rs");
const gateRunner = read("src-tauri/src/control/gate_runner.rs");
const fileOwnership = read("src-tauri/src/file_ownership/mod.rs");
const examHarness = read("src-tauri/src/orchestrator/exam.rs");
const agentClaude = read("src-tauri/src/agent/claude.rs");
const eventBus = read("src-tauri/src/event_bus/mod.rs");
const knowledgeGraph = read("src-tauri/src/knowledge_graph/mod.rs");
const symbolOwnership = read("src-tauri/src/symbol_ownership/mod.rs");
const planner = read("src-tauri/src/task/planner.rs");

const requiredTools = [
  "aelyris.worktree.validate",
  "aelyris.worktree.predictPath",
  "aelyris.worktree.list",
  "aelyris.worktree.create",
  "aelyris.worktree.remove",
  "aelyris.fleet_status",
  "aelyris.route_agent",
  "aelyris.pane_send_input",
  "aelyris.agent_diff",
  "aelyris.request_approval",
  "aelyris.list_pending_approvals",
  "aelyris.request_merge",
  "aelyris.spawn_agent",
  "aelyris.stop_agent",
  "aelyris.review.approve",
  "aelyris.review.reject",
  "aelyris.task.create",
  "aelyris.task.list",
  "aelyris.task.transition",
  "aelyris.orchestrator.plan",
  "aelyris.orchestrator.step",
  "aelyris.supervisor.health",
  "aelyris.event.recent",
  "aelyris.event.by_channel",
  "aelyris.ownership.assign",
  "aelyris.ownership.owner_of",
  "aelyris.ownership.claims",
  "aelyris.ownership.conflicts",
  "aelyris.context.set",
  "aelyris.context.get",
  "aelyris.context.all",
  "aelyris.context.remove",
  "aelyris.agent.report_activity",
  "aelyris.agent.report_blocker",
  "aelyris.agent.activity",
  "aelyris.intent.propose",
  "aelyris.intent.list",
  "aelyris.intent.all",
  "aelyris.intent.resolve",
  "aelyris.knowledge.add_node",
  "aelyris.knowledge.add_edge",
  "aelyris.knowledge.remove_node",
  "aelyris.knowledge.remove_edge",
  "aelyris.knowledge.dependencies",
  "aelyris.knowledge.dependents",
  "aelyris.knowledge.impact",
  "aelyris.knowledge.graph",
];

const checks = [
  {
    id: "required-aelyris-tool-catalog",
    ok: requiredTools.every((tool) => apiMcp.includes(`"${tool}"`)),
    detail: "all aelyris.mcp.v1 orchestration tools are listed",
  },
  {
    id: "no-grant-or-merge-to-main-tools",
    ok:
      !apiMcp.includes('"aelyris.grant_approval"') &&
      !apiMcp.includes('"aelyris.merge_to_main"') &&
      !apiMcp.includes('"grant_approval"') &&
      !apiMcp.includes('"merge_to_main"'),
    detail: "MCP catalog exposes request/observe only for gated operations",
  },
  {
    id: "request-approval-queues-pending",
    ok:
      apiMcp.includes('"aelyris.request_approval"') &&
      apiMcp.includes('kind: "permission_required".to_string()') &&
      apiMcp.includes('status: "pending".to_string()'),
    detail: "approval requests create pending inbox items instead of grants",
  },
  {
    id: "request-merge-binds-durable-intent",
    ok:
      apiMcp.includes('"aelyris.request_merge"') &&
      // P0-3: request_merge mints a DURABLE immutable intent (not a RAM queue),
      // capturing the canonical repo + the resolved branch OIDs at request time.
      apiMcp.includes("state.merge_store.as_ref()") &&
      apiMcp.includes('arg_string(&args, "repoPath")') &&
      apiMcp.includes('arg_string(&args, "taskId")') &&
      apiMcp.includes("crate::merge_intent::MergeIntent {") &&
      apiMcp.includes("store.create_or_get(&intent)") &&
      // ...and never merges to main at request time.
      !apiMcp.includes('"aelyris.merge_to_main"'),
    detail:
      "request_merge captures repo/branch/OIDs into a durable, immutable intent; it never merges",
  },
  {
    id: "merge-readiness-read-only-backend",
    ok:
      gitMod.includes("mod merge;") &&
      gitMod.includes("pub use merge::*;") &&
      gitMerge.includes("pub fn inspect_merge_worktree_branch") &&
      gitMerge.includes("graph_ahead_behind") &&
      gitMerge.includes("fast_forward_ready") &&
      ipcCommands.includes("pub fn inspect_merge_worktree_branch") &&
      ipcCommands.includes("This is read-only"),
    detail: "human/UI merge readiness can be inspected without checkout, fast-forward, or main writes",
  },
  {
    id: "pending-observe-only-contract",
    ok:
      apiMcp.includes('"aelyris.list_pending_approvals"') &&
      apiMcp.includes('"grantToolExposed": false'),
    detail: "pending approval polling explicitly reports no grant tool exposure",
  },
  {
    id: "reviewer-approve-binds-to-stored-intent",
    ok:
      apiMcp.includes('"aelyris.review.approve"') &&
      apiMcp.includes('"aelyris.review.reject"') &&
      // P0-3 boundary #1/#4: approve NEVER takes caller repo/source/target; the
      // old override call is gone, replaced by an OID-bound merge of the stored
      // intent, claimed via the DB compare-and-swap.
      !apiMcp.includes("crate::git::perform_merge(&repo_path, &source_branch, &target_branch)") &&
      apiMcp.includes("APPROVE_ALLOWED") &&
      apiMcp.includes("crate::control::merge::approve_durable_intent(") &&
      merge.includes("crate::git::perform_merge_bound(") &&
      merge.includes(".claim_for_merge(intent_id, now)") &&
      gitMerge.includes("pub fn perform_merge_bound"),
    detail:
      "reviewer approve binds to the stored immutable intent (intentId only), CAS-claims, and runs an OID-bound merge; reject resolves without merging",
  },
  {
    id: "mcp-spawn-enforces-cost-gate",
    ok:
      apiMcp.includes('"aelyris.spawn_agent"') &&
      apiMcp.includes('"aelyris.stop_agent"') &&
      apiMcp.includes("cost.guard_spawn(active_agents)") &&
      api.includes("pub fn with_cost_manager") &&
      api.includes("pub cost_manager: Option<Arc<CostManager>>") &&
      lib.includes(".with_cost_manager(cost_manager)"),
    detail:
      "MCP spawn_agent shares the live cost caps (single source of truth) and enforces the agent cap (BR7)",
  },
  {
    id: "native-state-connected-to-mcp",
    ok:
      api.includes("with_agent_manager") &&
      api.includes("with_ghost_layers") &&
      api.includes("mod mcp;") &&
      api.includes("mcp::tools_call") &&
      lib.includes(".with_agent_manager(agent_manager)") &&
      lib.includes(".with_ghost_layers(ghost_layers)"),
    detail: "in-process MCP surface reads the same Rust agent and GhostDiff state",
  },
  {
    id: "mcp-task-graph-single-source",
    ok:
      apiMcp.includes('"aelyris.task.create"') &&
      apiMcp.includes('"aelyris.task.list"') &&
      apiMcp.includes('"aelyris.task.transition"') &&
      apiMcp.includes('"aelyris.orchestrator.plan"') &&
      apiMcp.includes("state.task_manager.as_ref()") &&
      api.includes("pub task_manager: Option<Arc<crate::task::TaskManager>>") &&
      api.includes("pub fn with_task_manager") &&
      lib.includes(".with_task_manager(task_manager)") &&
      lib.includes("Arc::new(task::TaskManager::new())"),
    detail:
      "orchestrator AI can decompose/assign/inspect the Task Graph over MCP against the same Arc<TaskManager> the cockpit shows (one source of truth, BR4/BR9)",
  },
  {
    id: "mcp-orchestrator-step-drives-real-loop",
    ok:
      apiMcp.includes('"aelyris.orchestrator.step"') &&
      apiMcp.includes("crate::control::loop_ports::run_step(") &&
      loopPorts.includes("pub fn run_step(") &&
      loopPorts.includes("fn poll_completions(&self) -> Completions {") &&
      loopPorts.includes("self.manager.reap()") &&
      loopPorts.includes("self.manager.set_task(&session_id, task_id)") &&
      agentClaude.includes("pub fn reap(&self) -> ReapOutcome") &&
      agentClaude.includes("pub fn set_task("),
    detail:
      "orchestrator.step drives one real autonomy step over MCP (shared run_step): finished agents (reap) -> review, green verdict -> real merge, ready -> spawn; same loop as Face 1",
  },
  {
    id: "mcp-orchestrator-recovers-crashed-agents",
    ok:
      // reap splits clean exits from crashes (exit code), and the dispatcher
      // forwards both so the loop can recover dead workers (BR9 / ⑦ Recovery).
      agentClaude.includes("pub struct ReapOutcome") &&
      agentClaude.includes("exit.success()") &&
      // The crash-vs-success split is covered by a BEHAVIORAL test (real child
      // processes), not just a string-match gate — a broken split fails cargo.
      agentClaude.includes("fn reap_splits_clean_and_crashed_exits_by_code") &&
      loopPorts.includes("succeeded: outcome.succeeded") &&
      loopPorts.includes("failed: outcome.failed") &&
      // The pure loop reassigns a crashed task up to a bounded retry count, then
      // leaves it Failed (terminal) — never silently lost. Crash and rework draw
      // on SEPARATE budgets so a transient crash can't steal a rework attempt.
      autonomy.includes("pub const MAX_CRASH_ATTEMPTS") &&
      autonomy.includes("pub const MAX_REWORK_ATTEMPTS") &&
      autonomy.includes("fn requeue_or_fail(") &&
      autonomy.includes("graph.record_crash(id)") &&
      autonomy.includes("graph.record_rework(id)") &&
      autonomy.includes("TaskStatus::Failed") &&
      autonomy.includes("recovered.push(id)"),
    detail:
      "a crashed worker (non-zero exit) is reassigned up to MAX_CRASH_ATTEMPTS (separate from rework budget) then left Failed, never lost — recovery wired from reap() through the loop (BR9, ⑦ Recovery)",
  },
  {
    id: "mcp-orchestrator-context-convergence",
    ok:
      // Every dispatched agent's prompt carries the CURRENT ADR, rebuilt from
      // the shared store each step — no agent runs on stale context (③).
      loopPorts.includes("build_adr_header(&context.all())") &&
      loopPorts.includes("let guidelines_header = build_guidelines_header(&repo_path);") &&
      // Every dispatched prompt carries the current ADR (world-model), repo rules,
      // active symbol-ownership section (A6 §6.4), and the optional visible-pane
      // completion contract through one prompt owner — the agent runs blind to
      // neither the shared decisions, repository guide, file ownership, nor its
      // explicit done-marker duty when present.
      loopPorts.includes(
        'format!("{adr_header}{guidelines_header}{ownership_section}{completion_section}{task_prompt}")',
      ) &&
      loopPorts.includes("fn ownership_section(") &&
      // Rejected/stale work is re-dispatched (with the fresh ADR) via the shared
      // requeue path on the rework budget, not stranded in Running with no worker.
      autonomy.includes("requeue_or_escalate(graph, &id, FailureKind::Rework") &&
      autonomy.includes("ReviewVerdict::Reject"),
    detail:
      "a mid-flight decision converges: every (re-)dispatch injects the current ADR (build_adr_header from context.all()), and review-rejected stale work is re-dispatched for rework rather than stranded (BR6, ③ context sync)",
  },
  {
    id: "mcp-orchestrator-mechanical-gate",
    ok:
      // The mechanical gate runs the target project's commands in the worktree
      // and maps real exit codes, so a red branch cannot merge (BR9 / ⑧).
      gateRunner.includes("pub struct ProcessGateRunner") &&
      gateRunner.includes("pub trait CommandRunner") &&
      gateRunner.includes("pub struct SystemCommandRunner") &&
      gateRunner.includes("status.success()") &&
      // Wired into the shared loop step + exposed on the MCP step verb.
      loopPorts.includes("ProcessGateRunner::new(") &&
      loopPorts.includes("SystemCommandRunner") &&
      loopPorts.includes("gate_commands: Option<crate::control::gate_runner::GateCommands>") &&
      apiMcp.includes('"gateCommands"') &&
      apiMcp.includes("gate_commands,"),
    detail:
      "orchestrator.step can decide the objective gates (tests/lint/types) mechanically — ProcessGateRunner runs the configured commands in each worktree and maps real exit codes, so a branch whose tests fail cannot merge (BR9, ⑧)",
  },
  {
    id: "mcp-orchestrator-enforces-disjoint-lanes",
    ok:
      // The pattern-overlap primitive is shared (one source of truth) between
      // detection (conflicts) and enforcement (dispatch).
      fileOwnership.includes("pub fn patterns_overlap") &&
      // The combined file+symbol collision rule is ONE shared pure predicate in
      // symbol_ownership — a shared FILE lane collides UNLESS both tasks prove DISJOINT
      // WRITE symbols (spec §6.2 function-level parallelism); any overlap without symbol
      // proof (glob / missing / inferred / shared-config) falls back to file-level, via
      // patterns_overlap + intents_block.
      symbolOwnership.includes("pub fn tasks_collide") &&
      symbolOwnership.includes("patterns_overlap(a_out, b_out)") &&
      symbolOwnership.includes("intents_block") &&
      // The loop consumes it to refuse co-dispatch of a colliding task (BR8 / ②)...
      autonomy.includes("tasks_collide(") &&
      autonomy.includes("let lane_busy") &&
      autonomy.includes("if lane_busy") &&
      // ...the plan validator rejects a colliding PARALLEL plan up front via the SAME
      // predicate (no drift between validation and dispatch)...
      planner.includes("tasks_collide(") &&
      // ...and the dispatch gate ALSO consults the LIVE ownership map (spec §6.5):
      // a running agent's actual claim serializes a ready task.
      autonomy.includes("symbol_blocking"),
    detail:
      "the loop co-dispatches two tasks on ONE file only when their declared symbols are disjoint (tasks_collide / intents_block, spec §6.2); any lane overlap without symbol proof — or an overlapping/inferred range — stays file-exclusive (patterns_overlap), and the live ownership map is consulted too (symbol_blocking, §6.5). So two agents never edit the same file region at once (BR8, ②)",
  },
  {
    id: "mcp-orchestrator-final-exam-harness",
    ok:
      // A deterministic end-to-end harness drives the whole loop over a
      // multi-task feature build with a crash + a rejection + a lane contention,
      // asserting every coordination/safety guarantee holds with no human.
      examHarness.includes("ten_agents_finish_one_feature_without_a_human_manager") &&
      examHarness.includes("struct ScriptedFleet") &&
      examHarness.includes("agent cap exceeded") && // ⑥
      examHarness.includes("lane collision") && // ②
      examHarness.includes("was not recovered") && // ⑦
      examHarness.includes("was not reworked") && // ③
      examHarness.includes("LoopState::Complete") && // ⑧
      examHarness.includes("merge_pos"), // ④ dependency-ordered integration
    detail:
      "a cargo-deterministic final-exam harness proves the runtime enforces every coordination/safety guarantee end-to-end (②⑥ per-tick invariants, ③⑦ fault recovery, ④⑧ dependency-ordered merge to completion) with zero human intervention",
  },
  {
    id: "mcp-coordination-stream-shared",
    ok:
      apiMcp.includes('"aelyris.event.recent"') &&
      apiMcp.includes('"aelyris.ownership.assign"') &&
      apiMcp.includes('"aelyris.ownership.conflicts"') &&
      api.includes("pub event_bus: Option<Arc<crate::event_bus::EventBus>>") &&
      api.includes("pub file_ownership: Option<Arc<Mutex<crate::file_ownership::FileOwnership>>>") &&
      lib.includes(".with_event_bus(event_bus)") &&
      lib.includes(".with_file_ownership(file_ownership)") &&
      loopPorts.includes("fn apply_file_lanes(") &&
      loopPorts.includes("AgentEventKind::FileLocked") &&
      loopPorts.includes("AgentEventKind::FileReleased"),
    detail:
      "orchestrator AI subscribes to the shared Event Bus + assigns/inspects File Ownership over MCP (same instances the cockpit/loop use); dispatch claims file lanes + publishes FileLocked, merge releases + publishes FileReleased (BR5/BR8)",
  },
  {
    id: "mcp-shared-adr-world-model",
    ok:
      apiMcp.includes('"aelyris.context.set"') &&
      apiMcp.includes('"aelyris.context.all"') &&
      apiMcp.includes("AgentEventKind::DecisionChanged") &&
      api.includes("pub context_store: Option<Arc<crate::context_store::ContextStoreManager>>") &&
      lib.includes(".with_context_store(context_store)") &&
      loopPorts.includes("fn build_adr_header(") &&
      loopPorts.includes("align your work to these shared decisions") &&
      loopPorts.includes("fn build_guidelines_header(") &&
      loopPorts.includes("spawn_specs(") &&
      loopPorts.includes("&adr_header,") &&
      loopPorts.includes("&guidelines_header,"),
    detail:
      "orchestrator AI reads/writes the shared ADR (Context Store) over MCP; context.set publishes decision_changed; and the ADR is injected ahead of repo guidelines in every dispatched agent prompt so all agents share the world-model (BR6)",
  },
  {
    id: "mcp-realtime-activity-and-intent",
    ok:
      apiMcp.includes('"aelyris.agent.report_activity"') &&
      apiMcp.includes('"aelyris.agent.report_blocker"') &&
      apiMcp.includes('"aelyris.agent.activity"') &&
      apiMcp.includes('"aelyris.intent.propose"') &&
      apiMcp.includes('"aelyris.intent.list"') &&
      agentClaude.includes("pub fn set_activity(") &&
      agentClaude.includes("pub struct AgentActivity") &&
      eventBus.includes("AgentActivity") &&
      eventBus.includes("IntentDeclared") &&
      eventBus.includes("BlockerRaised") &&
      api.includes("pub intent_bus: Option<Arc<crate::intent::IntentBus>>") &&
      lib.includes(".with_intent_bus(intent_bus)"),
    detail:
      "agents report live activity (file/symbol/action) read by peers via agent.activity (real-time 'who is doing what'); the Intent Bus shares proposals before acting (pre-fact deliberation / meetings substrate), both on the shared stream",
  },
  {
    id: "mcp-knowledge-graph-impact",
    ok:
      apiMcp.includes('"aelyris.knowledge.add_edge"') &&
      apiMcp.includes('"aelyris.knowledge.impact"') &&
      apiMcp.includes('"aelyris.knowledge.graph"') &&
      knowledgeGraph.includes("pub fn impact_of(") &&
      knowledgeGraph.includes("pub fn dependents_of(") &&
      api.includes("pub knowledge_graph: Option<Arc<crate::knowledge_graph::KnowledgeGraphManager>>") &&
      lib.includes(".with_knowledge_graph(knowledge_graph)"),
    detail:
      "the fleet reasons over code structure (Knowledge Graph) not files: add_node/add_edge build the dependency graph; impact gives the transitive blast radius of a change so a decision/intent's affected symbols are known up front",
  },
];

const ok = checks.every((check) => check.ok);
const artifact = {
  schema: "aelyris.mcp-orchestrator-surface.v1",
  status: ok ? "passed" : "failed",
  ok,
  checkedAt: new Date().toISOString(),
  requiredTools,
  checks,
};

const artifactPath = path.join(qualityDir, "mcp-orchestrator-surface.json");
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(`MCP orchestrator surface gate passed: ${artifactPath}`);
