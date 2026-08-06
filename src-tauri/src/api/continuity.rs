use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::agent::{AgentActivity, AgentCli};
use crate::event_bus::EventFrontier;
use crate::merge_intent::MergeIntent;
use crate::mux::graph::{LifecycleState, PaneRecord, WorkspaceRecord};
use crate::proofbook::{ProofbookResidualBlocker, ProofbookRunLedger, ProofbookStepStatus};

use super::{ApiError, ApiResult, ApiState};

const SNAPSHOT_SCHEMA: &str = "aelyris.continuity.snapshot/v1";
const MAX_TEXT_CHARS: usize = 256;
const MAX_TERMINALS: usize = 128;
const MAX_WORKSPACES: usize = 32;
const MAX_WINDOWS_PER_WORKSPACE: usize = 32;
const MAX_TABS_PER_WINDOW: usize = 64;
const MAX_PANES_PER_TAB: usize = 64;
const MAX_AGENTS: usize = 128;
const MAX_APPROVALS: usize = 128;
const MAX_PROOFBOOK_RUNS: usize = 64;
const MAX_BLOCKERS_PER_RUN: usize = 8;
const MAX_MERGE_INTENTS: usize = 64;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContinuityQuery {
    project_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContinuitySnapshot {
    schema: &'static str,
    captured_at_ms: u64,
    process: ContinuityProcess,
    transport: ContinuityTransport,
    requested_project_path: Option<String>,
    terminals: ContinuityCollection<TerminalSummary>,
    workspaces: ContinuityCollection<WorkspaceSummary>,
    agents: ContinuityCollection<AgentSummary>,
    approvals: ContinuityCollection<ApprovalSummary>,
    proofbook_runs: ContinuityCollection<ProofbookRunSummary>,
    merge_intents: ContinuityCollection<MergeIntentSummary>,
    file_ownership: ContinuityValue<OwnershipSummary>,
    symbol_ownership: ContinuityValue<OwnershipSummary>,
    cost_caps: ContinuityValue<crate::cost::CostCaps>,
    event_cursor: ContinuityValue<EventFrontier>,
    omitted: [&'static str; 9],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityProcess {
    process_kind: &'static str,
    instance_id: String,
    pid: u32,
    version: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityTransport {
    bind_scope: &'static str,
    authenticated: bool,
    read_only_snapshot: bool,
    snapshot_mutation_supported: bool,
    remote_operation_claim: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityCollection<T> {
    available: bool,
    source: &'static str,
    truncated: bool,
    items: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

impl<T> ContinuityCollection<T> {
    fn available(source: &'static str, items: Vec<T>, truncated: bool) -> Self {
        Self {
            available: true,
            source,
            truncated,
            items,
            reason: None,
        }
    }

    fn unavailable(source: &'static str, reason: &'static str) -> Self {
        Self {
            available: false,
            source,
            truncated: false,
            items: Vec::new(),
            reason: Some(reason),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityValue<T> {
    available: bool,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

impl<T> ContinuityValue<T> {
    fn available(source: &'static str, value: T) -> Self {
        Self {
            available: true,
            source,
            value: Some(value),
            reason: None,
        }
    }

    fn unavailable(source: &'static str, reason: &'static str) -> Self {
        Self {
            available: false,
            source,
            value: None,
            reason: Some(reason),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSummary {
    id: String,
    process_id: Option<u32>,
    uptime_secs: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    name: String,
    project_path: Option<String>,
    active_window_id: String,
    truncated: bool,
    windows: Vec<WindowSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowSummary {
    id: String,
    title: String,
    active_tab_id: String,
    truncated: bool,
    tabs: Vec<TabSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabSummary {
    id: String,
    title: String,
    synchronized_panes: bool,
    truncated: bool,
    panes: Vec<PaneSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneSummary {
    id: String,
    title: String,
    role: Option<String>,
    lifecycle: &'static str,
    exit_code: Option<i32>,
    terminal_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    project_path: Option<String>,
    branch: Option<String>,
    worktree_path: Option<String>,
    task_id: Option<String>,
    workflow_id: Option<String>,
    agent_id: Option<String>,
    provider: Option<String>,
    agent_role: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSummary {
    id: String,
    runtime: &'static str,
    status: String,
    provider: Option<String>,
    model: String,
    task_id: Option<String>,
    workspace_path: Option<String>,
    worktree_path: Option<String>,
    worktree_branch: Option<String>,
    current_activity: Option<ActivitySummary>,
    approval_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivitySummary {
    action: String,
    file: Option<String>,
    symbol: Option<String>,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalSummary {
    id: String,
    session_id: String,
    kind: String,
    risk: String,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofbookRunSummary {
    run_id: String,
    proofbook_id: String,
    status: String,
    revision: u64,
    updated_at: String,
    passed_steps: usize,
    running_steps: usize,
    blocked_steps: usize,
    artifact_count: usize,
    blocker_count: usize,
    blockers_truncated: bool,
    blockers: Vec<ProofbookBlockerSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofbookBlockerSummary {
    code: String,
    step_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeIntentSummary {
    intent_id: String,
    repo_path: String,
    source_branch: String,
    target_branch: String,
    source_oid: String,
    target_oid: String,
    task_id: String,
    state: String,
    updated_at: i64,
    reviewer_bound: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnershipSummary {
    claim_count: usize,
    conflict_count: usize,
}

struct AgentProjection {
    agents: ContinuityCollection<AgentSummary>,
    interactive_approvals: Vec<ApprovalSummary>,
}

pub(super) async fn snapshot(
    State(state): State<ApiState>,
    Query(query): Query<ContinuityQuery>,
) -> ApiResult<Json<ContinuitySnapshot>> {
    Ok(Json(build_snapshot(&state, query.project_path.as_deref())?))
}

fn build_snapshot(
    state: &ApiState,
    requested_project_path: Option<&str>,
) -> Result<ContinuitySnapshot, ApiError> {
    let captured_at_ms = now_ms();
    let agents = collect_agents(state)?;
    let mut approvals = collect_pending_approvals(state)?;
    approvals.extend(agents.interactive_approvals);
    approvals.sort_by(|left, right| left.id.cmp(&right.id));
    let approvals_truncated = approvals.len() > MAX_APPROVALS;
    approvals.truncate(MAX_APPROVALS);

    Ok(ContinuitySnapshot {
        schema: SNAPSHOT_SCHEMA,
        captured_at_ms,
        process: ContinuityProcess {
            process_kind: state.process_kind,
            instance_id: bounded(&state.instance_id),
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION"),
        },
        transport: ContinuityTransport {
            bind_scope: "loopback-only",
            authenticated: state.auth.is_enabled(),
            read_only_snapshot: true,
            snapshot_mutation_supported: false,
            remote_operation_claim: false,
        },
        requested_project_path: requested_project_path.map(bounded),
        terminals: collect_terminals(state),
        workspaces: collect_workspaces(state)?,
        agents: agents.agents,
        approvals: ContinuityCollection::available(
            "mcp-pending+interactive-session-managers",
            approvals,
            approvals_truncated,
        ),
        proofbook_runs: collect_proofbooks(state, requested_project_path),
        merge_intents: collect_merge_intents(state),
        file_ownership: collect_file_ownership(state)?,
        symbol_ownership: collect_symbol_ownership(state, captured_at_ms / 1_000)?,
        cost_caps: state
            .cost_manager
            .as_ref()
            .map(|manager| ContinuityValue::available("cost-manager", manager.caps()))
            .unwrap_or_else(|| ContinuityValue::unavailable("cost-manager", "owner_not_attached")),
        event_cursor: collect_event_cursor(state),
        omitted: [
            "raw_scrollback",
            "terminal_input",
            "prompt_or_command_bodies",
            "secret_values",
            "artifact_contents",
            "token_files",
            "environment_values",
            "signing_material",
            "arbitrary_structured_output",
        ],
    })
}

fn collect_terminals(state: &ApiState) -> ContinuityCollection<TerminalSummary> {
    let mut values = state.pty.list_info();
    values.sort_by(|left, right| left.id.cmp(&right.id));
    let truncated = values.len() > MAX_TERMINALS;
    values.truncate(MAX_TERMINALS);
    ContinuityCollection::available(
        "pty-manager",
        values
            .into_iter()
            .map(|terminal| TerminalSummary {
                id: bounded(&terminal.id),
                process_id: terminal.process_id,
                uptime_secs: terminal.uptime_secs,
            })
            .collect(),
        truncated,
    )
}

fn collect_workspaces(
    state: &ApiState,
) -> Result<ContinuityCollection<WorkspaceSummary>, ApiError> {
    let mux = state
        .mux
        .lock()
        .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
    let mut workspace_ids = mux.workspace_ids();
    workspace_ids.sort();
    let mut truncated = workspace_ids.len() > MAX_WORKSPACES;
    workspace_ids.truncate(MAX_WORKSPACES);
    let mut workspaces = Vec::new();
    for workspace_id in workspace_ids {
        let Some(graph) = mux.graph(&workspace_id) else {
            continue;
        };
        let mut records = graph.workspaces.values().collect::<Vec<_>>();
        records.sort_by(|left, right| left.id.cmp(&right.id));
        for record in records {
            if workspaces.len() >= MAX_WORKSPACES {
                truncated = true;
                break;
            }
            workspaces.push(workspace_summary(record));
        }
    }
    Ok(ContinuityCollection::available(
        "mux-manager",
        workspaces,
        truncated,
    ))
}

fn workspace_summary(workspace: &WorkspaceRecord) -> WorkspaceSummary {
    let mut windows = workspace.windows.values().collect::<Vec<_>>();
    windows.sort_by(|left, right| left.id.cmp(&right.id));
    let truncated = windows.len() > MAX_WINDOWS_PER_WORKSPACE;
    windows.truncate(MAX_WINDOWS_PER_WORKSPACE);
    WorkspaceSummary {
        id: bounded(&workspace.id),
        name: bounded(&workspace.name),
        project_path: workspace.project_path.as_deref().map(bounded),
        active_window_id: bounded(&workspace.active_window_id),
        truncated,
        windows: windows
            .into_iter()
            .map(|window| {
                let mut tabs = window.tabs.values().collect::<Vec<_>>();
                tabs.sort_by(|left, right| left.id.cmp(&right.id));
                let tabs_truncated = tabs.len() > MAX_TABS_PER_WINDOW;
                tabs.truncate(MAX_TABS_PER_WINDOW);
                WindowSummary {
                    id: bounded(&window.id),
                    title: bounded(&window.title),
                    active_tab_id: bounded(&window.active_tab_id),
                    truncated: tabs_truncated,
                    tabs: tabs
                        .into_iter()
                        .map(|tab| {
                            let mut panes = tab.panes.values().collect::<Vec<_>>();
                            panes.sort_by(|left, right| left.id.cmp(&right.id));
                            let panes_truncated = panes.len() > MAX_PANES_PER_TAB;
                            panes.truncate(MAX_PANES_PER_TAB);
                            TabSummary {
                                id: bounded(&tab.id),
                                title: bounded(&tab.title),
                                synchronized_panes: tab.synchronized_panes,
                                truncated: panes_truncated,
                                panes: panes.into_iter().map(pane_summary).collect(),
                            }
                        })
                        .collect(),
                }
            })
            .collect(),
    }
}

fn pane_summary(pane: &PaneRecord) -> PaneSummary {
    let (lifecycle, exit_code) = match pane.lifecycle {
        LifecycleState::Active => ("active", None),
        LifecycleState::Detached => ("detached", None),
        LifecycleState::Exited { code } => ("exited", code),
        LifecycleState::Dead { .. } => ("dead", None),
    };
    PaneSummary {
        id: bounded(&pane.id),
        title: bounded(&pane.title),
        role: pane.role.as_deref().map(bounded),
        lifecycle,
        exit_code,
        terminal_id: pane.pty.as_ref().map(|pty| bounded(&pty.terminal_id)),
        cols: pane.pty.as_ref().map(|pty| pty.cols),
        rows: pane.pty.as_ref().map(|pty| pty.rows),
        project_path: pane
            .project
            .as_ref()
            .map(|project| bounded(&project.project_path)),
        branch: pane
            .project
            .as_ref()
            .and_then(|project| project.branch.as_deref())
            .map(bounded),
        worktree_path: pane
            .project
            .as_ref()
            .and_then(|project| project.worktree_path.as_deref())
            .map(bounded),
        task_id: pane
            .project
            .as_ref()
            .and_then(|project| project.task_id.as_deref())
            .map(bounded),
        workflow_id: pane
            .project
            .as_ref()
            .and_then(|project| project.workflow_id.as_deref())
            .map(bounded),
        agent_id: pane.agent.as_ref().map(|agent| bounded(&agent.agent_id)),
        provider: pane.agent.as_ref().map(|agent| bounded(&agent.provider)),
        agent_role: pane
            .agent
            .as_ref()
            .and_then(|agent| agent.role.as_deref())
            .map(bounded),
    }
}

fn collect_agents(state: &ApiState) -> Result<AgentProjection, ApiError> {
    let mut agents = Vec::new();
    let mut interactive_approvals = Vec::new();
    let mut any_owner = false;

    if let Some(manager) = state.agent_manager.as_ref() {
        any_owner = true;
        for session in manager.list_sessions() {
            agents.push(AgentSummary {
                id: bounded(&session.id),
                runtime: "headless",
                status: bounded(&session.status),
                provider: None,
                model: bounded(&session.model),
                task_id: session.task_id.as_deref().map(bounded),
                workspace_path: Some(bounded(&session.cwd)),
                worktree_path: None,
                worktree_branch: None,
                current_activity: session.current_activity.as_ref().map(activity_summary),
                approval_pending: false,
            });
        }
    }

    if let Some(manager) = state.interactive_session_manager.as_ref() {
        any_owner = true;
        for session in manager.list().map_err(ApiError::Internal)? {
            let approval_pending = session.status == "waiting_approval";
            if approval_pending {
                interactive_approvals.push(ApprovalSummary {
                    id: bounded(&format!("interactive:{}", session.id)),
                    session_id: bounded(&session.id),
                    kind: "interactive_permission".to_string(),
                    risk: "runtime-classified".to_string(),
                    status: "pending".to_string(),
                });
            }
            agents.push(AgentSummary {
                id: bounded(&session.id),
                runtime: "interactive",
                status: bounded(&session.status),
                provider: Some(agent_cli_name(&session.cli)),
                model: bounded(&session.model),
                task_id: None,
                workspace_path: session
                    .repo_path
                    .as_deref()
                    .or(Some(&session.cwd))
                    .map(bounded),
                worktree_path: session.worktree_path.as_deref().map(bounded),
                worktree_branch: session.worktree_branch.as_deref().map(bounded),
                current_activity: None,
                approval_pending,
            });
        }
    }

    if !any_owner {
        return Ok(AgentProjection {
            agents: ContinuityCollection::unavailable("agent-managers", "owners_not_attached"),
            interactive_approvals,
        });
    }
    agents.sort_by(|left, right| left.id.cmp(&right.id));
    let truncated = agents.len() > MAX_AGENTS;
    agents.truncate(MAX_AGENTS);
    Ok(AgentProjection {
        agents: ContinuityCollection::available("agent-managers", agents, truncated),
        interactive_approvals,
    })
}

fn activity_summary(activity: &AgentActivity) -> ActivitySummary {
    ActivitySummary {
        action: bounded(&activity.action),
        file: activity.file.as_deref().map(bounded),
        symbol: activity.symbol.as_deref().map(bounded),
        updated_at: activity.updated_at,
    }
}

fn agent_cli_name(cli: &AgentCli) -> String {
    match cli {
        AgentCli::Claude => "claude".to_string(),
        AgentCli::Gemini => "gemini".to_string(),
        AgentCli::Codex => "codex".to_string(),
        AgentCli::Custom(name) => bounded(name),
    }
}

fn collect_pending_approvals(state: &ApiState) -> Result<Vec<ApprovalSummary>, ApiError> {
    let pending = state
        .mcp_pending
        .lock()
        .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?;
    Ok(pending
        .iter()
        .filter(|item| item.status == "pending")
        .map(|item| ApprovalSummary {
            id: bounded(&item.id),
            session_id: bounded(&item.session_id),
            kind: bounded(&item.kind),
            risk: bounded(&item.risk),
            status: bounded(&item.status),
        })
        .collect())
}

fn collect_proofbooks(
    state: &ApiState,
    requested_project_path: Option<&str>,
) -> ContinuityCollection<ProofbookRunSummary> {
    let Some(project_path) = requested_project_path else {
        return ContinuityCollection::unavailable("proofbook-runner", "project_path_not_requested");
    };
    let Some(runner) = state.proofbook_runner.as_ref() else {
        return ContinuityCollection::unavailable("proofbook-runner", "owner_not_attached");
    };
    let Ok(mut runs) = runner.list_runs(project_path) else {
        return ContinuityCollection::unavailable("proofbook-runner", "project_unavailable");
    };
    runs.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then(left.run_id.cmp(&right.run_id))
    });
    let truncated = runs.len() > MAX_PROOFBOOK_RUNS;
    runs.truncate(MAX_PROOFBOOK_RUNS);
    ContinuityCollection::available(
        "proofbook-runner",
        runs.iter().map(proofbook_summary).collect(),
        truncated,
    )
}

fn proofbook_summary(run: &ProofbookRunLedger) -> ProofbookRunSummary {
    let blocker_count = run.residual_blockers.len();
    let blockers = run
        .residual_blockers
        .iter()
        .take(MAX_BLOCKERS_PER_RUN)
        .map(proofbook_blocker_summary)
        .collect();
    ProofbookRunSummary {
        run_id: bounded(&run.run_id),
        proofbook_id: bounded(&run.proofbook_id),
        status: wire_string(&run.status),
        revision: run.revision,
        updated_at: bounded(&run.updated_at),
        passed_steps: run
            .steps
            .iter()
            .filter(|step| step.status == ProofbookStepStatus::Passed)
            .count(),
        running_steps: run
            .steps
            .iter()
            .filter(|step| step.status == ProofbookStepStatus::Running)
            .count(),
        blocked_steps: run
            .steps
            .iter()
            .filter(|step| step.status == ProofbookStepStatus::Blocked)
            .count(),
        artifact_count: run.artifacts.len(),
        blocker_count,
        blockers_truncated: blocker_count > MAX_BLOCKERS_PER_RUN,
        blockers,
    }
}

fn proofbook_blocker_summary(blocker: &ProofbookResidualBlocker) -> ProofbookBlockerSummary {
    ProofbookBlockerSummary {
        code: bounded(&blocker.code),
        step_id: blocker.step_id.as_deref().map(bounded),
    }
}

fn collect_merge_intents(state: &ApiState) -> ContinuityCollection<MergeIntentSummary> {
    let Some(store) = state.merge_store.as_ref() else {
        return ContinuityCollection::unavailable("merge-intent-store", "owner_not_attached");
    };
    let Ok(mut intents) = store.list_unresolved() else {
        return ContinuityCollection::unavailable("merge-intent-store", "query_failed");
    };
    intents.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then(left.intent_id.cmp(&right.intent_id))
    });
    let truncated = intents.len() > MAX_MERGE_INTENTS;
    intents.truncate(MAX_MERGE_INTENTS);
    ContinuityCollection::available(
        "merge-intent-store",
        intents.iter().map(merge_intent_summary).collect(),
        truncated,
    )
}

fn merge_intent_summary(intent: &MergeIntent) -> MergeIntentSummary {
    MergeIntentSummary {
        intent_id: bounded(&intent.intent_id),
        repo_path: bounded(&intent.repo_path),
        source_branch: bounded(&intent.source_branch),
        target_branch: bounded(&intent.target_branch),
        source_oid: bounded(&intent.source_oid),
        target_oid: bounded(&intent.target_oid),
        task_id: bounded(&intent.task_id),
        state: wire_string(&intent.state),
        updated_at: intent.updated_at,
        reviewer_bound: intent.reviewer_id.is_some(),
    }
}

fn collect_file_ownership(state: &ApiState) -> Result<ContinuityValue<OwnershipSummary>, ApiError> {
    let Some(owner) = state.file_ownership.as_ref() else {
        return Ok(ContinuityValue::unavailable(
            "file-ownership",
            "owner_not_attached",
        ));
    };
    let owner = owner
        .lock()
        .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?;
    Ok(ContinuityValue::available(
        "file-ownership",
        OwnershipSummary {
            claim_count: owner.claims().len(),
            conflict_count: owner.conflicts().len(),
        },
    ))
}

fn collect_symbol_ownership(
    state: &ApiState,
    now_secs: u64,
) -> Result<ContinuityValue<OwnershipSummary>, ApiError> {
    let Some(owner) = state.symbol_ownership.as_ref() else {
        return Ok(ContinuityValue::unavailable(
            "symbol-ownership",
            "owner_not_attached",
        ));
    };
    let owner = owner
        .lock()
        .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?;
    Ok(ContinuityValue::available(
        "symbol-ownership",
        OwnershipSummary {
            claim_count: owner.live_claims(now_secs).len(),
            conflict_count: owner.conflicts(now_secs).len(),
        },
    ))
}

fn collect_event_cursor(state: &ApiState) -> ContinuityValue<EventFrontier> {
    let Some(bus) = state.event_bus.as_ref() else {
        return ContinuityValue::unavailable("event-bus", "owner_not_attached");
    };
    match bus.frontier() {
        Ok(frontier) => ContinuityValue::available("event-bus", frontier),
        Err(_) => ContinuityValue::unavailable("event-bus", "durable_frontier_unavailable"),
    }
}

fn bounded(value: &str) -> String {
    let mut chars = value.chars();
    let prefix = chars.by_ref().take(MAX_TEXT_CHARS).collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn wire_string(value: &impl Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use crate::agent::{InteractiveSessionInfo, InteractiveSessionManager};
    use crate::api::{AuthConfig, McpPendingDecision};
    use crate::cost::{CostCaps, CostManager};
    use crate::db::{Database, ManagedDb};
    use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
    use crate::file_ownership::FileOwnership;
    use crate::pty::PtyManager;
    use serde_json::json;

    #[test]
    fn empty_snapshot_is_bounded_read_only_and_explicit_about_missing_owners() {
        let state = ApiState::new(PtyManager::new(), AuthConfig::disabled());

        let value = serde_json::to_value(build_snapshot(&state, None).unwrap()).unwrap();

        assert_eq!(value["schema"], SNAPSHOT_SCHEMA);
        assert_eq!(value["transport"]["bindScope"], "loopback-only");
        assert_eq!(value["transport"]["authenticated"], false);
        assert_eq!(value["transport"]["readOnlySnapshot"], true);
        assert_eq!(value["transport"]["snapshotMutationSupported"], false);
        assert_eq!(value["transport"]["remoteOperationClaim"], false);
        assert_eq!(value["agents"]["available"], false);
        assert_eq!(
            value["proofbookRuns"]["reason"],
            "project_path_not_requested"
        );
        assert_eq!(value["eventCursor"]["reason"], "owner_not_attached");
        let text = serde_json::to_string(&value).unwrap();
        for forbidden in [
            "initialPrompt",
            "approvalPrompt",
            "spawnToken",
            "structuredOutput",
            "artifactContent",
            "environment",
        ] {
            assert!(
                !text.contains(&format!("\"{forbidden}\":")),
                "unexpected field: {forbidden}"
            );
        }
    }

    #[test]
    fn bounded_text_never_splits_unicode_and_marks_truncation() {
        let value = "界".repeat(MAX_TEXT_CHARS + 3);
        let bounded = bounded(&value);
        assert_eq!(bounded.chars().count(), MAX_TEXT_CHARS + 1);
        assert!(bounded.ends_with('…'));
    }

    #[test]
    fn attached_owners_project_status_without_prompt_or_secret_payloads() {
        let db = ManagedDb::new(Database::open_memory().unwrap());
        let cost = Arc::new(CostManager::new());
        cost.attach_db(db.clone());
        cost.set_caps(CostCaps {
            max_agents: Some(6),
            ..CostCaps::default()
        })
        .unwrap();

        let event_bus = Arc::new(EventBus::new_durable());
        event_bus.attach_db(Arc::new(db));
        event_bus
            .publish(
                AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    json!({
                        "secretPayload": "EVENT_SECRET_MUST_NOT_APPEAR"
                    }),
                )
                .with_idempotency_key("continuity-test-event"),
            )
            .unwrap();

        let interactive = InteractiveSessionManager::new();
        interactive
            .register(InteractiveSessionInfo {
                id: "interactive-1".to_string(),
                logical_session_id: "logical-1".to_string(),
                pty_id: "pty-1".to_string(),
                backend: "native".to_string(),
                cli: AgentCli::Codex,
                status: "waiting_approval".to_string(),
                model: "gpt-test".to_string(),
                initial_prompt: Some("INITIAL_PROMPT_SECRET".to_string()),
                approval_prompt: Some("APPROVAL_PROMPT_SECRET".to_string()),
                cwd: "C:/repo".to_string(),
                worktree_branch: Some("feature/continuity".to_string()),
                worktree_path: Some("C:/repo/.worktrees/continuity".to_string()),
                repo_path: Some("C:/repo".to_string()),
                cost: 99.0,
                tokens_used: 123_456,
                started_at: 1,
                last_activity: 2,
                turn_count: 3,
                context_remaining: None,
            })
            .unwrap();

        let file_ownership = Arc::new(Mutex::new(FileOwnership::new()));
        file_ownership
            .lock()
            .unwrap()
            .assign("interactive-1", "src/api/**");

        let state = ApiState::new(PtyManager::new(), AuthConfig::with_token("public-token"))
            .with_interactive_session_manager(interactive)
            .with_cost_manager(cost)
            .with_event_bus(event_bus)
            .with_file_ownership(file_ownership);
        state.mcp_pending.lock().unwrap().push(McpPendingDecision {
            id: "approval-1".to_string(),
            session_id: "interactive-1".to_string(),
            kind: "permission_required".to_string(),
            title: "Approval requested".to_string(),
            summary: Some("MCP_SUMMARY_SECRET".to_string()),
            risk: "medium".to_string(),
            status: "pending".to_string(),
        });

        let value = serde_json::to_value(build_snapshot(&state, None).unwrap()).unwrap();
        assert_eq!(value["transport"]["authenticated"], true);
        assert_eq!(value["agents"]["available"], true);
        assert_eq!(value["agents"]["items"][0]["approvalPending"], true);
        assert_eq!(value["approvals"]["items"].as_array().unwrap().len(), 2);
        assert_eq!(value["costCaps"]["value"]["max_agents"], 6);
        assert_eq!(value["fileOwnership"]["value"]["claimCount"], 1);
        assert_eq!(value["eventCursor"]["value"]["highWaterSeq"], 1);
        assert_eq!(
            value["eventCursor"]["value"]["highWaterEventId"],
            "continuity-test-event"
        );

        let text = serde_json::to_string(&value).unwrap();
        for secret in [
            "INITIAL_PROMPT_SECRET",
            "APPROVAL_PROMPT_SECRET",
            "MCP_SUMMARY_SECRET",
            "EVENT_SECRET_MUST_NOT_APPEAR",
        ] {
            assert!(!text.contains(secret), "secret leaked: {secret}");
        }
        assert!(!text.contains("99.0"));
        assert!(!text.contains("123456"));
    }
}
