use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};

use super::graph::{Task, TaskGraph, TaskGraphError};
use super::mission::{
    activation_from_accepted_plan, decision_unix_ms, AcceptanceCoverageEntry, BlockedWorkPacket,
    CompletedWorkPacket, MissionCompletionPacket, MissionGateEvidence, MissionPlanActivation,
    MissionPlanError, MissionPlanPreview, MissionPlanPreviewInput, MissionPlanStatus,
    MissionSettlementOutcome, SettlementBlocker, SettlementBlockerKind, SettlementNextAction,
    SettlementNextActionKind, A7_SETTLEMENT_PROOF_VERSION, BLOCKED_WORK_PACKET_SCHEMA,
    COMPLETED_WORK_PACKET_SCHEMA, MISSION_COMPLETION_PACKET_SCHEMA,
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
        // Preserve only A7 attempts whose exact durable facts prove that the
        // local acceptance coordinator can resume them. Review/EffectStarted
        // without a review record remains uncertain and is deliberately not
        // admitted by this exception.
        let mut resumable_mission_reviews = HashSet::new();
        for attempt in &loaded_executions {
            if loaded.get(&attempt.identity.task_id).is_some()
                && db.with(|database| Self::a7_acceptance_resume_fact(database, attempt))?
            {
                resumable_mission_reviews.insert(attempt.identity.task_id.clone());
            }
        }
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
        let mut collapsed =
            crate::task::tasks_for_restore(loaded.list().into_iter().cloned().collect());
        for task in &mut collapsed {
            if resumable_mission_reviews.contains(&task.id) {
                task.status = TaskStatus::Review;
            }
        }
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

    fn a7_acceptance_resume_fact(
        db: &crate::db::Database,
        attempt: &WorkExecutionAttempt,
    ) -> Result<bool, String> {
        use crate::merge_intent::MergeIntentState;

        if attempt.runtime != super::ExecutionRuntime::VisiblePty {
            return Ok(false);
        }
        let Some(activation) =
            TaskRepo::load_mission_activation_for_task(db, &attempt.identity.task_id)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        if attempt.fence.effect == ExecutionEffect::Review
            && attempt.fence.state == ExecutionFenceState::Reserved
        {
            return Ok(true);
        }
        let binding = crate::persistence::MergeRepo::mission_binding_for_activation(
            db,
            &activation.activation_id,
        )?;
        let review = if let Some(binding) = &binding {
            crate::persistence::ReviewRepo::mission_review_by_id(db, &binding.review_id)?
        } else {
            crate::persistence::ReviewRepo::latest_for_activation(db, &activation.activation_id)?
        };
        let Some(review) = review else {
            return Ok(false);
        };
        let Some(evidence) =
            TaskRepo::load_mission_gate_evidence_by_id(db, &review.tested_evidence_id)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        if evidence.attempt_id != attempt.identity.attempt_id
            || evidence.execution_generation != attempt.identity.execution_generation
            || evidence.agent_run_id != attempt.identity.agent_run_id
            || attempt.identity.pty_session_id.as_deref() != Some(&evidence.pty_session_id)
        {
            return Ok(false);
        }
        if attempt.fence.effect == ExecutionEffect::Review {
            return Ok(matches!(
                attempt.fence.state,
                ExecutionFenceState::EffectStarted | ExecutionFenceState::Committed
            ));
        }
        if review.verdict != crate::review::MissionReviewVerdict::AcceptedExactOid {
            return Ok(false);
        }
        let Some(binding) = binding else {
            return Ok(false);
        };
        if binding.review_id != review.review_id
            || binding.tested_evidence_id != evidence.evidence_id
            || binding.source_oid != review.reviewed_oid
            || binding.target_oid != activation.accepted_base_oid
        {
            return Ok(false);
        }
        if attempt.fence.effect == ExecutionEffect::CandidateFreeze {
            return Ok(matches!(
                attempt.fence.state,
                ExecutionFenceState::Reserved | ExecutionFenceState::Committed
            ));
        }
        if attempt.fence.effect != ExecutionEffect::Merge
            || attempt.merge_intent_id.as_deref() != Some(binding.intent_id.as_str())
        {
            return Ok(false);
        }
        let Some(intent) = crate::persistence::MergeRepo::get(db, &binding.intent_id)? else {
            return Ok(false);
        };
        Ok(matches!(
            attempt.fence.state,
            ExecutionFenceState::Reserved
                | ExecutionFenceState::EffectStarted
                | ExecutionFenceState::Committed
        ) && matches!(
            intent.state,
            MergeIntentState::Queued
                | MergeIntentState::ReadyToMerge
                | MergeIntentState::Merging
                | MergeIntentState::Merged
        ))
    }

    pub fn is_resumable_a7_acceptance(
        &self,
        attempt: &WorkExecutionAttempt,
    ) -> Result<bool, String> {
        let db = self
            .db()
            .ok_or_else(|| "Task persistence unavailable".to_string())?;
        db.with(|database| Self::a7_acceptance_resume_fact(database, attempt))
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

    /// Activate one accepted A7.1 plan into exactly one existing TaskGraph task.
    /// The activation row and full graph snapshot commit atomically. Retrying the
    /// same accepted revision returns the durable activation without minting a
    /// second task or authority record.
    pub fn activate_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<MissionPlanActivation, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        // Serialize the durable lookup and graph publication together. Without
        // this existing owner lock, two simultaneous first activations could
        // both miss the row and the loser would observe a non-empty graph
        // instead of returning the winner's identical activation.
        let _writer = self.persistence_lock();
        if let Some(existing) = db.try_with(|database| {
            TaskRepo::load_mission_activation(database, plan_id, plan_revision)
        })? {
            let preview = self.mission_plan(plan_id, plan_revision)?;
            let (expected_activation, expected_task) = activation_from_accepted_plan(
                &preview,
                existing.activation_id.clone(),
                existing.activated_at_unix_ms,
            )?;
            let actual_task = self
                .read(|graph| {
                    if graph.list().len() == 1 {
                        graph.get(&existing.task_id).cloned()
                    } else {
                        None
                    }
                })
                .ok_or_else(|| {
                    MissionPlanError::ContentConflict(
                        "durable Mission activation is not the exclusive TaskGraph projection"
                            .into(),
                    )
                })?;
            if existing != expected_activation
                || actual_task.id != expected_task.id
                || actual_task.title != expected_task.title
                || actual_task.description != expected_task.description
                || actual_task.owner != expected_task.owner
                || actual_task.model != expected_task.model
                || actual_task.priority != expected_task.priority
                || actual_task.dependencies != expected_task.dependencies
                || actual_task.outputs != expected_task.outputs
                || actual_task.source_branch != expected_task.source_branch
                || actual_task.target_branch != expected_task.target_branch
            {
                return Err(MissionPlanError::ContentConflict(
                    "durable Mission activation or TaskGraph projection no longer matches the accepted plan".into(),
                ));
            }
            return Ok(existing);
        }
        let preview = self.mission_plan(plan_id, plan_revision)?;
        let (root, head) = resolve_a7_repository_head(&preview.repository_root)?;
        if root != preview.repository_root
            || head != preview.accepted_mission_head_oid
            || head != preview.mission_definition.base_oid
        {
            return Err(MissionPlanError::ContentConflict(
                "accepted Mission base changed before A7.2 activation".into(),
            ));
        }
        let (activation, task) = activation_from_accepted_plan(
            &preview,
            uuid::Uuid::now_v7().to_string(),
            decision_unix_ms()?,
        )?;

        let mut state = self.lock();
        Self::require_mutation_available(&state)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        if !state.graph.is_empty() {
            return Err(MissionPlanError::ContentConflict(
                "A7.2 activation requires an otherwise empty TaskGraph so mission_plan_run cannot dispatch or review unrelated work".into(),
            ));
        }
        if state.graph.get(&task.id).is_some() {
            return Err(MissionPlanError::ContentConflict(format!(
                "TaskGraph already contains Mission task {} without its activation",
                task.id
            )));
        }
        let mut staging = state.graph.clone();
        staging
            .add(task)
            .map_err(|error| MissionPlanError::ContentConflict(error.to_string()))?;
        staging.recompute_ready();
        let persisted = db.try_with(|database| {
            TaskRepo::persist_mission_activation(database, &activation, &staging)
        })?;
        Self::publish_mutation(&mut state, staging);
        Ok(persisted)
    }

    pub fn mission_activation_for_task(
        &self,
        task_id: &str,
    ) -> Result<Option<MissionPlanActivation>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::load_mission_activation_for_task(database, task_id))
    }

    pub fn mission_activation(
        &self,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<Option<MissionPlanActivation>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::load_mission_activation(database, plan_id, plan_revision))
    }

    pub fn mission_gate_evidence(
        &self,
        activation_id: &str,
    ) -> Result<Option<MissionGateEvidence>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::load_mission_gate_evidence(database, activation_id))
    }

    pub fn mission_gate_evidence_by_id(
        &self,
        evidence_id: &str,
    ) -> Result<Option<MissionGateEvidence>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        db.try_with(|database| TaskRepo::load_mission_gate_evidence_by_id(database, evidence_id))
    }

    pub fn persist_mission_gate_evidence(
        &self,
        activation: &MissionPlanActivation,
        evidence: &MissionGateEvidence,
    ) -> Result<MissionGateEvidence, MissionPlanError> {
        let attempt = self.current_execution(&activation.task_id).ok_or_else(|| {
            MissionPlanError::Validation("Mission gate evidence lacks an execution attempt".into())
        })?;
        if attempt.runtime != super::ExecutionRuntime::VisiblePty
            || attempt.identity.attempt_id != evidence.attempt_id
            || attempt.identity.execution_generation != evidence.execution_generation
            || attempt.identity.agent_run_id != evidence.agent_run_id
            || evidence.runtime_domain_id != "visible_pty"
            || attempt.identity.pty_session_id.as_deref() != Some(&evidence.pty_session_id)
            || attempt.fence.effect != ExecutionEffect::Review
            || attempt.fence.state != ExecutionFenceState::Reserved
            || evidence.activation_id != activation.activation_id
            || evidence.plan_content_digest != activation.plan_content_digest
            || evidence.base_oid != activation.accepted_base_oid
            || evidence.command_argv != activation.test_argv
            || evidence.candidate_oid != evidence.tested_oid
        {
            return Err(MissionPlanError::Validation(
                "Mission gate evidence is not bound to the active visible candidate generation"
                    .into(),
            ));
        }
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        let _writer = self.persistence_lock();
        db.try_with(|database| TaskRepo::insert_mission_gate_evidence(database, evidence))
    }

    /// Settle the accepted A7 Mission through the existing TaskManager/TaskRepo
    /// owner. Review/Merge repositories are lineage inputs only; TaskRepo performs
    /// the packet insert plus trusted Done/Blocked graph projection in one tx.
    pub fn settle_mission_plan(
        &self,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<MissionSettlementOutcome, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        let _writer = self.persistence_lock();
        let now = decision_unix_ms()?;
        let preview = db
            .try_with(|database| TaskRepo::load_mission_plan(database, plan_id, plan_revision))?
            .ok_or_else(|| MissionPlanError::NotFound {
                plan_id: plan_id.to_string(),
                plan_revision,
            })?;
        preview.verify_integrity()?;
        if preview.status != MissionPlanStatus::Accepted {
            return Err(MissionPlanError::Validation(
                "only an accepted immutable Mission revision may settle".into(),
            ));
        }
        let activation = db
            .try_with(|database| {
                TaskRepo::load_mission_activation(database, plan_id, plan_revision)
            })?
            .ok_or_else(|| {
                MissionPlanError::Validation("accepted Mission has no activation".into())
            })?;
        if let Some((work_packet, mission_packet)) = db.try_with(|database| {
            TaskRepo::load_completed_settlement(database, &activation.activation_id)
        })? {
            if self.read(|graph| graph.get(&activation.task_id).map(|task| task.status))
                != Some(TaskStatus::Done)
            {
                return Err(MissionPlanError::ContentConflict(
                    "durable completion packet and task projection disagree".into(),
                ));
            }
            return Ok(MissionSettlementOutcome::Completed {
                work_packet,
                mission_packet,
            });
        }
        let current_blocked = db.try_with(|database| {
            TaskRepo::load_blocked_settlement(database, &activation.activation_id)
        })?;
        let evidence = db.try_with(|database| {
            TaskRepo::load_mission_gate_evidence(database, &activation.activation_id)
        })?;
        let review = db
            .with(|database| {
                crate::persistence::ReviewRepo::latest_for_activation(
                    database,
                    &activation.activation_id,
                )
            })
            .map_err(MissionPlanError::Persistence)?;
        let binding = db
            .with(|database| {
                crate::persistence::MergeRepo::mission_binding_for_activation(
                    database,
                    &activation.activation_id,
                )
            })
            .map_err(MissionPlanError::Persistence)?;
        let receipt = match &binding {
            Some(value) => db
                .with(|database| {
                    crate::persistence::MergeRepo::mission_receipt(database, &value.intent_id)
                })
                .map_err(MissionPlanError::Persistence)?,
            None => None,
        };

        let mut blockers = derive_declared_authority_blockers(&preview);
        let task_status = self.read(|graph| graph.get(&activation.task_id).map(|task| task.status));
        blockers.extend(evaluate_settlement_freshness(
            &preview,
            &activation,
            evidence.as_ref(),
            review.as_ref(),
            now,
        ));
        if review.as_ref().is_none_or(|value| {
            value.verdict != crate::review::MissionReviewVerdict::AcceptedExactOid
                || !value.reviewer_independence.eligible
                || value.reviewer_independence.shared_ancestor_or_fork
                || !value
                    .reviewer_independence
                    .disqualifying_relations
                    .is_empty()
        }) {
            blockers.push(settlement_blocker(
                SettlementBlockerKind::Policy,
                "invalid-independent-review",
                "INVALID_INDEPENDENT_REVIEW",
                "accepted computed-independent review is missing",
            ));
        }
        if let (Some(evidence), Some(review)) = (&evidence, &review) {
            if evidence.evidence_id != review.tested_evidence_id
                || evidence.tested_oid != review.reviewed_oid
                || evidence.plan_content_digest != activation.plan_content_digest
                || evidence.ended_at_unix_ms > review.created_at_unix_ms
            {
                blockers.push(settlement_repo_blocker(
                    "oid-evidence-lineage-drift",
                    "OID_EVIDENCE_LINEAGE_DRIFT",
                    "tested/reviewed evidence lineage changed",
                ));
            }
        }
        if let (Some(review), Some(binding), Some(receipt)) = (&review, &binding, &receipt) {
            if binding.review_id != review.review_id
                || binding.source_oid != review.reviewed_oid
                || binding.reviewer_independence_digest != review.reviewer_independence.digest
                || receipt.intent_id != binding.intent_id
                || receipt.integrated_oid != binding.source_oid
                || receipt.merge_result != "merged_exact_oid"
            {
                blockers.push(settlement_repo_blocker(
                    "merge-lineage-drift",
                    "MERGE_LINEAGE_DRIFT",
                    "exact-OID merge receipt lineage changed",
                ));
            }
        } else {
            blockers.push(settlement_repo_blocker(
                "missing-merge-receipt",
                "MISSING_MERGE_RECEIPT",
                "exact-OID merge binding or receipt is missing",
            ));
        }

        let git_observation = observe_settlement_git(
            &activation,
            evidence.as_ref().map(|item| item.tested_oid.as_str()),
        );
        if let Some(receipt) = &receipt {
            if git_observation.candidate_oid.as_deref() != Some(receipt.integrated_oid.as_str()) {
                blockers.push(settlement_repo_blocker(
                    "integrated-oid-drift",
                    "INTEGRATED_OID_DRIFT",
                    "candidate and integrated OID differ",
                ));
            }
            match git_observation.target_oid.as_deref() {
                Some(target_oid) if target_oid == receipt.integrated_oid => {}
                Some(_) => blockers.push(settlement_repo_blocker(
                    "settlement-target-drift",
                    "SETTLEMENT_TARGET_DRIFT",
                    "isolated acceptance target moved or does not contain the exact integrated OID",
                )),
                None => blockers.push(settlement_repo_blocker(
                    "settlement-target-unavailable",
                    "SETTLEMENT_TARGET_UNAVAILABLE",
                    "isolated acceptance target cannot be resolved",
                )),
            }
        }
        if git_observation.candidate_state != "exact-owned-clean" {
            blockers.push(settlement_repo_blocker(
                "candidate-ownership-drift",
                "CANDIDATE_OWNERSHIP_DRIFT",
                "candidate source ref, worktree cleanliness, binding, or owned diff changed",
            ));
        }
        let observed_git_fingerprint = git_observation.fingerprint()?;
        let expected_version = db.try_with(|database| {
            TaskRepo::settlement_expected_version(
                database,
                &activation.activation_id,
                &observed_git_fingerprint,
            )
        })?;
        let coverage =
            build_settlement_coverage(&preview, evidence.as_ref(), review.as_ref(), &mut blockers);
        let retry_authority_changed = current_blocked.as_ref().is_some_and(|packet| {
            !blocked_retry_authority_matches(
                packet,
                &blockers,
                evidence.as_ref(),
                review.as_ref(),
                binding.as_ref(),
                &observed_git_fingerprint,
            )
        });
        if task_status != Some(TaskStatus::Review)
            && !(task_status == Some(TaskStatus::Blocked)
                && current_blocked.is_some()
                && retry_authority_changed)
        {
            blockers.push(settlement_repo_blocker(
                "task-not-review",
                "TASK_NOT_REVIEW",
                "work unit is not at the trusted Review settlement fence",
            ));
        }

        if let Some(packet) = &current_blocked {
            if task_status != Some(TaskStatus::Blocked) {
                return Err(MissionPlanError::ContentConflict(
                    "current blocked packet and task projection disagree".into(),
                ));
            }
            if blocked_authority_matches(
                packet,
                &blockers,
                evidence.as_ref(),
                review.as_ref(),
                binding.as_ref(),
                &observed_git_fingerprint,
            ) {
                return Ok(MissionSettlementOutcome::Blocked {
                    blocked_packet: packet.clone(),
                });
            }
        }
        let settlement_generation = current_blocked
            .as_ref()
            .map_or(1, |packet| packet.settlement_generation.saturating_add(1));
        let supersedes_packet_id = current_blocked
            .as_ref()
            .map(|packet| packet.packet_id.clone());
        let mut state = self.lock();
        Self::require_mutation_available(&state)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        let mut staging = state.graph.clone();
        if current_blocked.is_some() && blockers.is_empty() {
            staging
                .transition(&activation.task_id, TaskStatus::Running)
                .and_then(|_| staging.transition(&activation.task_id, TaskStatus::Review))
                .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        }
        if !blockers.is_empty() {
            match staging.get(&activation.task_id).map(|task| task.status) {
                Some(TaskStatus::Blocked) => {}
                Some(TaskStatus::Failed) => {
                    staging
                        .transition(&activation.task_id, TaskStatus::Pending)
                        .and_then(|_| staging.transition(&activation.task_id, TaskStatus::Blocked))
                        .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                }
                Some(status) if status.can_transition(TaskStatus::Blocked) => {
                    staging
                        .transition(&activation.task_id, TaskStatus::Blocked)
                        .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                }
                Some(TaskStatus::Done) => {
                    return Err(MissionPlanError::ContentConflict(
                        "Done task without an immutable completion packet cannot be resettled"
                            .into(),
                    ));
                }
                Some(_) => unreachable!("all TaskStatus values are classified"),
                None => {
                    return Err(MissionPlanError::Persistence(
                        "accepted Mission settlement task is missing".into(),
                    ));
                }
            }
            let packet = blocked_packet(
                &preview,
                &activation,
                &expected_version,
                settlement_generation,
                supersedes_packet_id.clone(),
                &observed_git_fingerprint,
                evidence.as_ref(),
                review.as_ref(),
                binding.as_ref(),
                coverage,
                blockers,
                now,
            )?
            .seal()?;
            let final_activation = activation.clone();
            let final_tested_oid = evidence.as_ref().map(|item| item.tested_oid.clone());
            db.try_with(|database| {
                TaskRepo::persist_blocked_settlement(database, &staging, &packet, || {
                    observe_settlement_git(&final_activation, final_tested_oid.as_deref())
                        .fingerprint()
                })
            })?;
            Self::publish_mutation(&mut state, staging);
            return Ok(MissionSettlementOutcome::Blocked {
                blocked_packet: packet,
            });
        }

        let evidence = evidence.expect("zero blockers requires evidence");
        let review = review.expect("zero blockers requires review");
        let binding = binding.expect("zero blockers requires binding");
        let receipt = receipt.expect("zero blockers requires receipt");
        let diff_digest = git_observation
            .owned_diff_digest
            .clone()
            .expect("zero blockers requires exact owned diff");
        let packet_id = uuid::Uuid::now_v7().to_string();
        let work_packet = CompletedWorkPacket {
            schema: COMPLETED_WORK_PACKET_SCHEMA.into(),
            packet_id: packet_id.clone(),
            activation_id: activation.activation_id.clone(),
            plan_id: activation.plan_id.clone(),
            plan_revision: activation.plan_revision,
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: expected_version.clone(),
            settlement_generation,
            supersedes_packet_id,
            observed_git_fingerprint: observed_git_fingerprint.clone(),
            base_oid: activation.accepted_base_oid.clone(),
            tested_oid: evidence.tested_oid.clone(),
            reviewed_oid: review.reviewed_oid.clone(),
            integrated_oid: receipt.integrated_oid.clone(),
            owned_paths: git_observation.changed_paths.clone(),
            owned_diff_digest: diff_digest,
            gate_evidence_id: evidence.evidence_id.clone(),
            gate_evidence_digest: evidence.evidence_digest.clone(),
            review_id: review.review_id.clone(),
            review_digest: review.review_digest.clone(),
            reviewer_principal_id: review.reviewer_independence.reviewer_principal_id.clone(),
            reviewer_independence: review.reviewer_independence.clone(),
            merge_intent_id: binding.intent_id.clone(),
            merge_receipt_id: receipt.receipt_id.clone(),
            merge_result: receipt.merge_result.clone(),
            acceptance_coverage: coverage.clone(),
            repo_blockers: vec![],
            policy_blockers: vec![],
            operator_blockers: vec![],
            external_blockers: vec![],
            created_at_unix_ms: now,
            packet_digest: String::new(),
        }
        .seal()?;
        let required: std::collections::BTreeMap<String, String> =
            [(activation.work_unit_id.clone(), packet_id)]
                .into_iter()
                .collect();
        let required_ids = preview
            .work_units
            .iter()
            .map(|work| work.work_unit_id.clone())
            .collect::<HashSet<_>>();
        if required_ids != required.keys().cloned().collect::<HashSet<_>>() {
            return Err(MissionPlanError::Validation(
                "Mission completion packet must equal the full accepted work-unit set".into(),
            ));
        }
        let mission_packet = MissionCompletionPacket {
            schema: MISSION_COMPLETION_PACKET_SCHEMA.into(),
            packet_id: uuid::Uuid::now_v7().to_string(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            required_work_unit_packet_ids_by_work_unit: required,
            mission_acceptance_coverage: coverage,
            final_head_oid: receipt.integrated_oid.clone(),
            integrated_oid: receipt.integrated_oid,
            contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: expected_version,
            settlement_generation,
            observed_git_fingerprint: observed_git_fingerprint.clone(),
            merge_result: "merged_exact_oid".into(),
            repo_blockers: vec![],
            policy_blockers: vec![],
            operator_blockers: vec![],
            external_blockers: vec![],
            created_at_unix_ms: now,
            packet_digest: String::new(),
        }
        .seal()?;
        staging
            .transition(&activation.task_id, TaskStatus::Done)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        let final_activation = activation.clone();
        let final_tested_oid = Some(evidence.tested_oid.clone());
        db.try_with(|database| {
            TaskRepo::persist_completed_settlement(
                database,
                &staging,
                &work_packet,
                &mission_packet,
                || {
                    observe_settlement_git(&final_activation, final_tested_oid.as_deref())
                        .fingerprint()
                },
            )
        })?;
        Self::publish_mutation(&mut state, staging);
        Ok(MissionSettlementOutcome::Completed {
            work_packet,
            mission_packet,
        })
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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SettlementGitObservation {
    candidate_oid: Option<String>,
    target_oid: Option<String>,
    changed_paths: Vec<String>,
    owned_diff_digest: Option<String>,
    candidate_state: String,
    target_state: String,
}

impl SettlementGitObservation {
    fn fingerprint(&self) -> Result<String, MissionPlanError> {
        let bytes = serde_json::to_vec(self).map_err(|error| {
            MissionPlanError::Persistence(format!("encode Git settlement witness: {error}"))
        })?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}

fn observe_settlement_git(
    activation: &MissionPlanActivation,
    tested_oid: Option<&str>,
) -> SettlementGitObservation {
    let candidate = tested_oid
        .ok_or_else(|| "candidate-lineage-incomplete".to_string())
        .and_then(|tested_oid| {
            crate::git::inspect_exact_owned_candidate(
                &activation.repository_root,
                &activation.source_branch,
                &activation.accepted_base_oid,
                tested_oid,
                &activation.owned_targets,
                1_048_576,
            )
        });
    let target = git2::Repository::open(&activation.repository_root).and_then(|repo| {
        repo.revparse_single(&activation.target_branch)
            .map(|object| object.id().to_string())
    });
    let target_state = if target.is_ok() {
        "resolved"
    } else {
        "unavailable"
    };
    let target_oid = target.ok();
    match candidate {
        Ok(snapshot) => SettlementGitObservation {
            candidate_oid: Some(snapshot.candidate_oid),
            target_oid,
            changed_paths: snapshot.changed_paths,
            owned_diff_digest: Some(format!("{:x}", Sha256::digest(snapshot.diff.as_bytes()))),
            candidate_state: "exact-owned-clean".into(),
            target_state: target_state.into(),
        },
        Err(error) => SettlementGitObservation {
            candidate_oid: None,
            target_oid,
            changed_paths: Vec::new(),
            owned_diff_digest: None,
            candidate_state: match error.as_str() {
                "Mission source branch moved after testing" => "source-ref-drift",
                "Mission candidate worktree is dirty" => "worktree-dirty",
                "Mission candidate worktree branch/OID binding changed" => "worktree-binding-drift",
                "candidate-lineage-incomplete" => "lineage-incomplete",
                _ => "candidate-unavailable",
            }
            .into(),
            target_state: target_state.into(),
        },
    }
}

fn settlement_blocker(
    kind: SettlementBlockerKind,
    id: &str,
    code: &str,
    message: &str,
) -> SettlementBlocker {
    let (action, owner, authority) = match kind {
        SettlementBlockerKind::Repo => (
            SettlementNextActionKind::Reprove,
            "task-manager",
            "task-repo",
        ),
        SettlementBlockerKind::Policy => (
            SettlementNextActionKind::ResolvePolicy,
            "mission-policy",
            "accepted-mission-plan",
        ),
        SettlementBlockerKind::Operator => (
            SettlementNextActionKind::OperatorAction,
            "mission-operator",
            "accepted-capability-requirement",
        ),
        SettlementBlockerKind::External => (
            SettlementNextActionKind::ExternalAction,
            "external-authority",
            "accepted-artifact-requirement",
        ),
    };
    SettlementBlocker {
        blocker_id: id.into(),
        kind,
        authority: authority.into(),
        code: code.into(),
        message: message.into(),
        required_inputs: vec![format!("settlement-input:{id}")],
        command_argv: Vec::new(),
        command_result: Some(message.into()),
        artifact_refs: vec![format!("settlement-authority:{code}")],
        next_action: SettlementNextAction {
            kind: action,
            owner: owner.into(),
            input_refs: vec![format!("settlement-recovery:{id}")],
        },
    }
}

fn settlement_repo_blocker(id: &str, code: &str, message: &str) -> SettlementBlocker {
    settlement_blocker(SettlementBlockerKind::Repo, id, code, message)
}

fn derive_declared_authority_blockers(preview: &MissionPlanPreview) -> Vec<SettlementBlocker> {
    let mut blockers = Vec::new();
    for work in &preview.work_units {
        for capability in &work.required_capability_templates {
            blockers.push(settlement_blocker(
                SettlementBlockerKind::Operator,
                &format!(
                    "operator-authority-unavailable-{}",
                    capability.capability_template_id
                ),
                "OPERATOR_AUTHORITY_UNAVAILABLE",
                "accepted Mission requires operator capability evidence unavailable to settlement",
            ));
        }
        for artifact in &work.required_artifacts {
            blockers.push(settlement_blocker(
                SettlementBlockerKind::External,
                &format!("external-authority-unavailable-{}", artifact.artifact_id),
                "EXTERNAL_AUTHORITY_UNAVAILABLE",
                "accepted Mission requires external artifact evidence unavailable to settlement",
            ));
        }
    }
    blockers
}

fn evaluate_settlement_freshness(
    preview: &MissionPlanPreview,
    activation: &MissionPlanActivation,
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    now: u64,
) -> Vec<SettlementBlocker> {
    let Some(evidence) = evidence else {
        return vec![settlement_repo_blocker(
            "missing-fresh-evidence",
            "MISSING_FRESH_EVIDENCE",
            "fresh passed exact-OID gate evidence is missing",
        )];
    };
    let Some(expected) = preview
        .expected_tests
        .iter()
        .find(|expected| expected.gate_id == evidence.gate_id)
    else {
        return vec![settlement_repo_blocker(
            "unexpected-gate-evidence",
            "UNEXPECTED_GATE_EVIDENCE",
            "latest evidence does not belong to an accepted expected test",
        )];
    };
    let Some(requirement) = preview
        .work_units
        .iter()
        .flat_map(|work| work.required_gates.iter())
        .find(|gate| gate.gate_id == expected.gate_id)
    else {
        return vec![settlement_blocker(
            SettlementBlockerKind::Policy,
            "gate-policy-unavailable",
            "POLICY_AUTHORITY_UNAVAILABLE",
            "accepted expected test has no gate policy authority",
        )];
    };
    let mut blockers = Vec::new();
    let max_age_ms = expected
        .freshness_policy
        .max_age_ms
        .parse::<u64>()
        .unwrap_or_default();
    if evidence.started_at_unix_ms > evidence.ended_at_unix_ms || evidence.ended_at_unix_ms > now {
        blockers.push(settlement_repo_blocker(
            "evidence-clock-skew",
            "EVIDENCE_CLOCK_SKEW",
            "gate evidence timestamps are future-dated or inverted",
        ));
    } else if now - evidence.ended_at_unix_ms > max_age_ms {
        blockers.push(settlement_repo_blocker(
            "stale-gate-evidence",
            "STALE_GATE_EVIDENCE",
            "gate evidence exceeds the accepted freshness maxAgeMs",
        ));
    }
    if evidence.result != "passed"
        || expected.required_result != "passed_exact_oid"
        || evidence.plan_content_digest != activation.plan_content_digest
        || evidence.gate_id != requirement.gate_id
        || evidence.command_argv != requirement.command_argv
    {
        blockers.push(settlement_repo_blocker(
            "gate-contract-drift",
            "GATE_CONTRACT_DRIFT",
            "gate result, command, or accepted plan contract changed",
        ));
    }
    if expected.freshness_policy.require_same_contract_version
        && evidence.contract_version != requirement.contract_version
    {
        blockers.push(settlement_repo_blocker(
            "gate-contract-version-drift",
            "GATE_CONTRACT_VERSION_DRIFT",
            "evidence contract version differs from the accepted gate contract",
        ));
    }
    if expected.freshness_policy.require_same_head_oid
        && evidence.tested_oid != evidence.candidate_oid
    {
        blockers.push(settlement_repo_blocker(
            "tested-current-oid-drift",
            "TESTED_CURRENT_OID_DRIFT",
            "tested OID differs from the evidence candidate OID",
        ));
    }
    if expected
        .freshness_policy
        .require_same_environment_fingerprint
    {
        let review_environment = review.and_then(|record| {
            record
                .reviewer_independence
                .evidence_refs
                .iter()
                .find(|item| item.evidence_id == evidence.evidence_id)
                .and_then(|item| item.environment_fingerprint.as_deref())
        });
        if review_environment != Some(evidence.environment_fingerprint.as_str()) {
            blockers.push(settlement_repo_blocker(
                "environment-fingerprint-drift",
                "ENVIRONMENT_FINGERPRINT_DRIFT",
                "review lineage does not preserve the tested environment fingerprint",
            ));
        }
    }
    if review.is_some_and(|record| {
        record.created_at_unix_ms < evidence.ended_at_unix_ms || record.created_at_unix_ms > now
    }) {
        blockers.push(settlement_blocker(
            SettlementBlockerKind::Policy,
            "review-clock-skew",
            "REVIEW_POLICY_CLOCK_SKEW",
            "review timestamp is outside the accepted evidence-to-settlement order",
        ));
    }
    blockers
}

fn build_settlement_coverage(
    preview: &MissionPlanPreview,
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    blockers: &mut Vec<SettlementBlocker>,
) -> Vec<AcceptanceCoverageEntry> {
    let review_by_id = review
        .map(|record| {
            record
                .clause_coverage
                .iter()
                .map(|entry| (entry.clause_id.as_str(), entry.accepted))
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default();
    let mut seen = HashSet::new();
    let coverage = preview
        .mission_definition
        .acceptance
        .iter()
        .map(|clause| {
            let accepted = evidence.is_some_and(|item| {
                item.result == "passed"
                    && clause
                        .required_gate_ids
                        .iter()
                        .all(|id| id == &item.gate_id)
            }) && review_by_id.get(clause.clause_id.as_str()) == Some(&true)
                && seen.insert(clause.clause_id.clone());
            AcceptanceCoverageEntry {
                clause_id: clause.clause_id.clone(),
                required_gate_ids: clause.required_gate_ids.clone(),
                evidence_ids: evidence
                    .map(|item| vec![item.evidence_id.clone()])
                    .unwrap_or_default(),
                accepted,
            }
        })
        .collect::<Vec<_>>();
    if coverage.len() != preview.mission_definition.acceptance.len()
        || coverage.iter().any(|entry| !entry.accepted)
        || review.is_some_and(|record| record.clause_coverage.len() != coverage.len())
    {
        blockers.push(settlement_repo_blocker(
            "acceptance-coverage-gap",
            "ACCEPTANCE_COVERAGE_GAP",
            "Mission acceptance clauses are missing, duplicated, or lack exact fresh coverage",
        ));
    }
    coverage
}

fn blocked_authority_matches(
    packet: &BlockedWorkPacket,
    blockers: &[SettlementBlocker],
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    binding: Option<&crate::merge_intent::MissionMergeBinding>,
    observed_git_fingerprint: &str,
) -> bool {
    let mut expected = blockers
        .iter()
        .map(|blocker| (blocker.kind, blocker.code.as_str()))
        .collect::<Vec<_>>();
    expected.sort_by_key(|(kind, code)| (format!("{kind:?}"), *code));
    let mut durable = packet
        .repo_blockers
        .iter()
        .chain(packet.policy_blockers.iter())
        .chain(packet.operator_blockers.iter())
        .chain(packet.external_blockers.iter())
        .map(|blocker| (blocker.kind, blocker.code.as_str()))
        .collect::<Vec<_>>();
    durable.sort_by_key(|(kind, code)| (format!("{kind:?}"), *code));
    durable == expected
        && !blocked_inputs_changed(packet, evidence, review, binding, observed_git_fingerprint)
}

fn blocked_retry_authority_matches(
    packet: &BlockedWorkPacket,
    blockers_before_task_fence: &[SettlementBlocker],
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    binding: Option<&crate::merge_intent::MissionMergeBinding>,
    observed_git_fingerprint: &str,
) -> bool {
    let mut expected = blockers_before_task_fence
        .iter()
        .map(|blocker| (blocker.kind, blocker.code.as_str()))
        .collect::<Vec<_>>();
    expected.sort_by_key(|(kind, code)| (format!("{kind:?}"), *code));
    let mut durable = packet
        .repo_blockers
        .iter()
        .chain(packet.policy_blockers.iter())
        .chain(packet.operator_blockers.iter())
        .chain(packet.external_blockers.iter())
        .filter(|blocker| blocker.code != "TASK_NOT_REVIEW")
        .map(|blocker| (blocker.kind, blocker.code.as_str()))
        .collect::<Vec<_>>();
    durable.sort_by_key(|(kind, code)| (format!("{kind:?}"), *code));
    durable == expected
        && !blocked_inputs_changed(packet, evidence, review, binding, observed_git_fingerprint)
}

fn blocked_inputs_changed(
    packet: &BlockedWorkPacket,
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    binding: Option<&crate::merge_intent::MissionMergeBinding>,
    observed_git_fingerprint: &str,
) -> bool {
    packet.observed_git_fingerprint != observed_git_fingerprint
        || packet.evidence_ids
            != evidence
                .map(|item| vec![item.evidence_id.clone()])
                .unwrap_or_default()
        || packet.review_id.as_deref() != review.map(|item| item.review_id.as_str())
        || packet.merge_intent_id.as_deref() != binding.map(|item| item.intent_id.as_str())
}

#[allow(clippy::too_many_arguments)]
fn blocked_packet(
    preview: &MissionPlanPreview,
    activation: &MissionPlanActivation,
    expected_version: &str,
    settlement_generation: u64,
    supersedes_packet_id: Option<String>,
    observed_git_fingerprint: &str,
    evidence: Option<&MissionGateEvidence>,
    review: Option<&crate::review::MissionReviewRecord>,
    binding: Option<&crate::merge_intent::MissionMergeBinding>,
    coverage: Vec<AcceptanceCoverageEntry>,
    blockers: Vec<SettlementBlocker>,
    now: u64,
) -> Result<BlockedWorkPacket, MissionPlanError> {
    let (mut repo_blockers, mut policy_blockers, mut operator_blockers, mut external_blockers) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for blocker in blockers {
        match blocker.kind {
            SettlementBlockerKind::Repo => repo_blockers.push(blocker),
            SettlementBlockerKind::Policy => policy_blockers.push(blocker),
            SettlementBlockerKind::Operator => operator_blockers.push(blocker),
            SettlementBlockerKind::External => external_blockers.push(blocker),
        }
    }
    Ok(BlockedWorkPacket {
        schema: BLOCKED_WORK_PACKET_SCHEMA.into(),
        packet_id: uuid::Uuid::now_v7().to_string(),
        activation_id: activation.activation_id.clone(),
        plan_id: preview.plan_id.clone(),
        plan_revision: preview.plan_revision,
        mission_id: activation.mission_id.clone(),
        mission_revision: activation.mission_revision,
        work_unit_id: activation.work_unit_id.clone(),
        plan_content_digest: activation.plan_content_digest.clone(),
        contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
        settlement_expected_version: expected_version.into(),
        settlement_generation,
        supersedes_packet_id,
        observed_git_fingerprint: observed_git_fingerprint.into(),
        base_oid: activation.accepted_base_oid.clone(),
        candidate_oid: evidence.map(|item| item.candidate_oid.clone()),
        tested_oid: evidence.map(|item| item.tested_oid.clone()),
        reviewed_oid: review.map(|item| item.reviewed_oid.clone()),
        integrated_oid: None,
        evidence_ids: evidence
            .map(|item| vec![item.evidence_id.clone()])
            .unwrap_or_default(),
        review_id: review.map(|item| item.review_id.clone()),
        merge_intent_id: binding.map(|item| item.intent_id.clone()),
        acceptance_coverage: coverage,
        repo_blockers,
        policy_blockers,
        operator_blockers,
        external_blockers,
        completion_credit: 0,
        created_at_unix_ms: now,
        packet_digest: String::new(),
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

    fn v10_shape_packet_json<T: serde::Serialize>(packet: &T) -> (String, String) {
        let mut raw = serde_json::to_string(packet).unwrap();
        let value = serde_json::to_value(packet).unwrap();
        for field in [
            "settlementGeneration",
            "supersedesPacketId",
            "observedGitFingerprint",
        ] {
            if let Some(field_value) = value.get(field) {
                let encoded = serde_json::to_string(field_value).unwrap();
                let needle = format!(",\"{field}\":{encoded}");
                assert_eq!(raw.match_indices(&needle).count(), 1);
                raw = raw.replacen(&needle, "", 1);
            }
        }
        let current_digest = value
            .get("packetDigest")
            .and_then(serde_json::Value::as_str)
            .unwrap()
            .to_string();
        (raw, current_digest)
    }

    fn legacy_v10_packet_json<T: serde::Serialize>(packet: &T) -> (String, String) {
        let (raw, current_digest) = v10_shape_packet_json(packet);
        let signed = format!("\"packetDigest\":\"{current_digest}\"");
        assert_eq!(raw.match_indices(&signed).count(), 1);
        let unsigned = raw.replacen(&signed, "\"packetDigest\":\"\"", 1);
        let legacy_digest = format!("{:x}", sha2::Sha256::digest(unsigned.as_bytes()));
        let legacy_json = unsigned.replacen(
            "\"packetDigest\":\"\"",
            &format!("\"packetDigest\":\"{legacy_digest}\""),
            1,
        );
        (legacy_json, legacy_digest)
    }

    #[allow(clippy::too_many_arguments)]
    fn migrate_v10_settlement_rows(
        db: &Arc<ManagedDb>,
        activation: &MissionPlanActivation,
        rows: &[(&str, Option<&str>, &str, &str, &str, &str, u64)],
    ) {
        db.with(|database| {
            crate::db::migrations::reset_settlement_store_to_v10_for_test(database.conn())
                .map_err(|error| error.to_string())?;
            for (packet_id, work_unit_id, kind, expected, json, digest, created_at) in rows {
                database
                    .conn()
                    .execute(
                        "INSERT INTO mission_settlement_packets (
                         packet_id,activation_id,mission_id,mission_revision,work_unit_id,
                         packet_kind,settlement_expected_version,packet_json,packet_digest,
                         created_at_ms,supersedes_packet_id
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL)",
                        rusqlite::params![
                            packet_id,
                            activation.activation_id,
                            activation.mission_id,
                            activation.mission_revision,
                            work_unit_id,
                            kind,
                            expected,
                            json,
                            digest,
                            created_at
                        ],
                    )
                    .map_err(|error| error.to_string())?;
            }
            crate::db::migrations::run_migrations(database.conn())
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap();
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
    fn a7_2_activation_atomically_materializes_one_task_and_is_idempotent() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();

        let activation = manager.activate_mission_plan(&plan_id, 1).unwrap();
        assert_eq!(manager.list().len(), 1);
        let task = manager.get(&activation.task_id).unwrap();
        assert_eq!(task.outputs, activation.owned_targets);
        assert_eq!(task.owner.as_deref(), Some("implementer"));
        assert_eq!(task.model.as_deref(), Some("codex-no-hooks"));
        assert_eq!(
            task.source_branch.as_deref(),
            Some(activation.source_branch.as_str())
        );
        assert_eq!(task.status, TaskStatus::Ready);
        assert!(task.description.contains(crate::task::A7_FIXTURE_REQUEST));
        assert!(task
            .description
            .contains(crate::task::A7_FIXTURE_OWNED_TARGET));
        assert_eq!(
            manager.activate_mission_plan(&plan_id, 1).unwrap(),
            activation
        );
        assert_eq!(manager.list().len(), 1);
        let durable = db
            .try_with(|database| TaskRepo::load_mission_activation(database, &plan_id, 1))
            .unwrap()
            .unwrap();
        assert_eq!(durable, activation);

        manager
            .create(Task::new(
                "compatibility-task",
                "Must not join the Mission run",
            ))
            .unwrap();
        assert!(matches!(
            manager.activate_mission_plan(&plan_id, 1),
            Err(MissionPlanError::ContentConflict(message))
                if message.contains("exclusive TaskGraph projection")
        ));
    }

    #[test]
    fn a7_2_concurrent_first_activation_returns_one_durable_identity() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let manager = Arc::new(TaskManager::new_durable());
        manager.attach_db(mem_db()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();

        let barrier = Arc::new(std::sync::Barrier::new(3));
        let calls = (0..2)
            .map(|_| {
                let manager = manager.clone();
                let barrier = barrier.clone();
                let plan_id = plan_id.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    manager.activate_mission_plan(&plan_id, 1).unwrap()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let activations = calls
            .into_iter()
            .map(|call| call.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(activations[0], activations[1]);
        assert_eq!(manager.list().len(), 1);
    }

    #[test]
    fn a7_2_restart_preserves_completed_mission_at_pre_review_fence() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        let activation = manager.activate_mission_plan(&plan_id, 1).unwrap();

        let attempt = manager
            .reserve_execution(ExecutionReservation {
                task_id: activation.task_id.clone(),
                repo_path: activation.repository_root.clone(),
                runtime: crate::task::ExecutionRuntime::VisiblePty,
                ownership_claim_ids: vec!["claim-a7".to_string()],
                now: 10,
            })
            .unwrap();
        let mut now = 11;
        manager
            .commit_execution_reservation(&attempt.token(), now)
            .unwrap();
        for effect in [ExecutionEffect::FirstEffect, ExecutionEffect::Spawn] {
            commit_effect(&manager, &attempt, effect, &mut now);
        }
        now += 1;
        manager
            .reserve_execution_effect(&attempt.token(), ExecutionEffect::Review, None, now)
            .unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Running)
            .unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Review)
            .unwrap();
        db.with(|database| {
            database
                .conn()
                .execute(
                    "UPDATE tasks SET status='ready' WHERE id=?1",
                    [&activation.task_id],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        drop(manager);

        let restored = TaskManager::new_durable();
        restored.attach_db(db).unwrap();
        assert_eq!(
            restored.get(&activation.task_id).unwrap().status,
            TaskStatus::Review,
            "a durable Mission completion must resume candidate freeze, not dispatch again"
        );
        let restored_attempt = restored.current_execution(&activation.task_id).unwrap();
        assert_eq!(restored_attempt.fence.effect, ExecutionEffect::Review);
        assert_eq!(restored_attempt.fence.state, ExecutionFenceState::Reserved);
    }

    #[test]
    fn a7_4_completed_settlement_consumes_latest_a7_3_evidence_atomically() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db_directory = tempfile::tempdir().unwrap();
        let db_path = db_directory.path().join("settlement-successor-race.db");
        let db = Arc::new(ManagedDb::new(crate::db::Database::open(&db_path).unwrap()));
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        let activation = manager.activate_mission_plan(&plan_id, 1).unwrap();
        let attempt = manager
            .reserve_execution(ExecutionReservation {
                task_id: activation.task_id.clone(),
                repo_path: activation.repository_root.clone(),
                runtime: crate::task::ExecutionRuntime::VisiblePty,
                ownership_claim_ids: vec!["claim-a7".to_string()],
                now: 10,
            })
            .unwrap();
        let mut now = 11;
        manager
            .commit_execution_reservation(&attempt.token(), now)
            .unwrap();
        for effect in [ExecutionEffect::FirstEffect, ExecutionEffect::Spawn] {
            commit_effect(&manager, &attempt, effect, &mut now);
        }
        now += 1;
        manager
            .reserve_execution_effect(&attempt.token(), ExecutionEffect::Review, None, now)
            .unwrap();
        let current = manager.current_execution(&activation.task_id).unwrap();
        let evidence = |id: &str, digest_byte: char, ended_at: u64| MissionGateEvidence {
            schema: "aelyris.mission_gate_evidence/v1".into(),
            evidence_id: id.into(),
            activation_id: activation.activation_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            attempt_id: current.identity.attempt_id.clone(),
            execution_generation: current.identity.execution_generation,
            agent_run_id: current.identity.agent_run_id.clone(),
            runtime_domain_id: "visible_pty".into(),
            pty_session_id: current.identity.pty_session_id.clone().unwrap(),
            gate_id: crate::task::A7_FIXTURE_GATE_ID.into(),
            contract_version: "1".into(),
            command_argv: activation.test_argv.clone(),
            command_fingerprint: "1".repeat(64),
            environment_fingerprint: "2".repeat(64),
            result: "passed".into(),
            evidence_digest: digest_byte.to_string().repeat(64),
            base_oid: activation.accepted_base_oid.clone(),
            candidate_oid: "1234567890abcdef1234567890abcdef12345678".into(),
            tested_oid: "1234567890abcdef1234567890abcdef12345678".into(),
            started_at_unix_ms: ended_at - 1,
            ended_at_unix_ms: ended_at,
        };
        let first = evidence("0197c000-0000-7000-8000-000000000020", 'a', 100);
        let second = evidence("0197c000-0000-7000-8000-000000000021", 'b', 200);
        manager
            .persist_mission_gate_evidence(&activation, &first)
            .unwrap();
        manager
            .persist_mission_gate_evidence(&activation, &second)
            .unwrap();
        assert_eq!(
            manager
                .mission_gate_evidence(&activation.activation_id)
                .unwrap(),
            Some(second.clone())
        );
        let count: i64 = db
            .with(|database| {
                database
                    .conn()
                    .query_row(
                        "SELECT COUNT(*) FROM mission_gate_evidence WHERE activation_id=?1",
                        [&activation.activation_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(count, 2);

        let preview = manager.mission_plan(&plan_id, 1).unwrap();
        let builder =
            crate::review::mission::builder_runtime_attestation(&second, "codex-no-hooks").unwrap();
        let coverage = preview
            .mission_definition
            .acceptance
            .iter()
            .map(|clause| {
                serde_json::json!({
                    "clauseId": clause.clause_id,
                    "accepted": true,
                    "reason": "exact evidence and owned diff verified"
                })
            })
            .collect::<Vec<_>>();
        let model = serde_json::json!({"clauseCoverage": coverage, "findings": []}).to_string();
        let invocation = crate::review::ReviewerInvocation::test_only(&model);
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_reviewer_invocation_receipt(
                database,
                invocation.receipt(),
            )
            .map(|_| ())
        })
        .unwrap();
        let review = crate::review::review_exact_candidate(
            &preview,
            &activation,
            &second,
            &activation.owned_targets,
            "+ exact owned test",
            201,
            &builder,
            false,
            &invocation,
        )
        .unwrap();
        assert!(evaluate_settlement_freshness(
            &preview,
            &activation,
            Some(&second),
            Some(&review),
            second.ended_at_unix_ms + 300_000,
        )
        .is_empty());
        let stale = evaluate_settlement_freshness(
            &preview,
            &activation,
            Some(&second),
            Some(&review),
            second.ended_at_unix_ms + 300_001,
        );
        assert!(stale
            .iter()
            .any(|blocker| blocker.code == "STALE_GATE_EVIDENCE"));
        let skew = evaluate_settlement_freshness(
            &preview,
            &activation,
            Some(&second),
            Some(&review),
            second.ended_at_unix_ms - 1,
        );
        assert!(skew
            .iter()
            .any(|blocker| blocker.code == "EVIDENCE_CLOCK_SKEW"));
        let mut contract_drift = second.clone();
        contract_drift.contract_version = "2".into();
        assert!(evaluate_settlement_freshness(
            &preview,
            &activation,
            Some(&contract_drift),
            Some(&review),
            300,
        )
        .iter()
        .any(|blocker| blocker.code == "GATE_CONTRACT_VERSION_DRIFT"));
        let mut environment_drift = second.clone();
        environment_drift.environment_fingerprint = "8".repeat(64);
        assert!(evaluate_settlement_freshness(
            &preview,
            &activation,
            Some(&environment_drift),
            Some(&review),
            300,
        )
        .iter()
        .any(|blocker| blocker.code == "ENVIRONMENT_FINGERPRINT_DRIFT"));
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_mission_review(database, &review).map(|_| ())
        })
        .unwrap();
        let intent = crate::merge_intent::MergeIntent {
            intent_id: "merge-a7-3".into(),
            repo_path: activation.repository_root.clone(),
            source_branch: activation.source_branch.clone(),
            target_branch: activation.target_branch.clone(),
            source_oid: second.tested_oid.clone(),
            target_oid: activation.accepted_base_oid.clone(),
            merge_base_oid: Some(activation.accepted_base_oid.clone()),
            task_id: activation.work_unit_id.clone(),
            created_at: 202,
            state: crate::merge_intent::MergeIntentState::Queued,
            updated_at: 202,
            session_id: Some(
                review
                    .reviewer_independence
                    .reviewer_logical_session_id
                    .clone(),
            ),
            reviewer_id: None,
            gates_digest: None,
        };
        let binding = crate::merge_intent::MissionMergeBinding {
            intent_id: intent.intent_id.clone(),
            activation_id: activation.activation_id.clone(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            tested_evidence_id: second.evidence_id.clone(),
            review_id: review.review_id.clone(),
            reviewer_independence_digest: review.reviewer_independence.digest.clone(),
            source_oid: second.tested_oid.clone(),
            target_oid: activation.accepted_base_oid.clone(),
            created_at_unix_ms: 202,
        };
        db.with(|database| {
            crate::persistence::MergeRepo::insert_or_get(database, &intent)?;
            crate::persistence::MergeRepo::insert_mission_binding(database, &binding)?;
            crate::persistence::MergeRepo::set_state(
                database,
                &intent.intent_id,
                crate::merge_intent::MergeIntentState::Merged,
                203,
            )?;
            crate::persistence::MergeRepo::insert_mission_receipt(
                database,
                &crate::merge_intent::MissionMergeReceipt {
                    receipt_id: "0197c000-0000-7000-8000-000000000024".into(),
                    intent_id: intent.intent_id.clone(),
                    integrated_oid: second.tested_oid.clone(),
                    merge_result: "merged_exact_oid".into(),
                    created_at_unix_ms: 204,
                },
            )?;
            Ok(())
        })
        .unwrap();
        let loaded = db
            .with(|database| {
                crate::persistence::MergeRepo::mission_receipt(database, &intent.intent_id)
            })
            .unwrap()
            .unwrap();
        assert_eq!(loaded.integrated_oid, second.tested_oid);

        manager
            .transition(&activation.task_id, TaskStatus::Running)
            .unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Review)
            .unwrap();
        let observed_git_fingerprint = "9".repeat(64);
        let expected = db
            .try_with(|database| {
                TaskRepo::settlement_expected_version(
                    database,
                    &activation.activation_id,
                    &observed_git_fingerprint,
                )
            })
            .unwrap();
        let acceptance_coverage = preview
            .mission_definition
            .acceptance
            .iter()
            .map(|clause| AcceptanceCoverageEntry {
                clause_id: clause.clause_id.clone(),
                required_gate_ids: clause.required_gate_ids.clone(),
                evidence_ids: vec![second.evidence_id.clone()],
                accepted: true,
            })
            .collect::<Vec<_>>();
        let mut work_packet = CompletedWorkPacket {
            schema: COMPLETED_WORK_PACKET_SCHEMA.into(),
            packet_id: "0197c000-0000-7000-8000-000000000030".into(),
            activation_id: activation.activation_id.clone(),
            plan_id: activation.plan_id.clone(),
            plan_revision: 1,
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: expected.clone(),
            settlement_generation: 1,
            supersedes_packet_id: None,
            observed_git_fingerprint: observed_git_fingerprint.clone(),
            base_oid: activation.accepted_base_oid.clone(),
            tested_oid: second.tested_oid.clone(),
            reviewed_oid: review.reviewed_oid.clone(),
            integrated_oid: loaded.integrated_oid.clone(),
            owned_paths: activation.owned_targets.clone(),
            owned_diff_digest: "d".repeat(64),
            gate_evidence_id: second.evidence_id.clone(),
            gate_evidence_digest: second.evidence_digest.clone(),
            review_id: review.review_id.clone(),
            review_digest: review.review_digest.clone(),
            reviewer_principal_id: review.reviewer_independence.reviewer_principal_id.clone(),
            reviewer_independence: review.reviewer_independence.clone(),
            merge_intent_id: intent.intent_id.clone(),
            merge_receipt_id: loaded.receipt_id.clone(),
            merge_result: loaded.merge_result.clone(),
            acceptance_coverage: acceptance_coverage.clone(),
            repo_blockers: vec![],
            policy_blockers: vec![],
            operator_blockers: vec![],
            external_blockers: vec![],
            created_at_unix_ms: 205,
            packet_digest: String::new(),
        }
        .seal()
        .unwrap();
        let mut mission_packet = MissionCompletionPacket {
            schema: MISSION_COMPLETION_PACKET_SCHEMA.into(),
            packet_id: "0197c000-0000-7000-8000-000000000031".into(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            required_work_unit_packet_ids_by_work_unit: [(
                activation.work_unit_id.clone(),
                work_packet.packet_id.clone(),
            )]
            .into_iter()
            .collect(),
            mission_acceptance_coverage: acceptance_coverage.clone(),
            final_head_oid: loaded.integrated_oid.clone(),
            integrated_oid: loaded.integrated_oid.clone(),
            contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: expected.clone(),
            settlement_generation: 1,
            observed_git_fingerprint: observed_git_fingerprint.clone(),
            merge_result: loaded.merge_result.clone(),
            repo_blockers: vec![],
            policy_blockers: vec![],
            operator_blockers: vec![],
            external_blockers: vec![],
            created_at_unix_ms: 205,
            packet_digest: String::new(),
        }
        .seal()
        .unwrap();
        let mut staging = manager.read(Clone::clone);
        staging
            .transition(&activation.task_id, TaskStatus::Done)
            .unwrap();

        let mut tampered = work_packet.clone();
        tampered.gate_evidence_digest = "0".repeat(64);
        assert!(tampered.validate().is_err());
        let mut duplicate_coverage = work_packet.clone();
        duplicate_coverage
            .acceptance_coverage
            .push(duplicate_coverage.acceptance_coverage[0].clone());
        assert!(duplicate_coverage.seal().is_err());
        let mut self_review = work_packet.clone();
        self_review.reviewer_independence.builder_principal_id = self_review
            .reviewer_independence
            .reviewer_principal_id
            .clone();
        assert!(self_review.seal().is_err());
        let mut coverage_gap = mission_packet.clone();
        coverage_gap
            .required_work_unit_packet_ids_by_work_unit
            .clear();
        assert!(coverage_gap.seal().is_err());
        let mut reused_child_packet = mission_packet.clone();
        reused_child_packet
            .required_work_unit_packet_ids_by_work_unit
            .insert(
                "0197c000-0000-7000-8000-000000000099".into(),
                work_packet.packet_id.clone(),
            );
        assert!(reused_child_packet.seal().is_err());

        assert!(matches!(
            db.try_with(|database| TaskRepo::persist_completed_settlement(
                database,
                &manager.read(Clone::clone),
                &work_packet,
                &mission_packet,
                || Ok(observed_git_fingerprint.clone()),
            )),
            Err(MissionPlanError::Validation(message)) if message.contains("Done task projection")
        ));

        db.with(|database| {
            database
                .conn()
                .execute(
                    "UPDATE tasks SET status='running' WHERE id=?1",
                    [&activation.task_id],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        assert!(
            matches!(db.try_with(|database| TaskRepo::persist_completed_settlement(database,&staging,&work_packet,&mission_packet, || Ok(observed_git_fingerprint.clone()))),
            Err(MissionPlanError::ContentConflict(message)) if message.contains("compare-and-swap"))
        );
        db.with(|database| {
            database
                .conn()
                .execute(
                    "UPDATE tasks SET status='review' WHERE id=?1",
                    [&activation.task_id],
                )
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        db.with(|database| database.conn().execute_batch(
            "CREATE TRIGGER test_deny_a7_4_done BEFORE UPDATE OF status ON tasks WHEN NEW.status='done'
             BEGIN SELECT RAISE(ABORT, 'injected settlement projection failure'); END;")
            .map_err(|error| error.to_string())).unwrap();
        assert!(db
            .try_with(|database| TaskRepo::persist_completed_settlement(
                database,
                &staging,
                &work_packet,
                &mission_packet,
                || Ok(observed_git_fingerprint.clone()),
            ))
            .is_err());
        let rolled_back: i64 = db
            .with(|database| {
                database
                    .conn()
                    .query_row(
                        "SELECT COUNT(*) FROM mission_settlement_packets",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(rolled_back, 0);
        db.with(|database| {
            database
                .conn()
                .execute_batch("DROP TRIGGER test_deny_a7_4_done")
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let mutation_root = activation.repository_root.clone();
        let mutation_target = activation.target_branch.clone();
        let mutation_oid = activation.accepted_base_oid.clone();
        let git_drift = db.try_with(|database| {
            TaskRepo::persist_completed_settlement(
                database,
                &staging,
                &work_packet,
                &mission_packet,
                || {
                    let repository = git2::Repository::open(&mutation_root).map_err(|error| {
                        MissionPlanError::Persistence(format!("open mutation repository: {error}"))
                    })?;
                    let oid = mutation_oid.parse::<git2::Oid>().map_err(|error| {
                        MissionPlanError::Persistence(format!("parse mutation OID: {error}"))
                    })?;
                    repository
                        .reference(
                            &format!("refs/heads/{mutation_target}"),
                            oid,
                            true,
                            "A7.4 linearization mutation test",
                        )
                        .map_err(|error| {
                            MissionPlanError::Persistence(format!("move mutation target: {error}"))
                        })?;
                    Ok("8".repeat(64))
                },
            )
        });
        assert!(matches!(
            git_drift,
            Err(MissionPlanError::ContentConflict(message))
                if message.contains("linearization point")
        ));
        let after_git_drift: (i64, String) = db
            .with(|database| {
                database
                    .conn()
                    .query_row(
                        "SELECT (SELECT COUNT(*) FROM mission_settlement_packets),status
                           FROM tasks WHERE id=?1",
                        [&activation.task_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        assert_eq!(after_git_drift, (0, "review".into()));
        let blocked = blocked_packet(
            &preview,
            &activation,
            &expected,
            1,
            None,
            &observed_git_fingerprint,
            Some(&second),
            Some(&review),
            Some(&binding),
            acceptance_coverage.clone(),
            vec![settlement_repo_blocker(
                "repair-required",
                "REPAIR_REQUIRED",
                "independent repair requires a new settlement generation",
            )],
            205,
        )
        .unwrap()
        .seal()
        .unwrap();
        let mut blocked_staging = manager.read(Clone::clone);
        blocked_staging
            .transition(&activation.task_id, TaskStatus::Blocked)
            .unwrap();
        db.try_with(|database| {
            TaskRepo::persist_blocked_settlement(database, &blocked_staging, &blocked, || {
                Ok(observed_git_fingerprint.clone())
            })
        })
        .unwrap();
        let repaired_expected = db
            .try_with(|database| {
                TaskRepo::settlement_expected_version(
                    database,
                    &activation.activation_id,
                    &observed_git_fingerprint,
                )
            })
            .unwrap();
        work_packet.settlement_expected_version = repaired_expected.clone();
        work_packet.settlement_generation = 2;
        work_packet.supersedes_packet_id = Some(blocked.packet_id.clone());
        work_packet = work_packet.seal().unwrap();
        mission_packet.settlement_expected_version = repaired_expected;
        mission_packet.settlement_generation = 2;
        mission_packet.observed_git_fingerprint = observed_git_fingerprint.clone();
        mission_packet = mission_packet.seal().unwrap();

        let mut competing_work_packet = work_packet.clone();
        competing_work_packet.packet_id = "0197c000-0000-7000-8000-000000000032".into();
        competing_work_packet = competing_work_packet.seal().unwrap();
        let mut competing_mission_packet = mission_packet.clone();
        competing_mission_packet.packet_id = "0197c000-0000-7000-8000-000000000033".into();
        competing_mission_packet
            .required_work_unit_packet_ids_by_work_unit
            .insert(
                activation.task_id.clone(),
                competing_work_packet.packet_id.clone(),
            );
        competing_mission_packet = competing_mission_packet.seal().unwrap();

        let left_database = crate::db::Database::open(&db_path).unwrap();
        let right_database = crate::db::Database::open(&db_path).unwrap();
        let race_barrier = Arc::new(std::sync::Barrier::new(3));
        let left_barrier = race_barrier.clone();
        let left_graph = staging.clone();
        let left_work = work_packet.clone();
        let left_mission = mission_packet.clone();
        let left_fingerprint = observed_git_fingerprint.clone();
        let left = std::thread::spawn(move || {
            left_barrier.wait();
            let result = TaskRepo::persist_completed_settlement(
                &left_database,
                &left_graph,
                &left_work,
                &left_mission,
                || Ok(left_fingerprint.clone()),
            );
            (result, left_work, left_mission)
        });
        let right_barrier = race_barrier.clone();
        let right_graph = staging.clone();
        let right_work = competing_work_packet;
        let right_mission = competing_mission_packet;
        let right_fingerprint = observed_git_fingerprint.clone();
        let right = std::thread::spawn(move || {
            right_barrier.wait();
            let result = TaskRepo::persist_completed_settlement(
                &right_database,
                &right_graph,
                &right_work,
                &right_mission,
                || Ok(right_fingerprint.clone()),
            );
            (result, right_work, right_mission)
        });
        race_barrier.wait();
        let race_results = [left.join().unwrap(), right.join().unwrap()];
        assert_eq!(
            race_results
                .iter()
                .filter(|(result, _, _)| result.is_ok())
                .count(),
            1,
            "exactly one concurrent successor may claim a blocked predecessor"
        );
        assert!(race_results
            .iter()
            .any(|(result, _, _)| { matches!(result, Err(MissionPlanError::ContentConflict(_))) }));
        let (_, winning_work_packet, winning_mission_packet) = race_results
            .into_iter()
            .find(|(result, _, _)| result.is_ok())
            .unwrap();
        work_packet = winning_work_packet;
        mission_packet = winning_mission_packet;

        db.try_with(|database| {
            TaskRepo::persist_completed_settlement(
                database,
                &staging,
                &work_packet,
                &mission_packet,
                || Ok(observed_git_fingerprint.clone()),
            )
        })
        .unwrap();
        let settled = db
            .try_with(|database| {
                TaskRepo::load_completed_settlement(database, &activation.activation_id)
            })
            .unwrap()
            .unwrap();
        assert_eq!(settled, (work_packet.clone(), mission_packet.clone()));
        let history: Vec<(String, i64, Option<String>)> = db
            .with(|database| {
                let mut statement = database
                    .conn()
                    .prepare(
                        "SELECT packet_kind,settlement_generation,supersedes_packet_id
                           FROM mission_settlement_packets WHERE activation_id=?1
                           ORDER BY settlement_generation,packet_kind",
                    )
                    .map_err(|error| error.to_string())?;
                let rows = statement
                    .query_map([&activation.activation_id], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .map_err(|error| error.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|error| error.to_string())?;
                Ok(rows)
            })
            .unwrap();
        assert_eq!(history.len(), 3);
        assert!(history.iter().any(|(kind, generation, supersedes)| {
            kind == "blocked_work" && *generation == 1 && supersedes.is_none()
        }));
        assert!(history.iter().any(|(kind, generation, supersedes)| {
            kind == "completed_work"
                && *generation == 2
                && supersedes.as_deref() == Some(blocked.packet_id.as_str())
        }));
        let still_current = db
            .try_with(|database| {
                TaskRepo::load_completed_settlement(database, &activation.activation_id)
            })
            .unwrap()
            .unwrap();
        assert_eq!(still_current, (work_packet.clone(), mission_packet.clone()));
        assert!(matches!(
            manager.settle_mission_plan(&plan_id, 1),
            Err(MissionPlanError::ContentConflict(message)) if message.contains("task projection disagree")
        ));
    }

    #[test]
    fn a7_2_activation_rejects_unrelated_live_graph_authority() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let manager = TaskManager::new_durable();
        manager.attach_db(mem_db()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        manager.create(Task::new("unrelated", "Unrelated")).unwrap();

        assert!(matches!(
            manager.activate_mission_plan(&plan_id, 1),
            Err(MissionPlanError::ContentConflict(message)) if message.contains("otherwise empty")
        ));
        assert!(manager
            .get(crate::task::mission::A7_FIXTURE_WORK_UNIT_ID)
            .is_none());
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

    #[test]
    fn a7_4_blocker_authority_is_closed_over_the_accepted_plan() {
        let (_repository, repo_path, input) = a7_repo_input();
        let manager = TaskManager::new_durable();
        manager.attach_db(mem_db()).unwrap();
        let mut preview = manager.preview_mission_plan(input, &repo_path).unwrap();
        assert!(derive_declared_authority_blockers(&preview).is_empty());

        preview.work_units[0].required_capability_templates.push(
            crate::task::mission::CapabilityTemplate {
                capability_template_id: "operator-approval".into(),
                version: "1".into(),
                action: "approve".into(),
                scope_kinds: vec!["mission".into()],
                one_use_required: true,
                approval_policy_id: "operator-policy/v1".into(),
            },
        );
        preview.work_units[0]
            .required_artifacts
            .push(crate::task::mission::ArtifactRequirement {
                artifact_id: "hosted-proof".into(),
                kind: "external-proof".into(),
                locator_policy_id: "external-artifact/v1".into(),
                digest_algorithm: "sha256".into(),
                freshness_policy: preview.expected_tests[0].freshness_policy.clone(),
            });
        let blockers = derive_declared_authority_blockers(&preview);
        assert!(blockers.iter().any(|blocker| {
            blocker.kind == SettlementBlockerKind::Operator
                && blocker.code == "OPERATOR_AUTHORITY_UNAVAILABLE"
        }));
        assert!(blockers.iter().any(|blocker| {
            blocker.kind == SettlementBlockerKind::External
                && blocker.code == "EXTERNAL_AUTHORITY_UNAVAILABLE"
        }));
        assert!(blockers.iter().all(|blocker| {
            blocker.command_argv.is_empty()
                && blocker
                    .next_action
                    .input_refs
                    .iter()
                    .all(|reference| !reference.contains(' ') && !reference.contains('\n'))
        }));
    }

    #[test]
    fn a7_4_receipt_only_recovery_and_populated_v10_packets_reach_current_validation() {
        let (repository_directory, repo_path, input) = a7_repo_input();
        let repository = git2::Repository::open(repository_directory.path()).unwrap();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        let activation = manager.activate_mission_plan(&plan_id, 1).unwrap();

        let base = activation.accepted_base_oid.parse::<git2::Oid>().unwrap();
        repository
            .branch(
                &activation.source_branch,
                &repository.find_commit(base).unwrap(),
                false,
            )
            .unwrap();
        crate::git::create_worktree(&repo_path, &activation.source_branch).unwrap();
        let candidate_worktree =
            crate::git::predict_worktree_path(&repo_path, &activation.source_branch);
        let owned_path = candidate_worktree.join(&activation.owned_targets[0]);
        std::fs::create_dir_all(owned_path.parent().unwrap()).unwrap();
        std::fs::write(&owned_path, "pub fn stable_order_fixture() {}\n").unwrap();
        let candidate_repository = git2::Repository::open(&candidate_worktree).unwrap();
        let mut index = candidate_repository.index().unwrap();
        index
            .add_path(std::path::Path::new(&activation.owned_targets[0]))
            .unwrap();
        index.write().unwrap();
        let candidate_oid = commit_a7_test_repo(&candidate_worktree);
        crate::git::ensure_isolated_branch_at_oid(
            &repo_path,
            &activation.target_branch,
            &candidate_oid,
        )
        .unwrap();
        let snapshot = crate::git::inspect_exact_owned_candidate(
            &repo_path,
            &activation.source_branch,
            &activation.accepted_base_oid,
            &candidate_oid,
            &activation.owned_targets,
            256 * 1024,
        )
        .unwrap();

        let attempt = manager
            .reserve_execution(ExecutionReservation {
                task_id: activation.task_id.clone(),
                repo_path: activation.repository_root.clone(),
                runtime: crate::task::ExecutionRuntime::VisiblePty,
                ownership_claim_ids: vec!["claim-a7-receipt-recovery".into()],
                now: 10,
            })
            .unwrap();
        let mut effect_now = 11;
        manager
            .commit_execution_reservation(&attempt.token(), effect_now)
            .unwrap();
        for effect in [ExecutionEffect::FirstEffect, ExecutionEffect::Spawn] {
            commit_effect(&manager, &attempt, effect, &mut effect_now);
        }
        effect_now += 1;
        manager
            .reserve_execution_effect(&attempt.token(), ExecutionEffect::Review, None, effect_now)
            .unwrap();
        let current = manager.current_execution(&activation.task_id).unwrap();
        let wall_now = decision_unix_ms().unwrap();
        let merge_now = i64::try_from(wall_now).unwrap();
        let evidence = MissionGateEvidence {
            schema: "aelyris.mission_gate_evidence/v1".into(),
            evidence_id: "0197c000-0000-7000-8000-000000000040".into(),
            activation_id: activation.activation_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            attempt_id: current.identity.attempt_id.clone(),
            execution_generation: current.identity.execution_generation,
            agent_run_id: current.identity.agent_run_id.clone(),
            runtime_domain_id: "visible_pty".into(),
            pty_session_id: current.identity.pty_session_id.clone().unwrap(),
            gate_id: crate::task::A7_FIXTURE_GATE_ID.into(),
            contract_version: "1".into(),
            command_argv: activation.test_argv.clone(),
            command_fingerprint: "1".repeat(64),
            environment_fingerprint: "2".repeat(64),
            result: "passed".into(),
            evidence_digest: "3".repeat(64),
            base_oid: activation.accepted_base_oid.clone(),
            candidate_oid: candidate_oid.clone(),
            tested_oid: candidate_oid.clone(),
            started_at_unix_ms: wall_now - 1_001,
            ended_at_unix_ms: wall_now - 1_000,
        };
        manager
            .persist_mission_gate_evidence(&activation, &evidence)
            .unwrap();
        let preview = manager.mission_plan(&plan_id, 1).unwrap();
        let builder =
            crate::review::mission::builder_runtime_attestation(&evidence, "codex-no-hooks")
                .unwrap();
        let model = serde_json::json!({
            "clauseCoverage": preview.mission_definition.acceptance.iter().map(|clause| {
                serde_json::json!({
                    "clauseId": clause.clause_id,
                    "accepted": true,
                    "reason": "exact receipt recovery fixture"
                })
            }).collect::<Vec<_>>(),
            "findings": []
        })
        .to_string();
        let invocation = crate::review::ReviewerInvocation::test_only(&model);
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_reviewer_invocation_receipt(
                database,
                invocation.receipt(),
            )
            .map(|_| ())
        })
        .unwrap();
        let review = crate::review::review_exact_candidate(
            &preview,
            &activation,
            &evidence,
            &snapshot.changed_paths,
            &snapshot.diff,
            wall_now - 500,
            &builder,
            false,
            &invocation,
        )
        .unwrap();
        db.with(|database| {
            crate::persistence::ReviewRepo::insert_mission_review(database, &review).map(|_| ())
        })
        .unwrap();
        let intent = crate::merge_intent::MergeIntent {
            intent_id: "merge-a7-4-receipt-recovery".into(),
            repo_path: activation.repository_root.clone(),
            source_branch: activation.source_branch.clone(),
            target_branch: activation.target_branch.clone(),
            source_oid: candidate_oid.clone(),
            target_oid: activation.accepted_base_oid.clone(),
            merge_base_oid: Some(activation.accepted_base_oid.clone()),
            task_id: activation.work_unit_id.clone(),
            created_at: merge_now - 400,
            state: crate::merge_intent::MergeIntentState::Queued,
            updated_at: merge_now - 400,
            session_id: Some(
                review
                    .reviewer_independence
                    .reviewer_logical_session_id
                    .clone(),
            ),
            reviewer_id: None,
            gates_digest: None,
        };
        let binding = crate::merge_intent::MissionMergeBinding {
            intent_id: intent.intent_id.clone(),
            activation_id: activation.activation_id.clone(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            tested_evidence_id: evidence.evidence_id.clone(),
            review_id: review.review_id.clone(),
            reviewer_independence_digest: review.reviewer_independence.digest.clone(),
            source_oid: candidate_oid.clone(),
            target_oid: activation.accepted_base_oid.clone(),
            created_at_unix_ms: wall_now - 400,
        };
        db.with(|database| {
            crate::persistence::MergeRepo::insert_or_get(database, &intent)?;
            crate::persistence::MergeRepo::insert_mission_binding(database, &binding)?;
            crate::persistence::MergeRepo::set_state(
                database,
                &intent.intent_id,
                crate::merge_intent::MergeIntentState::Merged,
                merge_now - 300,
            )?;
            Ok(())
        })
        .unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Running)
            .unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Review)
            .unwrap();

        let first = manager.settle_mission_plan(&plan_id, 1).unwrap();
        let MissionSettlementOutcome::Blocked { blocked_packet } = first else {
            panic!("missing receipt must create a durable Blocked generation")
        };
        assert!(blocked_packet
            .repo_blockers
            .iter()
            .any(|blocker| blocker.code == "MISSING_MERGE_RECEIPT"));
        assert!(!blocked_packet
            .repo_blockers
            .iter()
            .any(|blocker| blocker.code == "TASK_NOT_REVIEW"));

        db.with(|database| {
            crate::persistence::MergeRepo::insert_mission_receipt(
                database,
                &crate::merge_intent::MissionMergeReceipt {
                    receipt_id: "0197c000-0000-7000-8000-000000000041".into(),
                    intent_id: intent.intent_id.clone(),
                    integrated_oid: candidate_oid.clone(),
                    merge_result: "merged_exact_oid".into(),
                    created_at_unix_ms: wall_now - 200,
                },
            )
            .map(|_| ())
        })
        .unwrap();
        let second = manager.settle_mission_plan(&plan_id, 1).unwrap();
        let MissionSettlementOutcome::Completed {
            mut work_packet,
            mut mission_packet,
        } = second
        else {
            panic!("the exact receipt alone must recover through the public settlement owner")
        };
        assert_eq!(work_packet.settlement_generation, 2);
        assert_eq!(
            work_packet.supersedes_packet_id.as_deref(),
            Some(blocked_packet.packet_id.as_str())
        );
        assert_eq!(
            manager.get(&activation.task_id).unwrap().status,
            TaskStatus::Done
        );

        work_packet.settlement_generation = 1;
        work_packet.supersedes_packet_id = None;
        work_packet = work_packet.seal().unwrap();
        mission_packet.settlement_generation = 1;
        mission_packet = mission_packet.seal().unwrap();
        let (legacy_work_json, legacy_work_digest) = legacy_v10_packet_json(&work_packet);
        let (legacy_mission_json, legacy_mission_digest) = legacy_v10_packet_json(&mission_packet);
        migrate_v10_settlement_rows(
            &db,
            &activation,
            &[
                (
                    work_packet.packet_id.as_str(),
                    Some(work_packet.work_unit_id.as_str()),
                    "completed_work",
                    work_packet.settlement_expected_version.as_str(),
                    legacy_work_json.as_str(),
                    legacy_work_digest.as_str(),
                    work_packet.created_at_unix_ms,
                ),
                (
                    mission_packet.packet_id.as_str(),
                    None,
                    "mission_completion",
                    mission_packet.settlement_expected_version.as_str(),
                    legacy_mission_json.as_str(),
                    legacy_mission_digest.as_str(),
                    mission_packet.created_at_unix_ms,
                ),
            ],
        );
        let migrated_completion = db
            .try_with(|database| {
                TaskRepo::load_completed_settlement(database, &activation.activation_id)
            })
            .unwrap()
            .unwrap();
        assert_eq!(migrated_completion.0.packet_digest, legacy_work_digest);
        assert_eq!(migrated_completion.1.packet_digest, legacy_mission_digest);

        let (legacy_blocked_json, legacy_blocked_digest) = legacy_v10_packet_json(&blocked_packet);
        migrate_v10_settlement_rows(
            &db,
            &activation,
            &[((
                blocked_packet.packet_id.as_str(),
                Some(blocked_packet.work_unit_id.as_str()),
                "blocked_work",
                blocked_packet.settlement_expected_version.as_str(),
                legacy_blocked_json.as_str(),
                legacy_blocked_digest.as_str(),
                blocked_packet.created_at_unix_ms,
            ))],
        );
        let migrated_blocked = db
            .try_with(|database| {
                TaskRepo::load_blocked_settlement(database, &activation.activation_id)
            })
            .unwrap()
            .unwrap();
        assert_eq!(migrated_blocked.packet_digest, legacy_blocked_digest);
        assert_eq!(migrated_blocked.settlement_generation, 1);
        assert_eq!(migrated_blocked.observed_git_fingerprint, "0".repeat(64));

        let (forged_work_json, forged_work_digest) = v10_shape_packet_json(&work_packet);
        assert_eq!(forged_work_digest, work_packet.packet_digest);
        migrate_v10_settlement_rows(
            &db,
            &activation,
            &[
                (
                    work_packet.packet_id.as_str(),
                    Some(work_packet.work_unit_id.as_str()),
                    "completed_work",
                    work_packet.settlement_expected_version.as_str(),
                    forged_work_json.as_str(),
                    forged_work_digest.as_str(),
                    work_packet.created_at_unix_ms,
                ),
                (
                    mission_packet.packet_id.as_str(),
                    None,
                    "mission_completion",
                    mission_packet.settlement_expected_version.as_str(),
                    legacy_mission_json.as_str(),
                    legacy_mission_digest.as_str(),
                    mission_packet.created_at_unix_ms,
                ),
            ],
        );
        let forged_work_error = db
            .try_with(|database| {
                TaskRepo::load_completed_settlement(database, &activation.activation_id)
            })
            .unwrap_err();
        assert!(matches!(
            forged_work_error,
            MissionPlanError::ContentConflict(_) | MissionPlanError::Validation(_)
        ));

        let (forged_mission_json, forged_mission_digest) = v10_shape_packet_json(&mission_packet);
        assert_eq!(forged_mission_digest, mission_packet.packet_digest);
        migrate_v10_settlement_rows(
            &db,
            &activation,
            &[
                (
                    work_packet.packet_id.as_str(),
                    Some(work_packet.work_unit_id.as_str()),
                    "completed_work",
                    work_packet.settlement_expected_version.as_str(),
                    legacy_work_json.as_str(),
                    legacy_work_digest.as_str(),
                    work_packet.created_at_unix_ms,
                ),
                (
                    mission_packet.packet_id.as_str(),
                    None,
                    "mission_completion",
                    mission_packet.settlement_expected_version.as_str(),
                    forged_mission_json.as_str(),
                    forged_mission_digest.as_str(),
                    mission_packet.created_at_unix_ms,
                ),
            ],
        );
        let forged_mission_error = db
            .try_with(|database| {
                TaskRepo::load_completed_settlement(database, &activation.activation_id)
            })
            .unwrap_err();
        assert!(matches!(
            forged_mission_error,
            MissionPlanError::ContentConflict(_) | MissionPlanError::Validation(_)
        ));

        let (forged_blocked_json, forged_blocked_digest) = v10_shape_packet_json(&blocked_packet);
        assert_eq!(forged_blocked_digest, blocked_packet.packet_digest);
        migrate_v10_settlement_rows(
            &db,
            &activation,
            &[((
                blocked_packet.packet_id.as_str(),
                Some(blocked_packet.work_unit_id.as_str()),
                "blocked_work",
                blocked_packet.settlement_expected_version.as_str(),
                forged_blocked_json.as_str(),
                forged_blocked_digest.as_str(),
                blocked_packet.created_at_unix_ms,
            ))],
        );
        let forged_blocked_error = db
            .try_with(|database| {
                TaskRepo::load_blocked_settlement(database, &activation.activation_id)
            })
            .unwrap_err();
        assert!(matches!(
            forged_blocked_error,
            MissionPlanError::ContentConflict(_) | MissionPlanError::Validation(_)
        ));
    }

    #[test]
    fn a7_4_missing_lineage_atomically_persists_zero_credit_blocked_packet() {
        let (_repository, repo_path, input) = a7_repo_input();
        let actor = input.mission_definition.created_by.clone();
        let plan_id = input.plan_id.clone();
        let db = mem_db();
        let manager = TaskManager::new_durable();
        manager.attach_db(db.clone()).unwrap();
        manager.preview_mission_plan(input, &repo_path).unwrap();
        manager.accept_mission_plan(&plan_id, 1, &actor).unwrap();
        let activation = manager.activate_mission_plan(&plan_id, 1).unwrap();
        manager
            .transition(&activation.task_id, TaskStatus::Running)
            .unwrap();

        let first = manager.settle_mission_plan(&plan_id, 1).unwrap();
        let MissionSettlementOutcome::Blocked { blocked_packet } = first else {
            panic!("missing exact lineage must fail closed")
        };
        assert_eq!(blocked_packet.completion_credit, 0);
        assert!(!blocked_packet.repo_blockers.is_empty());
        assert_eq!(
            manager.get(&activation.task_id).unwrap().status,
            TaskStatus::Blocked
        );
        let counts = db.with(|database| database.conn().query_row(
            "SELECT COUNT(*),SUM(packet_kind='mission_completion') FROM mission_settlement_packets WHERE activation_id=?1",
            [&activation.activation_id], |row| Ok((row.get::<_, i64>(0)?,row.get::<_, i64>(1)?)))
            .map_err(|error| error.to_string())).unwrap();
        assert_eq!(counts, (1, 0));

        let retry = manager.settle_mission_plan(&plan_id, 1).unwrap();
        assert_eq!(retry, MissionSettlementOutcome::Blocked { blocked_packet });
        manager
            .transition(&activation.task_id, TaskStatus::Running)
            .unwrap();
        assert!(matches!(
            manager.settle_mission_plan(&plan_id, 1),
            Err(MissionPlanError::ContentConflict(message)) if message.contains("task projection disagree")
        ));
    }
}
