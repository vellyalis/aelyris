use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_optional_string, arg_string};

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath", "goal", "context"];
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;
const MAX_GOAL_CHARS: usize = 16_384;
const MAX_CONTEXT_CHARS: usize = 32_768;

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission planning Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn validate_arguments(args: &serde_json::Map<String, serde_json::Value>) -> ApiResult<()> {
    if let Some(bad) = args
        .keys()
        .find(|key| !ALLOWED_ARGUMENTS.contains(&key.as_str()))
    {
        return Err(ApiError::BadRequest(format!(
            "aelyris.mission.plan does not accept `{bad}`; planner, Mission, TaskGraph, branch, model, command, status, and packet authority are backend-owned"
        )));
    }
    Ok(())
}

fn bounded(value: &str, key: &str, max_chars: usize) -> ApiResult<()> {
    if value.chars().count() > max_chars {
        Err(ApiError::BadRequest(format!(
            "MCP argument `{key}` exceeds the {max_chars}-character bound"
        )))
    } else {
        Ok(())
    }
}

fn digest(label: &str, value: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("{label}\n{value}"))
        .as_str()
        .to_string()
}

fn repository_digest(repo_path: &str) -> String {
    digest("aelyris.mission-plan-repository", repo_path)
}

fn goal_digest(goal: &str) -> String {
    digest("aelyris.mission-plan-goal", goal)
}

fn context_digest(context: Option<&str>) -> Option<String> {
    context.map(|value| digest("aelyris.mission-plan-context", value))
}

fn input_digest(repo_path: &str, goal: &str, context: Option<&str>) -> String {
    digest(
        "aelyris.mission-plan-input",
        &format!("{repo_path}\n{goal}\n{}", context.unwrap_or_default()),
    )
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("startup_reconciliation_pending") {
        "startup_reconciliation_pending"
    } else if error.contains("startup_reconciliation_failed") {
        "startup_reconciliation_failed"
    } else if error.contains("failed to spawn codex planner")
        || error.contains("codex planner exited")
        || error.contains("planner returned empty")
        || error.contains("usage limit")
        || error.contains("quota")
    {
        "planner_provider_unavailable"
    } else if error.contains("invalid repository")
        || error.contains("repository identity")
        || error.contains("not a git repository")
    {
        "repository_invalid"
    } else if error.contains("validation") || error.contains("valid plan") {
        "planner_output_invalid"
    } else if error.contains("already")
        || error.contains("duplicate")
        || error.contains("mutation in progress")
    {
        "mission_plan_conflict"
    } else if error.contains("not attached") || error.contains("unavailable") {
        "runtime_owner_unavailable"
    } else {
        "mission_plan_failed"
    }
}

#[cfg(not(test))]
fn map_plan_error(error: String) -> ApiError {
    match rejection_code(&error) {
        "startup_reconciliation_pending"
        | "startup_reconciliation_failed"
        | "planner_provider_unavailable" => ApiError::ServiceUnavailable(error),
        "repository_invalid" => ApiError::BadRequest(error),
        "planner_output_invalid" | "mission_plan_conflict" => ApiError::Conflict(error),
        _ => ApiError::Internal(error),
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    goal_digest: &str,
    context_digest: Option<&str>,
    input_digest: &str,
    status: &str,
    rejection_code: Option<&str>,
    outcome: Option<&str>,
    mission_accepted: Option<bool>,
    task_count: Option<usize>,
    readied_count: Option<usize>,
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
        correlation_id: Some(input_digest.to_string()),
        kind: "mcp_mission_planning_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-planning".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "plan",
            "repositoryDigest": repository_digest,
            "goalDigest": goal_digest,
            "contextDigest": context_digest,
            "inputDigest": input_digest,
            "status": status,
            "rejectionCode": rejection_code,
            "outcome": outcome,
            "missionAccepted": mission_accepted,
            "taskCount": task_count,
            "readiedCount": readied_count,
            "plannerProfile": "backend-default",
            "callerSuppliedPlannerModel": false,
            "callerSuppliedPlannerCommand": false,
            "callerSuppliedMissionIdentity": false,
            "callerSuppliedPlanIdentity": false,
            "callerSuppliedTaskGraph": false,
            "callerSuppliedBranch": false,
            "callerSuppliedOutput": false,
            "callerSuppliedStatus": false,
            "callerSuppliedPacket": false,
            "goalValueLogged": false,
            "contextValueLogged": false,
            "repositoryPathLogged": false,
            "promptLogged": false,
            "planJsonLogged": false,
            "taskValuesLogged": false,
            "missionIdentityLogged": false,
            "planIdentityLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, input_digest, error = %error, "Mission planning audit failed");
    }
}

#[cfg(not(test))]
async fn execute_attached(
    state: &ApiState,
    repo_path: String,
    goal: String,
    context: Option<String>,
) -> ApiResult<serde_json::Value> {
    use std::sync::Arc;
    use tauri::Manager;

    let app = state.app_handle.clone().ok_or_else(|| {
        ApiError::Internal(
            "Mission planning runtime is not attached to this MCP process".to_string(),
        )
    })?;
    let startup = app
        .try_state::<Arc<crate::startup_reconciliation::StartupReconciliationState>>()
        .ok_or_else(|| {
            ApiError::Internal("startup reconciliation barrier is not attached".to_string())
        })?;
    startup
        .require_effect_admitted("Mission planning")
        .map_err(ApiError::ServiceUnavailable)?;
    let tasks = app
        .try_state::<Arc<crate::task::TaskManager>>()
        .ok_or_else(|| ApiError::Internal("task graph is not attached".to_string()))?;
    let task_manager = tasks.inner().clone();
    let bus = app
        .try_state::<Arc<crate::event_bus::EventBus>>()
        .ok_or_else(|| ApiError::Internal("event bus is not attached".to_string()))?;

    let report = crate::ipc::plan_build(app.clone(), tasks, bus, goal, context, repo_path, None)
        .await
        .map_err(map_plan_error)?;
    let planned = report.mission.cockpit_task_plan.as_ref().ok_or_else(|| {
        ApiError::Internal("accepted Mission has no cockpit TaskGraph binding".to_string())
    })?;
    let mut task_views = Vec::with_capacity(planned.len());
    for identity in planned {
        let task = task_manager.get(&identity.id).ok_or_else(|| {
            ApiError::Internal(format!(
                "accepted Mission task `{}` is missing from TaskGraph",
                identity.id
            ))
        })?;
        task_views.push(serde_json::json!({
            "id": task.id,
            "status": task.status.as_str(),
            "dependencyCount": task.dependencies.len(),
            "outputCount": task.outputs.len(),
            "symbolIntentCount": task.symbols.len(),
            "sourceBranchAssigned": task.source_branch.is_some(),
            "targetBranchAssigned": task.target_branch.is_some(),
        }));
    }

    Ok(serde_json::json!({
        "outcome": "accepted",
        "mission": {
            "missionId": report.mission.mission_definition.mission_id,
            "missionRevision": report.mission.mission_definition.revision,
            "planId": report.mission.plan_id,
            "planRevision": report.mission.plan_revision,
            "status": report.mission.status.as_str(),
            "taskCount": task_views.len(),
        },
        "taskGraph": {
            "tasks": task_views,
            "readiedTaskIds": report.readied,
            "valueMinimized": true,
            "taskDescriptionsExposed": false,
            "outputPathsExposed": false,
            "branchNamesExposed": false,
            "modelAssignmentsExposed": false,
            "symbolValuesExposed": false,
        },
        "planner": {
            "backendOwned": true,
            "profile": "backend-default",
            "callerSuppliedPlannerModel": false,
            "callerSuppliedPlannerCommand": false,
            "callerSuppliedMissionIdentity": false,
            "callerSuppliedPlanIdentity": false,
            "callerSuppliedTaskGraph": false,
            "callerSuppliedBranch": false,
            "callerSuppliedOutput": false,
            "callerSuppliedStatus": false,
            "callerSuppliedPacket": false,
        }
    }))
}

#[cfg(test)]
async fn execute_attached(
    _state: &ApiState,
    _repo_path: String,
    _goal: String,
    _context: Option<String>,
) -> ApiResult<serde_json::Value> {
    Err(ApiError::Internal(
        "Mission planning runtime is not attached to this MCP process".to_string(),
    ))
}

pub(super) async fn execute(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    validate_arguments(args)?;
    let repo_path = arg_string(args, "repoPath")?;
    let goal = arg_string(args, "goal")?;
    let context = arg_optional_string(args, "context");
    bounded(&repo_path, "repoPath", MAX_REPOSITORY_PATH_CHARS)?;
    bounded(&goal, "goal", MAX_GOAL_CHARS)?;
    if let Some(context) = context.as_deref() {
        bounded(context, "context", MAX_CONTEXT_CHARS)?;
    }
    let repository_digest = repository_digest(&repo_path);
    let goal_digest = goal_digest(&goal);
    let context_digest = context_digest(context.as_deref());
    let input_digest = input_digest(&repo_path, &goal, context.as_deref());

    match execute_attached(state, repo_path, goal, context).await {
        Ok(value) => {
            let mission_accepted = value
                .pointer("/mission/status")
                .and_then(serde_json::Value::as_str)
                .map(|status| status == "accepted");
            let task_count = value
                .pointer("/mission/taskCount")
                .and_then(serde_json::Value::as_u64)
                .and_then(|count| usize::try_from(count).ok());
            let readied_count = value
                .pointer("/taskGraph/readiedTaskIds")
                .and_then(serde_json::Value::as_array)
                .map(Vec::len);
            audit(
                state,
                actor,
                &repository_digest,
                &goal_digest,
                context_digest.as_deref(),
                &input_digest,
                "accepted",
                None,
                value.get("outcome").and_then(serde_json::Value::as_str),
                mission_accepted,
                task_count,
                readied_count,
            );
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            audit(
                state,
                actor,
                &repository_digest,
                &goal_digest,
                context_digest.as_deref(),
                &input_digest,
                "rejected",
                Some(rejection_code(&message)),
                None,
                None,
                None,
                None,
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_planner_mission_or_taskgraph_authority() {
        for forbidden in [
            "model",
            "command",
            "missionId",
            "planId",
            "tasks",
            "taskIds",
            "dependencies",
            "sourceBranch",
            "targetBranch",
            "outputs",
            "symbols",
            "status",
            "workPacket",
        ] {
            let mut args = serde_json::Map::new();
            args.insert("repoPath".to_string(), serde_json::json!("C:/repo"));
            args.insert("goal".to_string(), serde_json::json!("Build one thing"));
            args.insert(forbidden.to_string(), serde_json::json!("caller-value"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn input_bounds_fail_closed() {
        assert!(bounded("repo", "repoPath", 4).is_ok());
        assert!(matches!(
            bounded("12345", "repoPath", 4),
            Err(ApiError::BadRequest(message)) if message.contains("repoPath")
        ));
    }

    #[test]
    fn authority_digests_are_domain_separated() {
        let repository = repository_digest("C:/secret/repo");
        let goal = goal_digest("secret goal");
        let context = context_digest(Some("secret context")).expect("context digest");
        let input = input_digest("C:/secret/repo", "secret goal", Some("secret context"));
        for value in [&repository, &goal, &context, &input] {
            assert_eq!(value.len(), 64);
        }
        assert_eq!(
            [repository, goal, context, input]
                .into_iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            4
        );
    }
}
