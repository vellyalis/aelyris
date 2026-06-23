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
        "aether.task.create",
        "aether.task.list",
        "aether.task.transition",
        "aether.orchestrator.plan",
        "aether.orchestrator.step",
        "aether.supervisor.health",
        "aether.event.recent",
        "aether.event.by_channel",
        "aether.event.since",
        "aether.ownership.assign",
        "aether.ownership.owner_of",
        "aether.ownership.claims",
        "aether.ownership.conflicts",
        "aether.symbol.claim",
        "aether.symbol.refresh",
        "aether.symbol.release",
        "aether.symbol.release_task",
        "aether.symbol.claims",
        "aether.symbol.conflicts",
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

/// Wall-clock unix seconds for symbol-claim leases (the MCP face's clock, kept out
/// of the pure `symbol_ownership` core).
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
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
            },
            {
                "name": "aether.task.create",
                "description": "Create a Task Graph node (BR4): a unit of work the orchestrator AI assigns (owner = implementer identity, used by the reviewer-!=-implementer merge gate) and the autonomy loop schedules. Optionally route to a specific model (claude/codex/gemini) via `model`; when omitted the loop falls back to `owner`. Binds source/target branches for the merge wiring. Re-runs the dependency gate.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id", "title"],
                    "properties": {
                        "id": { "type": "string" },
                        "title": { "type": "string" },
                        "description": { "type": "string" },
                        "owner": { "type": "string" },
                        "model": { "type": "string", "description": "Agent CLI to spawn (claude/codex/gemini); defaults to owner." },
                        "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
                        "dependencies": { "type": "array", "items": { "type": "string" } },
                        "outputs": { "type": "array", "items": { "type": "string" }, "description": "Declared file lanes claimed on dispatch (FileLocked)." },
                        "sourceBranch": { "type": "string" },
                        "targetBranch": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.task.list",
                "description": "List every Task Graph node with its lifecycle status, owner, dependencies, and branch bindings.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.task.transition",
                "description": "Transition a task to a new lifecycle state (lifecycle-validated) and re-run the dependency gate.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id", "to"],
                    "properties": {
                        "id": { "type": "string" },
                        "to": {
                            "type": "string",
                            "enum": ["pending", "ready", "running", "blocked", "review", "done", "failed"]
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.orchestrator.plan",
                "description": "Read the orchestrator's next scheduling decision for the live Task Graph: which tasks to dispatch now (priority-ordered, concurrency-capped) and the loop state (active/complete/stalled/halted_by_budget). Read-only.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": { "activeAgents": { "type": "integer", "minimum": 0 } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.supervisor.health",
                "description": "Read the Architect's health assessment of the live autonomy loop, one level above the orchestrator: a verdict (healthy/degraded/stuck), task-status counts, budget pressure, and machine-readable directives (re_decompose a given-up task, unblock a blocked one, halt on budget) for the super-supervisor to act on. Read-only.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": { "activeAgents": { "type": "integer", "minimum": 0 } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.orchestrator.step",
                "description": "Drive one autonomy step over the live Task Graph (BR9): a finished agent's task moves Running->Review on a clean exit or is REASSIGNED on a crash (bounded retries, then left Failed — never lost); tasks awaiting review with an all-green verdict and reviewer != owner are MERGED into their target branch by a real git merge; ready tasks are dispatched by spawning real headless agents routed to each task's model (its `model`, or `owner` by default). Pass gateCommands to decide the objective gates (tests/lint/types) MECHANICALLY in each worktree so a red branch cannot merge. Call repeatedly to run the loop to quiescence (agents run between calls).",
                "safety": "REVIEWER_AUTHORITY",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath", "reviewerId"],
                    "properties": {
                        "repoPath": { "type": "string" },
                        "reviewerId": { "type": "string" },
                        "activeAgents": { "type": "integer", "minimum": 0 },
                        "gates": {
                            "type": "object",
                            "description": "Map of task id -> reviewer verdict { tests_pass, lint_pass, types_pass, design_consistent, context_aligned }. A task with no entry is treated as all-red and never merged. When gateCommands run a gate, that objective field is decided mechanically and the verdict's claim for it is ignored.",
                            "additionalProperties": {
                                "type": "object",
                                "properties": {
                                    "tests_pass": { "type": "boolean" },
                                    "lint_pass": { "type": "boolean" },
                                    "types_pass": { "type": "boolean" },
                                    "design_consistent": { "type": "boolean" },
                                    "context_aligned": { "type": "boolean" }
                                }
                            }
                        },
                        "gateCommands": {
                            "type": "object",
                            "description": "Optional mechanical gate commands run in each task's worktree to decide the objective gates for real. Each is an argv array (e.g. test=[\"pnpm\",\"test\"]); an unset gate falls back to the reviewer's verdict. A configured gate's machine result is authoritative, so a branch whose tests fail cannot merge.",
                            "properties": {
                                "test": { "type": "array", "items": { "type": "string" } },
                                "lint": { "type": "array", "items": { "type": "string" } },
                                "types": { "type": "array", "items": { "type": "string" } }
                            },
                            "additionalProperties": false
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.event.recent",
                "description": "Subscribe to the fleet coordination stream (BR5): recent events across all channels, oldest first. The orchestrator reads this to see who is doing what — task_created/completed, decision_changed, review_required, agent_spawned, worktree_created, file_locked/released — without screen-scraping.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.event.by_channel",
                "description": "Recent events on one coordination channel.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["channel"],
                    "properties": {
                        "channel": {
                            "type": "string",
                            "enum": ["planning", "backend", "frontend", "database", "review", "system"]
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.event.since",
                "description": "No-loss subscribe to the fleet coordination stream (BR5/P3): every event with seq > afterSeq, oldest first, up to limit, each tagged with its monotonic seq. Poll with afterSeq=0, then advance afterSeq to the last seq returned — unlike event.recent (a bounded ring that evicts), this never skips an event and survives restart. Use this for reliable orchestration.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "afterSeq": { "type": "integer", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 1000 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.ownership.assign",
                "description": "Claim a path pattern for an agent (BR8) so parallel lanes never write the same files; returns the resulting cross-agent conflicts. Patterns: exact (src/main.rs), direct children (src/auth/*), recursive (src/auth/**).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["agentId", "pattern"],
                    "properties": { "agentId": { "type": "string" }, "pattern": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.ownership.owner_of",
                "description": "The agent that owns a path (first matching claim), if any.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": { "path": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.ownership.claims",
                "description": "All current file-ownership claims.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.ownership.conflicts",
                "description": "All current cross-agent ownership conflicts (overlapping claims by different agents) — the collisions to resolve before dispatching parallel lanes.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.symbol.claim",
                "description": "Claim a SYMBOL range inside a file (finer than file ownership): two agents may write the same file on disjoint ranges, but overlapping writes conflict. Returns { outcome: granted|warned|blocked, conflicts? }. blocked = NOT recorded (pick a disjoint range or wait). confidence lsp/parser is exact (overlap blocks); diff-hunk is inferred (overlap only warns).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["claimId", "agentId", "path", "symbol", "startLine", "endLine", "mode", "confidence"],
                    "properties": {
                        "claimId": { "type": "string" },
                        "agentId": { "type": "string" },
                        "taskId": { "type": "string" },
                        "path": { "type": "string" },
                        "symbol": { "type": "string" },
                        "startLine": { "type": "integer", "minimum": 0 },
                        "endLine": { "type": "integer", "minimum": 0 },
                        "mode": { "type": "string", "enum": ["write", "review", "test", "read"] },
                        "confidence": { "type": "string", "enum": ["lsp", "parser", "diff-hunk"] },
                        "leaseSecs": { "type": "integer", "minimum": 1 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.symbol.refresh",
                "description": "Extend a live symbol claim's lease (the heartbeat that keeps a claim alive; an unrefreshed claim expires and frees its range). Returns { refreshed }.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["claimId"],
                    "properties": {
                        "claimId": { "type": "string" },
                        "leaseSecs": { "type": "integer", "minimum": 1 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.symbol.release",
                "description": "Release a symbol claim by id (call when done editing the symbol). Returns { released }.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["claimId"],
                    "properties": { "claimId": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.symbol.release_task",
                "description": "Release ALL symbol claims a task held (call on merge/fail) — frees every range that task's worker claimed. Returns { released } (count).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["taskId"],
                    "properties": { "taskId": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.symbol.claims",
                "description": "All live symbol claims (expired leases swept first) — who owns which symbol range right now.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.symbol.conflicts",
                "description": "All live cross-agent symbol overlaps (block + warn) — the function-level collisions to coordinate before co-editing a file.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.context.set",
                "description": "Set a project decision in the shared Context Store / ADR (BR6) — e.g. auth_method=jwt, database=postgresql, framework=nextjs — the world-model every agent aligns to. Publishes decision_changed to the fleet stream on a real change. This ADR is injected into every dispatched agent's prompt.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["key", "value"],
                    "properties": { "key": { "type": "string" }, "value": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.context.get",
                "description": "Read one project decision from the shared ADR.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["key"],
                    "properties": { "key": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.context.all",
                "description": "The full shared ADR (every project decision) — the world-model snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.context.remove",
                "description": "Remove a project decision from the shared ADR. Publishes decision_changed.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["key"],
                    "properties": { "key": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.agent.report_activity",
                "description": "Report what an agent is doing right now (BR5): the file/symbol it is touching and the action (editing/reading/running tests/...). Updates the agent's live activity + publishes agent_activity to the fleet stream so peers see who is touching what, down to the function, in real time.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId", "action"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "action": { "type": "string" },
                        "file": { "type": "string" },
                        "symbol": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.agent.report_blocker",
                "description": "Report that an agent is stuck (BR5): a summary of the blocker and optionally what it needs (a decision, another agent's output, ...). Marks the agent blocked + publishes blocker_raised so a peer/orchestrator can unblock it rather than it stalling silently.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId", "summary"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "summary": { "type": "string" },
                        "needs": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.agent.activity",
                "description": "Read the whole fleet's live activity: each agent's session id, task, status, model, and current activity (file/symbol/action). The real-time 'who is doing what, where' snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.intent.propose",
                "description": "Declare an intent BEFORE acting (the Intent Bus, the Event Bus' pre-fact half): a proposal like 'switch auth_method to JWT' or 'extract AuthService', with optional file/domain targets. Peers react (align/object/defer) so conflicts and design disagreements surface in discussion, not at merge. Publishes intent_declared to the stream. This is the substrate for 'meetings'.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["agentId", "proposal"],
                    "properties": {
                        "agentId": { "type": "string" },
                        "proposal": { "type": "string" },
                        "targets": { "type": "array", "items": { "type": "string" } }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.intent.list",
                "description": "Open (still-deliberating) intents — the live proposal queue peers read before acting.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.intent.all",
                "description": "Every intent with its status (open/accepted/rejected/superseded).",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aether.intent.resolve",
                "description": "Resolve an intent to a terminal status (accepted/rejected/superseded) — the convergence step of a deliberation.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id", "status"],
                    "properties": {
                        "id": { "type": "string" },
                        "status": { "type": "string", "enum": ["open", "accepted", "rejected", "superseded"] }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.add_node",
                "description": "Add a node to the code Knowledge Graph (a symbol/module the fleet reasons about) — id, kind (module/service/function/class/component/other), and the file it lives in. Agents reason over structure (User -> AuthService -> JWTProvider -> Redis), not files.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {
                        "id": { "type": "string" },
                        "kind": { "type": "string", "enum": ["module", "service", "function", "class", "component", "other"] },
                        "file": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.add_edge",
                "description": "Record a dependency edge: `dependent` depends on `dependency` (e.g. AuthService -> JWTProvider). Unknown endpoints are auto-created.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["dependent", "dependency"],
                    "properties": { "dependent": { "type": "string" }, "dependency": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.remove_node",
                "description": "Remove a node + every edge touching it (a symbol was deleted/renamed), so its blast radius never routes through a node that no longer exists. Keeps a long-lived graph from accumulating ghost symbols.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.remove_edge",
                "description": "Remove a single dependency edge (a dependency was dropped).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["dependent", "dependency"],
                    "properties": { "dependent": { "type": "string" }, "dependency": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.dependencies",
                "description": "Direct dependencies of a node (what it needs).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.dependents",
                "description": "Direct dependents of a node (who needs it).",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.impact",
                "description": "The blast radius of changing a node: the transitive set of everything that depends on it. Query this before/after a decision or intent to know exactly which other symbols (and their owners) are affected.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["id"],
                    "properties": { "id": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aether.knowledge.graph",
                "description": "The whole code Knowledge Graph: every node + dependency edge.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            }
        ]
    }))
}

pub(super) async fn tools_call(
    State(state): State<ApiState>,
    Json(body): Json<ToolCallBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let args = body.arguments.as_object().cloned().unwrap_or_default();
    // P5 governance choke point: EVERY MCP verb flows through one authorization
    // gate. The default policy allows all (local-first, behaviour unchanged); an
    // enterprise build swaps in an RBAC policy with no handler change. A denial
    // is durably audited, then returned as 403. Actor identity is single-operator
    // for now (enterprise auth would resolve it from the token).
    let actor = "operator";
    if let crate::governance::AccessDecision::Deny(reason) =
        state.governance.authorize(actor, &body.name)
    {
        // Audit the detailed reason durably, but return only a GENERIC 403 to the
        // caller: a policy reason may reference internal roles/resources and must
        // not leak to the client.
        super::audit_access_denied(&state, actor, &body.name, &reason);
        return Err(ApiError::Forbidden(format!(
            "verb `{}` is not permitted",
            body.name
        )));
    }
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
        "aether.task.create" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            let mut task =
                crate::task::Task::new(arg_string(&args, "id")?, arg_string(&args, "title")?);
            if let Some(description) = arg_optional_string(&args, "description") {
                task.description = description;
            }
            task.owner = arg_optional_string(&args, "owner");
            task.model = arg_optional_string(&args, "model");
            if let Some(priority) = args.get("priority").and_then(|value| value.as_str()) {
                task.priority =
                    serde_json::from_value(serde_json::Value::String(priority.to_string()))
                        .map_err(|_| {
                            ApiError::BadRequest(format!("invalid priority `{priority}`"))
                        })?;
            }
            if let Some(dependencies) = arg_optional_string_array(&args, "dependencies")? {
                task.dependencies = dependencies;
            }
            // Declared file lanes (BR8): when the task is dispatched these paths
            // are claimed for its owner + a FileLocked event is published.
            if let Some(outputs) = arg_optional_string_array(&args, "outputs")? {
                task.outputs = outputs;
            }
            if let (Some(source), Some(target)) = (
                arg_optional_string(&args, "sourceBranch"),
                arg_optional_string(&args, "targetBranch"),
            ) {
                task = task.with_branches(source, target);
            }
            let id = task.id.clone();
            let title = task.title.clone();
            let changed = tasks
                .create(task)
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            // Publish to the shared coordination stream so the fleet sees the
            // new work (BR5) — same event the cockpit task_create command emits.
            if let Some(bus) = state.event_bus.as_ref() {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::TaskCreated,
                    serde_json::json!({ "id": id, "title": title }),
                ));
            }
            serde_json::json!({ "id": id, "created": true, "changed": changed })
        }
        "aether.task.list" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            serde_json::json!({ "tasks": tasks.list() })
        }
        "aether.task.transition" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            let to_raw = arg_string(&args, "to")?;
            let to: crate::task::TaskStatus =
                serde_json::from_value(serde_json::Value::String(to_raw.clone()))
                    .map_err(|_| ApiError::BadRequest(format!("invalid task status `{to_raw}`")))?;
            let changed = tasks
                .transition(&id, to)
                .map_err(|err| ApiError::BadRequest(err.to_string()))?;
            // Reaching Review/Done publishes the lifecycle event to the shared
            // stream (BR5), mirroring the cockpit task_transition command.
            if let Some(bus) = state.event_bus.as_ref() {
                let kind = match to {
                    crate::task::TaskStatus::Review => {
                        Some(crate::event_bus::AgentEventKind::ReviewRequired)
                    }
                    crate::task::TaskStatus::Done => {
                        Some(crate::event_bus::AgentEventKind::TaskCompleted)
                    }
                    _ => None,
                };
                if let Some(kind) = kind {
                    bus.publish(crate::event_bus::AgentEvent::new(
                        kind,
                        serde_json::json!({ "id": id }),
                    ));
                }
            }
            serde_json::json!({ "id": id, "to": to_raw, "changed": changed })
        }
        "aether.orchestrator.plan" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            let caps = state
                .cost_manager
                .as_ref()
                .map(|cost| cost.caps())
                .unwrap_or_default();
            let usage = crate::cost::CostUsage {
                active_agents: arg_usize(&args, "activeAgents", 0)?,
                ..Default::default()
            };
            let plan = tasks.read(|graph| crate::orchestrator::plan(graph, &caps, &usage));
            serde_json::json!({ "plan": plan })
        }
        "aether.supervisor.health" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            let caps = state
                .cost_manager
                .as_ref()
                .map(|cost| cost.caps())
                .unwrap_or_default();
            let usage = crate::cost::CostUsage {
                active_agents: arg_usize(&args, "activeAgents", 0)?,
                ..Default::default()
            };
            let health = tasks.read(|graph| crate::supervisor::assess(graph, &caps, &usage));
            serde_json::json!({ "health": health })
        }
        "aether.orchestrator.step" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            let cost = state.cost_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("cost manager is not attached to this process".to_string())
            })?;
            let agents = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let events = state.event_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("event bus is not attached to this process".to_string())
            })?;
            let context = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            let repo_path = arg_string(&args, "repoPath")?;
            let reviewer_id = arg_string(&args, "reviewerId")?;
            let usage = crate::cost::CostUsage {
                active_agents: arg_usize(&args, "activeAgents", 0)?,
                ..Default::default()
            };
            let gates: std::collections::HashMap<String, crate::review::GateResults> =
                match args.get("gates") {
                    Some(value) => serde_json::from_value(value.clone())
                        .map_err(|err| ApiError::BadRequest(format!("invalid gates: {err}")))?,
                    None => std::collections::HashMap::new(),
                };
            // Optional mechanical gate commands: when supplied, the objective
            // gates (tests/lint/types) are run in each task's worktree and decide
            // merge-eligibility for real, so a red branch cannot merge (⑧).
            let gate_commands: Option<crate::control::gate_runner::GateCommands> =
                match args.get("gateCommands") {
                    Some(value) => Some(serde_json::from_value(value.clone()).map_err(|err| {
                        ApiError::BadRequest(format!("invalid gateCommands: {err}"))
                    })?),
                    None => None,
                };
            let report = crate::control::loop_ports::run_step(
                tasks,
                cost,
                agents,
                ownership,
                state.symbol_ownership.clone(),
                events,
                context,
                &usage,
                repo_path,
                reviewer_id,
                gates,
                gate_commands,
                // P4: the autonomous (MCP) face persists give-ups too — the path
                // that most needs unattended-safe durability.
                state.db.as_deref(),
            );
            serde_json::json!({ "report": report })
        }
        "aether.event.recent" => {
            let bus = state.event_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("event bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "events": bus.recent() })
        }
        "aether.event.by_channel" => {
            let bus = state.event_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("event bus is not attached to this process".to_string())
            })?;
            let channel_raw = arg_string(&args, "channel")?;
            let channel: crate::event_bus::EventChannel = serde_json::from_value(
                serde_json::Value::String(channel_raw.clone()),
            )
            .map_err(|_| ApiError::BadRequest(format!("invalid channel `{channel_raw}`")))?;
            serde_json::json!({ "channel": channel_raw, "events": bus.by_channel(channel) })
        }
        "aether.event.since" => {
            let bus = state.event_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("event bus is not attached to this process".to_string())
            })?;
            // Clamp server-side, independent of inputSchema validation: a stray
            // negative cursor or a huge limit (which would become LIMIT -1 =
            // unbounded) must never reach SQLite.
            let after_seq = args
                .get("afterSeq")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                .max(0);
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .map(|v| v as usize)
                .unwrap_or(100)
                .clamp(1, 1000);
            let events = bus.since(after_seq, limit);
            // The cursor to pass as next afterSeq (unchanged when nothing new).
            let next_seq = events.last().map(|e| e.seq).unwrap_or(after_seq);
            serde_json::json!({ "events": events, "nextSeq": next_seq })
        }
        "aether.ownership.assign" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let agent_id = arg_string(&args, "agentId")?;
            let pattern = arg_string(&args, "pattern")?;
            let conflicts = {
                let mut owner = ownership
                    .lock()
                    .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?;
                owner.assign(agent_id.clone(), pattern.clone());
                owner.conflicts()
            };
            serde_json::json!({ "agentId": agent_id, "pattern": pattern, "conflicts": conflicts })
        }
        "aether.ownership.owner_of" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let path = arg_string(&args, "path")?;
            let owner = ownership
                .lock()
                .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?
                .owner_of(&path)
                .map(str::to_string);
            serde_json::json!({ "path": path, "owner": owner })
        }
        "aether.ownership.claims" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let claims = ownership
                .lock()
                .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?
                .claims()
                .to_vec();
            serde_json::json!({ "claims": claims })
        }
        "aether.ownership.conflicts" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let conflicts = ownership
                .lock()
                .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?
                .conflicts();
            serde_json::json!({ "conflicts": conflicts })
        }
        "aether.symbol.claim" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            let lease_secs = args
                .get("leaseSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            let start_line = args
                .get("startLine")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| ApiError::BadRequest("startLine must be an integer".to_string()))?
                as u32;
            let end_line = args
                .get("endLine")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| ApiError::BadRequest("endLine must be an integer".to_string()))?
                as u32;
            let mode: crate::symbol_ownership::ClaimMode = serde_json::from_value(
                args.get("mode").cloned().unwrap_or(serde_json::Value::Null),
            )
            .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?;
            let confidence: crate::symbol_ownership::Confidence = serde_json::from_value(
                args.get("confidence")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|_| ApiError::BadRequest("invalid confidence".to_string()))?;
            let claim = crate::symbol_ownership::SymbolClaim {
                claim_id: arg_string(&args, "claimId")?,
                agent_id: arg_string(&args, "agentId")?,
                task_id: args
                    .get("taskId")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                path: arg_string(&args, "path")?,
                symbol: arg_string(&args, "symbol")?,
                range: crate::symbol_ownership::SymbolRange::new(start_line, end_line),
                mode,
                lease_expires_at: now.saturating_add(lease_secs),
                confidence,
            };
            let outcome = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.claim(claim, now)
            };
            serde_json::to_value(outcome)
                .map_err(|err| ApiError::Internal(format!("serialize symbol outcome: {err}")))?
        }
        "aether.symbol.refresh" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let claim_id = arg_string(&args, "claimId")?;
            let lease_secs = args
                .get("leaseSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            let refreshed = ownership
                .lock()
                .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?
                .refresh(&claim_id, now_secs(), lease_secs);
            serde_json::json!({ "refreshed": refreshed })
        }
        "aether.symbol.release" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let claim_id = arg_string(&args, "claimId")?;
            let released = ownership
                .lock()
                .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?
                .release(&claim_id);
            serde_json::json!({ "released": released })
        }
        "aether.symbol.release_task" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let task_id = arg_string(&args, "taskId")?;
            let released = ownership
                .lock()
                .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?
                .release_for_task(&task_id);
            serde_json::json!({ "released": released })
        }
        "aether.symbol.claims" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            let claims: Vec<crate::symbol_ownership::SymbolClaim> = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.expire(now);
                owner.live_claims(now).into_iter().cloned().collect()
            };
            serde_json::json!({ "claims": claims })
        }
        "aether.symbol.conflicts" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            let conflicts = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.expire(now);
                owner.conflicts(now)
            };
            serde_json::json!({ "conflicts": conflicts })
        }
        "aether.context.set" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            let key = arg_string(&args, "key")?;
            let value = arg_string(&args, "value")?;
            let change = store.set(key, value);
            // Broadcast to the fleet stream (BR6) — only on a real change, so the
            // shared world-model update reaches every subscriber once.
            if let (Some(change), Some(bus)) = (&change, state.event_bus.as_ref()) {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::DecisionChanged,
                    serde_json::to_value(change).unwrap_or(serde_json::Value::Null),
                ));
            }
            serde_json::json!({ "change": change })
        }
        "aether.context.get" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            let key = arg_string(&args, "key")?;
            serde_json::json!({ "key": key, "value": store.get(&key) })
        }
        "aether.context.all" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            serde_json::json!({ "decisions": store.all() })
        }
        "aether.context.remove" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            let key = arg_string(&args, "key")?;
            let change = store.remove(&key);
            if let (Some(change), Some(bus)) = (&change, state.event_bus.as_ref()) {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::DecisionChanged,
                    serde_json::to_value(change).unwrap_or(serde_json::Value::Null),
                ));
            }
            serde_json::json!({ "change": change })
        }
        "aether.agent.report_activity" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let session_id = arg_string(&args, "sessionId")?;
            let action = arg_string(&args, "action")?;
            let file = arg_optional_string(&args, "file");
            let symbol = arg_optional_string(&args, "symbol");
            manager
                .set_activity(&session_id, action.clone(), file.clone(), symbol.clone())
                .map_err(ApiError::BadRequest)?;
            // Broadcast the activity to the fleet stream (BR5) so peers see what
            // this agent is touching/doing in real time.
            if let Some(bus) = state.event_bus.as_ref() {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::AgentActivity,
                    serde_json::json!({
                        "sessionId": session_id,
                        "action": action,
                        "file": file,
                        "symbol": symbol,
                    }),
                ));
            }
            serde_json::json!({ "sessionId": session_id, "reported": true })
        }
        "aether.agent.report_blocker" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let session_id = arg_string(&args, "sessionId")?;
            let summary = arg_string(&args, "summary")?;
            let needs = arg_optional_string(&args, "needs");
            // Best-effort: mark the agent blocked (no-op if the session is gone).
            let _ = manager.set_activity(&session_id, "blocked".to_string(), None, None);
            // Surface the blocker on the stream so a peer/orchestrator can
            // unblock it instead of the agent stalling silently.
            if let Some(bus) = state.event_bus.as_ref() {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::BlockerRaised,
                    serde_json::json!({
                        "sessionId": session_id,
                        "summary": summary,
                        "needs": needs,
                    }),
                ));
            }
            serde_json::json!({ "sessionId": session_id, "raised": true })
        }
        "aether.agent.activity" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let fleet: Vec<serde_json::Value> = manager
                .list_sessions()
                .into_iter()
                .map(|session| {
                    serde_json::json!({
                        "sessionId": session.id,
                        "taskId": session.task_id,
                        "status": session.status,
                        "model": session.model,
                        "activity": session.current_activity,
                    })
                })
                .collect();
            serde_json::json!({ "fleet": fleet })
        }
        "aether.intent.propose" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            let agent_id = arg_string(&args, "agentId")?;
            let proposal = arg_string(&args, "proposal")?;
            let targets = arg_optional_string_array(&args, "targets")?.unwrap_or_default();
            let created_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let intent = bus.propose(agent_id, proposal, targets, created_at);
            // Surface the proposal on the fleet stream so peers can react
            // BEFORE the work happens (conflict-avoidance + deliberation).
            if let Some(events) = state.event_bus.as_ref() {
                events.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::IntentDeclared,
                    serde_json::to_value(&intent).unwrap_or(serde_json::Value::Null),
                ));
            }
            serde_json::json!({ "intent": intent })
        }
        "aether.intent.list" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "intents": bus.open() })
        }
        "aether.intent.all" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "intents": bus.all() })
        }
        "aether.intent.resolve" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            let status_raw = arg_string(&args, "status")?;
            let status: crate::intent::IntentStatus = serde_json::from_value(
                serde_json::Value::String(status_raw.clone()),
            )
            .map_err(|_| ApiError::BadRequest(format!("invalid intent status `{status_raw}`")))?;
            let intent = bus.resolve(&id, status);
            serde_json::json!({ "intent": intent })
        }
        "aether.knowledge.add_node" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            // Absent kind defaults to Other; a present-but-invalid kind (wrong
            // type or unknown variant) is rejected, like the other enum verbs.
            let kind = match args.get("kind") {
                None => crate::knowledge_graph::NodeKind::default(),
                Some(value) => serde_json::from_value(value.clone())
                    .map_err(|_| ApiError::BadRequest(format!("invalid node kind: {value}")))?,
            };
            let file = arg_optional_string(&args, "file");
            kg.add_node(crate::knowledge_graph::CodeNode {
                id: id.clone(),
                kind,
                file,
            });
            serde_json::json!({ "id": id, "added": true })
        }
        "aether.knowledge.add_edge" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let dependent = arg_string(&args, "dependent")?;
            let dependency = arg_string(&args, "dependency")?;
            kg.add_edge(&dependent, &dependency);
            serde_json::json!({ "dependent": dependent, "dependency": dependency, "added": true })
        }
        "aether.knowledge.remove_node" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            // Evict a deleted/renamed symbol + every edge touching it, so its
            // blast radius never routes through a node that no longer exists.
            let removed = kg.remove_node(&id);
            serde_json::json!({ "id": id, "removed": removed })
        }
        "aether.knowledge.remove_edge" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let dependent = arg_string(&args, "dependent")?;
            let dependency = arg_string(&args, "dependency")?;
            let removed = kg.remove_edge(&dependent, &dependency);
            serde_json::json!({ "dependent": dependent, "dependency": dependency, "removed": removed })
        }
        "aether.knowledge.dependencies" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            serde_json::json!({ "id": id, "dependencies": kg.dependencies_of(&id) })
        }
        "aether.knowledge.dependents" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            serde_json::json!({ "id": id, "dependents": kg.dependents_of(&id) })
        }
        "aether.knowledge.impact" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            // Transitive blast radius: everything that depends on `id`.
            serde_json::json!({ "id": id, "impact": kg.impact_of(&id) })
        }
        "aether.knowledge.graph" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let edges: Vec<serde_json::Value> = kg
                .edges()
                .into_iter()
                .map(|(dependent, dependency)| {
                    serde_json::json!({ "dependent": dependent, "dependency": dependency })
                })
                .collect();
            serde_json::json!({ "nodes": kg.nodes(), "edges": edges })
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

// ---- Native MCP: JSON-RPC 2.0 over Streamable HTTP ----
//
// Lets a standard MCP client (e.g. Claude Code via .mcp.json) register Aether as
// a native server, so the aether.* verbs appear as native tools instead of being
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

const MCP_INSTRUCTIONS: &str = "Aether is an autonomous build runtime you (the orchestrator) drive via these aether.* tools; the worker agents (real claude/codex/gemini CLIs in isolated worktrees) do the implementation. Loop: (1) context.set the project decisions/ADR (injected into every dispatched agent). (2) task.create one per subtask with owner=<implementer identity> (reviewer must differ from it to merge), model=<claude|codex|gemini> (optional CLI routing; defaults to owner), sourceBranch/targetBranch, dependencies, outputs=<file lanes>; check ownership.conflicts. (3) worktree.create each branch. (4) Call orchestrator.step repeatedly with {repoPath, reviewerId(!=owner), activeAgents, gates}: finished agents -> review, all-green verdict -> real git merge, ready tasks -> spawned; agents run between calls, so pace them. (5) Coordinate between steps via event.recent / agent.activity (who edits what), knowledge.impact (blast radius), intent.propose/list (pre-fact proposals), ownership.conflicts, blocker_raised. You are the reviewer; supply each task's gates from your own inspection. Local-only; concurrency cap 4.";

/// Native MCP JSON-RPC endpoint. Handles initialize / tools.list / tools.call /
/// ping; everything else is method-not-found.
pub(super) async fn mcp_rpc(
    State(state): State<ApiState>,
    Json(req): Json<JsonRpcReq>,
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
                "serverInfo": { "name": "aether-terminal", "version": env!("CARGO_PKG_VERSION") },
                "instructions": MCP_INSTRUCTIONS,
            }))
        }
        "ping" => Ok(serde_json::json!({})),
        "tools/list" => {
            let Json(listed) = tools_list().await;
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
                match tools_call(State(state), Json(body)).await {
                    Ok(Json(value)) => {
                        let inner = value
                            .get("result")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        Ok(serde_json::json!({
                            "content": [{ "type": "text", "text": serde_json::to_string(&inner).unwrap_or_default() }],
                            "structuredContent": inner,
                            "isError": false,
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

    /// The MCP surface has three parallel lists that must never drift: the
    /// catalog (`tool_names`), the schemas (`tools_list`), and the handlers
    /// (the `tools_call` match). This locks catalog == schemas so a verb can
    /// never be advertised without a discoverable schema (or vice versa).
    #[test]
    fn catalog_and_schemas_list_exactly_the_same_verbs() {
        let catalog: BTreeSet<String> = tool_names().into_iter().map(String::from).collect();
        let Json(listed) = tokio::runtime::Runtime::new()
            .expect("tokio runtime")
            .block_on(tools_list());
        let schemas: BTreeSet<String> = listed["tools"]
            .as_array()
            .expect("tools is an array")
            .iter()
            .map(|tool| {
                tool["name"]
                    .as_str()
                    .expect("every tool schema has a name")
                    .to_string()
            })
            .collect();
        assert_eq!(
            catalog,
            schemas,
            "tool_names() (catalog) and tools_list() (schemas) drifted: \
             only-in-catalog={:?}, only-in-schemas={:?}",
            catalog.difference(&schemas).collect::<Vec<_>>(),
            schemas.difference(&catalog).collect::<Vec<_>>(),
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
        for verb in ["mux.workspace.safeInput", "aether.pane_send_input"] {
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
            name: "aether.spawn_agent".to_string(),
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
}
