use axum::Json;
use serde::Serialize;
#[cfg(not(test))]
use tauri::{Emitter, Manager};

use super::super::mux::{send_workspace_input, workspace_summary};
use super::super::{
    ApiError, ApiResult, ApiState, McpPendingDecision, MAX_MCP_PENDING, WS_MAX_INPUT_FRAME_BYTES,
};
use super::{
    input_schema_for_tool, schema_tool_error, tools_call_as_actor, tools_list_value,
    validate_tool_arguments, ToolCallBody,
};

fn arg_string(args: &serde_json::Map<String, serde_json::Value>, key: &str) -> ApiResult<String> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` is required")))
}

/// Like [`arg_string`] but PRESERVES the value byte-for-byte (no trim, `""` allowed) —
/// for payloads where positions/content matter (a unified diff, a file's source).
/// Trimming a source would strip leading blank lines and shift every symbol's line
/// number, corrupting the extracted ranges. Still required to be present as a string.
fn arg_string_raw(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<String> {
    args.get(key)
        .and_then(|value| value.as_str())
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

fn arg_u64(args: &serde_json::Map<String, serde_json::Value>, key: &str) -> ApiResult<u64> {
    args.get(key)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            ApiError::BadRequest(format!(
                "MCP argument `{key}` must be a non-negative integer"
            ))
        })
}

#[cfg(not(test))]
fn arg_optional_u64(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<u64>> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    value
        .as_u64()
        .map(Some)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` must be an integer")))
}

#[cfg(not(test))]
fn arg_optional_u16(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<u16>> {
    let Some(value) = arg_optional_u64(args, key)? else {
        return Ok(None);
    };
    u16::try_from(value)
        .map(Some)
        .map_err(|_| ApiError::BadRequest(format!("MCP argument `{key}` is too large")))
}

#[cfg(not(test))]
fn arg_optional_object_value(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<serde_json::Value>> {
    let Some(value) = args.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    if value.is_object() {
        return Ok(Some(value.clone()));
    }
    Err(ApiError::BadRequest(format!(
        "MCP argument `{key}` must be an object"
    )))
}

#[cfg(not(test))]
fn mcp_app_handle(state: &ApiState) -> ApiResult<tauri::AppHandle> {
    state.app_handle.clone().ok_or_else(|| {
        ApiError::Internal(
            "session lifecycle runtime is not attached to this MCP process".to_string(),
        )
    })
}

fn mcp_result_value<T: Serialize>(result: T) -> ApiResult<serde_json::Value> {
    serde_json::to_value(result)
        .map_err(|err| ApiError::Internal(format!("serialize MCP result failed: {err}")))
}

#[cfg(test)]
fn test_mcp_session_lifecycle_unattached() -> ApiResult<serde_json::Value> {
    Err(ApiError::Internal(
        "session lifecycle runtime is not attached to this MCP process".to_string(),
    ))
}

#[cfg(not(test))]
async fn mcp_session_summarize(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let app = mcp_app_handle(state)?;
    let session_id = arg_string(args, "session_id")?;
    let reason = arg_optional_string(args, "reason");
    let timeout_ms = arg_optional_u64(args, "timeout_ms")?;
    let result = crate::ipc::session_summarize(app, session_id, reason, timeout_ms)
        .await
        .map_err(ApiError::BadRequest)?;
    mcp_result_value(result)
}

#[cfg(test)]
async fn mcp_session_summarize(
    _state: &ApiState,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    test_mcp_session_lifecycle_unattached()
}

#[cfg(not(test))]
fn mcp_session_checkpoint(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let app = mcp_app_handle(state)?;
    let session_id = arg_string(args, "session_id")?;
    let summary_json = arg_optional_object_value(args, "summary_json")?;
    let summary_seq = arg_optional_u64(args, "summary_seq")?;
    let inflight_ref = arg_optional_string(args, "inflight_ref");
    let predecessor_session_id = arg_optional_string(args, "predecessor_session_id");
    let result = crate::ipc::session_checkpoint(
        app,
        session_id,
        summary_json,
        summary_seq,
        inflight_ref,
        predecessor_session_id,
    )
    .map_err(ApiError::BadRequest)?;
    mcp_result_value(result)
}

#[cfg(test)]
fn mcp_session_checkpoint(
    _state: &ApiState,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    test_mcp_session_lifecycle_unattached()
}

#[cfg(not(test))]
async fn mcp_session_handoff(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let app = mcp_app_handle(state)?;
    let session_id = arg_string(args, "session_id")?;
    let reason = arg_optional_string(args, "reason");
    let timeout_ms = arg_optional_u64(args, "timeout_ms")?;
    let cols = arg_optional_u16(args, "cols")?;
    let rows = arg_optional_u16(args, "rows")?;
    let result = crate::ipc::session_handoff(app, session_id, reason, timeout_ms, cols, rows)
        .await
        .map_err(ApiError::BadRequest)?;
    mcp_result_value(result)
}

#[cfg(test)]
async fn mcp_session_handoff(
    _state: &ApiState,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    test_mcp_session_lifecycle_unattached()
}

#[cfg(not(test))]
async fn mcp_session_resume(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let app = mcp_app_handle(state)?;
    let logical_session_id = arg_optional_string(args, "logical_session_id");
    let timeout_ms = arg_optional_u64(args, "timeout_ms")?;
    let result = crate::ipc::session_resume(app, logical_session_id, timeout_ms)
        .await
        .map_err(ApiError::BadRequest)?;
    mcp_result_value(result)
}

#[cfg(test)]
async fn mcp_session_resume(
    _state: &ApiState,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    test_mcp_session_lifecycle_unattached()
}

#[cfg(not(test))]
async fn mcp_session_reset_context(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let app = mcp_app_handle(state)?;
    let session_id = arg_string(args, "session_id")?;
    let timeout_ms = arg_optional_u64(args, "timeout_ms")?;
    let cols = arg_optional_u16(args, "cols")?;
    let rows = arg_optional_u16(args, "rows")?;
    let result = crate::ipc::session_reset_context(app, session_id, timeout_ms, cols, rows)
        .await
        .map_err(ApiError::BadRequest)?;
    mcp_result_value(result)
}

#[cfg(test)]
async fn mcp_session_reset_context(
    _state: &ApiState,
    _args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    test_mcp_session_lifecycle_unattached()
}

#[cfg(not(test))]
async fn mcp_approval_resolve(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    let terminal_ref = arg_string(args, "terminalId")?;
    // Unknown %N / terminal refs are TOOL errors (ok:false, aelys exit 2) —
    // same contract as pane.rename/set_role, not an HTTP 400 transport error.
    let terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let decision = arg_string(args, "decision")?;
    let expected_prompt_key = arg_string(args, "expectedPromptKey")?;
    let human_capability = arg_string(args, "humanApprovalCapability")?;
    if !state.auth.verify_input_authority(Some(&human_capability)) {
        return Ok(Err(
            "approval_capability_required: bearer API possession cannot resolve a human approval"
                .to_string(),
        ));
    }
    Ok(crate::ipc::resolve_interactive_approval_core(
        app,
        terminal_id,
        decision,
        Some(expected_prompt_key),
    )
    .await)
}

#[cfg(test)]
async fn mcp_approval_resolve(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let terminal_ref = arg_string(args, "terminalId")?;
    // Mirror the non-test path so the %N-miss tool-error contract is
    // exercised by tests.
    let _terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let _decision = arg_string(args, "decision")?;
    let expected_prompt_key = arg_string(args, "expectedPromptKey")?;
    let _human_capability = arg_string(args, "humanApprovalCapability")?;
    if expected_prompt_key == "stale-test" {
        Ok(Err(
            "stale_approval: prompt fingerprint changed for session test".to_string(),
        ))
    } else {
        Ok(Ok(()))
    }
}

fn approval_resolve_error_payload(err: &str) -> serde_json::Value {
    if err.contains("stale_approval") {
        serde_json::json!({ "stale_approval": err })
    } else {
        serde_json::json!({ "error": err })
    }
}

#[cfg(not(test))]
fn resolve_mcp_terminal_ref(state: &ApiState, reference: &str) -> ApiResult<String> {
    let trimmed = reference.trim();
    if !trimmed.starts_with('%') {
        return Ok(trimmed.to_string());
    }
    let app = mcp_app_handle(state)?;
    app.state::<crate::pty::PaneRegistry>()
        .resolve_terminal_ref(trimmed)
        .map_err(ApiError::BadRequest)
}

#[cfg(test)]
fn resolve_mcp_terminal_ref(_state: &ApiState, reference: &str) -> ApiResult<String> {
    let trimmed = reference.trim();
    if trimmed == "%404" {
        return Err(ApiError::BadRequest(format!(
            "unknown terminal reference `{trimmed}`"
        )));
    }
    Ok(trimmed.to_string())
}

struct McpPaneMetadataTarget {
    terminal_id: String,
    client_id_present: bool,
}

fn audit_mcp_pane_metadata_control(
    state: &ApiState,
    actor: &str,
    terminal_id: &str,
    operation: &str,
    client_id_present: bool,
    status: &str,
    rejection_code: Option<&str>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: Some(terminal_id.to_string()),
        pane_id: None,
        terminal_id: Some(terminal_id.to_string()),
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(terminal_id.to_string()),
        kind: "mcp_pane_metadata_authority".to_string(),
        severity: if status == "rejected" {
            "warning".to_string()
        } else {
            "info".to_string()
        },
        source: "mcp-pane-metadata".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "terminalId": terminal_id,
            "operation": operation,
            "clientIdPresent": client_id_present,
            "status": status,
            "rejectionCode": rejection_code,
            "metadataValueLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(terminal_id, actor, operation, error = %error, "pane metadata audit failed");
    }
}

fn resolve_mcp_pane_metadata_target(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    operation: &str,
) -> ApiResult<Result<McpPaneMetadataTarget, String>> {
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(ApiError::Forbidden(
            "authenticated pane metadata Principal is unavailable".to_string(),
        ));
    }
    let terminal_ref = arg_string(args, "terminalId")?;
    let terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let client_id =
        super::super::normalize_stream_client_id(arg_optional_string(args, "clientId").as_deref())?;
    if let Err(error) =
        state
            .controller_leases
            .ensure_can_control(&terminal_id, client_id.as_deref(), actor)
    {
        audit_mcp_pane_metadata_control(
            state,
            actor,
            &terminal_id,
            operation,
            client_id.is_some(),
            "rejected",
            Some("controller_lease_conflict"),
        );
        return Err(error);
    }
    Ok(Ok(McpPaneMetadataTarget {
        terminal_id,
        client_id_present: client_id.is_some(),
    }))
}

#[cfg(not(test))]
fn rename_pane_core(
    state: &ApiState,
    terminal_id: &str,
    name: &str,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    Ok(crate::ipc::rename_pane_core(&app, terminal_id, name))
}

#[cfg(test)]
fn rename_pane_core(
    _state: &ApiState,
    _terminal_id: &str,
    name: &str,
) -> ApiResult<Result<(), String>> {
    if name == "missing-pane" {
        Ok(Err("Pane missing-pane not found".to_string()))
    } else {
        Ok(Ok(()))
    }
}

#[cfg(not(test))]
fn set_pane_role_core(
    state: &ApiState,
    terminal_id: &str,
    role: &str,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    Ok(crate::ipc::set_pane_role_core(&app, terminal_id, role))
}

#[cfg(test)]
fn set_pane_role_core(
    _state: &ApiState,
    _terminal_id: &str,
    role: &str,
) -> ApiResult<Result<(), String>> {
    if role == "missing-role" {
        Ok(Err("Pane role target not found".to_string()))
    } else {
        Ok(Ok(()))
    }
}

fn mcp_pane_metadata_mutation(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    operation: &str,
    value_key: &str,
    mutate: fn(&ApiState, &str, &str) -> ApiResult<Result<(), String>>,
) -> ApiResult<Result<(), String>> {
    let value = arg_string(args, value_key)?;
    let target = match resolve_mcp_pane_metadata_target(state, actor, args, operation)? {
        Ok(target) => target,
        Err(error) => return Ok(Err(error)),
    };
    let result = match mutate(state, &target.terminal_id, &value) {
        Ok(result) => result,
        Err(error) => {
            audit_mcp_pane_metadata_control(
                state,
                actor,
                &target.terminal_id,
                operation,
                target.client_id_present,
                "rejected",
                Some("pane_runtime_unavailable"),
            );
            return Err(error);
        }
    };
    audit_mcp_pane_metadata_control(
        state,
        actor,
        &target.terminal_id,
        operation,
        target.client_id_present,
        if result.is_ok() {
            "accepted"
        } else {
            "rejected"
        },
        result.as_ref().err().map(|_| "pane_mutation_failed"),
    );
    Ok(result)
}

fn mcp_pane_rename(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    mcp_pane_metadata_mutation(state, actor, args, "rename", "name", rename_pane_core)
}

fn mcp_pane_set_role(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    mcp_pane_metadata_mutation(state, actor, args, "set_role", "role", set_pane_role_core)
}

fn authenticated_lifecycle_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated agent lifecycle Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn audit_mcp_agent_lifecycle(
    state: &ApiState,
    actor: &str,
    operation: &str,
    runtime_kind: &str,
    session_id: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: session_id.map(str::to_string),
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: session_id.map(str::to_string),
        kind: "mcp_agent_lifecycle_authority".to_string(),
        severity: if status == "rejected" {
            "warning".to_string()
        } else {
            "info".to_string()
        },
        source: "mcp-agent-lifecycle".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "runtimeKind": runtime_kind,
            "sessionId": session_id,
            "status": status,
            "rejectionCode": rejection_code,
            "taskPayloadLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, runtime_kind, error = %error, "agent lifecycle audit failed");
    }
}

#[cfg(not(test))]
fn mcp_spawn_headless(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<String> {
    let manager = state.agent_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("agent runtime is not attached to this process".to_string())
    })?;
    let prompt = arg_string(args, "prompt")?;
    let cwd = arg_string(args, "cwd")?;
    let model = arg_optional_string(args, "model");
    let allowed_tools = arg_optional_string_array(args, "allowedTools")?;
    let resume_id = arg_optional_string(args, "resumeId");
    if let Some(cost) = state.cost_manager.as_ref() {
        let active_agents = crate::control::agent::list_headless(manager).len();
        cost.guard_spawn(active_agents)
            .map_err(ApiError::BadRequest)?;
    }
    crate::control::agent::start_headless(
        manager,
        crate::control::agent::HeadlessSpawnSpec {
            prompt,
            cwd,
            model,
            allowed_tools,
            resume_id,
        },
    )
    .map_err(ApiError::BadRequest)
}

#[cfg(test)]
fn mcp_spawn_headless(
    _state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<String> {
    let _prompt = arg_string(args, "prompt")?;
    let cwd = arg_string(args, "cwd")?;
    let _model = arg_optional_string(args, "model");
    let _allowed_tools = arg_optional_string_array(args, "allowedTools")?;
    let _resume_id = arg_optional_string(args, "resumeId");
    if cwd == "headless-deny" {
        Err(ApiError::BadRequest(
            "headless spawn denied: test".to_string(),
        ))
    } else {
        Ok("session-headless".to_string())
    }
}

#[cfg(not(test))]
async fn mcp_spawn_visible(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<serde_json::Value, String>> {
    let app = mcp_app_handle(state)?;
    let cwd = arg_string(args, "cwd")?;
    let model = arg_optional_string(args, "model");
    let initial_prompt = arg_optional_string(args, "initialPrompt");
    let branch_name = arg_optional_string(args, "branchName");
    let cols = arg_optional_u16(args, "cols")?.unwrap_or(120);
    let rows = arg_optional_u16(args, "rows")?.unwrap_or(30);
    match crate::ipc::spawn_interactive_agent_internal(
        app,
        cwd,
        model,
        initial_prompt,
        branch_name,
        cols,
        rows,
        crate::ipc::SpawnInteractiveAgentOptions::default(),
    )
    .await
    {
        Ok(result) => Ok(Ok(mcp_result_value(result)?)),
        Err(err) => Ok(Err(err)),
    }
}

#[cfg(test)]
async fn mcp_spawn_visible(
    _state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<serde_json::Value, String>> {
    let cwd = arg_string(args, "cwd")?;
    let _model = arg_optional_string(args, "model");
    let _initial_prompt = arg_optional_string(args, "initialPrompt");
    let _branch_name = arg_optional_string(args, "branchName");
    if cwd == "cost-deny" {
        return Ok(Err("cost cap denied: test".to_string()));
    }
    Ok(Ok(serde_json::json!({
        "session_id": "session-visible",
        "pty_id": "pty-visible",
        "worktree_path": null,
        "backend": "sidecar",
    })))
}

#[cfg(not(test))]
fn mcp_stop_headless(state: &ApiState, session_id: &str) -> ApiResult<String> {
    let manager = state.agent_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("agent runtime is not attached to this process".to_string())
    })?;
    crate::control::agent::stop_headless(manager, session_id).map_err(ApiError::BadRequest)?;
    Ok(session_id.to_string())
}

#[cfg(test)]
fn mcp_stop_headless(_state: &ApiState, session_id: &str) -> ApiResult<String> {
    if session_id == "missing-session" {
        Err(ApiError::BadRequest(
            "agent session missing: test".to_string(),
        ))
    } else {
        Ok(session_id.to_string())
    }
}

fn authenticated_worktree_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated worktree mutation Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn worktree_target_digest(
    operation: &str,
    repo_path: &str,
    target: &str,
    delete_branch: bool,
) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.worktree\n{operation}\n{repo_path}\n{target}\n{delete_branch}"
    ))
    .as_str()
    .to_string()
}

fn audit_mcp_worktree_mutation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    target_digest: &str,
    delete_branch: bool,
    status: &str,
    rejection_code: Option<&str>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(target_digest.to_string()),
        kind: "mcp_worktree_mutation_authority".to_string(),
        severity: if status == "rejected" {
            "warning".to_string()
        } else {
            "info".to_string()
        },
        source: "mcp-worktree-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "targetDigest": target_digest,
            "deleteBranch": delete_branch,
            "status": status,
            "rejectionCode": rejection_code,
            "targetValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, target_digest, error = %error, "worktree mutation audit failed");
    }
}

fn authenticated_task_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated task mutation Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn task_target_digest(task_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.task\n{task_id}"))
        .as_str()
        .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_task_mutation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    task_digest: &str,
    resulting_status: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    mutation_applied: bool,
    event_published: Option<bool>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(task_digest.to_string()),
        kind: "mcp_task_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-task-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "taskDigest": task_digest,
            "resultingStatus": resulting_status,
            "status": status,
            "rejectionCode": rejection_code,
            "mutationApplied": mutation_applied,
            "eventPublished": event_published,
            "taskPacketLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, task_digest, error = %error, "task mutation audit failed");
    }
}

fn mcp_task_create(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_task_actor(actor)?;
    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("task graph is not attached to this process".to_string())
    })?;
    let task_id = arg_string(args, "id")?;
    let task_digest = task_target_digest(&task_id);
    let mut task = crate::task::Task::new(task_id.clone(), arg_string(args, "title")?);
    if let Some(description) = arg_optional_string(args, "description") {
        task.description = description;
    }
    task.owner = arg_optional_string(args, "owner");
    task.model = arg_optional_string(args, "model");
    if let Some(priority) = args.get("priority").and_then(|value| value.as_str()) {
        task.priority = serde_json::from_value(serde_json::Value::String(priority.to_string()))
            .map_err(|_| ApiError::BadRequest(format!("invalid priority `{priority}`")))?;
    }
    if let Some(dependencies) = arg_optional_string_array(args, "dependencies")? {
        task.dependencies = dependencies;
    }
    if let Some(outputs) = arg_optional_string_array(args, "outputs")? {
        task.outputs = outputs;
    }
    if args.contains_key("symbols") {
        audit_mcp_task_mutation(
            state,
            actor,
            "create",
            &task_digest,
            None,
            "rejected",
            Some("caller_symbols_forbidden"),
            false,
            None,
        );
        return Err(ApiError::BadRequest(
            "task symbols cannot be set via task.create — they are derived from \
             verified source by the planner's symbol-enrichment step"
                .to_string(),
        ));
    }
    if let (Some(source), Some(target)) = (
        arg_optional_string(args, "sourceBranch"),
        arg_optional_string(args, "targetBranch"),
    ) {
        task = task.with_branches(source, target);
    }

    let title = task.title.clone();
    let changed = match tasks.create(task) {
        Ok(changed) => changed,
        Err(error) => {
            audit_mcp_task_mutation(
                state,
                actor,
                "create",
                &task_digest,
                tasks.get(&task_id).map(|task| task.status.as_str()),
                "rejected",
                Some("task_create_failed"),
                false,
                None,
            );
            return Err(ApiError::BadRequest(error.to_string()));
        }
    };
    let resulting_status = tasks.get(&task_id).map(|task| task.status);
    let event_published = if let Some(bus) = state.event_bus.as_ref() {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::TaskCreated,
            serde_json::json!({ "id": task_id, "title": title }),
        )) {
            audit_mcp_task_mutation(
                state,
                actor,
                "create",
                &task_digest,
                resulting_status.map(crate::task::TaskStatus::as_str),
                "rejected",
                Some("task_event_publication_failed"),
                true,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit_mcp_task_mutation(
        state,
        actor,
        "create",
        &task_digest,
        resulting_status.map(crate::task::TaskStatus::as_str),
        "accepted",
        None,
        true,
        event_published,
    );
    Ok(serde_json::json!({
        "id": task_id,
        "created": true,
        "changed": changed,
    }))
}

fn mcp_task_transition(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_task_actor(actor)?;
    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("task graph is not attached to this process".to_string())
    })?;
    let task_id = arg_string(args, "id")?;
    let task_digest = task_target_digest(&task_id);
    let to_raw = arg_string(args, "to")?;
    let to: crate::task::TaskStatus =
        serde_json::from_value(serde_json::Value::String(to_raw.clone()))
            .map_err(|_| ApiError::BadRequest(format!("invalid task status `{to_raw}`")))?;
    let changed = match tasks.transition(&task_id, to) {
        Ok(changed) => changed,
        Err(error) => {
            audit_mcp_task_mutation(
                state,
                actor,
                "transition",
                &task_digest,
                tasks.get(&task_id).map(|task| task.status.as_str()),
                "rejected",
                Some("task_transition_failed"),
                false,
                None,
            );
            return Err(ApiError::BadRequest(error.to_string()));
        }
    };
    let resulting_status = tasks.get(&task_id).map(|task| task.status);
    let event_kind = match to {
        crate::task::TaskStatus::Review => Some(crate::event_bus::AgentEventKind::ReviewRequired),
        crate::task::TaskStatus::Done => Some(crate::event_bus::AgentEventKind::TaskCompleted),
        _ => None,
    };
    let event_published = if let (Some(bus), Some(kind)) = (state.event_bus.as_ref(), event_kind) {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            kind,
            serde_json::json!({ "id": task_id }),
        )) {
            audit_mcp_task_mutation(
                state,
                actor,
                "transition",
                &task_digest,
                resulting_status.map(crate::task::TaskStatus::as_str),
                "rejected",
                Some("task_event_publication_failed"),
                true,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit_mcp_task_mutation(
        state,
        actor,
        "transition",
        &task_digest,
        resulting_status.map(crate::task::TaskStatus::as_str),
        "accepted",
        None,
        true,
        event_published,
    );
    Ok(serde_json::json!({
        "id": task_id,
        "to": to_raw,
        "changed": changed,
    }))
}

fn authenticated_file_ownership_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated file-ownership assignment Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn file_ownership_assignment_digest(agent_id: &str, pattern: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.file-ownership\nassign\n{agent_id}\n{pattern}"
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_file_ownership_assignment(
    state: &ApiState,
    actor: &str,
    assignment_digest: &str,
    conflict_count: Option<usize>,
    status: &str,
    rejection_code: Option<&str>,
    persistence_applied: bool,
    memory_applied: bool,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(assignment_digest.to_string()),
        kind: "mcp_file_ownership_assignment_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-file-ownership-assignment".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "assign",
            "assignmentDigest": assignment_digest,
            "conflictCount": conflict_count,
            "status": status,
            "rejectionCode": rejection_code,
            "persistenceApplied": persistence_applied,
            "memoryApplied": memory_applied,
            "assignmentValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, assignment_digest, error = %error, "file ownership assignment audit failed");
    }
}

fn mcp_file_ownership_assign(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_file_ownership_actor(actor)?;
    let ownership = state.file_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("file ownership is not attached to this process".to_string())
    })?;
    let agent_id = arg_string(args, "agentId")?;
    let pattern = arg_string(args, "pattern")?;
    let assignment_digest = file_ownership_assignment_digest(&agent_id, &pattern);
    let claim = crate::file_ownership::OwnershipClaim::new(agent_id.clone(), pattern.clone());
    if let Err(error) = ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::upsert_file_claim(database, &claim, now_secs())
        })
        .map_err(ApiError::Internal)
    }) {
        audit_mcp_file_ownership_assignment(
            state,
            actor,
            &assignment_digest,
            None,
            "rejected",
            Some("ownership_persistence_failed"),
            false,
            false,
        );
        return Err(error);
    }
    let conflicts = match ownership.lock() {
        Ok(mut owner) => {
            owner.assign_claim(claim);
            owner.conflicts()
        }
        Err(_) => {
            audit_mcp_file_ownership_assignment(
                state,
                actor,
                &assignment_digest,
                None,
                "rejected",
                Some("ownership_memory_lock_failed"),
                true,
                false,
            );
            return Err(ApiError::Internal(
                "file ownership lock poisoned".to_string(),
            ));
        }
    };
    audit_mcp_file_ownership_assignment(
        state,
        actor,
        &assignment_digest,
        Some(conflicts.len()),
        "accepted",
        None,
        true,
        true,
    );
    Ok(serde_json::json!({
        "agentId": agent_id,
        "pattern": pattern,
        "conflicts": conflicts,
    }))
}

fn authenticated_symbol_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated symbol-ownership mutation Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn symbol_target_digest(kind: &str, target: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.symbol-ownership\n{kind}\n{target}"
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_symbol_mutation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    target_digest: &str,
    outcome_class: Option<&str>,
    outcome_count: Option<usize>,
    status: &str,
    rejection_code: Option<&str>,
    persistence_applied: bool,
    memory_applied: bool,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(target_digest.to_string()),
        kind: "mcp_symbol_ownership_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-symbol-ownership-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "targetDigest": target_digest,
            "outcomeClass": outcome_class,
            "outcomeCount": outcome_count,
            "status": status,
            "rejectionCode": rejection_code,
            "persistenceApplied": persistence_applied,
            "memoryApplied": memory_applied,
            "targetValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, target_digest, error = %error, "symbol ownership audit failed");
    }
}

fn symbol_claim_outcome_metadata(
    outcome: &crate::symbol_ownership::ClaimOutcome,
) -> (&'static str, usize, bool) {
    match outcome {
        crate::symbol_ownership::ClaimOutcome::Granted => ("granted", 0, true),
        crate::symbol_ownership::ClaimOutcome::Blocked { conflicts } => {
            ("blocked", conflicts.len(), false)
        }
        crate::symbol_ownership::ClaimOutcome::Warned { conflicts } => {
            ("warned", conflicts.len(), true)
        }
    }
}

fn mcp_symbol_claim(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let claim_id = arg_string(args, "claimId")?;
    let target_digest = symbol_target_digest("claim", &claim_id);
    if claim_id.starts_with("parse:") || claim_id.starts_with("dh:") {
        audit_mcp_symbol_mutation(
            state,
            actor,
            "claim",
            &target_digest,
            None,
            None,
            "rejected",
            Some("reserved_claim_prefix"),
            false,
            false,
        );
        return Err(ApiError::BadRequest(
            "claimId prefix `parse:`/`dh:` is reserved for derived claims".to_string(),
        ));
    }
    let now = now_secs();
    let lease_secs = args
        .get("leaseSecs")
        .and_then(|value| value.as_u64())
        .unwrap_or(300);
    let start_line = args
        .get("startLine")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| ApiError::BadRequest("startLine must be an integer".to_string()))?
        as u32;
    let end_line = args
        .get("endLine")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| ApiError::BadRequest("endLine must be an integer".to_string()))?
        as u32;
    let mode: crate::symbol_ownership::ClaimMode =
        serde_json::from_value(args.get("mode").cloned().unwrap_or(serde_json::Value::Null))
            .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?;
    let confidence: crate::symbol_ownership::Confidence = serde_json::from_value(
        args.get("confidence")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|_| ApiError::BadRequest("invalid confidence".to_string()))?;
    let claim = crate::symbol_ownership::SymbolClaim {
        claim_id,
        agent_id: arg_string(args, "agentId")?,
        task_id: args
            .get("taskId")
            .and_then(|value| value.as_str())
            .map(String::from),
        path: arg_string(args, "path")?.replace('\\', "/"),
        symbol: arg_string(args, "symbol")?,
        range: crate::symbol_ownership::SymbolRange::new(start_line, end_line),
        mode,
        lease_expires_at: now.saturating_add(lease_secs),
        confidence,
    };
    let mut owner = match ownership.lock() {
        Ok(owner) => owner,
        Err(_) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "claim",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_memory_lock_failed"),
                false,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    let mut staging = owner.clone();
    let outcome = staging.claim(claim.clone(), now);
    let (outcome_class, outcome_count, mutation_applied) = symbol_claim_outcome_metadata(&outcome);
    let serialized = serde_json::to_value(&outcome)
        .map_err(|error| ApiError::Internal(format!("serialize symbol outcome: {error}")))?;
    if !mutation_applied {
        drop(owner);
        audit_mcp_symbol_mutation(
            state,
            actor,
            "claim",
            &target_digest,
            Some(outcome_class),
            Some(outcome_count),
            "accepted",
            None,
            false,
            false,
        );
        return Ok(serialized);
    }
    if let Err(error) = ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::upsert_symbol_claim(database, &claim, now)
        })
        .map_err(ApiError::Internal)
    }) {
        drop(owner);
        audit_mcp_symbol_mutation(
            state,
            actor,
            "claim",
            &target_digest,
            Some(outcome_class),
            Some(outcome_count),
            "rejected",
            Some("symbol_persistence_failed"),
            false,
            false,
        );
        return Err(error);
    }
    *owner = staging;
    drop(owner);
    audit_mcp_symbol_mutation(
        state,
        actor,
        "claim",
        &target_digest,
        Some(outcome_class),
        Some(outcome_count),
        "accepted",
        None,
        true,
        true,
    );
    Ok(serialized)
}

fn mcp_symbol_refresh(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let claim_id = arg_string(args, "claimId")?;
    let target_digest = symbol_target_digest("claim", &claim_id);
    let lease_secs = args
        .get("leaseSecs")
        .and_then(|value| value.as_u64())
        .unwrap_or(300);
    let now = now_secs();
    let mut owner = match ownership.lock() {
        Ok(owner) => owner,
        Err(_) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "refresh",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_memory_lock_failed"),
                false,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    let mut staging = owner.clone();
    if !staging.refresh(&claim_id, now, lease_secs) {
        drop(owner);
        audit_mcp_symbol_mutation(
            state,
            actor,
            "refresh",
            &target_digest,
            Some("missing"),
            Some(0),
            "accepted",
            None,
            false,
            false,
        );
        return Ok(serde_json::json!({ "refreshed": false }));
    }
    let claim = staging.get(&claim_id).cloned().ok_or_else(|| {
        ApiError::Internal("refreshed symbol claim vanished from staging".to_string())
    })?;
    if let Err(error) = ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::upsert_symbol_claim(database, &claim, now)
        })
        .map_err(ApiError::Internal)
    }) {
        drop(owner);
        audit_mcp_symbol_mutation(
            state,
            actor,
            "refresh",
            &target_digest,
            Some("refreshed"),
            Some(1),
            "rejected",
            Some("symbol_persistence_failed"),
            false,
            false,
        );
        return Err(error);
    }
    *owner = staging;
    drop(owner);
    audit_mcp_symbol_mutation(
        state,
        actor,
        "refresh",
        &target_digest,
        Some("refreshed"),
        Some(1),
        "accepted",
        None,
        true,
        true,
    );
    Ok(serde_json::json!({ "refreshed": true }))
}

fn mcp_symbol_release(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let claim_id = arg_string(args, "claimId")?;
    let target_digest = symbol_target_digest("claim", &claim_id);
    let persisted = match ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::delete_symbol_claim(database, &claim_id)
        })
        .map_err(ApiError::Internal)
    }) {
        Ok(persisted) => persisted,
        Err(error) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "release",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_persistence_failed"),
                false,
                false,
            );
            return Err(error);
        }
    };
    let released = match ownership.lock() {
        Ok(mut owner) => owner.release(&claim_id),
        Err(_) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "release",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_memory_lock_failed"),
                persisted,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    audit_mcp_symbol_mutation(
        state,
        actor,
        "release",
        &target_digest,
        Some(if released { "released" } else { "missing" }),
        Some(usize::from(released)),
        "accepted",
        None,
        persisted,
        released,
    );
    Ok(serde_json::json!({ "released": released }))
}

fn mcp_symbol_release_task(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let task_id = arg_string(args, "taskId")?;
    let target_digest = symbol_target_digest("task", &task_id);
    let persisted = match ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::delete_symbol_claims_for_task(database, &task_id)
        })
        .map_err(ApiError::Internal)
    }) {
        Ok(persisted) => persisted,
        Err(error) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "release_task",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_persistence_failed"),
                false,
                false,
            );
            return Err(error);
        }
    };
    let released = match ownership.lock() {
        Ok(mut owner) => owner.release_for_task(&task_id),
        Err(_) => {
            audit_mcp_symbol_mutation(
                state,
                actor,
                "release_task",
                &target_digest,
                None,
                None,
                "rejected",
                Some("symbol_memory_lock_failed"),
                persisted > 0,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    audit_mcp_symbol_mutation(
        state,
        actor,
        "release_task",
        &target_digest,
        Some(if released > 0 { "released" } else { "missing" }),
        Some(released),
        "accepted",
        None,
        persisted > 0,
        released > 0,
    );
    Ok(serde_json::json!({ "released": released }))
}

#[derive(Default)]
struct DerivedSymbolOutcomeCounts {
    granted: usize,
    warned: usize,
    blocked: usize,
}

impl DerivedSymbolOutcomeCounts {
    fn observe(&mut self, outcome: &crate::symbol_ownership::ClaimOutcome) {
        match outcome {
            crate::symbol_ownership::ClaimOutcome::Granted => self.granted += 1,
            crate::symbol_ownership::ClaimOutcome::Warned { .. } => self.warned += 1,
            crate::symbol_ownership::ClaimOutcome::Blocked { .. } => self.blocked += 1,
        }
    }
}

fn derived_symbol_origin_digest(
    operation: &str,
    agent_id: &str,
    task_id: Option<&str>,
    path: Option<&str>,
) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.derived-symbol\n{operation}\n{agent_id}\n{}\n{}",
        task_id.unwrap_or(""),
        path.unwrap_or("")
    ))
    .as_str()
    .to_string()
}

fn derived_symbol_input_digest(operation: &str, input: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.derived-symbol-input\n{operation}\n{input}"
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_derived_symbol_reconciliation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    origin_digest: &str,
    input_digest: &str,
    derived_count: Option<usize>,
    recorded_count: Option<usize>,
    counts: Option<&DerivedSymbolOutcomeCounts>,
    fallback: Option<bool>,
    status: &str,
    rejection_code: Option<&str>,
    persistence_applied: bool,
    memory_applied: bool,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(origin_digest.to_string()),
        kind: "mcp_derived_symbol_reconciliation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-derived-symbol-reconciliation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "originDigest": origin_digest,
            "inputDigest": input_digest,
            "derivedCount": derived_count,
            "recordedCount": recorded_count,
            "grantedCount": counts.map(|value| value.granted),
            "warnedCount": counts.map(|value| value.warned),
            "blockedCount": counts.map(|value| value.blocked),
            "fallback": fallback,
            "status": status,
            "rejectionCode": rejection_code,
            "persistenceApplied": persistence_applied,
            "memoryApplied": memory_applied,
            "inputValuesLogged": false,
            "targetValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, origin_digest, error = %error, "derived symbol audit failed");
    }
}

fn mcp_symbol_claim_from_diff(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let now = now_secs();
    let lease_secs = args
        .get("leaseSecs")
        .and_then(|value| value.as_u64())
        .unwrap_or(300);
    let agent_id = arg_string(args, "agentId")?;
    let task_id = args
        .get("taskId")
        .and_then(|value| value.as_str())
        .map(String::from);
    let diff = arg_string_raw(args, "diff")?;
    let origin_digest =
        derived_symbol_origin_digest("claim_from_diff", &agent_id, task_id.as_deref(), None);
    let input_digest = derived_symbol_input_digest("claim_from_diff", &diff);
    if diff.len() > 1_048_576 {
        audit_mcp_derived_symbol_reconciliation(
            state,
            actor,
            "claim_from_diff",
            &origin_digest,
            &input_digest,
            None,
            None,
            None,
            None,
            "rejected",
            Some("derived_input_too_large"),
            false,
            false,
        );
        return Err(ApiError::BadRequest("diff exceeds 1 MiB".to_string()));
    }
    let mode: crate::symbol_ownership::ClaimMode = match args.get("mode") {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?,
        None => crate::symbol_ownership::ClaimMode::Write,
    };
    let intents = crate::symbol_ownership::extract::intents_from_diff(&diff, mode);
    let derived_count = intents.len();
    let mut claims = Vec::new();
    let mut recorded = 0usize;
    let mut counts = DerivedSymbolOutcomeCounts::default();
    let mut delete_claim_ids = Vec::new();
    let mut upsert_claims = Vec::new();
    let mut owner = match ownership.lock() {
        Ok(owner) => owner,
        Err(_) => {
            audit_mcp_derived_symbol_reconciliation(
                state,
                actor,
                "claim_from_diff",
                &origin_digest,
                &input_digest,
                Some(derived_count),
                None,
                None,
                None,
                "rejected",
                Some("symbol_memory_lock_failed"),
                false,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    let mut staging = owner.clone();
    staging.expire(now);
    for intent in intents {
        let claim_id = format!(
            "dh:{agent_id}:{}:{}-{}",
            intent.path, intent.range.start_line, intent.range.end_line
        );
        staging.release(&claim_id);
        delete_claim_ids.push(claim_id.clone());
        let claim = crate::symbol_ownership::SymbolClaim {
            claim_id: claim_id.clone(),
            agent_id: agent_id.clone(),
            task_id: task_id.clone(),
            path: intent.path,
            symbol: intent.symbol,
            range: intent.range,
            mode: intent.mode,
            lease_expires_at: now.saturating_add(lease_secs),
            confidence: intent.confidence,
        };
        let outcome = staging.claim(claim.clone(), now);
        counts.observe(&outcome);
        if !matches!(
            outcome,
            crate::symbol_ownership::ClaimOutcome::Blocked { .. }
        ) {
            recorded += 1;
            upsert_claims.push(claim);
        }
        claims.push(serde_json::json!({ "claimId": claim_id, "outcome": outcome }));
    }
    if let Err(error) = ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::reconcile_symbol_claims(
                database,
                &delete_claim_ids,
                &[],
                &upsert_claims,
                now,
            )
        })
        .map_err(ApiError::Internal)
    }) {
        drop(owner);
        audit_mcp_derived_symbol_reconciliation(
            state,
            actor,
            "claim_from_diff",
            &origin_digest,
            &input_digest,
            Some(derived_count),
            Some(recorded),
            Some(&counts),
            None,
            "rejected",
            Some("symbol_reconciliation_failed"),
            false,
            false,
        );
        return Err(error);
    }
    *owner = staging;
    drop(owner);
    audit_mcp_derived_symbol_reconciliation(
        state,
        actor,
        "claim_from_diff",
        &origin_digest,
        &input_digest,
        Some(derived_count),
        Some(recorded),
        Some(&counts),
        None,
        "accepted",
        None,
        true,
        true,
    );
    Ok(serde_json::json!({ "recorded": recorded, "claims": claims }))
}

fn mcp_symbol_claim_from_source(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_symbol_actor(actor)?;
    let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
        ApiError::Internal("symbol ownership is not attached to this process".to_string())
    })?;
    let now = now_secs();
    let lease_secs = args
        .get("leaseSecs")
        .and_then(|value| value.as_u64())
        .unwrap_or(300);
    let agent_id = arg_string(args, "agentId")?;
    let task_id = args
        .get("taskId")
        .and_then(|value| value.as_str())
        .map(String::from);
    let path = arg_string(args, "path")?.replace('\\', "/");
    let source = arg_string_raw(args, "source")?;
    let origin_digest = derived_symbol_origin_digest(
        "claim_from_source",
        &agent_id,
        task_id.as_deref(),
        Some(&path),
    );
    let input_digest = derived_symbol_input_digest("claim_from_source", &source);
    if source.len() > 1_048_576 {
        audit_mcp_derived_symbol_reconciliation(
            state,
            actor,
            "claim_from_source",
            &origin_digest,
            &input_digest,
            None,
            None,
            None,
            None,
            "rejected",
            Some("derived_input_too_large"),
            false,
            false,
        );
        return Err(ApiError::BadRequest("source exceeds 1 MiB".to_string()));
    }
    let mode: crate::symbol_ownership::ClaimMode = match args.get("mode") {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?,
        None => crate::symbol_ownership::ClaimMode::Write,
    };
    let intents = crate::symbol_ownership::extract::intents_from_source(&path, &source, mode);
    let fallback = intents.is_empty();
    let derived_count = intents.len();
    let mut claims = Vec::new();
    let mut recorded = 0usize;
    let mut counts = DerivedSymbolOutcomeCounts::default();
    let reconcile_prefix = format!("parse:{agent_id}:{path}:");
    let mut upsert_claims = Vec::new();
    let mut owner = match ownership.lock() {
        Ok(owner) => owner,
        Err(_) => {
            audit_mcp_derived_symbol_reconciliation(
                state,
                actor,
                "claim_from_source",
                &origin_digest,
                &input_digest,
                Some(derived_count),
                None,
                None,
                Some(fallback),
                "rejected",
                Some("symbol_memory_lock_failed"),
                false,
                false,
            );
            return Err(ApiError::Internal(
                "symbol ownership lock poisoned".to_string(),
            ));
        }
    };
    let mut staging = owner.clone();
    staging.expire(now);
    staging.release_for_prefix(&reconcile_prefix);
    for intent in intents {
        let claim_id = format!(
            "parse:{agent_id}:{}:{}@{}-{}",
            intent.path, intent.symbol, intent.range.start_line, intent.range.end_line
        );
        let claim = crate::symbol_ownership::SymbolClaim {
            claim_id: claim_id.clone(),
            agent_id: agent_id.clone(),
            task_id: task_id.clone(),
            path: intent.path,
            symbol: intent.symbol,
            range: intent.range,
            mode: intent.mode,
            lease_expires_at: now.saturating_add(lease_secs),
            confidence: intent.confidence,
        };
        let outcome = staging.claim(claim.clone(), now);
        counts.observe(&outcome);
        if !matches!(
            outcome,
            crate::symbol_ownership::ClaimOutcome::Blocked { .. }
        ) {
            recorded += 1;
            upsert_claims.push(claim);
        }
        claims.push(serde_json::json!({ "claimId": claim_id, "outcome": outcome }));
    }
    if let Err(error) = ownership_db(state).and_then(|db| {
        db.with(|database| {
            crate::persistence::OwnershipRepo::reconcile_symbol_claims(
                database,
                &[],
                std::slice::from_ref(&reconcile_prefix),
                &upsert_claims,
                now,
            )
        })
        .map_err(ApiError::Internal)
    }) {
        drop(owner);
        audit_mcp_derived_symbol_reconciliation(
            state,
            actor,
            "claim_from_source",
            &origin_digest,
            &input_digest,
            Some(derived_count),
            Some(recorded),
            Some(&counts),
            Some(fallback),
            "rejected",
            Some("symbol_reconciliation_failed"),
            false,
            false,
        );
        return Err(error);
    }
    *owner = staging;
    drop(owner);
    audit_mcp_derived_symbol_reconciliation(
        state,
        actor,
        "claim_from_source",
        &origin_digest,
        &input_digest,
        Some(derived_count),
        Some(recorded),
        Some(&counts),
        Some(fallback),
        "accepted",
        None,
        true,
        true,
    );
    Ok(serde_json::json!({
        "recorded": recorded,
        "fallback": fallback,
        "claims": claims,
    }))
}

fn authenticated_context_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated context mutation Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn context_decision_digest(key: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.context\n{key}"))
        .as_str()
        .to_string()
}

fn context_input_digest(operation: &str, key: &str, value: Option<&str>) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.context-input\n{operation}\n{key}\n{}",
        value.unwrap_or("")
    ))
    .as_str()
    .to_string()
}

fn context_change_kind(
    operation: &str,
    change: Option<&crate::context_store::DecisionChange>,
) -> &'static str {
    match (operation, change) {
        (_, None) => "no_change",
        ("set", Some(change)) if change.previous.is_none() => "created",
        ("set", Some(_)) => "updated",
        ("remove", Some(_)) => "removed",
        _ => "changed",
    }
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_context_mutation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    decision_digest: &str,
    input_digest: &str,
    change_kind: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    mutation_applied: bool,
    event_published: Option<bool>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(decision_digest.to_string()),
        kind: "mcp_context_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-context-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "decisionDigest": decision_digest,
            "inputDigest": input_digest,
            "changeKind": change_kind,
            "status": status,
            "rejectionCode": rejection_code,
            "mutationApplied": mutation_applied,
            "eventPublished": event_published,
            "decisionValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, decision_digest, error = %error, "context mutation audit failed");
    }
}

fn mcp_context_set(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_context_actor(actor)?;
    let store = state.context_store.as_ref().ok_or_else(|| {
        ApiError::Internal("context store is not attached to this process".to_string())
    })?;
    let key = arg_string(args, "key")?;
    let value = arg_string(args, "value")?;
    let decision_digest = context_decision_digest(&key);
    let input_digest = context_input_digest("set", &key, Some(&value));
    let change = match store.set(key, value) {
        Ok(change) => change,
        Err(error) => {
            audit_mcp_context_mutation(
                state,
                actor,
                "set",
                &decision_digest,
                &input_digest,
                None,
                "rejected",
                Some("context_persistence_failed"),
                false,
                None,
            );
            return Err(ApiError::Internal(error));
        }
    };
    let change_kind = context_change_kind("set", change.as_ref());
    let event_published = if let (Some(change), Some(bus)) = (&change, state.event_bus.as_ref()) {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::DecisionChanged,
            serde_json::to_value(change).unwrap_or(serde_json::Value::Null),
        )) {
            audit_mcp_context_mutation(
                state,
                actor,
                "set",
                &decision_digest,
                &input_digest,
                Some(change_kind),
                "rejected",
                Some("context_event_publication_failed"),
                true,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit_mcp_context_mutation(
        state,
        actor,
        "set",
        &decision_digest,
        &input_digest,
        Some(change_kind),
        "accepted",
        None,
        change.is_some(),
        event_published,
    );
    Ok(serde_json::json!({ "change": change }))
}

fn mcp_context_remove(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_context_actor(actor)?;
    let store = state.context_store.as_ref().ok_or_else(|| {
        ApiError::Internal("context store is not attached to this process".to_string())
    })?;
    let key = arg_string(args, "key")?;
    let decision_digest = context_decision_digest(&key);
    let input_digest = context_input_digest("remove", &key, None);
    let change = match store.remove(&key) {
        Ok(change) => change,
        Err(error) => {
            audit_mcp_context_mutation(
                state,
                actor,
                "remove",
                &decision_digest,
                &input_digest,
                None,
                "rejected",
                Some("context_persistence_failed"),
                false,
                None,
            );
            return Err(ApiError::Internal(error));
        }
    };
    let change_kind = context_change_kind("remove", change.as_ref());
    let event_published = if let (Some(change), Some(bus)) = (&change, state.event_bus.as_ref()) {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::DecisionChanged,
            serde_json::to_value(change).unwrap_or(serde_json::Value::Null),
        )) {
            audit_mcp_context_mutation(
                state,
                actor,
                "remove",
                &decision_digest,
                &input_digest,
                Some(change_kind),
                "rejected",
                Some("context_event_publication_failed"),
                true,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit_mcp_context_mutation(
        state,
        actor,
        "remove",
        &decision_digest,
        &input_digest,
        Some(change_kind),
        "accepted",
        None,
        change.is_some(),
        event_published,
    );
    Ok(serde_json::json!({ "change": change }))
}

fn authenticated_intent_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated intent mutation Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn intent_target_digest(intent_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.intent\n{intent_id}"))
        .as_str()
        .to_string()
}

fn intent_input_digest(operation: &str, values: &[&str]) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.intent-input\n{operation}\n{}",
        values.join("\n")
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_mcp_intent_mutation(
    state: &ApiState,
    actor: &str,
    operation: &str,
    intent_digest: &str,
    input_digest: &str,
    outcome: Option<&str>,
    resulting_status: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    mutation_applied: bool,
    event_published: Option<bool>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(intent_digest.to_string()),
        kind: "mcp_intent_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-intent-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "intentDigest": intent_digest,
            "inputDigest": input_digest,
            "outcome": outcome,
            "resultingStatus": resulting_status,
            "status": status,
            "rejectionCode": rejection_code,
            "mutationApplied": mutation_applied,
            "eventPublished": event_published,
            "intentValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, intent_digest, error = %error, "intent mutation audit failed");
    }
}

fn mcp_intent_propose(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_intent_actor(actor)?;
    let bus = state.intent_bus.as_ref().ok_or_else(|| {
        ApiError::Internal("intent bus is not attached to this process".to_string())
    })?;
    let agent_id = arg_string(args, "agentId")?;
    let proposal = arg_string(args, "proposal")?;
    let targets = arg_optional_string_array(args, "targets")?.unwrap_or_default();
    let target_refs = targets.iter().map(String::as_str).collect::<Vec<_>>();
    let mut input_values = vec![agent_id.as_str(), proposal.as_str()];
    input_values.extend(target_refs.iter().copied());
    let input_digest = intent_input_digest("propose", &input_values);
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let intent = match bus.propose_checked(agent_id, proposal, targets, created_at) {
        Ok(intent) => intent,
        Err(error) => {
            let pending_digest = crate::command_risk::approval::command_hash(&format!(
                "aelyris.intent-pending\n{input_digest}"
            ))
            .as_str()
            .to_string();
            audit_mcp_intent_mutation(
                state,
                actor,
                "propose",
                &pending_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("intent_persistence_failed"),
                false,
                None,
            );
            return Err(ApiError::Internal(error));
        }
    };
    let intent_digest = intent_target_digest(&intent.id);
    if let Some(events) = state.event_bus.as_ref() {
        if let Err(error) = events.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::IntentDeclared,
            serde_json::to_value(&intent).unwrap_or(serde_json::Value::Null),
        )) {
            audit_mcp_intent_mutation(
                state,
                actor,
                "propose",
                &intent_digest,
                &input_digest,
                Some("created"),
                Some(intent.status.as_str()),
                "rejected",
                Some("intent_event_publication_failed"),
                true,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
    }
    audit_mcp_intent_mutation(
        state,
        actor,
        "propose",
        &intent_digest,
        &input_digest,
        Some("created"),
        Some(intent.status.as_str()),
        "accepted",
        None,
        true,
        state.event_bus.as_ref().map(|_| true),
    );
    Ok(serde_json::json!({ "intent": intent }))
}

fn mcp_intent_resolve(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_intent_actor(actor)?;
    let bus = state.intent_bus.as_ref().ok_or_else(|| {
        ApiError::Internal("intent bus is not attached to this process".to_string())
    })?;
    let intent_id = arg_string(args, "id")?;
    let status_raw = arg_string(args, "status")?;
    let status: crate::intent::IntentStatus =
        serde_json::from_value(serde_json::Value::String(status_raw.clone()))
            .map_err(|_| ApiError::BadRequest(format!("invalid intent status `{status_raw}`")))?;
    let intent_digest = intent_target_digest(&intent_id);
    let input_digest = intent_input_digest("resolve", &[intent_id.as_str(), status_raw.as_str()]);
    let resolved = match bus.resolve_checked(&intent_id, status) {
        Ok(resolved) => resolved,
        Err(error) => {
            audit_mcp_intent_mutation(
                state,
                actor,
                "resolve",
                &intent_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("intent_persistence_failed"),
                false,
                None,
            );
            return Err(ApiError::Internal(error));
        }
    };
    let (intent, changed) = match resolved {
        Some((intent, changed)) => (Some(intent), changed),
        None => (None, false),
    };
    audit_mcp_intent_mutation(
        state,
        actor,
        "resolve",
        &intent_digest,
        &input_digest,
        Some(match (&intent, changed) {
            (None, _) => "missing",
            (Some(_), false) => "no_change",
            (Some(_), true) => "resolved",
        }),
        intent.as_ref().map(|value| value.status.as_str()),
        "accepted",
        None,
        changed,
        None,
    );
    Ok(serde_json::json!({ "intent": intent }))
}

fn mcp_proofbook_runner(state: &ApiState) -> ApiResult<crate::proofbook::ProofbookRunner> {
    state.proofbook_runner.clone().ok_or_else(|| {
        ApiError::Internal(
            "Proofbook runner runtime is not attached to this MCP process".to_string(),
        )
    })
}

fn resolve_mcp_proofbook_path(
    project_path: &str,
    raw_path: &str,
) -> Result<String, crate::proofbook::ProofbookError> {
    let root = crate::proofbook::validator::canonical_project_root(project_path)?;
    let raw = std::path::Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let resolved = crate::proofbook::validator::ensure_path_under_root(
        &root,
        &candidate.to_string_lossy(),
        "proofbookPath",
    )?;
    Ok(crate::proofbook::normalize_path(resolved))
}

fn mcp_validate_proofbook_report(
    project_path: &str,
    proofbook_path: &str,
) -> Result<crate::proofbook::ProofbookValidationReport, crate::proofbook::ProofbookError> {
    let proofbook_path = resolve_mcp_proofbook_path(project_path, proofbook_path)?;
    match crate::proofbook::parse_proofbook(&proofbook_path) {
        Ok(definition) => Ok(crate::proofbook::validate_definition(
            project_path,
            &definition,
            &proofbook_path,
        )),
        Err(error) => Ok(crate::proofbook::ProofbookValidationReport {
            definition_id: None,
            path: proofbook_path,
            valid: false,
            errors: vec![error],
            start_admission: crate::proofbook::ProofbookStartAdmission::unavailable(
                "definition_unreadable",
            ),
        }),
    }
}

fn proofbook_error_to_api(error: crate::proofbook::ProofbookError) -> ApiError {
    ApiError::BadRequest(error.to_string())
}

fn require_mcp_proofbook_effect_admitted(state: &ApiState, surface: &str) -> ApiResult<()> {
    if let Some(startup) = state.startup_reconciliation.as_ref() {
        startup
            .require_effect_admitted(surface)
            .map_err(ApiError::ServiceUnavailable)?;
    }
    Ok(())
}

fn mcp_proofbook_list(
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let project_path = arg_string(args, "projectPath")?;
    Ok(serde_json::json!({
        "projectPath": project_path,
        "proofbooks": crate::proofbook::list_proofbook_files(&project_path),
    }))
}

fn mcp_proofbook_get(
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let project_path = arg_string(args, "projectPath")?;
    let proofbook_path = arg_string(args, "proofbookPath")?;
    let resolved = resolve_mcp_proofbook_path(&project_path, &proofbook_path)
        .map_err(proofbook_error_to_api)?;
    let definition =
        crate::proofbook::parse_proofbook(&resolved).map_err(proofbook_error_to_api)?;
    let validation = crate::proofbook::validate_definition(&project_path, &definition, &resolved);
    let definition_hash =
        crate::proofbook::hash_json(&definition).map_err(proofbook_error_to_api)?;
    Ok(serde_json::json!({
        "projectPath": project_path,
        "proofbookPath": resolved,
        "definitionHash": definition_hash,
        "definition": definition,
        "validation": validation,
    }))
}

fn mcp_proofbook_validate(
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let project_path = arg_string(args, "projectPath")?;
    let proofbook_path = arg_string(args, "proofbookPath")?;
    let report = mcp_validate_proofbook_report(&project_path, &proofbook_path)
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(report)
}

fn mcp_proofbook_run(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    require_mcp_proofbook_effect_admitted(state, "Proofbook MCP start")?;
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(ApiError::Forbidden(
            "authenticated Proofbook initiating actor is unavailable".to_string(),
        ));
    }
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let proofbook_path = arg_string(args, "proofbookPath")?;
    let inputs = args
        .get("inputs")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let executor = McpProofbookExecutor {
        state: state.clone(),
        actor: actor.to_string(),
    };
    let ledger = runner
        .start_run_with_executors_as_actor(
            &project_path,
            &proofbook_path,
            inputs,
            actor,
            Some(&executor),
            Some(&executor),
        )
        .map_err(proofbook_error_to_api)?;
    audit_proofbook_run_start(state, actor, &project_path, &proofbook_path, &ledger);
    #[cfg(not(test))]
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit("proofbook-updated", &ledger);
    }
    mcp_result_value(ledger)
}

fn audit_proofbook_run_start(
    state: &ApiState,
    actor: &str,
    project_path: &str,
    requested_proofbook_path: &str,
    ledger: &crate::proofbook::ProofbookRunLedger,
) {
    append_proofbook_mcp_audit(
        state,
        actor,
        &ledger.run_id,
        "proofbook_run_start_observed",
        "info",
        serde_json::json!({
            "projectPath": project_path,
            "requestedProofbookPath": requested_proofbook_path,
            "definitionPath": ledger.definition_path,
            "runId": ledger.run_id,
            "revision": ledger.revision,
            "status": ledger.status,
            "definitionHash": ledger.definition_hash,
            "inputHash": ledger.input_hash,
            "actor": actor,
            "inputValuesLogged": false,
        }),
    );
}

fn mcp_proofbook_status(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let ledger = runner
        .status(&project_path, &run_id)
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
}

fn mcp_proofbook_settle_agent_session(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    require_mcp_proofbook_effect_admitted(state, "Proofbook MCP agent-session continuation")?;
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let step_id = arg_string(args, "stepId")?;
    let proof_value = args
        .get("proof")
        .cloned()
        .ok_or_else(|| ApiError::BadRequest("MCP argument `proof` is required".to_string()))?;
    let proof: crate::proofbook::ProofbookAgentSessionCompletionProof =
        serde_json::from_value(proof_value)
            .map_err(|err| ApiError::BadRequest(format!("invalid agentSession proof: {err}")))?;
    let ledger = runner
        .settle_agent_session(&project_path, &run_id, &step_id, proof)
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
}

fn mcp_proofbook_agent_session_candidate(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let step_id = arg_string(args, "stepId")?;
    let expected_revision = arg_u64(args, "expectedRevision")?;
    let candidate = crate::control::proofbook::agent_session_settlement_candidate(
        &runner,
        state.interactive_session_manager.as_ref(),
        state.agent_manager.as_ref(),
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
    )
    .map_err(proofbook_error_to_api)?;
    Ok(mcp_agent_session_candidate_value(&candidate))
}

fn mcp_agent_session_candidate_value(
    candidate: &crate::control::proofbook::ProofbookAgentSessionSettlementCandidate,
) -> serde_json::Value {
    serde_json::json!({
        "runId": candidate.run_id,
        "ledgerRevision": candidate.ledger_revision,
        "stepId": candidate.step_id,
        "sessionId": candidate.session_id,
        "paneId": candidate.pane_id,
        "ptyId": candidate.pty_id,
        "worktreePath": candidate.worktree_path,
        "runtimeStatus": candidate.runtime_status,
        "eligible": candidate.eligible,
        "resultingStatus": candidate.resulting_status,
        "proofKind": candidate.proof_kind,
        "expectedArtifacts": candidate.expected_artifacts,
        "blockers": candidate.blockers,
    })
}

fn mcp_proofbook_settle_current_agent_session(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    require_mcp_proofbook_effect_admitted(
        state,
        "Proofbook MCP runtime-owned agent-session settlement",
    )?;
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let step_id = arg_string(args, "stepId")?;
    let expected_revision = arg_u64(args, "expectedRevision")?;
    let expected_session_id = arg_string(args, "expectedSessionId")?;
    let outcome = crate::control::proofbook::settle_current_agent_session(
        &runner,
        state.interactive_session_manager.as_ref(),
        state.agent_manager.as_ref(),
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
        &expected_session_id,
    )
    .map_err(proofbook_error_to_api)?;
    #[cfg(not(test))]
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit("proofbook-updated", &outcome.ledger);
    }
    mcp_result_value(outcome.ledger)
}
fn mcp_proofbook_cancel(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let ledger = runner
        .cancel_run(&project_path, &run_id)
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
}

fn mcp_proofbook_cancel_current(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    require_mcp_proofbook_effect_admitted(state, "Proofbook MCP exact current cancellation")?;
    let actor = actor.trim();
    if actor.is_empty() {
        return Err(ApiError::Forbidden(
            "authenticated Proofbook cancellation actor is unavailable".to_string(),
        ));
    }
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let expected_revision = arg_u64(args, "expectedRevision")?;
    let ledger = runner
        .cancel_run_if_current_as_actor(&project_path, &run_id, expected_revision, actor)
        .map_err(proofbook_error_to_api)?;
    audit_proofbook_current_cancellation(
        state,
        actor,
        &project_path,
        &run_id,
        expected_revision,
        &ledger,
    );
    #[cfg(not(test))]
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit("proofbook-updated", &ledger);
    }
    mcp_result_value(ledger)
}

fn audit_proofbook_current_cancellation(
    state: &ApiState,
    actor: &str,
    project_path: &str,
    run_id: &str,
    expected_revision: u64,
    ledger: &crate::proofbook::ProofbookRunLedger,
) {
    append_proofbook_mcp_audit(
        state,
        actor,
        run_id,
        "proofbook_current_run_cancelled",
        "warning",
        serde_json::json!({
            "projectPath": project_path,
            "runId": run_id,
            "expectedRevision": expected_revision,
            "committedRevision": ledger.revision,
            "status": ledger.status,
            "actor": actor,
            "externalProcessTerminationClaimed": false,
        }),
    );
}

fn append_proofbook_mcp_audit(
    state: &ApiState,
    actor: &str,
    run_id: &str,
    kind: &str,
    severity: &str,
    payload_json: serde_json::Value,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(run_id.to_string()),
        kind: kind.to_string(),
        severity: severity.to_string(),
        source: "mcp".to_string(),
        confidence: None,
        payload_json,
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(run_id, actor, kind, error = %error, "Proofbook MCP audit failed");
    }
}

fn mcp_proofbook_decide_gate(
    state: &ApiState,
    caller_actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    decision: &str,
) -> ApiResult<serde_json::Value> {
    let decision_actor = authenticated_proofbook_decision_actor(
        state,
        caller_actor,
        arg_optional_string(args, "actor"),
        decision,
    )?;
    require_mcp_proofbook_effect_admitted(state, "Proofbook MCP gate continuation")?;
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let gate_id = arg_string(args, "gateId")?;
    let gate_hash = arg_string(args, "gateHash")?;
    let comment = arg_optional_string(args, "comment");
    let executor = McpProofbookExecutor {
        state: state.clone(),
        actor: decision_actor.clone(),
    };
    let ledger = runner
        .resolve_gate_with_mcp_executor(
            &project_path,
            &run_id,
            gate_id,
            gate_hash,
            decision.to_string(),
            Some(decision_actor),
            comment,
            &executor,
        )
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
}

fn authenticated_proofbook_decision_actor(
    state: &ApiState,
    caller_actor: &str,
    requested_actor: Option<String>,
    decision: &str,
) -> ApiResult<String> {
    let authenticated_actor = caller_actor.trim();
    if authenticated_actor.is_empty() {
        return Err(ApiError::Forbidden(
            "authenticated Proofbook decision actor is unavailable".to_string(),
        ));
    }
    if requested_actor
        .as_deref()
        .is_some_and(|requested| requested != authenticated_actor)
    {
        let capability = if decision.eq_ignore_ascii_case("approve") {
            "aelyris.proofbook.approve_gate"
        } else {
            "aelyris.proofbook.reject_gate"
        };
        super::super::audit_access_denied(
            state,
            authenticated_actor,
            capability,
            "requested Proofbook decision actor differs from authenticated principal",
        );
        return Err(ApiError::Forbidden(
            "Proofbook gate decision actor must match the authenticated principal".to_string(),
        ));
    }
    Ok(authenticated_actor.to_string())
}

fn tool_safety(name: &str) -> Option<String> {
    let listed = tools_list_value();
    listed
        .get("tools")?
        .as_array()?
        .iter()
        .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(name))
        .map(|tool| {
            tool.get("safety")
                .and_then(|value| value.as_str())
                .unwrap_or("FREE")
                .to_string()
        })
}

#[derive(Clone)]
struct McpProofbookExecutor {
    state: ApiState,
    actor: String,
}

impl crate::proofbook::ProofbookMcpToolExecutor for McpProofbookExecutor {
    fn execute_mcp_tool(
        &self,
        _run_id: &str,
        ledger: &crate::proofbook::ProofbookRunLedger,
        step: &crate::proofbook::ProofbookStep,
        approved_gate: Option<&crate::proofbook::ProofbookGateDecision>,
    ) -> Result<crate::proofbook::ProofbookStepOutcome, crate::proofbook::ProofbookError> {
        use crate::proofbook::{ProofbookRunError, ProofbookStepOutcome, ProofbookStepStatus};

        let Some(tool_name) = proofbook_step_string_param(step, "toolName") else {
            return Ok(ProofbookStepOutcome::failed(
                "mcp_tool_not_found",
                "mcpTool step requires toolName",
            ));
        };
        if tool_name.starts_with("aelyris.proofbook.") {
            return Ok(ProofbookStepOutcome::failed(
                "proofbook_mcp_recursion_not_supported",
                "PB-3 mcpTool steps cannot call aelyris.proofbook.* recursively",
            ));
        }
        let arguments = match step.params.get("arguments") {
            Some(value) => serde_json::to_value(value).unwrap_or_else(|_| serde_json::json!({})),
            None => serde_json::json!({}),
        };
        if let crate::governance::AccessDecision::Deny(reason) =
            self.state.governance.authorize(&self.actor, &tool_name)
        {
            super::super::audit_access_denied(&self.state, &self.actor, &tool_name, &reason);
            return Ok(ProofbookStepOutcome::blocked(
                "mcp_governance_denied",
                format!("MCP tool {tool_name} is not permitted"),
            ));
        }
        let Some(schema) = input_schema_for_tool(&tool_name) else {
            return Ok(ProofbookStepOutcome::failed(
                "mcp_tool_not_found",
                format!("MCP tool not found: {tool_name}"),
            ));
        };
        if let Err(report) = validate_tool_arguments(&tool_name, &arguments, &schema) {
            return Ok(ProofbookStepOutcome {
                status: ProofbookStepStatus::Failed,
                structured_output: Some(report.to_payload(&tool_name)),
                error: Some(ProofbookRunError::new(
                    "mcp_schema_violation",
                    format!("MCP tool arguments failed schema validation for {tool_name}"),
                )),
                ..ProofbookStepOutcome::passed()
            });
        }
        let safety = tool_safety(&tool_name).unwrap_or_else(|| "FREE".to_string());
        let arguments_hash = crate::proofbook::hash_json(&arguments)?;
        if safety != "FREE" && approved_gate.is_none() {
            let gate_id = format!(
                "pb-gate-{}-{}-{}-mcp",
                ledger.run_id,
                step.id,
                sanitize_gate_fragment(&tool_name)
            );
            let gate_hash = crate::proofbook::hash_json(&serde_json::json!({
                "runId": ledger.run_id,
                "stepId": step.id,
                "toolName": tool_name,
                "argumentsHash": arguments_hash,
                "definitionHash": ledger.definition_hash,
                "inputHash": ledger.input_hash,
            }))?;
            let pending = push_pending(
                &self.state,
                McpPendingDecision {
                    id: format!(
                        "proofbook:{}:{}:{}",
                        ledger.run_id,
                        step.id,
                        uuid::Uuid::new_v4()
                    ),
                    session_id: ledger.run_id.clone(),
                    kind: "proofbook_mcp_tool".to_string(),
                    title: format!("Proofbook MCP tool gate: {tool_name}"),
                    summary: Some(format!("Proofbook step {} requests {tool_name}", step.id)),
                    risk: safety.clone(),
                    status: "pending".to_string(),
                },
            )
            .map_err(|error| {
                crate::proofbook::ProofbookError::new(
                    crate::proofbook::ProofbookErrorCode::IoError,
                    error.to_string(),
                )
            })?;
            return Ok(ProofbookStepOutcome::waiting_gate(
                serde_json::json!({
                    "kind": "mcpTool",
                    "toolName": tool_name,
                    "safety": safety,
                    "gateId": gate_id,
                    "gateHash": gate_hash,
                    "argumentsHash": arguments_hash,
                    "pendingDecisionId": pending.id,
                }),
                Some(serde_json::json!({ "safety": safety })),
            ));
        }

        let value = call_mcp_tool_on_fresh_runtime(
            self.state.clone(),
            self.actor.clone(),
            tool_name.clone(),
            arguments,
        )
        .map_err(|message| {
            crate::proofbook::ProofbookError::new(
                crate::proofbook::ProofbookErrorCode::IoError,
                message,
            )
        })?;
        if !value
            .get("ok")
            .and_then(|value| value.as_bool())
            .unwrap_or(false)
        {
            return Ok(ProofbookStepOutcome {
                status: ProofbookStepStatus::Failed,
                structured_output: value.get("error").cloned(),
                error: Some(ProofbookRunError::new(
                    "mcp_tool_error",
                    format!("MCP tool {tool_name} returned an error"),
                )),
                ..ProofbookStepOutcome::passed()
            });
        }
        let mut structured = serde_json::json!({
            "kind": "mcpTool",
            "toolName": tool_name,
            "safety": safety,
            "argumentsHash": arguments_hash,
            "result": value.get("result").cloned().unwrap_or(serde_json::Value::Null),
        });
        if let Some(decision) = approved_gate {
            structured["decision"] =
                serde_json::to_value(decision).unwrap_or(serde_json::Value::Null);
        }
        Ok(ProofbookStepOutcome {
            status: ProofbookStepStatus::Passed,
            structured_output: Some(structured),
            ..ProofbookStepOutcome::passed()
        })
    }
}

impl crate::proofbook::ProofbookAgentSessionExecutor for McpProofbookExecutor {
    fn start_agent_session(
        &self,
        _run_id: &str,
        _ledger: &crate::proofbook::ProofbookRunLedger,
        _step: &crate::proofbook::ProofbookStep,
        request: &crate::proofbook::ProofbookAgentSessionRequest,
    ) -> Result<crate::proofbook::ProofbookAgentSessionSpawn, crate::proofbook::ProofbookError>
    {
        #[cfg(test)]
        {
            let _ = request;
            return Err(crate::proofbook::ProofbookError::runtime_not_available(
                "agentSession",
            ));
        }

        #[cfg(not(test))]
        {
            if request.visible {
                let app = mcp_app_handle(&self.state).map_err(|error| {
                    crate::proofbook::ProofbookError::new(
                        crate::proofbook::ProofbookErrorCode::RuntimeNotAvailable,
                        error.to_string(),
                    )
                    .with_field("agentSession")
                })?;
                let cwd = request
                    .worktree_path
                    .clone()
                    .unwrap_or_else(|| request.repo_path.clone());
                let branch = if request.worktree_path.is_some() {
                    None
                } else {
                    request.worktree_branch.clone()
                };
                let model = request.model.clone();
                let task = request.task.clone();
                let cols = request.cols;
                let rows = request.rows;
                let result = std::thread::Builder::new()
                    .name("proofbook-agent-session".to_string())
                    .spawn(move || {
                        let runtime = tokio::runtime::Builder::new_current_thread()
                            .enable_all()
                            .build()
                            .map_err(|error| format!("start Proofbook agent runtime: {error}"))?;
                        runtime.block_on(crate::ipc::spawn_interactive_agent(
                            app,
                            cwd,
                            Some(model),
                            Some(task),
                            branch,
                            cols,
                            rows,
                        ))
                    })
                    .map_err(|error| {
                        crate::proofbook::ProofbookError::new(
                            crate::proofbook::ProofbookErrorCode::IoError,
                            format!("spawn Proofbook agent runtime: {error}"),
                        )
                        .with_field("agentSession")
                    })?
                    .join()
                    .map_err(|_| {
                        crate::proofbook::ProofbookError::new(
                            crate::proofbook::ProofbookErrorCode::IoError,
                            "Proofbook agent runtime thread panicked",
                        )
                        .with_field("agentSession")
                    })?
                    .map_err(|message| {
                        crate::proofbook::ProofbookError::new(
                            crate::proofbook::ProofbookErrorCode::ValidationFailed,
                            message,
                        )
                        .with_field("agentSession")
                    })?;
                return Ok(crate::proofbook::ProofbookAgentSessionSpawn {
                    session_id: result.session_id,
                    pane_id: Some(result.pty_id.clone()),
                    pty_id: Some(result.pty_id),
                    backend: result.backend,
                    provider: request.provider.clone(),
                    model: request.model.clone(),
                    repo_path: request.repo_path.clone(),
                    worktree_path: request.worktree_path.clone().or(result.worktree_path),
                    worktree_branch: request.worktree_branch.clone(),
                    visible: true,
                });
            }

            let manager = self.state.agent_manager.as_ref().ok_or_else(|| {
                crate::proofbook::ProofbookError::runtime_not_available(
                    "agentSession headless runtime is not attached",
                )
                .with_field("agentSession")
            })?;
            let cwd = request
                .worktree_path
                .clone()
                .unwrap_or_else(|| request.repo_path.clone());
            let session_id = crate::control::agent::start_headless(
                manager,
                crate::control::agent::HeadlessSpawnSpec {
                    prompt: request.task.clone(),
                    cwd,
                    model: Some(request.model.clone()),
                    allowed_tools: None,
                    resume_id: None,
                },
            )
            .map_err(|message| {
                crate::proofbook::ProofbookError::new(
                    crate::proofbook::ProofbookErrorCode::ValidationFailed,
                    message,
                )
                .with_field("agentSession")
            })?;
            Ok(crate::proofbook::ProofbookAgentSessionSpawn {
                session_id,
                pane_id: None,
                pty_id: None,
                backend: "headless".to_string(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                repo_path: request.repo_path.clone(),
                worktree_path: request.worktree_path.clone(),
                worktree_branch: request.worktree_branch.clone(),
                visible: false,
            })
        }
    }
}

fn call_mcp_tool_on_fresh_runtime(
    state: ApiState,
    actor: String,
    name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    std::thread::Builder::new()
        .name("proofbook-mcp-tool".to_string())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| format!("start Proofbook MCP runtime: {error}"))?;
            runtime.block_on(async move {
                match tools_call_as_actor(&state, &actor, ToolCallBody { name, arguments }).await {
                    Ok(Json(value)) => Ok(value),
                    Err(error) => Err(error.to_string()),
                }
            })
        })
        .map_err(|error| format!("spawn Proofbook MCP runtime: {error}"))?
        .join()
        .map_err(|_| "Proofbook MCP runtime thread panicked".to_string())?
}

fn proofbook_step_string_param(
    step: &crate::proofbook::ProofbookStep,
    key: &str,
) -> Option<String> {
    step.params
        .get(key)
        .and_then(|value| match value {
            serde_yaml::Value::String(value) => Some(value.trim().to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn sanitize_gate_fragment(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "tool".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
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

fn ownership_db(state: &ApiState) -> ApiResult<&crate::db::ManagedDb> {
    state.db.as_deref().ok_or_else(|| {
        ApiError::Internal("ownership persistence is not attached to this process".to_string())
    })
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

pub(super) fn push_pending(
    state: &ApiState,
    item: McpPendingDecision,
) -> ApiResult<McpPendingDecision> {
    let dropped = {
        let mut pending = state
            .mcp_pending
            .lock()
            .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?;
        let dropped = if pending.len() >= MAX_MCP_PENDING {
            Some(pending.remove(0))
        } else {
            None
        };
        pending.push(item.clone());
        dropped
    };
    if let Some(dropped) = dropped {
        tracing::warn!(
            dropped_id = %dropped.id,
            new_id = %item.id,
            cap = MAX_MCP_PENDING,
            "MCP pending queue overflow; dropped oldest pending decision"
        );
        if let Some(bus) = state.event_bus.as_ref() {
            bus.publish(crate::event_bus::AgentEvent::on(
                crate::event_bus::AgentEventKind::EscalationRaised,
                crate::event_bus::EventChannel::System,
                serde_json::json!({
                    "source": "mcp_pending",
                    "reason": "queue_overflow",
                    "droppedId": dropped.id,
                    "newId": item.id,
                    "cap": MAX_MCP_PENDING,
                }),
            ))
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        }
    }
    Ok(item)
}

pub(super) fn event_bus_error_response(
    tool: &str,
    error: crate::event_bus::EventBusError,
) -> Json<serde_json::Value> {
    let retryable = matches!(
        error,
        crate::event_bus::EventBusError::DurabilityUnavailable
            | crate::event_bus::EventBusError::AppendFailed { .. }
            | crate::event_bus::EventBusError::QueryFailed { .. }
    );
    Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": tool,
        "ok": false,
        "error": {
            "schema": "aelyris.event-bus.error/v1",
            "domain": "event_bus",
            "retryable": retryable,
            "deliveryContract": "at_least_once",
            "eventBusError": error,
        },
    }))
}

pub(super) async fn dispatch_authorized(
    state: &ApiState,
    actor: &str,
    name: &str,
    args: serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    // A6.4_DISPATCH_TOOL_ARMS_BEGIN
    let result = match name {
        "terminal.list" => serde_json::json!({
            "sessions": state.pty.list_info(),
        }),
        "terminal.capture" => {
            let session_ref = arg_string(&args, "sessionId")?;
            let session_id = resolve_mcp_terminal_ref(&state, &session_ref)?;
            let lines = arg_usize(&args, "lines", 200)?.clamp(1, 10_000);
            let clean = arg_bool(&args, "clean", true);
            let text = state
                .pty
                .capture(&session_id, lines, clean)
                .map_err(|err| super::super::map_pty_err(&session_id, err))?;
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
            let approval_id = arg_optional_string(&args, "approvalId");
            send_workspace_input(
                &state,
                actor,
                &workspace_id,
                text.as_bytes(),
                "mcp-safe-input",
                approval_id.as_deref(),
                // arg_string trims the payload -> classify the whole bare command
                crate::command_risk::gate::GateMode::Atomic,
            )?
        }
        "aelyris.worktree.validate" => {
            let branch_name = arg_string(&args, "branchName")?;
            crate::control::worktree::validate_branch(&branch_name)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "branchName": branch_name, "valid": true })
        }
        "aelyris.worktree.predictPath" => {
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
        "aelyris.worktree.list" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let worktrees =
                crate::control::worktree::list(&repo_path).map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "worktrees": worktrees })
        }
        "aelyris.worktree.create" => {
            let actor = authenticated_worktree_actor(actor)?;
            let repo_path = arg_string(&args, "repoPath")?;
            let branch_name = arg_string(&args, "branchName")?;
            let target_digest = worktree_target_digest("create", &repo_path, &branch_name, false);
            match crate::control::worktree::create(&repo_path, &branch_name) {
                Ok(worktree) => {
                    audit_mcp_worktree_mutation(
                        &state,
                        actor,
                        "create",
                        &target_digest,
                        false,
                        "accepted",
                        None,
                    );
                    serde_json::json!({ "repoPath": repo_path, "branchName": branch_name, "worktree": worktree })
                }
                Err(error) => {
                    audit_mcp_worktree_mutation(
                        &state,
                        actor,
                        "create",
                        &target_digest,
                        false,
                        "rejected",
                        Some("worktree_create_failed"),
                    );
                    return Err(ApiError::BadRequest(error));
                }
            }
        }
        "aelyris.worktree.remove" => {
            let actor = authenticated_worktree_actor(actor)?;
            let repo_path = arg_string(&args, "repoPath")?;
            let worktree_name = arg_string(&args, "worktreeName")?;
            let delete_branch = arg_bool(&args, "deleteBranch", false);
            let target_digest =
                worktree_target_digest("remove", &repo_path, &worktree_name, delete_branch);
            // `worktreeName` is the branch/name returned by create/list. Route
            // through the branch-aware owner so Git receives the predicted
            // worktree path rather than treating the branch as a filesystem path.
            match crate::control::worktree::remove_for_branch(
                &repo_path,
                &worktree_name,
                delete_branch,
            ) {
                Ok(()) => {
                    audit_mcp_worktree_mutation(
                        &state,
                        actor,
                        "remove",
                        &target_digest,
                        delete_branch,
                        "accepted",
                        None,
                    );
                    serde_json::json!({ "repoPath": repo_path, "worktreeName": worktree_name, "removed": true, "deleteBranch": delete_branch })
                }
                Err(error) => {
                    audit_mcp_worktree_mutation(
                        &state,
                        actor,
                        "remove",
                        &target_digest,
                        delete_branch,
                        "rejected",
                        Some("worktree_remove_failed"),
                    );
                    return Err(ApiError::BadRequest(error));
                }
            }
        }
        "aelyris.fleet_status" => {
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
        "aelyris.route_agent" => {
            let prompt = arg_string(&args, "prompt")?;
            let budget_remaining = arg_optional_f64(&args, "budgetRemaining")?;
            let decision = crate::control::agent::route(&prompt, budget_remaining);
            serde_json::json!({ "prompt": prompt, "decision": decision })
        }
        "aelyris.pane_send_input" => {
            let terminal_ref = arg_string(&args, "terminalId")?;
            let terminal_id = resolve_mcp_terminal_ref(&state, &terminal_ref)?;
            let text = arg_string(&args, "text")?;
            let approval_id = arg_optional_string(&args, "approvalId");
            let client_id = super::super::normalize_stream_client_id(
                arg_optional_string(&args, "clientId").as_deref(),
            )?;
            if text.len() > WS_MAX_INPUT_FRAME_BYTES {
                return Err(ApiError::BadRequest(format!(
                    "input frame exceeds {} bytes",
                    WS_MAX_INPUT_FRAME_BYTES
                )));
            }
            let targets = vec![terminal_id.clone()];
            let audit = |status: &str, rejection_code: Option<&str>| {
                super::super::audit_programmatic_terminal_write(
                    &state,
                    "mcp_pane_input_authority",
                    actor,
                    &terminal_id,
                    "mcp-pane-input",
                    &targets,
                    text.as_bytes(),
                    approval_id.is_some(),
                    status,
                    rejection_code,
                    serde_json::json!({
                        "terminalId": terminal_id,
                        "clientIdPresent": client_id.is_some(),
                    }),
                );
            };
            if let Err(error) = state.controller_leases.ensure_can_control(
                &terminal_id,
                client_id.as_deref(),
                actor,
            ) {
                audit("rejected", Some("controller_lease_conflict"));
                return Err(error);
            }
            let write = super::super::execute_terminal_write(
                &state,
                crate::command_risk::authority::WriteActor {
                    principal: actor.to_string(),
                    kind: crate::command_risk::authority::WriteActorKind::Programmatic,
                },
                "mcp-pane-input",
                &terminal_id,
                &terminal_id,
                targets.clone(),
                approval_id.as_deref(),
                text.as_bytes(),
                crate::command_risk::authority::WritePayloadMode::Atomic,
            );
            let ack = match write {
                Ok(ack) => {
                    audit(
                        match &ack.status {
                            crate::command_risk::authority::TerminalWriteAckStatus::Executed => {
                                "executed"
                            }
                            crate::command_risk::authority::TerminalWriteAckStatus::Held => "held",
                        },
                        None,
                    );
                    ack
                }
                Err(ApiError::TerminalWriteRejected(code, nack)) => {
                    audit("rejected", Some(&code));
                    return Ok(schema_tool_error(
                        &name,
                        serde_json::json!({ "terminalWriteNack": nack }),
                    ));
                }
                Err(err) => {
                    audit("rejected", Some("terminal_write_error"));
                    return Err(err);
                }
            };
            serde_json::json!({
                "terminalId": terminal_id,
                "accepted": ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Executed,
                "ack": ack,
            })
        }
        "aelyris.agent_diff" => {
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
                    "schema": "aelyris.mcp.server.v1",
                    "tool": name,
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
        "aelyris.session.summarize" => mcp_session_summarize(&state, &args).await?,
        "aelyris.session.checkpoint" => mcp_session_checkpoint(&state, &args)?,
        "aelyris.session.handoff" => mcp_session_handoff(&state, &args).await?,
        "aelyris.session.resume" => mcp_session_resume(&state, &args).await?,
        "aelyris.session.reset_context" => mcp_session_reset_context(&state, &args).await?,
        "aelyris.proofbook.list" => mcp_proofbook_list(&args)?,
        "aelyris.proofbook.get" => mcp_proofbook_get(&args)?,
        "aelyris.proofbook.validate" => mcp_proofbook_validate(&args)?,
        "aelyris.proofbook.run" => mcp_proofbook_run(&state, actor, &args)?,
        "aelyris.proofbook.status" => mcp_proofbook_status(&state, &args)?,
        "aelyris.proofbook.settle_agent_session" => {
            mcp_proofbook_settle_agent_session(&state, &args)?
        }
        "aelyris.proofbook.agent_session_candidate" => {
            mcp_proofbook_agent_session_candidate(&state, &args)?
        }
        "aelyris.proofbook.settle_current_agent_session" => {
            mcp_proofbook_settle_current_agent_session(&state, &args)?
        }
        "aelyris.proofbook.cancel" => mcp_proofbook_cancel(&state, &args)?,
        "aelyris.proofbook.cancel_current" => mcp_proofbook_cancel_current(&state, actor, &args)?,
        "aelyris.proofbook.approve_gate" => {
            mcp_proofbook_decide_gate(&state, actor, &args, "approve")?
        }
        "aelyris.proofbook.reject_gate" => {
            mcp_proofbook_decide_gate(&state, actor, &args, "reject")?
        }
        "aelyris.request_approval" => {
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
        "aelyris.list_pending_approvals" => {
            let pending = state
                .mcp_pending
                .lock()
                .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?
                .iter()
                .filter(|item| item.status == "pending")
                .cloned()
                .collect::<Vec<_>>();
            // Durable merge intents awaiting a decision are synthesized from the
            // store (their source of truth), NOT from `mcp_pending`. A read with no
            // store attached simply shows none (a read can never cause a merge).
            let merge_intents = match state.merge_store.as_ref() {
                Some(store) => store.list_unresolved().map_err(ApiError::Internal)?,
                None => Vec::new(),
            };
            serde_json::json!({
                "pending": pending,
                "mergeIntents": merge_intents,
                "grantToolExposed": false,
            })
        }
        "aelyris.approval.resolve" => match mcp_approval_resolve(&state, &args).await? {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(err) => {
                return Ok(schema_tool_error(
                    &name,
                    approval_resolve_error_payload(&err),
                ));
            }
        },
        "aelyris.pane.rename" => match mcp_pane_rename(&state, actor, &args)? {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(err) => {
                return Ok(schema_tool_error(
                    &name,
                    serde_json::json!({ "error": err }),
                ));
            }
        },
        "aelyris.pane.set_role" => match mcp_pane_set_role(&state, actor, &args)? {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(err) => {
                return Ok(schema_tool_error(
                    &name,
                    serde_json::json!({ "error": err }),
                ));
            }
        },
        "aelyris.request_merge" => {
            return Err(ApiError::BadRequest(
                "aelyris.request_merge is retired: generic merge intents are backend-owned by exact-candidate review".to_string(),
            ));
        }
        "aelyris.spawn_agent" => {
            let actor = authenticated_lifecycle_actor(actor)?;
            match mcp_spawn_headless(&state, &args) {
                Ok(session_id) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "spawn",
                        "headless",
                        Some(&session_id),
                        "accepted",
                        None,
                    );
                    serde_json::json!({ "sessionId": session_id, "spawned": true })
                }
                Err(error) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "spawn",
                        "headless",
                        None,
                        "rejected",
                        Some("agent_spawn_failed"),
                    );
                    return Err(error);
                }
            }
        }
        "aelyris.agent.spawn_visible" => {
            let actor = authenticated_lifecycle_actor(actor)?;
            match mcp_spawn_visible(&state, &args).await {
                Ok(Ok(value)) => {
                    let session_id = value
                        .get("session_id")
                        .or_else(|| value.get("sessionId"))
                        .and_then(serde_json::Value::as_str);
                    audit_mcp_agent_lifecycle(
                        &state, actor, "spawn", "visible", session_id, "accepted", None,
                    );
                    value
                }
                Ok(Err(err)) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "spawn",
                        "visible",
                        None,
                        "rejected",
                        Some("agent_spawn_rejected"),
                    );
                    return Ok(schema_tool_error(
                        &name,
                        serde_json::json!({ "error": err }),
                    ));
                }
                Err(error) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "spawn",
                        "visible",
                        None,
                        "rejected",
                        Some("agent_runtime_unavailable"),
                    );
                    return Err(error);
                }
            }
        }
        "aelyris.stop_agent" => {
            let actor = authenticated_lifecycle_actor(actor)?;
            let session_id = arg_string(&args, "sessionId")?;
            match mcp_stop_headless(&state, &session_id) {
                Ok(stopped_session_id) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "stop",
                        "headless",
                        Some(&stopped_session_id),
                        "accepted",
                        None,
                    );
                    serde_json::json!({ "sessionId": stopped_session_id, "stopped": true })
                }
                Err(error) => {
                    audit_mcp_agent_lifecycle(
                        &state,
                        actor,
                        "stop",
                        "headless",
                        Some(&session_id),
                        "rejected",
                        Some("agent_stop_failed"),
                    );
                    return Err(error);
                }
            }
        }
        "aelyris.review.approve" => {
            return Err(ApiError::BadRequest(
                "aelyris.review.approve is retired: raw intent approval cannot substitute for backend-bound review".to_string(),
            ));
        }
        "aelyris.review.reject" => {
            // Fail closed: rejection is a durable state transition on the stored
            // intent, never a RAM-queue edit.
            let store = state.merge_store.as_ref().ok_or_else(|| {
                ApiError::Internal("merge persistence is not attached to this process".to_string())
            })?;
            const REJECT_ALLOWED: &[&str] = &["intentId", "reason"];
            if let Some(bad) = args.keys().find(|k| !REJECT_ALLOWED.contains(&k.as_str())) {
                return Err(ApiError::BadRequest(format!(
                    "aelyris.review.reject does not accept `{bad}`"
                )));
            }
            let intent_id = arg_string(&args, "intentId")?;
            let reason = match args.get("reason") {
                None => None,
                Some(serde_json::Value::String(s)) => Some(s.clone()),
                Some(_) => return Err(ApiError::BadRequest("reason must be a string".to_string())),
            };
            let now = now_secs() as i64;
            // Must exist (NotFound) ...
            let intent = store
                .get(&intent_id)
                .map_err(ApiError::Internal)?
                .ok_or_else(|| ApiError::NotFound(intent_id.clone()))?;
            // ... and be rejectable (the conditional UPDATE is the real arbiter;
            // an in-flight or already-resolved intent cannot be rejected).
            if !store.reject(&intent_id, now).map_err(ApiError::Internal)? {
                return Err(ApiError::BadRequest(format!(
                    "intent {intent_id} cannot be rejected (state {}): it is merging or already resolved",
                    intent.state.as_str()
                )));
            }
            serde_json::json!({ "intentId": intent_id, "status": "rejected", "reason": reason })
        }
        "aelyris.task.create" => mcp_task_create(&state, actor, &args)?,
        "aelyris.task.list" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            serde_json::json!({ "tasks": tasks.list() })
        }
        "aelyris.task.transition" => mcp_task_transition(&state, actor, &args)?,
        "aelyris.orchestrator.plan" => {
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
        "aelyris.supervisor.health" => {
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
        "aelyris.orchestrator.step" => {
            let startup = state.startup_reconciliation.as_ref().ok_or_else(|| {
                ApiError::Internal(
                    "startup reconciliation barrier is not attached to this process".to_string(),
                )
            })?;
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
            let usage = crate::cost::CostUsage {
                active_agents: arg_usize(&args, "activeAgents", 0)?,
                ..Default::default()
            };
            let report = crate::control::loop_ports::run_step(
                startup,
                tasks,
                cost,
                agents,
                ownership,
                state.symbol_ownership.clone(),
                events,
                context,
                &usage,
                repo_path,
                "mcp-dispatch-only".to_string(),
                std::collections::HashMap::new(),
                std::collections::HashMap::new(),
                None,
                state.merge_store.clone(),
                // P4: the autonomous (MCP) face persists give-ups too — the path
                // that most needs unattended-safe durability.
                state.db.as_deref(),
            )
            .map_err(ApiError::Internal)?;
            serde_json::json!({ "report": report })
        }
        "aelyris.event.recent" => {
            let bus = state.event_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("event bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "events": bus.recent() })
        }
        "aelyris.event.by_channel" => {
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
        "aelyris.event.since" => {
            let Some(bus) = state.event_bus.as_ref() else {
                return Ok(event_bus_error_response(
                    "aelyris.event.since",
                    crate::event_bus::EventBusError::DurabilityUnavailable,
                ));
            };
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
            let batch = match bus.since(after_seq, limit) {
                Ok(batch) => batch,
                Err(error) => {
                    return Ok(event_bus_error_response("aelyris.event.since", error));
                }
            };
            // The cursor to pass as next afterSeq (unchanged when nothing new).
            let next_seq = batch
                .events
                .last()
                .map(|event| event.seq)
                .unwrap_or(after_seq);
            serde_json::json!({
                "events": batch.events,
                "nextSeq": next_seq,
                "streamStatus": batch.status,
                "deliveryContract": "diagnostic"
            })
        }
        "aelyris.event.poll" => {
            let Some(bus) = state.event_bus.as_ref() else {
                return Ok(event_bus_error_response(
                    "aelyris.event.poll",
                    crate::event_bus::EventBusError::DurabilityUnavailable,
                ));
            };
            let consumer_id = arg_string(&args, "consumerId")?;
            let limit = args
                .get("limit")
                .and_then(|value| value.as_u64())
                .map(|value| value as usize)
                .unwrap_or(100)
                .clamp(1, 1000);
            let batch = match bus.poll_consumer(&consumer_id, limit) {
                Ok(batch) => batch,
                Err(error) => {
                    return Ok(event_bus_error_response("aelyris.event.poll", error));
                }
            };
            serde_json::json!({
                "consumerId": consumer_id,
                "events": batch.events,
                "streamStatus": batch.status,
                "deliveryContract": "at_least_once",
                "idempotencyField": "eventId"
            })
        }
        "aelyris.event.ack" => {
            let Some(bus) = state.event_bus.as_ref() else {
                return Ok(event_bus_error_response(
                    "aelyris.event.ack",
                    crate::event_bus::EventBusError::DurabilityUnavailable,
                ));
            };
            let consumer_id = arg_string(&args, "consumerId")?;
            let event_id = arg_string(&args, "eventId")?;
            let seq = args
                .get("seq")
                .and_then(|value| value.as_i64())
                .ok_or_else(|| ApiError::BadRequest("seq must be an integer".to_string()))?;
            if seq < 1 {
                return Err(ApiError::BadRequest("seq must be >= 1".to_string()));
            }
            let receipt = match bus.ack(&consumer_id, seq, &event_id) {
                Ok(receipt) => receipt,
                Err(error) => {
                    return Ok(event_bus_error_response("aelyris.event.ack", error));
                }
            };
            serde_json::json!({ "ack": receipt })
        }
        "aelyris.shared_brain.snapshot" => {
            let workspace_id =
                arg_optional_string(&args, "workspaceId").unwrap_or_else(|| "mcp".to_string());
            let agents = state
                .agent_manager
                .as_ref()
                .map(crate::control::agent::list_headless)
                .unwrap_or_default();
            let snapshot = crate::shared_brain::snapshot(crate::shared_brain::SharedBrainInputs {
                workspace_id: &workspace_id,
                agents,
                file_ownership: state.file_ownership.as_ref(),
                symbol_ownership: state.symbol_ownership.as_ref(),
                event_bus: state.event_bus.as_ref(),
                context_store: state.context_store.as_ref(),
                merge_store: state.merge_store.as_ref(),
                now: now_secs(),
            })
            .map_err(ApiError::Internal)?;
            serde_json::to_value(snapshot)
                .map_err(|err| ApiError::Internal(format!("serialize shared brain: {err}")))?
        }
        "aelyris.ownership.assign" => mcp_file_ownership_assign(&state, actor, &args)?,
        "aelyris.ownership.owner_of" => {
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
        "aelyris.ownership.claims" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            ownership_db(&state)?
                .with(|db| crate::persistence::OwnershipRepo::prune_expired(db, now).map(|_| ()))
                .map_err(ApiError::Internal)?;
            let claims = {
                let mut owner = ownership
                    .lock()
                    .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?;
                owner.expire(now);
                owner.claims().to_vec()
            };
            serde_json::json!({ "claims": claims })
        }
        "aelyris.ownership.conflicts" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            ownership_db(&state)?
                .with(|db| crate::persistence::OwnershipRepo::prune_expired(db, now).map(|_| ()))
                .map_err(ApiError::Internal)?;
            let conflicts = {
                let mut owner = ownership
                    .lock()
                    .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?;
                owner.expire(now);
                owner.conflicts()
            };
            serde_json::json!({ "conflicts": conflicts })
        }
        "aelyris.symbol.claim" => mcp_symbol_claim(&state, actor, &args)?,
        "aelyris.symbol.refresh" => mcp_symbol_refresh(&state, actor, &args)?,
        "aelyris.symbol.release" => mcp_symbol_release(&state, actor, &args)?,
        "aelyris.symbol.release_task" => mcp_symbol_release_task(&state, actor, &args)?,
        "aelyris.symbol.claims" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            ownership_db(&state)?
                .with(|db| crate::persistence::OwnershipRepo::prune_expired(db, now).map(|_| ()))
                .map_err(ApiError::Internal)?;
            let claims: Vec<crate::symbol_ownership::SymbolClaim> = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.expire(now);
                owner.live_claims(now).into_iter().cloned().collect()
            };
            serde_json::json!({ "claims": claims })
        }
        "aelyris.symbol.conflicts" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            ownership_db(&state)?
                .with(|db| crate::persistence::OwnershipRepo::prune_expired(db, now).map(|_| ()))
                .map_err(ApiError::Internal)?;
            let conflicts = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.expire(now);
                owner.conflicts(now)
            };
            serde_json::json!({ "conflicts": conflicts })
        }
        "aelyris.symbol.claim_from_diff" => mcp_symbol_claim_from_diff(&state, actor, &args)?,
        "aelyris.symbol.claim_from_source" => mcp_symbol_claim_from_source(&state, actor, &args)?,
        "aelyris.context.set" => mcp_context_set(&state, actor, &args)?,
        "aelyris.context.get" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            let key = arg_string(&args, "key")?;
            serde_json::json!({ "key": key, "value": store.get(&key) })
        }
        "aelyris.context.all" => {
            let store = state.context_store.as_ref().ok_or_else(|| {
                ApiError::Internal("context store is not attached to this process".to_string())
            })?;
            serde_json::json!({ "decisions": store.all() })
        }
        "aelyris.context.remove" => mcp_context_remove(&state, actor, &args)?,
        "aelyris.agent.report_activity" => {
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
                ))
                .map_err(|error| ApiError::Internal(error.to_string()))?;
            }
            serde_json::json!({ "sessionId": session_id, "reported": true })
        }
        "aelyris.agent.report_blocker" => {
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
                ))
                .map_err(|error| ApiError::Internal(error.to_string()))?;
            }
            serde_json::json!({ "sessionId": session_id, "raised": true })
        }
        "aelyris.agent.steer_avoid" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let session_id = arg_string(&args, "sessionId")?;
            // A typed steer to a dead/unknown agent is an ERROR, not a silent no-op (it
            // would otherwise look delivered but reach nobody — §6.4 boundary). "Live"
            // EXCLUDES retained done/failed sessions and processes that already exited,
            // so membership in `list_sessions` is not enough. The lookup also returns the
            // target's `task_id` so we exclude its OWN claims below (a claim can key on
            // either the session id or the task id).
            let target = manager.live_session(&session_id).ok_or_else(|| {
                ApiError::NotFound(format!("no live agent session '{session_id}' to steer"))
            })?;
            let files = arg_optional_string_array(&args, "files")?.unwrap_or_default();
            let now = now_secs();
            let claims: Vec<crate::symbol_ownership::SymbolClaim> = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                owner.expire(now);
                owner.live_claims(now).into_iter().cloned().collect()
            };
            // The SAME ownership-context formatter the dispatch prompt uses (one SSOT): the
            // OTHER agents' live write claims on the steered agent's files — self excluded
            // by BOTH session id AND the session's task id, so a task-bound agent is never
            // steered off its own ranges.
            let ctx = crate::symbol_ownership::agent_context::active_ownership_context(
                &claims,
                Some(&session_id),
                target.task_id.as_deref(),
                &files,
                crate::symbol_ownership::agent_context::DEFAULT_CONTEXT_CAP,
            );
            let avoid: Vec<serde_json::Value> = ctx
                .entries
                .iter()
                .map(|e| {
                    let confidence = match e.confidence {
                        crate::symbol_ownership::Confidence::Lsp => "lsp",
                        crate::symbol_ownership::Confidence::Parser => "parser",
                        crate::symbol_ownership::Confidence::DiffHunk => "diff-hunk",
                    };
                    serde_json::json!({
                        "agent": e.agent_id,
                        "symbol": e.symbol,
                        "path": e.path,
                        "startLine": e.range.start_line,
                        "endLine": e.range.end_line,
                        "confidence": confidence,
                    })
                })
                .collect();
            // The SAME renderer the loop/IPC inject into prompts (one SSOT) — so the
            // steer's human-readable directive can't drift from the dispatch wording.
            // `null` when nothing is owned (honest: there is nothing to avoid).
            let directive = crate::symbol_ownership::agent_context::render_ownership_header(&ctx);
            // Publish a TYPED, auditable directive (not raw pane input) onto the fleet
            // stream — the agent / operator reads structured data and acts on it.
            if let Some(bus) = state.event_bus.as_ref() {
                bus.publish(crate::event_bus::AgentEvent::new(
                    crate::event_bus::AgentEventKind::SteerAvoid,
                    serde_json::json!({
                        "sessionId": session_id,
                        "directive": directive,
                        "avoid": avoid,
                    }),
                ))
                .map_err(|error| ApiError::Internal(error.to_string()))?;
            }
            serde_json::json!({
                "sessionId": session_id,
                "steered": true,
                "avoidCount": avoid.len(),
                "directive": directive,
                "avoid": avoid,
            })
        }
        "aelyris.agent.activity" => {
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
        "aelyris.intent.propose" => mcp_intent_propose(&state, actor, &args)?,
        "aelyris.intent.list" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "intents": bus.open() })
        }
        "aelyris.intent.all" => {
            let bus = state.intent_bus.as_ref().ok_or_else(|| {
                ApiError::Internal("intent bus is not attached to this process".to_string())
            })?;
            serde_json::json!({ "intents": bus.all() })
        }
        "aelyris.intent.resolve" => mcp_intent_resolve(&state, actor, &args)?,
        "aelyris.knowledge.add_node" => {
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
        "aelyris.knowledge.add_edge" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let dependent = arg_string(&args, "dependent")?;
            let dependency = arg_string(&args, "dependency")?;
            kg.add_edge(&dependent, &dependency);
            serde_json::json!({ "dependent": dependent, "dependency": dependency, "added": true })
        }
        "aelyris.knowledge.remove_node" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            // Evict a deleted/renamed symbol + every edge touching it, so its
            // blast radius never routes through a node that no longer exists.
            let removed = kg.remove_node(&id);
            serde_json::json!({ "id": id, "removed": removed })
        }
        "aelyris.knowledge.remove_edge" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let dependent = arg_string(&args, "dependent")?;
            let dependency = arg_string(&args, "dependency")?;
            let removed = kg.remove_edge(&dependent, &dependency);
            serde_json::json!({ "dependent": dependent, "dependency": dependency, "removed": removed })
        }
        "aelyris.knowledge.dependencies" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            serde_json::json!({ "id": id, "dependencies": kg.dependencies_of(&id) })
        }
        "aelyris.knowledge.dependents" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            serde_json::json!({ "id": id, "dependents": kg.dependents_of(&id) })
        }
        "aelyris.knowledge.impact" => {
            let kg = state.knowledge_graph.as_ref().ok_or_else(|| {
                ApiError::Internal("knowledge graph is not attached to this process".to_string())
            })?;
            let id = arg_string(&args, "id")?;
            // Transitive blast radius: everything that depends on `id`.
            serde_json::json!({ "id": id, "impact": kg.impact_of(&id) })
        }
        "aelyris.knowledge.graph" => {
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
        // A6.4_DISPATCH_TOOL_ARMS_END
        other => {
            return Err(ApiError::BadRequest(format!("unknown MCP tool: {other}")));
        }
    };
    Ok(Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": name,
        "ok": true,
        "result": result,
    })))
}
