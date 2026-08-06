use std::collections::HashMap;
use std::sync::LazyLock;

#[cfg(test)]
pub(super) fn tool_names() -> Vec<&'static str> {
    TOOL_CATALOG
        .get("tools")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool| tool.get("name").and_then(serde_json::Value::as_str))
        .collect()
}

static TOOL_CATALOG: LazyLock<serde_json::Value> = LazyLock::new(build_tools_list_value);
static TOOL_SCHEMA_INDEX: LazyLock<HashMap<String, serde_json::Value>> = LazyLock::new(|| {
    let mut index = HashMap::new();
    if let Some(tools) = TOOL_CATALOG.get("tools").and_then(|tools| tools.as_array()) {
        for tool in tools {
            let Some(name) = tool.get("name").and_then(|value| value.as_str()) else {
                continue;
            };
            let Some(schema) = tool.get("inputSchema") else {
                continue;
            };
            index.insert(name.to_string(), schema.clone());
        }
    }
    index
});

fn build_tools_list_value() -> serde_json::Value {
    let mut catalog = serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "server": "aelyris",
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
                "description": "Send bounded input to all live panes in a mux workspace. A command classified `review` by the backend command-risk policy (P0-4) is refused unless an `approvalId` minted for that exact command + target set is supplied; `deny` (destructive) is always refused.",
                "inputSchema": {
                    "type": "object",
                    "required": ["workspaceId", "text"],
                    "properties": {
                        "workspaceId": { "type": "string" },
                        "text": { "type": "string", "maxLength": 1048576 },
                        "approvalId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.worktree.validate",
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
                "name": "aelyris.worktree.predictPath",
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
                "name": "aelyris.worktree.list",
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
                "name": "aelyris.worktree.create",
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
                "name": "aelyris.worktree.remove",
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
                "name": "aelyris.fleet_status",
                "description": "Read the unified native-owned agent fleet snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.route_agent",
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
                "name": "aelyris.pane_send_input",
                "description": "Send bounded input to a live pane/terminal id. A command classified `review` by the backend command-risk policy (P0-4) is refused unless an `approvalId` minted for that exact command + terminal is supplied; `deny` (destructive) is always refused — this is the agent-injection path the gate exists to catch.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["terminalId", "text"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "text": { "type": "string", "maxLength": 1048576 },
                        "approvalId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.agent_diff",
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
                "name": "aelyris.session.summarize",
                "description": "Inject the no-loss self-summary prompt into a live interactive session and return the existing SessionSummarizeResult JSON.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["session_id"],
                    "properties": {
                        "session_id": { "type": "string" },
                        "reason": { "type": "string" },
                        "timeout_ms": { "type": "integer" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.session.checkpoint",
                "description": "Persist a session checkpoint through the same lifecycle runtime used by the IPC session_checkpoint command.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["session_id"],
                    "properties": {
                        "session_id": { "type": "string" },
                        "summary_json": { "type": "object" },
                        "summary_seq": { "type": "integer" },
                        "inflight_ref": { "type": "string" },
                        "predecessor_session_id": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.session.handoff",
                "description": "Run the no-loss handoff transaction: summarize, checkpoint, spawn successor, ack, audit, then retire the predecessor.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["session_id"],
                    "properties": {
                        "session_id": { "type": "string" },
                        "reason": { "type": "string" },
                        "timeout_ms": { "type": "integer" },
                        "cols": { "type": "integer" },
                        "rows": { "type": "integer" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.session.resume",
                "description": "Reconcile unresolved durable session handoffs and adopt a requested logical session when identity checks pass.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "logical_session_id": { "type": "string" },
                        "timeout_ms": { "type": "integer" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.session.reset_context",
                "description": "Recycle a live session through the same no-loss handoff discipline, preserving the worktree.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["session_id"],
                    "properties": {
                        "session_id": { "type": "string" },
                        "timeout_ms": { "type": "integer" },
                        "cols": { "type": "integer" },
                        "rows": { "type": "integer" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.list",
                "description": "List project Proofbook definitions discovered under .aelyris/proofbooks without executing them.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath"],
                    "properties": { "projectPath": { "type": "string" } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.get",
                "description": "Read one contained Proofbook definition with its definition hash and validation report.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "proofbookPath"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "proofbookPath": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.validate",
                "description": "Run PB-1 static Proofbook validation without executing a run.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "proofbookPath"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "proofbookPath": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.run",
                "description": "Start a PB-2/PB-3 Proofbook run through the managed Rust runner. GATED mcpTool steps pause before execution and require approve_gate.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "proofbookPath"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "proofbookPath": { "type": "string" },
                        "inputs": { "type": "object" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.status",
                "description": "Read one Proofbook run ledger, including waiting gates and residual blockers.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "runId"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "runId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.settle_agent_session",
                "description": "Settle one running PB-4 agentSession step with explicit completion proof; first-file-exists alone is rejected.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "runId", "stepId", "proof"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "runId": { "type": "string" },
                        "stepId": { "type": "string" },
                        "proof": {
                            "type": "object",
                            "required": ["status"],
                            "properties": {
                                "status": { "type": "string", "enum": ["passed", "failed", "blocked", "timeout", "cancelled"] },
                                "proofKind": { "type": "string" },
                                "doneSignal": { "type": "string" },
                                "finalReportPath": { "type": "string" },
                                "artifactPaths": { "type": "array", "items": { "type": "string" } },
                                "reviewerBatchId": { "type": "string" },
                                "blockerCode": { "type": "string" },
                                "blockerMessage": { "type": "string" },
                                "summary": { "type": "string" }
                            },
                            "additionalProperties": false
                        }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.cancel",
                "description": "Cancel a Proofbook run through the managed runner; artifacts and ledgers are retained.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "runId"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "runId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.approve_gate",
                "description": "Approve a waiting Proofbook gate by expected gate id and hash. Stale hashes fail closed.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "runId", "gateId", "gateHash"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "runId": { "type": "string" },
                        "gateId": { "type": "string" },
                        "gateHash": { "type": "string" },
                        "actor": { "type": "string" },
                        "comment": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.proofbook.reject_gate",
                "description": "Reject a waiting Proofbook gate by expected gate id and hash. Stale hashes fail closed.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["projectPath", "runId", "gateId", "gateHash"],
                    "properties": {
                        "projectPath": { "type": "string" },
                        "runId": { "type": "string" },
                        "gateId": { "type": "string" },
                        "gateHash": { "type": "string" },
                        "actor": { "type": "string" },
                        "comment": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.request_approval",
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
                "name": "aelyris.list_pending_approvals",
                "description": "Observe pending approval requests and unresolved DURABLE merge intents (everything not yet merged/rejected). Read-only — it cannot resolve them. Returns { pending:[permission items], mergeIntents:[durable merge intents] }.",
                "safety": "GATED_OBSERVE_ONLY",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.approval.resolve",
                "description": "Resolve the current interactive approval menu for a visible terminal using the same fingerprint-checked core as the Decision Inbox. Stale or missing prompt fingerprints fail closed.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["terminalId", "decision", "expectedPromptKey", "humanApprovalCapability"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "decision": { "type": "string", "enum": ["approve", "deny"] },
                        "expectedPromptKey": { "type": "string" },
                        "humanApprovalCapability": { "type": "string", "minLength": 1 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.pane.rename",
                "description": "Rename a visible terminal pane through the same cockpit pane-identity core. terminalId accepts a UUID or process-local %N short id.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["terminalId", "name"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "name": { "type": "string", "minLength": 1, "maxLength": 120 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.pane.set_role",
                "description": "Assign a visible terminal pane role through the same cockpit pane-identity core. terminalId accepts a UUID or process-local %N short id.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["terminalId", "role"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "role": { "type": "string", "minLength": 1, "maxLength": 40 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.request_merge",
                "description": "RETIRED compatibility verb. Generic merge intents are now minted only inside backend-owned exact-candidate review; calling this tool returns a validation error and performs no repository or persistence mutation.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["taskId", "repoPath", "sourceBranch", "targetBranch"],
                    "properties": {
                        "taskId": { "type": "string" },
                        "repoPath": { "type": "string" },
                        "sourceBranch": { "type": "string" },
                        "targetBranch": { "type": "string" },
                        "sessionId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.spawn_agent",
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
                "name": "aelyris.agent.spawn_visible",
                "description": "Spawn the same visible interactive TUI agent as the cockpit path. Enforces the live cost cap (BR7) and returns SpawnResult.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["cwd"],
                    "properties": {
                        "cwd": { "type": "string" },
                        "model": { "type": "string" },
                        "initialPrompt": { "type": "string" },
                        "branchName": { "type": "string" },
                        "cols": { "type": "integer", "minimum": 20, "maximum": 500 },
                        "rows": { "type": "integer", "minimum": 10, "maximum": 200 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.stop_agent",
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
                "name": "aelyris.review.approve",
                "description": "RETIRED compatibility verb. Raw intent approval cannot substitute for backend-bound project gates and semantic review; calling this tool returns a validation error and never merges.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["intentId"],
                    "properties": {
                        "intentId": { "type": "string" },
                        "verdict": { "type": "string", "enum": ["approve"] },
                        "gatesDigest": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.review.reject",
                "description": "Reviewer authority: reject a DURABLE merge intent BY ID, resolving it without merging. Cannot reject an in-flight (merging) or already-resolved intent. Optional `reason`. Returns { intentId, status, reason }.",
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
                "name": "aelyris.task.create",
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
                "name": "aelyris.task.list",
                "description": "List every Task Graph node with its lifecycle status, owner, dependencies, and branch bindings.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.task.transition",
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
                "name": "aelyris.orchestrator.plan",
                "description": "Read the orchestrator's next scheduling decision for the live Task Graph: which tasks to dispatch now (priority-ordered, concurrency-capped) and the loop state (active/complete/stalled/halted_by_budget). Read-only.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": { "activeAgents": { "type": "integer", "minimum": 0 } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.supervisor.health",
                "description": "Read the Architect's health assessment of the live autonomy loop, one level above the orchestrator: a verdict (healthy/degraded/stuck), task-status counts, budget pressure, and machine-readable directives (re_decompose a given-up task, unblock a blocked one, halt on budget) for the super-supervisor to act on. Read-only.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": { "activeAgents": { "type": "integer", "minimum": 0 } },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.orchestrator.step",
                "description": "Drive one implementation-only autonomy step over the live Task Graph: sense clean exits/crashes, move completed work to Review, recover bounded failures, and dispatch ready tasks as real headless agents routed to each task's model. This tool never accepts review booleans and cannot merge a Review task. Use the existing OID-bound review approve/reject tools for merge authority.",
                "safety": "GATED",
                "inputSchema": {
                    "type": "object",
                    "required": ["repoPath"],
                    "properties": {
                        "repoPath": { "type": "string" },
                        "activeAgents": { "type": "integer", "minimum": 0 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.event.recent",
                "description": "Read the bounded hot projection of already-committed fleet events, oldest first. This is cockpit visibility, not durable replay or ACK; use event.poll for reliable consumption.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.event.by_channel",
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
                "name": "aelyris.event.since",
                "description": "Diagnostic durable outbox read after a caller-supplied sequence. High-water mismatch, future cursor, query failure, corrupt trailing rows, and sequence gaps return a structured aelyris.event-bus.error/v1 non-success instead of an empty batch. This does not ACK delivery; reliable consumers use event.poll + event.ack.",
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
                "name": "aelyris.shared_brain.snapshot",
                "description": "Read the unified shared-brain snapshot: live agents, pane/event activity, file and symbol ownership, unresolved durable merge intents, blockers, and project decisions from one backend formatter.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "workspaceId": { "type": "string" }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.ownership.assign",
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
                "name": "aelyris.ownership.owner_of",
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
                "name": "aelyris.ownership.claims",
                "description": "All current file-ownership claims.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.ownership.conflicts",
                "description": "All current cross-agent ownership conflicts (overlapping claims by different agents) — the collisions to resolve before dispatching parallel lanes.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.symbol.claim",
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
                "name": "aelyris.symbol.refresh",
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
                "name": "aelyris.symbol.release",
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
                "name": "aelyris.symbol.release_task",
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
                "name": "aelyris.symbol.claims",
                "description": "All live symbol claims (expired leases swept first) — who owns which symbol range right now.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.symbol.conflicts",
                "description": "All live cross-agent symbol overlaps (block + warn) — the function-level collisions to coordinate before co-editing a file.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.symbol.claim_from_diff",
                "description": "DERIVE symbol claims from your worktree's `git diff` instead of hand-specifying ranges: parses each hunk's NEW-side line span into a claim at confidence diff-hunk (inferred — overlaps WARN, never hard-block; can't prove disjointness so they serialize overlapping ready tasks). Idempotent per span (re-running with an updated diff replaces that span's claim). Returns { recorded, claims: [{ claimId, outcome }] }. Call after editing, refresh()/release() as the work proceeds.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["agentId", "diff"],
                    "properties": {
                        "agentId": { "type": "string" },
                        "taskId": { "type": "string" },
                        "diff": { "type": "string", "maxLength": 1048576 },
                        "mode": { "type": "string", "enum": ["write", "review", "test", "read"] },
                        "leaseSecs": { "type": "integer", "minimum": 1 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.symbol.claim_from_source",
                "description": "DERIVE symbol claims by PARSING file source (tree-sitter: Rust / TS / TSX) into exact function/method/class/struct/enum/trait/component ranges at confidence parser (EXACT — overlapping writes hard-block, and disjoint symbols UNLOCK same-file co-editing on normal source files). Reconciles: re-running for the same agent+path replaces that file's prior derived claims (renamed/removed symbols are freed). Unsupported language or an unparseable file yields NO claims (fallback:true -> file-level exclusivity; never a guessed range). Returns { recorded, fallback, claims: [{ claimId, outcome }] }.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["agentId", "path", "source"],
                    "properties": {
                        "agentId": { "type": "string" },
                        "taskId": { "type": "string" },
                        "path": { "type": "string" },
                        "source": { "type": "string", "maxLength": 1048576 },
                        "mode": { "type": "string", "enum": ["write", "review", "test", "read"] },
                        "leaseSecs": { "type": "integer", "minimum": 1 }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.context.set",
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
                "name": "aelyris.context.get",
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
                "name": "aelyris.context.all",
                "description": "The full shared ADR (every project decision) — the world-model snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.context.remove",
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
                "name": "aelyris.agent.report_activity",
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
                "name": "aelyris.agent.report_blocker",
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
                "name": "aelyris.agent.steer_avoid",
                "description": "TYPED steer (§6.4): tell a LIVE agent to AVOID the symbols OTHER agents currently own in the files it is working on. DERIVES the avoidance list from the live symbol-ownership map (the same source as the dispatch prompt) — NOT raw pane text — so the directive is auditable and structured. Errors if the target sessionId is not a live agent (retained done/failed sessions do NOT count). Publishes steer_avoid to the fleet stream; returns { sessionId, steered, avoidCount, directive (the same human-readable ownership header the dispatch prompt uses, or null when nothing is owned), avoid:[{agent,symbol,path,startLine,endLine,confidence}] }.",
                "safety": "FREE",
                "inputSchema": {
                    "type": "object",
                    "required": ["sessionId"],
                    "properties": {
                        "sessionId": { "type": "string" },
                        "files": { "type": "array", "items": { "type": "string" }, "description": "The output lanes the steered agent is working on; the avoidance is scoped to claims on these files." }
                    },
                    "additionalProperties": false
                }
            },
            {
                "name": "aelyris.agent.activity",
                "description": "Read the whole fleet's live activity: each agent's session id, task, status, model, and current activity (file/symbol/action). The real-time 'who is doing what, where' snapshot.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.intent.propose",
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
                "name": "aelyris.intent.list",
                "description": "Open (still-deliberating) intents — the live proposal queue peers read before acting.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.intent.all",
                "description": "Every intent with its status (open/accepted/rejected/superseded).",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            },
            {
                "name": "aelyris.intent.resolve",
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
                "name": "aelyris.knowledge.add_node",
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
                "name": "aelyris.knowledge.add_edge",
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
                "name": "aelyris.knowledge.remove_node",
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
                "name": "aelyris.knowledge.remove_edge",
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
                "name": "aelyris.knowledge.dependencies",
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
                "name": "aelyris.knowledge.dependents",
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
                "name": "aelyris.knowledge.impact",
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
                "name": "aelyris.knowledge.graph",
                "description": "The whole code Knowledge Graph: every node + dependency edge.",
                "safety": "FREE",
                "inputSchema": { "type": "object", "additionalProperties": false }
            }
        ]
    });
    let tools = catalog
        .get_mut("tools")
        .and_then(serde_json::Value::as_array_mut)
        .expect("MCP catalog tools must be an array");
    tools.push(serde_json::json!({
        "name": "aelyris.event.poll",
        "description": "Poll durable at-least-once deliveries from this consumer's stream-bound committed ACK. Future/corrupt cursor and stream integrity failures use structured aelyris.event-bus.error/v1 non-success. A crash before ACK redelivers the same eventId; apply effects idempotently by eventId, then ACK.",
        "safety": "FREE",
        "inputSchema": {
            "type": "object",
            "required": ["consumerId"],
            "properties": {
                "consumerId": { "type": "string" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 1000 }
            },
            "additionalProperties": false
        }
    }));
    tools.push(serde_json::json!({
        "name": "aelyris.event.ack",
        "description": "Durably advance a consumer's cumulative ACK after its idempotent effect succeeds. The seq/eventId pair must identify the exact outbox row; mismatch/regression/corruption uses structured aelyris.event-bus.error/v1 non-success.",
        "safety": "FREE",
        "inputSchema": {
            "type": "object",
            "required": ["consumerId", "seq", "eventId"],
            "properties": {
                "consumerId": { "type": "string" },
                "seq": { "type": "integer", "minimum": 1 },
                "eventId": { "type": "string" }
            },
            "additionalProperties": false
        }
    }));
    catalog
}

pub(super) fn tools_list_value() -> serde_json::Value {
    TOOL_CATALOG.clone()
}

pub(super) fn tools_list_value_filtered(
    mut include: impl FnMut(&str) -> bool,
) -> serde_json::Value {
    let mut catalog = tools_list_value();
    if let Some(tools) = catalog
        .get_mut("tools")
        .and_then(serde_json::Value::as_array_mut)
    {
        tools.retain(|tool| {
            tool.get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(&mut include)
        });
    }
    catalog
}

#[derive(Debug, Default, Clone)]
pub(super) struct SchemaValidationReport {
    missing: Vec<String>,
    wrong_type: Vec<SchemaTypeViolation>,
    unknown: Vec<String>,
}

impl SchemaValidationReport {
    fn is_empty(&self) -> bool {
        self.missing.is_empty() && self.wrong_type.is_empty() && self.unknown.is_empty()
    }

    pub(super) fn to_payload(&self, verb: &str) -> serde_json::Value {
        serde_json::json!({
            "schema_violation": {
                "verb": verb,
                "missing": self.missing,
                "wrong_type": self.wrong_type.iter().map(|violation| {
                    serde_json::json!({
                        "field": violation.field,
                        "expected": violation.expected,
                        "got": violation.got,
                    })
                }).collect::<Vec<_>>(),
                "unknown": self.unknown,
            }
        })
    }
}

#[derive(Debug, Clone)]
struct SchemaTypeViolation {
    field: String,
    expected: String,
    got: String,
}

pub(super) fn input_schema_for_tool_ref(name: &str) -> Option<&'static serde_json::Value> {
    TOOL_SCHEMA_INDEX.get(name)
}

pub(super) fn input_schema_for_tool(name: &str) -> Option<serde_json::Value> {
    input_schema_for_tool_ref(name).cloned()
}

pub(super) fn validate_tool_arguments(
    verb: &str,
    arguments: &serde_json::Value,
    schema: &serde_json::Value,
) -> Result<(), SchemaValidationReport> {
    let mut report = SchemaValidationReport::default();
    validate_json_schema_value(schema, arguments, "$", &mut report);
    if report.is_empty() {
        Ok(())
    } else {
        report
            .wrong_type
            .sort_by(|left, right| left.field.cmp(&right.field));
        report.missing.sort();
        report.unknown.sort();
        tracing::debug!(
            verb,
            missing = ?report.missing,
            wrong_type = ?report.wrong_type,
            unknown = ?report.unknown,
            "MCP inputSchema validation failed"
        );
        Err(report)
    }
}

fn validate_json_schema_value(
    schema: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
    report: &mut SchemaValidationReport,
) {
    let expected_type = schema
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("object");
    if !json_value_matches_type(value, expected_type) {
        report.wrong_type.push(SchemaTypeViolation {
            field: field.to_string(),
            expected: expected_type.to_string(),
            got: json_value_kind(value),
        });
        return;
    }

    if let Some(allowed) = schema.get("enum").and_then(|value| value.as_array()) {
        if !allowed.iter().any(|allowed| allowed == value) {
            report.wrong_type.push(SchemaTypeViolation {
                field: field.to_string(),
                expected: format!(
                    "one of [{}]",
                    allowed
                        .iter()
                        .map(schema_value_label)
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                got: schema_value_label(value),
            });
            return;
        }
    }

    match expected_type {
        "object" => validate_schema_object(schema, value, field, report),
        "array" => validate_schema_array(schema, value, field, report),
        "integer" => validate_schema_number_bounds(schema, value, field, report, "integer"),
        "number" => validate_schema_number_bounds(schema, value, field, report, "number"),
        "string" => validate_schema_string_bounds(schema, value, field, report),
        "boolean" => {}
        _ => report.wrong_type.push(SchemaTypeViolation {
            field: field.to_string(),
            expected: format!("supported JSON schema type, got `{expected_type}`"),
            got: json_value_kind(value),
        }),
    }
}

fn validate_schema_object(
    schema: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
    report: &mut SchemaValidationReport,
) {
    let object = value.as_object().expect("type checked as object");
    let properties = schema.get("properties").and_then(|value| value.as_object());
    if let Some(required) = schema.get("required").and_then(|value| value.as_array()) {
        for key in required.iter().filter_map(|item| item.as_str()) {
            if !object.contains_key(key) {
                report.missing.push(child_field(field, key));
            }
        }
    }

    for (key, value) in object {
        if let Some(property_schema) = properties.and_then(|properties| properties.get(key)) {
            validate_json_schema_value(property_schema, value, &child_field(field, key), report);
            continue;
        }
        match schema.get("additionalProperties") {
            Some(serde_json::Value::Bool(false)) => report.unknown.push(child_field(field, key)),
            Some(extra_schema) if extra_schema.is_object() => {
                validate_json_schema_value(extra_schema, value, &child_field(field, key), report);
            }
            _ => {}
        }
    }
}

fn validate_schema_array(
    schema: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
    report: &mut SchemaValidationReport,
) {
    let Some(item_schema) = schema.get("items").filter(|value| value.is_object()) else {
        return;
    };
    for (idx, item) in value
        .as_array()
        .expect("type checked as array")
        .iter()
        .enumerate()
    {
        validate_json_schema_value(item_schema, item, &format!("{field}[{idx}]"), report);
    }
}

fn validate_schema_number_bounds(
    schema: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
    report: &mut SchemaValidationReport,
    type_name: &str,
) {
    let Some(number) = value.as_f64() else {
        return;
    };
    if let Some(minimum) = schema.get("minimum").and_then(|value| value.as_f64()) {
        if number < minimum {
            report.wrong_type.push(SchemaTypeViolation {
                field: field.to_string(),
                expected: format!("{type_name} >= {minimum}"),
                got: schema_value_label(value),
            });
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(|value| value.as_f64()) {
        if number > maximum {
            report.wrong_type.push(SchemaTypeViolation {
                field: field.to_string(),
                expected: format!("{type_name} <= {maximum}"),
                got: schema_value_label(value),
            });
        }
    }
}

fn validate_schema_string_bounds(
    schema: &serde_json::Value,
    value: &serde_json::Value,
    field: &str,
    report: &mut SchemaValidationReport,
) {
    let Some(text) = value.as_str() else {
        return;
    };
    if let Some(min_length) = schema.get("minLength").and_then(|value| value.as_u64()) {
        if (text.chars().count() as u64) < min_length {
            report.wrong_type.push(SchemaTypeViolation {
                field: field.to_string(),
                expected: format!("string >= {min_length} chars"),
                got: format!("string({} chars)", text.chars().count()),
            });
        }
    }
    if let Some(max_length) = schema.get("maxLength").and_then(|value| value.as_u64()) {
        if text.chars().count() as u64 > max_length {
            report.wrong_type.push(SchemaTypeViolation {
                field: field.to_string(),
                expected: format!("string <= {max_length} chars"),
                got: format!("string({} chars)", text.chars().count()),
            });
        }
    }
}

fn json_value_matches_type(value: &serde_json::Value, expected: &str) -> bool {
    match expected {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        _ => false,
    }
}

fn json_value_kind(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Number(number) if number.is_i64() || number.is_u64() => {
            "integer".to_string()
        }
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
    }
}

fn schema_value_label(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => format!("\"{value}\""),
        other => other.to_string(),
    }
}

fn child_field(parent: &str, child: &str) -> String {
    if parent == "$" {
        child.to_string()
    } else {
        format!("{parent}.{child}")
    }
}

#[cfg(test)]
pub(super) fn schema_subset_violations(schema: &serde_json::Value) -> Vec<String> {
    let mut violations = Vec::new();
    assert_schema_subset(schema, "$", &mut violations);
    violations
}

#[cfg(test)]
fn assert_schema_subset(schema: &serde_json::Value, field: &str, violations: &mut Vec<String>) {
    let Some(object) = schema.as_object() else {
        violations.push(format!("{field}: schema node must be an object"));
        return;
    };
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "type"
                | "properties"
                | "required"
                | "additionalProperties"
                | "enum"
                | "items"
                | "minimum"
                | "maximum"
                | "minLength"
                | "maxLength"
                | "description"
        ) {
            violations.push(format!("{field}: unsupported schema key `{key}`"));
        }
    }
    let Some(schema_type) = object.get("type").and_then(|value| value.as_str()) else {
        violations.push(format!("{field}: schema type must be a string"));
        return;
    };
    if !matches!(
        schema_type,
        "object" | "array" | "string" | "integer" | "number" | "boolean"
    ) {
        violations.push(format!("{field}: unsupported schema type `{schema_type}`"));
    }
    if let Some(properties) = object.get("properties") {
        let Some(properties) = properties.as_object() else {
            violations.push(format!("{field}.properties: must be an object"));
            return;
        };
        for (key, property_schema) in properties {
            assert_schema_subset(property_schema, &child_field(field, key), violations);
        }
    }
    if let Some(required) = object.get("required") {
        let Some(required) = required.as_array() else {
            violations.push(format!("{field}.required: must be an array"));
            return;
        };
        if required.iter().any(|item| !item.is_string()) {
            violations.push(format!("{field}.required: every entry must be a string"));
        }
    }
    if let Some(enum_values) = object.get("enum") {
        if !enum_values
            .as_array()
            .is_some_and(|items| !items.is_empty())
        {
            violations.push(format!("{field}.enum: must be a non-empty array"));
        }
    }
    if let Some(items) = object.get("items") {
        assert_schema_subset(items, &format!("{field}[]"), violations);
    }
    if let Some(additional) = object.get("additionalProperties") {
        match additional {
            serde_json::Value::Bool(_) => {}
            value if value.is_object() => {
                assert_schema_subset(value, &format!("{field}.additionalProperties"), violations);
            }
            _ => violations.push(format!(
                "{field}.additionalProperties: must be boolean or schema object"
            )),
        }
    }
}
