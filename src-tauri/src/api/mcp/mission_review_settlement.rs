use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath", "taskId"];

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission settlement Principal is unavailable".to_string(),
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
            "aelyris.mission.review_and_settle does not accept `{bad}`; review, OID, merge, and packet authority are backend-owned"
        )));
    }
    Ok(())
}

fn digest(label: &str, value: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("{label}\n{value}"))
        .as_str()
        .to_string()
}

fn repository_digest(repo_path: &str) -> String {
    digest("aelyris.mission-settlement-repository", repo_path)
}

fn task_digest(task_id: &str) -> String {
    digest("aelyris.mission-settlement-task", task_id)
}

fn input_digest(repo_path: &str, task_id: &str) -> String {
    digest(
        "aelyris.mission-review-and-settle-input",
        &format!("{repo_path}\n{task_id}"),
    )
}

fn map_scope_error(error: crate::task::MissionPlanError) -> ApiError {
    match error {
        crate::task::MissionPlanError::DurabilityUnavailable => ApiError::ServiceUnavailable(
            "current Mission settlement durability is unavailable".to_string(),
        ),
        crate::task::MissionPlanError::Validation(message) => ApiError::BadRequest(message),
        crate::task::MissionPlanError::ContentConflict(message)
        | crate::task::MissionPlanError::IllegalTransition {
            from: message,
            to: _,
        } => ApiError::Conflict(message),
        crate::task::MissionPlanError::NotFound { .. } => ApiError::Conflict(
            "current Mission activation lookup returned an unexpected miss".to_string(),
        ),
        crate::task::MissionPlanError::Persistence(message) => ApiError::Internal(message),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CurrentMissionReviewScope {
    mission_id: String,
    mission_revision: u64,
    plan_id: String,
    plan_revision: u64,
    task_id: String,
    activation_id: String,
}

fn preflight_current_mission_review(
    state: &ApiState,
    repo_path: &str,
    task_id: &str,
) -> ApiResult<CurrentMissionReviewScope> {
    let snapshot = super::mission_continuity::load_current(state, repo_path)?
        .ok_or_else(|| ApiError::BadRequest("current_mission_not_found".to_string()))?;
    let task_identity = snapshot
        .mission
        .cockpit_task_plan
        .as_ref()
        .and_then(|plan| plan.iter().find(|task| task.id == task_id))
        .ok_or_else(|| ApiError::BadRequest("current_mission_task_not_found".to_string()))?;
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| ApiError::Conflict("current_mission_taskgraph_mismatch".to_string()))?;
    if task.status != crate::task::TaskStatus::Review {
        return Err(ApiError::BadRequest(
            "current_mission_task_not_in_review".to_string(),
        ));
    }

    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("task graph is not attached to this MCP process".to_string())
    })?;
    let activation = tasks
        .mission_activation_for_task(task_id)
        .map_err(map_scope_error)?
        .ok_or_else(|| ApiError::Conflict("current_mission_activation_missing".to_string()))?;
    let work_unit_id = task_identity
        .work_unit_id
        .as_deref()
        .ok_or_else(|| ApiError::Conflict("current_mission_task_work_unit_missing".to_string()))?;
    if activation.plan_id != snapshot.mission.plan_id
        || activation.plan_revision != snapshot.mission.plan_revision
        || activation.mission_id != snapshot.mission.mission_definition.mission_id
        || activation.mission_revision != snapshot.mission.mission_definition.revision
        || activation.task_id != task_id
        || activation.work_unit_id != work_unit_id
        || activation.plan_content_digest != snapshot.mission.content_digest
        || activation.accepted_base_oid != snapshot.mission.accepted_mission_head_oid
        || activation.repository_root != snapshot.mission.repository_root
        || task_identity.source_branch.as_deref() != Some(activation.source_branch.as_str())
        || task_identity.target_branch.as_deref() != Some(activation.target_branch.as_str())
        || activation.owned_targets != task_identity.outputs
    {
        return Err(ApiError::Conflict(
            "current_mission_activation_lineage_mismatch".to_string(),
        ));
    }

    Ok(CurrentMissionReviewScope {
        mission_id: activation.mission_id,
        mission_revision: activation.mission_revision,
        plan_id: activation.plan_id,
        plan_revision: activation.plan_revision,
        task_id: activation.task_id,
        activation_id: activation.activation_id,
    })
}

fn settlement_outcome(
    merged: bool,
    settled: bool,
    work_packet_present: bool,
    mission_packet_present: bool,
) -> ApiResult<&'static str> {
    if settled {
        if !merged || !work_packet_present {
            return Err(ApiError::Internal(
                "current Mission task settlement completed without an immutable WorkPacket"
                    .to_string(),
            ));
        }
        return Ok("settled");
    }
    if merged || work_packet_present || mission_packet_present {
        return Err(ApiError::Internal(
            "current Mission merge completed without immutable settlement".to_string(),
        ));
    }
    Ok("review_rejected")
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("current_mission_not_found") {
        "current_mission_not_found"
    } else if error.contains("current_mission_task_not_found") {
        "current_mission_task_not_found"
    } else if error.contains("current_mission_task_not_in_review") {
        "current_mission_task_not_in_review"
    } else if error.contains("current_mission_taskgraph_mismatch")
        || error.contains("current_mission_activation")
        || error.contains("current_mission_task_work_unit_missing")
    {
        "current_mission_lineage_mismatch"
    } else if error.contains("startup_reconciliation_pending") {
        "startup_reconciliation_pending"
    } else if error.contains("startup_reconciliation_failed") {
        "startup_reconciliation_failed"
    } else if error.contains("not attached") || error.contains("unavailable") {
        "runtime_owner_unavailable"
    } else if error.contains("unknown task") || error.contains("no activation") {
        "task_not_found_or_unbound"
    } else if error.contains("not in review")
        || error.contains("review candidate")
        || error.contains("no exact gate evidence")
    {
        "task_not_review_ready"
    } else if error.contains("reviewer") {
        "independent_review_failed"
    } else if error.contains("merge") {
        "exact_oid_merge_failed"
    } else if error.contains("settlement") || error.contains("packet") {
        "mission_settlement_failed"
    } else {
        "mission_review_and_settle_failed"
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    task_digest: &str,
    input_digest: &str,
    status: &str,
    rejection_code: Option<&str>,
    outcome: Option<&str>,
    review_accepted: Option<bool>,
    merged: Option<bool>,
    settled: Option<bool>,
    work_packet_present: Option<bool>,
    mission_packet_present: Option<bool>,
    current_mission_preflight_passed: bool,
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
        kind: "mcp_mission_review_settlement_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-review-settlement".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "review_and_settle",
            "repositoryDigest": repository_digest,
            "taskDigest": task_digest,
            "inputDigest": input_digest,
            "status": status,
            "rejectionCode": rejection_code,
            "outcome": outcome,
            "reviewAccepted": review_accepted,
            "merged": merged,
            "settled": settled,
            "workPacketPresent": work_packet_present,
            "missionCompletionPacketPresent": mission_packet_present,
            "currentMissionPreflightPassed": current_mission_preflight_passed,
            "callerSuppliedVerdict": false,
            "callerSuppliedCandidateOid": false,
            "callerSuppliedReviewerIdentity": false,
            "callerSuppliedMergeAuthority": false,
            "callerSuppliedPacket": false,
            "reviewValuesLogged": false,
            "repositoryPathLogged": false,
            "taskIdentityLogged": false,
            "oidValuesLogged": false,
            "packetIdentitiesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, task_digest, error = %error, "Mission review settlement audit failed");
    }
}

#[cfg(not(test))]
async fn execute_attached(
    state: &ApiState,
    repo_path: String,
    task_id: String,
    expected_scope: &CurrentMissionReviewScope,
) -> ApiResult<serde_json::Value> {
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    let app = state.app_handle.clone().ok_or_else(|| {
        ApiError::Internal(
            "Mission review and settlement runtime is not attached to this MCP process".to_string(),
        )
    })?;
    let tasks = app
        .try_state::<Arc<crate::task::TaskManager>>()
        .ok_or_else(|| ApiError::Internal("task graph is not attached".to_string()))?;
    let state_tasks = state.task_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("task graph is not attached to this MCP process".to_string())
    })?;
    if !Arc::ptr_eq(state_tasks, tasks.inner()) {
        return Err(ApiError::Internal(
            "current Mission settlement task owner differs across MCP and cockpit".to_string(),
        ));
    }
    let effect_scope = preflight_current_mission_review(state, &repo_path, &task_id)?;
    if &effect_scope != expected_scope {
        return Err(ApiError::Conflict(
            "current Mission settlement scope changed before review effect".to_string(),
        ));
    }
    let startup = app
        .try_state::<Arc<crate::startup_reconciliation::StartupReconciliationState>>()
        .ok_or_else(|| {
            ApiError::Internal("startup reconciliation barrier is not attached".to_string())
        })?;
    let cost = app
        .try_state::<Arc<crate::cost::CostManager>>()
        .ok_or_else(|| ApiError::Internal("cost manager is not attached".to_string()))?;
    let fleet = app
        .try_state::<crate::control::pane_fleet::PaneFleet>()
        .ok_or_else(|| ApiError::Internal("visible pane fleet is not attached".to_string()))?;
    let bus = app
        .try_state::<Arc<crate::event_bus::EventBus>>()
        .ok_or_else(|| ApiError::Internal("event bus is not attached".to_string()))?;
    let ownership = app
        .try_state::<Arc<Mutex<crate::file_ownership::FileOwnership>>>()
        .ok_or_else(|| ApiError::Internal("file ownership is not attached".to_string()))?;
    let symbol_ownership = app
        .try_state::<Arc<Mutex<crate::symbol_ownership::SymbolOwnership>>>()
        .ok_or_else(|| ApiError::Internal("symbol ownership is not attached".to_string()))?;
    let context = app
        .try_state::<Arc<crate::context_store::ContextStoreManager>>()
        .ok_or_else(|| ApiError::Internal("context store is not attached".to_string()))?;
    let merge_store = app
        .try_state::<Option<Arc<crate::merge_intent::store::MergeIntentStore>>>()
        .ok_or_else(|| ApiError::Internal("merge persistence is not attached".to_string()))?;

    let report = crate::ipc::orchestrator_review_and_merge(
        app.clone(),
        tasks,
        startup,
        cost,
        fleet,
        bus,
        ownership,
        symbol_ownership,
        context,
        merge_store,
        repo_path,
        task_id.clone(),
    )
    .await
    .map_err(|error| {
        if error.contains("unknown task")
            || error.contains("not in review")
            || error.contains("repository identity changed")
        {
            ApiError::BadRequest(error)
        } else {
            ApiError::Internal(error)
        }
    })?;

    let outcome = settlement_outcome(
        report.merged,
        report.settled,
        report.work_packet_id.is_some(),
        report.mission_completion_packet_id.is_some(),
    )?;
    Ok(serde_json::json!({
        "taskId": task_id,
        "outcome": outcome,
        "review": {
            "accepted": report.review.merge_ok,
            "reasons": report.review.reasons,
            "candidateSourceOid": report.review.candidate_source_oid,
            "reviewerModel": report.review.reviewer_model,
            "backendOwned": true,
            "callerSuppliedVerdict": false,
            "callerSuppliedCandidateOid": false,
            "callerSuppliedReviewerIdentity": false,
        },
        "merged": report.merged,
        "settled": report.settled,
        "workPacketId": report.work_packet_id,
        "missionCompletionPacketId": report.mission_completion_packet_id,
        "callerSuppliedMergeAuthority": false,
        "callerSuppliedPacket": false,
    }))
}

#[cfg(test)]
async fn execute_attached(
    _state: &ApiState,
    _repo_path: String,
    _task_id: String,
    _expected_scope: &CurrentMissionReviewScope,
) -> ApiResult<serde_json::Value> {
    Err(ApiError::Internal(
        "Mission review and settlement runtime is not attached to this MCP process".to_string(),
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
    let task_id = arg_string(args, "taskId")?;
    let repository_digest = repository_digest(&repo_path);
    let task_digest = task_digest(&task_id);
    let input_digest = input_digest(&repo_path, &task_id);
    let scope = match preflight_current_mission_review(state, &repo_path, &task_id) {
        Ok(scope) => scope,
        Err(error) => {
            let message = error.to_string();
            audit(
                state,
                actor,
                &repository_digest,
                &task_digest,
                &input_digest,
                "rejected",
                Some(rejection_code(&message)),
                None,
                None,
                None,
                None,
                None,
                None,
                false,
            );
            return Err(error);
        }
    };

    match execute_attached(state, repo_path, task_id, &scope).await {
        Ok(value) => {
            let review_accepted = value
                .pointer("/review/accepted")
                .and_then(serde_json::Value::as_bool);
            let merged = value.get("merged").and_then(serde_json::Value::as_bool);
            let settled = value.get("settled").and_then(serde_json::Value::as_bool);
            let outcome = value.get("outcome").and_then(serde_json::Value::as_str);
            audit(
                state,
                actor,
                &repository_digest,
                &task_digest,
                &input_digest,
                "accepted",
                None,
                outcome,
                review_accepted,
                merged,
                settled,
                Some(
                    value
                        .get("workPacketId")
                        .is_some_and(|value| !value.is_null()),
                ),
                Some(
                    value
                        .get("missionCompletionPacketId")
                        .is_some_and(|value| !value.is_null()),
                ),
                true,
            );
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            audit(
                state,
                actor,
                &repository_digest,
                &task_digest,
                &input_digest,
                "rejected",
                Some(rejection_code(&message)),
                None,
                None,
                None,
                None,
                None,
                None,
                true,
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::Arc;

    fn init_repo() -> tempfile::TempDir {
        let temp = tempfile::tempdir().expect("temp repo");
        let mut options = git2::RepositoryInitOptions::new();
        options.initial_head("main");
        let repo = git2::Repository::init_opts(temp.path(), &options).expect("init repo");
        std::fs::write(temp.path().join("README.md"), "settlement scope fixture\n")
            .expect("write fixture");
        let mut index = repo.index().expect("index");
        index.add_path(Path::new("README.md")).expect("index file");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("tree id");
        let tree = repo.find_tree(tree_id).expect("tree");
        let signature =
            git2::Signature::now("Aelyris", "aelyris@example.invalid").expect("signature");
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "init settlement scope fixture",
            &tree,
            &[],
        )
        .expect("initial commit");
        drop(tree);
        drop(repo);
        temp
    }

    fn task(id: &str) -> crate::task::Task {
        let mut task = crate::task::Task::new(id, format!("Task {id}"));
        task.owner = Some("implementer".to_string());
        task.model = Some("codex".to_string());
        task.outputs = vec![format!("tests/{id}.rs")];
        task.source_branch = Some(format!("feat/{id}"));
        task.target_branch = Some("main".to_string());
        task
    }

    fn state_with_manager() -> (
        Arc<crate::db::ManagedDb>,
        Arc<crate::task::TaskManager>,
        ApiState,
    ) {
        let db = Arc::new(crate::db::ManagedDb::new(
            crate::db::Database::open_memory().expect("memory db"),
        ));
        let manager = Arc::new(crate::task::TaskManager::new());
        assert_eq!(manager.attach_db(db.clone()).expect("attach db"), 0);
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        )
        .with_db(Some(db.clone()))
        .with_task_manager(manager.clone());
        (db, manager, state)
    }

    #[test]
    fn caller_cannot_shape_review_merge_or_packet_authority() {
        for forbidden in [
            "verdict",
            "reviewerId",
            "candidateSourceOid",
            "candidateTargetOid",
            "gatesDigest",
            "mergeToken",
            "workPacket",
            "missionCompletionPacket",
        ] {
            let mut args = serde_json::Map::new();
            args.insert("repoPath".to_string(), serde_json::json!("C:/repo"));
            args.insert("taskId".to_string(), serde_json::json!("task-1"));
            args.insert(forbidden.to_string(), serde_json::json!("caller-value"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn authority_digests_are_domain_separated() {
        let repository = repository_digest("C:/secret/repo");
        let task = task_digest("secret-task");
        let input = input_digest("C:/secret/repo", "secret-task");
        assert_eq!(repository.len(), 64);
        assert_eq!(task.len(), 64);
        assert_eq!(input.len(), 64);
        assert_ne!(repository, task);
        assert_ne!(repository, input);
        assert_ne!(task, input);
    }

    #[test]
    fn generic_review_task_is_rejected_before_attached_reviewer_runtime() {
        use crate::db::AuditJournalFilter;

        let repo = init_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let (db, manager, state) = state_with_manager();
        manager.create(task("generic-review")).expect("create task");
        manager
            .transition("generic-review", crate::task::TaskStatus::Running)
            .expect("start task");
        manager
            .transition("generic-review", crate::task::TaskStatus::Review)
            .expect("review task");

        let rt = tokio::runtime::Runtime::new().expect("runtime");
        assert!(matches!(
            rt.block_on(execute(
                &state,
                "settlement-operator",
                &serde_json::json!({
                    "repoPath": repo_path,
                    "taskId": "generic-review",
                })
                .as_object()
                .unwrap()
                .clone(),
            )),
            Err(ApiError::BadRequest(message)) if message == "current_mission_not_found"
        ));

        let rows = db
            .with(|database| {
                database.list_audit_journal_events(&AuditJournalFilter {
                    kind: Some("mcp_mission_review_settlement_authority".to_string()),
                    limit: Some(10),
                    ..Default::default()
                })
            })
            .expect("read audit");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].redacted_payload_json["rejectionCode"],
            "current_mission_not_found"
        );
        assert_eq!(
            rows[0].redacted_payload_json["currentMissionPreflightPassed"],
            false
        );
        assert!(rows[0].redacted_payload_json["reviewAccepted"].is_null());
        assert!(rows[0].redacted_payload_json["merged"].is_null());
        assert!(rows[0].redacted_payload_json["settled"].is_null());
    }

    #[test]
    fn current_mission_requires_exact_member_in_review_with_matching_activation() {
        let repo = init_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let (_db, manager, state) = state_with_manager();
        let task_id = "current-review";
        let (_, mission) = manager
            .submit_cockpit_plan(
                "Build the exact current review task",
                vec![task(task_id)],
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .expect("submit Mission");

        assert!(matches!(
            preflight_current_mission_review(&state, &repo_path, task_id),
            Err(ApiError::BadRequest(message)) if message == "current_mission_task_not_in_review"
        ));
        manager
            .transition(task_id, crate::task::TaskStatus::Running)
            .expect("start task");
        manager
            .transition(task_id, crate::task::TaskStatus::Review)
            .expect("review task");
        let scope = preflight_current_mission_review(&state, &repo_path, task_id)
            .expect("exact current Mission review scope");
        assert_eq!(scope.mission_id, mission.mission_definition.mission_id);
        assert_eq!(scope.mission_revision, mission.mission_definition.revision);
        assert_eq!(scope.plan_id, mission.plan_id);
        assert_eq!(scope.plan_revision, mission.plan_revision);
        assert_eq!(scope.task_id, task_id);
        assert!(!scope.activation_id.is_empty());
    }

    #[test]
    fn mixed_taskgraph_is_rejected_before_current_mission_review() {
        let repo = init_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let (_db, manager, state) = state_with_manager();
        manager
            .submit_cockpit_plan(
                "Build one scoped task",
                vec![task("mission-task")],
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .expect("submit Mission");
        manager
            .create(task("unrelated-generic-task"))
            .expect("add unrelated task");
        assert!(matches!(
            preflight_current_mission_review(&state, &repo_path, "mission-task"),
            Err(ApiError::Conflict(message))
                if message.contains("outside the accepted cockpit Mission")
        ));
    }

    #[test]
    fn merged_without_immutable_mission_packets_is_never_success() {
        assert_eq!(
            settlement_outcome(true, true, true, true).expect("settled outcome"),
            "settled"
        );
        assert_eq!(
            settlement_outcome(true, true, true, false)
                .expect("intermediate task settlement outcome"),
            "settled"
        );
        assert_eq!(
            settlement_outcome(false, false, false, false).expect("review rejection"),
            "review_rejected"
        );
        for invalid in [
            (true, false, false, false),
            (true, true, false, true),
            (false, true, true, true),
        ] {
            assert!(matches!(
                settlement_outcome(invalid.0, invalid.1, invalid.2, invalid.3),
                Err(ApiError::Internal(_))
            ));
        }
    }
}
