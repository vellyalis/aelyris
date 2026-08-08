use std::collections::{BTreeMap, HashMap};

use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath"];
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission continuity Principal is unavailable".to_string(),
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
            "aelyris.mission.current does not accept `{bad}`; Mission, plan, task, status, branch, model, packet, and query-shaping identity are backend-owned"
        )));
    }
    Ok(())
}

fn bounded_repository_path(repo_path: &str) -> ApiResult<()> {
    if repo_path.chars().count() > MAX_REPOSITORY_PATH_CHARS {
        Err(ApiError::BadRequest(format!(
            "MCP argument `repoPath` exceeds the {MAX_REPOSITORY_PATH_CHARS}-character bound"
        )))
    } else {
        Ok(())
    }
}

fn map_current_error(error: crate::task::MissionPlanError) -> ApiError {
    match error {
        crate::task::MissionPlanError::DurabilityUnavailable => {
            ApiError::ServiceUnavailable("Mission continuity durability is unavailable".to_string())
        }
        crate::task::MissionPlanError::Validation(message) => ApiError::BadRequest(message),
        crate::task::MissionPlanError::ContentConflict(message)
        | crate::task::MissionPlanError::IllegalTransition {
            from: message,
            to: _,
        } => ApiError::Conflict(message),
        crate::task::MissionPlanError::NotFound { .. } => ApiError::Internal(
            "current Mission owner returned an unexpected plan lookup miss".to_string(),
        ),
        crate::task::MissionPlanError::Persistence(message) => ApiError::Internal(message),
    }
}

fn not_found_projection() -> serde_json::Value {
    serde_json::json!({
        "outcome": "not_found",
        "found": false,
        "notFound": {
            "code": "accepted_cockpit_mission_not_found",
            "syntheticMissionCreated": false,
        },
        "continuity": {
            "source": "sqlite-backed-task-manager",
            "readOnly": true,
            "restartSafe": true,
            "principalScoped": true,
            "volatileEventCacheUsed": false,
            "secondPlannerInvoked": false,
            "secondMissionCacheUsed": false,
        },
        "exposure": {
            "repositoryPathExposed": false,
            "rawGoalExposed": false,
            "plannerPromptExposed": false,
            "plannerResponseExposed": false,
            "taskDescriptionsExposed": false,
            "dependencyValuesExposed": false,
            "outputPathsExposed": false,
            "branchNamesExposed": false,
            "modelAssignmentsExposed": false,
            "symbolValuesExposed": false,
            "packetContentsExposed": false,
        }
    })
}

fn found_projection(
    mission: crate::task::MissionPlanPreview,
    task_snapshot: Vec<crate::task::Task>,
) -> ApiResult<serde_json::Value> {
    if mission.status != crate::task::MissionPlanStatus::Accepted {
        return Err(ApiError::Conflict(
            "current cockpit Mission projection is not accepted".to_string(),
        ));
    }
    let planned = mission.cockpit_task_plan.as_ref().ok_or_else(|| {
        ApiError::Conflict("current cockpit Mission has no immutable TaskGraph binding".to_string())
    })?;
    let tasks_by_id = task_snapshot
        .into_iter()
        .map(|task| (task.id.clone(), task))
        .collect::<HashMap<_, _>>();
    if tasks_by_id.len() != planned.len() {
        return Err(ApiError::Conflict(
            "current TaskGraph contains tasks outside the accepted cockpit Mission".to_string(),
        ));
    }
    let mut tasks = Vec::with_capacity(planned.len());
    let mut status_counts = BTreeMap::<String, usize>::new();
    for identity in planned {
        let task = tasks_by_id.get(&identity.id).ok_or_else(|| {
            ApiError::Conflict(format!(
                "current Mission task `{}` is missing from the TaskGraph snapshot",
                identity.id
            ))
        })?;
        let status = task.status.as_str().to_string();
        *status_counts.entry(status.clone()).or_default() += 1;
        tasks.push(serde_json::json!({
            "id": task.id,
            "status": status,
        }));
    }

    Ok(serde_json::json!({
        "outcome": "found",
        "found": true,
        "mission": {
            "missionId": mission.mission_definition.mission_id,
            "missionRevision": mission.mission_definition.revision,
            "planId": mission.plan_id,
            "planRevision": mission.plan_revision,
            "status": mission.status.as_str(),
        },
        "taskGraph": {
            "taskCount": tasks.len(),
            "statusCounts": status_counts,
            "tasks": tasks,
            "exactTaskIdentityReturned": true,
            "valueMinimized": true,
        },
        "continuity": {
            "source": "sqlite-backed-task-manager",
            "readOnly": true,
            "restartSafe": true,
            "principalScoped": true,
            "volatileEventCacheUsed": false,
            "secondPlannerInvoked": false,
            "secondMissionCacheUsed": false,
            "syntheticMissionCreated": false,
        },
        "exposure": {
            "repositoryPathExposed": false,
            "rawGoalExposed": false,
            "plannerPromptExposed": false,
            "plannerResponseExposed": false,
            "taskDescriptionsExposed": false,
            "dependencyValuesExposed": false,
            "outputPathsExposed": false,
            "branchNamesExposed": false,
            "modelAssignmentsExposed": false,
            "symbolValuesExposed": false,
            "packetContentsExposed": false,
        }
    }))
}

pub(super) fn read_current(state: &ApiState, repo_path: &str) -> ApiResult<serde_json::Value> {
    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("task graph is not attached to this MCP process".to_string())
    })?;
    let mission = tasks
        .current_cockpit_mission(repo_path)
        .map_err(map_current_error)?;
    let Some(mission) = mission else {
        return Ok(not_found_projection());
    };
    found_projection(mission, tasks.list())
}

pub(super) fn execute(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    authenticated_actor(actor)?;
    validate_arguments(args)?;
    let repo_path = arg_string(args, "repoPath")?;
    bounded_repository_path(&repo_path)?;
    read_current(state, &repo_path)
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
        std::fs::write(temp.path().join("README.md"), "continuity fixture\n")
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
            "init continuity fixture",
            &tree,
            &[],
        )
        .expect("initial commit");
        drop(tree);
        drop(repo);
        temp
    }

    fn task(id: &str, outputs: &[&str], dependencies: &[&str]) -> crate::task::Task {
        let mut task = crate::task::Task::new(id, format!("secret description for {id}"));
        task.owner = Some("secret-owner".to_string());
        task.model = Some("secret-model".to_string());
        task.outputs = outputs.iter().map(|value| value.to_string()).collect();
        task.dependencies = dependencies.iter().map(|value| value.to_string()).collect();
        task.source_branch = Some(format!("secret/{id}"));
        task.target_branch = Some("main".to_string());
        task
    }

    #[test]
    fn caller_cannot_shape_current_mission_query() {
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
            let mut args = serde_json::Map::new();
            args.insert("repoPath".to_string(), serde_json::json!("C:/repo"));
            args.insert(forbidden.to_string(), serde_json::json!("caller-value"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn no_mission_is_structured_not_found_without_synthetic_identity() {
        let repo = init_repo();
        let db = Arc::new(crate::db::ManagedDb::new(
            crate::db::Database::open_memory().expect("memory db"),
        ));
        let manager = Arc::new(crate::task::TaskManager::new());
        assert_eq!(manager.attach_db(db).expect("attach db"), 0);
        let state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        )
        .with_task_manager(manager);
        let value = read_current(&state, &repo.path().to_string_lossy()).expect("not found");
        assert_eq!(value["outcome"], "not_found");
        assert_eq!(value["found"], false);
        assert_eq!(value["notFound"]["syntheticMissionCreated"], false);
        assert!(value.get("mission").is_none());
    }

    #[test]
    fn restart_restores_exact_value_minimized_projection_without_replanning() {
        let repo = init_repo();
        let repo_path = repo.path().to_string_lossy().to_string();
        let db = Arc::new(crate::db::ManagedDb::new(
            crate::db::Database::open_memory().expect("memory db"),
        ));
        let first_manager = Arc::new(crate::task::TaskManager::new());
        assert_eq!(first_manager.attach_db(db.clone()).expect("attach db"), 0);
        let tasks = vec![
            task("first-task", &["secret/first.rs"], &[]),
            task("second-task", &["secret/second.rs"], &["first-task"]),
        ];
        first_manager
            .submit_cockpit_plan(
                "RAW SECRET GOAL MUST NOT BE EXPOSED",
                tasks,
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .expect("submit cockpit plan");
        let first_state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        )
        .with_task_manager(first_manager);
        let first = read_current(&first_state, &repo_path).expect("first projection");

        let restarted_manager = Arc::new(crate::task::TaskManager::new());
        assert_eq!(
            restarted_manager.attach_db(db).expect("restore task graph"),
            2
        );
        let restarted_state = ApiState::new(
            crate::pty::PtyManager::new(),
            crate::api::AuthConfig::with_token("test-token"),
        )
        .with_task_manager(restarted_manager);
        let restarted = read_current(&restarted_state, &repo_path).expect("restart projection");
        assert_eq!(first, restarted);
        assert_eq!(restarted["outcome"], "found");
        assert_eq!(restarted["mission"]["status"], "accepted");
        assert_eq!(restarted["taskGraph"]["taskCount"], 2);
        assert_eq!(restarted["taskGraph"]["statusCounts"]["ready"], 1);
        assert_eq!(restarted["taskGraph"]["statusCounts"]["pending"], 1);
        assert_eq!(restarted["continuity"]["secondPlannerInvoked"], false);
        assert_eq!(restarted["continuity"]["volatileEventCacheUsed"], false);

        let text = serde_json::to_string(&restarted).expect("serialize projection");
        for hidden in [
            "RAW SECRET GOAL MUST NOT BE EXPOSED",
            repo_path.as_str(),
            "secret description",
            "secret/first.rs",
            "secret/second.rs",
            "secret/first-task",
            "secret/second-task",
            "secret-owner",
            "secret-model",
        ] {
            assert!(!text.contains(hidden), "projection exposed {hidden}");
        }
    }
}
