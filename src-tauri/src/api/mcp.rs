use axum::{extract::State, Extension, Json};
use serde::Deserialize;

mod catalog;
mod dispatch;

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
        super::audit_access_denied(&state, actor, &body.name, &reason);
        return Err(ApiError::Forbidden(format!(
            "verb `{}` is not permitted",
            body.name
        )));
    }
    if let Some(schema) = input_schema_for_tool(&body.name) {
        if let Err(report) = validate_tool_arguments(&body.name, &arguments, &schema) {
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

const MCP_INSTRUCTIONS: &str = "Aelyris is an autonomous build runtime you (the orchestrator) drive via these aelyris.* tools; the worker agents (real claude/codex/gemini CLIs in isolated worktrees) do the implementation. Loop: (1) context.set the project decisions/ADR (injected into every dispatched agent). (2) task.create one per subtask with owner=<implementer identity>, model=<claude|codex|gemini> (optional CLI routing; defaults to owner), sourceBranch/targetBranch, dependencies, outputs=<file lanes>; check ownership.conflicts. (3) worktree.create each branch. (4) Call orchestrator.step repeatedly with {repoPath, activeAgents}: finished agents move to Review, failed agents recover within bounded budgets, and ready tasks spawn; this tool never accepts review verdicts and never merges. (5) Generic MCP orchestration intentionally stops at Review: aelyris.request_merge and aelyris.review.approve are retired and cannot bypass exact-candidate gates. Use the cockpit backend-owned review-and-merge action or the typed Mission acceptance path for integration. (6) Coordinate between steps via event.recent / agent.activity, knowledge.impact, intent.propose/list, ownership.conflicts, and blocker_raised. Local-only; concurrency cap 4.";
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

    const FROZEN_A64_VERBS: [&str; 86] = [
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
            "catalog changed from the frozen 83-verb contract"
        );
        assert_eq!(catalog, schemas, "catalog and schema order/set drifted");
        assert!(
            verb_inventory_is_exact(&dispatch),
            "sole dispatcher changed from the frozen 83-verb contract"
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
    fn approval_resolve_mcp_schema_and_tool_error_contract() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("t"),
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
