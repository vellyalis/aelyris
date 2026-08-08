use axum::{extract::State, Extension, Json};
use serde::Deserialize;

mod agent_activity_read;
mod agent_coordination;
mod agent_diff_read;
mod approval_request;
mod approval_resolution;
mod catalog;
mod cost_caps;
mod dispatch;
mod event_ack;
mod fleet_status;
mod mission_completion;
mod mission_continuity;
mod mission_history;
mod mission_planning;
mod mission_review_settlement;
mod mission_run_next;
mod mux_topology;
mod orchestrator_step;
mod pending_decisions;
mod proofbook_compat_mutations;
mod proofbook_runtime_settlement;
mod review_rejection;
mod session_lifecycle;
mod terminal_inventory;
mod worktree_inventory;

use catalog::{
    input_schema_for_tool, tools_list_value, tools_list_value_filtered, validate_tool_arguments,
};
#[cfg(test)]
use catalog::{input_schema_for_tool_ref, schema_subset_violations, tool_names};
#[cfg(test)]
use dispatch::{event_bus_error_response, push_pending};

use super::{ApiError, ApiResult, ApiState};
#[cfg(test)]
use super::{McpPendingDecision, MAX_MCP_PENDING};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolCallBody {
    name: String,
    #[serde(default)]
    arguments: serde_json::Value,
}

pub(super) fn cockpit_mission_history_projection(
    state: &ApiState,
    repo_path: String,
    limit: Option<usize>,
) -> ApiResult<serde_json::Value> {
    let mut args = serde_json::Map::new();
    args.insert("repoPath".to_string(), serde_json::Value::String(repo_path));
    if let Some(limit) = limit {
        args.insert(
            "limit".to_string(),
            serde_json::Value::from(u64::try_from(limit).map_err(|_| {
                ApiError::BadRequest("Mission history limit is too large".to_string())
            })?),
        );
    }
    mission_history::execute(state, crate::governance::DEFAULT_ACTOR, &args)
}

pub(super) fn cockpit_mission_completion_projection(
    state: &ApiState,
    repo_path: String,
) -> ApiResult<serde_json::Value> {
    let args = serde_json::Map::from_iter([(
        "repoPath".to_string(),
        serde_json::Value::String(repo_path),
    )]);
    mission_completion::execute(state, crate::governance::DEFAULT_ACTOR, &args)
}

pub(super) async fn contract_scoped(
    State(state): State<ApiState>,
    Extension(principal): Extension<crate::governance::Principal>,
) -> Json<serde_json::Value> {
    let tools = scoped_tool_names(&state, &principal.actor);
    Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "server": "aelyris",
        "transport": "local-http-json",
        "auth": "bearer-token",
        "instanceId": state.instance_id,
        "processKind": state.process_kind,
        "tools": tools,
        "nativeOwnedContracts": [
            "aelyris.mcp.server.v1",
            "aelyris.workspace.data.v1",
            "aelyris.mode-preservation.v1",
            "aelyris.history.search.v1",
            "aelyris.agent-identity.v1"
        ],
        "claims": {
            "sessionTruthSource": "rust-pty-manager",
            "muxTruthSource": "rust-mux-manager",
            "webviewRequiredForToolCalls": false,
            "reactRequiredForToolCalls": false,
            "toolDiscoveryPrincipalScoped": true
        }
    }))
}

#[cfg(test)]
pub(super) async fn tools_list() -> Json<serde_json::Value> {
    Json(tools_list_value())
}

pub(super) async fn tools_list_scoped(
    State(state): State<ApiState>,
    Extension(principal): Extension<crate::governance::Principal>,
) -> Json<serde_json::Value> {
    Json(scoped_tools_list_value(&state, &principal.actor))
}

fn scoped_tools_list_value(state: &ApiState, actor: &str) -> serde_json::Value {
    tools_list_value_filtered(|name| state.governance.authorize(actor, name).is_allowed())
}

fn scoped_tool_names(state: &ApiState, actor: &str) -> Vec<String> {
    scoped_tools_list_value(state, actor)
        .get("tools")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool| tool.get("name").and_then(serde_json::Value::as_str))
        .map(str::to_string)
        .collect()
}

fn schema_tool_error(name: &str, payload: serde_json::Value) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": name,
        "ok": false,
        "error": payload,
    }))
}

#[cfg(test)]
pub(super) async fn tools_call(
    State(state): State<ApiState>,
    Json(body): Json<ToolCallBody>,
) -> ApiResult<Json<serde_json::Value>> {
    tools_call_as_actor(&state, crate::governance::DEFAULT_ACTOR, body).await
}

pub(super) async fn tools_call_scoped(
    State(state): State<ApiState>,
    Extension(principal): Extension<crate::governance::Principal>,
    Json(body): Json<ToolCallBody>,
) -> ApiResult<Json<serde_json::Value>> {
    tools_call_as_actor(&state, &principal.actor, body).await
}

pub(super) async fn tools_call_as_actor(
    state: &ApiState,
    actor: &str,
    body: ToolCallBody,
) -> ApiResult<Json<serde_json::Value>> {
    let arguments = if body.arguments.is_null() {
        serde_json::json!({})
    } else {
        body.arguments.clone()
    };
    // One ordered MCP effect boundary: authorization and denial audit always
    // happen before schema validation and the sole authorized dispatcher.
    if let crate::governance::AccessDecision::Deny(reason) =
        state.governance.authorize(actor, &body.name)
    {
        if body.name == "terminal.capture" {
            dispatch::audit_terminal_capture_predispatch_rejection(
                state,
                actor,
                &arguments,
                "governance_denied",
            );
        }
        super::audit_access_denied(&state, actor, &body.name, &reason);
        return Err(ApiError::Forbidden(format!(
            "verb `{}` is not permitted",
            body.name
        )));
    }
    if let Some(schema) = input_schema_for_tool(&body.name) {
        if let Err(report) = validate_tool_arguments(&body.name, &arguments, &schema) {
            if body.name == "terminal.capture" {
                dispatch::audit_terminal_capture_predispatch_rejection(
                    state,
                    actor,
                    &arguments,
                    "schema_violation",
                );
            }
            return Ok(schema_tool_error(&body.name, report.to_payload(&body.name)));
        }
    }
    let args = arguments.as_object().cloned().unwrap_or_default();
    dispatch::dispatch_authorized(state, actor, &body.name, args).await
}

// ---- Native MCP: JSON-RPC 2.0 over Streamable HTTP ----
//
// Lets a standard MCP client (e.g. Claude Code via .mcp.json) register Aelyris as
// a native server, so the aelyris.* verbs appear as native tools instead of being
// driven over the bespoke REST shape. Reuses `tools_list`/`tools_call` verbatim —
// only the JSON-RPC envelope differs, so the verb surface is identical across the
// two faces (one source of truth).

#[derive(Deserialize)]
pub(super) struct JsonRpcReq {
    /// Absent for notifications (which get no response).
    #[serde(default)]
    id: Option<serde_json::Value>,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

const MCP_INSTRUCTIONS: &str = "Aelyris is an autonomous build runtime you (the orchestrator) drive via these aelyris.* tools; the worker agents (real claude/codex/gemini CLIs in isolated worktrees) do the implementation. Loop: (1) For a plain-language Goal, call mission.plan with only {repoPath, goal, optional context}; the backend default planner creates and atomically accepts the Mission plus TaskGraph. The caller cannot supply Mission/plan/task identity, branches, outputs, model, command, status, or packets. After reconnect or restart, call mission.current with only {repoPath} to recover the exact accepted Mission/plan identity plus value-minimized task statuses from the SQLite-backed TaskManager; it never invokes a planner or reads volatile Event Bus state. (2) Advance that Mission with mission.run_next using only {repoPath}. It reuses the cockpit's visible PaneFleet step, derives agent/runtime admission from backend owners, fails closed when a configured budget axis lacks trustworthy telemetry, and stops at Review. The caller cannot supply usage, task identity, model, command, gate, reviewer, merge, or packet authority. orchestrator.step remains a lower-level headless/manual graph operation, not the supported Mission path. (3) For an exact current-Mission task already in Review, call mission.review_and_settle with only {repoPath, taskId}. Before any reviewer, candidate-freeze, or merge effect, the backend revalidates current accepted Mission membership, TaskGraph Review status, and durable activation lineage; generic, stale, unrelated, mixed-graph, and non-Review tasks fail closed. The fixed independent reviewer then consumes the exact-OID merge authority and mints immutable WorkPacket settlement, plus MissionCompletionPacket when aggregate completion is due. The caller cannot supply a verdict, candidate OID, reviewer identity, merge token, or packet. aelyris.request_merge and aelyris.review.approve remain retired. (4) After settlement or reconnect, call mission.completion with only {repoPath}. It reads the current Mission's immutable WorkPacket set and aggregate MissionCompletionPacket from the existing SQLite-backed TaskManager, returns a stable receipt digest and exact packet references, and never replays settlement, review, merge, Event ACK, or Git effects. Call mission.history with {repoPath, optional limit} for a bounded newest-first list of prior/current Mission identity and packet-backed completion state; it never scans Event Bus payload history or exposes Goal/task contents. (5) Coordinate between steps via event.recent / agent.activity, knowledge.impact, intent.propose/list, ownership.conflicts, and blocker_raised. Local-only; concurrency cap 4.";
const MCP_SCOPED_INSTRUCTIONS: &str = "Aelyris exposes a principal-scoped MCP catalog. Discover available operations through tools/list and invoke only returned tools. Catalog visibility is not authority: every tools/call is re-authorized and remains subject to command-risk, approval, review, settlement, and ownership boundaries. Generic orchestration may stop before integration; hidden capabilities must not be inferred. Local-only.";

fn mcp_instructions_for_actor(state: &ApiState, actor: &str) -> &'static str {
    let all_authorized = tools_list_value()
        .get("tools")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|tools| {
            tools.iter().all(|tool| {
                tool.get("name")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|name| state.governance.authorize(actor, name).is_allowed())
            })
        });
    if all_authorized {
        MCP_INSTRUCTIONS
    } else {
        MCP_SCOPED_INSTRUCTIONS
    }
}

/// Native MCP JSON-RPC endpoint. Handles initialize / tools.list / tools.call /
/// ping; everything else is method-not-found.
#[cfg(test)]
pub(super) async fn mcp_rpc(
    State(state): State<ApiState>,
    Json(req): Json<JsonRpcReq>,
) -> axum::response::Response {
    mcp_rpc_for_actor(state, crate::governance::DEFAULT_ACTOR.to_string(), req).await
}

pub(super) async fn mcp_rpc_scoped(
    State(state): State<ApiState>,
    Extension(principal): Extension<crate::governance::Principal>,
    Json(req): Json<JsonRpcReq>,
) -> axum::response::Response {
    mcp_rpc_for_actor(state, principal.actor, req).await
}

async fn mcp_rpc_for_actor(
    state: ApiState,
    actor: String,
    req: JsonRpcReq,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    // Notifications (no id, e.g. notifications/initialized) get no response.
    let Some(id) = req.id.clone() else {
        return axum::http::StatusCode::ACCEPTED.into_response();
    };

    let outcome: Result<serde_json::Value, (i64, String)> = match req.method.as_str() {
        "initialize" => {
            let version = req
                .params
                .get("protocolVersion")
                .and_then(|value| value.as_str())
                .unwrap_or(MCP_PROTOCOL_VERSION)
                .to_string();
            Ok(serde_json::json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "aelyris", "version": env!("CARGO_PKG_VERSION") },
                "instructions": mcp_instructions_for_actor(&state, &actor),
            }))
        }
        "ping" => Ok(serde_json::json!({})),
        "tools/list" => {
            let listed = scoped_tools_list_value(&state, &actor);
            Ok(serde_json::json!({
                "tools": listed.get("tools").cloned().unwrap_or_else(|| serde_json::json!([])),
            }))
        }
        "tools/call" => match req.params.get("name").and_then(|value| value.as_str()) {
            None => Err((-32602, "tools/call requires a string `name`".to_string())),
            Some(name) => {
                let arguments = req
                    .params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let body = ToolCallBody {
                    name: name.to_string(),
                    arguments,
                };
                match tools_call_as_actor(&state, &actor, body).await {
                    Ok(Json(value)) => {
                        let is_error = value
                            .get("ok")
                            .and_then(|value| value.as_bool())
                            .is_some_and(|ok| !ok);
                        let inner = value
                            .get(if is_error { "error" } else { "result" })
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        Ok(serde_json::json!({
                            "content": [{ "type": "text", "text": serde_json::to_string(&inner).unwrap_or_default() }],
                            "structuredContent": inner,
                            "isError": is_error,
                        }))
                    }
                    // MCP convention: a tool-level error is a successful JSON-RPC
                    // result with isError:true (reserve JSON-RPC errors for the
                    // protocol itself).
                    Err(err) => Ok(serde_json::json!({
                        "content": [{ "type": "text", "text": err.to_string() }],
                        "isError": true,
                    })),
                }
            }
        },
        other => Err((-32601, format!("method not found: {other}"))),
    };

    let body = match outcome {
        Ok(result) => serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => serde_json::json!({
            "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message }
        }),
    };
    Json(body).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::sync::Arc;

    const FROZEN_A64_VERBS: [&str; 95] = [
        "terminal.list",
        "terminal.capture",
        "mux.workspaces.list",
        "mux.workspace.get",
        "mux.workspace.safeInput",
        "aelyris.worktree.validate",
        "aelyris.worktree.predictPath",
        "aelyris.worktree.list",
        "aelyris.worktree.create",
        "aelyris.worktree.remove",
        "aelyris.fleet_status",
        "aelyris.cost.get_caps",
        "aelyris.cost.set_caps",
        "aelyris.cost.can_spawn",
        "aelyris.route_agent",
        "aelyris.pane_send_input",
        "aelyris.agent_diff",
        "aelyris.session.summarize",
        "aelyris.session.checkpoint",
        "aelyris.session.handoff",
        "aelyris.session.resume",
        "aelyris.session.reset_context",
        "aelyris.proofbook.list",
        "aelyris.proofbook.get",
        "aelyris.proofbook.validate",
        "aelyris.proofbook.run",
        "aelyris.proofbook.status",
        "aelyris.proofbook.settle_agent_session",
        "aelyris.proofbook.agent_session_candidate",
        "aelyris.proofbook.settle_current_agent_session",
        "aelyris.proofbook.cancel",
        "aelyris.proofbook.cancel_current",
        "aelyris.proofbook.approve_gate",
        "aelyris.proofbook.reject_gate",
        "aelyris.request_approval",
        "aelyris.list_pending_approvals",
        "aelyris.approval.resolve",
        "aelyris.pane.rename",
        "aelyris.pane.set_role",
        "aelyris.request_merge",
        "aelyris.spawn_agent",
        "aelyris.agent.spawn_visible",
        "aelyris.stop_agent",
        "aelyris.review.approve",
        "aelyris.review.reject",
        "aelyris.task.create",
        "aelyris.task.list",
        "aelyris.task.transition",
        "aelyris.orchestrator.plan",
        "aelyris.orchestrator.step",
        "aelyris.mission.completion",
        "aelyris.mission.current",
        "aelyris.mission.history",
        "aelyris.mission.plan",
        "aelyris.mission.run_next",
        "aelyris.mission.review_and_settle",
        "aelyris.supervisor.health",
        "aelyris.event.recent",
        "aelyris.event.by_channel",
        "aelyris.event.since",
        "aelyris.event.poll",
        "aelyris.event.ack",
        "aelyris.shared_brain.snapshot",
        "aelyris.ownership.assign",
        "aelyris.ownership.owner_of",
        "aelyris.ownership.claims",
        "aelyris.ownership.conflicts",
        "aelyris.symbol.claim",
        "aelyris.symbol.refresh",
        "aelyris.symbol.release",
        "aelyris.symbol.release_task",
        "aelyris.symbol.claims",
        "aelyris.symbol.conflicts",
        "aelyris.symbol.claim_from_diff",
        "aelyris.symbol.claim_from_source",
        "aelyris.context.set",
        "aelyris.context.get",
        "aelyris.context.all",
        "aelyris.context.remove",
        "aelyris.agent.report_activity",
        "aelyris.agent.report_blocker",
        "aelyris.agent.steer_avoid",
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

    #[test]
    fn principal_scoped_catalog_hides_denied_tools_without_policy_metadata() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct ReaderPolicy;
        impl AccessControl for ReaderPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "reader-agent"
                    && matches!(verb, "terminal.list" | "aelyris.event.recent")
                {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(ReaderPolicy))));
        let listed = scoped_tools_list_value(&state, "reader-agent");
        let names = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, ["terminal.list", "aelyris.event.recent"]);
        let serialized = serde_json::to_string(&listed).unwrap();
        assert!(!serialized.contains("aelyris.spawn_agent"));
        assert!(!serialized.contains("restricted"));
        assert!(!serialized.contains("deniedCount"));
        assert!(!serialized.contains("totalCount"));
    }

    #[test]
    fn default_operator_scoped_catalog_preserves_the_full_static_catalog() {
        use crate::pty::PtyManager;

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled());
        let scoped = scoped_tool_names(&state, crate::governance::DEFAULT_ACTOR);
        let static_names = tool_names()
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();

        assert_eq!(scoped, static_names);
        assert_eq!(
            mcp_instructions_for_actor(&state, crate::governance::DEFAULT_ACTOR),
            MCP_INSTRUCTIONS
        );
    }

    #[test]
    fn mcp_terminal_inventory_is_value_minimized_deterministic_and_read_only() {
        use crate::pty::{PtyManager, ShellType, TerminalInfo};

        let secret_cwd_a = "C:/AIO40/SECRET_WORKTREE_A";
        let secret_cwd_b = "C:/AIO40/SECRET_WORKTREE_B";
        let secret_spawn_a = "AIO40_SECRET_SPAWN_TOKEN_A";
        let secret_spawn_b = "AIO40_SECRET_SPAWN_TOKEN_B";
        let projection = terminal_inventory::project(vec![
            TerminalInfo {
                id: "terminal-b".to_string(),
                short_id: None,
                shell_type: ShellType::Cmd,
                cwd: secret_cwd_b.to_string(),
                uptime_secs: 11,
                process_id: Some(91_002),
                spawn_token: secret_spawn_b.to_string(),
            },
            TerminalInfo {
                id: "terminal-a".to_string(),
                short_id: Some(7),
                shell_type: ShellType::PowerShell,
                cwd: secret_cwd_a.to_string(),
                uptime_secs: 23,
                process_id: Some(91_001),
                spawn_token: secret_spawn_a.to_string(),
            },
        ]);

        assert_eq!(projection["source"], "rust-pty-manager");
        assert_eq!(projection["sessionCount"], 2);
        assert_eq!(projection["exactTerminalIdentityReturned"], true);
        assert_eq!(projection["filesystemPathsExposed"], false);
        assert_eq!(projection["processIdentityExposed"], false);
        assert_eq!(projection["runtimeGenerationExposed"], false);
        assert_eq!(projection["readOnly"], true);
        assert_eq!(projection["sessions"][0]["id"], "terminal-a");
        assert_eq!(projection["sessions"][0]["shortId"], 7);
        assert_eq!(projection["sessions"][0]["shellType"], "powershell");
        assert_eq!(projection["sessions"][0]["uptimeSecs"], 23);
        assert_eq!(projection["sessions"][1]["id"], "terminal-b");
        assert!(projection["sessions"][1].get("shortId").is_none());
        assert_eq!(projection["sessions"][1]["shellType"], "cmd");

        let serialized = serde_json::to_string(&projection).expect("serialize inventory");
        for forbidden in [
            secret_cwd_a,
            secret_cwd_b,
            secret_spawn_a,
            secret_spawn_b,
            "\"cwd\"",
            "\"processId\"",
            "\"process_id\"",
            "\"spawnToken\"",
            "\"spawn_token\"",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "terminal inventory exposed {forbidden}"
            );
        }

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled());
        let listed = scoped_tools_list_value(&state, "terminal-reader");
        let tool = listed["tools"]
            .as_array()
            .expect("tool catalog")
            .iter()
            .find(|tool| tool["name"] == "terminal.list")
            .expect("terminal list is principal-visible");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["outputSensitivity"], "value-minimized-coordination");
        assert_eq!(tool["readOnly"], true);
    }

    #[test]
    fn mcp_mux_topology_is_value_minimized_deterministic_and_read_only() {
        use crate::mux::graph::{
            graph_from_single_pane, AgentContext, LifecycleState, MuxClientMode, MuxClientRecord,
            PaneRecord, ProjectContext, PtyBinding,
        };
        use crate::mux::layout::SplitAxis;
        use crate::pty::PtyManager;

        let secret_workspace_name = "AIO41_SECRET_WORKSPACE_NAME";
        let secret_window_title = "AIO41_SECRET_WINDOW_TITLE";
        let secret_tab_title = "AIO41_SECRET_TAB_TITLE";
        let secret_pane_title = "AIO41_SECRET_PANE_TITLE";
        let secret_shell = "AIO41_SECRET_SHELL_COMMAND";
        let secret_cwd = "C:/AIO41/SECRET_CWD";
        let secret_project_path = "C:/AIO41/SECRET_PROJECT";
        let secret_worktree_path = "C:/AIO41/SECRET_WORKTREE";
        let secret_branch = "AIO41_SECRET_BRANCH";
        let secret_task = "AIO41_SECRET_TASK";
        let secret_workflow = "AIO41_SECRET_WORKFLOW";
        let secret_agent = "AIO41_SECRET_AGENT";
        let secret_provider = "AIO41_SECRET_PROVIDER";
        let secret_permission = "AIO41_SECRET_PERMISSION";
        let secret_client = "AIO41_SECRET_CLIENT";
        let secret_dead_reason = "AIO41_SECRET_DEAD_REASON";

        let mut graph_b = graph_from_single_pane(
            "workspace-b",
            secret_workspace_name,
            "window-b",
            "tab-b",
            PaneRecord::new("pane-b", secret_pane_title, secret_shell, secret_cwd),
        );
        {
            let workspace = graph_b
                .workspaces
                .get_mut("workspace-b")
                .expect("workspace-b");
            workspace.project_path = Some(secret_project_path.to_string());
            workspace.clients.insert(
                secret_client.to_string(),
                MuxClientRecord::new(
                    secret_client,
                    "workspace-b",
                    "window-b",
                    MuxClientMode::ReadWrite,
                    123_456,
                ),
            );
            let window = workspace.windows.get_mut("window-b").expect("window-b");
            window.title = secret_window_title.to_string();
            let tab = window.tabs.get_mut("tab-b").expect("tab-b");
            tab.title = secret_tab_title.to_string();
            tab.synchronized_panes = true;
            let pane_b = tab.panes.get_mut("pane-b").expect("pane-b");
            pane_b.role = Some("implementer".to_string());
            pane_b.lifecycle = LifecycleState::Active;
            pane_b.pty = Some(PtyBinding {
                terminal_id: "terminal-b".to_string(),
                process_id: Some(92_002),
                cols: 120,
                rows: 40,
            });
            pane_b.project = Some(ProjectContext {
                project_path: secret_project_path.to_string(),
                branch: Some(secret_branch.to_string()),
                worktree_path: Some(secret_worktree_path.to_string()),
                task_id: Some(secret_task.to_string()),
                workflow_id: Some(secret_workflow.to_string()),
            });
            pane_b.agent = Some(AgentContext {
                agent_id: secret_agent.to_string(),
                provider: secret_provider.to_string(),
                role: Some("builder".to_string()),
                permission_profile: Some(secret_permission.to_string()),
            });

            let mut pane_a = PaneRecord::new(
                "pane-a",
                "AIO41_SECRET_PANE_TITLE_A",
                "AIO41_SECRET_SHELL_A",
                "C:/AIO41/SECRET_CWD_A",
            );
            pane_a.role = Some("reviewer".to_string());
            pane_a.lifecycle = LifecycleState::Dead {
                reason: secret_dead_reason.to_string(),
            };
            pane_a.pty = Some(PtyBinding {
                terminal_id: "terminal-a".to_string(),
                process_id: Some(92_001),
                cols: 100,
                rows: 30,
            });
            pane_a.project = pane_b.project.clone();
            pane_a.agent = pane_b.agent.clone();
            tab.split_pane("pane-b", pane_a, SplitAxis::Horizontal)
                .expect("split pane");
        }
        graph_b.validate().expect("graph-b valid");

        let graph_a = graph_from_single_pane(
            "workspace-a",
            "workspace-a-name",
            "window-a",
            "tab-a",
            PaneRecord::new("pane-z", "pane-z", "powershell", "C:/safe-test"),
        );
        graph_a.validate().expect("graph-a valid");

        let listed_projection = mux_topology::project_list(vec![&graph_b, &graph_a]);
        assert_eq!(listed_projection["source"], "rust-mux-manager");
        assert_eq!(listed_projection["workspaceCount"], 2);
        assert_eq!(listed_projection["workspaces"][0]["id"], "workspace-a");
        assert_eq!(listed_projection["workspaces"][1]["id"], "workspace-b");
        assert_eq!(listed_projection["readOnly"], true);

        let graph_projection = mux_topology::project_graph(&graph_b);
        assert_eq!(graph_projection["workspaceId"], "workspace-b");
        assert_eq!(graph_projection["source"], "rust-mux-manager");
        assert_eq!(graph_projection["exactTopologyReturned"], true);
        assert_eq!(graph_projection["filesystemPathsExposed"], false);
        assert_eq!(graph_projection["titlesExposed"], false);
        assert_eq!(graph_projection["processIdentityExposed"], false);
        assert_eq!(graph_projection["clientRecordsExposed"], false);
        assert_eq!(graph_projection["projectMetadataExposed"], false);
        assert_eq!(graph_projection["agentMetadataExposed"], false);
        assert_eq!(graph_projection["readOnly"], true);
        let tab = &graph_projection["graph"]["workspaces"]["workspace-b"]["windows"]["window-b"]
            ["tabs"]["tab-b"];
        assert_eq!(tab["synchronizedPanes"], true);
        assert_eq!(tab["panes"]["pane-a"]["role"], "reviewer");
        assert_eq!(tab["panes"]["pane-a"]["lifecycle"]["state"], "dead");
        assert_eq!(tab["panes"]["pane-a"]["pty"]["terminalId"], "terminal-a");
        assert_eq!(tab["panes"]["pane-a"]["pty"]["cols"], 100);
        assert_eq!(tab["panes"]["pane-a"]["pty"]["rows"], 30);
        assert!(tab["panes"]["pane-a"]["pty"].get("processId").is_none());
        assert!(tab["layout"]["root"].is_object());

        let serialized = serde_json::to_string(&graph_projection).expect("serialize topology");
        for forbidden in [
            secret_workspace_name,
            secret_window_title,
            secret_tab_title,
            secret_pane_title,
            secret_shell,
            secret_cwd,
            secret_project_path,
            secret_worktree_path,
            secret_branch,
            secret_task,
            secret_workflow,
            secret_agent,
            secret_provider,
            secret_permission,
            secret_client,
            secret_dead_reason,
            "\"title\"",
            "\"shell\"",
            "\"cwd\"",
            "\"processId\"",
            "\"projectPath\"",
            "\"worktreePath\"",
            "\"taskId\"",
            "\"workflowId\"",
            "\"agentId\"",
            "\"provider\"",
            "\"permissionProfile\"",
            "\"clients\"",
            "\"lastSeenAtMs\"",
            "\"reason\"",
        ] {
            assert!(
                !serialized.contains(forbidden),
                "mux topology exposed {forbidden}"
            );
        }

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled());
        {
            let mut mux = state.mux.lock().expect("mux lock");
            mux.insert_graph(graph_b).expect("insert graph-b");
            mux.insert_graph(graph_a).expect("insert graph-a");
        }
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let call = |name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "mux-reader",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let Json(listed) =
            call("mux.workspaces.list", serde_json::json!({})).expect("list mux workspaces");
        assert_eq!(listed["result"]["workspaces"][0]["id"], "workspace-a");
        let Json(got) = call(
            "mux.workspace.get",
            serde_json::json!({ "workspaceId": "workspace-b" }),
        )
        .expect("get mux topology");
        assert_eq!(got["result"]["exactTopologyReturned"], true);
        assert!(matches!(
            call(
                "mux.workspace.get",
                serde_json::json!({ "workspaceId": "missing-workspace" }),
            ),
            Err(ApiError::NotFound(value)) if value == "missing-workspace"
        ));

        let catalog = scoped_tools_list_value(&state, "mux-reader");
        for name in ["mux.workspaces.list", "mux.workspace.get"] {
            let tool = catalog["tools"]
                .as_array()
                .expect("tool catalog")
                .iter()
                .find(|tool| tool["name"] == name)
                .expect("mux tool is principal-visible");
            assert_eq!(tool["accessMode"], "observe-only");
            assert_eq!(tool["outputSensitivity"], "value-minimized-coordination");
            assert_eq!(tool["readOnly"], true);
        }
    }

    #[test]
    fn mcp_agent_diff_is_exact_layer_scoped_and_honest_about_raw_source() {
        use std::path::PathBuf;

        use crate::ghostdiff::{DiffHunk, FileDelta, HunkLine, LayerRegistry, LayerTint};
        use crate::pty::PtyManager;

        let target_layer_id = "aio42-target-layer";
        let unrelated_layer_id = "AIO42_UNRELATED_LAYER_MUST_NOT_BE_RETURNED";
        let target_worktree = "C:/AIO42/SECRET_TARGET_WORKTREE";
        let target_repo = "C:/AIO42/SECRET_TARGET_REPOSITORY";
        let target_branch = "AIO42_SECRET_TARGET_BRANCH";
        let target_tint = "AIO42_SECRET_TARGET_TINT";
        let unrelated_worktree = "C:/AIO42/SECRET_UNRELATED_WORKTREE";
        let unrelated_repo = "C:/AIO42/SECRET_UNRELATED_REPOSITORY";
        let unrelated_branch = "AIO42_SECRET_UNRELATED_BRANCH";
        let raw_base = "AIO42_RAW_BASE_SOURCE";
        let raw_head = "AIO42_RAW_HEAD_SOURCE";
        let selected_path = "src/selected.rs";

        let layers = Arc::new(LayerRegistry::new());
        layers
            .register_worktree_layer(
                target_layer_id.to_string(),
                PathBuf::from(target_worktree),
                target_branch.to_string(),
                PathBuf::from(target_repo),
                LayerTint {
                    role_color: "#123456".to_string(),
                    role_label: target_tint.to_string(),
                },
                "target-base-sha".to_string(),
                20,
            )
            .expect("register target layer");
        layers
            .refresh(
                target_layer_id,
                vec![
                    FileDelta {
                        path: "z-last.rs".to_string(),
                        hunks: Vec::new(),
                        base_content: "z-base".to_string(),
                        head_content: "z-head".to_string(),
                    },
                    FileDelta {
                        path: selected_path.to_string(),
                        hunks: vec![DiffHunk {
                            base_start: 1,
                            base_len: 1,
                            head_start: 1,
                            head_len: 1,
                            lines: vec![
                                HunkLine::Remove(raw_base.to_string()),
                                HunkLine::Add(raw_head.to_string()),
                            ],
                        }],
                        base_content: raw_base.to_string(),
                        head_content: raw_head.to_string(),
                    },
                ],
            )
            .expect("refresh target layer");
        layers
            .register_worktree_layer(
                unrelated_layer_id.to_string(),
                PathBuf::from(unrelated_worktree),
                unrelated_branch.to_string(),
                PathBuf::from(unrelated_repo),
                LayerTint {
                    role_color: "#654321".to_string(),
                    role_label: "AIO42_SECRET_UNRELATED_TINT".to_string(),
                },
                "unrelated-base-sha".to_string(),
                10,
            )
            .expect("register unrelated layer");
        layers
            .refresh(
                unrelated_layer_id,
                vec![FileDelta {
                    path: "AIO42_UNRELATED_FILE.rs".to_string(),
                    hunks: Vec::new(),
                    base_content: "AIO42_UNRELATED_BASE".to_string(),
                    head_content: "AIO42_UNRELATED_HEAD".to_string(),
                }],
            )
            .expect("refresh unrelated layer");

        let before = layers.snapshot();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_ghost_layers(layers.clone());
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let call = |arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "diff-reader",
                ToolCallBody {
                    name: "aelyris.agent_diff".to_string(),
                    arguments,
                },
            ))
        };

        let Json(summary) = call(serde_json::json!({
            "sessionId": target_layer_id,
        }))
        .expect("read exact layer summary");
        assert_eq!(summary["result"]["source"], "ghostdiff-layer-registry");
        assert_eq!(summary["result"]["layer"]["id"], target_layer_id);
        assert_eq!(summary["result"]["layer"]["sourceKind"], "worktree");
        assert_eq!(summary["result"]["layer"]["fileCount"], 2);
        assert_eq!(summary["result"]["layer"]["hunkCount"], 1);
        assert_eq!(
            summary["result"]["layer"]["filePaths"],
            serde_json::json!([selected_path, "z-last.rs"])
        );
        assert!(summary["result"].get("file").is_none());
        assert_eq!(summary["result"]["rawSourceReturned"], false);
        assert_eq!(summary["result"]["sensitiveOutputPossible"], false);
        assert_eq!(summary["result"]["repoRelativePathsReturned"], true);
        assert_eq!(summary["result"]["filesystemPathsExposed"], false);
        assert_eq!(summary["result"]["unrelatedLayersExposed"], false);
        assert_eq!(summary["result"]["readOnly"], true);
        let summary_text = serde_json::to_string(&summary["result"]).expect("summary json");
        for forbidden in [
            unrelated_layer_id,
            target_worktree,
            target_repo,
            target_branch,
            target_tint,
            unrelated_worktree,
            unrelated_repo,
            unrelated_branch,
            "AIO42_SECRET_UNRELATED_TINT",
            "AIO42_UNRELATED_FILE.rs",
            "AIO42_UNRELATED_BASE",
            raw_base,
            raw_head,
            "\"tint\"",
            "\"branch\"",
            "\"repoPath\"",
            "\"worktreePath\"",
        ] {
            assert!(
                !summary_text.contains(forbidden),
                "summary exposed {forbidden}"
            );
        }

        let Json(raw_file) = call(serde_json::json!({
            "sessionId": target_layer_id,
            "path": selected_path,
            "against": "base",
        }))
        .expect("read exact raw file delta");
        assert_eq!(raw_file["result"]["file"]["path"], selected_path);
        assert_eq!(raw_file["result"]["file"]["baseContent"], raw_base);
        assert_eq!(raw_file["result"]["file"]["headContent"], raw_head);
        assert_eq!(raw_file["result"]["rawSourceReturned"], true);
        assert_eq!(raw_file["result"]["sensitiveOutputPossible"], true);
        assert_eq!(raw_file["result"]["readOnly"], true);

        assert!(matches!(
            call(serde_json::json!({ "sessionId": "missing-layer" })),
            Err(ApiError::NotFound(value)) if value.contains("missing-layer")
        ));
        assert!(matches!(
            call(serde_json::json!({
                "sessionId": target_layer_id,
                "path": "src/missing.rs",
            })),
            Err(ApiError::NotFound(value)) if value.contains("src/missing.rs")
        ));
        assert!(matches!(
            call(serde_json::json!({
                "sessionId": target_layer_id,
                "against": "target",
                "targetBranch": "feature/not-actually-compared",
            })),
            Err(ApiError::BadRequest(message)) if message.contains("not implemented")
        ));
        assert!(matches!(
            call(serde_json::json!({
                "sessionId": target_layer_id,
                "targetBranch": "feature/irrelevant",
            })),
            Err(ApiError::BadRequest(message)) if message.contains("targetBranch")
        ));
        assert_eq!(layers.snapshot(), before, "read must not mutate GhostDiff");

        let catalog = scoped_tools_list_value(&state, "diff-reader");
        let tool = catalog["tools"]
            .as_array()
            .expect("tool catalog")
            .iter()
            .find(|tool| tool["name"] == "aelyris.agent_diff")
            .expect("agent diff is principal-visible");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["outputSensitivity"], "conditional-sensitive-source");
        assert_eq!(tool["readOnly"], true);
    }

    #[test]
    fn mcp_terminal_capture_is_principal_bound_and_sensitive_boundary_explicit() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::{FilePtyScrollbackStore, PtyManager};

        struct DenyBlockedCapture;
        impl AccessControl for DenyBlockedCapture {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "blocked-reader" && verb == "terminal.capture" {
                    AccessDecision::Deny("capture denied".to_string())
                } else {
                    AccessDecision::Allow
                }
            }
        }

        let scrollback = tempfile::tempdir().expect("scrollback dir");
        let terminal_id = "AIO39_TERMINAL_ID_MUST_NOT_BE_LOGGED";
        let stale_terminal_id = "AIO39_STALE_TERMINAL_ID_MUST_NOT_BE_LOGGED";
        let pty_failure_id = "AIO39_PTY_FAILURE_ID_MUST_NOT_BE_LOGGED";
        let raw_output = "\x1b[31mAIO39_SECRET_OUTPUT_MUST_NOT_BE_LOGGED\x1b[0m\nsecond raw line";
        FilePtyScrollbackStore::new(scrollback.path())
            .append(terminal_id, raw_output)
            .expect("seed durable scrollback");
        std::fs::create_dir(scrollback.path().join(format!("{pty_failure_id}.log")))
            .expect("seed unreadable scrollback target");
        let pty = PtyManager::new().with_scrollback_dir(scrollback.path());
        let db = Arc::new(ManagedDb::new(Database::open_memory().expect("memory db")));
        let state = ApiState::new(pty.clone(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()));

        let listed = scoped_tools_list_value(&state, "capture-reader");
        let tool = listed["tools"]
            .as_array()
            .expect("tool catalog")
            .iter()
            .find(|tool| tool["name"] == "terminal.capture")
            .expect("capture tool is principal-visible");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["outputSensitivity"], "sensitive-raw-output");
        assert_eq!(tool["rawScrollbackReturned"], true);
        assert_eq!(tool["sensitiveOutputPossible"], true);
        assert_eq!(tool["readOnly"], true);

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let call = |state: &ApiState, actor: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "terminal.capture".to_string(),
                    arguments,
                },
            ))
        };

        let Json(captured) = call(
            &state,
            "capture-reader",
            serde_json::json!({
                "sessionId": terminal_id,
                "lines": 2,
                "clean": false,
            }),
        )
        .expect("capture succeeds");
        assert_eq!(captured["result"]["sessionId"], terminal_id);
        assert_eq!(captured["result"]["text"], raw_output);
        assert_eq!(captured["result"]["lines"], 2);
        assert_eq!(captured["result"]["clean"], false);
        assert_eq!(captured["result"]["source"], "rust-pty-manager");
        assert_eq!(captured["result"]["rawScrollbackReturned"], true);
        assert_eq!(captured["result"]["sensitiveOutputPossible"], true);
        assert_eq!(captured["result"]["readOnly"], true);

        let unauthenticated = call(
            &state,
            "  ",
            serde_json::json!({
                "sessionId": terminal_id,
                "lines": 2,
                "clean": false,
            }),
        );
        assert!(matches!(
            unauthenticated,
            Err(ApiError::Forbidden(message)) if message.contains("authenticated terminal capture Principal")
        ));

        let invalid = call(
            &state,
            "capture-reader",
            serde_json::json!({
                "sessionId": "%404",
                "lines": 3,
                "clean": false,
            }),
        );
        assert!(matches!(
            invalid,
            Err(ApiError::BadRequest(message)) if message.contains("unknown terminal reference")
        ));

        let stale = call(
            &state,
            "capture-reader",
            serde_json::json!({
                "sessionId": stale_terminal_id,
                "lines": 4,
                "clean": true,
            }),
        );
        assert!(matches!(
            stale,
            Err(ApiError::NotFound(value)) if value == stale_terminal_id
        ));

        let pty_failure = call(
            &state,
            "capture-reader",
            serde_json::json!({
                "sessionId": pty_failure_id,
                "lines": 5,
                "clean": false,
            }),
        );
        assert!(matches!(
            pty_failure,
            Err(ApiError::Internal(message)) if message.contains("scrollback capture")
        ));

        let Json(schema_rejected) = call(
            &state,
            "capture-reader",
            serde_json::json!({ "lines": 6, "clean": true }),
        )
        .expect("schema failure remains a typed tool result");
        assert_eq!(schema_rejected["ok"], false);
        assert_eq!(
            schema_rejected["error"]["schema_violation"]["missing"],
            serde_json::json!(["sessionId"])
        );

        let denied_state = ApiState::new(pty.clone(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_governance(Arc::new(Governance::with_access(Box::new(
                DenyBlockedCapture,
            ))));
        let denied = call(
            &denied_state,
            "blocked-reader",
            serde_json::json!({
                "sessionId": terminal_id,
                "lines": 7,
                "clean": false,
            }),
        );
        assert!(matches!(denied, Err(ApiError::Forbidden(_))));
        assert!(!scoped_tool_names(&denied_state, "blocked-reader")
            .iter()
            .any(|name| name == "terminal.capture"));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_terminal_capture_read".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read terminal capture audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            1
        );
        let accepted = rows
            .iter()
            .find(|row| row.redacted_payload_json["status"] == "accepted")
            .expect("accepted capture audit");
        assert_eq!(accepted.agent_id.as_deref(), Some("capture-reader"));
        assert_eq!(accepted.redacted_payload_json["operation"], "capture");
        assert_eq!(accepted.redacted_payload_json["requestedLineBound"], 2);
        assert_eq!(accepted.redacted_payload_json["clean"], false);
        assert_eq!(
            accepted.redacted_payload_json["outputCharacterCount"],
            raw_output.chars().count()
        );
        assert_eq!(accepted.redacted_payload_json["outputLineCount"], 2);
        for field in ["sessionDigest", "inputDigest"] {
            let digest = accepted.redacted_payload_json[field]
                .as_str()
                .expect("terminal capture digest");
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
        }
        for row in &rows {
            assert_eq!(row.redacted_payload_json["capturedTextLogged"], false);
            assert_eq!(row.redacted_payload_json["terminalIdentityLogged"], false);
            assert_eq!(row.redacted_payload_json["requestPayloadLogged"], false);
            if row.redacted_payload_json["status"] == "rejected" {
                assert_eq!(row.redacted_payload_json["outputCharacterCount"], 0);
                assert_eq!(row.redacted_payload_json["outputLineCount"], 0);
            }
        }
        for rejection_code in [
            "invalid_terminal_identity",
            "stale_terminal_identity",
            "pty_capture_failed",
            "schema_violation",
            "governance_denied",
        ] {
            assert!(rows
                .iter()
                .any(|row| { row.redacted_payload_json["rejectionCode"] == rejection_code }));
        }
        let audit_text = serde_json::to_string(&rows).expect("serialize capture audit");
        for forbidden in [
            terminal_id,
            stale_terminal_id,
            pty_failure_id,
            "%404",
            "AIO39_SECRET_OUTPUT_MUST_NOT_BE_LOGGED",
            "second raw line",
        ] {
            assert!(!audit_text.contains(forbidden), "audit exposed {forbidden}");
        }

        let audit_failure_db = Arc::new(ManagedDb::new(
            Database::open_memory().expect("audit failure memory db"),
        ));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio39_terminal_capture_audit
                         BEFORE INSERT ON audit_event_journal
                         WHEN NEW.kind = 'mcp_terminal_capture_read'
                         BEGIN
                             SELECT RAISE(ABORT, 'simulated terminal capture audit failure');
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .expect("install audit failure trigger");
        let audit_failure_state = ApiState::new(pty, crate::api::AuthConfig::with_token("t"))
            .with_db(Some(audit_failure_db.clone()));
        let Json(captured_after_audit_failure) = call(
            &audit_failure_state,
            "capture-reader",
            serde_json::json!({
                "sessionId": terminal_id,
                "lines": 2,
                "clean": false,
            }),
        )
        .expect("audit failure preserves the single capture result");
        assert_eq!(captured_after_audit_failure["result"]["text"], raw_output);
        assert_eq!(
            captured_after_audit_failure["result"]["rawScrollbackReturned"],
            true
        );
        let audit_failure_rows = audit_failure_db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_terminal_capture_read".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read empty failed-audit journal");
        assert!(audit_failure_rows.is_empty());
    }

    #[test]
    fn mcp_cost_get_caps_reads_the_shared_truthful_owner() {
        use crate::cost::{CostCaps, CostCapsRestoreOutcome, CostManager};
        use crate::db::{Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct CostReaderPolicy;
        impl AccessControl for CostReaderPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "budget-reader" && verb == "aelyris.cost.get_caps" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let db = ManagedDb::new(Database::open_memory().unwrap());
        let manager = Arc::new(CostManager::new());
        assert_eq!(manager.attach_db(db), CostCapsRestoreOutcome::Missing);
        let configured = CostCaps {
            max_agents: Some(7),
            max_tokens: Some(88_000),
            max_cost_usd: Some(3.25),
            max_runtime_secs: None,
        };
        assert_eq!(manager.set_caps(configured).unwrap(), configured);

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_cost_manager(manager.clone())
            .with_governance(Arc::new(Governance::with_access(Box::new(
                CostReaderPolicy,
            ))));
        let schema = input_schema_for_tool_ref("aelyris.cost.get_caps").unwrap();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["properties"].is_null());
        let listed = scoped_tool_names(&state, "budget-reader");
        assert_eq!(listed, ["aelyris.cost.get_caps"]);

        let rt = tokio::runtime::Runtime::new().unwrap();
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "budget-reader",
                ToolCallBody {
                    name: "aelyris.cost.get_caps".to_string(),
                    arguments: serde_json::json!({}),
                },
            ))
            .expect("authorized cost cap read");
        assert_eq!(value["result"]["caps"]["max_agents"], 7);
        assert_eq!(value["result"]["caps"]["max_tokens"], 88_000);
        assert_eq!(value["result"]["caps"]["max_cost_usd"], 3.25);
        assert_eq!(
            value["result"]["caps"]["max_runtime_secs"],
            serde_json::Value::Null,
            "disabled cap stays null rather than zero"
        );
        assert_eq!(
            value["result"]["policy"]["min_agents"],
            crate::cost::MIN_CONFIGURED_AGENTS
        );
        assert_eq!(
            value["result"]["policy"]["max_agents"],
            crate::cost::MAX_CONFIGURED_AGENTS
        );
        assert_eq!(value["result"]["source"], "shared-cost-manager");
        assert_eq!(
            value["result"]["telemetryBoundary"],
            "reported_aelyris_telemetry"
        );
        assert_eq!(value["result"]["providerBillingClaimed"], false);
        assert_eq!(value["result"]["unknownUsageZeroFilled"], false);
        assert_eq!(value["result"]["readOnly"], true);
        assert_eq!(manager.caps(), configured);

        let denied = rt.block_on(tools_call_as_actor(
            &state,
            "blocked-reader",
            ToolCallBody {
                name: "aelyris.cost.get_caps".to_string(),
                arguments: serde_json::json!({}),
            },
        ));
        assert!(matches!(denied, Err(ApiError::Forbidden(_))));
        assert!(scoped_tool_names(&state, "blocked-reader").is_empty());

        let unavailable = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(
                CostReaderPolicy,
            ))));
        let missing = rt.block_on(tools_call_as_actor(
            &unavailable,
            "budget-reader",
            ToolCallBody {
                name: "aelyris.cost.get_caps".to_string(),
                arguments: serde_json::json!({}),
            },
        ));
        assert!(matches!(
            missing,
            Err(ApiError::Internal(message)) if message.contains("cost manager is not attached")
        ));
    }

    #[test]
    fn mcp_cost_set_caps_is_conflict_safe_principal_bound_and_value_free() {
        use crate::cost::{CostCaps, CostCapsRestoreOutcome, CostManager};
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        fn wire(caps: CostCaps) -> serde_json::Value {
            serde_json::to_value(caps).expect("serialize caps")
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let manager = Arc::new(CostManager::new());
        assert_eq!(
            manager.attach_db(db.as_ref().clone()),
            CostCapsRestoreOutcome::Missing
        );
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_db(Some(db.clone()))
            .with_cost_manager(manager.clone());
        let schema = input_schema_for_tool_ref("aelyris.cost.set_caps").unwrap();
        assert_eq!(
            schema["required"],
            serde_json::json!(["expectedCaps", "caps"])
        );
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            schema["properties"]["caps"]["properties"]["max_runtime_secs"]["type"],
            serde_json::json!(["integer", "null"])
        );
        let Json(listed) = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(tools_list());
        let tool = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.cost.set_caps")
            .expect("cost set tool is cataloged");
        assert_eq!(tool["safety"], "GATED");

        let actor = "cost-cap-operator";
        let initial = CostCaps::default();
        let configured = CostCaps {
            max_agents: Some(7),
            max_tokens: Some(987_654_321),
            max_cost_usd: Some(17.375),
            max_runtime_secs: None,
        };
        let next = CostCaps {
            max_agents: Some(8),
            max_tokens: None,
            max_cost_usd: Some(21.625),
            max_runtime_secs: Some(7_654),
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str, expected: CostCaps, replacement: CostCaps| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.cost.set_caps".to_string(),
                    arguments: serde_json::json!({
                        "expectedCaps": wire(expected),
                        "caps": wire(replacement),
                    }),
                },
            ))
        };

        assert!(matches!(
            call(&state, "  ", initial, configured),
            Err(ApiError::Forbidden(_))
        ));
        let Json(updated) = call(&state, actor, initial, configured).expect("conditional update");
        assert_eq!(updated["result"]["caps"], wire(configured));
        assert_eq!(updated["result"]["changed"], true);
        assert_eq!(updated["result"]["source"], "shared-cost-manager");
        assert_eq!(updated["result"]["providerBillingClaimed"], false);
        assert_eq!(updated["result"]["unknownUsageZeroFilled"], false);
        assert_eq!(manager.caps(), configured);

        db.with(|database| {
            database
                .conn()
                .execute_batch(
                    "CREATE TRIGGER reject_aio30_unchanged_write
                     BEFORE UPDATE ON cost_caps_state
                     BEGIN
                         SELECT RAISE(ABORT, 'unchanged caps must not persist');
                     END;",
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let Json(unchanged) =
            call(&state, actor, configured, configured).expect("unchanged CAS is a no-op");
        assert_eq!(unchanged["result"]["changed"], false);
        assert_eq!(manager.caps(), configured);
        db.with(|database| {
            database
                .conn()
                .execute_batch("DROP TRIGGER reject_aio30_unchanged_write;")
                .map_err(|error| error.to_string())
        })
        .unwrap();

        let stale = call(&state, actor, initial, next);
        assert!(matches!(
            stale,
            Err(ApiError::Conflict(message)) if message.contains("stale_cost_caps")
        ));
        assert_eq!(manager.caps(), configured);

        let invalid = CostCaps {
            max_agents: None,
            ..configured
        };
        let validation = call(&state, actor, configured, invalid);
        assert!(matches!(
            validation,
            Err(ApiError::BadRequest(message)) if message.contains("invalid_cost_caps")
        ));
        assert_eq!(manager.caps(), configured);

        db.with(|database| {
            database
                .conn()
                .execute_batch(
                    "CREATE TRIGGER reject_aio30_cost_caps_update
                     BEFORE UPDATE ON cost_caps_state
                     BEGIN
                         SELECT RAISE(ABORT, 'simulated cost cap persistence failure');
                     END;",
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let persistence = call(&state, actor, configured, next);
        assert!(matches!(
            persistence,
            Err(ApiError::Internal(message)) if message.contains("cost_caps_persistence_failed")
        ));
        assert_eq!(manager.caps(), configured);

        let unavailable = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_db(Some(db.clone()));
        let missing = call(&unavailable, actor, configured, next);
        assert!(matches!(
            missing,
            Err(ApiError::Internal(message)) if message.contains("cost manager is not attached")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_cost_caps_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read cost cap mutation audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some(actor)));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            2
        );
        for outcome in [
            "updated",
            "unchanged",
            "stale",
            "validation_failed",
            "persistence_failed",
        ] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["outcome"] == outcome));
        }
        for code in [
            "stale_cost_caps",
            "invalid_cost_caps",
            "cost_caps_persistence_failed",
            "cost_manager_unavailable",
        ] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["rejectionCode"] == code));
        }
        for row in &rows {
            assert_eq!(row.redacted_payload_json["capValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["providerUsageLogged"], false);
            assert_eq!(row.redacted_payload_json["providerBillingClaimed"], false);
            assert_eq!(row.redacted_payload_json["unknownUsageZeroFilled"], false);
            assert!(row.redacted_payload_json.get("caps").is_none());
            assert!(row.redacted_payload_json.get("expectedCaps").is_none());
            for field in ["expectedDigest", "replacementDigest"] {
                let digest = row.redacted_payload_json[field]
                    .as_str()
                    .expect("cost cap digest");
                assert_eq!(digest.len(), 64);
                assert!(digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()));
            }
            let audit_text = serde_json::to_string(row).unwrap();
            for forbidden_key in [
                "max_agents",
                "max_tokens",
                "max_cost_usd",
                "max_runtime_secs",
            ] {
                assert!(
                    !audit_text.contains(forbidden_key),
                    "audit exposed cap field {forbidden_key}"
                );
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let audit_failure_manager = Arc::new(CostManager::new());
        assert_eq!(
            audit_failure_manager.attach_db(audit_failure_db.as_ref().clone()),
            CostCapsRestoreOutcome::Missing
        );
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio30_cost_caps_audit
                         BEFORE INSERT ON audit_event_journal
                         WHEN NEW.kind = 'mcp_cost_caps_mutation_authority'
                         BEGIN
                             SELECT RAISE(ABORT, 'simulated cost cap audit failure');
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
                .with_db(Some(audit_failure_db))
                .with_cost_manager(audit_failure_manager.clone());
        let Json(audit_failure_result) = call(&audit_failure_state, actor, initial, configured)
            .expect("audit failure does not replay or reject successful cap update");
        assert_eq!(audit_failure_result["result"]["changed"], true);
        assert_eq!(audit_failure_manager.caps(), configured);
    }

    #[test]
    fn mcp_cost_can_spawn_is_truthful_principal_scoped_and_read_only() {
        use crate::cost::{CostCaps, CostCapsRestoreOutcome, CostManager};
        use crate::db::{Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct CostPreviewPolicy;
        impl AccessControl for CostPreviewPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "budget-planner" && verb == "aelyris.cost.can_spawn" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let db = ManagedDb::new(Database::open_memory().unwrap());
        let manager = Arc::new(CostManager::new());
        assert_eq!(manager.attach_db(db), CostCapsRestoreOutcome::Missing);
        let configured = CostCaps {
            max_agents: Some(4),
            max_tokens: Some(100),
            max_cost_usd: None,
            max_runtime_secs: Some(60),
        };
        assert_eq!(manager.set_caps(configured).unwrap(), configured);

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_cost_manager(manager.clone())
            .with_governance(Arc::new(Governance::with_access(Box::new(
                CostPreviewPolicy,
            ))));
        let schema = input_schema_for_tool_ref("aelyris.cost.can_spawn").unwrap();
        assert_eq!(
            schema["required"],
            serde_json::json!(["active_agents", "tokens_used", "cost_usd", "runtime_secs"])
        );
        assert_eq!(
            schema["properties"]["tokens_used"]["type"],
            serde_json::json!(["integer", "null"])
        );
        assert_eq!(
            schema["properties"]["cost_usd"]["type"],
            serde_json::json!(["number", "null"])
        );
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            scoped_tool_names(&state, "budget-planner"),
            ["aelyris.cost.can_spawn"]
        );

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState,
                    actor: &str,
                    active_agents: usize,
                    tokens_used: serde_json::Value,
                    cost_usd: serde_json::Value,
                    runtime_secs: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.cost.can_spawn".to_string(),
                    arguments: serde_json::json!({
                        "active_agents": active_agents,
                        "tokens_used": tokens_used,
                        "cost_usd": cost_usd,
                        "runtime_secs": runtime_secs,
                    }),
                },
            ))
        };

        let Json(unknown) = call(
            &state,
            "budget-planner",
            1,
            serde_json::Value::Null,
            serde_json::Value::Null,
            serde_json::Value::Null,
        )
        .expect("unknown enabled telemetry returns an honest non-decision");
        assert_eq!(unknown["result"]["evaluable"], false);
        assert!(unknown["result"]["decision"].is_null());
        assert_eq!(
            unknown["result"]["enabledAxes"],
            serde_json::json!(["active_agents", "tokens_used", "runtime_secs"])
        );
        assert_eq!(
            unknown["result"]["unknownAxes"],
            serde_json::json!(["tokens_used", "runtime_secs"])
        );
        assert_eq!(
            unknown["result"]["ignoredUnknownAxes"],
            serde_json::json!(["cost_usd"])
        );
        assert!(unknown["result"]["reportedUsage"]["tokens_used"].is_null());
        assert!(unknown["result"]["reportedUsage"]["cost_usd"].is_null());
        assert!(unknown["result"]["reportedUsage"]["runtime_secs"].is_null());
        assert_eq!(unknown["result"]["unknownUsageZeroFilled"], false);
        assert_eq!(unknown["result"]["providerBillingClaimed"], false);
        assert_eq!(unknown["result"]["readOnly"], true);

        let Json(agent_blocked) = call(
            &state,
            "budget-planner",
            4,
            serde_json::json!(50),
            serde_json::Value::Null,
            serde_json::json!(10),
        )
        .expect("known enabled telemetry delegates to the shared manager");
        assert_eq!(agent_blocked["result"]["evaluable"], true);
        assert_eq!(agent_blocked["result"]["decision"]["allowed"], false);
        assert_eq!(agent_blocked["result"]["decision"]["blocked_by"], "agents");
        assert_eq!(
            agent_blocked["result"]["ignoredUnknownAxes"],
            serde_json::json!(["cost_usd"])
        );

        let Json(token_blocked) = call(
            &state,
            "budget-planner",
            1,
            serde_json::json!(100),
            serde_json::Value::Null,
            serde_json::json!(10),
        )
        .expect("token cap decision");
        assert_eq!(token_blocked["result"]["decision"]["allowed"], false);
        assert_eq!(token_blocked["result"]["decision"]["blocked_by"], "tokens");

        let Json(allowed) = call(
            &state,
            "budget-planner",
            1,
            serde_json::json!(50),
            serde_json::Value::Null,
            serde_json::json!(10),
        )
        .expect("admissible preview");
        assert_eq!(allowed["result"]["evaluable"], true);
        assert_eq!(allowed["result"]["decision"]["allowed"], true);
        assert!(allowed["result"]["decision"]["blocked_by"].is_null());
        assert_eq!(manager.caps(), configured, "preview is read-only");

        assert!(matches!(
            call(
                &state,
                "blocked-reader",
                1,
                serde_json::json!(50),
                serde_json::Value::Null,
                serde_json::json!(10),
            ),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-reader").is_empty());

        let unavailable = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(
                CostPreviewPolicy,
            ))));
        assert!(matches!(
            call(
                &unavailable,
                "budget-planner",
                1,
                serde_json::json!(50),
                serde_json::Value::Null,
                serde_json::json!(10),
            ),
            Err(ApiError::Internal(message)) if message.contains("cost manager is not attached")
        ));
    }

    #[test]
    fn mcp_route_agent_is_principal_scoped_prompt_minimized_and_read_only() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct RoutePolicy;
        impl AccessControl for RoutePolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "routing-planner" && verb == "aelyris.route_agent" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(RoutePolicy))));
        let schema = input_schema_for_tool_ref("aelyris.route_agent").unwrap();
        assert_eq!(schema["required"], serde_json::json!(["prompt"]));
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["properties"].get("actor").is_none());
        assert_eq!(
            scoped_tool_names(&state, "routing-planner"),
            ["aelyris.route_agent"]
        );

        let prompt = "AIO32_PRIVATE_PROMPT_MUST_NOT_BE_ECHOED design a complex distributed architecture with many modules and migration constraints";
        let budget_remaining = 0.05;
        let expected = crate::control::agent::route(prompt, Some(budget_remaining));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "routing-planner",
                ToolCallBody {
                    name: "aelyris.route_agent".to_string(),
                    arguments: serde_json::json!({
                        "prompt": prompt,
                        "budgetRemaining": budget_remaining,
                    }),
                },
            ))
            .expect("authorized route preview");

        let result = &value["result"];
        assert_eq!(result["source"], "shared-agent-router");
        assert_eq!(result["promptEchoed"], false);
        assert_eq!(result["readOnly"], true);
        assert!(result.get("prompt").is_none());
        assert_eq!(
            result["decision"]["recommended_model"],
            expected.recommended_model
        );
        assert_eq!(result["decision"]["reasoning"], expected.reasoning);
        assert_eq!(
            result["decision"]["estimated_cost"],
            expected.estimated_cost
        );
        assert_eq!(
            result["decision"]["fallback_model"],
            expected.fallback_model
        );
        assert_eq!(result["decision"]["task_type"], expected.task_type);
        assert_eq!(result["decision"]["complexity"], expected.complexity);
        assert_eq!(
            result
                .as_object()
                .expect("route result object")
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["decision", "promptEchoed", "readOnly", "source"]
                .into_iter()
                .map(str::to_string)
                .collect()
        );
        assert!(
            !serde_json::to_string(result).unwrap().contains(prompt),
            "route response must not reflect the caller prompt"
        );

        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "blocked-router",
                ToolCallBody {
                    name: "aelyris.route_agent".to_string(),
                    arguments: serde_json::json!({ "prompt": prompt }),
                },
            )),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-router").is_empty());
    }

    #[test]
    fn mcp_fleet_status_is_principal_scoped_prompt_and_path_free() {
        use crate::agent::{AgentManager, AgentSession, AgentSessionInfo, SessionLineageEntry};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct FleetPolicy;
        impl AccessControl for FleetPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "fleet-observer" && verb == "aelyris.fleet_status" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let prompt = "AIO33_PRIVATE_AGENT_PROMPT_MUST_NOT_BE_EXPOSED";
        let approval = "AIO33_APPROVAL_TEXT_MUST_NOT_BE_EXPOSED";
        let cwd = "C:/AIO33/PRIVATE/REPOSITORY/PATH";
        let worktree = "C:/AIO33/PRIVATE/WORKTREE/PATH";
        let branch = "AIO33_PRIVATE_WORKTREE_BRANCH";
        let mut session = AgentSession::from(AgentSessionInfo {
            id: "session-aio33".to_string(),
            status: "coding".to_string(),
            model: "claude-sonnet".to_string(),
            prompt: prompt.to_string(),
            cwd: cwd.to_string(),
            cost: 1.25,
            tokens_used: 12_345,
            started_at: 77,
            task_id: None,
            execution_identity: None,
            current_activity: None,
        });
        session.logical_session_id = Some("logical-aio33".to_string());
        session.approval_prompt = Some(approval.to_string());
        session.repo_path = Some(cwd.to_string());
        session.worktree_path = Some(worktree.to_string());
        session.worktree_branch = Some(branch.to_string());
        session.predecessor_session_id = Some("session-before-aio33".to_string());
        session.lineage = vec![SessionLineageEntry::unresolved(
            "logical-before-aio33".to_string(),
        )];

        let projected = serde_json::to_value(fleet_status::project_session(session)).unwrap();
        assert_eq!(projected["id"], "session-aio33");
        assert_eq!(projected["logicalSessionId"], "logical-aio33");
        assert_eq!(projected["runMode"], "headless");
        assert_eq!(projected["status"], "coding");
        assert_eq!(projected["model"], "claude-sonnet");
        assert_eq!(projected["cost"], 1.25);
        assert_eq!(projected["tokensUsed"], 12_345);
        assert_eq!(projected["approvalPending"], true);
        assert_eq!(projected["worktreeAttached"], true);
        assert_eq!(projected["repositoryAttached"], true);
        assert_eq!(projected["lineageCount"], 1);
        for field in [
            "prompt",
            "approvalPrompt",
            "cwd",
            "workspaceScope",
            "repoPath",
            "worktreePath",
            "worktreeBranch",
            "lineage",
            "recycleStatus",
        ] {
            assert!(projected.get(field).is_none(), "unexpected field: {field}");
        }
        let projected_text = serde_json::to_string(&projected).unwrap();
        for hidden in [prompt, approval, cwd, worktree, branch] {
            assert!(
                !projected_text.contains(hidden),
                "fleet projection exposed {hidden}"
            );
        }

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_agent_manager(AgentManager::new())
            .with_governance(Arc::new(Governance::with_access(Box::new(FleetPolicy))));
        assert_eq!(
            scoped_tool_names(&state, "fleet-observer"),
            ["aelyris.fleet_status"]
        );
        let rt = tokio::runtime::Runtime::new().unwrap();
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "fleet-observer",
                ToolCallBody {
                    name: "aelyris.fleet_status".to_string(),
                    arguments: serde_json::json!({}),
                },
            ))
            .expect("authorized fleet projection");
        let result = &value["result"];
        assert_eq!(result["available"], true);
        assert_eq!(result["headlessAvailable"], true);
        assert_eq!(result["interactiveAvailable"], false);
        assert_eq!(result["headlessCount"], 0);
        assert_eq!(result["interactiveCount"], 0);
        assert_eq!(result["source"], "rust-agent-managers");
        assert_eq!(result["sessions"], serde_json::json!([]));
        assert_eq!(result["telemetryBoundary"], "reported_aelyris_telemetry");
        assert_eq!(result["providerBillingClaimed"], false);
        assert_eq!(result["promptValuesExposed"], false);
        assert_eq!(result["workspacePathsExposed"], false);
        assert_eq!(result["readOnly"], true);
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "blocked-observer",
                ToolCallBody {
                    name: "aelyris.fleet_status".to_string(),
                    arguments: serde_json::json!({}),
                },
            )),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-observer").is_empty());
    }

    #[test]
    fn mcp_fleet_status_combines_runtime_owners_deterministically_and_rejects_duplicate_ids() {
        use crate::agent::{
            AgentCli, AgentManager, AgentSession, AgentSessionInfo, InteractiveSessionInfo,
            InteractiveSessionManager,
        };
        use crate::pty::PtyManager;

        fn headless(id: &str) -> AgentSession {
            AgentSession::from(AgentSessionInfo {
                id: id.to_string(),
                status: "thinking".to_string(),
                model: "claude-haiku".to_string(),
                prompt: format!("{id}-HEADLESS-PROMPT-MUST-NOT-BE-EXPOSED"),
                cwd: format!("C:/{id}/HEADLESS/PATH"),
                cost: 0.5,
                tokens_used: 500,
                started_at: 5,
                task_id: None,
                execution_identity: None,
                current_activity: None,
            })
        }

        fn interactive(id: &str) -> InteractiveSessionInfo {
            InteractiveSessionInfo {
                id: id.to_string(),
                logical_session_id: format!("logical-{id}"),
                pty_id: format!("pty-{id}"),
                backend: "native".to_string(),
                cli: AgentCli::Claude,
                status: "idle".to_string(),
                model: "claude-sonnet".to_string(),
                initial_prompt: Some(format!("{id}-INTERACTIVE-PROMPT-MUST-NOT-BE-EXPOSED")),
                approval_prompt: Some(format!("{id}-APPROVAL-MUST-NOT-BE-EXPOSED")),
                cwd: format!("C:/{id}/INTERACTIVE/PATH"),
                worktree_branch: Some(format!("branch-{id}")),
                worktree_path: Some(format!("C:/{id}/WORKTREE/PATH")),
                repo_path: Some(format!("C:/{id}/REPOSITORY/PATH")),
                cost: 1.5,
                tokens_used: 1_500,
                started_at: 15,
                last_activity: 16,
                turn_count: 3,
                context_remaining: None,
            }
        }

        let merged = fleet_status::merge_sessions(
            vec![headless("z-headless")],
            vec![AgentSession::from(interactive("a-interactive"))],
        )
        .expect("headless and interactive owners merge");
        let merged = serde_json::to_value(merged).unwrap();
        assert_eq!(merged[0]["id"], "a-interactive");
        assert_eq!(merged[0]["runMode"], "interactive");
        assert_eq!(merged[1]["id"], "z-headless");
        assert_eq!(merged[1]["runMode"], "headless");
        assert!(!serde_json::to_string(&merged)
            .unwrap()
            .contains("MUST-NOT-BE-EXPOSED"));

        let duplicate = fleet_status::merge_sessions(
            vec![headless("duplicate-session")],
            vec![AgentSession::from(interactive("duplicate-session"))],
        );
        assert!(matches!(
            duplicate,
            Err(ApiError::Conflict(message)) if message == "duplicate_fleet_session_id"
        ));

        let interactive_manager = InteractiveSessionManager::new();
        interactive_manager
            .register(interactive("visible-agent"))
            .unwrap();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_agent_manager(AgentManager::new())
            .with_interactive_session_manager(interactive_manager);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                crate::governance::DEFAULT_ACTOR,
                ToolCallBody {
                    name: "aelyris.fleet_status".to_string(),
                    arguments: serde_json::json!({}),
                },
            ))
            .expect("unified fleet status");
        let result = &value["result"];
        assert_eq!(result["headlessAvailable"], true);
        assert_eq!(result["interactiveAvailable"], true);
        assert_eq!(result["headlessCount"], 0);
        assert_eq!(result["interactiveCount"], 1);
        assert_eq!(result["sessions"][0]["id"], "visible-agent");
        assert_eq!(result["sessions"][0]["runMode"], "interactive");
        assert_eq!(result["sessions"][0]["approvalPending"], true);
        assert!(!serde_json::to_string(result)
            .unwrap()
            .contains("MUST-NOT-BE-EXPOSED"));
    }

    #[test]
    fn mcp_agent_activity_read_is_deterministic_explicit_and_prompt_free() {
        use crate::agent::{AgentActivity, AgentManager, AgentSessionInfo};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct ActivityPolicy;
        impl AccessControl for ActivityPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "activity-observer" && verb == "aelyris.agent.activity" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        fn session(id: &str, action: &str) -> AgentSessionInfo {
            AgentSessionInfo {
                id: id.to_string(),
                status: "coding".to_string(),
                model: "claude-sonnet".to_string(),
                prompt: format!("{id}-PROMPT-MUST-NOT-BE-EXPOSED"),
                cwd: format!("C:/{id}/CWD/MUST-NOT-BE-EXPOSED"),
                cost: 0.0,
                tokens_used: 0,
                started_at: 1,
                task_id: Some(format!("task-{id}")),
                execution_identity: None,
                current_activity: Some(AgentActivity {
                    action: action.to_string(),
                    file: Some(format!("src/{id}.rs")),
                    symbol: Some(format!("symbol_{id}")),
                    updated_at: 9,
                }),
            }
        }

        let projected = agent_activity_read::project_sessions(vec![
            session("z-agent", "testing"),
            session("a-agent", "editing"),
        ]);
        let projected = serde_json::to_value(projected).unwrap();
        assert_eq!(projected[0]["sessionId"], "a-agent");
        assert_eq!(projected[0]["taskId"], "task-a-agent");
        assert_eq!(projected[0]["activity"]["action"], "editing");
        assert_eq!(projected[0]["activity"]["file"], "src/a-agent.rs");
        assert_eq!(projected[0]["activity"]["symbol"], "symbol_a-agent");
        assert_eq!(projected[1]["sessionId"], "z-agent");
        for item in projected.as_array().unwrap() {
            assert!(item.get("prompt").is_none());
            assert!(item.get("cwd").is_none());
        }
        let projected_text = serde_json::to_string(&projected).unwrap();
        assert!(!projected_text.contains("PROMPT-MUST-NOT-BE-EXPOSED"));
        assert!(!projected_text.contains("CWD/MUST-NOT-BE-EXPOSED"));

        let unavailable = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(ActivityPolicy))));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.agent.activity".to_string(),
                    arguments: serde_json::json!({}),
                },
            ))
        };
        let Json(unavailable_value) =
            call(&unavailable, "activity-observer").expect("unattached read is explicit");
        assert_eq!(unavailable_value["result"]["available"], false);
        assert_eq!(unavailable_value["result"]["sessionCount"], 0);
        assert_eq!(unavailable_value["result"]["fleet"], serde_json::json!([]));

        let available = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_agent_manager(AgentManager::new())
            .with_governance(Arc::new(Governance::with_access(Box::new(ActivityPolicy))));
        let Json(available_value) =
            call(&available, "activity-observer").expect("attached activity read");
        let result = &available_value["result"];
        assert_eq!(result["available"], true);
        assert_eq!(result["source"], "rust-agent-manager");
        assert_eq!(result["sessionCount"], 0);
        assert_eq!(result["activityTargetValuesExposed"], true);
        assert_eq!(result["promptValuesExposed"], false);
        assert_eq!(result["interactiveActivityInvented"], false);
        assert_eq!(result["readOnly"], true);
        assert_eq!(
            scoped_tool_names(&available, "activity-observer"),
            ["aelyris.agent.activity"]
        );
        assert!(matches!(
            call(&available, "blocked-activity-observer"),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&available, "blocked-activity-observer").is_empty());
    }

    #[test]
    fn mcp_pending_decision_read_is_value_minimized_deterministic_and_read_only() {
        use crate::db::{Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::merge_intent::{store::MergeIntentStore, MergeIntent, MergeIntentState};
        use crate::pty::PtyManager;

        struct PendingPolicy;
        impl AccessControl for PendingPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "decision-observer" && verb == "aelyris.list_pending_approvals" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        fn merge_intent(id: &str, suffix: &str, state: MergeIntentState) -> MergeIntent {
            MergeIntent {
                intent_id: id.to_string(),
                repo_path: format!("C:/AIO36/REPOSITORY/{suffix}/MUST-NOT-BE-EXPOSED"),
                source_branch: format!("AIO36_SOURCE_{suffix}_MUST_NOT_BE_EXPOSED"),
                target_branch: format!("AIO36_TARGET_{suffix}_MUST_NOT_BE_EXPOSED"),
                source_oid: format!("AIO36_SOURCE_OID_{suffix}_MUST_NOT_BE_EXPOSED"),
                target_oid: format!("AIO36_TARGET_OID_{suffix}_MUST_NOT_BE_EXPOSED"),
                merge_base_oid: Some(format!("AIO36_MERGE_BASE_{suffix}_MUST_NOT_BE_EXPOSED")),
                task_id: format!("AIO36_TASK_{suffix}_MUST_NOT_BE_EXPOSED"),
                created_at: if id.ends_with('a') { 10 } else { 20 },
                state,
                updated_at: if id.ends_with('a') { 11 } else { 21 },
                session_id: Some(format!("AIO36_SESSION_{suffix}_MUST_NOT_BE_EXPOSED")),
                reviewer_id: Some(format!("AIO36_REVIEWER_{suffix}_MUST_NOT_BE_EXPOSED")),
                gates_digest: Some(format!("AIO36_GATES_{suffix}_MUST_NOT_BE_EXPOSED")),
            }
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let store = Arc::new(MergeIntentStore::new(db));
        store
            .create_or_get(&merge_intent("merge-z", "Z", MergeIntentState::Reviewing))
            .unwrap();
        store
            .create_or_get(&merge_intent("merge-a", "A", MergeIntentState::Queued))
            .unwrap();

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_merge_store(Some(store.clone()))
            .with_governance(Arc::new(Governance::with_access(Box::new(PendingPolicy))));
        {
            let mut queue = state.mcp_pending.lock().unwrap();
            queue.push(McpPendingDecision {
                id: "approval-b".to_string(),
                session_id: "AIO36_SESSION_B_MUST_NOT_BE_EXPOSED".to_string(),
                kind: "permission_required".to_string(),
                title: "AIO36_TITLE_B_MUST_NOT_BE_EXPOSED".to_string(),
                summary: Some("AIO36_SUMMARY_B_MUST_NOT_BE_EXPOSED".to_string()),
                risk: "high".to_string(),
                status: "pending".to_string(),
            });
            queue.push(McpPendingDecision {
                id: "approval-a".to_string(),
                session_id: "AIO36_SESSION_A_MUST_NOT_BE_EXPOSED".to_string(),
                kind: "permission_required".to_string(),
                title: "AIO36_TITLE_A_MUST_NOT_BE_EXPOSED".to_string(),
                summary: Some("AIO36_SUMMARY_A_MUST_NOT_BE_EXPOSED".to_string()),
                risk: "medium".to_string(),
                status: "pending".to_string(),
            });
            queue.push(McpPendingDecision {
                id: "approval-resolved".to_string(),
                session_id: "AIO36_RESOLVED_SESSION_MUST_NOT_BE_EXPOSED".to_string(),
                kind: "permission_required".to_string(),
                title: "AIO36_RESOLVED_TITLE_MUST_NOT_BE_EXPOSED".to_string(),
                summary: None,
                risk: "low".to_string(),
                status: "resolved".to_string(),
            });
        }

        let schema = input_schema_for_tool_ref("aelyris.list_pending_approvals").unwrap();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            scoped_tool_names(&state, "decision-observer"),
            ["aelyris.list_pending_approvals"]
        );
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.list_pending_approvals".to_string(),
                    arguments: serde_json::json!({}),
                },
            ))
        };
        let Json(value) = call(&state, "decision-observer").expect("pending projection");
        let result = &value["result"];
        assert_eq!(result["pendingQueueAvailable"], true);
        assert_eq!(result["mergeStoreAvailable"], true);
        assert_eq!(result["pendingCount"], 2);
        assert_eq!(result["mergeIntentCount"], 2);
        assert_eq!(result["pending"][0]["id"], "approval-b");
        assert_eq!(result["pending"][1]["id"], "approval-a");
        assert_eq!(result["pending"][0]["risk"], "high");
        assert_eq!(result["pending"][1]["risk"], "medium");
        assert_eq!(result["mergeIntents"][0]["intentId"], "merge-a");
        assert_eq!(result["mergeIntents"][0]["state"], "queued");
        assert_eq!(result["mergeIntents"][1]["intentId"], "merge-z");
        assert_eq!(result["mergeIntents"][1]["state"], "reviewing");
        assert_eq!(result["mergeIntents"][0]["requestorPresent"], true);
        assert_eq!(result["mergeIntents"][0]["reviewerPresent"], true);
        assert_eq!(result["mergeIntents"][0]["gateEvidencePresent"], true);
        assert_eq!(result["decisionValuesExposed"], false);
        assert_eq!(result["mergeTargetsExposed"], false);
        assert_eq!(result["grantToolExposed"], false);
        assert_eq!(result["readOnly"], true);
        for pending in result["pending"].as_array().unwrap() {
            assert!(pending.get("title").is_none());
            assert!(pending.get("summary").is_none());
            assert!(pending.get("sessionId").is_none());
            let digest = pending["sessionDigest"].as_str().unwrap();
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
        }
        for intent in result["mergeIntents"].as_array().unwrap() {
            for field in [
                "repoPath",
                "sourceBranch",
                "targetBranch",
                "sourceOid",
                "targetOid",
                "mergeBaseOid",
                "taskId",
                "sessionId",
                "reviewerId",
                "gatesDigest",
            ] {
                assert!(intent.get(field).is_none(), "unexpected field: {field}");
            }
        }
        let response_text = serde_json::to_string(result).unwrap();
        for hidden in [
            "MUST_NOT_BE_EXPOSED",
            "MUST-NOT-BE-EXPOSED",
            "AIO36_TITLE",
            "AIO36_SUMMARY",
            "AIO36_REPOSITORY",
            "AIO36_SOURCE_OID",
        ] {
            assert!(!response_text.contains(hidden), "response exposed {hidden}");
        }
        assert_eq!(state.mcp_pending.lock().unwrap().len(), 3);
        assert_eq!(store.list_unresolved().unwrap().len(), 2);

        let no_store = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(PendingPolicy))));
        let Json(no_store_value) =
            call(&no_store, "decision-observer").expect("missing merge owner is explicit");
        assert_eq!(no_store_value["result"]["mergeStoreAvailable"], false);
        assert_eq!(no_store_value["result"]["mergeIntentCount"], 0);
        assert_eq!(
            no_store_value["result"]["mergeIntents"],
            serde_json::json!([])
        );
        assert!(matches!(
            call(&state, "blocked-decision-observer"),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-decision-observer").is_empty());
    }

    #[test]
    fn mcp_worktree_inventory_is_path_minimized_deterministic_and_read_only() {
        use crate::git::{WorktreeInfo, WorktreeStatus};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;
        use git2::Repository;
        use std::path::Path;

        struct WorktreePolicy;
        impl AccessControl for WorktreePolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "worktree-observer" && verb == "aelyris.worktree.list" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let projected = worktree_inventory::project_worktrees(vec![
            WorktreeInfo {
                name: "z-linked".to_string(),
                path: "C:/AIO37/Z/WORKTREE/PATH/MUST-NOT-BE-EXPOSED".to_string(),
                branch: "feature/z".to_string(),
                is_main: false,
                head_sha: "z-head".to_string(),
                status: WorktreeStatus::Modified,
            },
            WorktreeInfo {
                name: "main".to_string(),
                path: "C:/AIO37/MAIN/PATH/MUST-NOT-BE-EXPOSED".to_string(),
                branch: "main".to_string(),
                is_main: true,
                head_sha: "main-head".to_string(),
                status: WorktreeStatus::Clean,
            },
            WorktreeInfo {
                name: "a-linked".to_string(),
                path: "C:/AIO37/A/WORKTREE/PATH/MUST-NOT-BE-EXPOSED".to_string(),
                branch: "feature/a".to_string(),
                is_main: false,
                head_sha: "a-head".to_string(),
                status: WorktreeStatus::Conflicted,
            },
        ]);
        let projected = serde_json::to_value(projected).unwrap();
        assert_eq!(projected[0]["name"], "main");
        assert_eq!(projected[0]["isMain"], true);
        assert_eq!(projected[1]["name"], "a-linked");
        assert_eq!(projected[2]["name"], "z-linked");
        assert_eq!(projected[1]["branch"], "feature/a");
        assert_eq!(projected[1]["headSha"], "a-head");
        assert_eq!(projected[1]["status"], "Conflicted");
        for item in projected.as_array().unwrap() {
            assert!(item.get("path").is_none());
        }
        assert!(!serde_json::to_string(&projected)
            .unwrap()
            .contains("MUST-NOT-BE-EXPOSED"));

        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        std::fs::write(dir.path().join("README.md"), "AIO-37").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let signature = git2::Signature::now("AIO37", "aio37@example.test").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
        let repo_path = dir.path().to_string_lossy().to_string();

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(WorktreePolicy))));
        let schema = input_schema_for_tool_ref("aelyris.worktree.list").unwrap();
        assert_eq!(schema["required"], serde_json::json!(["repoPath"]));
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(
            scoped_tool_names(&state, "worktree-observer"),
            ["aelyris.worktree.list"]
        );
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str, path: &str| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.worktree.list".to_string(),
                    arguments: serde_json::json!({ "repoPath": path }),
                },
            ))
        };
        let Json(value) =
            call(&state, "worktree-observer", &repo_path).expect("worktree inventory");
        let result = &value["result"];
        assert_eq!(result["source"], "git-worktree-owner");
        assert_eq!(result["worktreeCount"], 1);
        assert_eq!(result["worktrees"][0]["name"], "main");
        assert_eq!(result["worktrees"][0]["branch"], "main");
        assert_eq!(result["worktrees"][0]["isMain"], true);
        assert_eq!(result["worktrees"][0]["status"], "Clean");
        assert_eq!(result["repositoryPathExposed"], false);
        assert_eq!(result["worktreePathsExposed"], false);
        assert_eq!(result["readOnly"], true);
        assert!(result.get("repoPath").is_none());
        assert!(result["worktrees"][0].get("path").is_none());
        let digest = result["repositoryDigest"].as_str().unwrap();
        assert_eq!(digest.len(), 64);
        assert!(digest
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert!(!serde_json::to_string(result).unwrap().contains(&repo_path));
        assert_eq!(
            repo.worktrees().unwrap().len(),
            0,
            "read created no worktree"
        );

        assert!(matches!(
            call(&state, "worktree-observer", "C:/AIO37/NOT/A/REPOSITORY"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            call(&state, "blocked-worktree-observer", &repo_path),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-worktree-observer").is_empty());
    }

    #[test]
    fn mcp_worktree_path_prediction_is_path_free_deterministic_and_read_only() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct WorktreePredictionPolicy;
        impl AccessControl for WorktreePredictionPolicy {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "worktree-planner" && verb == "aelyris.worktree.predictPath" {
                    AccessDecision::Allow
                } else {
                    AccessDecision::Deny("restricted".to_string())
                }
            }
        }

        let temp = tempfile::tempdir().expect("temporary worktree prediction root");
        let repo = temp
            .path()
            .join("AIO43_REPOSITORY_PATH_MUST_NOT_BE_EXPOSED");
        std::fs::create_dir_all(&repo).expect("create repository-shaped directory");
        let repo_path = repo.to_string_lossy().to_string();
        let branch_name = "agent/aio43-path-free-prediction";
        let predicted_path = crate::control::worktree::predict_path(&repo_path, branch_name)
            .to_string_lossy()
            .to_string();
        assert!(!std::path::Path::new(&predicted_path).exists());

        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::disabled())
            .with_governance(Arc::new(Governance::with_access(Box::new(
                WorktreePredictionPolicy,
            ))));
        let listed = scoped_tools_list_value(&state, "worktree-planner");
        let tool = listed["tools"]
            .as_array()
            .expect("tool catalog")
            .iter()
            .find(|tool| tool["name"] == "aelyris.worktree.predictPath")
            .expect("path prediction is principal-visible");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["outputSensitivity"], "value-minimized-coordination");
        assert_eq!(tool["repositoryPathExposed"], false);
        assert_eq!(tool["worktreePathExposed"], false);
        assert_eq!(tool["readOnly"], true);

        let schema = input_schema_for_tool_ref("aelyris.worktree.predictPath").unwrap();
        assert_eq!(
            schema["required"],
            serde_json::json!(["repoPath", "branchName"])
        );
        assert_eq!(schema["additionalProperties"], false);

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str, branch: &str| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.worktree.predictPath".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path.clone(),
                        "branchName": branch,
                    }),
                },
            ))
        };
        let Json(first) =
            call(&state, "worktree-planner", branch_name).expect("path-free worktree prediction");
        let Json(second) = call(&state, "worktree-planner", branch_name)
            .expect("deterministic path-free worktree prediction");
        assert_eq!(first["result"], second["result"]);
        let result = &first["result"];
        assert_eq!(result["branchName"], branch_name);
        assert_eq!(result["source"], "git-worktree-owner");
        assert_eq!(result["pathPredicted"], true);
        assert_eq!(result["pathReturned"], false);
        assert_eq!(result["repositoryPathExposed"], false);
        assert_eq!(result["worktreePathExposed"], false);
        assert_eq!(result["readOnly"], true);
        assert!(result.get("repoPath").is_none());
        assert!(result.get("path").is_none());
        let digest = result["repositoryDigest"]
            .as_str()
            .expect("repository digest");
        assert_eq!(digest.len(), 64);
        assert!(digest
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        let serialized = serde_json::to_string(result).unwrap();
        assert!(!serialized.contains(&repo_path));
        assert!(!serialized.contains(&predicted_path));
        assert!(!std::path::Path::new(&predicted_path).exists());

        assert!(matches!(
            call(&state, "worktree-planner", "../main"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            call(&state, "blocked-worktree-planner", branch_name),
            Err(ApiError::Forbidden(_))
        ));
        assert!(scoped_tool_names(&state, "blocked-worktree-planner").is_empty());
        assert!(!std::path::Path::new(&predicted_path).exists());
    }

    fn dispatch_tool_names_from_source(source: &str) -> Result<Vec<String>, String> {
        const BEGIN: &str = "// A6.4_DISPATCH_TOOL_ARMS_BEGIN";
        const END: &str = "// A6.4_DISPATCH_TOOL_ARMS_END";
        if source.matches(BEGIN).count() != 1 || source.matches(END).count() != 1 {
            return Err("dispatch inventory markers must each occur exactly once".to_string());
        }
        let (_, tail) = source
            .split_once(BEGIN)
            .ok_or_else(|| "dispatch inventory start marker is missing".to_string())?;
        let (body, _) = tail
            .split_once(END)
            .ok_or_else(|| "dispatch inventory end marker is missing".to_string())?;
        Ok(body
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let quoted = line.strip_prefix('"')?;
                let quote = quoted.find('"')?;
                quoted[quote + 1..]
                    .trim_start()
                    .starts_with("=>")
                    .then(|| quoted[..quote].to_string())
            })
            .collect())
    }

    fn verb_inventory_is_exact(candidate: &[String]) -> bool {
        let frozen = FROZEN_A64_VERBS
            .iter()
            .copied()
            .map(String::from)
            .collect::<BTreeSet<_>>();
        let candidate_set = candidate.iter().cloned().collect::<BTreeSet<_>>();
        candidate.len() == FROZEN_A64_VERBS.len()
            && candidate_set.len() == FROZEN_A64_VERBS.len()
            && candidate_set == frozen
    }

    fn test_db() -> Arc<crate::db::ManagedDb> {
        Arc::new(crate::db::ManagedDb::new(
            crate::db::Database::open_memory().expect("memory db"),
        ))
    }

    fn event_test_state() -> (
        ApiState,
        Arc<crate::db::ManagedDb>,
        Arc<crate::event_bus::EventBus>,
    ) {
        let db = test_db();
        let bus = Arc::new(crate::event_bus::EventBus::new_durable());
        bus.attach_db(db.clone());
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("t"),
        )
        .with_event_bus(bus.clone());
        (state, db, bus)
    }

    /// The runtime catalog owns names and schemas. The dispatcher is not a
    /// second registry, so this test inventories its sole match directly and
    /// compares all three surfaces with the frozen pre-extraction contract.
    #[test]
    fn catalog_schemas_and_dispatch_list_exactly_the_same_verbs() {
        let catalog = tool_names()
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let schemas = listed["tools"]
            .as_array()
            .expect("tools is an array")
            .iter()
            .map(|tool| {
                tool["name"]
                    .as_str()
                    .expect("every tool schema has a name")
                    .to_string()
            })
            .collect::<Vec<_>>();
        let dispatch = dispatch_tool_names_from_source(include_str!("mcp/dispatch.rs"))
            .expect("dispatch inventory");

        assert!(
            verb_inventory_is_exact(&catalog),
            "catalog changed from the frozen MCP verb contract"
        );
        assert_eq!(catalog, schemas, "catalog and schema order/set drifted");
        assert!(
            verb_inventory_is_exact(&dispatch),
            "sole dispatcher changed from the frozen MCP verb contract"
        );
        assert_eq!(
            catalog.iter().cloned().collect::<BTreeSet<_>>(),
            dispatch.iter().cloned().collect::<BTreeSet<_>>(),
            "catalog and sole dispatcher set drifted"
        );

        let mut missing = dispatch.clone();
        missing.pop();
        assert!(
            !verb_inventory_is_exact(&missing),
            "missing verb must fail closed"
        );
        let mut extra = dispatch.clone();
        extra.push("aelyris.test.extra".to_string());
        assert!(
            !verb_inventory_is_exact(&extra),
            "extra verb must fail closed"
        );
        let mut duplicate = dispatch;
        duplicate[82] = duplicate[81].clone();
        assert!(
            !verb_inventory_is_exact(&duplicate),
            "duplicate verb must fail closed"
        );
    }

    #[test]
    fn input_schema_for_tool_uses_memoized_schema_index() {
        let first = input_schema_for_tool_ref("terminal.capture").expect("schema exists");
        let second = input_schema_for_tool_ref("terminal.capture").expect("schema exists");

        assert!(std::ptr::eq(first, second));
        let cloned = input_schema_for_tool("terminal.capture").unwrap();
        assert_eq!(&cloned, first);
        assert!(input_schema_for_tool_ref("aelyris.unknown").is_none());
    }

    #[test]
    fn session_lifecycle_verbs_are_gated_and_schema_exact() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let tools = listed["tools"].as_array().expect("tools is an array");
        let expected = [
            ("aelyris.session.summarize", vec!["session_id"]),
            ("aelyris.session.checkpoint", vec!["session_id"]),
            ("aelyris.session.handoff", vec!["session_id"]),
            ("aelyris.session.resume", vec![]),
            ("aelyris.session.reset_context", vec!["session_id"]),
        ];

        for (verb, required) in expected {
            let tool = tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(verb))
                .unwrap_or_else(|| panic!("{verb} present in tools_list"));
            assert_eq!(tool["safety"], serde_json::json!("GATED"));
            assert_eq!(
                tool["inputSchema"]["additionalProperties"],
                serde_json::json!(false),
                "{verb} must reject unknown lifecycle args",
            );
            let actual_required = tool["inputSchema"]
                .get("required")
                .and_then(|value| value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .map(|item| item.as_str().unwrap().to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            assert_eq!(actual_required, required, "{verb} required args drifted");
        }
    }

    #[test]
    fn mcp_session_lifecycle_audit_is_principal_bound_and_value_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        fn args(value: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
            value.as_object().expect("lifecycle args object").clone()
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()));
        let actor = "session-lifecycle-operator";
        let summarize_session = "AIO26_SUMMARIZE_SESSION_MUST_NOT_BE_LOGGED";
        let summarize_reason = "AIO26_SUMMARIZE_REASON_MUST_NOT_BE_LOGGED";
        let checkpoint_session = "AIO26_CHECKPOINT_SESSION_MUST_NOT_BE_LOGGED";
        let checkpoint_summary = "AIO26_CHECKPOINT_SUMMARY_MUST_NOT_BE_LOGGED";
        let inflight_ref = "AIO26_INFLIGHT_REF_MUST_NOT_BE_LOGGED";
        let predecessor = "AIO26_PREDECESSOR_MUST_NOT_BE_LOGGED";
        let handoff_session = "AIO26_HANDOFF_SESSION_MUST_NOT_BE_LOGGED";
        let handoff_reason = "AIO26_HANDOFF_REASON_MUST_NOT_BE_LOGGED";
        let logical_session = "AIO26_LOGICAL_SESSION_MUST_NOT_BE_LOGGED";
        let reset_session = "AIO26_RESET_SESSION_MUST_NOT_BE_LOGGED";

        let calls = [
            (
                "aelyris.session.summarize",
                args(serde_json::json!({
                    "session_id": summarize_session,
                    "reason": summarize_reason,
                    "timeout_ms": 12345,
                })),
            ),
            (
                "aelyris.session.checkpoint",
                args(serde_json::json!({
                    "session_id": checkpoint_session,
                    "summary_json": { "secret": checkpoint_summary },
                    "summary_seq": 7,
                    "inflight_ref": inflight_ref,
                    "predecessor_session_id": predecessor,
                })),
            ),
            (
                "aelyris.session.handoff",
                args(serde_json::json!({
                    "session_id": handoff_session,
                    "reason": handoff_reason,
                    "timeout_ms": 23456,
                    "cols": 121,
                    "rows": 37,
                })),
            ),
            (
                "aelyris.session.resume",
                args(serde_json::json!({
                    "logical_session_id": logical_session,
                    "timeout_ms": 34567,
                })),
            ),
            (
                "aelyris.session.reset_context",
                args(serde_json::json!({
                    "session_id": reset_session,
                    "timeout_ms": 45678,
                    "cols": 122,
                    "rows": 38,
                })),
            ),
        ];

        for (verb, _) in &calls {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }
        assert!(matches!(
            session_lifecycle::authenticated_actor("  "),
            Err(ApiError::Forbidden(_))
        ));

        let rt = tokio::runtime::Runtime::new().unwrap();
        for (verb, arguments) in &calls {
            let result = rt.block_on(tools_call_as_actor(
                &state,
                actor,
                ToolCallBody {
                    name: (*verb).to_string(),
                    arguments: serde_json::Value::Object(arguments.clone()),
                },
            ));
            assert!(matches!(
                result,
                Err(ApiError::Internal(ref message))
                    if message.contains("session lifecycle runtime is not attached")
            ));
        }

        let success_results = [
            serde_json::json!({
                "sessionId": "AIO26_RESULT_SUMMARIZE_SESSION_MUST_NOT_BE_LOGGED",
                "logicalSessionId": "AIO26_RESULT_SUMMARIZE_LOGICAL_MUST_NOT_BE_LOGGED",
                "handoffSeq": 11,
                "summaryPath": "AIO26_SUMMARY_PATH_MUST_NOT_BE_LOGGED",
                "donePath": "AIO26_DONE_PATH_MUST_NOT_BE_LOGGED",
                "redactionCount": 2,
                "validation": { "secret": "AIO26_VALIDATION_MUST_NOT_BE_LOGGED" },
                "summary": { "secret": "AIO26_SUMMARY_BODY_MUST_NOT_BE_LOGGED" },
            }),
            serde_json::json!({
                "sessionId": "AIO26_RESULT_CHECKPOINT_SESSION_MUST_NOT_BE_LOGGED",
                "logicalSessionId": "AIO26_RESULT_CHECKPOINT_LOGICAL_MUST_NOT_BE_LOGGED",
                "checkpointSeq": 12,
                "summaryPath": "AIO26_CHECKPOINT_PATH_MUST_NOT_BE_LOGGED",
                "inflightRef": "AIO26_RESULT_INFLIGHT_MUST_NOT_BE_LOGGED",
                "redactionCount": 3,
                "identityContextPersisted": true,
                "checkpoint": { "secret": "AIO26_CHECKPOINT_RECORD_MUST_NOT_BE_LOGGED" },
            }),
            serde_json::json!({
                "predecessorSessionId": "AIO26_RESULT_HANDOFF_PREDECESSOR_MUST_NOT_BE_LOGGED",
                "successorSessionId": "AIO26_RESULT_HANDOFF_SUCCESSOR_MUST_NOT_BE_LOGGED",
                "handoffSeq": 13,
                "checkpointSeq": 14,
                "successorCheckpointSeq": 15,
                "summaryPath": "AIO26_HANDOFF_SUMMARY_PATH_MUST_NOT_BE_LOGGED",
                "ackPath": "AIO26_HANDOFF_ACK_PATH_MUST_NOT_BE_LOGGED",
                "retiredPredecessor": true,
                "auditTraceEvents": 4,
                "acceptance": { "secret": "AIO26_ACCEPTANCE_MUST_NOT_BE_LOGGED" },
                "handoff": { "secret": "AIO26_HANDOFF_RECORD_MUST_NOT_BE_LOGGED" },
            }),
            serde_json::json!({
                "requestedLogicalSessionId": "AIO26_RESULT_RESUME_REQUEST_MUST_NOT_BE_LOGGED",
                "reconciledHandoffs": 5,
                "unresolvedBefore": 2,
                "unresolvedAfter": 0,
                "adoptedLogicalSessionId": "AIO26_RESULT_RESUME_ADOPTED_MUST_NOT_BE_LOGGED",
                "checkpointSeq": 16,
                "ackReconfirmed": true,
            }),
            serde_json::json!({
                "resetContext": true,
                "predecessorSessionId": "AIO26_RESULT_RESET_PREDECESSOR_MUST_NOT_BE_LOGGED",
                "successorSessionId": "AIO26_RESULT_RESET_SUCCESSOR_MUST_NOT_BE_LOGGED",
                "worktreeDeleted": false,
                "handoff": {
                    "handoffSeq": 17,
                    "retiredPredecessor": true,
                    "secret": "AIO26_RESET_HANDOFF_MUST_NOT_BE_LOGGED",
                },
            }),
        ];
        let operations = [
            "summarize",
            "checkpoint",
            "handoff",
            "resume",
            "reset_context",
        ];
        for ((_, arguments), (operation, success)) in calls
            .iter()
            .zip(operations.iter().zip(success_results.iter()))
        {
            let returned =
                session_lifecycle::finish(&state, actor, operation, arguments, Ok(success.clone()))
                    .expect("accepted lifecycle result");
            assert_eq!(&returned, success);
        }

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_session_lifecycle_authority".to_string()),
                    limit: Some(30),
                    ..Default::default()
                })
            })
            .expect("read session lifecycle audit");
        assert_eq!(rows.len(), 10);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some(actor)));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            5
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            5
        );
        for operation in operations {
            assert_eq!(
                rows.iter()
                    .filter(|row| row.redacted_payload_json["operation"] == operation)
                    .count(),
                2,
                "one accepted and one rejected audit row for {operation}"
            );
        }
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "summarize"
                && row.redacted_payload_json["resultSummary"]["handoffSeq"] == 11
                && row.redacted_payload_json["resultSummary"]["redactionCount"] == 2
                && row.redacted_payload_json["resultSummary"]["summaryProduced"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "checkpoint"
                && row.redacted_payload_json["resultSummary"]["checkpointSeq"] == 12
                && row.redacted_payload_json["resultSummary"]["identityContextPersisted"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "handoff"
                && row.redacted_payload_json["resultSummary"]["handoffSeq"] == 13
                && row.redacted_payload_json["resultSummary"]["retiredPredecessor"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "resume"
                && row.redacted_payload_json["resultSummary"]["reconciledHandoffs"] == 5
                && row.redacted_payload_json["resultSummary"]["adopted"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "reset_context"
                && row.redacted_payload_json["resultSummary"]["handoffSeq"] == 17
                && row.redacted_payload_json["resultSummary"]["worktreeDeleted"] == false
        }));
        assert_eq!(
            rows.iter()
                .filter(|row| {
                    row.redacted_payload_json["rejectionCode"]
                        == "session_lifecycle_runtime_unavailable"
                })
                .count(),
            5
        );
        for row in &rows {
            assert_eq!(row.redacted_payload_json["lifecycleValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["resultValuesLogged"], false);
            for field in ["targetDigest", "inputDigest"] {
                let digest = row.redacted_payload_json[field]
                    .as_str()
                    .expect("lifecycle digest");
                assert_eq!(digest.len(), 64);
                assert!(digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()));
            }
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                summarize_session,
                summarize_reason,
                checkpoint_session,
                checkpoint_summary,
                inflight_ref,
                predecessor,
                handoff_session,
                handoff_reason,
                logical_session,
                reset_session,
                "AIO26_RESULT_SUMMARIZE_SESSION_MUST_NOT_BE_LOGGED",
                "AIO26_RESULT_SUMMARIZE_LOGICAL_MUST_NOT_BE_LOGGED",
                "AIO26_SUMMARY_PATH_MUST_NOT_BE_LOGGED",
                "AIO26_DONE_PATH_MUST_NOT_BE_LOGGED",
                "AIO26_VALIDATION_MUST_NOT_BE_LOGGED",
                "AIO26_SUMMARY_BODY_MUST_NOT_BE_LOGGED",
                "AIO26_CHECKPOINT_RECORD_MUST_NOT_BE_LOGGED",
                "AIO26_RESULT_HANDOFF_SUCCESSOR_MUST_NOT_BE_LOGGED",
                "AIO26_HANDOFF_ACK_PATH_MUST_NOT_BE_LOGGED",
                "AIO26_ACCEPTANCE_MUST_NOT_BE_LOGGED",
                "AIO26_RESULT_RESUME_ADOPTED_MUST_NOT_BE_LOGGED",
                "AIO26_RESET_HANDOFF_MUST_NOT_BE_LOGGED",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio26_lifecycle_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_session_lifecycle_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated lifecycle audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(audit_failure_db));
        let original = serde_json::json!({
            "checkpointSeq": 99,
            "secret": "AIO26_AUDIT_FAILURE_RESULT_MUST_NOT_BE_LOGGED",
        });
        let returned = session_lifecycle::finish(
            &audit_failure_state,
            actor,
            "checkpoint",
            &calls[1].1,
            Ok(original.clone()),
        )
        .expect("audit failure does not replay or reject the lifecycle result");
        assert_eq!(returned, original);
    }

    #[test]
    fn approval_resolve_mcp_schema_and_tool_error_contract() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("t").with_input_authority_token("human-test"),
        );

        let call = |arguments: serde_json::Value| {
            let body = ToolCallBody {
                name: "aelyris.approval.resolve".to_string(),
                arguments,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
                .expect("tool call response")
                .0
        };

        let ok = call(serde_json::json!({
            "terminalId": "pty-1",
            "decision": "approve",
            "expectedPromptKey": "fresh-test",
            "humanApprovalCapability": "human-test"
        }));
        assert_eq!(ok["ok"], serde_json::json!(true));
        assert_eq!(ok["result"]["ok"], serde_json::json!(true));

        let stale = call(serde_json::json!({
            "terminalId": "pty-1",
            "decision": "approve",
            "expectedPromptKey": "stale-test",
            "humanApprovalCapability": "human-test"
        }));
        assert_eq!(stale["ok"], serde_json::json!(false));
        assert!(
            stale["error"]["stale_approval"]
                .as_str()
                .is_some_and(|message| message.contains("stale_approval")),
            "{stale:?}"
        );

        let missing_prompt = call(serde_json::json!({
            "terminalId": "pty-1",
            "decision": "approve",
            "humanApprovalCapability": "human-test"
        }));
        assert_eq!(missing_prompt["ok"], serde_json::json!(false));
        assert_eq!(
            missing_prompt["error"]["schema_violation"]["missing"],
            serde_json::json!(["expectedPromptKey"])
        );
    }

    #[test]
    fn mcp_approval_request_audit_is_principal_bound_and_value_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::EventBus;
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let events = Arc::new(EventBus::new_durable());
        events.attach_db(db.clone());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_event_bus(events);
        let schema = input_schema_for_tool_ref("aelyris.request_approval").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let session = "AIO25_SESSION_MUST_NOT_BE_LOGGED";
        let tool = "AIO25_TOOL_MUST_NOT_BE_LOGGED";
        let summary = "AIO25_SUMMARY_MUST_NOT_BE_LOGGED";
        let risk = "high";
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "approval-request-operator",
                ToolCallBody {
                    name: "aelyris.request_approval".to_string(),
                    arguments: serde_json::json!({
                        "sessionId": session,
                        "tool": tool,
                        "summary": summary,
                        "risk": risk,
                    }),
                },
            ))
            .expect("approval request resolves through the existing watchdog owner");
        assert_eq!(value["ok"], true);
        let result_class = value["result"]["status"]
            .as_str()
            .expect("approval request status");
        assert!(matches!(
            result_class,
            "auto_approved" | "auto_denied" | "pending"
        ));
        let pending_count = state.mcp_pending.lock().unwrap().len();
        assert_eq!(pending_count, usize::from(result_class == "pending"));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_approval_request_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read approval request audit");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.agent_id.as_deref(), Some("approval-request-operator"));
        assert!(row.session_id.is_none());
        assert!(row.terminal_id.is_none());
        assert!(row.task_id.is_none());
        assert_eq!(row.redacted_payload_json["resultClass"], result_class);
        assert_eq!(row.redacted_payload_json["status"], "accepted");
        assert_eq!(
            row.redacted_payload_json["requestApplied"],
            result_class == "pending"
        );
        assert_eq!(row.redacted_payload_json["requestValuesLogged"], false);
        assert_eq!(row.redacted_payload_json["watchdogRuleLogged"], false);
        for key in ["sessionDigest", "toolDigest", "inputDigest"] {
            let digest = row.redacted_payload_json[key].as_str().expect("digest");
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
        }
        let audit_text = serde_json::to_string(row).unwrap();
        for hidden in [session, tool, summary, risk] {
            assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio25_approval_request_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_approval_request_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated approval request audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let failure_events = Arc::new(EventBus::new_durable());
        failure_events.attach_db(audit_failure_db.clone());
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(audit_failure_db))
                .with_event_bus(failure_events);
        let Json(audit_failure_result) = rt
            .block_on(tools_call_as_actor(
                &audit_failure_state,
                "approval-request-operator",
                ToolCallBody {
                    name: "aelyris.request_approval".to_string(),
                    arguments: serde_json::json!({
                        "sessionId": session,
                        "tool": tool,
                        "summary": summary,
                        "risk": risk,
                    }),
                },
            ))
            .expect("audit failure does not replay the approval request");
        assert_eq!(audit_failure_result["ok"], true);
        let failure_class = audit_failure_result["result"]["status"]
            .as_str()
            .expect("approval result class");
        assert_eq!(
            audit_failure_state.mcp_pending.lock().unwrap().len(),
            usize::from(failure_class == "pending"),
            "one adapter call creates at most one pending request even when audit fails"
        );
    }

    #[test]
    fn mcp_approval_resolution_audit_is_principal_bound_and_value_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let approval_authority = "AIO22_AUTHORITY_MATERIAL_MUST_NOT_BE_LOGGED";
        let invalid_authority = "AIO22_INVALID_AUTHORITY_MUST_NOT_BE_LOGGED";
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO22_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED")
                .with_input_authority_token(approval_authority),
        )
        .with_db(Some(db.clone()));
        let schema = input_schema_for_tool_ref("aelyris.approval.resolve").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "approval-operator",
                ToolCallBody {
                    name: "aelyris.approval.resolve".to_string(),
                    arguments,
                },
            ))
        };
        let terminal = "AIO22_TERMINAL_MUST_NOT_BE_LOGGED";
        let prompt = "AIO22_PROMPT_KEY_MUST_NOT_BE_LOGGED";

        let Json(accepted) = call(
            &state,
            serde_json::json!({
                "terminalId": terminal,
                "decision": "approve",
                "expectedPromptKey": prompt,
                "humanApprovalCapability": approval_authority,
            }),
        )
        .expect("valid approval resolution succeeds");
        assert_eq!(accepted["ok"], true);
        assert_eq!(accepted["result"]["ok"], true);

        let Json(stale) = call(
            &state,
            serde_json::json!({
                "terminalId": terminal,
                "decision": "deny",
                "expectedPromptKey": "stale-test",
                "humanApprovalCapability": approval_authority,
            }),
        )
        .expect("stale prompt remains a typed tool error");
        assert_eq!(stale["ok"], false);
        assert!(stale["error"]["stale_approval"]
            .as_str()
            .is_some_and(|value| value.contains("stale_approval")));

        let Json(authority_rejected) = call(
            &state,
            serde_json::json!({
                "terminalId": terminal,
                "decision": "approve",
                "expectedPromptKey": prompt,
                "humanApprovalCapability": invalid_authority,
            }),
        )
        .expect("invalid independent authority remains a typed tool error");
        assert_eq!(authority_rejected["ok"], false);
        assert!(authority_rejected["error"]["error"]
            .as_str()
            .is_some_and(|value| value.contains("approval_capability_required")));

        let invalid_decision = "AIO22_INVALID_DECISION_MUST_NOT_BE_LOGGED";
        let Json(decision_rejected) = call(
            &state,
            serde_json::json!({
                "terminalId": terminal,
                "decision": invalid_decision,
                "expectedPromptKey": prompt,
                "humanApprovalCapability": approval_authority,
            }),
        )
        .expect("invalid decision remains a typed tool error");
        assert_eq!(decision_rejected["ok"], false);
        assert_eq!(
            decision_rejected["error"]["schema_violation"]["wrong_type"][0]["field"],
            "decision"
        );
        assert!(
            decision_rejected["error"]["schema_violation"]["wrong_type"][0]["expected"]
                .as_str()
                .is_some_and(|value| value.contains("approve") && value.contains("deny"))
        );

        let invalid_terminal = "%404";
        let Json(terminal_rejected) = call(
            &state,
            serde_json::json!({
                "terminalId": invalid_terminal,
                "decision": "approve",
                "expectedPromptKey": prompt,
                "humanApprovalCapability": approval_authority,
            }),
        )
        .expect("invalid terminal reference remains a typed tool error");
        assert_eq!(terminal_rejected["ok"], false);
        assert!(terminal_rejected["error"]["error"]
            .as_str()
            .is_some_and(|value| value.contains("unknown terminal reference")));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_approval_resolution_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read approval resolution audit");
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("approval-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["resultClass"] == "resolved"
                && row.redacted_payload_json["authorityVerified"] == true
                && row.redacted_payload_json["resolutionApplied"] == true
        }));
        for code in [
            "stale_approval",
            "approval_capability_required",
            "terminal_reference_invalid",
        ] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["rejectionCode"] == code));
        }
        let accepted_input_digest = rows
            .iter()
            .find(|row| row.redacted_payload_json["status"] == "accepted")
            .and_then(|row| row.redacted_payload_json["inputDigest"].as_str())
            .expect("accepted input digest");
        let authority_rejected_input_digest = rows
            .iter()
            .find(|row| {
                row.redacted_payload_json["rejectionCode"] == "approval_capability_required"
            })
            .and_then(|row| row.redacted_payload_json["inputDigest"].as_str())
            .expect("authority rejection input digest");
        assert_eq!(accepted_input_digest, authority_rejected_input_digest);
        let terminal_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["terminalDigest"]
                    .as_str()
                    .expect("terminal digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let prompt_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["promptDigest"]
                    .as_str()
                    .expect("prompt digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("approval input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(terminal_digests.len(), 2);
        assert_eq!(prompt_digests.len(), 2);
        assert_eq!(input_digests.len(), 3);
        assert!(terminal_digests
            .iter()
            .chain(prompt_digests.iter())
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        let authority_digest = crate::command_risk::approval::command_hash(approval_authority);
        let invalid_authority_digest =
            crate::command_risk::approval::command_hash(invalid_authority);
        for row in &rows {
            assert_eq!(row.redacted_payload_json["approvalValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["authorityMaterialLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                terminal,
                prompt,
                approval_authority,
                invalid_authority,
                invalid_decision,
                invalid_terminal,
                authority_digest.as_str(),
                invalid_authority_digest.as_str(),
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio22_approval_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_approval_resolution_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated approval audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("public-audit-failure")
                .with_input_authority_token(approval_authority),
        )
        .with_db(Some(audit_failure_db));
        let Json(audit_failure_result) = call(
            &audit_failure_state,
            serde_json::json!({
                "terminalId": "AIO22_AUDIT_FAILURE_TERMINAL_MUST_NOT_BE_LOGGED",
                "decision": "approve",
                "expectedPromptKey": "AIO22_AUDIT_FAILURE_PROMPT_MUST_NOT_BE_LOGGED",
                "humanApprovalCapability": approval_authority,
            }),
        )
        .expect("audit failure does not create another approval result");
        assert_eq!(audit_failure_result["ok"], true);
        assert_eq!(audit_failure_result["result"]["ok"], true);
    }

    #[test]
    fn mcp_orchestrator_step_audit_is_principal_bound_and_target_free() {
        use crate::agent::AgentManager;
        use crate::context_store::ContextStoreManager;
        use crate::cost::CostManager;
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::EventBus;
        use crate::file_ownership::FileOwnership;
        use crate::pty::PtyManager;
        use crate::startup_reconciliation::{
            StartupAuthorityReport, StartupReconciliationState, REQUIRED_STARTUP_AUTHORITIES,
        };
        use crate::symbol_ownership::SymbolOwnership;
        use crate::task::TaskManager;
        use std::sync::Mutex;

        fn ready_startup() -> Arc<StartupReconciliationState> {
            let startup = Arc::new(StartupReconciliationState::new());
            startup.mark_database_ready().unwrap();
            for authority in REQUIRED_STARTUP_AUTHORITIES {
                startup
                    .record_authority(StartupAuthorityReport::reconciled(authority, 0, 0))
                    .unwrap();
            }
            assert!(startup.complete(0, 0, 0).unwrap());
            startup
        }

        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("AIO23_REPOSITORY_PATH_MUST_NOT_BE_LOGGED");
        std::fs::create_dir(&repo).unwrap();
        let repo_path = repo.to_string_lossy().replace('\\', "/");
        let invalid_repo = temp
            .path()
            .join("AIO23_INVALID_REPOSITORY_MUST_NOT_BE_LOGGED")
            .to_string_lossy()
            .replace('\\', "/");

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = Arc::new(TaskManager::new());
        let cost = Arc::new(CostManager::new());
        let agents = AgentManager::new();
        let file_ownership = Arc::new(Mutex::new(FileOwnership::new()));
        let symbol_ownership = Arc::new(Mutex::new(SymbolOwnership::new()));
        let events = Arc::new(EventBus::new());
        let context = Arc::new(ContextStoreManager::new());
        let ready = ready_startup();

        let make_state = |startup: Arc<StartupReconciliationState>, include_tasks: bool| {
            let state = ApiState::new(
                PtyManager::new(),
                crate::api::AuthConfig::with_token("AIO23_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
            )
            .with_db(Some(db.clone()))
            .with_startup_reconciliation(startup)
            .with_cost_manager(cost.clone())
            .with_agent_manager(agents.clone())
            .with_file_ownership(file_ownership.clone())
            .with_symbol_ownership(symbol_ownership.clone())
            .with_event_bus(events.clone())
            .with_context_store(context.clone());
            if include_tasks {
                state.with_task_manager(tasks.clone())
            } else {
                state
            }
        };
        let state = make_state(ready.clone(), true);
        let schema = input_schema_for_tool_ref("aelyris.orchestrator.step").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, repo_path: &str, active_agents: usize| {
            rt.block_on(tools_call_as_actor(
                state,
                "orchestrator-operator",
                ToolCallBody {
                    name: "aelyris.orchestrator.step".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "activeAgents": active_agents,
                    }),
                },
            ))
        };

        let Json(success) = call(&state, &repo_path, 0).expect("empty graph step succeeds");
        assert_eq!(success["result"]["report"]["state"], "complete");
        for field in [
            "dispatched",
            "merged",
            "settlement_pending",
            "rejected",
            "recovered",
            "escalations",
        ] {
            assert_eq!(success["result"]["report"][field], serde_json::json!([]));
        }

        let pending_state = make_state(Arc::new(StartupReconciliationState::new()), true);
        assert!(matches!(
            call(&pending_state, &repo_path, 0),
            Err(ApiError::Internal(message))
                if message.contains("startup_reconciliation_pending")
        ));

        let missing_task_state = make_state(ready.clone(), false);
        assert!(matches!(
            call(&missing_task_state, &repo_path, 0),
            Err(ApiError::Internal(message))
                if message.contains("task graph is not attached")
        ));

        assert!(matches!(
            call(&state, &invalid_repo, 0),
            Err(ApiError::Internal(message))
                if message.contains("repo path must exist")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_orchestrator_step_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read orchestrator-step audit");
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("orchestrator-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["reportState"] == "complete"
                && row.redacted_payload_json["reportProduced"] == true
                && row.redacted_payload_json["dispatchedCount"] == 0
                && row.redacted_payload_json["mergedCount"] == 0
                && row.redacted_payload_json["settlementPendingCount"] == 0
                && row.redacted_payload_json["rejectedCount"] == 0
                && row.redacted_payload_json["recoveredCount"] == 0
                && row.redacted_payload_json["escalationCount"] == 0
        }));
        for code in [
            "startup_reconciliation_pending",
            "task_graph_unavailable",
            "repository_path_invalid",
        ] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["rejectionCode"] == code));
        }
        let repository_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["repositoryDigest"]
                    .as_str()
                    .expect("repository digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("orchestrator input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(repository_digests.len(), 2);
        assert_eq!(input_digests.len(), 2);
        assert!(repository_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["executionValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                repo_path.as_str(),
                invalid_repo.as_str(),
                "AIO23_REPOSITORY_PATH_MUST_NOT_BE_LOGGED",
                "AIO23_INVALID_REPOSITORY_MUST_NOT_BE_LOGGED",
                "mcp-dispatch-only",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio23_orchestrator_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_orchestrator_step_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated orchestrator audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("public-audit-failure"),
        )
        .with_db(Some(audit_failure_db))
        .with_startup_reconciliation(ready)
        .with_task_manager(Arc::new(TaskManager::new()))
        .with_cost_manager(Arc::new(CostManager::new()))
        .with_agent_manager(AgentManager::new())
        .with_file_ownership(Arc::new(Mutex::new(FileOwnership::new())))
        .with_symbol_ownership(Arc::new(Mutex::new(SymbolOwnership::new())))
        .with_event_bus(Arc::new(EventBus::new()))
        .with_context_store(Arc::new(ContextStoreManager::new()));
        let Json(audit_failure_result) = call(&audit_failure_state, &repo_path, 0)
            .expect("audit failure does not create another orchestrator report");
        assert_eq!(
            audit_failure_result["result"]["report"]["state"],
            "complete"
        );
    }

    #[test]
    fn mcp_mission_review_settlement_exposes_no_caller_authored_authority() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let schema = input_schema_for_tool_ref("aelyris.mission.review_and_settle")
            .expect("Mission review settlement schema");
        assert_eq!(
            schema["required"],
            serde_json::json!(["repoPath", "taskId"])
        );
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            ["repoPath".to_string(), "taskId".to_string()]
                .into_iter()
                .collect()
        );
        for forbidden in [
            "actor",
            "verdict",
            "reviewerId",
            "candidateSourceOid",
            "candidateTargetOid",
            "gatesDigest",
            "mergeToken",
            "workPacket",
            "missionCompletionPacket",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.review_and_settle")
            .expect("Mission review settlement tool");
        assert_eq!(tool["safety"], "GATED");
        let description = tool["description"].as_str().unwrap();
        for required in [
            "backend-owned",
            "fixed independent reviewer",
            "exact-OID",
            "current-Mission membership",
            "TaskGraph Review status",
            "cannot supply a verdict",
            "WorkPacket",
            "MissionCompletionPacket",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO44_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
        )
        .with_db(Some(db.clone()));
        let repo_path = "C:/AIO44_REPOSITORY_PATH_MUST_NOT_BE_LOGGED";
        let task_id = "AIO44_TASK_ID_MUST_NOT_BE_LOGGED";
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-settlement-operator",
                ToolCallBody {
                    name: "aelyris.mission.review_and_settle".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "taskId": task_id,
                    }),
                },
            )),
            Err(ApiError::Internal(message))
                if message.contains("task graph is not attached")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_mission_review_settlement_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read Mission review settlement audit");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.agent_id.as_deref(), Some("mission-settlement-operator"));
        assert!(row.task_id.is_none());
        assert!(row.session_id.is_none());
        assert!(row.terminal_id.is_none());
        assert_eq!(row.redacted_payload_json["status"], "rejected");
        assert_eq!(
            row.redacted_payload_json["rejectionCode"],
            "runtime_owner_unavailable"
        );
        assert_eq!(
            row.redacted_payload_json["currentMissionPreflightPassed"],
            false
        );
        for field in ["repositoryDigest", "taskDigest", "inputDigest"] {
            let digest = row.redacted_payload_json[field]
                .as_str()
                .expect("one-way digest");
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
        }
        for flag in [
            "callerSuppliedVerdict",
            "callerSuppliedCandidateOid",
            "callerSuppliedReviewerIdentity",
            "callerSuppliedMergeAuthority",
            "callerSuppliedPacket",
            "reviewValuesLogged",
            "repositoryPathLogged",
            "taskIdentityLogged",
            "oidValuesLogged",
            "packetIdentitiesLogged",
        ] {
            assert_eq!(row.redacted_payload_json[flag], false, "flag {flag}");
        }
        let audit_text = serde_json::to_string(row).unwrap();
        for hidden in [repo_path, task_id, "AIO44_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"] {
            assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
        }

        let Json(schema_error) = rt
            .block_on(tools_call_as_actor(
                &state,
                "mission-settlement-operator",
                ToolCallBody {
                    name: "aelyris.mission.review_and_settle".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "taskId": task_id,
                        "verdict": "approve",
                    }),
                },
            ))
            .expect("schema rejection is structured");
        assert_eq!(schema_error["ok"], false);
        assert_eq!(
            schema_error["error"]["schema_violation"]["verb"],
            "aelyris.mission.review_and_settle"
        );
        assert_eq!(
            schema_error["error"]["schema_violation"]["unknown"],
            serde_json::json!(["verdict"])
        );
    }

    #[test]
    fn mcp_mission_planning_exposes_no_caller_authored_plan_authority() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let schema =
            input_schema_for_tool_ref("aelyris.mission.plan").expect("Mission planning schema");
        assert_eq!(schema["required"], serde_json::json!(["repoPath", "goal"]));
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            [
                "context".to_string(),
                "goal".to_string(),
                "repoPath".to_string(),
            ]
            .into_iter()
            .collect()
        );
        assert_eq!(properties["repoPath"]["maxLength"], 4096);
        assert_eq!(properties["goal"]["maxLength"], 16384);
        assert_eq!(properties["context"]["maxLength"], 32768);
        for forbidden in [
            "actor",
            "model",
            "command",
            "missionId",
            "planId",
            "tasks",
            "dependencies",
            "sourceBranch",
            "targetBranch",
            "outputs",
            "symbols",
            "status",
            "workPacket",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.plan")
            .expect("Mission planning tool");
        assert_eq!(tool["safety"], "GATED");
        let description = tool["description"].as_str().unwrap();
        for required in [
            "backend-owned planner",
            "atomic Mission/TaskGraph",
            "cannot supply a planner binary/command/model",
            "value-minimized generated-task coordination view",
            "never paths",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO45_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
        )
        .with_db(Some(db.clone()));
        let repo_path = "C:/AIO45_REPOSITORY_PATH_MUST_NOT_BE_LOGGED";
        let goal = "AIO45_GOAL_VALUE_MUST_NOT_BE_LOGGED";
        let context = "AIO45_CONTEXT_VALUE_MUST_NOT_BE_LOGGED";
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-planning-operator",
                ToolCallBody {
                    name: "aelyris.mission.plan".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "goal": goal,
                        "context": context,
                    }),
                },
            )),
            Err(ApiError::Internal(message))
                if message.contains("runtime is not attached")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_mission_planning_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read Mission planning audit");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.agent_id.as_deref(), Some("mission-planning-operator"));
        assert!(row.task_id.is_none());
        assert!(row.session_id.is_none());
        assert!(row.terminal_id.is_none());
        assert_eq!(row.redacted_payload_json["status"], "rejected");
        assert_eq!(
            row.redacted_payload_json["rejectionCode"],
            "runtime_owner_unavailable"
        );
        for field in [
            "repositoryDigest",
            "goalDigest",
            "contextDigest",
            "inputDigest",
        ] {
            let digest = row.redacted_payload_json[field]
                .as_str()
                .expect("one-way digest");
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
        }
        for flag in [
            "callerSuppliedPlannerModel",
            "callerSuppliedPlannerCommand",
            "callerSuppliedMissionIdentity",
            "callerSuppliedPlanIdentity",
            "callerSuppliedTaskGraph",
            "callerSuppliedBranch",
            "callerSuppliedOutput",
            "callerSuppliedStatus",
            "callerSuppliedPacket",
            "goalValueLogged",
            "contextValueLogged",
            "repositoryPathLogged",
            "promptLogged",
            "planJsonLogged",
            "taskValuesLogged",
            "missionIdentityLogged",
            "planIdentityLogged",
        ] {
            assert_eq!(row.redacted_payload_json[flag], false, "flag {flag}");
        }
        let audit_text = serde_json::to_string(row).unwrap();
        for hidden in [
            repo_path,
            goal,
            context,
            "AIO45_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED",
        ] {
            assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
        }

        for (field, value) in [
            ("model", serde_json::json!("caller-model")),
            ("tasks", serde_json::json!([{"id": "caller-task"}])),
        ] {
            let mut arguments = serde_json::Map::new();
            arguments.insert("repoPath".to_string(), serde_json::json!(repo_path));
            arguments.insert("goal".to_string(), serde_json::json!(goal));
            arguments.insert(field.to_string(), value);
            let Json(schema_error) = rt
                .block_on(tools_call_as_actor(
                    &state,
                    "mission-planning-operator",
                    ToolCallBody {
                        name: "aelyris.mission.plan".to_string(),
                        arguments: serde_json::Value::Object(arguments),
                    },
                ))
                .expect("schema rejection is structured");
            assert_eq!(schema_error["ok"], false);
            assert_eq!(
                schema_error["error"]["schema_violation"]["verb"],
                "aelyris.mission.plan"
            );
            assert_eq!(
                schema_error["error"]["schema_violation"]["unknown"],
                serde_json::json!([field])
            );
        }
    }

    #[test]
    fn mcp_mission_current_is_value_minimized_and_query_unshaped() {
        use crate::pty::PtyManager;

        let schema = input_schema_for_tool_ref("aelyris.mission.current")
            .expect("Mission continuity schema");
        assert_eq!(schema["required"], serde_json::json!(["repoPath"]));
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            ["repoPath".to_string()].into_iter().collect()
        );
        assert_eq!(properties["repoPath"]["maxLength"], 4096);
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "status",
            "branch",
            "model",
            "packet",
            "limit",
            "cursor",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.current")
            .expect("Mission continuity tool");
        assert_eq!(tool["safety"], "FREE");
        let description = tool["description"].as_str().unwrap();
        for required in [
            "exact current accepted cockpit Mission",
            "SQLite-backed TaskManager",
            "structured not_found",
            "never raw Goal/request",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        );
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-continuity-operator",
                ToolCallBody {
                    name: "aelyris.mission.current".to_string(),
                    arguments: serde_json::json!({ "repoPath": "C:/repo" }),
                },
            )),
            Err(ApiError::Internal(message)) if message.contains("task graph is not attached")
        ));

        let Json(schema_error) = rt
            .block_on(tools_call_as_actor(
                &state,
                "mission-continuity-operator",
                ToolCallBody {
                    name: "aelyris.mission.current".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": "C:/repo",
                        "missionId": "caller-shaped",
                    }),
                },
            ))
            .expect("schema rejection is structured");
        assert_eq!(schema_error["ok"], false);
        assert_eq!(
            schema_error["error"]["schema_violation"]["verb"],
            "aelyris.mission.current"
        );
        assert_eq!(
            schema_error["error"]["schema_violation"]["unknown"],
            serde_json::json!(["missionId"])
        );
    }

    #[test]
    fn mcp_mission_completion_is_restart_safe_and_caller_unshaped() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let schema = input_schema_for_tool_ref("aelyris.mission.completion")
            .expect("Mission completion schema");
        assert_eq!(schema["required"], serde_json::json!(["repoPath"]));
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            ["repoPath".to_string()].into_iter().collect()
        );
        assert_eq!(properties["repoPath"]["maxLength"], 4096);
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "workPacketId",
            "missionCompletionPacketId",
            "oid",
            "eventCursor",
            "reviewId",
            "settle",
            "limit",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.completion")
            .expect("Mission completion tool");
        assert_eq!(tool["safety"], "FREE");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["readOnly"], true);
        let description = tool["description"].as_str().unwrap();
        for required in [
            "restart-safe immutable completion receipt",
            "one exact WorkPacket reference per task",
            "MissionCompletionPacket",
            "never invokes a planner, reviewer, merge, settlement replay",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO49_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
        )
        .with_db(Some(db.clone()));
        let repo_path = "C:/AIO49_REPOSITORY_PATH_MUST_NOT_BE_LOGGED";
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-completion-operator",
                ToolCallBody {
                    name: "aelyris.mission.completion".to_string(),
                    arguments: serde_json::json!({ "repoPath": repo_path }),
                },
            )),
            Err(ApiError::Internal(message)) if message.contains("task graph is not attached")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_mission_completion_read".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read Mission completion audit");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.agent_id.as_deref(), Some("mission-completion-operator"));
        assert_eq!(row.redacted_payload_json["status"], "rejected");
        assert_eq!(row.redacted_payload_json["receiptReturned"], false);
        for flag in [
            "repositoryPathLogged",
            "goalOrContextLogged",
            "missionIdentityLogged",
            "planIdentityLogged",
            "taskIdentityLogged",
            "packetIdentityLogged",
            "packetContentsLogged",
            "oidValuesLogged",
            "eventReviewEvidenceLogged",
        ] {
            assert_eq!(row.redacted_payload_json[flag], false, "flag {flag}");
        }
        let audit_text = serde_json::to_string(row).unwrap();
        for hidden in [
            repo_path,
            "AIO49_REPOSITORY_PATH_MUST_NOT_BE_LOGGED",
            "AIO49_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED",
        ] {
            assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
        }

        let Json(schema_error) = rt
            .block_on(tools_call_as_actor(
                &state,
                "mission-completion-operator",
                ToolCallBody {
                    name: "aelyris.mission.completion".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "workPacketId": "caller-shaped",
                    }),
                },
            ))
            .expect("schema rejection is structured");
        assert_eq!(schema_error["ok"], false);
        assert_eq!(
            schema_error["error"]["schema_violation"]["verb"],
            "aelyris.mission.completion"
        );
        assert_eq!(
            schema_error["error"]["schema_violation"]["unknown"],
            serde_json::json!(["workPacketId"])
        );
    }

    #[test]
    fn mcp_mission_history_is_bounded_restart_safe_and_payload_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let schema =
            input_schema_for_tool_ref("aelyris.mission.history").expect("Mission history schema");
        assert_eq!(schema["required"], serde_json::json!(["repoPath"]));
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            ["limit".to_string(), "repoPath".to_string()]
                .into_iter()
                .collect()
        );
        assert_eq!(properties["repoPath"]["maxLength"], 4096);
        assert_eq!(properties["limit"]["minimum"], 1);
        assert_eq!(properties["limit"]["maximum"], 100);
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "workPacketId",
            "candidateOid",
            "eventId",
            "afterSeq",
            "reviewId",
            "evidenceId",
            "cursor",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.history")
            .expect("Mission history tool");
        assert_eq!(tool["safety"], "FREE");
        assert_eq!(tool["accessMode"], "observe-only");
        assert_eq!(tool["readOnly"], true);
        let description = tool["description"].as_str().unwrap();
        for required in [
            "bounded newest-first history",
            "SQLite/TaskManager remains the only history owner",
            "packet-backed completion receipt digest",
            "never returns Goal/context",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO50_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
        )
        .with_db(Some(db.clone()));
        let repo_path = "C:/AIO50_REPOSITORY_PATH_MUST_NOT_BE_LOGGED";
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-history-operator",
                ToolCallBody {
                    name: "aelyris.mission.history".to_string(),
                    arguments: serde_json::json!({ "repoPath": repo_path, "limit": 5 }),
                },
            )),
            Err(ApiError::Internal(message)) if message.contains("task graph is not attached")
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_mission_history_read".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read Mission history audit");
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.agent_id.as_deref(), Some("mission-history-operator"));
        assert_eq!(row.redacted_payload_json["status"], "rejected");
        assert_eq!(row.redacted_payload_json["effectiveLimit"], 5);
        for flag in [
            "repositoryPathLogged",
            "goalOrContextLogged",
            "missionIdentityLogged",
            "planIdentityLogged",
            "taskIdentityLogged",
            "packetIdentityLogged",
            "packetContentsLogged",
            "oidValuesLogged",
            "eventReviewEvidenceLogged",
        ] {
            assert_eq!(row.redacted_payload_json[flag], false, "flag {flag}");
        }
        let audit_text = serde_json::to_string(row).unwrap();
        for hidden in [
            repo_path,
            "AIO50_REPOSITORY_PATH_MUST_NOT_BE_LOGGED",
            "AIO50_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED",
        ] {
            assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
        }

        let Json(schema_error) = rt
            .block_on(tools_call_as_actor(
                &state,
                "mission-history-operator",
                ToolCallBody {
                    name: "aelyris.mission.history".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": repo_path,
                        "missionId": "caller-shaped",
                    }),
                },
            ))
            .expect("schema rejection is structured");
        assert_eq!(schema_error["ok"], false);
        assert_eq!(
            schema_error["error"]["schema_violation"]["verb"],
            "aelyris.mission.history"
        );
        assert_eq!(
            schema_error["error"]["schema_violation"]["unknown"],
            serde_json::json!(["missionId"])
        );
    }

    #[test]
    fn mcp_mission_run_next_is_visible_caller_unshaped_and_review_bounded() {
        use crate::pty::PtyManager;

        let schema =
            input_schema_for_tool_ref("aelyris.mission.run_next").expect("Mission run-next schema");
        assert_eq!(schema["required"], serde_json::json!(["repoPath"]));
        assert_eq!(schema["additionalProperties"], false);
        let properties = schema["properties"].as_object().expect("schema properties");
        assert_eq!(
            properties.keys().cloned().collect::<BTreeSet<_>>(),
            ["repoPath".to_string()].into_iter().collect()
        );
        assert_eq!(properties["repoPath"]["maxLength"], 4096);
        for forbidden in [
            "activeAgents",
            "tokensUsed",
            "costUsd",
            "runtimeSecs",
            "taskId",
            "model",
            "command",
            "branch",
            "gates",
            "reviewerId",
            "verdict",
            "mergeToken",
            "workPacket",
            "missionCompletionPacket",
        ] {
            assert!(properties.get(forbidden).is_none());
        }

        let tools = tools_list_value();
        let tool = tools["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "aelyris.mission.run_next")
            .expect("Mission run-next tool");
        assert_eq!(tool["safety"], "GATED");
        let description = tool["description"].as_str().unwrap();
        for required in [
            "visible orchestrator_step",
            "PaneFleet",
            "stops at Review",
            "configured token or monetary caps fail closed",
            "never paths, terminal ids, prompts, commands",
        ] {
            assert!(
                description.contains(required),
                "description missing {required}"
            );
        }

        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        );
        let rt = tokio::runtime::Runtime::new().unwrap();
        assert!(matches!(
            rt.block_on(tools_call_as_actor(
                &state,
                "mission-run-next-operator",
                ToolCallBody {
                    name: "aelyris.mission.run_next".to_string(),
                    arguments: serde_json::json!({ "repoPath": "C:/repo" }),
                },
            )),
            Err(ApiError::Internal(message)) if message.contains("task graph is not attached")
        ));

        let Json(schema_error) = rt
            .block_on(tools_call_as_actor(
                &state,
                "mission-run-next-operator",
                ToolCallBody {
                    name: "aelyris.mission.run_next".to_string(),
                    arguments: serde_json::json!({
                        "repoPath": "C:/repo",
                        "activeAgents": 0,
                    }),
                },
            ))
            .expect("schema rejection is structured");
        assert_eq!(schema_error["ok"], false);
        assert_eq!(
            schema_error["error"]["schema_violation"]["verb"],
            "aelyris.mission.run_next"
        );
        assert_eq!(
            schema_error["error"]["schema_violation"]["unknown"],
            serde_json::json!(["activeAgents"])
        );
    }

    #[test]
    fn spawn_visible_mcp_schema_and_tool_error_contract() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("t"),
        );

        let call = |arguments: serde_json::Value| {
            let body = ToolCallBody {
                name: "aelyris.agent.spawn_visible".to_string(),
                arguments,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
                .expect("tool call response")
                .0
        };

        let Json(listed) = rt.block_on(tools_list());
        let tool = listed["tools"]
            .as_array()
            .expect("tools is an array")
            .iter()
            .find(|tool| tool["name"].as_str() == Some("aelyris.agent.spawn_visible"))
            .expect("spawn_visible is listed");
        assert_eq!(tool["safety"], serde_json::json!("GATED"));
        assert_eq!(tool["inputSchema"]["required"], serde_json::json!(["cwd"]));
        assert_eq!(
            tool["inputSchema"]["additionalProperties"],
            serde_json::json!(false)
        );

        let ok = call(serde_json::json!({
            "cwd": "C:/repo",
            "cols": 120,
            "rows": 30
        }));
        assert_eq!(ok["ok"], serde_json::json!(true));
        assert_eq!(
            ok["result"]["session_id"],
            serde_json::json!("session-visible")
        );
        assert_eq!(ok["result"]["pty_id"], serde_json::json!("pty-visible"));
        assert_eq!(ok["result"]["backend"], serde_json::json!("sidecar"));

        let denied = call(serde_json::json!({ "cwd": "cost-deny" }));
        assert_eq!(denied["ok"], serde_json::json!(false));
        assert!(
            denied["error"]["error"]
                .as_str()
                .is_some_and(|message| message.contains("cost cap denied")),
            "{denied:?}"
        );

        let low_cols = call(serde_json::json!({
            "cwd": "C:/repo",
            "cols": 19,
            "rows": 30
        }));
        assert_eq!(low_cols["ok"], serde_json::json!(false));
        assert_eq!(
            low_cols["error"]["schema_violation"]["wrong_type"][0]["field"],
            serde_json::json!("cols")
        );
        assert_eq!(
            low_cols["error"]["schema_violation"]["wrong_type"][0]["expected"],
            serde_json::json!("integer >= 20")
        );
    }

    #[test]
    fn mcp_agent_lifecycle_audit_is_principal_bound_and_payload_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()));
        for verb in [
            "aelyris.spawn_agent",
            "aelyris.agent.spawn_visible",
            "aelyris.stop_agent",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "lifecycle-agent",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };

        let Json(headless) = call(
            "aelyris.spawn_agent",
            serde_json::json!({
                "prompt": "AIO11_HEADLESS_PROMPT_MUST_NOT_BE_LOGGED",
                "cwd": "C:/AIO11_HEADLESS_CWD_MUST_NOT_BE_LOGGED",
                "model": "AIO11_MODEL_MUST_NOT_BE_LOGGED",
                "allowedTools": ["AIO11_TOOL_MUST_NOT_BE_LOGGED"],
                "resumeId": "AIO11_RESUME_MUST_NOT_BE_LOGGED",
            }),
        )
        .expect("headless spawn succeeds through test runtime");
        assert_eq!(headless["result"]["sessionId"], "session-headless");

        assert!(matches!(
            call(
                "aelyris.spawn_agent",
                serde_json::json!({
                    "prompt": "AIO11_REJECTED_PROMPT_MUST_NOT_BE_LOGGED",
                    "cwd": "headless-deny",
                }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let Json(visible) = call(
            "aelyris.agent.spawn_visible",
            serde_json::json!({
                "cwd": "C:/AIO11_VISIBLE_CWD_MUST_NOT_BE_LOGGED",
                "model": "AIO11_VISIBLE_MODEL_MUST_NOT_BE_LOGGED",
                "initialPrompt": "AIO11_VISIBLE_PROMPT_MUST_NOT_BE_LOGGED",
                "branchName": "AIO11_BRANCH_MUST_NOT_BE_LOGGED",
                "cols": 120,
                "rows": 30,
            }),
        )
        .expect("visible spawn succeeds through test runtime");
        assert_eq!(visible["result"]["session_id"], "session-visible");

        let Json(visible_denied) = call(
            "aelyris.agent.spawn_visible",
            serde_json::json!({
                "cwd": "cost-deny",
                "initialPrompt": "AIO11_VISIBLE_REJECTED_PROMPT_MUST_NOT_BE_LOGGED",
            }),
        )
        .expect("visible denial remains typed tool result");
        assert_eq!(visible_denied["ok"], false);

        let Json(stopped) = call(
            "aelyris.stop_agent",
            serde_json::json!({ "sessionId": "session-headless" }),
        )
        .expect("headless stop succeeds through test runtime");
        assert_eq!(stopped["result"]["stopped"], true);

        assert!(matches!(
            call(
                "aelyris.stop_agent",
                serde_json::json!({ "sessionId": "missing-session" }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_agent_lifecycle_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read agent lifecycle audit");
        assert_eq!(rows.len(), 6);
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("lifecycle-agent")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["runtimeKind"] == "visible")
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["operation"] == "stop")
                .count(),
            2
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["sessionId"] == "session-visible"
                && row.redacted_payload_json["status"] == "accepted"
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["taskPayloadLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for secret in [
                "AIO11_HEADLESS_PROMPT_MUST_NOT_BE_LOGGED",
                "AIO11_HEADLESS_CWD_MUST_NOT_BE_LOGGED",
                "AIO11_MODEL_MUST_NOT_BE_LOGGED",
                "AIO11_TOOL_MUST_NOT_BE_LOGGED",
                "AIO11_RESUME_MUST_NOT_BE_LOGGED",
                "AIO11_REJECTED_PROMPT_MUST_NOT_BE_LOGGED",
                "headless-deny",
                "AIO11_VISIBLE_CWD_MUST_NOT_BE_LOGGED",
                "AIO11_VISIBLE_MODEL_MUST_NOT_BE_LOGGED",
                "AIO11_VISIBLE_PROMPT_MUST_NOT_BE_LOGGED",
                "AIO11_BRANCH_MUST_NOT_BE_LOGGED",
                "AIO11_VISIBLE_REJECTED_PROMPT_MUST_NOT_BE_LOGGED",
                "cost-deny",
            ] {
                assert!(!audit_text.contains(secret), "audit exposed {secret}");
            }
        }
    }

    #[test]
    fn mcp_worktree_mutation_audit_is_principal_bound_and_target_minimized() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("AIO12_REPO_PATH_MUST_NOT_BE_LOGGED");
        std::fs::create_dir(&repo).unwrap();
        let git = |args: &[&str]| {
            crate::process::hidden_command("git")
                .args(args)
                .current_dir(&repo)
                .output()
                .expect("git available")
        };
        assert!(git(&["init", "-q", "-b", "main"]).status.success());
        assert!(git(&["config", "user.email", "aio12@example.invalid"])
            .status
            .success());
        assert!(git(&["config", "user.name", "AIO12 Test"]).status.success());
        std::fs::write(repo.join("base.txt"), "base").unwrap();
        assert!(git(&["add", "."]).status.success());
        assert!(git(&["commit", "-qm", "base"]).status.success());

        let repo_path = repo.to_string_lossy().replace('\\', "/");
        let branch = "agent/AIO12_BRANCH_MUST_NOT_BE_LOGGED";
        let predicted = crate::control::worktree::predict_path(&repo_path, branch)
            .to_string_lossy()
            .replace('\\', "/");
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()));
        for verb in ["aelyris.worktree.create", "aelyris.worktree.remove"] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "worktree-agent",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };

        let Json(created) = call(
            "aelyris.worktree.create",
            serde_json::json!({
                "repoPath": repo_path,
                "branchName": branch,
            }),
        )
        .expect("create worktree");
        assert_eq!(created["result"]["worktree"]["branch"], branch);
        assert!(created["result"].get("repoPath").is_none());
        assert!(created["result"].get("branchName").is_none());
        assert!(created["result"]["worktree"].get("path").is_none());
        assert_eq!(created["result"]["repositoryPathExposed"], false);
        assert_eq!(created["result"]["worktreePathsExposed"], false);
        let created_digest = created["result"]["repositoryDigest"]
            .as_str()
            .expect("create repository digest");
        assert_eq!(created_digest.len(), 64);
        assert!(created_digest
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        let created_text = serde_json::to_string(&created["result"]).unwrap();
        assert!(!created_text.contains(&repo_path));
        assert!(!created_text.contains(&predicted));
        assert!(std::path::Path::new(&predicted).exists());

        assert!(matches!(
            call(
                "aelyris.worktree.create",
                serde_json::json!({
                    "repoPath": repo_path,
                    "branchName": branch,
                }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let Json(removed) = call(
            "aelyris.worktree.remove",
            serde_json::json!({
                "repoPath": repo_path,
                "worktreeName": branch,
                "deleteBranch": true,
            }),
        )
        .expect("remove branch-owned worktree");
        assert_eq!(removed["result"]["removed"], true);
        assert_eq!(removed["result"]["deleteBranch"], true);
        assert_eq!(removed["result"]["worktreeName"], branch);
        assert!(removed["result"].get("repoPath").is_none());
        assert_eq!(removed["result"]["repositoryPathExposed"], false);
        assert_eq!(removed["result"]["worktreePathsExposed"], false);
        assert_eq!(removed["result"]["repositoryDigest"], created_digest);
        let removed_text = serde_json::to_string(&removed["result"]).unwrap();
        assert!(!removed_text.contains(&repo_path));
        assert!(!removed_text.contains(&predicted));
        assert!(!std::path::Path::new(&predicted).exists());
        assert!(!git(&[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ])
        .status
        .success());

        assert!(matches!(
            call(
                "aelyris.worktree.remove",
                serde_json::json!({
                    "repoPath": repo_path,
                    "worktreeName": branch,
                    "deleteBranch": true,
                }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_worktree_mutation_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read worktree mutation audit");
        assert_eq!(rows.len(), 4);
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("worktree-agent")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            2
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "create"
                && row.redacted_payload_json["rejectionCode"] == "worktree_create_failed"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "remove"
                && row.redacted_payload_json["deleteBranch"] == true
                && row.redacted_payload_json["rejectionCode"] == "worktree_remove_failed"
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["targetValuesLogged"], false);
            let digest = row.redacted_payload_json["targetDigest"]
                .as_str()
                .expect("target digest");
            assert_eq!(digest.len(), 64);
            assert!(digest
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
            let audit_text = serde_json::to_string(row).unwrap();
            assert!(!audit_text.contains("AIO12_REPO_PATH_MUST_NOT_BE_LOGGED"));
            assert!(!audit_text.contains("AIO12_BRANCH_MUST_NOT_BE_LOGGED"));
            assert!(!audit_text.contains(&repo_path));
            assert!(!audit_text.contains(&predicted));
        }
    }

    #[test]
    fn mcp_task_mutation_audit_is_principal_bound_and_packet_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::{AgentEventKind, EventBus};
        use crate::pty::PtyManager;
        use crate::task::{TaskManager, TaskStatus};

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = Arc::new(TaskManager::new());
        let bus = Arc::new(EventBus::new_durable());
        bus.attach_db(db.clone());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_task_manager(tasks.clone())
            .with_event_bus(bus.clone());
        for verb in ["aelyris.task.create", "aelyris.task.transition"] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "task-agent",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let task_id = "AIO13_TASK_ID_MUST_NOT_BE_LOGGED";
        let title = "AIO13_TITLE_MUST_NOT_BE_LOGGED";
        let description = "AIO13_DESCRIPTION_MUST_NOT_BE_LOGGED";
        let owner = "AIO13_ASSIGNED_OWNER_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let model = "AIO13_MODEL_MUST_NOT_BE_LOGGED";
        let output = "AIO13_OUTPUT_MUST_NOT_BE_LOGGED";
        let source_branch = "AIO13_SOURCE_BRANCH_MUST_NOT_BE_LOGGED";
        let target_branch = "AIO13_TARGET_BRANCH_MUST_NOT_BE_LOGGED";

        let Json(created) = call(
            &state,
            "aelyris.task.create",
            serde_json::json!({
                "id": task_id,
                "title": title,
                "description": description,
                "owner": owner,
                "model": model,
                "priority": "critical",
                "outputs": [output],
                "sourceBranch": source_branch,
                "targetBranch": target_branch,
            }),
        )
        .expect("task create succeeds");
        assert_eq!(created["result"]["created"], true);
        assert_eq!(
            tasks.get(task_id).map(|task| task.owner),
            Some(Some(owner.to_string()))
        );
        assert_eq!(
            tasks.get(task_id).map(|task| task.status),
            Some(TaskStatus::Ready)
        );

        assert!(matches!(
            call(
                &state,
                "aelyris.task.create",
                serde_json::json!({ "id": task_id, "title": "duplicate" }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let Json(running) = call(
            &state,
            "aelyris.task.transition",
            serde_json::json!({ "id": task_id, "to": "running" }),
        )
        .expect("task transitions to running");
        assert_eq!(running["result"]["to"], "running");

        let Json(review) = call(
            &state,
            "aelyris.task.transition",
            serde_json::json!({ "id": task_id, "to": "review" }),
        )
        .expect("task transitions to review");
        assert_eq!(review["result"]["to"], "review");

        assert!(matches!(
            call(
                &state,
                "aelyris.task.transition",
                serde_json::json!({ "id": task_id, "to": "ready" }),
            ),
            Err(ApiError::BadRequest(_))
        ));

        let published_kinds = bus
            .recent()
            .into_iter()
            .map(|event| event.kind)
            .collect::<Vec<_>>();
        assert_eq!(
            published_kinds,
            [AgentEventKind::TaskCreated, AgentEventKind::ReviewRequired]
        );

        let publication_failure_tasks = Arc::new(TaskManager::new());
        let publication_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_task_manager(publication_failure_tasks.clone())
                .with_event_bus(Arc::new(EventBus::new_durable()));
        let failed_task_id = "AIO13_EVENT_FAILURE_TASK_ID_MUST_NOT_BE_LOGGED";
        assert!(matches!(
            call(
                &publication_failure_state,
                "aelyris.task.create",
                serde_json::json!({
                    "id": failed_task_id,
                    "title": "AIO13_EVENT_FAILURE_TITLE_MUST_NOT_BE_LOGGED",
                    "owner": "AIO13_EVENT_FAILURE_OWNER_MUST_NOT_BE_LOGGED",
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            publication_failure_tasks
                .get(failed_task_id)
                .map(|task| task.status),
            Some(TaskStatus::Ready),
            "event failure must not replay or roll back the already-authoritative Task Manager mutation"
        );

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_task_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read task mutation audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("task-agent")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["mutationApplied"] == true)
                .count(),
            4
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "task_event_publication_failed"
                && row.redacted_payload_json["mutationApplied"] == true
                && row.redacted_payload_json["eventPublished"] == false
                && row.redacted_payload_json["resultingStatus"] == "ready"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "transition"
                && row.redacted_payload_json["status"] == "accepted"
                && row.redacted_payload_json["resultingStatus"] == "review"
                && row.redacted_payload_json["eventPublished"] == true
        }));
        let task_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["taskDigest"]
                    .as_str()
                    .expect("task digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(task_digests.len(), 2);
        assert!(task_digests.iter().all(|digest| {
            digest.len() == 64
                && digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["taskPacketLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                task_id,
                title,
                description,
                owner,
                model,
                output,
                source_branch,
                target_branch,
                failed_task_id,
                "AIO13_EVENT_FAILURE_TITLE_MUST_NOT_BE_LOGGED",
                "AIO13_EVENT_FAILURE_OWNER_MUST_NOT_BE_LOGGED",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_file_ownership_assignment_audit_is_principal_bound_and_pattern_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::file_ownership::FileOwnership;
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let ownership = Arc::new(std::sync::Mutex::new(FileOwnership::new()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_file_ownership(ownership.clone());
        let schema = input_schema_for_tool_ref("aelyris.ownership.assign").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "ownership-operator",
                ToolCallBody {
                    name: "aelyris.ownership.assign".to_string(),
                    arguments,
                },
            ))
        };
        let first_agent = "AIO14_ASSIGNED_AGENT_A_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let first_pattern = "src/AIO14_PATTERN_A_MUST_NOT_BE_LOGGED/**";
        let second_agent = "AIO14_ASSIGNED_AGENT_B_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let second_pattern = "src/AIO14_PATTERN_A_MUST_NOT_BE_LOGGED/file.rs";

        let Json(first) = call(serde_json::json!({
            "agentId": first_agent,
            "pattern": first_pattern,
        }))
        .expect("first ownership assignment succeeds");
        assert_eq!(first["result"]["conflicts"], serde_json::json!([]));

        let Json(second) = call(serde_json::json!({
            "agentId": second_agent,
            "pattern": second_pattern,
        }))
        .expect("overlapping ownership assignment succeeds with conflict projection");
        assert_eq!(
            second["result"]["conflicts"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(ownership.lock().unwrap().claims().len(), 2);

        let rejected_agent = "AIO14_REJECTED_ASSIGNEE_MUST_NOT_BE_LOGGED";
        let rejected_pattern = "src/AIO14_REJECTED_PATTERN_MUST_NOT_BE_LOGGED/**";
        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio14_file_ownership\n\
                     BEFORE INSERT ON file_ownership_claims\n\
                     WHEN NEW.agent_id = '{rejected_agent}'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated ownership persistence failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(serde_json::json!({
                "agentId": rejected_agent,
                "pattern": rejected_pattern,
            })),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            ownership.lock().unwrap().claims().len(),
            2,
            "failed persistence must not mutate the in-memory ownership owner"
        );
        let persisted_count = db
            .with(|database| {
                database
                    .conn()
                    .query_row("SELECT COUNT(*) FROM file_ownership_claims", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(persisted_count, 2);

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_file_ownership_assignment_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read file ownership assignment audit");
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("ownership-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            1
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["status"] == "accepted"
                && row.redacted_payload_json["conflictCount"] == 0
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["status"] == "accepted"
                && row.redacted_payload_json["conflictCount"] == 1
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "ownership_persistence_failed"
                && row.redacted_payload_json["persistenceApplied"] == false
                && row.redacted_payload_json["memoryApplied"] == false
        }));
        let digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["assignmentDigest"]
                    .as_str()
                    .expect("assignment digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(digests.len(), 3);
        assert!(digests.iter().all(|digest| {
            digest.len() == 64
                && digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["assignmentValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                first_agent,
                first_pattern,
                second_agent,
                second_pattern,
                rejected_agent,
                rejected_pattern,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_manual_symbol_lifecycle_audit_is_principal_bound_and_target_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let ownership = Arc::new(std::sync::Mutex::new(SymbolOwnership::new()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_symbol_ownership(ownership.clone());
        for verb in [
            "aelyris.symbol.claim",
            "aelyris.symbol.refresh",
            "aelyris.symbol.release",
            "aelyris.symbol.release_task",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "symbol-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let first_claim = "AIO15_CLAIM_A_MUST_NOT_BE_LOGGED";
        let first_agent = "AIO15_ASSIGNED_AGENT_A_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let first_task = "AIO15_TASK_A_MUST_NOT_BE_LOGGED";
        let normalized_path = "src/AIO15_PATH_MUST_NOT_BE_LOGGED.rs";
        let raw_path = "src\\AIO15_PATH_MUST_NOT_BE_LOGGED.rs";
        let first_symbol = "AIO15_SYMBOL_A_MUST_NOT_BE_LOGGED";
        let blocked_claim = "AIO15_BLOCKED_CLAIM_MUST_NOT_BE_LOGGED";
        let blocked_agent = "AIO15_BLOCKED_AGENT_MUST_NOT_BE_LOGGED";
        let blocked_symbol = "AIO15_BLOCKED_SYMBOL_MUST_NOT_BE_LOGGED";

        let Json(granted) = call(
            "aelyris.symbol.claim",
            serde_json::json!({
                "claimId": first_claim,
                "agentId": first_agent,
                "taskId": first_task,
                "path": raw_path,
                "symbol": first_symbol,
                "startLine": 10,
                "endLine": 20,
                "mode": "write",
                "confidence": "parser",
                "leaseSecs": 600,
            }),
        )
        .expect("manual symbol claim succeeds");
        assert_eq!(granted["result"]["outcome"], "granted");
        assert_eq!(
            ownership
                .lock()
                .unwrap()
                .get(first_claim)
                .map(|claim| claim.path.as_str()),
            Some(normalized_path),
            "manual claim keeps existing path normalization"
        );

        let Json(blocked) = call(
            "aelyris.symbol.claim",
            serde_json::json!({
                "claimId": blocked_claim,
                "agentId": blocked_agent,
                "path": normalized_path,
                "symbol": blocked_symbol,
                "startLine": 15,
                "endLine": 18,
                "mode": "write",
                "confidence": "parser",
            }),
        )
        .expect("blocked claim remains a typed outcome");
        assert_eq!(blocked["result"]["outcome"], "blocked");
        assert!(ownership.lock().unwrap().get(blocked_claim).is_none());

        let Json(refreshed) = call(
            "aelyris.symbol.refresh",
            serde_json::json!({ "claimId": first_claim, "leaseSecs": 900 }),
        )
        .expect("refresh succeeds");
        assert_eq!(refreshed["result"]["refreshed"], true);

        let Json(released) = call(
            "aelyris.symbol.release",
            serde_json::json!({ "claimId": first_claim }),
        )
        .expect("release succeeds");
        assert_eq!(released["result"]["released"], true);

        let task_claim = "AIO15_TASK_CLAIM_MUST_NOT_BE_LOGGED";
        let task_agent = "AIO15_TASK_AGENT_MUST_NOT_BE_LOGGED";
        let release_task = "AIO15_RELEASE_TASK_MUST_NOT_BE_LOGGED";
        let task_path = "src/AIO15_TASK_PATH_MUST_NOT_BE_LOGGED.rs";
        let task_symbol = "AIO15_TASK_SYMBOL_MUST_NOT_BE_LOGGED";
        let Json(task_granted) = call(
            "aelyris.symbol.claim",
            serde_json::json!({
                "claimId": task_claim,
                "agentId": task_agent,
                "taskId": release_task,
                "path": task_path,
                "symbol": task_symbol,
                "startLine": 1,
                "endLine": 5,
                "mode": "review",
                "confidence": "lsp",
            }),
        )
        .expect("task-bound claim succeeds");
        assert_eq!(task_granted["result"]["outcome"], "granted");

        let Json(released_task) = call(
            "aelyris.symbol.release_task",
            serde_json::json!({ "taskId": release_task }),
        )
        .expect("task release succeeds");
        assert_eq!(released_task["result"]["released"], 1);

        let rejected_claim = "AIO15_PERSISTENCE_REJECTED_CLAIM_MUST_NOT_BE_LOGGED";
        let rejected_agent = "AIO15_PERSISTENCE_REJECTED_AGENT_MUST_NOT_BE_LOGGED";
        let rejected_path = "src/AIO15_REJECTED_PATH_MUST_NOT_BE_LOGGED.rs";
        let rejected_symbol = "AIO15_REJECTED_SYMBOL_MUST_NOT_BE_LOGGED";
        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio15_symbol_claim\n\
                     BEFORE INSERT ON symbol_ownership_claims\n\
                     WHEN NEW.claim_id = '{rejected_claim}'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated symbol persistence failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(
                "aelyris.symbol.claim",
                serde_json::json!({
                    "claimId": rejected_claim,
                    "agentId": rejected_agent,
                    "path": rejected_path,
                    "symbol": rejected_symbol,
                    "startLine": 30,
                    "endLine": 40,
                    "mode": "write",
                    "confidence": "parser",
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert!(ownership.lock().unwrap().get(rejected_claim).is_none());

        let persisted_claim_count = db
            .with(|database| {
                database
                    .conn()
                    .query_row("SELECT COUNT(*) FROM symbol_ownership_claims", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(persisted_claim_count, 0);

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_symbol_ownership_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read symbol ownership audit");
        assert_eq!(rows.len(), 7);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("symbol-operator")));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "claim"
                && row.redacted_payload_json["outcomeClass"] == "granted"
                && row.redacted_payload_json["persistenceApplied"] == true
                && row.redacted_payload_json["memoryApplied"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "claim"
                && row.redacted_payload_json["outcomeClass"] == "blocked"
                && row.redacted_payload_json["outcomeCount"] == 1
                && row.redacted_payload_json["persistenceApplied"] == false
                && row.redacted_payload_json["memoryApplied"] == false
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "refresh"
                && row.redacted_payload_json["outcomeClass"] == "refreshed"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "release_task"
                && row.redacted_payload_json["outcomeCount"] == 1
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "symbol_persistence_failed"
                && row.redacted_payload_json["status"] == "rejected"
                && row.redacted_payload_json["persistenceApplied"] == false
                && row.redacted_payload_json["memoryApplied"] == false
        }));
        let digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["targetDigest"]
                    .as_str()
                    .expect("symbol target digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(digests.len(), 5);
        assert!(digests.iter().all(|digest| {
            digest.len() == 64
                && digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["targetValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                first_claim,
                first_agent,
                first_task,
                normalized_path,
                raw_path,
                first_symbol,
                blocked_claim,
                blocked_agent,
                blocked_symbol,
                task_claim,
                task_agent,
                release_task,
                task_path,
                task_symbol,
                rejected_claim,
                rejected_agent,
                rejected_path,
                rejected_symbol,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_derived_symbol_reconciliation_audit_is_principal_bound_and_source_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let ownership = Arc::new(std::sync::Mutex::new(SymbolOwnership::new()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_symbol_ownership(ownership.clone());
        for verb in [
            "aelyris.symbol.claim_from_diff",
            "aelyris.symbol.claim_from_source",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                "derived-symbol-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };

        let diff_agent = "AIO16_DIFF_AGENT_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let diff_task = "AIO16_DIFF_TASK_MUST_NOT_BE_LOGGED";
        let diff_path = "src/AIO16_DIFF_PATH_MUST_NOT_BE_LOGGED.rs";
        let diff_payload = format!(
            "--- a/{diff_path}\n+++ b/{diff_path}\n@@ -1,1 +1,3 @@\n old\n+AIO16_DIFF_BODY_MUST_NOT_BE_LOGGED\n+tail\n"
        );
        let Json(diff_result) = call(
            "aelyris.symbol.claim_from_diff",
            serde_json::json!({
                "agentId": diff_agent,
                "taskId": diff_task,
                "diff": diff_payload,
                "mode": "write",
                "leaseSecs": 600,
            }),
        )
        .expect("diff-derived claim succeeds");
        assert_eq!(diff_result["result"]["recorded"], 1);

        let source_agent = "AIO16_SOURCE_AGENT_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let source_task = "AIO16_SOURCE_TASK_MUST_NOT_BE_LOGGED";
        let source_path = "src/AIO16_SOURCE_PATH_MUST_NOT_BE_LOGGED.rs";
        let source_raw_path = "src\\AIO16_SOURCE_PATH_MUST_NOT_BE_LOGGED.rs";
        let source_payload = "\nfn AIO16_ALPHA_MUST_NOT_BE_LOGGED() {\n    let _ = 1;\n}\n\nfn AIO16_BETA_MUST_NOT_BE_LOGGED() {\n    let _ = 2;\n}\n";
        let Json(source_result) = call(
            "aelyris.symbol.claim_from_source",
            serde_json::json!({
                "agentId": source_agent,
                "taskId": source_task,
                "path": source_raw_path,
                "source": source_payload,
                "mode": "write",
                "leaseSecs": 600,
            }),
        )
        .expect("source-derived claims succeed");
        assert_eq!(source_result["result"]["recorded"], 2);
        assert_eq!(source_result["result"]["fallback"], false);

        let Json(fallback_result) = call(
            "aelyris.symbol.claim_from_source",
            serde_json::json!({
                "agentId": source_agent,
                "taskId": source_task,
                "path": source_path,
                "source": "",
            }),
        )
        .expect("empty source reconciles to fallback");
        assert_eq!(fallback_result["result"]["recorded"], 0);
        assert_eq!(fallback_result["result"]["fallback"], true);
        {
            let guard = ownership.lock().unwrap();
            let live = guard.live_claims(0);
            assert_eq!(live.len(), 1, "parser claims were reconciled away");
            assert!(live[0].claim_id.starts_with("dh:"));
        }

        let failed_agent = "AIO16_FAILED_AGENT_MUST_NOT_BE_LOGGED";
        let failed_task = "AIO16_FAILED_TASK_MUST_NOT_BE_LOGGED";
        let failed_path = "src/AIO16_FAILED_PATH_MUST_NOT_BE_LOGGED.rs";
        let failed_source = "fn AIO16_FAILED_SYMBOL_MUST_NOT_BE_LOGGED() {}\n";
        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio16_derived_claim\n\
                     BEFORE INSERT ON symbol_ownership_claims\n\
                     WHEN NEW.claim_id LIKE 'parse:{failed_agent}:%'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated derived reconciliation failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(
                "aelyris.symbol.claim_from_source",
                serde_json::json!({
                    "agentId": failed_agent,
                    "taskId": failed_task,
                    "path": failed_path,
                    "source": failed_source,
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert!(ownership
            .lock()
            .unwrap()
            .snapshot()
            .iter()
            .all(|claim| claim.agent_id != failed_agent));
        let persisted_count = db
            .with(|database| {
                database
                    .conn()
                    .query_row("SELECT COUNT(*) FROM symbol_ownership_claims", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(persisted_count, 1, "only the diff claim remains durable");

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_derived_symbol_reconciliation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read derived symbol audit");
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("derived-symbol-operator")));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "claim_from_diff"
                && row.redacted_payload_json["derivedCount"] == 1
                && row.redacted_payload_json["recordedCount"] == 1
                && row.redacted_payload_json["grantedCount"] == 1
                && row.redacted_payload_json["status"] == "accepted"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "claim_from_source"
                && row.redacted_payload_json["derivedCount"] == 2
                && row.redacted_payload_json["recordedCount"] == 2
                && row.redacted_payload_json["fallback"] == false
                && row.redacted_payload_json["status"] == "accepted"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "claim_from_source"
                && row.redacted_payload_json["derivedCount"] == 0
                && row.redacted_payload_json["recordedCount"] == 0
                && row.redacted_payload_json["fallback"] == true
                && row.redacted_payload_json["persistenceApplied"] == true
                && row.redacted_payload_json["memoryApplied"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "symbol_reconciliation_failed"
                && row.redacted_payload_json["status"] == "rejected"
                && row.redacted_payload_json["persistenceApplied"] == false
                && row.redacted_payload_json["memoryApplied"] == false
        }));
        let origin_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["originDigest"]
                    .as_str()
                    .expect("origin digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(origin_digests.len(), 3);
        assert_eq!(input_digests.len(), 4);
        assert!(origin_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["inputValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["targetValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                diff_agent,
                diff_task,
                diff_path,
                "AIO16_DIFF_BODY_MUST_NOT_BE_LOGGED",
                source_agent,
                source_task,
                source_path,
                source_raw_path,
                "AIO16_ALPHA_MUST_NOT_BE_LOGGED",
                "AIO16_BETA_MUST_NOT_BE_LOGGED",
                failed_agent,
                failed_task,
                failed_path,
                "AIO16_FAILED_SYMBOL_MUST_NOT_BE_LOGGED",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_context_mutation_audit_is_principal_bound_and_value_free() {
        use crate::context_store::ContextStoreManager;
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::{AgentEventKind, EventBus};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let context = Arc::new(ContextStoreManager::new_durable());
        context.attach_db(db.clone()).unwrap();
        let bus = Arc::new(EventBus::new_durable());
        bus.attach_db(db.clone());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_context_store(context.clone())
            .with_event_bus(bus.clone());
        for verb in ["aelyris.context.set", "aelyris.context.remove"] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "context-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let key = "AIO17_CONTEXT_KEY_MUST_NOT_BE_LOGGED";
        let first_value = "AIO17_CONTEXT_VALUE_A_MUST_NOT_BE_LOGGED";
        let second_value = "AIO17_CONTEXT_VALUE_B_MUST_NOT_BE_LOGGED";

        let Json(created) = call(
            &state,
            "aelyris.context.set",
            serde_json::json!({ "key": key, "value": first_value }),
        )
        .expect("create context decision");
        assert_eq!(
            created["result"]["change"]["previous"],
            serde_json::Value::Null
        );
        assert_eq!(created["result"]["change"]["value"], first_value);

        let Json(no_change) = call(
            &state,
            "aelyris.context.set",
            serde_json::json!({ "key": key, "value": first_value }),
        )
        .expect("identical context set is a no-op");
        assert_eq!(no_change["result"]["change"], serde_json::Value::Null);

        let Json(updated) = call(
            &state,
            "aelyris.context.set",
            serde_json::json!({ "key": key, "value": second_value }),
        )
        .expect("update context decision");
        assert_eq!(updated["result"]["change"]["previous"], first_value);
        assert_eq!(updated["result"]["change"]["value"], second_value);

        let Json(removed) = call(
            &state,
            "aelyris.context.remove",
            serde_json::json!({ "key": key }),
        )
        .expect("remove context decision");
        assert_eq!(removed["result"]["change"]["previous"], second_value);
        assert_eq!(
            removed["result"]["change"]["value"],
            serde_json::Value::Null
        );

        let Json(remove_no_change) = call(
            &state,
            "aelyris.context.remove",
            serde_json::json!({ "key": key }),
        )
        .expect("missing context remove is a no-op");
        assert_eq!(
            remove_no_change["result"]["change"],
            serde_json::Value::Null
        );
        assert_eq!(context.get(key), None);
        assert_eq!(
            bus.recent()
                .into_iter()
                .filter(|event| event.kind == AgentEventKind::DecisionChanged)
                .count(),
            3,
            "only real changes publish DecisionChanged"
        );

        let event_failure_context = Arc::new(ContextStoreManager::new_durable());
        event_failure_context.attach_db(db.clone()).unwrap();
        let event_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_context_store(event_failure_context.clone())
                .with_event_bus(Arc::new(EventBus::new_durable()));
        let event_failure_key = "AIO17_EVENT_FAILURE_KEY_MUST_NOT_BE_LOGGED";
        let event_failure_value = "AIO17_EVENT_FAILURE_VALUE_MUST_NOT_BE_LOGGED";
        assert!(matches!(
            call(
                &event_failure_state,
                "aelyris.context.set",
                serde_json::json!({
                    "key": event_failure_key,
                    "value": event_failure_value,
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            event_failure_context.get(event_failure_key).as_deref(),
            Some(event_failure_value),
            "Event Bus failure does not replay or roll back the durable context mutation"
        );

        let persistence_failure_key = "AIO17_PERSISTENCE_FAILURE_KEY_MUST_NOT_BE_LOGGED";
        let persistence_failure_value = "AIO17_PERSISTENCE_FAILURE_VALUE_MUST_NOT_BE_LOGGED";
        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio17_context_decision\n\
                     BEFORE INSERT ON context_decisions\n\
                     WHEN NEW.key = '{persistence_failure_key}'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated context persistence failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(
                &state,
                "aelyris.context.set",
                serde_json::json!({
                    "key": persistence_failure_key,
                    "value": persistence_failure_value,
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(context.get(persistence_failure_key), None);

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_context_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read context mutation audit");
        assert_eq!(rows.len(), 7);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("context-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            5
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            2
        );
        for kind in ["created", "updated", "removed", "no_change"] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["changeKind"] == kind));
        }
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "context_event_publication_failed"
                && row.redacted_payload_json["mutationApplied"] == true
                && row.redacted_payload_json["eventPublished"] == false
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "context_persistence_failed"
                && row.redacted_payload_json["mutationApplied"] == false
                && row.redacted_payload_json["eventPublished"].is_null()
        }));
        let decision_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["decisionDigest"]
                    .as_str()
                    .expect("decision digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("context input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(decision_digests.len(), 3);
        assert_eq!(input_digests.len(), 5);
        assert!(decision_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["decisionValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                key,
                first_value,
                second_value,
                event_failure_key,
                event_failure_value,
                persistence_failure_key,
                persistence_failure_value,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_intent_mutation_audit_is_principal_bound_and_payload_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::{AgentEventKind, EventBus};
        use crate::intent::{IntentBus, IntentStatus};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let intents = Arc::new(IntentBus::new());
        intents.attach_db(db.clone()).unwrap();
        let events = Arc::new(EventBus::new_durable());
        events.attach_db(db.clone());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_intent_bus(intents.clone())
            .with_event_bus(events.clone());
        for verb in ["aelyris.intent.propose", "aelyris.intent.resolve"] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "intent-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let proposer = "AIO18_PROPOSER_MUST_NOT_BE_ACTOR_OR_LOGGED";
        let proposal = "AIO18_PROPOSAL_PAYLOAD_MUST_NOT_BE_LOGGED";
        let target_a = "src/AIO18_TARGET_A_MUST_NOT_BE_LOGGED/**";
        let target_b = "domain:AIO18_TARGET_B_MUST_NOT_BE_LOGGED";
        let Json(proposed) = call(
            &state,
            "aelyris.intent.propose",
            serde_json::json!({
                "agentId": proposer,
                "proposal": proposal,
                "targets": [target_a, target_b],
            }),
        )
        .expect("intent proposal succeeds");
        let intent_id = proposed["result"]["intent"]["id"]
            .as_str()
            .expect("generated intent id")
            .to_string();
        assert_eq!(proposed["result"]["intent"]["agent_id"], proposer);
        assert_eq!(proposed["result"]["intent"]["status"], "open");
        assert_eq!(intents.open().len(), 1);

        let Json(resolved) = call(
            &state,
            "aelyris.intent.resolve",
            serde_json::json!({ "id": intent_id, "status": "accepted" }),
        )
        .expect("intent resolution succeeds");
        assert_eq!(resolved["result"]["intent"]["status"], "accepted");
        assert_eq!(intents.all()[0].status, IntentStatus::Accepted);

        let Json(no_change) = call(
            &state,
            "aelyris.intent.resolve",
            serde_json::json!({ "id": intent_id, "status": "accepted" }),
        )
        .expect("same-status resolution remains a no-op");
        assert_eq!(no_change["result"]["intent"]["status"], "accepted");

        let unknown_id = "AIO18_UNKNOWN_INTENT_ID_MUST_NOT_BE_LOGGED";
        let Json(missing) = call(
            &state,
            "aelyris.intent.resolve",
            serde_json::json!({ "id": unknown_id, "status": "rejected" }),
        )
        .expect("unknown resolution preserves null compatibility result");
        assert_eq!(missing["result"]["intent"], serde_json::Value::Null);

        let persistence_agent = "AIO18_PERSISTENCE_AGENT_MUST_NOT_BE_LOGGED";
        let persistence_proposal = "AIO18_PERSISTENCE_PROPOSAL_MUST_NOT_BE_LOGGED";
        let persistence_target = "src/AIO18_PERSISTENCE_TARGET_MUST_NOT_BE_LOGGED/**";
        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio18_intent_proposal\n\
                     BEFORE INSERT ON intents\n\
                     WHEN NEW.agent_id = '{persistence_agent}'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated intent persistence failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(
                &state,
                "aelyris.intent.propose",
                serde_json::json!({
                    "agentId": persistence_agent,
                    "proposal": persistence_proposal,
                    "targets": [persistence_target],
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            intents.all().len(),
            1,
            "failed durable proposal must not enter the in-memory IntentBus"
        );

        let event_failure_intents = Arc::new(IntentBus::new());
        event_failure_intents.attach_db(db.clone()).unwrap();
        let event_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_intent_bus(event_failure_intents.clone())
                .with_event_bus(Arc::new(EventBus::new_durable()));
        let event_agent = "AIO18_EVENT_AGENT_MUST_NOT_BE_LOGGED";
        let event_proposal = "AIO18_EVENT_PROPOSAL_MUST_NOT_BE_LOGGED";
        let event_target = "src/AIO18_EVENT_TARGET_MUST_NOT_BE_LOGGED/**";
        assert!(matches!(
            call(
                &event_failure_state,
                "aelyris.intent.propose",
                serde_json::json!({
                    "agentId": event_agent,
                    "proposal": event_proposal,
                    "targets": [event_target],
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            event_failure_intents.all().len(),
            2,
            "Event Bus failure does not replay or roll back the durable intent mutation"
        );
        assert_eq!(
            events
                .recent()
                .into_iter()
                .filter(|event| event.kind == AgentEventKind::IntentDeclared)
                .count(),
            1,
            "only the coordinated proposal reached the durable Event Bus"
        );

        let persisted = db
            .with(|database| crate::persistence::IntentRepo::load_all(database))
            .unwrap();
        assert_eq!(persisted.len(), 2);
        assert_eq!(persisted[0].status, IntentStatus::Accepted);
        assert_eq!(persisted[1].agent_id, event_agent);

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_intent_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read intent mutation audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("intent-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            4
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            2
        );
        for outcome in ["created", "resolved", "no_change", "missing"] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["outcome"] == outcome));
        }
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "intent_persistence_failed"
                && row.redacted_payload_json["mutationApplied"] == false
                && row.redacted_payload_json["eventPublished"].is_null()
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "intent_event_publication_failed"
                && row.redacted_payload_json["mutationApplied"] == true
                && row.redacted_payload_json["eventPublished"] == false
                && row.redacted_payload_json["resultingStatus"] == "open"
        }));
        let intent_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["intentDigest"]
                    .as_str()
                    .expect("intent digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("intent input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(intent_digests.len(), 4);
        assert_eq!(
            input_digests.len(),
            5,
            "repeating the same resolution is the same exact input identity"
        );
        assert!(intent_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["intentValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                intent_id.as_str(),
                unknown_id,
                proposer,
                proposal,
                target_a,
                target_b,
                persistence_agent,
                persistence_proposal,
                persistence_target,
                event_agent,
                event_proposal,
                event_target,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_knowledge_graph_mutation_audit_is_principal_bound_and_target_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::knowledge_graph::{KnowledgeGraphManager, NodeKind};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let graph = Arc::new(KnowledgeGraphManager::new());
        graph.attach_db(db.as_ref().clone());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_knowledge_graph(graph.clone());
        for verb in [
            "aelyris.knowledge.add_node",
            "aelyris.knowledge.add_edge",
            "aelyris.knowledge.remove_node",
            "aelyris.knowledge.remove_edge",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "knowledge-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let node_a = "AIO19_NODE_A_MUST_NOT_BE_LOGGED";
        let node_b = "AIO19_NODE_B_MUST_NOT_BE_LOGGED";
        let node_c = "AIO19_NODE_C_MUST_NOT_BE_LOGGED";
        let file_a = "src/AIO19_FILE_A_MUST_NOT_BE_LOGGED.rs";
        let file_b = "src/AIO19_FILE_B_MUST_NOT_BE_LOGGED.rs";

        let Json(added) = call(
            &state,
            "aelyris.knowledge.add_node",
            serde_json::json!({ "id": node_a, "kind": "service", "file": file_a }),
        )
        .expect("add graph node");
        assert_eq!(added["result"]["added"], true);

        let _ = call(
            &state,
            "aelyris.knowledge.add_node",
            serde_json::json!({ "id": node_a, "kind": "service", "file": file_a }),
        )
        .expect("identical node is idempotent");

        let _ = call(
            &state,
            "aelyris.knowledge.add_node",
            serde_json::json!({ "id": node_a, "kind": "module", "file": file_b }),
        )
        .expect("node metadata update succeeds");
        let updated_node = graph
            .nodes()
            .into_iter()
            .find(|node| node.id == node_a)
            .expect("updated node exists");
        assert_eq!(updated_node.kind, NodeKind::Module);
        assert_eq!(updated_node.file.as_deref(), Some(file_b));

        let _ = call(
            &state,
            "aelyris.knowledge.add_edge",
            serde_json::json!({ "dependent": node_b, "dependency": node_a }),
        )
        .expect("edge auto-creates unknown endpoint");
        let _ = call(
            &state,
            "aelyris.knowledge.add_edge",
            serde_json::json!({ "dependent": node_b, "dependency": node_a }),
        )
        .expect("duplicate edge is idempotent");
        let _ = call(
            &state,
            "aelyris.knowledge.add_edge",
            serde_json::json!({ "dependent": node_c, "dependency": node_c }),
        )
        .expect("self edge remains a no-op");
        assert!(graph.nodes().iter().all(|node| node.id != node_c));

        let Json(removed_edge) = call(
            &state,
            "aelyris.knowledge.remove_edge",
            serde_json::json!({ "dependent": node_b, "dependency": node_a }),
        )
        .expect("remove existing edge");
        assert_eq!(removed_edge["result"]["removed"], true);
        let Json(missing_edge) = call(
            &state,
            "aelyris.knowledge.remove_edge",
            serde_json::json!({ "dependent": node_b, "dependency": node_a }),
        )
        .expect("repeat edge removal is a no-op");
        assert_eq!(missing_edge["result"]["removed"], false);

        let _ = call(
            &state,
            "aelyris.knowledge.add_edge",
            serde_json::json!({ "dependent": node_b, "dependency": node_a }),
        )
        .expect("restore edge before cascade test");
        let Json(removed_node) = call(
            &state,
            "aelyris.knowledge.remove_node",
            serde_json::json!({ "id": node_a }),
        )
        .expect("remove node and touching edges");
        assert_eq!(removed_node["result"]["removed"], true);
        assert!(graph.dependencies_of(node_b).is_empty());
        let Json(missing_node) = call(
            &state,
            "aelyris.knowledge.remove_node",
            serde_json::json!({ "id": node_a }),
        )
        .expect("repeat node removal is a no-op");
        assert_eq!(missing_node["result"]["removed"], false);

        let unavailable_node = "AIO19_UNAVAILABLE_NODE_MUST_NOT_BE_LOGGED";
        let unavailable_file = "src/AIO19_UNAVAILABLE_FILE_MUST_NOT_BE_LOGGED.rs";
        let unavailable_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()));
        assert!(matches!(
            call(
                &unavailable_state,
                "aelyris.knowledge.add_node",
                serde_json::json!({
                    "id": unavailable_node,
                    "kind": "function",
                    "file": unavailable_file,
                }),
            ),
            Err(ApiError::Internal(_))
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_knowledge_graph_mutation_authority".to_string()),
                    limit: Some(30),
                    ..Default::default()
                })
            })
            .expect("read knowledge graph audit");
        assert_eq!(rows.len(), 12);
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("knowledge-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            11
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["changed"] == true)
                .count(),
            6
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["changed"] == false)
                .count(),
            5
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["status"] == "rejected"
                && row.redacted_payload_json["rejectionCode"] == "knowledge_graph_unavailable"
                && row.redacted_payload_json["changed"].is_null()
        }));
        let target_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["targetDigest"]
                    .as_str()
                    .expect("graph target digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("graph input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(target_digests.len(), 6);
        assert_eq!(input_digests.len(), 7);
        assert!(target_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["graphValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                node_a,
                node_b,
                node_c,
                file_a,
                file_b,
                unavailable_node,
                unavailable_file,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }
    }

    #[test]
    fn mcp_agent_coordination_audit_is_principal_bound_and_payload_free() {
        use crate::agent::AgentManager;
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::{AgentEventKind, EventBus};
        use crate::pty::PtyManager;
        use crate::symbol_ownership::{
            ClaimMode, ClaimOutcome, Confidence, SymbolClaim, SymbolOwnership, SymbolRange,
        };
        use std::process::Stdio;
        use std::sync::Mutex;

        fn spawn_sleeper() -> std::process::Child {
            #[cfg(windows)]
            {
                return crate::process::hidden_command("cmd")
                    .args(["/c", "ping", "127.0.0.1", "-n", "30"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("spawn Windows sleeper");
            }
            #[cfg(not(windows))]
            {
                std::process::Command::new("sh")
                    .args(["-c", "sleep 30"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .expect("spawn Unix sleeper")
            }
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let manager = AgentManager::new();
        let session_id = "AIO20_SESSION_MUST_NOT_BE_LOGGED";
        let session_task = "AIO20_SESSION_TASK_MUST_NOT_BE_LOGGED";
        let failed_session_id = "AIO20_EVENT_FAILURE_SESSION_MUST_NOT_BE_LOGGED";
        manager
            .insert_test_session(session_id, Some(session_task), spawn_sleeper())
            .unwrap();
        manager
            .insert_test_session(failed_session_id, None, spawn_sleeper())
            .unwrap();

        let events = Arc::new(EventBus::new_durable());
        events.attach_db(db.clone());
        let ownership = Arc::new(Mutex::new(SymbolOwnership::new()));
        let avoid_agent = "AIO20_AVOID_AGENT_MUST_NOT_BE_LOGGED";
        let avoid_task = "AIO20_AVOID_TASK_MUST_NOT_BE_LOGGED";
        let avoid_path = "src/AIO20_AVOID_PATH_MUST_NOT_BE_LOGGED.rs";
        let avoid_symbol = "AIO20_AVOID_SYMBOL_MUST_NOT_BE_LOGGED";
        assert!(matches!(
            ownership.lock().unwrap().claim(
                SymbolClaim {
                    claim_id: "AIO20_AVOID_CLAIM_MUST_NOT_BE_LOGGED".to_string(),
                    agent_id: avoid_agent.to_string(),
                    task_id: Some(avoid_task.to_string()),
                    path: avoid_path.to_string(),
                    symbol: avoid_symbol.to_string(),
                    range: SymbolRange::new(10, 20),
                    mode: ClaimMode::Write,
                    lease_expires_at: u64::MAX,
                    confidence: Confidence::Parser,
                },
                0,
            ),
            ClaimOutcome::Granted
        ));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_agent_manager(manager.clone())
            .with_symbol_ownership(ownership.clone())
            .with_event_bus(events.clone());
        for verb in [
            "aelyris.agent.report_activity",
            "aelyris.agent.report_blocker",
            "aelyris.agent.steer_avoid",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "coordination-operator",
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };
        let action = "AIO20_ACTION_MUST_NOT_BE_LOGGED";
        let file = "src/AIO20_FILE_MUST_NOT_BE_LOGGED.rs";
        let symbol = "AIO20_SYMBOL_MUST_NOT_BE_LOGGED";
        let Json(activity) = call(
            &state,
            "aelyris.agent.report_activity",
            serde_json::json!({
                "sessionId": session_id,
                "action": action,
                "file": file,
                "symbol": symbol,
            }),
        )
        .expect("report live activity");
        assert_eq!(activity["result"]["reported"], true);
        assert_eq!(
            manager
                .list_sessions()
                .into_iter()
                .find(|session| session.id == session_id)
                .and_then(|session| session.current_activity)
                .map(|activity| activity.action),
            Some(action.to_string())
        );

        let blocker = "AIO20_BLOCKER_MUST_NOT_BE_LOGGED";
        let needs = "AIO20_NEEDS_MUST_NOT_BE_LOGGED";
        let Json(blocked) = call(
            &state,
            "aelyris.agent.report_blocker",
            serde_json::json!({
                "sessionId": session_id,
                "summary": blocker,
                "needs": needs,
            }),
        )
        .expect("report live blocker");
        assert_eq!(blocked["result"]["raised"], true);
        assert_eq!(
            manager
                .list_sessions()
                .into_iter()
                .find(|session| session.id == session_id)
                .and_then(|session| session.current_activity)
                .map(|activity| activity.action),
            Some("blocked".to_string())
        );

        let Json(steered) = call(
            &state,
            "aelyris.agent.steer_avoid",
            serde_json::json!({
                "sessionId": session_id,
                "files": [avoid_path],
            }),
        )
        .expect("publish typed ownership-derived steer");
        assert_eq!(steered["result"]["steered"], true);
        assert_eq!(steered["result"]["avoidCount"], 1);
        assert_eq!(steered["result"]["avoid"][0]["agent"], avoid_agent);
        assert_eq!(steered["result"]["avoid"][0]["symbol"], avoid_symbol);

        let missing_session = "AIO20_MISSING_SESSION_MUST_NOT_BE_LOGGED";
        assert!(matches!(
            call(
                &state,
                "aelyris.agent.report_activity",
                serde_json::json!({
                    "sessionId": missing_session,
                    "action": "AIO20_MISSING_ACTION_MUST_NOT_BE_LOGGED",
                }),
            ),
            Err(ApiError::NotFound(_))
        ));

        let event_failure_action = "AIO20_EVENT_FAILURE_ACTION_MUST_NOT_BE_LOGGED";
        let event_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_agent_manager(manager.clone())
                .with_symbol_ownership(ownership)
                .with_event_bus(Arc::new(EventBus::new_durable()));
        assert!(matches!(
            call(
                &event_failure_state,
                "aelyris.agent.report_activity",
                serde_json::json!({
                    "sessionId": failed_session_id,
                    "action": event_failure_action,
                }),
            ),
            Err(ApiError::Internal(_))
        ));
        assert_eq!(
            manager
                .list_sessions()
                .into_iter()
                .find(|session| session.id == failed_session_id)
                .and_then(|session| session.current_activity)
                .map(|activity| activity.action),
            Some(event_failure_action.to_string()),
            "Event Bus failure does not replay or roll back the AgentManager mutation"
        );

        let recent = events.recent();
        assert_eq!(
            recent
                .iter()
                .filter(|event| event.kind == AgentEventKind::AgentActivity)
                .count(),
            1
        );
        assert_eq!(
            recent
                .iter()
                .filter(|event| event.kind == AgentEventKind::BlockerRaised)
                .count(),
            1
        );
        assert_eq!(
            recent
                .iter()
                .filter(|event| event.kind == AgentEventKind::SteerAvoid)
                .count(),
            1
        );

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_agent_coordination_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read agent coordination audit");
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("coordination-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            2
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "steer_avoid"
                && row.redacted_payload_json["coordinationCount"] == 1
                && row.redacted_payload_json["mutationApplied"].is_null()
                && row.redacted_payload_json["eventPublished"] == true
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "agent_session_not_live"
                && row.redacted_payload_json["mutationApplied"] == false
                && row.redacted_payload_json["eventPublished"].is_null()
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"]
                == "agent_coordination_event_publication_failed"
                && row.redacted_payload_json["mutationApplied"] == true
                && row.redacted_payload_json["eventPublished"] == false
        }));
        let session_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["sessionDigest"]
                    .as_str()
                    .expect("session digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("coordination input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(session_digests.len(), 3);
        assert_eq!(input_digests.len(), 5);
        assert!(session_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["coordinationValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                session_id,
                session_task,
                failed_session_id,
                missing_session,
                action,
                file,
                symbol,
                blocker,
                needs,
                event_failure_action,
                avoid_agent,
                avoid_task,
                avoid_path,
                avoid_symbol,
                "AIO20_AVOID_CLAIM_MUST_NOT_BE_LOGGED",
                "AIO20_MISSING_ACTION_MUST_NOT_BE_LOGGED",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let _ = manager.stop_session(session_id);
        let _ = manager.stop_session(failed_session_id);
    }

    #[test]
    fn pane_identity_mcp_schema_and_tool_error_contract() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("t"),
        );

        let call = |name: &str, arguments: serde_json::Value| {
            let body = ToolCallBody {
                name: name.to_string(),
                arguments,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
                .expect("tool call response")
                .0
        };

        let Json(listed) = rt.block_on(tools_list());
        for (verb, field, max_len) in [
            ("aelyris.pane.rename", "name", 120),
            ("aelyris.pane.set_role", "role", 40),
        ] {
            let tool = listed["tools"]
                .as_array()
                .expect("tools is an array")
                .iter()
                .find(|tool| tool["name"].as_str() == Some(verb))
                .unwrap_or_else(|| panic!("{verb} is listed"));
            assert_eq!(tool["safety"], serde_json::json!("GATED"));
            assert_eq!(
                tool["inputSchema"]["properties"][field]["minLength"],
                serde_json::json!(1)
            );
            assert_eq!(
                tool["inputSchema"]["properties"][field]["maxLength"],
                serde_json::json!(max_len)
            );
        }

        let renamed = call(
            "aelyris.pane.rename",
            serde_json::json!({ "terminalId": "pty-1", "name": "review" }),
        );
        assert_eq!(renamed["ok"], serde_json::json!(true));
        assert_eq!(renamed["result"]["ok"], serde_json::json!(true));

        let role = call(
            "aelyris.pane.set_role",
            serde_json::json!({ "terminalId": "pty-1", "role": "agent" }),
        );
        assert_eq!(role["ok"], serde_json::json!(true));
        assert_eq!(role["result"]["ok"], serde_json::json!(true));

        let empty_name = call(
            "aelyris.pane.rename",
            serde_json::json!({ "terminalId": "pty-1", "name": "" }),
        );
        assert_eq!(empty_name["ok"], serde_json::json!(false));
        assert_eq!(
            empty_name["error"]["schema_violation"]["wrong_type"][0]["expected"],
            serde_json::json!("string >= 1 chars")
        );

        let missing_ref = call(
            "aelyris.pane.rename",
            serde_json::json!({ "terminalId": "%404", "name": "review" }),
        );
        assert_eq!(missing_ref["ok"], serde_json::json!(false));
        assert!(
            missing_ref["error"]["error"]
                .as_str()
                .is_some_and(|message| message.contains("unknown terminal reference `%404`")),
            "{missing_ref:?}"
        );
    }

    #[test]
    fn mcp_pane_metadata_control_honors_principal_bound_lease_and_value_minimized_audit() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()));
        state
            .controller_leases
            .acquire("term-1", "client-a", "controller-agent")
            .unwrap();

        for verb in ["aelyris.pane.rename", "aelyris.pane.set_role"] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            let properties = schema["properties"].as_object().unwrap();
            assert!(properties.contains_key("clientId"));
            assert!(!properties.contains_key("actor"));
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |actor: &str, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                &state,
                actor,
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };

        assert!(matches!(
            call(
                "other-agent",
                "aelyris.pane.rename",
                serde_json::json!({
                    "terminalId": "term-1",
                    "name": "AIO10_NAME_MUST_NOT_BE_LOGGED",
                    "clientId": "client-a",
                }),
            ),
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            call(
                "controller-agent",
                "aelyris.pane.set_role",
                serde_json::json!({
                    "terminalId": "term-1",
                    "role": "AIO10_ROLE_MUST_NOT_BE_LOGGED",
                }),
            ),
            Err(ApiError::Conflict(_))
        ));

        let Json(renamed) = call(
            "controller-agent",
            "aelyris.pane.rename",
            serde_json::json!({
                "terminalId": "term-1",
                "name": "AIO10_NAME_MUST_NOT_BE_LOGGED",
                "clientId": "client-a",
            }),
        )
        .expect("matching controller may rename");
        assert_eq!(renamed["result"]["ok"], true);

        let Json(role_set) = call(
            "controller-agent",
            "aelyris.pane.set_role",
            serde_json::json!({
                "terminalId": "term-1",
                "role": "AIO10_ROLE_MUST_NOT_BE_LOGGED",
                "clientId": "client-a",
            }),
        )
        .expect("matching controller may set role");
        assert_eq!(role_set["result"]["ok"], true);

        let Json(missing) = call(
            "controller-agent",
            "aelyris.pane.rename",
            serde_json::json!({
                "terminalId": "term-1",
                "name": "missing-pane",
                "clientId": "client-a",
            }),
        )
        .expect("pane core failure remains a typed tool result");
        assert_eq!(missing["ok"], false);
        assert!(missing["error"]["error"]
            .as_str()
            .is_some_and(|message| message.contains("missing-pane")));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_pane_metadata_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read pane metadata audit");
        assert_eq!(rows.len(), 5);
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| {
                    row.redacted_payload_json["rejectionCode"] == "controller_lease_conflict"
                })
                .count(),
            2
        );
        assert!(rows
            .iter()
            .any(|row| { row.redacted_payload_json["rejectionCode"] == "pane_mutation_failed" }));
        assert!(rows
            .iter()
            .any(|row| row.redacted_payload_json["operation"] == "rename"));
        assert!(rows
            .iter()
            .any(|row| row.redacted_payload_json["operation"] == "set_role"));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["metadataValueLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            assert!(!audit_text.contains("AIO10_NAME_MUST_NOT_BE_LOGGED"));
            assert!(!audit_text.contains("AIO10_ROLE_MUST_NOT_BE_LOGGED"));
            assert!(!audit_text.contains("missing-pane"));
            assert!(!audit_text.contains("client-a"));
        }
    }

    #[test]
    fn session_lifecycle_mcp_verbs_go_through_governance_before_runtime() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;
        use std::sync::Arc;

        struct DenyLifecycle;
        impl AccessControl for DenyLifecycle {
            fn authorize(&self, _actor: &str, verb: &str) -> AccessDecision {
                if verb.starts_with("aelyris.session.") {
                    AccessDecision::Deny(format!("{verb} blocked"))
                } else {
                    AccessDecision::Allow
                }
            }
        }

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_governance(Arc::new(Governance::with_access(Box::new(DenyLifecycle))));
        let body = ToolCallBody {
            name: "aelyris.session.resume".to_string(),
            arguments: serde_json::json!({}),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        assert!(matches!(result, Err(ApiError::Forbidden(_))));
    }

    #[test]
    fn session_lifecycle_mcp_fails_closed_without_app_handle() {
        use crate::pty::PtyManager;

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let body = ToolCallBody {
            name: "aelyris.session.resume".to_string(),
            arguments: serde_json::json!({}),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        match result {
            Err(ApiError::Internal(message)) => assert!(
                message.contains("session lifecycle runtime is not attached"),
                "{message}"
            ),
            other => panic!("expected fail-closed missing runtime error, got {other:?}"),
        }
    }

    fn write_test_proofbook(project: &std::path::Path, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        std::fs::create_dir_all(&dir).expect("proofbook dir");
        let path = dir.join("mcp.proofbook.yaml");
        std::fs::write(&path, yaml).expect("write proofbook");
        path.to_string_lossy().to_string()
    }

    struct RuntimeOwnedMcpAgentExecutor;

    impl crate::proofbook::ProofbookAgentSessionExecutor for RuntimeOwnedMcpAgentExecutor {
        fn start_agent_session(
            &self,
            _run_id: &str,
            _ledger: &crate::proofbook::ProofbookRunLedger,
            _step: &crate::proofbook::ProofbookStep,
            request: &crate::proofbook::ProofbookAgentSessionRequest,
        ) -> Result<crate::proofbook::ProofbookAgentSessionSpawn, crate::proofbook::ProofbookError>
        {
            Ok(crate::proofbook::ProofbookAgentSessionSpawn {
                session_id: "mcp-runtime-owned-session".to_string(),
                pane_id: Some("mcp-runtime-owned-pane".to_string()),
                pty_id: Some("mcp-runtime-owned-pty".to_string()),
                backend: "native".to_string(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                repo_path: request.repo_path.clone(),
                worktree_path: request.worktree_path.clone(),
                worktree_branch: request.worktree_branch.clone(),
                visible: true,
            })
        }
    }

    fn register_mcp_runtime_session(
        manager: &crate::agent::InteractiveSessionManager,
        context: &crate::proofbook::ProofbookAgentSessionSettlementContext,
        status: &str,
    ) {
        manager
            .register(crate::agent::InteractiveSessionInfo {
                id: context.session_id.clone(),
                logical_session_id: "mcp-runtime-owned-logical".to_string(),
                pty_id: context.pty_id.clone().expect("visible PTY identity"),
                backend: context.backend.clone(),
                cli: crate::agent::AgentCli::Codex,
                status: status.to_string(),
                model: "gpt-test".to_string(),
                initial_prompt: None,
                approval_prompt: None,
                cwd: context.repo_path.clone(),
                worktree_branch: context.worktree_branch.clone(),
                worktree_path: context.worktree_path.clone(),
                repo_path: Some(context.repo_path.clone()),
                cost: 0.0,
                tokens_used: 0,
                started_at: 1,
                last_activity: 1,
                turn_count: 0,
                context_remaining: None,
            })
            .expect("register runtime-owned MCP session");
    }

    #[test]
    fn proofbook_mcp_verbs_are_cataloged_and_scoped() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let tools = listed["tools"].as_array().expect("tools is an array");
        let expected = [
            ("aelyris.proofbook.list", "FREE"),
            ("aelyris.proofbook.get", "FREE"),
            ("aelyris.proofbook.validate", "FREE"),
            ("aelyris.proofbook.run", "GATED"),
            ("aelyris.proofbook.status", "FREE"),
            ("aelyris.proofbook.settle_agent_session", "GATED"),
            ("aelyris.proofbook.agent_session_candidate", "FREE"),
            ("aelyris.proofbook.settle_current_agent_session", "GATED"),
            ("aelyris.proofbook.cancel", "GATED"),
            ("aelyris.proofbook.cancel_current", "GATED"),
            ("aelyris.proofbook.approve_gate", "GATED"),
            ("aelyris.proofbook.reject_gate", "GATED"),
        ];
        for (verb, safety) in expected {
            let tool = tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(verb))
                .unwrap_or_else(|| panic!("{verb} present in tools_list"));
            assert_eq!(tool["safety"], serde_json::json!(safety));
            assert_eq!(
                tool["inputSchema"]["additionalProperties"],
                serde_json::json!(false)
            );
        }
        assert!(tools.iter().all(|tool| !matches!(
            tool["name"].as_str(),
            Some(
                "aelyris.proofbook.create"
                    | "aelyris.proofbook.update"
                    | "aelyris.proofbook.distill"
            )
        )));
    }

    #[test]
    fn proofbook_mcp_verbs_go_through_governance_before_runtime() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;

        struct DenyProofbook;
        impl AccessControl for DenyProofbook {
            fn authorize(&self, _actor: &str, verb: &str) -> AccessDecision {
                if verb.starts_with("aelyris.proofbook.") {
                    AccessDecision::Deny(format!("{verb} blocked"))
                } else {
                    AccessDecision::Allow
                }
            }
        }

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_governance(Arc::new(Governance::with_access(Box::new(DenyProofbook))));
        for (name, arguments) in [
            (
                "aelyris.proofbook.run",
                serde_json::json!({ "projectPath": "C:/repo", "proofbookPath": "x" }),
            ),
            (
                "aelyris.proofbook.agent_session_candidate",
                serde_json::json!({
                    "projectPath": "C:/repo",
                    "runId": "run-1",
                    "stepId": "agent",
                    "expectedRevision": 1,
                }),
            ),
            (
                "aelyris.proofbook.settle_current_agent_session",
                serde_json::json!({
                    "projectPath": "C:/repo",
                    "runId": "run-1",
                    "stepId": "agent",
                    "expectedRevision": 1,
                    "expectedSessionId": "session-1",
                }),
            ),
            (
                "aelyris.proofbook.cancel_current",
                serde_json::json!({
                    "projectPath": "C:/repo",
                    "runId": "run-1",
                    "expectedRevision": 1,
                }),
            ),
        ] {
            let result = rt.block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: name.to_string(),
                    arguments,
                }),
            ));
            assert!(
                matches!(result, Err(ApiError::Forbidden(_))),
                "{name} must be denied before runtime access"
            );
        }
    }

    #[test]
    fn proofbook_runtime_owned_mcp_candidate_and_settlement_use_shared_authority() {
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let expected_artifact = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("runtime-summary.md");
        std::fs::create_dir_all(expected_artifact.parent().unwrap()).unwrap();
        std::fs::write(&expected_artifact, "current runtime evidence").unwrap();
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: aio2-runtime-owned-settlement
steps:
  - id: agent
    type: agentSession
    task: finish AIO-2 runtime work
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/runtime-summary.md
settlement:
  requiredSteps: [agent]
"#,
        );
        let project_path = project.path().to_string_lossy().to_string();
        let runner = crate::proofbook::ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path,
                &proofbook,
                serde_json::json!({}),
                &RuntimeOwnedMcpAgentExecutor,
            )
            .expect("start running agentSession");
        let context = runner
            .agent_session_settlement_context(
                &project_path,
                &running.run_id,
                "agent",
                running.revision,
            )
            .expect("settlement context");
        let interactive = crate::agent::InteractiveSessionManager::new();
        register_mcp_runtime_session(&interactive, &context, "done");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(runner.clone())
            .with_interactive_session_manager(interactive);
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");

        let Json(candidate) = rt
            .block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.proofbook.agent_session_candidate".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project_path,
                        "runId": running.run_id,
                        "stepId": "agent",
                        "expectedRevision": running.revision,
                    }),
                }),
            ))
            .expect("runtime-owned candidate");
        let projected = &candidate["result"];
        assert_eq!(projected["sessionId"], context.session_id);
        assert_eq!(projected["runtimeStatus"], "done");
        assert_eq!(projected["eligible"], true);
        assert_eq!(projected["resultingStatus"], "passed");
        assert_eq!(projected["proofKind"], "requiredArtifactSettlement");
        assert_eq!(projected["expectedArtifacts"][0]["present"], true);
        for forbidden in [
            "proof",
            "doneSignal",
            "proofSources",
            "summary",
            "reviewerBatchId",
            "blockerMessage",
        ] {
            assert!(
                projected.get(forbidden).is_none(),
                "candidate exposed caller-authored proof field {forbidden}"
            );
        }

        let Json(schema_rejected) = rt
            .block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.proofbook.settle_current_agent_session".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project_path,
                        "runId": running.run_id,
                        "stepId": "agent",
                        "expectedRevision": running.revision,
                        "expectedSessionId": context.session_id,
                        "proof": { "status": "passed" },
                    }),
                }),
            ))
            .expect("schema rejection stays a tool result");
        assert_eq!(schema_rejected["ok"], false);
        assert_eq!(
            schema_rejected["error"]["schema_violation"]["unknown"],
            serde_json::json!(["proof"])
        );
        assert_eq!(
            runner.status(&project_path, &running.run_id).unwrap().steps[0].status,
            ProofbookStepStatus::Running
        );

        let Json(settled) = rt
            .block_on(tools_call(
                State(state),
                Json(ToolCallBody {
                    name: "aelyris.proofbook.settle_current_agent_session".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project_path,
                        "runId": running.run_id,
                        "stepId": "agent",
                        "expectedRevision": running.revision,
                        "expectedSessionId": context.session_id,
                    }),
                }),
            ))
            .expect("settle from current runtime-owned evidence");
        let ledger: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(settled["result"].clone()).expect("settled ledger");
        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn mcp_runtime_owned_settlement_audit_is_principal_bound_and_identity_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        fn runtime_project(
            id: &str,
            create_artifact: bool,
        ) -> (
            tempfile::TempDir,
            String,
            String,
            crate::proofbook::ProofbookRunner,
            crate::proofbook::ProofbookRunLedger,
            crate::proofbook::ProofbookAgentSessionSettlementContext,
            crate::agent::InteractiveSessionManager,
        ) {
            let project = tempfile::tempdir().expect("runtime settlement tempdir");
            let artifact = project
                .path()
                .join(".aelyris")
                .join("proofbooks")
                .join("AIO28_RUNTIME_ARTIFACT_MUST_NOT_BE_LOGGED.md");
            if create_artifact {
                std::fs::create_dir_all(artifact.parent().unwrap()).unwrap();
                std::fs::write(&artifact, "AIO28_ARTIFACT_BODY_MUST_NOT_BE_LOGGED").unwrap();
            }
            let proofbook = write_test_proofbook(
                project.path(),
                &format!(
                    r#"
schema: aelyris.proofbook.v1
id: {id}
steps:
  - id: agent-aio28-secret
    type: agentSession
    task: AIO28_TASK_BODY_MUST_NOT_BE_LOGGED
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/AIO28_RUNTIME_ARTIFACT_MUST_NOT_BE_LOGGED.md
settlement:
  requiredSteps: [agent-aio28-secret]
"#
                ),
            );
            let project_path = project.path().to_string_lossy().to_string();
            let runner = crate::proofbook::ProofbookRunner::new();
            let running = runner
                .start_run_with_agent_executor(
                    &project_path,
                    &proofbook,
                    serde_json::json!({}),
                    &RuntimeOwnedMcpAgentExecutor,
                )
                .expect("start runtime-owned agentSession");
            let context = runner
                .agent_session_settlement_context(
                    &project_path,
                    &running.run_id,
                    "agent-aio28-secret",
                    running.revision,
                )
                .expect("runtime settlement context");
            let interactive = crate::agent::InteractiveSessionManager::new();
            register_mcp_runtime_session(&interactive, &context, "done");
            (
                project,
                project_path,
                proofbook,
                runner,
                running,
                context,
                interactive,
            )
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let (_project, project_path, _proofbook, runner, running, context, interactive) =
            runtime_project("aio28-runtime-accepted", true);
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_proofbook_runner(runner.clone())
            .with_interactive_session_manager(interactive);
        let schema =
            input_schema_for_tool_ref("aelyris.proofbook.settle_current_agent_session").unwrap();
        assert!(schema["properties"].get("actor").is_none());
        for forbidden in [
            "proof",
            "status",
            "doneSignal",
            "artifactPaths",
            "reviewerBatchId",
            "blockerMessage",
        ] {
            assert!(schema["properties"].get(forbidden).is_none());
        }

        let actor = "runtime-settlement-operator";
        let args = serde_json::json!({
            "projectPath": project_path,
            "runId": running.run_id,
            "stepId": "agent-aio28-secret",
            "expectedRevision": running.revision,
            "expectedSessionId": context.session_id,
        });
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, actor: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: "aelyris.proofbook.settle_current_agent_session".to_string(),
                    arguments,
                },
            ))
        };

        assert!(matches!(
            call(&state, "  ", args.clone()),
            Err(ApiError::Forbidden(_))
        ));
        let wrong_session = "AIO28_WRONG_SESSION_MUST_NOT_BE_LOGGED";
        let mut wrong_args = args.clone();
        wrong_args["expectedSessionId"] = serde_json::json!(wrong_session);
        let identity_error = call(&state, actor, wrong_args);
        assert!(matches!(
            identity_error,
            Err(ApiError::BadRequest(message)) if message.contains("runtime identity changed")
        ));
        assert_eq!(
            runner
                .status(&project_path, &running.run_id)
                .unwrap()
                .revision,
            running.revision
        );

        let Json(settled) = call(&state, actor, args.clone()).expect("runtime-owned settlement");
        let settled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(settled["result"].clone()).unwrap();
        assert_eq!(settled.status, ProofbookRunStatus::Passed);
        assert_eq!(settled.steps[0].status, ProofbookStepStatus::Passed);
        let settled_revision = settled.revision;

        let repeated = call(&state, actor, args);
        assert!(matches!(repeated, Err(ApiError::BadRequest(_))));
        assert_eq!(
            runner
                .status(&project_path, &settled.run_id)
                .unwrap()
                .revision,
            settled_revision,
            "repeat settlement does not create another revision"
        );

        let (
            _missing_project,
            missing_project_path,
            _missing_proofbook,
            missing_runner,
            missing_running,
            missing_context,
            missing_interactive,
        ) = runtime_project("aio28-runtime-missing-artifact", false);
        let missing_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_proofbook_runner(missing_runner.clone())
                .with_interactive_session_manager(missing_interactive);
        let missing_error = call(
            &missing_state,
            actor,
            serde_json::json!({
                "projectPath": missing_project_path,
                "runId": missing_running.run_id,
                "stepId": "agent-aio28-secret",
                "expectedRevision": missing_running.revision,
                "expectedSessionId": missing_context.session_id,
            }),
        );
        assert!(matches!(
            missing_error,
            Err(ApiError::BadRequest(message)) if message.contains("expected_artifacts_missing")
        ));
        assert_eq!(
            missing_runner
                .status(&missing_project_path, &missing_running.run_id)
                .unwrap()
                .revision,
            missing_running.revision
        );

        let startup_project = "AIO28_STARTUP_PROJECT_MUST_NOT_BE_LOGGED";
        let startup_run = "AIO28_STARTUP_RUN_MUST_NOT_BE_LOGGED";
        let startup_step = "AIO28_STARTUP_STEP_MUST_NOT_BE_LOGGED";
        let startup_session = "AIO28_STARTUP_SESSION_MUST_NOT_BE_LOGGED";
        let startup_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()))
                .with_proofbook_runner(crate::proofbook::ProofbookRunner::new())
                .with_startup_reconciliation(Arc::new(
                    crate::startup_reconciliation::StartupReconciliationState::new(),
                ));
        let startup_error = call(
            &startup_state,
            actor,
            serde_json::json!({
                "projectPath": startup_project,
                "runId": startup_run,
                "stepId": startup_step,
                "expectedRevision": 4,
                "expectedSessionId": startup_session,
            }),
        );
        assert!(matches!(
            startup_error,
            Err(ApiError::ServiceUnavailable(_))
        ));

        let unavailable_project = "AIO28_UNAVAILABLE_PROJECT_MUST_NOT_BE_LOGGED";
        let unavailable_run = "AIO28_UNAVAILABLE_RUN_MUST_NOT_BE_LOGGED";
        let unavailable_step = "AIO28_UNAVAILABLE_STEP_MUST_NOT_BE_LOGGED";
        let unavailable_session = "AIO28_UNAVAILABLE_SESSION_MUST_NOT_BE_LOGGED";
        let unavailable_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()));
        let unavailable_error = call(
            &unavailable_state,
            actor,
            serde_json::json!({
                "projectPath": unavailable_project,
                "runId": unavailable_run,
                "stepId": unavailable_step,
                "expectedRevision": 5,
                "expectedSessionId": unavailable_session,
            }),
        );
        assert!(matches!(unavailable_error, Err(ApiError::Internal(_))));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_proofbook_runtime_settlement_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read runtime settlement audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some(actor)));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            5
        );
        let accepted = rows
            .iter()
            .find(|row| row.redacted_payload_json["status"] == "accepted")
            .expect("accepted settlement audit");
        assert_eq!(
            accepted.redacted_payload_json["ledgerRevision"],
            settled_revision
        );
        assert_eq!(accepted.redacted_payload_json["ledgerStatus"], "passed");
        assert_eq!(accepted.redacted_payload_json["expectedArtifactCount"], 1);
        assert_eq!(accepted.redacted_payload_json["proofSourceCount"], 2);
        assert_eq!(accepted.redacted_payload_json["blockerCount"], 0);
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "proofbook_runtime_identity_changed"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "proofbook_expected_artifacts_missing"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "proofbook_runtime_settlement_unavailable"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "proofbook_runner_unavailable"
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["runtimeValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["completionProofLogged"], false);
            assert_eq!(
                row.redacted_payload_json["externalProcessTerminationClaimed"],
                false
            );
            assert_eq!(row.redacted_payload_json["reviewAcceptanceClaimed"], false);
            assert_eq!(row.redacted_payload_json["mergeClaimed"], false);
            for field in ["settlementDigest", "inputDigest"] {
                let digest = row.redacted_payload_json[field]
                    .as_str()
                    .expect("runtime settlement digest");
                assert_eq!(digest.len(), 64);
                assert!(digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()));
            }
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                project_path.as_str(),
                settled.run_id.as_str(),
                "agent-aio28-secret",
                context.session_id.as_str(),
                context.pty_id.as_deref().unwrap_or_default(),
                context.worktree_path.as_deref().unwrap_or_default(),
                "AIO28_RUNTIME_ARTIFACT_MUST_NOT_BE_LOGGED.md",
                "AIO28_ARTIFACT_BODY_MUST_NOT_BE_LOGGED",
                wrong_session,
                missing_project_path.as_str(),
                missing_running.run_id.as_str(),
                missing_context.session_id.as_str(),
                startup_project,
                startup_run,
                startup_step,
                startup_session,
                unavailable_project,
                unavailable_run,
                unavailable_step,
                unavailable_session,
            ] {
                if !hidden.is_empty() {
                    assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
                }
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio28_runtime_settlement_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_proofbook_runtime_settlement_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated runtime settlement audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let (
            _audit_project,
            audit_project_path,
            _audit_proofbook,
            audit_runner,
            audit_running,
            audit_context,
            audit_interactive,
        ) = runtime_project("aio28-runtime-audit-failure", true);
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(audit_failure_db))
                .with_proofbook_runner(audit_runner.clone())
                .with_interactive_session_manager(audit_interactive);
        let Json(audit_settled) = call(
            &audit_failure_state,
            actor,
            serde_json::json!({
                "projectPath": audit_project_path,
                "runId": audit_running.run_id,
                "stepId": "agent-aio28-secret",
                "expectedRevision": audit_running.revision,
                "expectedSessionId": audit_context.session_id,
            }),
        )
        .expect("audit failure does not replay or reject settlement");
        let audit_settled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(audit_settled["result"].clone()).unwrap();
        assert_eq!(audit_settled.status, ProofbookRunStatus::Passed);
        assert_eq!(
            audit_runner
                .status(&audit_project_path, &audit_settled.run_id)
                .unwrap()
                .revision,
            audit_settled.revision,
            "audit failure leaves exactly the one settlement result returned by the runner"
        );
    }

    #[test]
    fn mcp_proofbook_compat_mutation_audit_is_principal_bound_and_proof_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let runner = crate::proofbook::ProofbookRunner::new();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_proofbook_runner(runner.clone());
        for verb in [
            "aelyris.proofbook.settle_agent_session",
            "aelyris.proofbook.cancel",
        ] {
            let schema = input_schema_for_tool_ref(verb).unwrap();
            assert!(schema["properties"].get("actor").is_none());
        }
        assert!(matches!(
            proofbook_compat_mutations::authenticated_actor("  "),
            Err(ApiError::Forbidden(_))
        ));

        let settlement_project = tempfile::tempdir().expect("settlement tempdir");
        let settlement_proofbook = write_test_proofbook(
            settlement_project.path(),
            r#"
schema: aelyris.proofbook.v1
id: aio27-compat-settlement
steps:
  - id: agent-aio27-secret
    type: agentSession
    task: AIO27_TASK_BODY_MUST_NOT_BE_LOGGED
    role: implementation
settlement:
  requiredSteps: [agent-aio27-secret]
"#,
        );
        let settlement_project_path = settlement_project.path().to_string_lossy().to_string();
        let running = runner
            .start_run_with_agent_executor(
                &settlement_project_path,
                &settlement_proofbook,
                serde_json::json!({}),
                &RuntimeOwnedMcpAgentExecutor,
            )
            .expect("running compatibility agentSession");
        assert_eq!(running.steps[0].status, ProofbookStepStatus::Running);

        let actor = "proofbook-compat-operator";
        let blocker_code = "AIO27_BLOCKER_CODE_MUST_NOT_BE_LOGGED";
        let blocker_message = "AIO27_BLOCKER_MESSAGE_MUST_NOT_BE_LOGGED";
        let proof_summary = "AIO27_PROOF_SUMMARY_MUST_NOT_BE_LOGGED";
        let settlement_args = serde_json::json!({
            "projectPath": settlement_project_path,
            "runId": running.run_id,
            "stepId": "agent-aio27-secret",
            "proof": {
                "status": "failed",
                "proofKind": "runtimeSessionStatus",
                "blockerCode": blocker_code,
                "blockerMessage": blocker_message,
                "summary": proof_summary,
            },
        });
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, name: &str, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                actor,
                ToolCallBody {
                    name: name.to_string(),
                    arguments,
                },
            ))
        };

        let Json(settled) = call(
            &state,
            "aelyris.proofbook.settle_agent_session",
            settlement_args.clone(),
        )
        .expect("compatibility settlement");
        let settled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(settled["result"].clone()).expect("settled ledger");
        assert_eq!(settled.status, ProofbookRunStatus::Failed);
        assert_eq!(settled.steps[0].status, ProofbookStepStatus::Failed);
        let settled_revision = settled.revision;

        let repeated_settlement = call(
            &state,
            "aelyris.proofbook.settle_agent_session",
            settlement_args,
        );
        assert!(matches!(repeated_settlement, Err(ApiError::BadRequest(_))));
        assert_eq!(
            runner
                .status(&settlement_project_path, &settled.run_id)
                .unwrap()
                .revision,
            settled_revision,
            "rejected repeat does not create another ledger revision"
        );

        let cancel_project = tempfile::tempdir().expect("cancel tempdir");
        let cancel_proofbook = write_test_proofbook(
            cancel_project.path(),
            r#"
schema: aelyris.proofbook.v1
id: aio27-compat-cancel
steps:
  - id: hold-aio27-secret
    type: manualGate
    gateId: AIO27_GATE_ID_MUST_NOT_BE_LOGGED
    options: [approve, reject]
settlement:
  requiredSteps: [hold-aio27-secret]
"#,
        );
        let cancel_project_path = cancel_project.path().to_string_lossy().to_string();
        let waiting = runner
            .start_run(
                &cancel_project_path,
                &cancel_proofbook,
                serde_json::json!({}),
            )
            .expect("waiting compatibility run");
        let cancel_args = serde_json::json!({
            "projectPath": cancel_project_path,
            "runId": waiting.run_id,
        });
        let Json(cancelled) = call(&state, "aelyris.proofbook.cancel", cancel_args.clone())
            .expect("compatibility cancellation");
        let cancelled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(cancelled["result"].clone()).expect("cancelled ledger");
        assert_eq!(cancelled.status, ProofbookRunStatus::Cancelled);
        assert_eq!(cancelled.steps[0].status, ProofbookStepStatus::Cancelled);
        let cancelled_revision = cancelled.revision;

        let repeated_cancel = call(&state, "aelyris.proofbook.cancel", cancel_args);
        assert!(matches!(repeated_cancel, Err(ApiError::BadRequest(_))));
        assert_eq!(
            runner
                .status(&cancel_project_path, &cancelled.run_id)
                .unwrap()
                .revision,
            cancelled_revision,
            "terminal cancellation does not advance again"
        );

        let unavailable_project = "AIO27_UNAVAILABLE_PROJECT_MUST_NOT_BE_LOGGED";
        let unavailable_run = "AIO27_UNAVAILABLE_RUN_MUST_NOT_BE_LOGGED";
        let unavailable_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()));
        let unavailable = call(
            &unavailable_state,
            "aelyris.proofbook.cancel",
            serde_json::json!({
                "projectPath": unavailable_project,
                "runId": unavailable_run,
            }),
        );
        assert!(matches!(unavailable, Err(ApiError::Internal(_))));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_proofbook_compat_mutation_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read compatibility mutation audit");
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some(actor)));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "settle_agent_session"
                && row.redacted_payload_json["resultSummary"]["revision"] == settled_revision
                && row.redacted_payload_json["resultSummary"]["status"] == "failed"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["operation"] == "cancel"
                && row.redacted_payload_json["resultSummary"]["revision"] == cancelled_revision
                && row.redacted_payload_json["resultSummary"]["status"] == "cancelled"
        }));
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "proofbook_runner_unavailable"
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["proofbookValuesLogged"], false);
            assert_eq!(row.redacted_payload_json["completionProofLogged"], false);
            for field in ["runDigest", "inputDigest"] {
                let digest = row.redacted_payload_json[field]
                    .as_str()
                    .expect("Proofbook compatibility digest");
                assert_eq!(digest.len(), 64);
                assert!(digest
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()));
            }
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                settlement_project_path.as_str(),
                settled.run_id.as_str(),
                "agent-aio27-secret",
                blocker_code,
                blocker_message,
                proof_summary,
                cancel_project_path.as_str(),
                cancelled.run_id.as_str(),
                "hold-aio27-secret",
                "AIO27_GATE_ID_MUST_NOT_BE_LOGGED",
                unavailable_project,
                unavailable_run,
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio27_proofbook_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_proofbook_compat_mutation_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated Proofbook compatibility audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_project = tempfile::tempdir().expect("audit failure tempdir");
        let audit_failure_proofbook = write_test_proofbook(
            audit_failure_project.path(),
            r#"
schema: aelyris.proofbook.v1
id: aio27-audit-failure
steps:
  - id: hold
    type: manualGate
    gateId: audit-failure-hold
    options: [approve, reject]
settlement:
  requiredSteps: [hold]
"#,
        );
        let audit_failure_project_path = audit_failure_project.path().to_string_lossy().to_string();
        let audit_failure_runner = crate::proofbook::ProofbookRunner::new();
        let audit_waiting = audit_failure_runner
            .start_run(
                &audit_failure_project_path,
                &audit_failure_proofbook,
                serde_json::json!({}),
            )
            .unwrap();
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(audit_failure_db))
                .with_proofbook_runner(audit_failure_runner.clone());
        let Json(audit_cancelled) = call(
            &audit_failure_state,
            "aelyris.proofbook.cancel",
            serde_json::json!({
                "projectPath": audit_failure_project_path,
                "runId": audit_waiting.run_id,
            }),
        )
        .expect("audit failure does not replay or reject cancellation");
        let audit_cancelled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(audit_cancelled["result"].clone()).unwrap();
        assert_eq!(audit_cancelled.status, ProofbookRunStatus::Cancelled);
        assert_eq!(
            audit_failure_runner
                .status(&audit_failure_project_path, &audit_cancelled.run_id)
                .unwrap()
                .revision,
            audit_waiting.revision + 1
        );
    }

    #[test]
    fn proofbook_cancel_current_is_revision_pinned_actor_bound_and_claim_safe() {
        use crate::db::AuditJournalFilter;
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: aio4-exact-current-cancel
steps:
  - id: hold
    type: manualGate
    gateId: aio4-hold
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [hold]
"#,
        );
        let project_path = project.path().to_string_lossy().to_string();
        let runner = crate::proofbook::ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path, &proofbook, serde_json::json!({}))
            .expect("waiting Proofbook run");
        assert_eq!(waiting.status, ProofbookRunStatus::WaitingGate);
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(runner.clone())
            .with_db(Some(db.clone()));
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");

        let Json(schema_rejected) = rt
            .block_on(tools_call_as_actor(
                &state,
                "cancel-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.cancel_current".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project_path,
                        "runId": waiting.run_id,
                        "expectedRevision": waiting.revision,
                        "actor": "operator",
                    }),
                },
            ))
            .expect("caller-authored actor is a schema tool error");
        assert_eq!(schema_rejected["ok"], false);
        assert_eq!(
            schema_rejected["error"]["schema_violation"]["unknown"],
            serde_json::json!(["actor"])
        );

        let stale = rt.block_on(tools_call_as_actor(
            &state,
            "cancel-agent",
            ToolCallBody {
                name: "aelyris.proofbook.cancel_current".to_string(),
                arguments: serde_json::json!({
                    "projectPath": project_path,
                    "runId": waiting.run_id,
                    "expectedRevision": waiting.revision + 1,
                }),
            },
        ));
        assert!(matches!(
            stale,
            Err(ApiError::BadRequest(message)) if message.contains("StaleLedgerRevision")
        ));
        let unchanged = runner
            .status(&project_path, &waiting.run_id)
            .expect("stale cancellation leaves the run unchanged");
        assert_eq!(unchanged.revision, waiting.revision);
        assert_eq!(unchanged.status, ProofbookRunStatus::WaitingGate);
        assert!(unchanged
            .events
            .iter()
            .all(|event| event.kind != "run_cancelled"));

        let Json(cancelled) = rt
            .block_on(tools_call_as_actor(
                &state,
                "cancel-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.cancel_current".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project_path,
                        "runId": waiting.run_id,
                        "expectedRevision": waiting.revision,
                    }),
                },
            ))
            .expect("exact current cancellation");
        let cancelled: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(cancelled["result"].clone()).expect("cancelled ledger");
        assert_eq!(cancelled.status, ProofbookRunStatus::Cancelled);
        assert_eq!(cancelled.revision, waiting.revision + 1);
        assert_eq!(cancelled.steps[0].status, ProofbookStepStatus::Cancelled);
        let event = cancelled
            .events
            .iter()
            .find(|event| event.kind == "run_cancelled")
            .expect("durable cancellation event");
        assert_eq!(event.actor.as_deref(), Some("cancel-agent"));
        assert_eq!(
            event.message,
            "Proofbook run cancelled by authenticated principal"
        );

        let audits = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("proofbook_current_run_cancelled".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read cancellation audit");
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].agent_id.as_deref(), Some("cancel-agent"));
        assert_eq!(audits[0].correlation_id, waiting.run_id);
        assert_eq!(
            audits[0].redacted_payload_json["externalProcessTerminationClaimed"],
            false
        );

        let terminal = rt.block_on(tools_call_as_actor(
            &state,
            "cancel-agent",
            ToolCallBody {
                name: "aelyris.proofbook.cancel_current".to_string(),
                arguments: serde_json::json!({
                    "projectPath": project_path,
                    "runId": cancelled.run_id,
                    "expectedRevision": cancelled.revision,
                }),
            },
        ));
        assert!(matches!(
            terminal,
            Err(ApiError::BadRequest(message)) if message.contains("RunNotCancellable")
        ));
        let current = runner
            .status(&project_path, &cancelled.run_id)
            .expect("terminal cancellation leaves history unchanged");
        assert_eq!(current.revision, cancelled.revision);
        assert_eq!(current.status, ProofbookRunStatus::Cancelled);
    }

    #[test]
    fn a4_12_proofbook_mcp_status_dispatch_remains_available_while_startup_is_blocked() {
        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: a4-status-observation
steps:
  - id: hold
    type: manualGate
    prompt: Observe this waiting run
    options: [approve, reject]
settlement:
  requiredSteps: [hold]
"#,
        );
        let runner = crate::proofbook::ProofbookRunner::new();
        let ledger = runner
            .start_run(
                &project.path().to_string_lossy(),
                &proofbook,
                serde_json::json!({}),
            )
            .expect("create observable waiting run");
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");

        let pending = Arc::new(crate::startup_reconciliation::StartupReconciliationState::new());
        let failed = Arc::new(crate::startup_reconciliation::StartupReconciliationState::new());
        failed.fail("fault", "injected failure").unwrap();
        for startup in [pending, failed] {
            let state = ApiState::new(
                crate::pty::PtyManager::new(),
                crate::api::AuthConfig::with_token("t"),
            )
            .with_proofbook_runner(runner.clone())
            .with_startup_reconciliation(startup);
            let body = ToolCallBody {
                name: "aelyris.proofbook.status".to_string(),
                arguments: serde_json::json!({
                    "projectPath": project.path().to_string_lossy(),
                    "runId": ledger.run_id,
                }),
            };
            let Json(value) = rt
                .block_on(tools_call(State(state), Json(body)))
                .expect("read-only status remains available");
            assert_eq!(value["result"]["runId"], ledger.run_id);
        }
    }

    #[test]
    fn a4_12_proofbook_mcp_effectful_tools_call_adapters_deny_pending_and_failed_startup() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let pending = Arc::new(crate::startup_reconciliation::StartupReconciliationState::new());
        let failed = Arc::new(crate::startup_reconciliation::StartupReconciliationState::new());
        failed.fail("fault", "injected failure").unwrap();

        for (startup, phase_code) in [
            (pending, "startup_reconciliation_pending"),
            (failed, "startup_reconciliation_failed"),
        ] {
            let state = ApiState::new(
                crate::pty::PtyManager::new(),
                crate::api::AuthConfig::with_token("t"),
            )
            .with_proofbook_runner(crate::proofbook::ProofbookRunner::new())
            .with_startup_reconciliation(startup);
            for (tool, surface, arguments) in [
                (
                    "aelyris.proofbook.settle_agent_session",
                    "Proofbook MCP agent-session continuation",
                    serde_json::json!({
                        "projectPath": "C:/a4-admission-fixture",
                        "runId": "run-fixture",
                        "stepId": "step-fixture",
                        "proof": { "status": "blocked" },
                    }),
                ),
                (
                    "aelyris.proofbook.settle_current_agent_session",
                    "Proofbook MCP runtime-owned agent-session settlement",
                    serde_json::json!({
                        "projectPath": "C:/a4-admission-fixture",
                        "runId": "run-fixture",
                        "stepId": "step-fixture",
                        "expectedRevision": 1,
                        "expectedSessionId": "session-fixture",
                    }),
                ),
                (
                    "aelyris.proofbook.cancel_current",
                    "Proofbook MCP exact current cancellation",
                    serde_json::json!({
                        "projectPath": "C:/a4-admission-fixture",
                        "runId": "run-fixture",
                        "expectedRevision": 1,
                    }),
                ),
                (
                    "aelyris.proofbook.approve_gate",
                    "Proofbook MCP gate continuation",
                    serde_json::json!({
                        "projectPath": "C:/a4-admission-fixture",
                        "runId": "run-fixture",
                        "gateId": "gate-fixture",
                        "gateHash": "sha256:fixture",
                    }),
                ),
                (
                    "aelyris.proofbook.reject_gate",
                    "Proofbook MCP gate continuation",
                    serde_json::json!({
                        "projectPath": "C:/a4-admission-fixture",
                        "runId": "run-fixture",
                        "gateId": "gate-fixture",
                        "gateHash": "sha256:fixture",
                    }),
                ),
            ] {
                let result = rt.block_on(tools_call(
                    State(state.clone()),
                    Json(ToolCallBody {
                        name: tool.to_string(),
                        arguments,
                    }),
                ));
                match result {
                    Err(ApiError::ServiceUnavailable(message)) => {
                        assert!(message.contains(phase_code), "{tool}: {message}");
                        assert!(message.contains(surface), "{tool}: {message}");
                    }
                    other => panic!(
                        "{tool} did not fail closed for {phase_code} at its actual adapter: {other:?}"
                    ),
                }
            }
        }
    }

    #[test]
    fn proofbook_run_start_is_principal_bound_without_changing_run_identity() {
        use crate::db::AuditJournalFilter;
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let yaml = r#"
schema: aelyris.proofbook.v1
id: pb3-free-mcp
steps:
  - id: list
    type: mcpTool
    toolName: terminal.list
    arguments: {}
settlement:
  requiredSteps: [list]
"#;
        let proofbook = write_test_proofbook(project.path(), yaml);
        let legacy_project = tempfile::tempdir().expect("legacy tempdir");
        let legacy_proofbook = write_test_proofbook(legacy_project.path(), yaml);
        let legacy_identity = crate::proofbook::ProofbookRunner::new()
            .start_run(
                &legacy_project.path().to_string_lossy(),
                &legacy_proofbook,
                serde_json::json!({}),
            )
            .expect("legacy identity baseline");
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let runner = crate::proofbook::ProofbookRunner::new();
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(runner.clone())
            .with_db(Some(db.clone()));
        let Json(schema_rejected) = rt
            .block_on(tools_call_as_actor(
                &state,
                "starter-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.run".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project.path().to_string_lossy(),
                        "proofbookPath": proofbook,
                        "actor": "operator",
                    }),
                },
            ))
            .expect("caller-authored actor is a schema tool error");
        assert_eq!(schema_rejected["ok"], false);
        assert_eq!(
            schema_rejected["error"]["schema_violation"]["unknown"],
            serde_json::json!(["actor"])
        );
        assert!(runner
            .list_runs(&project.path().to_string_lossy())
            .unwrap()
            .is_empty());

        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "starter-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.run".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project.path().to_string_lossy(),
                        "proofbookPath": proofbook,
                    }),
                },
            ))
            .expect("proofbook run dispatches");
        let ledger: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(value["result"].clone()).expect("ledger result");

        assert_eq!(ledger.run_id, legacy_identity.run_id);
        assert_eq!(ledger.definition_hash, legacy_identity.definition_hash);
        assert_eq!(ledger.input_hash, legacy_identity.input_hash);
        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
        let created = ledger
            .events
            .iter()
            .find(|event| event.kind == "run_created")
            .expect("run-created event");
        assert_eq!(created.actor.as_deref(), Some("starter-agent"));
        assert_eq!(
            created.message,
            "Proofbook run ledger created by authenticated principal before step execution"
        );
        let output = ledger.steps[0]
            .structured_output
            .as_ref()
            .expect("mcp output");
        assert_eq!(output["kind"], "mcpTool");
        assert_eq!(output["toolName"], "terminal.list");
        assert!(output["result"]["sessions"].is_array());

        let audits = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("proofbook_run_start_observed".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read start audit");
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].agent_id.as_deref(), Some("starter-agent"));
        assert_eq!(audits[0].correlation_id, ledger.run_id);
        assert_eq!(audits[0].redacted_payload_json["inputValuesLogged"], false);
        assert_eq!(
            audits[0].redacted_payload_json["inputHash"],
            ledger.input_hash
        );
    }

    #[test]
    fn proofbook_mcp_tool_schema_violation_is_recorded_in_ledger() {
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb3-schema
steps:
  - id: capture
    type: mcpTool
    toolName: terminal.capture
    arguments: {}
settlement:
  requiredSteps: [capture]
"#,
        );
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(crate::proofbook::ProofbookRunner::new());
        let body = ToolCallBody {
            name: "aelyris.proofbook.run".to_string(),
            arguments: serde_json::json!({
                "projectPath": project.path().to_string_lossy(),
                "proofbookPath": proofbook,
            }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("proofbook run dispatches");
        let ledger: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(value["result"].clone()).expect("ledger result");

        assert_eq!(ledger.status, ProofbookRunStatus::Failed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Failed);
        assert_eq!(
            ledger.steps[0].error.as_ref().unwrap().code,
            "mcp_schema_violation"
        );
        assert_eq!(
            ledger.steps[0].structured_output.as_ref().unwrap()["schema_violation"]["missing"],
            serde_json::json!(["sessionId"])
        );
    }

    #[test]
    fn proofbook_nested_tool_keeps_the_authenticated_actor_through_governance() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        struct DenyCapture;
        impl AccessControl for DenyCapture {
            fn authorize(&self, actor: &str, verb: &str) -> AccessDecision {
                if actor == "reader-agent" && verb == "terminal.capture" {
                    AccessDecision::Deny("nested capture blocked".to_string())
                } else {
                    AccessDecision::Allow
                }
            }
        }

        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb3-denied-before-schema
steps:
  - id: capture
    type: mcpTool
    toolName: terminal.capture
    arguments: {}
settlement:
  requiredSteps: [capture]
"#,
        );
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let db = Arc::new(ManagedDb::new(Database::open_memory().expect("memory db")));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(crate::proofbook::ProofbookRunner::new())
            .with_governance(Arc::new(Governance::with_access(Box::new(DenyCapture))))
            .with_db(Some(db.clone()));
        let Json(value) = rt
            .block_on(tools_call_as_actor(
                &state,
                "reader-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.run".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project.path().to_string_lossy(),
                        "proofbookPath": proofbook,
                    }),
                },
            ))
            .expect("outer Proofbook run is allowed");
        let ledger: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(value["result"].clone()).expect("ledger result");

        assert_eq!(ledger.status, ProofbookRunStatus::Failed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Blocked);
        assert_eq!(
            ledger.steps[0].error.as_ref().expect("denial error").code,
            "mcp_governance_denied"
        );
        assert_ne!(
            ledger.steps[0].error.as_ref().expect("denial error").code,
            "mcp_schema_violation"
        );

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("access_denied".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read denial audit");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "access_denied");
        assert_eq!(rows[0].correlation_id, "terminal.capture");
    }

    #[test]
    fn proofbook_gate_decision_actor_is_authenticated_and_stale_hash_fails_closed() {
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb3-gated
steps:
  - id: approval
    type: mcpTool
    toolName: aelyris.request_approval
    arguments:
      sessionId: pb3
      tool: deploy
settlement:
  requiredSteps: [approval]
"#,
        );
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let runner = crate::proofbook::ProofbookRunner::new();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_proofbook_runner(runner.clone());
        let body = ToolCallBody {
            name: "aelyris.proofbook.run".to_string(),
            arguments: serde_json::json!({
                "projectPath": project.path().to_string_lossy(),
                "proofbookPath": proofbook,
            }),
        };
        let Json(value) = rt
            .block_on(tools_call_as_actor(&state, "reader-agent", body))
            .expect("proofbook run dispatches");
        let ledger: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(value["result"].clone()).expect("ledger result");
        let output = ledger.steps[0]
            .structured_output
            .as_ref()
            .expect("gate output");

        assert_eq!(ledger.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::WaitingGate);
        assert_eq!(output["kind"], "mcpTool");
        assert_eq!(output["safety"], "GATED");
        assert!(output["pendingDecisionId"]
            .as_str()
            .unwrap()
            .starts_with("proofbook:"));
        assert_eq!(
            state.mcp_pending.lock().expect("pending lock").len(),
            1,
            "GATED mcpTool creates a pending decision projection",
        );
        let gate_id = output["gateId"].as_str().unwrap().to_string();
        let gate_hash = output["gateHash"].as_str().unwrap().to_string();

        for tool in [
            "aelyris.proofbook.approve_gate",
            "aelyris.proofbook.reject_gate",
        ] {
            let spoofed = rt.block_on(tools_call_as_actor(
                &state,
                "reader-agent",
                ToolCallBody {
                    name: tool.to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project.path().to_string_lossy(),
                        "runId": ledger.run_id,
                        "gateId": gate_id,
                        "gateHash": gate_hash,
                        "actor": "operator",
                    }),
                },
            ));
            assert!(
                matches!(spoofed, Err(ApiError::Forbidden(message)) if message.contains("authenticated principal")),
                "{tool} must reject caller-authored actor impersonation"
            );
        }
        let unchanged = runner
            .status(&project.path().to_string_lossy(), &ledger.run_id)
            .expect("spoofed decisions leave the ledger unchanged");
        assert_eq!(unchanged.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(unchanged.steps[0].status, ProofbookStepStatus::WaitingGate);
        assert!(unchanged.decisions.is_empty());

        let stale = ToolCallBody {
            name: "aelyris.proofbook.approve_gate".to_string(),
            arguments: serde_json::json!({
                "projectPath": project.path().to_string_lossy(),
                "runId": ledger.run_id,
                "gateId": gate_id,
                "gateHash": "sha256:stale",
            }),
        };
        let result = rt.block_on(tools_call_as_actor(&state, "reader-agent", stale));
        match result {
            Err(ApiError::BadRequest(message)) => {
                assert!(message.contains("StaleGateHash"), "{message}")
            }
            other => panic!("expected stale hash BadRequest, got {other:?}"),
        }

        let Json(approved) = rt
            .block_on(tools_call_as_actor(
                &state,
                "reader-agent",
                ToolCallBody {
                    name: "aelyris.proofbook.approve_gate".to_string(),
                    arguments: serde_json::json!({
                        "projectPath": project.path().to_string_lossy(),
                        "runId": ledger.run_id,
                        "gateId": gate_id,
                        "gateHash": gate_hash,
                        "comment": "approved by the authenticated caller",
                    }),
                },
            ))
            .expect("exact current gate may be approved by its authenticated caller");
        let approved: crate::proofbook::ProofbookRunLedger =
            serde_json::from_value(approved["result"].clone()).expect("approved ledger");
        assert_eq!(approved.status, ProofbookRunStatus::Passed);
        assert_eq!(approved.decisions.len(), 1);
        assert_eq!(approved.decisions[0].actor, "reader-agent");
        assert_eq!(
            approved.decisions[0].comment,
            "approved by the authenticated caller"
        );
        assert_eq!(
            approved.steps[0]
                .gate_decision
                .as_ref()
                .expect("step decision")
                .actor,
            "reader-agent"
        );
    }

    /// The pane-input byte ceiling lives once in `WS_MAX_INPUT_FRAME_BYTES`
    /// and is enforced at the WS handler, but the advertised JSON schemas
    /// repeat it as a raw `maxLength` literal in two places. Lock them
    /// together so editing the const without updating a schema (or
    /// vice-versa) can never silently make the advertised input bound a lie.
    #[test]
    fn input_schema_maxlength_matches_ws_frame_bound() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let tools = listed["tools"].as_array().expect("tools is an array");
        for verb in ["mux.workspace.safeInput", "aelyris.pane_send_input"] {
            let tool = tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(verb))
                .unwrap_or_else(|| panic!("verb {verb} present in tools_list"));
            let max_length = tool["inputSchema"]["properties"]["text"]["maxLength"]
                .as_u64()
                .unwrap_or_else(|| panic!("{verb} text.maxLength is a number"));
            assert_eq!(
                max_length,
                crate::api::WS_MAX_INPUT_FRAME_BYTES as u64,
                "{verb} schema maxLength drifted from WS_MAX_INPUT_FRAME_BYTES",
            );
        }
    }

    #[test]
    fn every_catalog_schema_is_in_the_enforced_subset() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        for tool in listed["tools"].as_array().expect("tools is an array") {
            let name = tool["name"].as_str().expect("tool has name");
            let violations = schema_subset_violations(&tool["inputSchema"]);
            assert!(
                violations.is_empty(),
                "{name} inputSchema uses unsupported features: {violations:?}"
            );
        }
    }

    #[test]
    fn event_catalog_schemas_expose_the_durable_consumer_contract() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let tools = listed["tools"].as_array().expect("tools is an array");
        let find = |name: &str| {
            tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(name))
                .unwrap_or_else(|| panic!("{name} is catalogued"))
        };
        let recent = find("aelyris.event.recent");
        assert_eq!(recent["inputSchema"]["additionalProperties"], false);
        assert!(recent["description"]
            .as_str()
            .unwrap()
            .contains("already-committed"));

        let since = find("aelyris.event.since");
        assert_eq!(since["inputSchema"]["properties"]["limit"]["maximum"], 1000);
        assert!(since["description"]
            .as_str()
            .unwrap()
            .contains("aelyris.event-bus.error/v1"));

        let poll = find("aelyris.event.poll");
        assert_eq!(
            poll["inputSchema"]["required"],
            serde_json::json!(["consumerId"])
        );
        assert!(poll["description"]
            .as_str()
            .unwrap()
            .contains("stream-bound"));

        let ack = find("aelyris.event.ack");
        assert_eq!(
            ack["inputSchema"]["required"],
            serde_json::json!(["consumerId", "seq", "eventId"])
        );
        assert_eq!(ack["inputSchema"]["properties"]["seq"]["minimum"], 1);
    }

    #[test]
    fn durable_event_consumer_poll_and_ack_use_at_least_once_identity() {
        use crate::pty::PtyManager;

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let db = test_db();
        let bus = Arc::new(crate::event_bus::EventBus::new_durable());
        bus.attach_db(db);
        let published = bus
            .publish(crate::event_bus::AgentEvent::new(
                crate::event_bus::AgentEventKind::TaskCreated,
                serde_json::json!({"id": "a"}),
            ))
            .unwrap();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_event_bus(bus);

        let Json(first) = rt
            .block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.event.poll".to_string(),
                    arguments: serde_json::json!({"consumerId": "mcp-worker", "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(first["result"]["deliveryContract"], "at_least_once");
        assert_eq!(first["result"]["events"][0]["eventId"], published.event_id);

        let Json(duplicate) = rt
            .block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.event.poll".to_string(),
                    arguments: serde_json::json!({"consumerId": "mcp-worker", "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(duplicate["result"]["events"], first["result"]["events"]);

        let _ = rt
            .block_on(tools_call(
                State(state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.event.ack".to_string(),
                    arguments: serde_json::json!({
                        "consumerId": "mcp-worker",
                        "seq": first["result"]["events"][0]["seq"],
                        "eventId": first["result"]["events"][0]["eventId"],
                    }),
                }),
            ))
            .unwrap();
        let Json(after_ack) = rt
            .block_on(tools_call(
                State(state),
                Json(ToolCallBody {
                    name: "aelyris.event.poll".to_string(),
                    arguments: serde_json::json!({"consumerId": "mcp-worker", "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(after_ack["result"]["events"], serde_json::json!([]));
    }

    #[test]
    fn mcp_event_ack_audit_is_principal_bound_and_identity_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let bus = Arc::new(EventBus::new_durable());
        bus.attach_db(db.clone());
        let first = bus
            .publish(
                AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    serde_json::json!({"secret": "AIO21_EVENT_PAYLOAD_A_MUST_NOT_BE_LOGGED"}),
                )
                .with_idempotency_key("AIO21_EVENT_ID_A_MUST_NOT_BE_LOGGED"),
            )
            .unwrap();
        let second = bus
            .publish(
                AgentEvent::new(
                    AgentEventKind::TaskCompleted,
                    serde_json::json!({"secret": "AIO21_EVENT_PAYLOAD_B_MUST_NOT_BE_LOGGED"}),
                )
                .with_idempotency_key("AIO21_EVENT_ID_B_MUST_NOT_BE_LOGGED"),
            )
            .unwrap();
        let first_seq = first.seq.expect("first event sequence");
        let second_seq = second.seq.expect("second event sequence");
        let first_event_id = first.event_id.clone();
        let second_event_id = second.event_id.clone();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_event_bus(bus.clone());
        let schema = input_schema_for_tool_ref("aelyris.event.ack").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "event-ack-operator",
                ToolCallBody {
                    name: "aelyris.event.ack".to_string(),
                    arguments,
                },
            ))
        };
        let consumer = "AIO21_CONSUMER_MUST_NOT_BE_LOGGED";

        let Json(first_ack) = call(
            &state,
            serde_json::json!({
                "consumerId": consumer,
                "seq": first_seq,
                "eventId": first_event_id,
            }),
        )
        .expect("advance first durable acknowledgement");
        assert_eq!(first_ack["result"]["ack"]["ackSeq"], first_seq);
        assert_eq!(first_ack["result"]["ack"]["alreadyAcked"], false);

        let Json(duplicate_ack) = call(
            &state,
            serde_json::json!({
                "consumerId": consumer,
                "seq": first_seq,
                "eventId": first_event_id,
            }),
        )
        .expect("identical acknowledgement is idempotent");
        assert_eq!(duplicate_ack["result"]["ack"]["alreadyAcked"], true);

        let wrong_event_id = "AIO21_WRONG_EVENT_ID_MUST_NOT_BE_LOGGED";
        let Json(mismatch) = call(
            &state,
            serde_json::json!({
                "consumerId": consumer,
                "seq": second_seq,
                "eventId": wrong_event_id,
            }),
        )
        .expect("identity mismatch remains a structured tool error");
        assert_eq!(mismatch["ok"], false);
        assert_eq!(
            mismatch["error"]["eventBusError"]["code"],
            "ack_identity_mismatch"
        );

        let Json(second_ack) = call(
            &state,
            serde_json::json!({
                "consumerId": consumer,
                "seq": second_seq,
                "eventId": second_event_id,
            }),
        )
        .expect("advance second durable acknowledgement");
        assert_eq!(second_ack["result"]["ack"]["ackSeq"], second_seq);
        assert_eq!(second_ack["result"]["ack"]["alreadyAcked"], false);

        let Json(regression) = call(
            &state,
            serde_json::json!({
                "consumerId": consumer,
                "seq": first_seq,
                "eventId": first_event_id,
            }),
        )
        .expect("regression remains a structured tool error");
        assert_eq!(regression["ok"], false);
        assert_eq!(
            regression["error"]["eventBusError"]["code"],
            "ack_regression"
        );

        let unavailable_consumer = "AIO21_UNAVAILABLE_CONSUMER_MUST_NOT_BE_LOGGED";
        let unavailable_event = "AIO21_UNAVAILABLE_EVENT_MUST_NOT_BE_LOGGED";
        let unavailable_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(db.clone()));
        let Json(unavailable) = call(
            &unavailable_state,
            serde_json::json!({
                "consumerId": unavailable_consumer,
                "seq": 1,
                "eventId": unavailable_event,
            }),
        )
        .expect("unavailable owner remains a structured tool error");
        assert_eq!(unavailable["ok"], false);
        assert_eq!(
            unavailable["error"]["eventBusError"]["code"],
            "durability_unavailable"
        );

        let empty = bus.poll_consumer(consumer, 10).unwrap();
        assert!(empty.events.is_empty());

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_event_ack_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read event acknowledgement audit");
        assert_eq!(rows.len(), 6);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("event-ack-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            3
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["cursorAdvanced"] == true)
                .count(),
            2
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["outcome"] == "already_acknowledged"
                && row.redacted_payload_json["alreadyAcknowledged"] == true
                && row.redacted_payload_json["cursorAdvanced"] == false
        }));
        for code in [
            "ack_identity_mismatch",
            "ack_regression",
            "durability_unavailable",
        ] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["rejectionCode"] == code));
        }
        let consumer_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["consumerDigest"]
                    .as_str()
                    .expect("consumer digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let event_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["eventDigest"]
                    .as_str()
                    .expect("event digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("event acknowledgement input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(consumer_digests.len(), 2);
        assert_eq!(event_digests.len(), 4);
        assert_eq!(input_digests.len(), 4);
        assert!(consumer_digests
            .iter()
            .chain(event_digests.iter())
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["deliveryValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                consumer,
                unavailable_consumer,
                unavailable_event,
                first_event_id.as_str(),
                second_event_id.as_str(),
                wrong_event_id,
                "AIO21_EVENT_ID_A_MUST_NOT_BE_LOGGED",
                "AIO21_EVENT_ID_B_MUST_NOT_BE_LOGGED",
                "AIO21_EVENT_PAYLOAD_A_MUST_NOT_BE_LOGGED",
                "AIO21_EVENT_PAYLOAD_B_MUST_NOT_BE_LOGGED",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let audit_failure_bus = Arc::new(EventBus::new_durable());
        audit_failure_bus.attach_db(audit_failure_db.clone());
        let audit_failure_event = audit_failure_bus
            .publish(
                AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    serde_json::json!({"safe": true}),
                )
                .with_idempotency_key("AIO21_AUDIT_FAILURE_EVENT_MUST_NOT_BE_LOGGED"),
            )
            .unwrap();
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio21_event_ack_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_event_ack_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated event ack audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state =
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_db(Some(audit_failure_db))
                .with_event_bus(audit_failure_bus.clone());
        let Json(audit_failure_ack) = call(
            &audit_failure_state,
            serde_json::json!({
                "consumerId": "AIO21_AUDIT_FAILURE_CONSUMER_MUST_NOT_BE_LOGGED",
                "seq": audit_failure_event.seq,
                "eventId": audit_failure_event.event_id,
            }),
        )
        .expect("audit failure does not fabricate a second acknowledgement result");
        assert_eq!(audit_failure_ack["ok"], true);
        assert_eq!(audit_failure_ack["result"]["ack"]["alreadyAcked"], false);
        assert!(audit_failure_bus
            .poll_consumer("AIO21_AUDIT_FAILURE_CONSUMER_MUST_NOT_BE_LOGGED", 10)
            .unwrap()
            .events
            .is_empty());
    }

    #[test]
    fn every_event_bus_error_variant_has_the_stable_structured_mcp_envelope() {
        use crate::event_bus::EventBusError;

        let variants = vec![
            EventBusError::DurabilityUnavailable,
            EventBusError::InvalidEventIdentity,
            EventBusError::InvalidConsumerIdentity,
            EventBusError::AppendFailed {
                event_id: "event".to_string(),
                message: "append".to_string(),
            },
            EventBusError::QueryFailed {
                operation: "poll".to_string(),
                message: "query".to_string(),
            },
            EventBusError::CorruptRow {
                seq: 1,
                field: "payload_json".to_string(),
                message: "corrupt".to_string(),
            },
            EventBusError::StreamInvariant {
                high_water_seq: 2,
                max_seq: Some(1),
                row_count: 1,
                message: "truncated".to_string(),
            },
            EventBusError::CursorOutOfRange {
                after_seq: 3,
                high_water_seq: 2,
            },
            EventBusError::ConsumerCursorCorrupt {
                consumer_id: "worker".to_string(),
                ack_seq: 3,
                ack_event_id: Some("event".to_string()),
                message: "future".to_string(),
            },
            EventBusError::Gap {
                expected_seq: 2,
                observed_seq: 3,
            },
            EventBusError::AckIdentityMismatch {
                seq: 1,
                expected_event_id: "event".to_string(),
                observed_event_id: "wrong".to_string(),
            },
            EventBusError::AckRegression {
                current_seq: 2,
                attempted_seq: 1,
            },
        ];
        for error in variants {
            let Json(value) = event_bus_error_response("aelyris.event.poll", error);
            assert_eq!(value["ok"], false);
            assert_eq!(value["error"]["schema"], "aelyris.event-bus.error/v1");
            assert_eq!(value["error"]["domain"], "event_bus");
            assert_eq!(value["error"]["deliveryContract"], "at_least_once");
            assert!(value["error"]["eventBusError"]["code"].is_string());
        }
    }

    #[test]
    fn event_tools_preserve_corruption_gap_query_and_ack_mismatch_structure() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");

        let (corrupt_state, corrupt_db, corrupt_bus) = event_test_state();
        corrupt_bus
            .publish(crate::event_bus::AgentEvent::new(
                crate::event_bus::AgentEventKind::TaskCreated,
                serde_json::json!({"id": "corrupt"}),
            ))
            .unwrap();
        corrupt_db
            .with(|db| {
                db.conn()
                    .execute_batch(
                        "DROP TRIGGER trg_agent_events_immutable;
                         UPDATE agent_events SET payload_json = '{' WHERE seq = 1;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let Json(corrupt) = rt
            .block_on(tools_call(
                State(corrupt_state),
                Json(ToolCallBody {
                    name: "aelyris.event.since".to_string(),
                    arguments: serde_json::json!({"afterSeq": 1, "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(corrupt["error"]["eventBusError"]["code"], "corrupt_row");

        let (gap_state, gap_db, gap_bus) = event_test_state();
        for id in ["first", "second"] {
            gap_bus
                .publish(
                    crate::event_bus::AgentEvent::new(
                        crate::event_bus::AgentEventKind::TaskCreated,
                        serde_json::json!({"id": id}),
                    )
                    .with_idempotency_key(id),
                )
                .unwrap();
        }
        gap_db
            .with(|db| {
                db.conn()
                    .execute_batch(
                        "DROP TRIGGER trg_agent_events_no_delete;
                         DELETE FROM agent_events WHERE seq = 2;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let Json(gap) = rt
            .block_on(tools_call(
                State(gap_state),
                Json(ToolCallBody {
                    name: "aelyris.event.since".to_string(),
                    arguments: serde_json::json!({"afterSeq": 1, "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(gap["error"]["eventBusError"]["code"], "gap");
        assert_eq!(gap["error"]["eventBusError"]["expected_seq"], 2);

        let (query_state, query_db, _) = event_test_state();
        query_db
            .with(|db| {
                db.conn()
                    .execute("DROP TABLE event_consumer_cursors", [])
                    .map(|_| ())
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let Json(query) = rt
            .block_on(tools_call(
                State(query_state),
                Json(ToolCallBody {
                    name: "aelyris.event.poll".to_string(),
                    arguments: serde_json::json!({"consumerId": "worker", "limit": 10}),
                }),
            ))
            .unwrap();
        assert_eq!(query["error"]["eventBusError"]["code"], "query_failed");

        let (ack_state, _, ack_bus) = event_test_state();
        ack_bus
            .publish(
                crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::TaskCreated,
                    serde_json::json!({"id": "ack"}),
                )
                .with_idempotency_key("correct-event"),
            )
            .unwrap();
        let _ = rt
            .block_on(tools_call(
                State(ack_state.clone()),
                Json(ToolCallBody {
                    name: "aelyris.event.poll".to_string(),
                    arguments: serde_json::json!({"consumerId": "worker", "limit": 10}),
                }),
            ))
            .unwrap();
        let Json(ack) = rt
            .block_on(tools_call(
                State(ack_state),
                Json(ToolCallBody {
                    name: "aelyris.event.ack".to_string(),
                    arguments: serde_json::json!({
                        "consumerId": "worker",
                        "seq": 1,
                        "eventId": "wrong-event",
                    }),
                }),
            ))
            .unwrap();
        assert_eq!(
            ack["error"]["eventBusError"]["code"],
            "ack_identity_mismatch"
        );
    }

    #[test]
    fn native_mcp_event_error_keeps_matching_text_and_structured_content() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let (state, db, bus) = event_test_state();
        for id in ["first", "second"] {
            bus.publish(
                crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::TaskCreated,
                    serde_json::json!({"id": id}),
                )
                .with_idempotency_key(id),
            )
            .unwrap();
        }
        db.with(|db| {
            db.conn()
                .execute_batch(
                    "DROP TRIGGER trg_agent_events_no_delete;
                     DELETE FROM agent_events WHERE seq = 2;",
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let response = rt.block_on(mcp_rpc(
            State(state),
            Json(JsonRpcReq {
                id: Some(serde_json::json!(1)),
                method: "tools/call".to_string(),
                params: serde_json::json!({
                    "name": "aelyris.event.since",
                    "arguments": {"afterSeq": 1, "limit": 10}
                }),
            }),
        ));
        let bytes = rt
            .block_on(axum::body::to_bytes(response.into_body(), usize::MAX))
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["result"]["isError"], true);
        assert_eq!(
            value["result"]["structuredContent"]["eventBusError"]["code"],
            "gap"
        );
        let text: serde_json::Value =
            serde_json::from_str(value["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(text, value["result"]["structuredContent"]);
    }

    #[test]
    fn malformed_tools_call_returns_structured_schema_violation() {
        use crate::pty::PtyManager;

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let body = ToolCallBody {
            name: "aelyris.task.transition".to_string(),
            arguments: serde_json::json!({ "id": 7, "extra": true }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("schema violations are MCP tool errors, not transport errors");

        assert_eq!(value["ok"], serde_json::json!(false));
        let violation = &value["error"]["schema_violation"];
        assert_eq!(violation["verb"], "aelyris.task.transition");
        assert_eq!(violation["missing"], serde_json::json!(["to"]));
        assert_eq!(violation["unknown"], serde_json::json!(["extra"]));
        assert_eq!(violation["wrong_type"][0]["field"], "id");
        assert_eq!(violation["wrong_type"][0]["expected"], "string");
        assert_eq!(violation["wrong_type"][0]["got"], "integer");
    }

    #[test]
    fn native_mcp_schema_violation_is_tool_error_result() {
        use crate::pty::PtyManager;

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let req = JsonRpcReq {
            id: Some(serde_json::json!(1)),
            method: "tools/call".to_string(),
            params: serde_json::json!({
                "name": "aelyris.task.transition",
                "arguments": { "id": 7 }
            }),
        };

        let response = rt.block_on(mcp_rpc(State(state), Json(req)));
        let bytes = rt
            .block_on(axum::body::to_bytes(response.into_body(), usize::MAX))
            .expect("body bytes");
        let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json response");

        assert!(value.get("error").is_none(), "{value}");
        assert_eq!(value["result"]["isError"], serde_json::json!(true));
        assert_eq!(
            value["result"]["structuredContent"]["schema_violation"]["verb"],
            "aelyris.task.transition"
        );
        assert_eq!(
            value["result"]["structuredContent"]["schema_violation"]["missing"],
            serde_json::json!(["to"])
        );
    }

    #[test]
    fn well_formed_tools_call_is_unaffected_by_schema_validation() {
        use crate::pty::PtyManager;

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let body = ToolCallBody {
            name: "terminal.list".to_string(),
            arguments: serde_json::json!({}),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("well-formed call still dispatches");

        assert_eq!(value["ok"], serde_json::json!(true));
        assert!(value["result"]["sessions"].is_array());
    }

    #[test]
    fn mcp_pending_queue_drops_oldest_at_cap_and_publishes_event() {
        use crate::event_bus::{EventBus, EventChannel};
        use crate::pty::PtyManager;

        let bus = Arc::new(EventBus::new());
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_event_bus(bus.clone());

        for idx in 0..=MAX_MCP_PENDING {
            push_pending(
                &state,
                McpPendingDecision {
                    id: format!("approval:{idx}"),
                    session_id: format!("session:{idx}"),
                    kind: "permission_required".to_string(),
                    title: "Approval requested".to_string(),
                    summary: None,
                    risk: "medium".to_string(),
                    status: "pending".to_string(),
                },
            )
            .expect("push pending");
        }

        let pending = state.mcp_pending.lock().expect("pending lock");
        assert_eq!(pending.len(), MAX_MCP_PENDING);
        assert_eq!(pending.first().unwrap().id, "approval:1");
        assert_eq!(
            pending.last().unwrap().id,
            format!("approval:{MAX_MCP_PENDING}")
        );
        drop(pending);

        let system_events = bus.by_channel(EventChannel::System);
        assert!(
            system_events.iter().any(|event| {
                event.kind == crate::event_bus::AgentEventKind::EscalationRaised
                    && event.payload["source"] == "mcp_pending"
                    && event.payload["reason"] == "queue_overflow"
                    && event.payload["droppedId"] == "approval:0"
            }),
            "overflow must be observable on the system event bus"
        );
    }

    /// P5 governance choke point: a denying policy blocks a verb with 403 BEFORE
    /// it dispatches, while the default allow-all policy passes it through. Binds
    /// the seam so enterprise policy is enforced without touching any handler.
    #[test]
    fn governance_denies_with_403_and_allows_by_default() {
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;
        use std::sync::Arc;

        struct DenyAll;
        impl AccessControl for DenyAll {
            fn authorize(&self, _actor: &str, verb: &str) -> AccessDecision {
                AccessDecision::Deny(format!("{verb} blocked"))
            }
        }

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let body = || ToolCallBody {
            name: "terminal.list".to_string(),
            arguments: serde_json::json!({}),
        };

        // Denying policy -> 403 Forbidden before the verb ever dispatches.
        let denied = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_governance(Arc::new(Governance::with_access(Box::new(DenyAll))));
        let result = rt.block_on(tools_call(State(denied), Json(body())));
        assert!(
            matches!(result, Err(ApiError::Forbidden(_))),
            "a denied verb must 403"
        );

        // Default (allow-all) lets the same verb run.
        let allowed = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let result = rt.block_on(tools_call(State(allowed), Json(body())));
        assert!(
            result.is_ok(),
            "default allow-all must pass the verb through"
        );
    }

    /// A denial is durably recorded to the audit journal — the enterprise audit
    /// trail of blocked verbs (binds the audit write path, not just the 403).
    #[test]
    fn denied_verb_is_durably_audited() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::governance::{AccessControl, AccessDecision, Governance};
        use crate::pty::PtyManager;
        use std::sync::Arc;

        struct DenyAll;
        impl AccessControl for DenyAll {
            fn authorize(&self, _actor: &str, verb: &str) -> AccessDecision {
                AccessDecision::Deny(format!("{verb} blocked"))
            }
        }

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_governance(Arc::new(Governance::with_access(Box::new(DenyAll))))
            .with_db(Some(db.clone()));
        let body = ToolCallBody {
            name: "aelyris.spawn_agent".to_string(),
            arguments: serde_json::json!({}),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        assert!(matches!(result, Err(ApiError::Forbidden(_))));

        let rows = db
            .with(|d| {
                d.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("access_denied".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "access_denied");
    }

    /// claim_from_diff derives diff-hunk claims from a worktree diff and records
    /// them in the LIVE symbol-ownership map (the map the dispatch gate + UI read) —
    /// the extractor's wiring, not just the pure parser.
    #[test]
    fn claim_from_diff_records_diffhunk_claims_in_live_map() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::{Confidence, SymbolOwnership};
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner.clone())
            .with_db(Some(db));
        let diff = "--- a/src/x.rs\n+++ b/src/x.rs\n@@ -1,1 +1,3 @@\n a\n+b\n+c\n";
        let body = ToolCallBody {
            name: "aelyris.symbol.claim_from_diff".to_string(),
            arguments: serde_json::json!({ "agentId": "agent-a", "taskId": "t1", "diff": diff }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("claim_from_diff ok");
        // Per-verb payload is wrapped under the `result` envelope key.
        assert_eq!(value["result"]["recorded"], serde_json::json!(1));

        let guard = owner.lock().unwrap();
        let claims = guard.live_claims(0);
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].path, "src/x.rs");
        assert_eq!(claims[0].agent_id, "agent-a");
        assert_eq!(claims[0].task_id.as_deref(), Some("t1"));
        assert_eq!(claims[0].confidence, Confidence::DiffHunk);
        assert_eq!(claims[0].range.start_line, 1);
        assert_eq!(claims[0].range.end_line, 3);
    }

    /// claim_from_source parses real source (tree-sitter) into Parser-confidence claims
    /// in the live map — the parser tier's wiring.
    #[test]
    fn claim_from_source_records_parser_claims_in_live_map() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::{Confidence, SymbolOwnership};
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner.clone())
            .with_db(Some(db));
        let source = "fn alpha() {\n    let _ = 1;\n}\n\nfn beta() {\n    let _ = 2;\n}\n";
        let body = ToolCallBody {
            name: "aelyris.symbol.claim_from_source".to_string(),
            arguments: serde_json::json!({ "agentId": "agent-a", "taskId": "t1", "path": "src/x.rs", "source": source }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("claim_from_source ok");
        assert_eq!(value["result"]["recorded"], serde_json::json!(2));
        assert_eq!(value["result"]["fallback"], serde_json::json!(false));

        let guard = owner.lock().unwrap();
        let claims = guard.live_claims(0);
        assert_eq!(claims.len(), 2);
        assert!(claims.iter().all(|c| c.confidence == Confidence::Parser));
        assert!(claims.iter().any(|c| c.symbol == "alpha"));
        assert!(claims.iter().any(|c| c.symbol == "beta"));
    }

    /// An unsupported language (or unparseable source) records NO claims and reports
    /// fallback:true — the file-level gate then applies (never a guessed Parser range).
    #[test]
    fn claim_from_source_unsupported_language_is_fallback_no_claims() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner.clone())
            .with_db(Some(db));
        let body = ToolCallBody {
            name: "aelyris.symbol.claim_from_source".to_string(),
            arguments: serde_json::json!({ "agentId": "a", "path": "notes.md", "source": "# hi" }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("claim_from_source ok");
        assert_eq!(value["result"]["fallback"], serde_json::json!(true));
        assert_eq!(value["result"]["recorded"], serde_json::json!(0));
        assert_eq!(owner.lock().unwrap().live_claims(0).len(), 0);
    }

    /// The `source` arg is read RAW (untrimmed): a symbol after blank lines keeps its
    /// real line number, and empty source is a graceful fallback (not a BadRequest).
    #[test]
    fn claim_from_source_preserves_line_numbers_and_allows_empty() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let db = test_db();
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner.clone())
            .with_db(Some(db.clone()));
        // Leading blank lines must NOT shift the range (raw, untrimmed source).
        let body = ToolCallBody {
            name: "aelyris.symbol.claim_from_source".to_string(),
            arguments: serde_json::json!({ "agentId": "a", "path": "src/x.rs", "source": "\n\nfn f() {\n}\n" }),
        };
        let Json(value) = rt
            .block_on(tools_call(State(state), Json(body)))
            .expect("claim_from_source ok");
        assert_eq!(value["result"]["recorded"], serde_json::json!(1));
        {
            let guard = owner.lock().unwrap();
            let claims = guard.live_claims(0);
            assert_eq!(claims[0].symbol, "f");
            assert_eq!(claims[0].range.start_line, 3); // not 1 — blank lines preserved
        }

        // Empty source -> fallback, no claims, NO error (reconciles f away too).
        let state2 = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner.clone())
            .with_db(Some(db));
        let body2 = ToolCallBody {
            name: "aelyris.symbol.claim_from_source".to_string(),
            arguments: serde_json::json!({ "agentId": "a", "path": "src/x.rs", "source": "" }),
        };
        let Json(v2) = rt
            .block_on(tools_call(State(state2), Json(body2)))
            .expect("empty source ok");
        assert_eq!(v2["result"]["fallback"], serde_json::json!(true));
        assert_eq!(v2["result"]["recorded"], serde_json::json!(0));
        assert_eq!(owner.lock().unwrap().live_claims(0).len(), 0);
    }

    /// Cross-verb coherence (final Codex review): claim_from_source's reconcile must
    /// NOT erase the same agent's diff-hunk or hand-made claims on the same file — it
    /// sweeps only its OWN parser-derived (`parse:`-prefixed) claims.
    #[test]
    fn claim_from_source_reconcile_keeps_diff_and_manual_claims() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let db = test_db();
        let mk_state = || {
            ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
                .with_symbol_ownership(owner.clone())
                .with_db(Some(db.clone()))
        };

        // 1. A diff-hunk claim on src/x.rs (an import-region edit the parser won't model).
        let diff = "--- a/src/x.rs\n+++ b/src/x.rs\n@@ -1,1 +1,2 @@\n use a;\n+use b;\n";
        let dbody = ToolCallBody {
            name: "aelyris.symbol.claim_from_diff".to_string(),
            arguments: serde_json::json!({ "agentId": "a", "diff": diff }),
        };
        let Json(_) = rt
            .block_on(tools_call(State(mk_state()), Json(dbody)))
            .expect("diff ok");

        // 2. A hand-made claim (even at parser confidence) on the same file.
        let mbody = ToolCallBody {
            name: "aelyris.symbol.claim".to_string(),
            arguments: serde_json::json!({ "claimId": "manual-1", "agentId": "a", "path": "src/x.rs",
                "symbol": "hand", "startLine": 90, "endLine": 95, "mode": "write", "confidence": "parser" }),
        };
        let Json(_) = rt
            .block_on(tools_call(State(mk_state()), Json(mbody)))
            .expect("manual ok");

        // 3. Parse the source -> reconciles ONLY parse: claims; diff + manual survive.
        let src = "fn alpha() {\n    let _ = 1;\n}\n";
        let sbody = ToolCallBody {
            name: "aelyris.symbol.claim_from_source".to_string(),
            arguments: serde_json::json!({ "agentId": "a", "path": "src/x.rs", "source": src }),
        };
        let Json(_) = rt
            .block_on(tools_call(State(mk_state()), Json(sbody)))
            .expect("source ok");

        let guard = owner.lock().unwrap();
        let ids: Vec<String> = guard
            .live_claims(0)
            .iter()
            .map(|c| c.claim_id.clone())
            .collect();
        assert!(
            ids.iter().any(|i| i.starts_with("dh:a:src/x.rs:")),
            "diff claim must survive source reconcile: {ids:?}"
        );
        assert!(
            ids.iter().any(|i| i == "manual-1"),
            "manual claim must survive source reconcile: {ids:?}"
        );
        assert!(
            ids.iter()
                .any(|i| i.starts_with("parse:a:src/x.rs:") && i.contains("alpha")),
            "parser claim must be recorded: {ids:?}"
        );
    }

    /// A manual claim cannot squat on the reserved `parse:`/`dh:` id prefixes — that
    /// would let the extractor reconcile sweep a hand-made claim.
    #[test]
    fn manual_claim_rejects_reserved_id_prefix() {
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let owner = Arc::new(Mutex::new(SymbolOwnership::new()));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_symbol_ownership(owner);
        let body = ToolCallBody {
            name: "aelyris.symbol.claim".to_string(),
            arguments: serde_json::json!({ "claimId": "parse:a:src/x.rs:foo@1-3", "agentId": "a",
                "path": "src/x.rs", "symbol": "foo", "startLine": 1, "endLine": 3,
                "mode": "write", "confidence": "parser" }),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    /// A6.3 hard boundary: Task.symbols are minted ONLY by verified enrichment, never by
    /// a caller (a caller-supplied Confidence::Parser would falsely unlock same-file
    /// parallelism). The task.create contract must not advertise OR accept a `symbols`
    /// field — `additionalProperties:false` rejects it at the schema, and the handler
    /// rejects it explicitly.
    #[test]
    fn task_create_does_not_expose_or_accept_caller_symbols() {
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let create = listed["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .find(|t| t["name"] == "aelyris.task.create")
            .expect("task.create present");
        assert!(
            create["inputSchema"]["properties"].get("symbols").is_none(),
            "task.create must not expose a symbols field"
        );
        assert_eq!(
            create["inputSchema"]["additionalProperties"],
            serde_json::json!(false),
            "task.create must reject unknown fields (so a caller-supplied symbols is denied)"
        );
    }

    /// A6.4: a typed steer to a DEAD/unknown agent session is an ERROR, not a silent
    /// no-op (it would otherwise look delivered but reach nobody).
    #[test]
    fn steer_avoid_errors_when_the_target_session_is_missing() {
        use crate::agent::AgentManager;
        use crate::pty::PtyManager;
        use crate::symbol_ownership::SymbolOwnership;
        use std::sync::{Arc, Mutex};

        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_agent_manager(AgentManager::new())
            .with_symbol_ownership(Arc::new(Mutex::new(SymbolOwnership::new())));
        let body = ToolCallBody {
            name: "aelyris.agent.steer_avoid".to_string(),
            arguments: serde_json::json!({ "sessionId": "ghost", "files": ["src/x.rs"] }),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        assert!(matches!(result, Err(ApiError::NotFound(_))), "{result:?}");
    }

    /// GMV-1 hard boundary: the legacy generic MCP request/approve verbs remain
    /// cataloged only to return a clear compatibility error. Neither call may
    /// create, claim, or merge a durable intent.
    #[test]
    fn raw_merge_request_and_approval_are_retired_without_mutation() {
        use crate::db::{Database, ManagedDb};
        use crate::merge_intent::store::MergeIntentStore;
        use crate::pty::PtyManager;
        use std::sync::Arc;

        let store = Arc::new(MergeIntentStore::new(Arc::new(ManagedDb::new(
            Database::open_memory().unwrap(),
        ))));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_merge_store(Some(store.clone()));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, args: serde_json::Value| {
            let body = ToolCallBody {
                name: name.to_string(),
                arguments: args,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
        };

        for (name, args) in [
            (
                "aelyris.request_merge",
                serde_json::json!({
                    "taskId": "task-1",
                    "repoPath": "C:/repo",
                    "sourceBranch": "feature",
                    "targetBranch": "main"
                }),
            ),
            (
                "aelyris.review.approve",
                serde_json::json!({ "intentId": "merge:ghost" }),
            ),
        ] {
            let error = call(name, args).expect_err("retired merge authority must fail closed");
            assert!(
                matches!(error, ApiError::BadRequest(ref message) if message.contains("retired")),
                "{error:?}"
            );
        }
        assert!(store.list_unresolved().unwrap().is_empty());
    }

    /// P0-3 inc6: `aelyris.review.reject` is a durable, store-backed transition, and
    /// `aelyris.list_pending_approvals` synthesizes its merge view from the store
    /// (not mcp_pending) — a rejected intent leaves the unresolved view.
    #[test]
    fn review_reject_is_durable_and_pending_view_comes_from_the_store() {
        use crate::db::{Database, ManagedDb};
        use crate::merge_intent::{store::MergeIntentStore, MergeIntentState};
        use crate::pty::PtyManager;
        use git2::{build::CheckoutBuilder, Repository};
        use std::path::Path;
        use std::sync::Arc;

        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        let commit = |file: &str, content: &str, parents: &[git2::Oid]| -> git2::Oid {
            let wd = repo.workdir().unwrap().to_path_buf();
            std::fs::write(wd.join(file), content).unwrap();
            let mut idx = repo.index().unwrap();
            idx.add_path(Path::new(file)).unwrap();
            idx.write().unwrap();
            let tree = repo.find_tree(idx.write_tree().unwrap()).unwrap();
            let sig = git2::Signature::now("T", "t@t").unwrap();
            let pcs: Vec<git2::Commit> = parents
                .iter()
                .map(|o| repo.find_commit(*o).unwrap())
                .collect();
            let prefs: Vec<&git2::Commit> = pcs.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, "c", &tree, &prefs)
                .unwrap()
        };
        let base = commit("a.txt", "base", &[]);
        repo.branch("feature", &repo.find_commit(base).unwrap(), false)
            .unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
        commit("b.txt", "feat", &[base]);
        repo.set_head("refs/heads/main").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();

        let store = Arc::new(MergeIntentStore::new(Arc::new(ManagedDb::new(
            Database::open_memory().unwrap(),
        ))));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_merge_store(Some(store.clone()));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, args: serde_json::Value| {
            let body = ToolCallBody {
                name: name.to_string(),
                arguments: args,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
        };

        let intent = crate::control::merge::request_durable_intent(
            &store, &repo_path, "task-1", None, "feature", "main", 1,
        )
        .unwrap();
        let intent_id = intent.intent_id;

        // The pending view comes from the store and shows the queued intent.
        let Json(view) =
            call("aelyris.list_pending_approvals", serde_json::json!({})).expect("list ok");
        let intents = view["result"]["mergeIntents"].as_array().unwrap();
        assert_eq!(intents.len(), 1);
        assert_eq!(intents[0]["intentId"].as_str().unwrap(), intent_id);

        // reject rejects the unknown field and the non-string reason.
        let Json(bad_unknown) = call(
            "aelyris.review.reject",
            serde_json::json!({ "intentId": intent_id, "evil": 1 }),
        )
        .expect("unknown field rejected as a structured schema violation");
        assert_eq!(bad_unknown["ok"], serde_json::json!(false));
        assert_eq!(
            bad_unknown["error"]["schema_violation"]["unknown"],
            serde_json::json!(["evil"])
        );
        let Json(bad_reason) = call(
            "aelyris.review.reject",
            serde_json::json!({ "intentId": intent_id, "reason": 5 }),
        )
        .expect("non-string reason rejected as a structured schema violation");
        assert_eq!(bad_reason["ok"], serde_json::json!(false));
        assert_eq!(
            bad_reason["error"]["schema_violation"]["wrong_type"][0]["field"],
            "reason"
        );

        // A real reject durably transitions the intent.
        let Json(rej) = call(
            "aelyris.review.reject",
            serde_json::json!({ "intentId": intent_id, "reason": "not needed" }),
        )
        .expect("reject ok");
        assert_eq!(rej["result"]["status"], "rejected");
        assert_eq!(
            store.get(&intent_id).unwrap().unwrap().state,
            MergeIntentState::Rejected
        );

        // It is gone from the unresolved view, and cannot be rejected again.
        let Json(view2) =
            call("aelyris.list_pending_approvals", serde_json::json!({})).expect("list ok");
        assert!(view2["result"]["mergeIntents"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(matches!(
            call(
                "aelyris.review.reject",
                serde_json::json!({ "intentId": intent_id })
            )
            .unwrap_err(),
            ApiError::BadRequest(_)
        ));
        // An unknown id is NotFound.
        assert!(matches!(
            call(
                "aelyris.review.reject",
                serde_json::json!({ "intentId": "ghost" })
            )
            .unwrap_err(),
            ApiError::NotFound(_)
        ));
    }

    #[test]
    fn mcp_review_rejection_audit_is_principal_bound_and_target_free() {
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::merge_intent::{store::MergeIntentStore, MergeIntent, MergeIntentState};
        use crate::pty::PtyManager;

        fn intent(id: &str, suffix: &str, state: MergeIntentState) -> MergeIntent {
            MergeIntent {
                intent_id: id.to_string(),
                repo_path: format!("C:/AIO24_REPOSITORY_{suffix}_MUST_NOT_BE_LOGGED"),
                source_branch: format!("AIO24_SOURCE_BRANCH_{suffix}_MUST_NOT_BE_LOGGED"),
                target_branch: format!("AIO24_TARGET_BRANCH_{suffix}_MUST_NOT_BE_LOGGED"),
                source_oid: format!("AIO24_SOURCE_OID_{suffix}_MUST_NOT_BE_LOGGED"),
                target_oid: format!("AIO24_TARGET_OID_{suffix}_MUST_NOT_BE_LOGGED"),
                merge_base_oid: Some(format!("AIO24_MERGE_BASE_{suffix}_MUST_NOT_BE_LOGGED")),
                task_id: format!("AIO24_TASK_{suffix}_MUST_NOT_BE_LOGGED"),
                created_at: 1,
                state,
                updated_at: 1,
                session_id: Some(format!("AIO24_SESSION_{suffix}_MUST_NOT_BE_LOGGED")),
                reviewer_id: None,
                gates_digest: None,
            }
        }

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let store = Arc::new(MergeIntentStore::new(db.clone()));
        let state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("AIO24_PUBLIC_TOKEN_MUST_NOT_BE_LOGGED"),
        )
        .with_db(Some(db.clone()))
        .with_merge_store(Some(store.clone()));
        let schema = input_schema_for_tool_ref("aelyris.review.reject").unwrap();
        assert!(schema["properties"].get("actor").is_none());

        let queued_id = "AIO24_QUEUED_INTENT_MUST_NOT_BE_LOGGED";
        let merging_id = "AIO24_MERGING_INTENT_MUST_NOT_BE_LOGGED";
        let persistence_id = "AIO24_PERSISTENCE_INTENT_MUST_NOT_BE_LOGGED";
        store
            .create_or_get(&intent(queued_id, "QUEUED", MergeIntentState::Queued))
            .unwrap();
        store
            .create_or_get(&intent(merging_id, "MERGING", MergeIntentState::Merging))
            .unwrap();
        store
            .create_or_get(&intent(
                persistence_id,
                "PERSISTENCE",
                MergeIntentState::Queued,
            ))
            .unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |state: &ApiState, arguments: serde_json::Value| {
            rt.block_on(tools_call_as_actor(
                state,
                "review-rejection-operator",
                ToolCallBody {
                    name: "aelyris.review.reject".to_string(),
                    arguments,
                },
            ))
        };
        let reason = "AIO24_REJECTION_REASON_MUST_NOT_BE_LOGGED";
        let Json(rejected) = call(
            &state,
            serde_json::json!({ "intentId": queued_id, "reason": reason }),
        )
        .expect("queued intent rejects durably");
        assert_eq!(rejected["result"]["status"], "rejected");
        assert_eq!(rejected["result"]["reason"], reason);
        assert_eq!(
            store.get(queued_id).unwrap().unwrap().state,
            MergeIntentState::Rejected
        );

        assert!(matches!(
            call(&state, serde_json::json!({ "intentId": queued_id })),
            Err(ApiError::BadRequest(message)) if message.contains("already resolved")
        ));
        assert!(matches!(
            call(&state, serde_json::json!({ "intentId": merging_id })),
            Err(ApiError::BadRequest(message)) if message.contains("merging")
        ));

        let unknown_id = "AIO24_UNKNOWN_INTENT_MUST_NOT_BE_LOGGED";
        assert!(matches!(
            call(&state, serde_json::json!({ "intentId": unknown_id })),
            Err(ApiError::NotFound(id)) if id == unknown_id
        ));

        db.with(|database| {
            database
                .conn()
                .execute_batch(&format!(
                    "CREATE TRIGGER reject_aio24_merge_update\n\
                     BEFORE UPDATE ON merge_intents\n\
                     WHEN OLD.intent_id = '{persistence_id}' AND NEW.state = 'rejected'\n\
                     BEGIN\n\
                         SELECT RAISE(ABORT, 'simulated review rejection persistence failure');\n\
                     END;"
                ))
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            call(
                &state,
                serde_json::json!({ "intentId": persistence_id })
            ),
            Err(ApiError::Internal(message))
                if message.contains("simulated review rejection persistence failure")
        ));
        assert_eq!(
            store.get(persistence_id).unwrap().unwrap().state,
            MergeIntentState::Queued
        );

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_review_rejection_authority".to_string()),
                    limit: Some(20),
                    ..Default::default()
                })
            })
            .expect("read review rejection audit");
        assert_eq!(rows.len(), 5);
        assert!(rows.iter().all(|row| row.session_id.is_none()));
        assert!(rows.iter().all(|row| row.task_id.is_none()));
        assert!(rows.iter().all(|row| row.terminal_id.is_none()));
        assert!(rows
            .iter()
            .all(|row| row.agent_id.as_deref() == Some("review-rejection-operator")));
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "accepted")
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.redacted_payload_json["status"] == "rejected")
                .count(),
            4
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["initialState"] == "queued"
                && row.redacted_payload_json["resultingState"] == "rejected"
                && row.redacted_payload_json["transitionApplied"] == true
        }));
        assert_eq!(
            rows.iter()
                .filter(|row| {
                    row.redacted_payload_json["rejectionCode"] == "intent_not_rejectable"
                })
                .count(),
            2
        );
        for code in ["intent_not_found", "review_rejection_persistence_failed"] {
            assert!(rows
                .iter()
                .any(|row| row.redacted_payload_json["rejectionCode"] == code));
        }
        let intent_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["intentDigest"]
                    .as_str()
                    .expect("intent digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        let input_digests = rows
            .iter()
            .map(|row| {
                row.redacted_payload_json["inputDigest"]
                    .as_str()
                    .expect("review input digest")
            })
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(intent_digests.len(), 4);
        assert_eq!(input_digests.len(), 5);
        assert!(intent_digests
            .iter()
            .chain(input_digests.iter())
            .all(|digest| {
                digest.len() == 64
                    && digest
                        .chars()
                        .all(|character| character.is_ascii_hexdigit())
            }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["reviewValuesLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            for hidden in [
                queued_id,
                merging_id,
                persistence_id,
                unknown_id,
                reason,
                "AIO24_REPOSITORY_",
                "AIO24_SOURCE_BRANCH_",
                "AIO24_TARGET_BRANCH_",
                "AIO24_SOURCE_OID_",
                "AIO24_TARGET_OID_",
                "AIO24_MERGE_BASE_",
                "AIO24_TASK_",
                "AIO24_SESSION_",
            ] {
                assert!(!audit_text.contains(hidden), "audit exposed {hidden}");
            }
        }

        let audit_failure_db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let audit_failure_store = Arc::new(MergeIntentStore::new(audit_failure_db.clone()));
        let audit_failure_id = "AIO24_AUDIT_FAILURE_INTENT_MUST_NOT_BE_LOGGED";
        audit_failure_store
            .create_or_get(&intent(
                audit_failure_id,
                "AUDIT_FAILURE",
                MergeIntentState::Queued,
            ))
            .unwrap();
        audit_failure_db
            .with(|database| {
                database
                    .conn()
                    .execute_batch(
                        "CREATE TRIGGER reject_aio24_review_audit\n\
                         BEFORE INSERT ON audit_event_journal\n\
                         WHEN NEW.kind = 'mcp_review_rejection_authority'\n\
                         BEGIN\n\
                             SELECT RAISE(ABORT, 'simulated review audit failure');\n\
                         END;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let audit_failure_state = ApiState::new(
            PtyManager::new(),
            crate::api::AuthConfig::with_token("public-audit-failure"),
        )
        .with_db(Some(audit_failure_db))
        .with_merge_store(Some(audit_failure_store.clone()));
        let Json(audit_failure_result) = call(
            &audit_failure_state,
            serde_json::json!({ "intentId": audit_failure_id }),
        )
        .expect("audit failure does not create another review transition");
        assert_eq!(audit_failure_result["result"]["status"], "rejected");
        assert_eq!(
            audit_failure_store
                .get(audit_failure_id)
                .unwrap()
                .unwrap()
                .state,
            MergeIntentState::Rejected
        );
    }

    /// P0-4 inc3: the MCP agent-injection write path (`aelyris.pane_send_input`) is gated by
    /// the command-risk policy — a destructive command is refused (catastrophic) and a
    /// review command is refused without an approval id, BOTH before any byte reaches a PTY.
    #[test]
    fn mcp_pane_input_honors_principal_bound_controller_lease_and_payload_free_audit() {
        use crate::command_risk::gate::CommandRiskGate;
        use crate::db::{AuditJournalFilter, Database, ManagedDb};
        use crate::pty::PtyManager;

        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let gate = Arc::new(CommandRiskGate::new(Some(db.clone())));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_db(Some(db.clone()))
            .with_command_risk_gate(Some(gate));
        state
            .controller_leases
            .acquire("term-1", "client-a", "controller-agent")
            .unwrap();

        let schema = input_schema_for_tool_ref("aelyris.pane_send_input").unwrap();
        let properties = schema["properties"].as_object().unwrap();
        assert!(properties.contains_key("clientId"));
        assert!(!properties.contains_key("actor"));

        const RAW_INPUT: &str = "git commit -m AIO9_RAW_INPUT_MUST_NOT_BE_LOGGED\r";
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |actor: &str, client_id: Option<&str>| {
            let mut arguments = serde_json::json!({
                "terminalId": "term-1",
                "text": RAW_INPUT,
            });
            if let Some(client_id) = client_id {
                arguments["clientId"] = serde_json::Value::String(client_id.to_string());
            }
            rt.block_on(tools_call_as_actor(
                &state,
                actor,
                ToolCallBody {
                    name: "aelyris.pane_send_input".to_string(),
                    arguments,
                },
            ))
        };

        assert!(matches!(
            call("other-agent", Some("client-a")),
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            call("controller-agent", None),
            Err(ApiError::Conflict(_))
        ));

        let Json(review) = call("controller-agent", Some("client-a"))
            .expect("matching Principal and clientId reach command-risk authority");
        assert_eq!(review["ok"], false);
        assert_eq!(
            review["error"]["terminalWriteNack"]["code"],
            "command_approval_required"
        );

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_pane_input_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read MCP pane input audit");
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows.iter()
                .filter(|row| row.agent_id.as_deref() == Some("controller-agent"))
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.agent_id.as_deref() == Some("other-agent"))
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| {
                    row.redacted_payload_json["rejectionCode"] == "controller_lease_conflict"
                })
                .count(),
            2
        );
        assert!(rows.iter().any(|row| {
            row.redacted_payload_json["rejectionCode"] == "command_approval_required"
                && row.redacted_payload_json["clientIdPresent"] == true
        }));
        for row in &rows {
            assert_eq!(row.redacted_payload_json["payloadLogged"], false);
            let audit_text = serde_json::to_string(row).unwrap();
            assert!(!audit_text.contains("AIO9_RAW_INPUT_MUST_NOT_BE_LOGGED"));
            assert!(!audit_text.contains("client-a"));
        }
    }

    #[test]
    fn pane_send_input_is_gated_by_the_command_risk_policy() {
        use crate::command_risk::gate::CommandRiskGate;
        use crate::db::{Database, ManagedDb};
        use crate::pty::PtyManager;
        use std::sync::Arc;

        let gate = Arc::new(CommandRiskGate::new(Some(Arc::new(ManagedDb::new(
            Database::open_memory().unwrap(),
        )))));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_command_risk_gate(Some(gate));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |text: &str| {
            let body = ToolCallBody {
                name: "aelyris.pane_send_input".to_string(),
                arguments: serde_json::json!({ "terminalId": "term-1", "text": text }),
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
        };

        // A destructive command is refused (catastrophic) before the PTY write.
        let denied = call("rm -rf /tmp/x\r").unwrap();
        assert_eq!(denied.0["ok"], false);
        assert_eq!(
            denied.0["error"]["terminalWriteNack"]["code"],
            "command_denied"
        );
        // A review command without an approval id is refused (not catastrophic).
        let review = call("git commit -m x\r").unwrap();
        assert_eq!(review.0["ok"], false);
        assert_eq!(
            review.0["error"]["terminalWriteNack"]["code"],
            "command_approval_required"
        );
    }
}
