use std::collections::HashMap;
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use super::graph::{Task, TaskGraph, TaskGraphError};
use super::mission::{
    MissionPlanError, MissionPlanPreview, MissionPlanPreviewInput, MissionPlanStatus,
};
use super::planner::validate_plan;
use super::status::TaskStatus;
use crate::db::ManagedDb;
use crate::persistence::{TaskRepo, WorkExecutionRepo};

use super::execution::{
    ExecutionEffect, ExecutionFenceError, ExecutionFenceState, ExecutionReservation,
    ExecutionToken, WorkExecutionAttempt, WorkExecutionState,
};

/// Thread-safe owner of the Task Graph, managed in Tauri state (mirrors the
/// `AgentManager` / `InteractiveSessionManager` pattern). Mutating operations
/// re-run the dependency gate so callers get the ids that became `Ready` (or
/// `Blocked`) and can broadcast a `task-graph-updated` event.
///
/// In-memory is the hot read cache; SQLite (via [`TaskRepo`]) is the source of
/// truth. The autonomy loop mutates a revisioned clone and applies it through
/// one CAS boundary (status, crash/rework/timeout counters, branch bindings),
/// and every accepted mutation persists the WHOLE staged graph before publishing
/// it to memory — eliminating the "missed write-through site" bug class. A `db` is attached at startup
/// ([`attach_db`]); when absent (tests, non-persistent mode) the manager is
/// purely in-memory, exactly as before. Persist failures are returned and leave
/// the prior in-memory graph intact.
#[derive(Default)]
struct TaskGraphState {
    graph: TaskGraph,
    revision: u64,
    active_autonomy_lease: Option<u64>,
    next_lease: u64,
}

#[derive(Default)]
pub struct TaskManager {
    state: Mutex<TaskGraphState>,
    executions: Mutex<HashMap<String, WorkExecutionAttempt>>,
    db: Mutex<Option<Arc<ManagedDb>>>,
    persistence: Mutex<()>,
    durability_required: bool,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Production constructor: authoritative mutations fail closed until a
    /// durable database is attached. `new()` is the explicit ephemeral mode for
    /// isolated domain tests.
    pub fn new_durable() -> Self {
        Self {
            durability_required: true,
            ..Self::default()
        }
    }

    /// Poison-tolerant lock: a panicked holder must not wedge the whole task
    /// subsystem, so recover the inner graph rather than propagate the poison.
    fn lock(&self) -> std::sync::MutexGuard<'_, TaskGraphState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn require_mutation_available(state: &TaskGraphState) -> Result<(), TaskGraphError> {
        match state.active_autonomy_lease {
            Some(lease) => Err(TaskGraphError::MutationInProgress(lease)),
            None => Ok(()),
        }
    }

    fn publish_mutation(state: &mut TaskGraphState, graph: TaskGraph) {
        state.graph = graph;
        state.revision = state.revision.saturating_add(1);
    }

    fn persistence_lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.persistence
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn execution_lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, WorkExecutionAttempt>> {
        self.executions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn persist_graph(&self, graph: &TaskGraph) -> Result<(), TaskGraphError> {
        match self.db() {
            Some(db) => db
                .with(|database| TaskRepo::save_graph(database, graph))
                .map_err(TaskGraphError::Persistence),
            None if self.durability_required => Err(TaskGraphError::Persistence(
                "Task Graph durability is unavailable".to_string(),
            )),
            None => Ok(()),
        }
    }

    /// Stage one mutation on a clone, commit the complete graph snapshot, then
    /// publish it to the hot cache. Holding the state lock across the database
    /// commit intentionally serializes authoritative writers: a failed commit
    /// can never race with or be hidden by a later in-memory revision.
    fn commit_mutation<R>(
        &self,
        mutation: impl FnOnce(&mut TaskGraph) -> Result<(R, bool), TaskGraphError>,
    ) -> Result<R, TaskGraphError> {
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        Self::require_mutation_available(&state)?;
        let mut staging = state.graph.clone();
        let (result, changed) = mutation(&mut staging)?;
        if changed {
            self.persist_graph(&staging)?;
            Self::publish_mutation(&mut state, staging);
        }
        Ok(result)
    }

    /// Attach the persistence backend and restore any persisted graph into
    /// memory. Called once at startup after the database is opened. Returns the
    /// number of restored tasks.
    pub fn attach_db(&self, db: Arc<ManagedDb>) -> Result<usize, String> {
        let loaded = db.with(TaskRepo::load_graph)?;
        let loaded_executions = db
            .try_with(WorkExecutionRepo::load_latest)
            .map_err(|error: ExecutionFenceError| error.to_string())?;
        // Collapse the volatile in-flight states (Running/Review) before the graph
        // goes live: at crash the worker for such a task is gone (headless agents
        // exited; visible-pane PTYs died with the app), so leaving it Running/Review
        // would stall the loop forever on a completion event that never fires. Without
        // this the restore is a verbatim reload and an interrupted build never resumes.
        // `tasks_for_restore` drops them to Pending (preserving topology and the retry
        // budgets, so a poison task can't reset and loop), then `recompute_ready`
        // re-derives readiness from the actual dep states — a dependent is only
        // re-readied once its deps are Done, never dispatched out of order. `load_graph`
        // already proved every dependency exists (its own `add` would have errored
        // otherwise), so rebuilding in the same order re-adds cleanly.
        let collapsed =
            crate::task::tasks_for_restore(loaded.list().into_iter().cloned().collect());
        let mut restored = TaskGraph::new();
        for task in collapsed {
            restored
                .add(task)
                .map_err(|e| format!("Rebuild task graph after restore collapse: {e}"))?;
        }
        restored.recompute_ready();
        let len = restored.len();
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        Self::require_mutation_available(&state).map_err(|error| error.to_string())?;
        db.with(|database| TaskRepo::save_graph(database, &restored))?;
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
        *self.execution_lock() = loaded_executions
            .into_iter()
            .map(|attempt| (attempt.identity.task_id.clone(), attempt))
            .collect();
        Self::publish_mutation(&mut state, restored);
        Ok(len)
    }

    /// Reserve one durable execution generation before any worktree, process,
    /// PTY, review, or merge effect. SQLite commits first; the map is only the
    /// hot projection and can never invent an attempt.
    pub fn reserve_execution(
        &self,
        reservation: ExecutionReservation,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let _writer = self.persistence_lock();
        let db = self.db().ok_or_else(|| {
            ExecutionFenceError::Persistence("execution durability is unavailable".to_string())
        })?;
        let attempt = db.try_with(|database| WorkExecutionRepo::reserve(database, &reservation))?;
        self.execution_lock()
            .insert(reservation.task_id, attempt.clone());
        Ok(attempt)
    }

    pub fn current_execution(&self, task_id: &str) -> Option<WorkExecutionAttempt> {
        self.execution_lock().get(task_id).cloned()
    }

    /// Stable startup snapshot of the latest durable execution generation for
    /// every task. The map remains the hot projection; each row was validated by
    /// `WorkExecutionRepo::load_latest` before it entered memory.
    pub fn execution_snapshot(&self) -> Vec<WorkExecutionAttempt> {
        let mut attempts: Vec<_> = self.execution_lock().values().cloned().collect();
        attempts.sort_by(|left, right| left.identity.task_id.cmp(&right.identity.task_id));
        attempts
    }

    /// Reject a completion/result unless it names the current durable attempt
    /// and generation. This is independent of TaskGraph snapshot persistence.
    pub fn validate_execution_token(
        &self,
        token: &ExecutionToken,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = self
            .current_execution(&token.task_id)
            .ok_or_else(|| ExecutionFenceError::NotFound(token.task_id.clone()))?;
        if current.identity.attempt_id != token.attempt_id
            || current.identity.execution_generation != token.execution_generation
            || current.identity.agent_run_id != token.agent_run_id
            || current.identity.process_generation != token.process_generation
            || current.identity.session_id != token.session_id
            || current.identity.pty_session_id != token.pty_session_id
        {
            return Err(ExecutionFenceError::StaleGeneration {
                task_id: token.task_id.clone(),
                attempted: token.execution_generation,
                current: current.identity.execution_generation,
            });
        }
        Ok(current)
    }

    pub fn commit_execution_reservation(
        &self,
        token: &ExecutionToken,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        self.advance_execution(
            token,
            WorkExecutionState::Reserved,
            ExecutionEffect::Reservation,
            ExecutionFenceState::Committed,
            None,
            None,
            now,
        )
    }

    pub fn reserve_execution_effect(
        &self,
        token: &ExecutionToken,
        effect: ExecutionEffect,
        merge_intent_id: Option<&str>,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = self.validate_execution_token(token)?;
        self.advance_execution(
            token,
            current.state,
            effect,
            ExecutionFenceState::Reserved,
            merge_intent_id,
            None,
            now,
        )
    }

    pub fn start_execution_effect(
        &self,
        token: &ExecutionToken,
        effect: ExecutionEffect,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = self.validate_execution_token(token)?;
        self.advance_execution(
            token,
            current.state,
            effect,
            ExecutionFenceState::EffectStarted,
            None,
            None,
            now,
        )
    }

    pub fn commit_execution_effect(
        &self,
        token: &ExecutionToken,
        effect: ExecutionEffect,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        self.advance_execution(
            token,
            committed_work_state(effect),
            effect,
            ExecutionFenceState::Committed,
            None,
            None,
            now,
        )
    }

    /// Close a fully observed, non-uncertain attempt as failed. The repository
    /// rejects this if an external effect is still merely `effect_started`.
    pub fn fail_execution(
        &self,
        token: &ExecutionToken,
        error: &str,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = self.validate_execution_token(token)?;
        self.advance_execution(
            token,
            WorkExecutionState::Failed,
            current.fence.effect,
            ExecutionFenceState::Committed,
            None,
            Some(error),
            now,
        )
    }

    pub fn mark_execution_needs_reconcile(
        &self,
        token: &ExecutionToken,
        error: &str,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = self.validate_execution_token(token)?;
        self.advance_execution(
            token,
            WorkExecutionState::NeedsReconcile,
            current.fence.effect,
            ExecutionFenceState::NeedsReconcile,
            None,
            Some(error),
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn advance_execution(
        &self,
        token: &ExecutionToken,
        next_work_state: WorkExecutionState,
        next_effect: ExecutionEffect,
        next_fence_state: ExecutionFenceState,
        merge_intent_id: Option<&str>,
        last_error: Option<&str>,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let _writer = self.persistence_lock();
        let current = self.validate_execution_token(token)?;
        let db = self.db().ok_or_else(|| {
            ExecutionFenceError::Persistence("execution durability is unavailable".to_string())
        })?;
        let advanced = db.try_with(|database| {
            WorkExecutionRepo::compare_and_swap(
                database,
                token,
                current.fence.revision,
                next_work_state,
                next_effect,
                next_fence_state,
                merge_intent_id,
                last_error,
                now,
            )
        })?;
        self.execution_lock()
            .insert(token.task_id.clone(), advanced.clone());
        Ok(advanced)
    }

    /// Add a task, then re-run the dependency gate. Returns the ids whose
    /// status changed as a result (e.g. a root task that became `Ready`).
    pub fn create(&self, task: Task) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            graph.add(task)?;
            let changed = graph.recompute_ready();
            Ok((changed, true))
        })
    }

    /// Submit a whole LLM-authored build plan ATOMICALLY. The plan is validated
    /// ([`validate_plan`]: acyclic DAG, declared lanes/owner/branches, and —
    /// crucially — parallel tasks own DISJOINT file lanes) and staged on a clone
    /// of the live graph; the clone is swapped in only if EVERY task adds cleanly
    /// (no id collision with existing tasks). On any problem the whole plan is
    /// rejected with every error listed and the live graph is untouched — no
    /// partial graph, no silent fallback. This is the gate that lets the
    /// orchestrator LLM plan freely and safely. Returns the ids the gate moved to
    /// `Ready`/`Blocked`.
    pub fn submit_plan(&self, tasks: Vec<Task>) -> Result<Vec<String>, Vec<String>> {
        let ordered = validate_plan(tasks)?;
        self.commit_mutation(|staging| {
            for task in ordered {
                staging.add(task)?;
            }
            let changed = staging.recompute_ready();
            Ok((changed, true))
        })
        .map_err(|error| vec![format!("plan rejected — {error}")])
    }

    /// Persist a typed, inspectable A7.1 plan preview without publishing any
    /// executable TaskGraph state. A7 previews always require SQLite, including
    /// when this manager was constructed in ordinary ephemeral test mode.
    pub fn preview_mission_plan(
        &self,
        input: MissionPlanPreviewInput,
        repo_path: &str,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        let (repository_root, trusted_head_oid) = resolve_a7_repository_head(repo_path)?;
        let preview = MissionPlanPreview::from_input_with_repository(
            input,
            repository_root,
            trusted_head_oid,
        )?;
        let _writer = self.persistence_lock();
        db.try_with(|database| TaskRepo::insert_mission_plan_preview(database, &preview))
    }

    pub fn mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::load_mission_plan(database, plan_id, plan_revision))?
            .ok_or_else(|| MissionPlanError::NotFound {
                plan_id: plan_id.to_string(),
                plan_revision,
            })
    }

    pub fn mission_plans(
        &self,
        request_id: Option<&str>,
    ) -> Result<Vec<MissionPlanPreview>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::list_mission_plans(database, request_id))
    }

    pub fn accept_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
        decision_principal_id: &str,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        let preview = self.mission_plan(plan_id, plan_revision)?;
        if preview.status != MissionPlanStatus::Previewed {
            return self.decide_mission_plan(
                plan_id,
                plan_revision,
                MissionPlanStatus::Accepted,
                decision_principal_id,
                None,
            );
        }
        let (canonical_root, current_head_oid) =
            resolve_a7_repository_head(&preview.repository_root)?;
        if canonical_root != preview.repository_root
            || current_head_oid != preview.accepted_mission_head_oid
            || current_head_oid != preview.mission_definition.base_oid
        {
            return Err(MissionPlanError::ContentConflict(
                "accepted_mission_head changed after preview; cancel or reject this preview before creating the next aligned revision".into(),
            ));
        }
        self.decide_mission_plan(
            plan_id,
            plan_revision,
            MissionPlanStatus::Accepted,
            decision_principal_id,
            None,
        )
    }

    pub fn reject_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
        decision_principal_id: &str,
        reason: &str,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        self.decide_mission_plan(
            plan_id,
            plan_revision,
            MissionPlanStatus::Rejected,
            decision_principal_id,
            Some(reason),
        )
    }

    pub fn cancel_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
        decision_principal_id: &str,
        reason: &str,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        self.decide_mission_plan(
            plan_id,
            plan_revision,
            MissionPlanStatus::Cancelled,
            decision_principal_id,
            Some(reason),
        )
    }

    fn decide_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
        target: MissionPlanStatus,
        decision_principal_id: &str,
        reason: Option<&str>,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        let _writer = self.persistence_lock();
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| {
            TaskRepo::decide_mission_plan(
                database,
                plan_id,
                plan_revision,
                target,
                decision_principal_id,
                reason,
            )
        })
    }

    /// Mid-run RE-PLAN (autonomy gap #3): splice a Planner re-decomposition of a
    /// terminally-`Failed` task into the live graph ATOMICALLY. The subtasks are
    /// validated as a plan and added, and every task that depended on the failed
    /// task is rewired onto the new subtask sinks so the chain resumes — all
    /// staged on a clone and swapped in only on success, exactly like
    /// [`submit_plan`]. On any problem (the task isn't failed, an invalid subplan,
    /// an id collision) the whole re-plan is rejected and the live graph is
    /// untouched. The subtasks are authored by the Planner LLM at the call site;
    /// this method is the pure, atomic graph mutation.
    pub fn replan_failed_task(
        &self,
        failed_id: &str,
        subtasks: Vec<Task>,
    ) -> Result<super::replan::ReplanOutcome, Vec<String>> {
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        let outcome = {
            Self::require_mutation_available(&state).map_err(|error| vec![error.to_string()])?;
            let mut staging = state.graph.clone();
            let outcome = super::replan::replan_into(&mut staging, failed_id, subtasks)?;
            self.persist_graph(&staging)
                .map_err(|error| vec![error.to_string()])?;
            Self::publish_mutation(&mut state, staging);
            outcome
        };
        Ok(outcome)
    }

    /// Transition a task, then re-run the gate (finishing a dependency can
    /// unblock dependents). Returns ids whose status changed by the gate.
    pub fn transition(&self, id: &str, to: TaskStatus) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            graph.transition(id, to)?;
            let changed = graph.recompute_ready();
            Ok((changed, true))
        })
    }

    /// Re-run the dependency gate explicitly. Returns ids whose status changed.
    /// Persists only when the gate actually changed something — a no-op gate
    /// pass must not issue a full-graph write (and add WAL write contention).
    pub fn recompute_ready(&self) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            let changed = graph.recompute_ready();
            let did_change = !changed.is_empty();
            Ok((changed, did_change))
        })
    }

    /// A snapshot of every task in insertion order.
    pub fn list(&self) -> Vec<Task> {
        self.lock().graph.list().into_iter().cloned().collect()
    }

    /// Persist the fail-closed TaskGraph projection for attempts whose external
    /// effects cannot be proven safe after restart. This is one atomic graph
    /// mutation regardless of how many task ids the startup audit quarantines.
    pub fn quarantine_tasks_for_startup(
        &self,
        task_ids: &[String],
    ) -> Result<usize, TaskGraphError> {
        self.commit_mutation(|graph| {
            let mut changed_count = 0usize;
            for task_id in task_ids {
                if graph.quarantine_for_startup(task_id)? {
                    changed_count = changed_count.saturating_add(1);
                }
            }
            Ok((changed_count, changed_count > 0))
        })
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.lock().graph.get(id).cloned()
    }

    /// Run a read-only computation over the locked graph without exposing or
    /// cloning it. Lets a higher layer (the orchestrator's scheduling decision)
    /// read the graph while keeping `task` independent of `orchestrator`.
    pub fn read<R>(&self, f: impl FnOnce(&TaskGraph) -> R) -> R {
        f(&self.lock().graph)
    }

    /// Run one autonomy pass on a revisioned snapshot with no graph mutex held
    /// across dispatcher/gate/merge side effects. Other writers fail fast with
    /// `MutationInProgress` while the lease exists; readers remain available.
    /// The mutated snapshot is installed only if the lease and revision still
    /// match, then persisted outside the graph lock.
    pub fn run_autonomy_step<R>(
        &self,
        f: impl FnOnce(&mut TaskGraph) -> R,
    ) -> Result<R, TaskGraphError> {
        let (mut snapshot, expected_revision, lease) = {
            let mut state = self.lock();
            Self::require_mutation_available(&state)?;
            state.next_lease = state.next_lease.saturating_add(1).max(1);
            let lease = state.next_lease;
            state.active_autonomy_lease = Some(lease);
            (state.graph.clone(), state.revision, lease)
        };

        let outcome = catch_unwind(AssertUnwindSafe(|| f(&mut snapshot)));
        let result = match outcome {
            Ok(result) => result,
            Err(payload) => {
                let mut state = self.lock();
                if state.active_autonomy_lease == Some(lease) {
                    state.active_autonomy_lease = None;
                }
                drop(state);
                resume_unwind(payload);
            }
        };

        let _writer = self.persistence_lock();
        {
            let mut state = self.lock();
            if state.active_autonomy_lease != Some(lease) || state.revision != expected_revision {
                let actual = state.revision;
                if state.active_autonomy_lease == Some(lease) {
                    state.active_autonomy_lease = None;
                }
                return Err(TaskGraphError::StaleRevision {
                    expected: expected_revision,
                    actual,
                });
            }
            if let Err(error) = self.persist_graph(&snapshot) {
                state.active_autonomy_lease = None;
                return Err(error);
            }
            state.active_autonomy_lease = None;
            Self::publish_mutation(&mut state, snapshot);
        }
        Ok(result)
    }
}

fn committed_work_state(effect: ExecutionEffect) -> WorkExecutionState {
    match effect {
        ExecutionEffect::Reservation | ExecutionEffect::FirstEffect => WorkExecutionState::Reserved,
        ExecutionEffect::Spawn => WorkExecutionState::Running,
        ExecutionEffect::Review => WorkExecutionState::Review,
        ExecutionEffect::CandidateFreeze | ExecutionEffect::Merge => WorkExecutionState::MergeReady,
        ExecutionEffect::Finalization => WorkExecutionState::Completed,
    }
}

fn resolve_a7_repository_head(repo_path: &str) -> Result<(String, String), MissionPlanError> {
    crate::git::canonical_repository_head(repo_path).map_err(|error| {
        MissionPlanError::Validation(format!(
            "authoritative repository HEAD unavailable: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::Task;

    #[test]
    fn create_runs_the_dependency_gate() {
        let mgr = TaskManager::new();
        let changed = mgr.create(Task::new("root", "Root")).unwrap();
        assert_eq!(changed, ["root"]);
        assert_eq!(mgr.get("root").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn create_rejects_unknown_dependency() {
        let mgr = TaskManager::new();
        assert!(mgr
            .create(Task::new("b", "B").with_dependencies(["missing".to_string()]))
            .is_err());
    }

    /// A fully-specified, dispatchable task for plan-submission tests.
    fn full(id: &str, outputs: &[&str], deps: &[&str]) -> Task {
        let mut t = Task::new(id, format!("do {id}"));
        t.owner = Some("worker".to_string());
        t.outputs = outputs.iter().map(|s| s.to_string()).collect();
        t.dependencies = deps.iter().map(|s| s.to_string()).collect();
        t.source_branch = Some(format!("feat/{id}"));
        t.target_branch = Some("main".to_string());
        t
    }

    #[test]
    fn submit_plan_adds_a_valid_plan_atomically_in_dependency_order() {
        let mgr = TaskManager::new();
        let changed = mgr
            .submit_plan(vec![
                full("c", &["src/c/**"], &["a"]), // listed before its dependency on purpose
                full("a", &["src/a/**"], &[]),
            ])
            .unwrap();
        assert_eq!(mgr.list().len(), 2);
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(mgr.get("c").unwrap().status, TaskStatus::Pending);
        assert!(changed.contains(&"a".to_string()));
    }

    #[test]
    fn submit_plan_rejects_an_invalid_plan_and_leaves_the_graph_untouched() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("existing", "E")).unwrap();
        // Two parallel tasks with overlapping lanes -> the whole plan is rejected.
        let errs = mgr
            .submit_plan(vec![
                full("x", &["src/shared/**"], &[]),
                full("y", &["src/shared/y.rs"], &[]),
            ])
            .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("collide")), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "no plan task was added");
        assert!(mgr.get("x").is_none() && mgr.get("y").is_none());
    }

    #[test]
    fn submit_plan_rejects_a_plan_colliding_with_an_existing_task() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dup", "D")).unwrap();
        let errs = mgr
            .submit_plan(vec![full("dup", &["src/dup/**"], &[])])
            .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("dup")), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "graph untouched on collision");
    }

    #[test]
    fn finishing_a_dependency_unblocks_dependents_on_transition() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dep", "Dep")).unwrap();
        mgr.create(Task::new("child", "Child").with_dependencies(["dep".to_string()]))
            .unwrap();
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Pending);

        mgr.transition("dep", TaskStatus::Running).unwrap();
        let changed = mgr.transition("dep", TaskStatus::Done).unwrap();
        assert!(changed.contains(&"child".to_string()));
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn replan_failed_task_splices_subtasks_and_rewires_atomically() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dead", "Build")).unwrap();
        mgr.create(Task::new("child", "Use").with_dependencies(["dead".to_string()]))
            .unwrap();
        // `create` already gated `dead` to Ready (a root); drive it to Failed.
        mgr.transition("dead", TaskStatus::Running).unwrap();
        mgr.transition("dead", TaskStatus::Failed).unwrap();
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Blocked);

        let outcome = mgr
            .replan_failed_task("dead", vec![full("x1", &["src/x1/**"], &[])])
            .unwrap();
        assert_eq!(outcome.subtask_ids, ["x1"]);
        assert_eq!(outcome.rewired_dependents, ["child"]);
        // child is rewired onto the new sink and the subtask is live in the graph.
        assert_eq!(mgr.get("child").unwrap().dependencies, ["x1"]);
        assert_eq!(mgr.get("x1").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn replan_failed_task_rejects_and_leaves_graph_untouched() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dead", "Build")).unwrap(); // -> Ready (root)
        mgr.transition("dead", TaskStatus::Running).unwrap();
        mgr.transition("dead", TaskStatus::Failed).unwrap();
        // A subtask colliding with the existing `dead` id rejects the whole splice.
        let errs = mgr
            .replan_failed_task("dead", vec![full("dead", &["src/d/**"], &[])])
            .unwrap_err();
        assert!(!errs.is_empty());
        assert_eq!(mgr.list().len(), 1, "graph untouched on a rejected re-plan");
    }

    #[test]
    fn replan_refuses_a_task_that_is_not_failed() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("live", "Live")).unwrap(); // Ready, not Failed
        let errs = mgr
            .replan_failed_task("live", vec![full("x1", &["src/x1/**"], &[])])
            .unwrap_err();
        assert!(errs[0].contains("not failed"), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "no subtask leaked in");
    }

    #[test]
    fn read_runs_a_closure_over_the_locked_graph() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap();
        mgr.create(Task::new("b", "B")).unwrap();
        let ready = mgr.read(|g| g.ready_tasks().len());
        assert_eq!(ready, 2); // both roots are Ready after the gate
    }

    #[test]
    fn list_is_a_cloned_snapshot() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap();
        mgr.create(Task::new("b", "B")).unwrap();
        let ids: Vec<String> = mgr.list().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn autonomy_snapshot_apply_drives_a_mutation_over_the_live_graph() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap(); // -> Ready
        let from = mgr
            .run_autonomy_step(|graph| {
                let before = graph.get("a").unwrap().status;
                graph.transition("a", TaskStatus::Running).unwrap();
                before
            })
            .unwrap();
        assert_eq!(from, TaskStatus::Ready);
        // The mutation is visible on the shared graph after the lock is released.
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn autonomy_side_effect_window_keeps_reads_live_and_writers_fail_fast() {
        let manager = Arc::new(TaskManager::new());
        manager.create(Task::new("a", "A")).unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = manager.clone();
        let handle = std::thread::spawn(move || {
            worker.run_autonomy_step(|graph| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                graph.transition("a", TaskStatus::Running).unwrap();
            })
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();

        assert_eq!(manager.list().len(), 1, "reads stay available under lease");
        assert!(matches!(
            manager.create(Task::new("b", "B")),
            Err(TaskGraphError::MutationInProgress(_))
        ));
        release_tx.send(()).unwrap();
        handle.join().unwrap().unwrap();
        assert_eq!(manager.get("a").unwrap().status, TaskStatus::Running);
        assert!(manager.get("b").is_none());
    }

    #[test]
    fn autonomy_apply_rejects_revision_drift_and_clears_lease() {
        let manager = Arc::new(TaskManager::new());
        manager.create(Task::new("a", "A")).unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = manager.clone();
        let handle = std::thread::spawn(move || {
            worker.run_autonomy_step(|graph| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                graph.transition("a", TaskStatus::Running).unwrap();
            })
        });
        entered_rx.recv().unwrap();
        {
            // Inject impossible internal drift to prove the final CAS guard. Public
            // writers cannot do this: they fail fast while the lease is active.
            let mut state = manager.lock();
            state.revision += 1;
        }
        release_tx.send(()).unwrap();
        assert!(matches!(
            handle.join().unwrap(),
            Err(TaskGraphError::StaleRevision { .. })
        ));
        assert_eq!(manager.get("a").unwrap().status, TaskStatus::Ready);
        manager.create(Task::new("b", "B")).unwrap();
    }

    fn mem_db() -> Arc<ManagedDb> {
        Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()))
    }

    fn commit_a7_test_repo(repo_path: &std::path::Path) -> String {
        let repo = git2::Repository::open(repo_path).unwrap();
        let signature = git2::Signature::now("A7 test", "a7-test@example.invalid").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        let parents = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .into_iter()
            .collect::<Vec<_>>();
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "A7 fixture",
            &tree,
            &parent_refs,
        )
        .unwrap()
        .to_string()
    }

    fn a7_repo_input() -> (
        tempfile::TempDir,
        String,
        crate::task::mission::MissionPlanPreviewInput,
    ) {
        let directory = tempfile::tempdir().unwrap();
        git2::Repository::init(directory.path()).unwrap();
        let head_oid = commit_a7_test_repo(directory.path());
        let mut input = crate::task::mission::tests::fixed_input();
        bind_a7_input_revision(&mut input, 1, &head_oid);
        let repo_path = directory.path().to_string_lossy().into_owned();
        (directory, repo_path, input)
    }

    fn bind_a7_input_revision(
        input: &mut crate::task::mission::MissionPlanPreviewInput,
        revision: u64,
        head_oid: &str,
    ) {
        input.plan_revision = revision;
        input.mission_definition.revision = revision;
        input.mission_definition.work_graph_definition_revision = revision;
        for work in &mut input.work_units {
            work.definition_revision = revision;
        }
        input.mission_definition.base_oid = head_oid.to_string();
        for work in &mut input.work_units {
            for intent in &mut work.file_intents {
                intent.resource_ref.base_oid = head_oid.to_string();
                intent.resource_ref.head_oid = head_oid.to_string();
            }
            for intent in &mut work.symbol_intents {
                intent.resource_ref.base_oid = head_oid.to_string();
                intent.resource_ref.head_oid = head_oid.to_string();
            }
        }
    }

    fn durable_execution_manager() -> (TaskManager, Arc<ManagedDb>) {
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.create(Task::new("exec", "Execute")).unwrap();
        (manager, db)
    }

    fn reserve_exec(manager: &TaskManager, now: u64) -> WorkExecutionAttempt {
        manager
            .reserve_execution(ExecutionReservation {
                task_id: "exec".to_string(),
                repo_path: "C:/repo".to_string(),
                runtime: crate::task::ExecutionRuntime::Headless,
                ownership_claim_ids: vec!["claim-exec".to_string()],
                now,
            })
            .unwrap()
    }

    fn commit_effect(
        manager: &TaskManager,
        attempt: &WorkExecutionAttempt,
        effect: ExecutionEffect,
        now: &mut u64,
    ) {
        *now += 1;
        manager
            .reserve_execution_effect(&attempt.token(), effect, None, *now)
            .unwrap();
        *now += 1;
        manager
            .start_execution_effect(&attempt.token(), effect, *now)
            .unwrap();
        *now += 1;
        manager
            .commit_execution_effect(&attempt.token(), effect, *now)
            .unwrap();
    }

    #[test]
    fn execution_owner_fences_review_freeze_merge_and_finalization_in_order() {
        let (manager, _db) = durable_execution_manager();
        let attempt = reserve_exec(&manager, 10);
        let mut now = 11;
        manager
            .commit_execution_reservation(&attempt.token(), now)
            .unwrap();
        for effect in [
            ExecutionEffect::FirstEffect,
            ExecutionEffect::Spawn,
            ExecutionEffect::Review,
            ExecutionEffect::CandidateFreeze,
        ] {
            commit_effect(&manager, &attempt, effect, &mut now);
        }
        now += 1;
        manager
            .reserve_execution_effect(
                &attempt.token(),
                ExecutionEffect::Merge,
                Some("merge-intent-exec"),
                now,
            )
            .unwrap();
        now += 1;
        manager
            .start_execution_effect(&attempt.token(), ExecutionEffect::Merge, now)
            .unwrap();
        now += 1;
        manager
            .commit_execution_effect(&attempt.token(), ExecutionEffect::Merge, now)
            .unwrap();
        commit_effect(&manager, &attempt, ExecutionEffect::Finalization, &mut now);

        let current = manager.current_execution("exec").unwrap();
        assert_eq!(current.state, WorkExecutionState::Completed);
        assert_eq!(current.fence.effect, ExecutionEffect::Finalization);
        assert_eq!(
            current.merge_intent_id.as_deref(),
            Some("merge-intent-exec")
        );
    }

    #[test]
    fn execution_owner_rejects_stale_and_process_generation_mismatches() {
        let (manager, _db) = durable_execution_manager();
        let first = reserve_exec(&manager, 10);
        manager
            .fail_execution(&first.token(), "known pre-effect failure", 11)
            .unwrap();
        let second = reserve_exec(&manager, 12);
        assert!(matches!(
            manager.validate_execution_token(&first.token()),
            Err(ExecutionFenceError::StaleGeneration { .. })
        ));
        let mut wrong_process = second.token();
        wrong_process.process_generation += 1;
        assert!(matches!(
            manager.validate_execution_token(&wrong_process),
            Err(ExecutionFenceError::StaleGeneration { .. })
        ));
        assert_eq!(second.identity.execution_generation, 2);
    }

    #[test]
    fn crash_boundary_matrix_reloads_each_fence_and_blocks_blind_successor() {
        for target in [
            ExecutionEffect::Reservation,
            ExecutionEffect::FirstEffect,
            ExecutionEffect::Spawn,
            ExecutionEffect::Review,
            ExecutionEffect::CandidateFreeze,
            ExecutionEffect::Merge,
            ExecutionEffect::Finalization,
        ] {
            let (manager, db) = durable_execution_manager();
            let attempt = reserve_exec(&manager, 10);
            let mut now = 10;
            if target != ExecutionEffect::Reservation {
                now += 1;
                manager
                    .commit_execution_reservation(&attempt.token(), now)
                    .unwrap();
                for effect in [
                    ExecutionEffect::FirstEffect,
                    ExecutionEffect::Spawn,
                    ExecutionEffect::Review,
                    ExecutionEffect::CandidateFreeze,
                    ExecutionEffect::Merge,
                    ExecutionEffect::Finalization,
                ] {
                    now += 1;
                    manager
                        .reserve_execution_effect(
                            &attempt.token(),
                            effect,
                            (effect == ExecutionEffect::Merge).then_some("merge-intent-crash"),
                            now,
                        )
                        .unwrap();
                    now += 1;
                    manager
                        .start_execution_effect(&attempt.token(), effect, now)
                        .unwrap();
                    if effect == target {
                        break;
                    }
                    now += 1;
                    manager
                        .commit_execution_effect(&attempt.token(), effect, now)
                        .unwrap();
                }
            }
            drop(manager);

            let restored = TaskManager::new_durable();
            restored.attach_db(db).unwrap();
            let persisted = restored.current_execution("exec").unwrap();
            assert_eq!(persisted.fence.effect, target, "target {target:?}");
            assert_eq!(
                persisted.fence.state,
                if target == ExecutionEffect::Reservation {
                    ExecutionFenceState::Reserved
                } else {
                    ExecutionFenceState::EffectStarted
                },
                "target {target:?}"
            );
            assert!(
                matches!(
                    restored.reserve_execution(ExecutionReservation {
                        task_id: "exec".to_string(),
                        repo_path: "C:/repo".to_string(),
                        runtime: crate::task::ExecutionRuntime::Headless,
                        ownership_claim_ids: vec!["claim-new".to_string()],
                        now: now + 1,
                    }),
                    Err(ExecutionFenceError::ActiveAttempt { .. })
                ),
                "crash at {target:?} must block a blind successor"
            );
            if target != ExecutionEffect::Reservation {
                assert!(
                    matches!(
                        restored.start_execution_effect(&persisted.token(), target, now + 1),
                        Err(ExecutionFenceError::InvalidTransition(_))
                    ),
                    "crash at {target:?} must not replay an already-started effect"
                );
            }
        }
    }

    #[test]
    fn graph_survives_a_simulated_restart_via_db() {
        let db = mem_db();
        let first = TaskManager::new();
        assert_eq!(first.attach_db(db.clone()).unwrap(), 0);
        first.create(Task::new("dep", "Dep")).unwrap();
        first
            .create(Task::new("child", "Child").with_dependencies(["dep".to_string()]))
            .unwrap();
        first.transition("dep", TaskStatus::Running).unwrap();
        drop(first);

        // A brand-new manager attached to the SAME db restores the live graph.
        let second = TaskManager::new();
        assert_eq!(second.attach_db(db).unwrap(), 2);
        // `dep` was Running at "crash"; restore collapses the volatile in-flight
        // state to Pending, then recompute_ready re-derives it to Ready (dep has no
        // unfinished dependencies) so the loop re-dispatches it (its worker is gone).
        // The exact persisted status is still round-tripped by TaskRepo::load_graph —
        // the collapse + re-gate is applied at the manager's attach_db restore
        // boundary, not in the repo. Topology (child's dependency on dep) is preserved.
        assert_eq!(second.get("dep").unwrap().status, TaskStatus::Ready);
        assert_eq!(
            second.get("child").unwrap().dependencies,
            vec!["dep".to_string()]
        );
    }

    #[test]
    fn autonomy_snapshot_mutations_are_persisted() {
        // The autonomy loop mutates a revisioned snapshot —
        // crash/rework/timeout counters must survive restart (the bug class
        // full-snapshot persistence closes).
        let db = mem_db();
        let first = TaskManager::new();
        first.attach_db(db.clone()).unwrap();
        first.create(Task::new("t", "T")).unwrap();
        first
            .run_autonomy_step(|graph| {
                graph.transition("t", TaskStatus::Running).unwrap();
                graph.record_crash("t");
                graph.record_crash("t");
                graph.record_timeout("t");
            })
            .unwrap();
        drop(first);

        let second = TaskManager::new();
        second.attach_db(db).unwrap();
        let t = second.get("t").unwrap();
        // Restore collapses the volatile Running state to Pending and recompute_ready
        // re-readies it (no deps -> deps vacuously all-Done -> Ready), but the retry
        // budgets MUST survive verbatim — otherwise a poison task that already burned
        // its crash/timeout budget would reset and loop forever.
        assert_eq!(t.status, TaskStatus::Ready);
        assert_eq!(t.crash_attempts, 2);
        assert_eq!(t.timeout_attempts, 1);
        assert_eq!(t.rework_attempts, 0);
    }

    #[test]
    fn restore_regates_a_dependent_and_never_dispatches_it_before_its_dependency() {
        // Defense-in-depth for the dependency gate across restart. We persist an
        // (artificially) inconsistent crashed state — A Running AND B Running where B
        // depends on A — which the live gate never produces (B couldn't have started
        // until A was Done). Restore must NOT trust the persisted in-flight status: it
        // collapses both to Pending then recompute_ready re-derives readiness, so the
        // dependent B stays gated (NOT Ready) while only the root A is re-dispatchable.
        // Were the collapse straight to Ready, B would be dispatched out of order
        // against an unfinished dependency.
        let db = mem_db();
        {
            let mut g = TaskGraph::new();
            let mut a = Task::new("a", "A");
            a.status = TaskStatus::Running;
            g.add(a).unwrap();
            let mut b = Task::new("b", "B").with_dependencies(["a".to_string()]);
            b.status = TaskStatus::Running;
            g.add(b).unwrap();
            db.with(|d| TaskRepo::save_graph(d, &g)).unwrap();
        }

        let mgr = TaskManager::new();
        assert_eq!(mgr.attach_db(db).unwrap(), 2);
        // Root A (no deps) is re-readied for dispatch.
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Ready);
        // Dependent B is re-gated to Pending — its dep A is not Done, so it must NOT
        // be Ready (the loop would otherwise run it ahead of A).
        assert_eq!(mgr.get("b").unwrap().status, TaskStatus::Pending);
    }

    #[test]
    fn persistence_failure_does_not_publish_staged_graph_mutation() {
        let db = mem_db();
        let mgr = TaskManager::new();
        mgr.attach_db(db.clone()).unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE tasks", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(matches!(
            mgr.create(Task::new("uncommitted", "Uncommitted")),
            Err(TaskGraphError::Persistence(_))
        ));
        assert!(mgr.get("uncommitted").is_none());
        assert!(mgr.list().is_empty());
    }

    #[test]
    fn production_mode_rejects_mutation_until_durability_is_attached() {
        let mgr = TaskManager::new_durable();
        assert!(matches!(
            mgr.create(Task::new("blocked", "Blocked")),
            Err(TaskGraphError::Persistence(_))
        ));
        assert!(mgr.get("blocked").is_none());
    }

    #[test]
    fn a7_preview_accept_and_restart_are_durable_but_leave_taskgraph_inert() {
        let (repository, repo_path, input) = a7_repo_input();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("a7-restart.sqlite3");
        let db = Arc::new(ManagedDb::new(crate::db::Database::open(&path).unwrap()));
        let first = TaskManager::new_durable();
        first.attach_db(db.clone()).unwrap();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let graph_revision = first.lock().revision;

        let preview = first.preview_mission_plan(input, &repo_path).unwrap();
        assert_eq!(preview.status, MissionPlanStatus::Previewed);
        assert!(first.list().is_empty());
        assert!(first.execution_lock().is_empty());
        assert_eq!(first.lock().revision, graph_revision);

        let accepted = first.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        assert_eq!(accepted.status, MissionPlanStatus::Accepted);
        assert_eq!(
            accepted.decision_principal_id.as_deref(),
            Some(actor.as_str())
        );
        assert!(first.list().is_empty());
        assert!(first.execution_lock().is_empty());
        assert_eq!(first.lock().revision, graph_revision);
        // Same terminal decision is a read/no-op, not another UPDATE.
        assert_eq!(
            first.accept_mission_plan(&plan_id, 1, &actor).unwrap(),
            accepted
        );
        let moved_head = commit_a7_test_repo(repository.path());
        assert_ne!(moved_head, accepted.accepted_mission_head_oid);
        assert_eq!(
            first.accept_mission_plan(&plan_id, 1, &actor).unwrap(),
            accepted,
            "an identical retry returns the durable decision; A7.2 rechecks activation freshness"
        );
        drop(first);
        drop(db);

        let reopened = Arc::new(ManagedDb::new(crate::db::Database::open(&path).unwrap()));
        let restored = TaskManager::new_durable();
        restored.attach_db(reopened).unwrap();
        assert_eq!(restored.mission_plan(&plan_id, 1).unwrap(), accepted);
        assert!(restored.list().is_empty());
        assert!(restored.execution_lock().is_empty());
    }

    #[test]
    fn a7_reject_cancel_and_conflicting_terminal_decisions_never_mutate_graph() {
        let (_first_repository, first_repo_path, first) = a7_repo_input();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db).unwrap();
        let actor = first.mission_definition.created_by.clone();
        let first_plan = first.plan_id.clone();
        manager
            .preview_mission_plan(first, &first_repo_path)
            .unwrap();
        let rejected = manager
            .reject_mission_plan(&first_plan, 1, &actor, "request withdrawn")
            .unwrap();
        assert_eq!(rejected.status, MissionPlanStatus::Rejected);
        assert!(matches!(
            manager.accept_mission_plan(&first_plan, 1, &actor),
            Err(MissionPlanError::IllegalTransition { .. })
        ));

        let (_second_repository, second_repo_path, second) = a7_repo_input();
        let cancel_manager = TaskManager::new_durable();
        cancel_manager.attach_db(mem_db()).unwrap();
        let second_plan = second.plan_id.clone();
        cancel_manager
            .preview_mission_plan(second, &second_repo_path)
            .unwrap();
        let cancelled = cancel_manager
            .cancel_mission_plan(&second_plan, 1, &actor, "operator cancelled")
            .unwrap();
        assert_eq!(cancelled.status, MissionPlanStatus::Cancelled);
        assert!(manager.list().is_empty());
        assert!(manager.execution_lock().is_empty());
        assert!(cancel_manager.list().is_empty());
        assert!(cancel_manager.execution_lock().is_empty());
    }

    #[test]
    fn a7_preview_requires_durability_even_on_ephemeral_manager() {
        let manager = TaskManager::new();
        assert_eq!(
            manager
                .preview_mission_plan(
                    crate::task::mission::tests::fixed_input(),
                    "C:/missing-a7-repository",
                )
                .unwrap_err(),
            MissionPlanError::DurabilityUnavailable
        );
    }

    #[test]
    fn a7_preview_persistence_failure_has_no_hot_state_or_graph_side_effect() {
        let (_repository, repo_path, input) = a7_repo_input();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE mission_plan_revisions", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(matches!(
            manager.preview_mission_plan(input, &repo_path),
            Err(MissionPlanError::Persistence(_))
        ));
        assert!(manager.list().is_empty());
        assert!(manager.execution_lock().is_empty());
    }

    #[test]
    fn a7_accept_rechecks_authoritative_head_and_leaves_stale_preview_inert() {
        let (repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let manager = TaskManager::new_durable();
        manager.attach_db(mem_db()).unwrap();
        let preview = manager.preview_mission_plan(input, &repo_path).unwrap();

        let moved_head = commit_a7_test_repo(repository.path());
        assert_ne!(moved_head, preview.accepted_mission_head_oid);
        assert!(matches!(
            manager.accept_mission_plan(&plan_id, 1, &actor),
            Err(MissionPlanError::ContentConflict(_))
        ));
        assert_eq!(
            manager.mission_plan(&plan_id, 1).unwrap().status,
            MissionPlanStatus::Previewed
        );
        manager
            .cancel_mission_plan(&plan_id, 1, &actor, "authoritative HEAD moved")
            .unwrap();
        let mut replacement = crate::task::mission::tests::fixed_input();
        bind_a7_input_revision(&mut replacement, 2, &moved_head);
        let replacement = manager
            .preview_mission_plan(replacement, &repo_path)
            .unwrap();
        assert_eq!(replacement.plan_revision, 2);
        assert_eq!(replacement.mission_definition.revision, 2);
        let accepted = manager.accept_mission_plan(&plan_id, 2, &actor).unwrap();
        assert_eq!(accepted.status, MissionPlanStatus::Accepted);
        assert!(manager.list().is_empty());
        assert!(manager.execution_lock().is_empty());
    }

    #[test]
    fn a7_terminal_decision_failure_leaves_preview_and_all_hot_state_unchanged() {
        let (_repository, repo_path, input) = a7_repo_input();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        let graph_revision = manager.lock().revision;
        db.with(|database| {
            database
                .conn()
                .execute_batch(
                    "CREATE TRIGGER test_deny_mission_decision
                     BEFORE UPDATE OF status ON mission_plan_revisions
                     BEGIN SELECT RAISE(ABORT, 'injected decision failure'); END;",
                )
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(matches!(
            manager.accept_mission_plan(&plan_id, 1, &actor),
            Err(MissionPlanError::Persistence(_))
        ));
        assert_eq!(
            manager.mission_plan(&plan_id, 1).unwrap().status,
            MissionPlanStatus::Previewed
        );
        assert_eq!(manager.lock().revision, graph_revision);
        assert!(manager.list().is_empty());
        assert!(manager.execution_lock().is_empty());
    }

    #[test]
    fn autonomy_persistence_failure_keeps_prior_graph_and_releases_lease() {
        let db = mem_db();
        let mgr = TaskManager::new();
        mgr.attach_db(db.clone()).unwrap();
        mgr.create(Task::new("stable", "Stable")).unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE tasks", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(matches!(
            mgr.run_autonomy_step(|graph| {
                graph.transition("stable", TaskStatus::Running).unwrap();
            }),
            Err(TaskGraphError::Persistence(_))
        ));
        assert_eq!(mgr.get("stable").unwrap().status, TaskStatus::Ready);
        assert_eq!(mgr.lock().active_autonomy_lease, None);
    }
}
