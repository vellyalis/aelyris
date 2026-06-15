use axum::{extract::State, Json};
use serde::Deserialize;

use super::mux::{send_workspace_input, workspace_summary};
use super::{ApiError, ApiResult, ApiState, McpPendingDecision, WS_MAX_INPUT_FRAME_BYTES};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolCallBody {
    name: String,
    #[serde(default)]
    arguments: serde_json::Value,
}

fn tool_names() -> Vec<&'static str> {
    vec![
        "terminal.list",
        "terminal.capture",
        "mux.workspaces.list",
        "mux.workspace.get",
        "mux.workspace.safeInput",
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
    ]
}

fn arg_string(args: &serde_json::Map<String, serde_json::Value>, key: &str) -> ApiResult<String> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` is required")))
}

fn arg_usize(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    default: usize,
) -> ApiResult<usize> {
    let Some(value) = args.get(key) else {
        return Ok(default);
    };
    let Some(value) = value.as_u64() else {
        return Err(ApiError::BadRequest(format!(
            "MCP argument `{key}` must be an integer"
        )));
    };
    usize::try_from(value)
        .map_err(|_| ApiError::BadRequest(format!("MCP argument `{key}` is too large")))
}

fn arg_bool(args: &serde_json::Map<String, serde_json::Value>, key: &str, default: bool) -> bool {
    args.get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

fn arg_optional_string(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn arg_optional_string_array(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<Vec<String>>> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    let array = value
        .as_array()
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` must be an array")))?;
    let items = array
        .iter()
        .map(|item| {
            item.as_str().map(str::to_owned).ok_or_else(|| {
                ApiError::BadRequest(format!("MCP argument `{key}` must be strings"))
            })
        })
        .collect::<ApiResult<Vec<String>>>()?;
    Ok(Some(items))
}

fn arg_optional_f64(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<f64>> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    value
        .as_f64()
        .map(Some)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` must be a number")))
}

fn push_pending(state: &ApiState, item: McpPendingDecision) -> ApiResult<McpPendingDecision> {
    let mut pending = state
        .mcp_pending
        .lock()
        .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?;
    pending.push(item.clone());
    Ok(item)
}

pub(super) async fn contract(State(state): State<ApiState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "aether.mcp.server.v1",
        "server": "aether-terminal",
        "transport": "local-http-json",
        "auth": "bearer-token",
        "instanceId": state.instance_id,
        "processKind": state.process_kind,
        "tools": tool_names(),
        "nativeOwnedContracts": [
            "aether.mcp.server.v1",
            "aether.workspace.data.v1",
            "aether.mode-preservation.v1",
            "aether.history.search.v1",
            "aether.agent-identity.v1"
        ],
        "claims": {
            "sessionTruthSource": "rust-pty-manager",
            "muxTruthSource": "rust-mux-manager",
            "webviewRequiredForToolCalls": false,
            "reactRequiredForToolCalls": false
        }
    }))
}

pub(super) async fn tools_list() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "aether.mcp.server.v1",
        "server": "aether-terminal",
        "tools": [
            {
                "name": "terminal.list",
                "description": "List live native PTY sessions.",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "terminal.capture",
                "description": "Capture bounded scrollback from a live native PTY session.",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "lines": { "type": "integer", "minimum": 1, "maximum": 10000 },
                        "clean": { "type": "boolean" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "mux.workspaces.list",
                "description": "List Rust mux workspaces and pane counts.",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "mux.workspace.get",
                "description": "Return the Rust-owned mux graph for one workspace.",
                "inputSchema": {
                    "type": "object",
                    "required": ["workspaceId"],
                    "properties": { "workspaceId": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "mux.workspace.safeInput",
                "description": "Send bounded input to all live panes in a mux workspace.",
                "inputSchema": {
                    "type": "object",
                    "required": ["workspaceId", "text"],
                    "properties": {
                        "workspaceId": { "type": "string" },
                        "text": { "type": "string", "maxLength": 1048576 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.worktree.validate",
                "description": "Validate an orchestrator worktree branch name.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["branchName"],
                    "properties": { "branchName": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.worktree.predictPath",
                "description": "Predict the isolated worktree path for a branch.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath", "branchName"],
                    "properties": {
                        "repoPath": { "type": "string" },
                        "branchName": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.worktree.list",
                "description": "List git worktrees for a repository.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath"],
                    "properties": { "repoPath": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.worktree.create",
                "description": "Create an isolated agent worktree.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath", "branchName"],
                    "properties": {
                        "repoPath": { "type": "string" },
                        "branchName": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.worktree.remove",
                "description": "Remove an isolated agent worktree.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath", "worktreeName"],
                    "properties": {
                        "repoPath": { "type": "string" },
                        "worktreeName": { "type": "string" },
                        "deleteBranch": { "type": "boolean" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.fleet_status",
                "description": "Read the unified native-owned agent fleet snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.route_agent",
                "description": "Route a prompt to the recommended coding model profile.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["prompt"],
                    "properties": {
                        "prompt": { "type": "string" },
                        "budgetRemaining": { "type": "number" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.pane_send_input",
                "description": "Send bounded input to a live pane/terminal id.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["terminalId", "text"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "text": { "type": "string", "maxLength": 1048576 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.agent_diff",
                "description": "Read an agent-owned GhostDiff layer without mutating files.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "path": { "type": "string" },
                        "against": { "type": "string", "enum": ["base", "target"] },
                        "targetBranch": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.request_approval",
                "description": "Request policy/human approval for a held agent tool call. This never grants approval.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId", "tool"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "tool": { "type": "string" },
                        "summary": { "type": "string" },
                        "risk": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.list_pending_approvals",
                "description": "Observe pending approval and merge requests. This cannot resolve them.",
                "safety": "GATED_OBSERVE_ONLY",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.request_merge",
                "description": "Queue a gated merge request. This never merges to main.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId", "sourceBranch", "targetBranch"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "sourceBranch": { "type": "string" },
                        "targetBranch": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.spawn_agent",
                "description": "Spawn a headless implementer agent. Enforces the live cost cap (BR7); refuses when the fleet is at the agent cap.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["prompt", "cwd"],
                    "properties": {
                        "prompt": { "type": "string" },
                        "cwd": { "type": "string" },
                        "model": { "type": "string" },
                        "allowedTools": { "type": "array", "items": { "type": "string" } },
                        "resumeId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.stop_agent",
                "description": "Stop a running headless agent session by id.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId"],
                    "properties": { "sessionId": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.review.approve",
                "description": "Reviewer authority: approve a queued merge intent and perform the real git merge (fast-forward/3-way) into the target branch. The AI reviewer is the gate — there is no human gate in the critical path.",
                "safety": "REVIEWER_AUTHORITY",
                "inputSchema": {
                    "type": "object",
                    "required": ["intentId", "repoPath", "sourceBranch", "targetBranch"],
                    "properties": {
                        "intentId": { "type": "string" },
                        "repoPath": { "type": "string" },
                        "sourceBranch": { "type": "string" },
                        "targetBranch": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.review.reject",
                "description": "Reviewer authority: reject a queued merge intent. Resolves the intent without merging.",
                "safety": "REVIEWER_AUTHORITY",
                "inputSchema": {
                    "type": "object",
                    "required": ["intentId"],
                    "properties": {
                        "intentId": { "type": "string" },
                        "reason": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            }
        ]
    }))
}

pub(super) async fn tools_call(
    State(state): State<ApiState>,
    Json(body): Json<ToolCallBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let args = body.arguments.as_object().cloned().unwrap_or_default();
    let result = match body.name.as_str() {
        "terminal.list" => serde_json::json!({
            "sessions": state.pty.list_info(),
        }),
        "terminal.capture" => {
            let session_id = arg_string(&args, "sessionId")?;
            let lines = arg_usize(&args, "lines", 200)?.clamp(1, 10_000);
            let clean = arg_bool(&args, "clean", true);
            let text = state
                .pty
                .capture(&session_id, lines, clean)
                .map_err(|err| super::map_pty_err(&session_id, err))?;
            serde_json::json!({ "sessionId": session_id, "text": text, "lines": lines, "clean": clean })
        }
        "mux.workspaces.list" => {
            let mux = state
                .mux
                .lock()
                .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
            let mut workspaces = mux
                .workspace_ids()
                .into_iter()
                .filter_map(|id| mux.graph(&id).map(workspace_summary))
                .collect::<Vec<_>>();
            workspaces.sort_by(|a, b| a.id.cmp(&b.id));
            serde_json::json!({ "workspaces": workspaces })
        }
        "mux.workspace.get" => {
            let workspace_id = arg_string(&args, "workspaceId")?;
            let mux = state
                .mux
                .lock()
                .map_err(|_| ApiError::Internal("mux manager lock poisoned".to_string()))?;
            let graph = mux
                .graph(&workspace_id)
                .cloned()
                .ok_or_else(|| ApiError::NotFound(workspace_id.clone()))?;
            serde_json::json!({ "workspaceId": workspace_id, "graph": graph })
        }
        "mux.workspace.safeInput" => {
            let workspace_id = arg_string(&args, "workspaceId")?;
            let text = arg_string(&args, "text")?;
            send_workspace_input(&state, &workspace_id, text.as_bytes())?
        }
        "aether.worktree.validate" => {
            let branch_name = arg_string(&args, "branchName")?;
            crate::control::worktree::validate_branch(&branch_name)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "branchName": branch_name, "valid": true })
        }
        "aether.worktree.predictPath" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let branch_name = arg_string(&args, "branchName")?;
            crate::control::worktree::validate_branch(&branch_name)
                .map_err(ApiError::BadRequest)?;
            let path = crate::control::worktree::predict_path(&repo_path, &branch_name);
            serde_json::json!({
                "repoPath": repo_path,
                "branchName": branch_name,
                "path": path,
            })
        }
        "aether.worktree.list" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let worktrees =
                crate::control::worktree::list(&repo_path).map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "worktrees": worktrees })
        }
        "aether.worktree.create" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let branch_name = arg_string(&args, "branchName")?;
            let worktree = crate::control::worktree::create(&repo_path, &branch_name)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "branchName": branch_name, "worktree": worktree })
        }
        "aether.worktree.remove" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let worktree_name = arg_string(&args, "worktreeName")?;
            let delete_branch = arg_bool(&args, "deleteBranch", false);
            crate::control::worktree::remove(&repo_path, &worktree_name, delete_branch)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "worktreeName": worktree_name, "removed": true, "deleteBranch": delete_branch })
        }
        "aether.fleet_status" => {
            let sessions = state
                .agent_manager
                .as_ref()
                .map(crate::control::agent::list_headless)
                .unwrap_or_default();
            serde_json::json!({
                "available": state.agent_manager.is_some(),
                "source": "rust-agent-manager",
                "sessions": sessions,
            })
        }
        "aether.route_agent" => {
            let prompt = arg_string(&args, "prompt")?;
            let budget_remaining = arg_optional_f64(&args, "budgetRemaining")?;
            let decision = crate::control::agent::route(&prompt, budget_remaining);
            serde_json::json!({ "prompt": prompt, "decision": decision })
        }
        "aether.pane_send_input" => {
            let terminal_id = arg_string(&args, "terminalId")?;
            let text = arg_string(&args, "text")?;
            if text.len() > WS_MAX_INPUT_FRAME_BYTES {
                return Err(ApiError::BadRequest(format!(
                    "input frame exceeds {} bytes",
                    WS_MAX_INPUT_FRAME_BYTES
                )));
            }
            state
                .pty
                .write(&terminal_id, text.as_bytes())
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "terminalId": terminal_id, "accepted": true })
        }
        "aether.agent_diff" => {
            let session_id = arg_string(&args, "sessionId")?;
            let against =
                arg_optional_string(&args, "against").unwrap_or_else(|| "base".to_string());
            if against == "target" {
                let target_branch = arg_string(&args, "targetBranch")?;
                crate::control::worktree::validate_branch(&target_branch)
                    .map_err(ApiError::BadRequest)?;
            } else if against != "base" {
                return Err(ApiError::BadRequest(
                    "MCP argument `against` must be `base` or `target`".to_string(),
                ));
            }

            let Some(layers) = state.ghost_layers.as_ref() else {
                return Ok(Json(serde_json::json!({
                    "schema": "aether.mcp.server.v1",
                    "tool": body.name,
                    "ok": true,
                    "result": {
                        "available": false,
                        "reason": "ghostdiff registry is not attached to this process"
                    },
                })));
            };
            let path = arg_optional_string(&args, "path");
            let file = path
                .as_ref()
                .and_then(|path| crate::control::diff::get_file(layers, &session_id, path));
            serde_json::json!({
                "available": true,
                "source": "ghostdiff-layer-registry",
                "sessionId": session_id,
                "against": against,
                "path": path,
                "snapshot": crate::control::diff::list_layers(layers),
                "file": file,
            })
        }
        "aether.request_approval" => {
            let session_id = arg_string(&args, "sessionId")?;
            let tool = arg_string(&args, "tool")?;
            let summary = arg_optional_string(&args, "summary");
            let risk = arg_optional_string(&args, "risk").unwrap_or_else(|| "medium".to_string());
            let rules = crate::watchdog::load_watchdog_rules();
            let engine = crate::watchdog::engine::WatchdogEngine::new(rules);
            match crate::control::approval::evaluate(&engine, &tool) {
                crate::control::approval::ApprovalGateDecision::AutoApprove { rule } => {
                    serde_json::json!({ "intentId": null, "status": "auto_approved", "rule": rule })
                }
                crate::control::approval::ApprovalGateDecision::AutoDeny { rule } => {
                    serde_json::json!({ "intentId": null, "status": "auto_denied", "rule": rule })
                }
                crate::control::approval::ApprovalGateDecision::PendingUser => {
                    let item = push_pending(
                        &state,
                        McpPendingDecision {
                            id: format!("approval:{}", uuid::Uuid::new_v4()),
                            session_id,
                            kind: "permission_required".to_string(),
                            title: format!("Approval requested for {tool}"),
                            summary,
                            risk,
                            status: "pending".to_string(),
                        },
                    )?;
                    serde_json::json!({ "intentId": item.id, "status": "pending", "item": item })
                }
            }
        }
        "aether.list_pending_approvals" => {
            let pending = state
                .mcp_pending
                .lock()
                .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?
                .iter()
                .filter(|item| item.status == "pending")
                .cloned()
                .collect::<Vec<_>>();
            serde_json::json!({ "pending": pending, "grantToolExposed": false })
        }
        "aether.request_merge" => {
            let request = crate::control::merge::MergeRequest {
                session_id: arg_string(&args, "sessionId")?,
                source_branch: arg_string(&args, "sourceBranch")?,
                target_branch: arg_string(&args, "targetBranch")?,
            };
            let queued =
                crate::control::merge::queue_request(request).map_err(ApiError::BadRequest)?;
            let item = push_pending(
                &state,
                McpPendingDecision {
                    id: queued.intent_id.clone(),
                    session_id: queued.session_id.clone(),
                    kind: "merge_conflict_strategy".to_string(),
                    title: format!(
                        "Merge {} into {}",
                        queued.source_branch, queued.target_branch
                    ),
                    summary: Some(
                        "Queued by aether.request_merge; no merge was performed.".to_string(),
                    ),
                    risk: "high".to_string(),
                    status: "pending".to_string(),
                },
            )?;
            serde_json::json!({ "intentId": queued.intent_id, "status": queued.status, "queued": queued, "item": item })
        }
        "aether.spawn_agent" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let prompt = arg_string(&args, "prompt")?;
            let cwd = arg_string(&args, "cwd")?;
            let model = arg_optional_string(&args, "model");
            let allowed_tools = arg_optional_string_array(&args, "allowedTools")?;
            let resume_id = arg_optional_string(&args, "resumeId");
            // Cost gate (BR7): same shared caps as the UI/IPC spawn paths. Only
            // headless sessions are counted here (the interactive runtime is not
            // attached to the API state); the loop enforces the full budget.
            if let Some(cost) = state.cost_manager.as_ref() {
                let active_agents = crate::control::agent::list_headless(manager).len();
                cost.guard_spawn(active_agents)
                    .map_err(ApiError::BadRequest)?;
            }
            let session_id = crate::control::agent::start_headless(
                manager,
                crate::control::agent::HeadlessSpawnSpec {
                    prompt,
                    cwd,
                    model,
                    allowed_tools,
                    resume_id,
                },
            )
            .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "sessionId": session_id, "spawned": true })
        }
        "aether.stop_agent" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let session_id = arg_string(&args, "sessionId")?;
            crate::control::agent::stop_headless(manager, &session_id)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "sessionId": session_id, "stopped": true })
        }
        "aether.review.approve" => {
            let intent_id = arg_string(&args, "intentId")?;
            let repo_path = arg_string(&args, "repoPath")?;
            let source_branch = arg_string(&args, "sourceBranch")?;
            let target_branch = arg_string(&args, "targetBranch")?;
            crate::git::validate_branch_name(&source_branch).map_err(ApiError::BadRequest)?;
            crate::git::validate_branch_name(&target_branch).map_err(ApiError::BadRequest)?;

            // Claim the queued intent (pending -> merging) under the lock so two
            // reviewers can never merge the same intent twice.
            {
                let mut pending = state.mcp_pending.lock().map_err(|_| {
                    ApiError::Internal("MCP pending queue lock poisoned".to_string())
                })?;
                let item = pending
                    .iter_mut()
                    .find(|i| i.id == intent_id)
                    .ok_or_else(|| ApiError::NotFound(intent_id.clone()))?;
                if item.kind != "merge_conflict_strategy" {
                    return Err(ApiError::BadRequest(format!(
                        "intent {intent_id} is not a merge intent"
                    )));
                }
                if item.status != "pending" {
                    return Err(ApiError::BadRequest(format!(
                        "intent {intent_id} is not pending (status: {})",
                        item.status
                    )));
                }
                item.status = "merging".to_string();
            }

            // Perform the real merge without holding the pending lock.
            let outcome = crate::git::perform_merge(&repo_path, &source_branch, &target_branch);
            let final_status = match &outcome {
                Ok(crate::git::MergeOutcome::Conflict { .. }) => "conflict",
                Ok(_) => "merged",
                // The merge could not run; restore the intent so it can be retried.
                Err(_) => "pending",
            };
            {
                let mut pending = state.mcp_pending.lock().map_err(|_| {
                    ApiError::Internal("MCP pending queue lock poisoned".to_string())
                })?;
                if let Some(item) = pending.iter_mut().find(|i| i.id == intent_id) {
                    item.status = final_status.to_string();
                }
            }
            match outcome {
                Ok(outcome) => {
                    serde_json::json!({ "intentId": intent_id, "status": final_status, "outcome": outcome })
                }
                Err(err) => return Err(ApiError::BadRequest(err)),
            }
        }
        "aether.review.reject" => {
            let intent_id = arg_string(&args, "intentId")?;
            let reason = arg_optional_string(&args, "reason");
            let mut pending = state
                .mcp_pending
                .lock()
                .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?;
            let item = pending
                .iter_mut()
                .find(|i| i.id == intent_id)
                .ok_or_else(|| ApiError::NotFound(intent_id.clone()))?;
            if item.status != "pending" {
                return Err(ApiError::BadRequest(format!(
                    "intent {intent_id} is not pending (status: {})",
                    item.status
                )));
            }
            item.status = "rejected".to_string();
            let resolved = item.clone();
            drop(pending);
            serde_json::json!({ "intentId": intent_id, "status": "rejected", "reason": reason, "item": resolved })
        }
        other => {
            return Err(ApiError::BadRequest(format!("unknown MCP tool: {other}")));
        }
    };
    Ok(Json(serde_json::json!({
        "schema": "aether.mcp.server.v1",
        "tool": body.name,
        "ok": true,
        "result": result,
    })))
}
