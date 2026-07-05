use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
#[cfg(not(test))]
use tauri::Manager;

use super::mux::{send_workspace_input, workspace_summary};
use super::{
    ApiError, ApiResult, ApiState, McpPendingDecision, MAX_MCP_PENDING, WS_MAX_INPUT_FRAME_BYTES,
};

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
        "aelyris.proofbook.cancel",
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

#[cfg(not(test))]
fn mcp_pane_rename(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    let terminal_ref = arg_string(args, "terminalId")?;
    let terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let name = arg_string(args, "name")?;
    Ok(crate::ipc::rename_pane_core(&app, &terminal_id, &name))
}

#[cfg(test)]
fn mcp_pane_rename(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let terminal_ref = arg_string(args, "terminalId")?;
    let _terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let name = arg_string(args, "name")?;
    if name == "missing-pane" {
        Ok(Err("Pane missing-pane not found".to_string()))
    } else {
        Ok(Ok(()))
    }
}

#[cfg(not(test))]
fn mcp_pane_set_role(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    let terminal_ref = arg_string(args, "terminalId")?;
    let terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let role = arg_string(args, "role")?;
    Ok(crate::ipc::set_pane_role_core(&app, &terminal_id, &role))
}

#[cfg(test)]
fn mcp_pane_set_role(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Result<(), String>> {
    let terminal_ref = arg_string(args, "terminalId")?;
    let _terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(err)) => return Ok(Err(err)),
        Err(err) => return Err(err),
    };
    let _role = arg_string(args, "role")?;
    Ok(Ok(()))
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
        }),
    }
}

fn proofbook_error_to_api(error: crate::proofbook::ProofbookError) -> ApiError {
    ApiError::BadRequest(error.to_string())
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
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let proofbook_path = arg_string(args, "proofbookPath")?;
    let inputs = args
        .get("inputs")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let executor = McpProofbookExecutor {
        state: state.clone(),
    };
    let ledger = runner
        .start_run_with_executors(
            &project_path,
            &proofbook_path,
            inputs,
            Some(&executor),
            Some(&executor),
        )
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
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

fn mcp_proofbook_decide_gate(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
    decision: &str,
) -> ApiResult<serde_json::Value> {
    let runner = mcp_proofbook_runner(state)?;
    let project_path = arg_string(args, "projectPath")?;
    let run_id = arg_string(args, "runId")?;
    let gate_id = arg_string(args, "gateId")?;
    let gate_hash = arg_string(args, "gateHash")?;
    let actor = arg_optional_string(args, "actor");
    let comment = arg_optional_string(args, "comment");
    let executor = McpProofbookExecutor {
        state: state.clone(),
    };
    let ledger = runner
        .resolve_gate_with_mcp_executor(
            &project_path,
            &run_id,
            gate_id,
            gate_hash,
            decision.to_string(),
            actor,
            comment,
            &executor,
        )
        .map_err(proofbook_error_to_api)?;
    mcp_result_value(ledger)
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
        let actor = "operator";
        if let crate::governance::AccessDecision::Deny(reason) =
            self.state.governance.authorize(actor, &tool_name)
        {
            super::audit_access_denied(&self.state, actor, &tool_name, &reason);
            return Ok(ProofbookStepOutcome::blocked(
                "mcp_governance_denied",
                format!("MCP tool {tool_name} is not permitted"),
            ));
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

        let value =
            call_mcp_tool_on_fresh_runtime(self.state.clone(), tool_name.clone(), arguments)
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
                match tools_call(State(state), Json(ToolCallBody { name, arguments })).await {
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

fn push_pending(state: &ApiState, item: McpPendingDecision) -> ApiResult<McpPendingDecision> {
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
            ));
        }
    }
    Ok(item)
}

pub(super) async fn contract(State(state): State<ApiState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "server": "aelyris",
        "transport": "local-http-json",
        "auth": "bearer-token",
        "instanceId": state.instance_id,
        "processKind": state.process_kind,
        "tools": tool_names(),
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
            "reactRequiredForToolCalls": false
        }
    }))
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
    serde_json::json!({
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
                    "required": ["terminalId", "decision", "expectedPromptKey"],
                    "properties": {
                        "terminalId": { "type": "string" },
                        "decision": { "type": "string", "enum": ["approve", "deny"] },
                        "expectedPromptKey": { "type": "string" }
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
                "description": "Queue a DURABLE merge intent (never merges to main). The repo/source/target and their branch-tip OIDs are captured and stored at request time, so the merge is bound to specific commits. Idempotent per (taskId, source commit, target commit): a duplicate request returns the original intent. Returns { intentId, status, intent }.",
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
                "description": "Reviewer authority: approve a DURABLE merge intent BY ID and perform the real git merge (fast-forward/3-way) into its BOUND target. The repo/source/target are read from the stored immutable intent — this verb does NOT accept repo/source/target (a caller can never re-point the merge), and rejects any unknown field. Operator-authority: the verb IS the verdict (an optional `verdict` must equal \"approve\"); `gatesDigest` records approval evidence. The bound branch tips are re-validated first: an already-merged target is idempotent; a moved tip becomes needs_reconcile. Returns { intentId, status, outcome }.",
                "safety": "REVIEWER_AUTHORITY",
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
                "name": "aelyris.event.recent",
                "description": "Subscribe to the fleet coordination stream (BR5): recent events across all channels, oldest first. The orchestrator reads this to see who is doing what — task_created/completed, decision_changed, review_required, agent_spawned, worktree_created, file_locked/released — without screen-scraping.",
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
    })
}

fn tools_list_value() -> serde_json::Value {
    TOOL_CATALOG.clone()
}

pub(super) async fn tools_list() -> Json<serde_json::Value> {
    Json(tools_list_value())
}

#[derive(Debug, Default, Clone)]
struct SchemaValidationReport {
    missing: Vec<String>,
    wrong_type: Vec<SchemaTypeViolation>,
    unknown: Vec<String>,
}

impl SchemaValidationReport {
    fn is_empty(&self) -> bool {
        self.missing.is_empty() && self.wrong_type.is_empty() && self.unknown.is_empty()
    }

    fn to_payload(&self, verb: &str) -> serde_json::Value {
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

fn input_schema_for_tool_ref(name: &str) -> Option<&'static serde_json::Value> {
    TOOL_SCHEMA_INDEX.get(name)
}

fn input_schema_for_tool(name: &str) -> Option<serde_json::Value> {
    input_schema_for_tool_ref(name).cloned()
}

fn schema_tool_error(name: &str, payload: serde_json::Value) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": name,
        "ok": false,
        "error": payload,
    }))
}

fn validate_tool_arguments(
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
fn schema_subset_violations(schema: &serde_json::Value) -> Vec<String> {
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

pub(super) async fn tools_call(
    State(state): State<ApiState>,
    Json(body): Json<ToolCallBody>,
) -> ApiResult<Json<serde_json::Value>> {
    let arguments = if body.arguments.is_null() {
        serde_json::json!({})
    } else {
        body.arguments.clone()
    };
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
    if let Some(schema) = input_schema_for_tool(&body.name) {
        if let Err(report) = validate_tool_arguments(&body.name, &arguments, &schema) {
            return Ok(schema_tool_error(&body.name, report.to_payload(&body.name)));
        }
    }
    let args = arguments.as_object().cloned().unwrap_or_default();
    let result = match body.name.as_str() {
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
            let approval_id = arg_optional_string(&args, "approvalId");
            send_workspace_input(
                &state,
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
            let repo_path = arg_string(&args, "repoPath")?;
            let branch_name = arg_string(&args, "branchName")?;
            let worktree = crate::control::worktree::create(&repo_path, &branch_name)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "branchName": branch_name, "worktree": worktree })
        }
        "aelyris.worktree.remove" => {
            let repo_path = arg_string(&args, "repoPath")?;
            let worktree_name = arg_string(&args, "worktreeName")?;
            let delete_branch = arg_bool(&args, "deleteBranch", false);
            crate::control::worktree::remove(&repo_path, &worktree_name, delete_branch)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "repoPath": repo_path, "worktreeName": worktree_name, "removed": true, "deleteBranch": delete_branch })
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
            if text.len() > WS_MAX_INPUT_FRAME_BYTES {
                return Err(ApiError::BadRequest(format!(
                    "input frame exceeds {} bytes",
                    WS_MAX_INPUT_FRAME_BYTES
                )));
            }
            // FR-1: same rule as the REST/IPC faces — agent-injected input must
            // never land on a pane waiting at an approval menu; resolve it via
            // aelyris.approval.resolve instead. Typed tool error (aelys exit 2).
            #[cfg(not(test))]
            if let Some(app) = state.app_handle.as_ref() {
                if let Err(err) = crate::ipc::reject_waiting_approval_via_app(app, &terminal_id) {
                    return Ok(schema_tool_error(
                        &body.name,
                        serde_json::json!({ "error": err }),
                    ));
                }
            }
            // P0-4: classify the agent-injected command BEFORE it reaches the PTY
            // (hard boundary #1). An agent steering a terminal is exactly the
            // automated-injection path the gate exists to catch.
            let targets = [terminal_id.clone()];
            let writable = super::gate_command_input(
                &state,
                "mcp-pane-input",
                &terminal_id,
                &targets,
                approval_id.as_deref(),
                text.as_bytes(),
                // arg_string trims the payload -> classify the whole bare command
                crate::command_risk::gate::GateMode::Atomic,
            )?;
            state
                .pty
                .write(&terminal_id, &writable)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "terminalId": terminal_id, "accepted": true })
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
        "aelyris.session.summarize" => mcp_session_summarize(&state, &args).await?,
        "aelyris.session.checkpoint" => mcp_session_checkpoint(&state, &args)?,
        "aelyris.session.handoff" => mcp_session_handoff(&state, &args).await?,
        "aelyris.session.resume" => mcp_session_resume(&state, &args).await?,
        "aelyris.session.reset_context" => mcp_session_reset_context(&state, &args).await?,
        "aelyris.proofbook.list" => mcp_proofbook_list(&args)?,
        "aelyris.proofbook.get" => mcp_proofbook_get(&args)?,
        "aelyris.proofbook.validate" => mcp_proofbook_validate(&args)?,
        "aelyris.proofbook.run" => mcp_proofbook_run(&state, &args)?,
        "aelyris.proofbook.status" => mcp_proofbook_status(&state, &args)?,
        "aelyris.proofbook.cancel" => mcp_proofbook_cancel(&state, &args)?,
        "aelyris.proofbook.approve_gate" => mcp_proofbook_decide_gate(&state, &args, "approve")?,
        "aelyris.proofbook.reject_gate" => mcp_proofbook_decide_gate(&state, &args, "reject")?,
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
                    &body.name,
                    approval_resolve_error_payload(&err),
                ));
            }
        },
        "aelyris.pane.rename" => match mcp_pane_rename(&state, &args)? {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(err) => {
                return Ok(schema_tool_error(
                    &body.name,
                    serde_json::json!({ "error": err }),
                ));
            }
        },
        "aelyris.pane.set_role" => match mcp_pane_set_role(&state, &args)? {
            Ok(()) => serde_json::json!({ "ok": true }),
            Err(err) => {
                return Ok(schema_tool_error(
                    &body.name,
                    serde_json::json!({ "error": err }),
                ));
            }
        },
        "aelyris.request_merge" => {
            // Fail closed: a merge intent MUST be durable. Without the store we do
            // not fall back to a RAM queue a restart would lose (P0-3).
            let store = state.merge_store.as_ref().ok_or_else(|| {
                ApiError::Internal("merge persistence is not attached to this process".to_string())
            })?;
            let task_id = arg_string(&args, "taskId")?;
            let source_branch = arg_string(&args, "sourceBranch")?;
            let target_branch = arg_string(&args, "targetBranch")?;
            let session_id = arg_optional_string(&args, "sessionId");
            // Canonicalize the repo at REQUEST time: the intent is bound to a
            // normalized absolute path the approver can never re-point later.
            let repo_path = {
                let raw = arg_string(&args, "repoPath")?;
                let canonical = std::fs::canonicalize(&raw).map_err(|_| {
                    ApiError::BadRequest("repoPath must exist and be accessible".to_string())
                })?;
                if !canonical.is_dir() {
                    return Err(ApiError::BadRequest(
                        "repoPath must be a directory".to_string(),
                    ));
                }
                super::session_common::strip_local_verbatim_prefix(&canonical.to_string_lossy())
            };
            // Resolve the branch tips NOW (also validates names + source!=target):
            // the immutable intent is bound to these exact commits.
            let readiness =
                crate::control::merge::inspect(&repo_path, &source_branch, &target_branch)
                    .map_err(ApiError::BadRequest)?;
            let now = now_secs() as i64;
            let intent = crate::merge_intent::MergeIntent {
                intent_id: format!("merge:{task_id}:{}", uuid::Uuid::new_v4()),
                repo_path,
                source_branch,
                target_branch,
                source_oid: readiness.source_oid,
                target_oid: readiness.target_oid,
                merge_base_oid: readiness.merge_base_oid,
                task_id,
                created_at: now,
                state: crate::merge_intent::MergeIntentState::Queued,
                updated_at: now,
                session_id,
                reviewer_id: None,
                gates_digest: None,
            };
            // Idempotent: a duplicate (taskId, source_oid, target_oid) resolves to
            // the original intent — no second row, no second merge.
            let stored = store.create_or_get(&intent).map_err(ApiError::Internal)?;
            serde_json::json!({
                "intentId": stored.intent_id,
                "status": stored.state.as_str(),
                "intent": stored,
            })
        }
        "aelyris.spawn_agent" => {
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
        "aelyris.agent.spawn_visible" => match mcp_spawn_visible(&state, &args).await? {
            Ok(value) => value,
            Err(err) => {
                return Ok(schema_tool_error(
                    &body.name,
                    serde_json::json!({ "error": err }),
                ));
            }
        },
        "aelyris.stop_agent" => {
            let manager = state.agent_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("agent runtime is not attached to this process".to_string())
            })?;
            let session_id = arg_string(&args, "sessionId")?;
            crate::control::agent::stop_headless(manager, &session_id)
                .map_err(ApiError::BadRequest)?;
            serde_json::json!({ "sessionId": session_id, "stopped": true })
        }
        "aelyris.review.approve" => {
            let store = state.merge_store.as_ref().ok_or_else(|| {
                ApiError::Internal("merge persistence is not attached to this process".to_string())
            })?;
            // HARD BOUNDARIES #1 + #2: approve binds ONLY to a stored intent. The MCP
            // dispatcher does NOT enforce the declared input schema (it hands the
            // handler the raw args), so repo/source/target — and EVERY other unknown
            // field — are rejected EXPLICITLY here, before any merge work. A caller
            // can never re-point the merge.
            const APPROVE_ALLOWED: &[&str] = &["intentId", "verdict", "gatesDigest"];
            if let Some(bad) = args.keys().find(|k| !APPROVE_ALLOWED.contains(&k.as_str())) {
                return Err(ApiError::BadRequest(format!(
                    "aelyris.review.approve does not accept `{bad}`: it approves a stored intent by \
                     intentId only — repo/source/target come from the immutable intent, never the caller"
                )));
            }
            let intent_id = arg_string(&args, "intentId")?;
            // STRICT shape (close the type-confusion bypass): a present `verdict`
            // must be EXACTLY the string "approve", and a present `gatesDigest` must
            // be a string. A non-string value (object/array/null/number) is a
            // rejected shape, NOT "absent" — `arg_optional_string` would silently
            // treat `{"verdict":{...}}` as absent and let a malformed call through.
            if let Some(v) = args.get("verdict") {
                if v.as_str() != Some("approve") {
                    return Err(ApiError::BadRequest(
                        "verdict must be the string \"approve\"; use aelyris.review.reject to reject"
                            .to_string(),
                    ));
                }
            }
            let gates_digest = match args.get("gatesDigest") {
                None => None,
                Some(serde_json::Value::String(s)) => Some(s.clone()),
                Some(_) => {
                    return Err(ApiError::BadRequest(
                        "gatesDigest must be a string".to_string(),
                    ));
                }
            };

            let execution = crate::control::merge::approve_durable_intent(
                store,
                &intent_id,
                actor,
                gates_digest.as_deref(),
                now_secs() as i64,
            )
            .map_err(|err| {
                use crate::control::merge::DurableMergeError;
                match err {
                    DurableMergeError::NotFound(_) => ApiError::NotFound(intent_id.clone()),
                    DurableMergeError::InvalidRequest(message) => ApiError::BadRequest(message),
                    DurableMergeError::Persistence(message) => ApiError::Internal(message),
                }
            })?;

            serde_json::json!({
                "intentId": execution.intent_id,
                "status": execution.status,
                "outcome": execution.outcome,
            })
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
        "aelyris.task.create" => {
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
            // Task.symbols (the finer lane that unlocks same-file co-dispatch, §6.2) are
            // MINTED ONLY by `enrich_plan_with_symbols`, which VERIFIES each declared
            // symbol against real source via the tree-sitter parser. A caller must never
            // supply them — that would let an unverified guess wear `Confidence::Parser`
            // and falsely unlock parallelism (A6.3 hard boundary). Reject the attempt.
            if args.contains_key("symbols") {
                return Err(ApiError::BadRequest(
                    "task symbols cannot be set via task.create — they are derived from \
                     verified source by the planner's symbol-enrichment step"
                        .to_string(),
                ));
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
        "aelyris.task.list" => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this process".to_string())
            })?;
            serde_json::json!({ "tasks": tasks.list() })
        }
        "aelyris.task.transition" => {
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
                state.merge_store.clone(),
                // P4: the autonomous (MCP) face persists give-ups too — the path
                // that most needs unattended-safe durability.
                state.db.as_deref(),
            );
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
        "aelyris.ownership.assign" => {
            let ownership = state.file_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("file ownership is not attached to this process".to_string())
            })?;
            let agent_id = arg_string(&args, "agentId")?;
            let pattern = arg_string(&args, "pattern")?;
            let claim =
                crate::file_ownership::OwnershipClaim::new(agent_id.clone(), pattern.clone());
            ownership_db(&state)?
                .with(|db| {
                    crate::persistence::OwnershipRepo::upsert_file_claim(db, &claim, now_secs())
                })
                .map_err(ApiError::Internal)?;
            let conflicts = {
                let mut owner = ownership
                    .lock()
                    .map_err(|_| ApiError::Internal("file ownership lock poisoned".to_string()))?;
                owner.assign_claim(claim);
                owner.conflicts()
            };
            serde_json::json!({ "agentId": agent_id, "pattern": pattern, "conflicts": conflicts })
        }
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
        "aelyris.symbol.claim" => {
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
            let claim_id = arg_string(&args, "claimId")?;
            // `parse:` / `dh:` are RESERVED id prefixes for extractor-derived claims
            // (claim_from_source / claim_from_diff) so their reconcile can't sweep a
            // hand-made claim. Reject a manual claim that squats on them.
            if claim_id.starts_with("parse:") || claim_id.starts_with("dh:") {
                return Err(ApiError::BadRequest(
                    "claimId prefix `parse:`/`dh:` is reserved for derived claims".to_string(),
                ));
            }
            let claim = crate::symbol_ownership::SymbolClaim {
                claim_id,
                agent_id: arg_string(&args, "agentId")?,
                task_id: args
                    .get("taskId")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                // Normalize to forward slashes so a `src\x.rs` claim conflict-detects
                // against a `src/x.rs` claim (path equality drives conflict_between).
                path: arg_string(&args, "path")?.replace('\\', "/"),
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
                let mut staging = owner.clone();
                let outcome = staging.claim(claim.clone(), now);
                if !matches!(
                    outcome,
                    crate::symbol_ownership::ClaimOutcome::Blocked { .. }
                ) {
                    ownership_db(&state)?
                        .with(|db| {
                            crate::persistence::OwnershipRepo::upsert_symbol_claim(db, &claim, now)
                        })
                        .map_err(ApiError::Internal)?;
                    *owner = staging;
                }
                outcome
            };
            serde_json::to_value(outcome)
                .map_err(|err| ApiError::Internal(format!("serialize symbol outcome: {err}")))?
        }
        "aelyris.symbol.refresh" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let claim_id = arg_string(&args, "claimId")?;
            let lease_secs = args
                .get("leaseSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            let now = now_secs();
            let refreshed = {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                let mut staging = owner.clone();
                if !staging.refresh(&claim_id, now, lease_secs) {
                    false
                } else {
                    let claim = staging.get(&claim_id).cloned().ok_or_else(|| {
                        ApiError::Internal(format!("refreshed claim vanished: {claim_id}"))
                    })?;
                    ownership_db(&state)?
                        .with(|db| {
                            crate::persistence::OwnershipRepo::upsert_symbol_claim(db, &claim, now)
                        })
                        .map_err(ApiError::Internal)?;
                    *owner = staging;
                    true
                }
            };
            serde_json::json!({ "refreshed": refreshed })
        }
        "aelyris.symbol.release" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let claim_id = arg_string(&args, "claimId")?;
            ownership_db(&state)?
                .with(|db| crate::persistence::OwnershipRepo::delete_symbol_claim(db, &claim_id))
                .map_err(ApiError::Internal)?;
            let released = ownership
                .lock()
                .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?
                .release(&claim_id);
            serde_json::json!({ "released": released })
        }
        "aelyris.symbol.release_task" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let task_id = arg_string(&args, "taskId")?;
            ownership_db(&state)?
                .with(|db| {
                    crate::persistence::OwnershipRepo::delete_symbol_claims_for_task(db, &task_id)
                })
                .map_err(ApiError::Internal)?;
            let released = ownership
                .lock()
                .map_err(|_| ApiError::Internal("symbol ownership lock poisoned".to_string()))?
                .release_for_task(&task_id);
            serde_json::json!({ "released": released })
        }
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
        "aelyris.symbol.claim_from_diff" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            let lease_secs = args
                .get("leaseSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            let agent_id = arg_string(&args, "agentId")?;
            let task_id = args
                .get("taskId")
                .and_then(|v| v.as_str())
                .map(String::from);
            // Raw (no trim): preserve the diff exactly. Hunk headers carry absolute
            // line numbers so trimming wouldn't shift ranges, but an empty diff should
            // mean "0 hunks", not a BadRequest.
            let diff = arg_string_raw(&args, "diff")?;
            // Bound untrusted diff text (mirrors the maxLength on the schema +
            // the pane-input frame cap): a 1 MiB ceiling before we parse it.
            if diff.len() > 1_048_576 {
                return Err(ApiError::BadRequest("diff exceeds 1 MiB".to_string()));
            }
            // Default Write (the only mode that drives a collision); an explicit
            // mode is validated against the enum.
            let mode: crate::symbol_ownership::ClaimMode = match args.get("mode") {
                Some(v) => serde_json::from_value(v.clone())
                    .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?,
                None => crate::symbol_ownership::ClaimMode::Write,
            };
            let intents = crate::symbol_ownership::extract::intents_from_diff(&diff, mode);
            let mut claims = Vec::new();
            let mut recorded = 0usize;
            let mut delete_claim_ids = Vec::new();
            let mut upsert_claims = Vec::new();
            {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                let mut staging = owner.clone();
                // Sweep expired leases first (sibling verbs claims/conflicts do the
                // same) so a crashed agent's stale span can't linger in the map.
                staging.expire(now);
                for intent in intents {
                    // Deterministic id so re-running on an updated diff is idempotent
                    // per span (release the prior claim for this span, then re-add). The
                    // `dh:` prefix marks the diff-hunk origin so claim_from_source's
                    // parser reconcile (which sweeps `parse:`-prefixed ids) leaves these.
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
                    // `recorded` = claims actually stored. DiffHunk never Blocks, but
                    // count defensively so the field can never overstate ownership.
                    if !matches!(
                        outcome,
                        crate::symbol_ownership::ClaimOutcome::Blocked { .. }
                    ) {
                        recorded += 1;
                        upsert_claims.push(claim);
                    }
                    claims.push(serde_json::json!({ "claimId": claim_id, "outcome": outcome }));
                }
                ownership_db(&state)?
                    .with(|db| {
                        crate::persistence::OwnershipRepo::reconcile_symbol_claims(
                            db,
                            &delete_claim_ids,
                            &[],
                            &upsert_claims,
                            now,
                        )
                    })
                    .map_err(ApiError::Internal)?;
                *owner = staging;
            }
            serde_json::json!({ "recorded": recorded, "claims": claims })
        }
        "aelyris.symbol.claim_from_source" => {
            let ownership = state.symbol_ownership.as_ref().ok_or_else(|| {
                ApiError::Internal("symbol ownership is not attached to this process".to_string())
            })?;
            let now = now_secs();
            let lease_secs = args
                .get("leaseSecs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            let agent_id = arg_string(&args, "agentId")?;
            let task_id = args
                .get("taskId")
                .and_then(|v| v.as_str())
                .map(String::from);
            // Normalize the path to forward slashes so the reconcile prefix and the
            // per-claim ids are spelling-consistent across calls (re-parsing `src\x.rs`
            // then `src/x.rs` reconciles the same file).
            let path = arg_string(&args, "path")?.replace('\\', "/");
            // Raw (no trim): trimming would strip leading blank lines and shift every
            // parsed symbol's line number. Empty source is valid -> fallback, no claims.
            let source = arg_string_raw(&args, "source")?;
            // Bound untrusted source text (same 1 MiB ceiling as the diff verb).
            if source.len() > 1_048_576 {
                return Err(ApiError::BadRequest("source exceeds 1 MiB".to_string()));
            }
            let mode: crate::symbol_ownership::ClaimMode = match args.get("mode") {
                Some(v) => serde_json::from_value(v.clone())
                    .map_err(|_| ApiError::BadRequest("invalid mode".to_string()))?,
                None => crate::symbol_ownership::ClaimMode::Write,
            };
            let intents =
                crate::symbol_ownership::extract::intents_from_source(&path, &source, mode);
            // No safe symbols (unsupported language / unparseable) -> file-level fallback.
            let fallback = intents.is_empty();
            let mut claims = Vec::new();
            let mut recorded = 0usize;
            let reconcile_prefix = format!("parse:{agent_id}:{path}:");
            let mut upsert_claims = Vec::new();
            {
                let mut owner = ownership.lock().map_err(|_| {
                    ApiError::Internal("symbol ownership lock poisoned".to_string())
                })?;
                let mut staging = owner.clone();
                staging.expire(now);
                // Reconcile: the parser re-derives the WHOLE file, so drop this agent's
                // prior PARSER-derived claims on the path (the `parse:{agent}:{path}:`
                // prefix) before recording the fresh set — a renamed/removed symbol's
                // stale claim is freed. Scoped by prefix so it leaves the agent's
                // diff-hunk (`dh:`) and hand-made claims on the same file untouched.
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
                    // `recorded` counts claims actually stored — a Parser claim that
                    // Blocks against another agent's exact range is NOT recorded, so it
                    // must not inflate the count (the caller mustn't think it owns it).
                    if !matches!(
                        outcome,
                        crate::symbol_ownership::ClaimOutcome::Blocked { .. }
                    ) {
                        recorded += 1;
                        upsert_claims.push(claim);
                    }
                    claims.push(serde_json::json!({ "claimId": claim_id, "outcome": outcome }));
                }
                ownership_db(&state)?
                    .with(|db| {
                        crate::persistence::OwnershipRepo::reconcile_symbol_claims(
                            db,
                            &[],
                            std::slice::from_ref(&reconcile_prefix),
                            &upsert_claims,
                            now,
                        )
                    })
                    .map_err(ApiError::Internal)?;
                *owner = staging;
            }
            serde_json::json!({ "recorded": recorded, "fallback": fallback, "claims": claims })
        }
        "aelyris.context.set" => {
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
        "aelyris.context.remove" => {
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
                ));
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
                ));
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
                ));
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
        "aelyris.intent.propose" => {
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
        "aelyris.intent.resolve" => {
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
        other => {
            return Err(ApiError::BadRequest(format!("unknown MCP tool: {other}")));
        }
    };
    Ok(Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": body.name,
        "ok": true,
        "result": result,
    })))
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

const MCP_INSTRUCTIONS: &str = "Aelyris is an autonomous build runtime you (the orchestrator) drive via these aelyris.* tools; the worker agents (real claude/codex/gemini CLIs in isolated worktrees) do the implementation. Loop: (1) context.set the project decisions/ADR (injected into every dispatched agent). (2) task.create one per subtask with owner=<implementer identity> (reviewer must differ from it to merge), model=<claude|codex|gemini> (optional CLI routing; defaults to owner), sourceBranch/targetBranch, dependencies, outputs=<file lanes>; check ownership.conflicts. (3) worktree.create each branch. (4) Call orchestrator.step repeatedly with {repoPath, reviewerId(!=owner), activeAgents, gates}: finished agents -> review, all-green verdict -> real git merge, ready tasks -> spawned; agents run between calls, so pace them. (5) Coordinate between steps via event.recent / agent.activity (who edits what), knowledge.impact (blast radius), intent.propose/list (pre-fact proposals), ownership.conflicts, blocker_raised. You are the reviewer; supply each task's gates from your own inspection. Local-only; concurrency cap 4.";

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
                "serverInfo": { "name": "aelyris", "version": env!("CARGO_PKG_VERSION") },
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

    fn test_db() -> Arc<crate::db::ManagedDb> {
        Arc::new(crate::db::ManagedDb::new(
            crate::db::Database::open_memory().expect("memory db"),
        ))
    }

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
            "expectedPromptKey": "fresh-test"
        }));
        assert_eq!(ok["ok"], serde_json::json!(true));
        assert_eq!(ok["result"]["ok"], serde_json::json!(true));

        let stale = call(serde_json::json!({
            "terminalId": "pty-1",
            "decision": "approve",
            "expectedPromptKey": "stale-test"
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
            "decision": "approve"
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
            ("aelyris.proofbook.cancel", "GATED"),
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
        let body = ToolCallBody {
            name: "aelyris.proofbook.run".to_string(),
            arguments: serde_json::json!({ "projectPath": "C:/repo", "proofbookPath": "x" }),
        };
        let result = rt.block_on(tools_call(State(state), Json(body)));
        assert!(matches!(result, Err(ApiError::Forbidden(_))));
    }

    #[test]
    fn proofbook_mcp_run_executes_free_mcp_tool_step_through_tools_call() {
        use crate::proofbook::{ProofbookRunStatus, ProofbookStepStatus};
        use crate::pty::PtyManager;

        let project = tempfile::tempdir().expect("tempdir");
        let proofbook = write_test_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb3-free-mcp
steps:
  - id: list
    type: mcpTool
    toolName: terminal.list
    arguments: {}
settlement:
  requiredSteps: [list]
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

        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
        let output = ledger.steps[0]
            .structured_output
            .as_ref()
            .expect("mcp output");
        assert_eq!(output["kind"], "mcpTool");
        assert_eq!(output["toolName"], "terminal.list");
        assert!(output["result"]["sessions"].is_array());
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
    fn proofbook_gated_mcp_tool_waits_and_stale_gate_hash_fails_closed() {
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
            .block_on(tools_call(State(state.clone()), Json(body)))
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

        let stale = ToolCallBody {
            name: "aelyris.proofbook.approve_gate".to_string(),
            arguments: serde_json::json!({
                "projectPath": project.path().to_string_lossy(),
                "runId": ledger.run_id,
                "gateId": output["gateId"].as_str().unwrap(),
                "gateHash": "sha256:stale",
            }),
        };
        let result = rt.block_on(tools_call(State(state), Json(stale)));
        match result {
            Err(ApiError::BadRequest(message)) => {
                assert!(message.contains("StaleGateHash"), "{message}")
            }
            other => panic!("expected stale hash BadRequest, got {other:?}"),
        }
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

    /// P0-3 inc3: `aelyris.request_merge` binds the repo/branch/OIDs into a durable
    /// intent at request time, and is idempotent per (taskId, source_oid,
    /// target_oid) — a duplicate request returns the ORIGINAL intent, not a new one.
    #[test]
    fn request_merge_is_idempotent_and_binds_immutable_fields() {
        use crate::db::{Database, ManagedDb};
        use crate::merge_intent::store::MergeIntentStore;
        use crate::pty::PtyManager;
        use git2::{build::CheckoutBuilder, Repository};
        use std::path::Path;
        use std::sync::Arc;

        // temp repo: main, then a `feature` branch one commit ahead of main.
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
            .with_merge_store(Some(store));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |args: serde_json::Value| -> serde_json::Value {
            let body = ToolCallBody {
                name: "aelyris.request_merge".to_string(),
                arguments: args,
            };
            let Json(v) = rt
                .block_on(tools_call(State(state.clone()), Json(body)))
                .expect("request_merge ok");
            v
        };

        let args = serde_json::json!({
            "taskId": "task-1",
            "repoPath": repo_path,
            "sourceBranch": "feature",
            "targetBranch": "main",
        });
        let first = call(args.clone());
        let id1 = first["result"]["intentId"].as_str().unwrap().to_string();
        assert!(id1.starts_with("merge:task-1:"));
        assert_eq!(first["result"]["status"], "queued");
        // The intent bound the real branch + a concrete OID at request time.
        assert_eq!(first["result"]["intent"]["sourceBranch"], "feature");
        assert!(
            first["result"]["intent"]["sourceOid"]
                .as_str()
                .unwrap()
                .len()
                >= 7
        );

        // A DUPLICATE request (same task + same source/target commits) returns the
        // SAME intent id — no second row, no second merge.
        let second = call(args);
        assert_eq!(second["result"]["intentId"].as_str().unwrap(), id1);

        // Fail closed: with no store attached, the verb errors (no RAM fallback) —
        // and specifically an Internal error (persistence missing), not a
        // request-shape error.
        let no_store = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"));
        let body = ToolCallBody {
            name: "aelyris.request_merge".to_string(),
            arguments: serde_json::json!({
                "taskId": "t", "repoPath": repo_path, "sourceBranch": "feature", "targetBranch": "main"
            }),
        };
        let err = rt
            .block_on(tools_call(State(no_store), Json(body)))
            .expect_err("fail closed without a merge store");
        assert!(matches!(err, ApiError::Internal(_)), "{err:?}");
    }

    /// P0-3 inc4/5 (the security headline): `aelyris.review.approve` binds ONLY to a
    /// stored intent. It must REJECT caller-supplied repo/source/target and any
    /// unknown field BEFORE merging (boundaries #1+#2), merge using ONLY the stored
    /// branches (boundary #4), and not be re-claimable once merged.
    #[test]
    fn review_approve_rejects_overrides_and_merges_only_the_stored_intent() {
        use crate::db::{Database, ManagedDb};
        use crate::merge_intent::store::MergeIntentStore;
        use crate::pty::PtyManager;
        use git2::{build::CheckoutBuilder, Repository};
        use std::path::Path;
        use std::sync::Arc;

        // temp repo: main at base; `feature` one commit ahead (fast-forwardable).
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
        let feat = commit("b.txt", "feat", &[base]);
        repo.set_head("refs/heads/main").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();

        let store = Arc::new(MergeIntentStore::new(Arc::new(ManagedDb::new(
            Database::open_memory().unwrap(),
        ))));
        let state = ApiState::new(PtyManager::new(), crate::api::AuthConfig::with_token("t"))
            .with_merge_store(Some(store));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let call = |name: &str, args: serde_json::Value| {
            let body = ToolCallBody {
                name: name.to_string(),
                arguments: args,
            };
            rt.block_on(tools_call(State(state.clone()), Json(body)))
        };

        // Request a durable intent for feature -> main.
        let Json(req) = call(
            "aelyris.request_merge",
            serde_json::json!({
                "taskId": "task-1", "repoPath": repo_path,
                "sourceBranch": "feature", "targetBranch": "main",
            }),
        )
        .expect("request ok");
        let intent_id = req["result"]["intentId"].as_str().unwrap().to_string();

        // BOUNDARY #1: a caller-supplied repo/source/target is rejected (it tries to
        // re-point the merge) — BEFORE any merge, so the intent stays claimable.
        let Json(override_err) = call(
            "aelyris.review.approve",
            serde_json::json!({
                "intentId": intent_id, "repoPath": "C:/evil",
                "sourceBranch": "evil", "targetBranch": "main",
            }),
        )
        .expect("override rejected as a structured schema violation");
        assert_eq!(override_err["ok"], serde_json::json!(false));
        assert_eq!(
            override_err["error"]["schema_violation"]["unknown"],
            serde_json::json!(["repoPath", "sourceBranch", "targetBranch"])
        );

        // BOUNDARY #2: any OTHER unknown field is rejected too.
        let Json(unknown_err) = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id, "smuggle": 1 }),
        )
        .expect("unknown field rejected as a structured schema violation");
        assert_eq!(unknown_err["ok"], serde_json::json!(false));
        assert_eq!(
            unknown_err["error"]["schema_violation"]["unknown"],
            serde_json::json!(["smuggle"])
        );

        // The real approve (intentId only) merges using the STORED branches.
        let Json(ok) = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id, "verdict": "approve" }),
        )
        .expect("approve ok");
        assert_eq!(ok["result"]["status"], "merged");
        // main now actually contains the feature commit (the merge really happened).
        assert!(crate::git::branch_contains_commit(&repo_path, "main", &feat.to_string()).unwrap());

        // A merged intent is no longer claimable — a re-approve loses the CAS.
        let reapprove = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id }),
        )
        .expect_err("re-approve of a merged intent must fail");
        assert!(
            matches!(reapprove, ApiError::BadRequest(_)),
            "{reapprove:?}"
        );

        // An unknown intent id is NotFound.
        let missing = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": "ghost" }),
        )
        .expect_err("unknown intent");
        assert!(matches!(missing, ApiError::NotFound(_)), "{missing:?}");
    }

    /// P0-3 inc4/5 robustness (Codex headline review): a non-string `verdict` /
    /// `gatesDigest` must be REJECTED, not silently treated as absent (type-
    /// confusion bypass); and if a branch tip moved since the request, the
    /// OID-bound merge must mark the intent needs_reconcile rather than merge an
    /// unreviewed commit.
    #[test]
    fn review_approve_rejects_nonstring_fields_and_flags_stale_tips() {
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

        // Keep a handle to the store so we can assert the persisted state directly.
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

        let Json(req) = call(
            "aelyris.request_merge",
            serde_json::json!({
                "taskId": "task-1", "repoPath": repo_path,
                "sourceBranch": "feature", "targetBranch": "main",
            }),
        )
        .expect("request ok");
        let intent_id = req["result"]["intentId"].as_str().unwrap().to_string();

        // Type confusion: a NON-string verdict / gatesDigest is rejected, not
        // treated as absent (the intent stays claimable).
        let Json(bad_verdict) = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id, "verdict": { "repoPath": "evil" } }),
        )
        .expect("object verdict rejected as a structured schema violation");
        assert_eq!(bad_verdict["ok"], serde_json::json!(false));
        assert_eq!(
            bad_verdict["error"]["schema_violation"]["wrong_type"][0]["field"],
            "verdict"
        );
        let Json(bad_digest) = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id, "gatesDigest": 5 }),
        )
        .expect("non-string gatesDigest rejected as a structured schema violation");
        assert_eq!(bad_digest["ok"], serde_json::json!(false));
        assert_eq!(
            bad_digest["error"]["schema_violation"]["wrong_type"][0]["field"],
            "gatesDigest"
        );
        // Still claimable (the bad calls did not consume it).
        assert_eq!(
            store.get(&intent_id).unwrap().unwrap().state,
            MergeIntentState::Queued
        );

        // Move the target tip AFTER the request: main diverges from the reviewed base.
        commit("c.txt", "main-moved", &[base]);

        // The OID-bound approve must NOT merge an unreviewed state — it flags
        // needs_reconcile.
        let stale = call(
            "aelyris.review.approve",
            serde_json::json!({ "intentId": intent_id }),
        )
        .expect_err("stale tips rejected");
        assert!(matches!(stale, ApiError::BadRequest(_)), "{stale:?}");
        assert_eq!(
            store.get(&intent_id).unwrap().unwrap().state,
            MergeIntentState::NeedsReconcile,
            "a moved tip leaves the intent needs_reconcile, never merged"
        );
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

        let Json(req) = call(
            "aelyris.request_merge",
            serde_json::json!({
                "taskId": "task-1", "repoPath": repo_path,
                "sourceBranch": "feature", "targetBranch": "main",
            }),
        )
        .expect("request ok");
        let intent_id = req["result"]["intentId"].as_str().unwrap().to_string();

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
        let err = call("rm -rf /tmp/x\r").unwrap_err();
        assert!(
            matches!(&err, ApiError::CommandRiskBlocked(d) if d.catastrophic),
            "{err:?}"
        );
        // A review command without an approval id is refused (not catastrophic).
        let err2 = call("git commit -m x\r").unwrap_err();
        assert!(
            matches!(&err2, ApiError::CommandRiskBlocked(d) if !d.catastrophic),
            "{err2:?}"
        );
    }
}
