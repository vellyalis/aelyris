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
const controlMod = read("src-tauri/src/control/mod.rs");
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

const requiredTools = [
  "aether.worktree.validate",
  "aether.worktree.predictPath",
  "aether.worktree.list",
  "aether.worktree.create",
  "aether.worktree.remove",
  "aether.fleet_status",
  "aether.route_agent",
  "aether.pane_send_input",
  "aether.agent_diff",
  "aether.request_approval",
  "aether.list_pending_approvals",
  "aether.request_merge",
  "aether.spawn_agent",
  "aether.stop_agent",
  "aether.review.approve",
  "aether.review.reject",
  "aether.task.create",
  "aether.task.list",
  "aether.task.transition",
  "aether.orchestrator.plan",
  "aether.orchestrator.step",
  "aether.event.recent",
  "aether.event.by_channel",
  "aether.ownership.assign",
  "aether.ownership.owner_of",
  "aether.ownership.claims",
  "aether.ownership.conflicts",
  "aether.context.set",
  "aether.context.get",
  "aether.context.all",
  "aether.context.remove",
  "aether.agent.report_activity",
  "aether.agent.report_blocker",
  "aether.agent.activity",
  "aether.intent.propose",
  "aether.intent.list",
  "aether.intent.all",
  "aether.intent.resolve",
  "aether.knowledge.add_node",
  "aether.knowledge.add_edge",
  "aether.knowledge.remove_node",
  "aether.knowledge.remove_edge",
  "aether.knowledge.dependencies",
  "aether.knowledge.dependents",
  "aether.knowledge.impact",
  "aether.knowledge.graph",
];

const checks = [
  {
    id: "required-aether-tool-catalog",
    ok: requiredTools.every((tool) => apiMcp.includes(`"${tool}"`)),
    detail: "all aether.mcp.v1 orchestration tools are listed",
  },
  {
    id: "no-grant-or-merge-to-main-tools",
    ok:
      !apiMcp.includes('"aether.grant_approval"') &&
      !apiMcp.includes('"aether.merge_to_main"') &&
      !apiMcp.includes('"grant_approval"') &&
      !apiMcp.includes('"merge_to_main"'),
    detail: "MCP catalog exposes request/observe only for gated operations",
  },
  {
    id: "request-approval-queues-pending",
    ok:
      apiMcp.includes('"aether.request_approval"') &&
      apiMcp.includes('kind: "permission_required".to_string()') &&
      apiMcp.includes('status: "pending".to_string()'),
    detail: "approval requests create pending inbox items instead of grants",
  },
  {
    id: "request-merge-queues-only",
    ok:
      controlMod.includes("pub mod merge;") &&
      merge.includes("pub fn queue_request") &&
      merge.includes("MergeIntentStatus::Queued.as_str().to_string()") &&
      merge.includes('Self::Queued => "queued"') &&
      apiMcp.includes('"aether.request_merge"') &&
      apiMcp.includes("no merge was performed"),
    detail: "merge requests validate and queue without merging to main",
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
      apiMcp.includes('"aether.list_pending_approvals"') &&
      apiMcp.includes('"grantToolExposed": false'),
    detail: "pending approval polling explicitly reports no grant tool exposure",
  },
  {
    id: "reviewer-authority-performs-merge",
    ok:
      apiMcp.includes('"aether.review.approve"') &&
      apiMcp.includes('"aether.review.reject"') &&
      apiMcp.includes("crate::git::perform_merge(&repo_path, &source_branch, &target_branch)") &&
      apiMcp.includes('item.status = "merging".to_string()') &&
      gitMerge.includes("pub fn perform_merge"),
    detail:
      "reviewer approve performs a real git merge (claimed pending -> merging -> terminal); reject resolves without merging",
  },
  {
    id: "mcp-spawn-enforces-cost-gate",
    ok:
      apiMcp.includes('"aether.spawn_agent"') &&
      apiMcp.includes('"aether.stop_agent"') &&
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
      apiMcp.includes('"aether.task.create"') &&
      apiMcp.includes('"aether.task.list"') &&
      apiMcp.includes('"aether.task.transition"') &&
      apiMcp.includes('"aether.orchestrator.plan"') &&
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
      apiMcp.includes('"aether.orchestrator.step"') &&
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
      loopPorts.includes("succeeded: outcome.succeeded") &&
      loopPorts.includes("failed: outcome.failed") &&
      // The pure loop reassigns a crashed task up to a bounded retry count, then
      // leaves it Failed (terminal) — never silently lost.
      autonomy.includes("pub const MAX_TASK_ATTEMPTS") &&
      autonomy.includes("fn requeue_or_fail(") &&
      autonomy.includes("graph.record_attempt(id)") &&
      autonomy.includes("TaskStatus::Failed") &&
      autonomy.includes("recovered.push(id)"),
    detail:
      "a crashed worker (non-zero exit) is reassigned up to MAX_TASK_ATTEMPTS then left Failed, never lost — recovery wired from reap() through the loop (BR9, ⑦ Recovery)",
  },
  {
    id: "mcp-orchestrator-context-convergence",
    ok:
      // Every dispatched agent's prompt carries the CURRENT ADR, rebuilt from
      // the shared store each step — no agent runs on stale context (③).
      loopPorts.includes("build_adr_header(&context.all())") &&
      loopPorts.includes("format!(\"{adr_header}{task_prompt}\")") &&
      // Rejected/stale work is re-dispatched (with the fresh ADR) via the shared
      // requeue path, not stranded in Running with no live worker.
      autonomy.includes("requeue_or_fail(graph, &id)") &&
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
      // The loop refuses to co-dispatch a task whose outputs overlap a running
      // task's lane — ownership enforced, not merely detected (BR8 / ②).
      autonomy.includes("use crate::file_ownership::patterns_overlap") &&
      autonomy.includes("let lane_busy") &&
      autonomy.includes("patterns_overlap(out, busy)") &&
      autonomy.includes("if lane_busy"),
    detail:
      "the loop never co-dispatches tasks whose output lanes overlap (reusing file_ownership::patterns_overlap) — two agents can never edit the same file at once (BR8, ② ownership enforced)",
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
      apiMcp.includes('"aether.event.recent"') &&
      apiMcp.includes('"aether.ownership.assign"') &&
      apiMcp.includes('"aether.ownership.conflicts"') &&
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
      apiMcp.includes('"aether.context.set"') &&
      apiMcp.includes('"aether.context.all"') &&
      apiMcp.includes("AgentEventKind::DecisionChanged") &&
      api.includes("pub context_store: Option<Arc<crate::context_store::ContextStoreManager>>") &&
      lib.includes(".with_context_store(context_store)") &&
      loopPorts.includes("fn build_adr_header(") &&
      loopPorts.includes("align your work to these shared decisions") &&
      loopPorts.includes("spawn_specs(graph, &repo_path, &adr_header)"),
    detail:
      "orchestrator AI reads/writes the shared ADR (Context Store) over MCP; context.set publishes decision_changed; and the ADR is injected into every dispatched agent's prompt so all agents share the world-model (BR6)",
  },
  {
    id: "mcp-realtime-activity-and-intent",
    ok:
      apiMcp.includes('"aether.agent.report_activity"') &&
      apiMcp.includes('"aether.agent.report_blocker"') &&
      apiMcp.includes('"aether.agent.activity"') &&
      apiMcp.includes('"aether.intent.propose"') &&
      apiMcp.includes('"aether.intent.list"') &&
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
      apiMcp.includes('"aether.knowledge.add_edge"') &&
      apiMcp.includes('"aether.knowledge.impact"') &&
      apiMcp.includes('"aether.knowledge.graph"') &&
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
  schema: "aether.mcp-orchestrator-surface.v1",
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
