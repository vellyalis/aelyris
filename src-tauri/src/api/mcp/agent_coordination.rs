use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_optional_string, arg_optional_string_array, arg_string, now_secs};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated agent coordination Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn session_digest(session_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.agent-coordination\n{session_id}"
    ))
    .as_str()
    .to_string()
}

fn input_digest(operation: &str, values: &[&str]) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.agent-coordination-input\n{operation}\n{}",
        values.join("\n")
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    operation: &str,
    session_digest: &str,
    input_digest: &str,
    outcome: Option<&str>,
    coordination_count: Option<usize>,
    status: &str,
    rejection_code: Option<&str>,
    mutation_applied: Option<bool>,
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
        correlation_id: Some(session_digest.to_string()),
        kind: "mcp_agent_coordination_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-agent-coordination".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "sessionDigest": session_digest,
            "inputDigest": input_digest,
            "outcome": outcome,
            "coordinationCount": coordination_count,
            "status": status,
            "rejectionCode": rejection_code,
            "mutationApplied": mutation_applied,
            "eventPublished": event_published,
            "coordinationValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, session_digest, error = %error, "agent coordination audit failed");
    }
}

pub(super) fn report_activity(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let session_id = arg_string(args, "sessionId")?;
    let action = arg_string(args, "action")?;
    let file = arg_optional_string(args, "file");
    let symbol = arg_optional_string(args, "symbol");
    let session_digest = session_digest(&session_id);
    let input_digest = input_digest(
        "report_activity",
        &[
            session_id.as_str(),
            action.as_str(),
            file.as_deref().unwrap_or(""),
            symbol.as_deref().unwrap_or(""),
        ],
    );
    let detail_count = usize::from(file.is_some()) + usize::from(symbol.is_some());
    let manager = match state.agent_manager.as_ref() {
        Some(manager) => manager,
        None => {
            audit(
                state,
                actor,
                "report_activity",
                &session_digest,
                &input_digest,
                None,
                Some(detail_count),
                "rejected",
                Some("agent_runtime_unavailable"),
                Some(false),
                None,
            );
            return Err(ApiError::Internal(
                "agent runtime is not attached to this process".to_string(),
            ));
        }
    };
    let mutation_applied = match manager.set_live_activity(
        &session_id,
        action.clone(),
        file.clone(),
        symbol.clone(),
    ) {
        Ok(applied) => applied,
        Err(error) => {
            audit(
                state,
                actor,
                "report_activity",
                &session_digest,
                &input_digest,
                None,
                Some(detail_count),
                "rejected",
                Some("agent_activity_mutation_failed"),
                Some(false),
                None,
            );
            return Err(ApiError::Internal(error));
        }
    };
    if !mutation_applied {
        audit(
            state,
            actor,
            "report_activity",
            &session_digest,
            &input_digest,
            Some("missing"),
            Some(detail_count),
            "rejected",
            Some("agent_session_not_live"),
            Some(false),
            None,
        );
        return Err(ApiError::NotFound(format!(
            "no live agent session '{session_id}' to report activity"
        )));
    }
    let event_published = if let Some(bus) = state.event_bus.as_ref() {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::AgentActivity,
            serde_json::json!({
                "sessionId": session_id,
                "action": action,
                "file": file,
                "symbol": symbol,
            }),
        )) {
            audit(
                state,
                actor,
                "report_activity",
                &session_digest,
                &input_digest,
                Some("reported"),
                Some(detail_count),
                "rejected",
                Some("agent_coordination_event_publication_failed"),
                Some(true),
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit(
        state,
        actor,
        "report_activity",
        &session_digest,
        &input_digest,
        Some("reported"),
        Some(detail_count),
        "accepted",
        None,
        Some(true),
        event_published,
    );
    Ok(serde_json::json!({
        "sessionId": session_id,
        "reported": true,
    }))
}

pub(super) fn report_blocker(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let session_id = arg_string(args, "sessionId")?;
    let summary = arg_string(args, "summary")?;
    let needs = arg_optional_string(args, "needs");
    let session_digest = session_digest(&session_id);
    let input_digest = input_digest(
        "report_blocker",
        &[
            session_id.as_str(),
            summary.as_str(),
            needs.as_deref().unwrap_or(""),
        ],
    );
    let detail_count = usize::from(needs.is_some());
    let manager = match state.agent_manager.as_ref() {
        Some(manager) => manager,
        None => {
            audit(
                state,
                actor,
                "report_blocker",
                &session_digest,
                &input_digest,
                None,
                Some(detail_count),
                "rejected",
                Some("agent_runtime_unavailable"),
                Some(false),
                None,
            );
            return Err(ApiError::Internal(
                "agent runtime is not attached to this process".to_string(),
            ));
        }
    };
    let mutation_applied =
        match manager.set_live_activity(&session_id, "blocked".to_string(), None, None) {
            Ok(applied) => applied,
            Err(error) => {
                audit(
                    state,
                    actor,
                    "report_blocker",
                    &session_digest,
                    &input_digest,
                    None,
                    Some(detail_count),
                    "rejected",
                    Some("agent_blocker_mutation_failed"),
                    Some(false),
                    None,
                );
                return Err(ApiError::Internal(error));
            }
        };
    if !mutation_applied {
        audit(
            state,
            actor,
            "report_blocker",
            &session_digest,
            &input_digest,
            Some("missing"),
            Some(detail_count),
            "rejected",
            Some("agent_session_not_live"),
            Some(false),
            None,
        );
        return Err(ApiError::NotFound(format!(
            "no live agent session '{session_id}' to report blocker"
        )));
    }
    let event_published = if let Some(bus) = state.event_bus.as_ref() {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::BlockerRaised,
            serde_json::json!({
                "sessionId": session_id,
                "summary": summary,
                "needs": needs,
            }),
        )) {
            audit(
                state,
                actor,
                "report_blocker",
                &session_digest,
                &input_digest,
                Some("raised"),
                Some(detail_count),
                "rejected",
                Some("agent_coordination_event_publication_failed"),
                Some(true),
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit(
        state,
        actor,
        "report_blocker",
        &session_digest,
        &input_digest,
        Some("raised"),
        Some(detail_count),
        "accepted",
        None,
        Some(true),
        event_published,
    );
    Ok(serde_json::json!({
        "sessionId": session_id,
        "raised": true,
    }))
}

pub(super) fn steer_avoid(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let session_id = arg_string(args, "sessionId")?;
    let files = arg_optional_string_array(args, "files")?.unwrap_or_default();
    let file_refs = files.iter().map(String::as_str).collect::<Vec<_>>();
    let mut input_values = vec![session_id.as_str()];
    input_values.extend(file_refs.iter().copied());
    let session_digest = session_digest(&session_id);
    let input_digest = input_digest("steer_avoid", &input_values);
    let manager = match state.agent_manager.as_ref() {
        Some(manager) => manager,
        None => {
            audit(
                state,
                actor,
                "steer_avoid",
                &session_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("agent_runtime_unavailable"),
                None,
                None,
            );
            return Err(ApiError::Internal(
                "agent runtime is not attached to this process".to_string(),
            ));
        }
    };
    let target = match manager.live_session(&session_id) {
        Some(target) => target,
        None => {
            audit(
                state,
                actor,
                "steer_avoid",
                &session_digest,
                &input_digest,
                Some("missing"),
                None,
                "rejected",
                Some("agent_session_not_live"),
                None,
                None,
            );
            return Err(ApiError::NotFound(format!(
                "no live agent session '{session_id}' to steer"
            )));
        }
    };
    let ownership = match state.symbol_ownership.as_ref() {
        Some(ownership) => ownership,
        None => {
            audit(
                state,
                actor,
                "steer_avoid",
                &session_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("symbol_ownership_unavailable"),
                None,
                None,
            );
            return Err(ApiError::Internal(
                "symbol ownership is not attached to this process".to_string(),
            ));
        }
    };
    let now = now_secs();
    let claims: Vec<crate::symbol_ownership::SymbolClaim> = {
        let mut owner = match ownership.lock() {
            Ok(owner) => owner,
            Err(_) => {
                audit(
                    state,
                    actor,
                    "steer_avoid",
                    &session_digest,
                    &input_digest,
                    None,
                    None,
                    "rejected",
                    Some("symbol_ownership_lock_failed"),
                    None,
                    None,
                );
                return Err(ApiError::Internal(
                    "symbol ownership lock poisoned".to_string(),
                ));
            }
        };
        owner.expire(now);
        owner.live_claims(now).into_iter().cloned().collect()
    };
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
        .map(|entry| {
            let confidence = match entry.confidence {
                crate::symbol_ownership::Confidence::Lsp => "lsp",
                crate::symbol_ownership::Confidence::Parser => "parser",
                crate::symbol_ownership::Confidence::DiffHunk => "diff-hunk",
            };
            serde_json::json!({
                "agent": entry.agent_id,
                "symbol": entry.symbol,
                "path": entry.path,
                "startLine": entry.range.start_line,
                "endLine": entry.range.end_line,
                "confidence": confidence,
            })
        })
        .collect();
    let directive = crate::symbol_ownership::agent_context::render_ownership_header(&ctx);
    let event_published = if let Some(bus) = state.event_bus.as_ref() {
        if let Err(error) = bus.publish(crate::event_bus::AgentEvent::new(
            crate::event_bus::AgentEventKind::SteerAvoid,
            serde_json::json!({
                "sessionId": session_id,
                "directive": directive,
                "avoid": avoid,
            }),
        )) {
            audit(
                state,
                actor,
                "steer_avoid",
                &session_digest,
                &input_digest,
                Some("steered"),
                Some(avoid.len()),
                "rejected",
                Some("agent_coordination_event_publication_failed"),
                None,
                Some(false),
            );
            return Err(ApiError::Internal(error.to_string()));
        }
        Some(true)
    } else {
        None
    };
    audit(
        state,
        actor,
        "steer_avoid",
        &session_digest,
        &input_digest,
        Some("steered"),
        Some(avoid.len()),
        "accepted",
        None,
        None,
        event_published,
    );
    Ok(serde_json::json!({
        "sessionId": session_id,
        "steered": true,
        "avoidCount": avoid.len(),
        "directive": directive,
        "avoid": avoid,
    }))
}
