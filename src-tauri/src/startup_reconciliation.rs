use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use crate::db::ManagedDb;
use crate::event_bus::AgentEventKind;
use crate::merge_intent::store::MergeIntentStore;
use crate::merge_intent::MergeIntentState;
use crate::persistence::{EventRepo, OwnershipRepo};
use crate::task::{
    ExecutionEffect, ExecutionFenceState, ExecutionIdentity, TaskManager, WorkExecutionAttempt,
    WorkExecutionState,
};

pub const STARTUP_RECONCILIATION_TIMEOUT_SECS: u64 = 15;
pub const REQUIRED_STARTUP_AUTHORITIES: [&str; 7] = [
    "task_graph",
    "execution_attempts",
    "pane_pty_generations",
    "ownership",
    "worktrees_merge_intents",
    "leases",
    "event_bus",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupReconciliationPhase {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartupAuthorityStatus {
    Reconciled,
    Quarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupAuthorityReport {
    pub authority: String,
    pub status: StartupAuthorityStatus,
    pub observed: usize,
    pub reconciled: usize,
    pub quarantined: usize,
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct StartupRuntimeSnapshot {
    pub headless_execution_identities: Vec<ExecutionIdentity>,
    pub pane_execution_identities: Vec<ExecutionIdentity>,
    pub wired_terminal_ids: HashSet<String>,
    pub terminal_generations: HashMap<String, u64>,
}

impl StartupAuthorityReport {
    pub fn reconciled(authority: &str, observed: usize, reconciled: usize) -> Self {
        Self {
            authority: authority.to_string(),
            status: StartupAuthorityStatus::Reconciled,
            observed,
            reconciled,
            quarantined: 0,
            details: Vec::new(),
        }
    }

    pub fn quarantined(
        authority: &str,
        observed: usize,
        reconciled: usize,
        details: Vec<String>,
    ) -> Self {
        Self {
            authority: authority.to_string(),
            status: StartupAuthorityStatus::Quarantined,
            observed,
            reconciled,
            quarantined: details.len(),
            details,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReconciliationReport {
    pub phase: StartupReconciliationPhase,
    pub database_ready: bool,
    pub sidecar_connected: bool,
    pub terminal_reconciliation_complete: bool,
    pub adopted_terminals: usize,
    pub restored_sessions: usize,
    pub reconciled_handoffs: usize,
    pub authorities: Vec<StartupAuthorityReport>,
    pub quarantined_total: usize,
    pub completed_at_ms: Option<u64>,
    pub failure_stage: Option<String>,
    pub failure_reason: Option<String>,
}

impl Default for StartupReconciliationReport {
    fn default() -> Self {
        Self {
            phase: StartupReconciliationPhase::Pending,
            database_ready: false,
            sidecar_connected: false,
            terminal_reconciliation_complete: false,
            adopted_terminals: 0,
            restored_sessions: 0,
            reconciled_handoffs: 0,
            authorities: Vec::new(),
            quarantined_total: 0,
            completed_at_ms: None,
            failure_stage: None,
            failure_reason: None,
        }
    }
}

#[derive(Debug, Default)]
pub struct StartupReconciliationState {
    report: Mutex<StartupReconciliationReport>,
    /// Serializes an admitted effect from its final readiness check through the
    /// actual process creation boundary against a new remote Begin transition.
    /// This closes the Ready-check/Begin/spawn race without adding another
    /// readiness owner.
    admission_transition: Mutex<()>,
    /// When this state mirrors the host decision inside the long-lived PTY
    /// sidecar, only the host connection that opened the current epoch may
    /// publish the terminal decision. This is part of the existing admission
    /// owner, not a second readiness state.
    remote_admission_epoch: Mutex<Option<String>>,
}

impl StartupReconciliationState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> Result<StartupReconciliationReport, String> {
        self.report
            .lock()
            .map(|report| report.clone())
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())
    }

    pub fn begin_remote_admission(&self, epoch: &str) -> Result<(), String> {
        validate_admission_epoch(epoch)?;
        let _transition = self
            .admission_transition
            .lock()
            .map_err(|_| "startup admission transition lock poisoned".to_string())?;
        let mut current_epoch = self
            .remote_admission_epoch
            .lock()
            .map_err(|_| "startup reconciliation epoch lock poisoned".to_string())?;
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        *current_epoch = Some(epoch.to_string());
        *report = StartupReconciliationReport::default();
        Ok(())
    }

    pub fn apply_remote_admission(
        &self,
        epoch: &str,
        decision: StartupReconciliationReport,
    ) -> Result<(), String> {
        validate_admission_epoch(epoch)?;
        validate_remote_decision(&decision)?;
        let _transition = self
            .admission_transition
            .lock()
            .map_err(|_| "startup admission transition lock poisoned".to_string())?;
        let current_epoch = self
            .remote_admission_epoch
            .lock()
            .map_err(|_| "startup reconciliation epoch lock poisoned".to_string())?;
        if current_epoch.as_deref() != Some(epoch) {
            return Err("stale startup admission epoch".to_string());
        }
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        *report = decision;
        Ok(())
    }

    pub fn mark_database_ready(&self) -> Result<(), String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase == StartupReconciliationPhase::Pending {
            report.database_ready = true;
            Self::try_mark_ready(&mut report);
        }
        Ok(())
    }

    pub fn record_authority(&self, authority: StartupAuthorityReport) -> Result<bool, String> {
        if !REQUIRED_STARTUP_AUTHORITIES.contains(&authority.authority.as_str()) {
            return Err(format!(
                "unknown startup reconciliation authority: {}",
                authority.authority
            ));
        }
        if authority.quarantined != authority.details.len() {
            return Err(format!(
                "startup authority {} quarantine count does not match its details",
                authority.authority
            ));
        }
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Ok(false);
        }
        if let Some(existing) = report
            .authorities
            .iter()
            .find(|existing| existing.authority == authority.authority)
        {
            if existing == &authority {
                return Ok(false);
            }
            return Err(format!(
                "conflicting startup reconciliation result for authority {}",
                authority.authority
            ));
        }
        report.authorities.push(authority);
        report.authorities.sort_by_key(|entry| {
            REQUIRED_STARTUP_AUTHORITIES
                .iter()
                .position(|name| *name == entry.authority)
                .unwrap_or(usize::MAX)
        });
        report.quarantined_total = report
            .authorities
            .iter()
            .map(|entry| entry.quarantined)
            .sum();
        Ok(Self::try_mark_ready(&mut report))
    }

    pub fn complete(
        &self,
        adopted_terminals: usize,
        restored_sessions: usize,
        reconciled_handoffs: usize,
    ) -> Result<bool, String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Ok(false);
        }
        apply_completion(
            &mut report,
            adopted_terminals,
            restored_sessions,
            reconciled_handoffs,
        )?;
        Ok(report.phase == StartupReconciliationPhase::Ready)
    }

    pub fn preview_complete(
        &self,
        adopted_terminals: usize,
        restored_sessions: usize,
        reconciled_handoffs: usize,
    ) -> Result<StartupReconciliationReport, String> {
        let mut report = self.snapshot()?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Err("startup reconciliation decision is already terminal".to_string());
        }
        apply_completion(
            &mut report,
            adopted_terminals,
            restored_sessions,
            reconciled_handoffs,
        )?;
        if report.phase != StartupReconciliationPhase::Ready {
            return Err(
                "startup reconciliation cannot complete before every authority reports".into(),
            );
        }
        Ok(report)
    }

    pub fn fail(&self, stage: &str, reason: impl Into<String>) -> Result<bool, String> {
        let mut report = self
            .report
            .lock()
            .map_err(|_| "startup reconciliation state lock poisoned".to_string())?;
        if report.phase != StartupReconciliationPhase::Pending {
            return Ok(false);
        }
        report.phase = StartupReconciliationPhase::Failed;
        report.completed_at_ms = Some(unix_now_ms());
        report.failure_stage = Some(stage.to_string());
        report.failure_reason = Some(reason.into());
        Ok(true)
    }

    pub fn fail_if_pending(&self) -> Result<bool, String> {
        self.fail(
            "timeout",
            format!(
                "startup reconciliation exceeded {} seconds",
                STARTUP_RECONCILIATION_TIMEOUT_SECS
            ),
        )
    }

    pub fn require_spawn_admitted(&self) -> Result<(), String> {
        self.require_effect_admitted("terminal spawn")
    }

    pub fn acquire_spawn_admission(&self) -> Result<MutexGuard<'_, ()>, String> {
        let guard = self
            .admission_transition
            .lock()
            .map_err(|_| "startup admission transition lock poisoned".to_string())?;
        self.require_spawn_admitted()?;
        Ok(guard)
    }

    pub fn require_dispatch_admitted(&self) -> Result<(), String> {
        self.require_effect_admitted("orchestrator dispatch")
    }

    pub fn require_effect_admitted(&self, surface: &str) -> Result<(), String> {
        let report = self.snapshot()?;
        match report.phase {
            StartupReconciliationPhase::Ready => Ok(()),
            StartupReconciliationPhase::Pending => Err(serde_json::json!({
                "code": "startup_reconciliation_pending",
                "message": format!("{surface} is blocked until durable startup reconciliation completes"),
                "report": report,
            })
            .to_string()),
            StartupReconciliationPhase::Failed => Err(serde_json::json!({
                "code": "startup_reconciliation_failed",
                "message": format!("{surface} is blocked because durable startup reconciliation failed"),
                "report": report,
            })
            .to_string()),
        }
    }

    fn try_mark_ready(report: &mut StartupReconciliationReport) -> bool {
        if report.phase != StartupReconciliationPhase::Pending
            || !report.database_ready
            || !report.terminal_reconciliation_complete
            || !REQUIRED_STARTUP_AUTHORITIES.iter().all(|required| {
                report
                    .authorities
                    .iter()
                    .any(|entry| entry.authority == *required)
            })
        {
            return false;
        }
        report.phase = StartupReconciliationPhase::Ready;
        report.completed_at_ms = Some(unix_now_ms());
        true
    }
}

fn apply_completion(
    report: &mut StartupReconciliationReport,
    adopted_terminals: usize,
    restored_sessions: usize,
    reconciled_handoffs: usize,
) -> Result<(), String> {
    if !report.database_ready {
        return Err("startup reconciliation cannot complete before database readiness".into());
    }
    report.sidecar_connected = true;
    report.terminal_reconciliation_complete = true;
    report.adopted_terminals = adopted_terminals;
    report.restored_sessions = restored_sessions;
    report.reconciled_handoffs = reconciled_handoffs;
    StartupReconciliationState::try_mark_ready(report);
    Ok(())
}

fn validate_admission_epoch(epoch: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(epoch)
        .map_err(|_| "startup admission epoch must be a UUID".to_string())?;
    if parsed.to_string() != epoch {
        return Err("startup admission epoch must use canonical lowercase UUID form".to_string());
    }
    Ok(())
}

fn validate_remote_decision(decision: &StartupReconciliationReport) -> Result<(), String> {
    if decision.quarantined_total
        != decision
            .authorities
            .iter()
            .map(|authority| authority.quarantined)
            .sum::<usize>()
    {
        return Err("remote startup decision has an invalid quarantine total".to_string());
    }
    match decision.phase {
        StartupReconciliationPhase::Pending => {
            Err("remote startup decision must be terminal".to_string())
        }
        StartupReconciliationPhase::Ready => {
            let names = decision
                .authorities
                .iter()
                .map(|authority| authority.authority.as_str())
                .collect::<HashSet<_>>();
            if !decision.database_ready
                || !decision.sidecar_connected
                || !decision.terminal_reconciliation_complete
                || decision.completed_at_ms.is_none()
                || decision.failure_stage.is_some()
                || decision.failure_reason.is_some()
                || decision.authorities.len() != REQUIRED_STARTUP_AUTHORITIES.len()
                || !REQUIRED_STARTUP_AUTHORITIES
                    .iter()
                    .all(|required| names.contains(required))
                || decision
                    .authorities
                    .iter()
                    .any(|authority| authority.quarantined != authority.details.len())
            {
                return Err("remote startup ready decision is incomplete".to_string());
            }
            Ok(())
        }
        StartupReconciliationPhase::Failed => {
            if decision.completed_at_ms.is_none()
                || decision.failure_stage.as_deref().is_none_or(str::is_empty)
                || decision.failure_reason.as_deref().is_none_or(str::is_empty)
            {
                return Err("remote startup failed decision is incomplete".to_string());
            }
            Ok(())
        }
    }
}

/// Reconcile every non-terminal runtime authority against the durable attempt
/// owner after sidecar terminal adoption. The operation is intentionally
/// fail-closed and restart-idempotent:
///
/// - an effect that provably was not in flight may close as a failed generation;
/// - any started/contradictory/orphaned effect enters `needs_reconcile`;
/// - quarantined TaskGraph nodes are blocked, while their claims/worktrees are
///   retained as collision barriers;
/// - fully observed terminal/failed generations release stale ownership claims.
///
/// No authority is inferred from a branch or terminal id alone.
pub fn reconcile_runtime_authorities(
    tasks: &TaskManager,
    db: &ManagedDb,
    merge_store: &MergeIntentStore,
    runtime: &StartupRuntimeSnapshot,
    now: u64,
) -> Result<Vec<StartupAuthorityReport>, String> {
    let event_audit = db
        .with(|database| EventRepo::inspect_startup(database).map_err(|error| error.to_string()))?;
    let pruned_leases = db.with(|database| OwnershipRepo::prune_expired(database, now))?;
    let file_claims = db.with(|database| OwnershipRepo::load_file_claims(database, now))?;
    let symbol_claims = db.with(|database| OwnershipRepo::load_symbol_claims(database, now))?;
    let dangling_merges_reconciled = merge_store.reconcile_dangling_on_boot(now as i64)?;
    let unresolved_intents = merge_store.list_unresolved()?;

    let task_snapshot = tasks.list();
    let task_by_id: HashMap<_, _> = task_snapshot
        .iter()
        .map(|task| (task.id.as_str(), task))
        .collect();
    let attempt_snapshot = tasks.execution_snapshot();
    let attempt_by_task: HashMap<_, _> = attempt_snapshot
        .iter()
        .map(|attempt| (attempt.identity.task_id.as_str(), attempt))
        .collect();
    let attempt_by_id: HashMap<_, _> = attempt_snapshot
        .iter()
        .map(|attempt| (attempt.identity.attempt_id.as_str(), attempt))
        .collect();
    let file_claim_by_id: HashMap<_, _> = file_claims
        .iter()
        .map(|claim| (claim.stable_id(), claim))
        .collect();

    let mut task_details = Vec::new();
    let mut execution_details = Vec::new();
    let mut pane_details = Vec::new();
    let mut ownership_details = Vec::new();
    let mut worktree_details = Vec::new();
    let mut event_details = Vec::new();
    let mut attempt_link_errors: HashMap<String, Vec<String>> = HashMap::new();
    let mut release_claim_task_ids = HashSet::new();
    let mut quarantine_task_ids = HashSet::new();

    for claim in &file_claims {
        let Some(task_id) = claim.task_id.as_deref() else {
            continue;
        };
        match task_by_id.get(task_id) {
            None => ownership_details.push(format!(
                "file claim {} references missing task {task_id}",
                claim.stable_id()
            )),
            Some(task) if task.status.is_terminal() => {
                release_claim_task_ids.insert(task_id.to_string());
            }
            Some(_) => match attempt_by_task.get(task_id) {
                Some(attempt)
                    if attempt
                        .ownership_claim_ids
                        .iter()
                        .any(|claim_id| claim_id == &claim.stable_id()) => {}
                Some(attempt) if attempt.state == WorkExecutionState::NeedsReconcile => {
                    quarantine_task_ids.insert(task_id.to_string());
                    ownership_details.push(format!(
                        "file claim {} is retained for quarantined task {task_id}",
                        claim.stable_id()
                    ));
                }
                _ => {
                    quarantine_task_ids.insert(task_id.to_string());
                    ownership_details.push(format!(
                        "file claim {} has no matching active execution binding for task {task_id}",
                        claim.stable_id()
                    ));
                }
            },
        }
    }
    for claim in &symbol_claims {
        let Some(task_id) = claim.task_id.as_deref() else {
            continue;
        };
        match task_by_id.get(task_id) {
            None => ownership_details.push(format!(
                "symbol claim {} references missing task {task_id}",
                claim.claim_id
            )),
            Some(task) if task.status.is_terminal() => {
                release_claim_task_ids.insert(task_id.to_string());
            }
            Some(_) if !attempt_by_task.contains_key(task_id) => {
                quarantine_task_ids.insert(task_id.to_string());
                ownership_details.push(format!(
                    "symbol claim {} has no execution generation for task {task_id}",
                    claim.claim_id
                ));
            }
            Some(_) => {}
        }
    }

    for attempt in &attempt_snapshot {
        let task_id = attempt.identity.task_id.as_str();
        if matches!(
            attempt.state,
            WorkExecutionState::Completed | WorkExecutionState::Failed
        ) {
            release_claim_task_ids.insert(task_id.to_string());
        }
        let links = attempt_link_errors.entry(task_id.to_string()).or_default();
        match task_by_id.get(task_id) {
            None => links.push("execution generation references a missing TaskGraph node".into()),
            Some(task)
                if task.status.is_terminal()
                    && !matches!(attempt.state, WorkExecutionState::Completed) =>
            {
                links.push(format!(
                    "TaskGraph is terminal ({}) while execution state is {}",
                    task.status.as_str(),
                    attempt.state.as_str()
                ));
            }
            _ => {}
        }

        match db.with(|database| {
            EventRepo::by_event_id(database, &attempt.reservation_event_id)
                .map_err(|error| error.to_string())
        })? {
            Some(event) => {
                if let Err(error) = validate_reservation_event(attempt, &event) {
                    event_details.push(format!(
                        "reservation event {} for task {task_id}: {error}",
                        attempt.reservation_event_id
                    ));
                    links.push(error);
                }
            }
            None => {
                let error = format!(
                    "reservation event {} is missing from the durable outbox",
                    attempt.reservation_event_id
                );
                event_details.push(format!("task {task_id}: {error}"));
                links.push(error);
            }
        }

        for claim_id in &attempt.ownership_claim_ids {
            match file_claim_by_id.get(claim_id) {
                Some(claim) if claim.task_id.as_deref() == Some(task_id) => {}
                Some(_) => links.push(format!(
                    "ownership claim {claim_id} is rebound to a different task"
                )),
                None => links.push(format!("ownership claim {claim_id} is missing")),
            }
        }

        if attempt.repo_path.trim().is_empty() {
            links.push("repository identity is absent on this legacy generation".into());
        }
        if let Some(intent_id) = attempt.merge_intent_id.as_deref() {
            match merge_store.get(intent_id)? {
                Some(intent)
                    if intent.task_id == task_id
                        && same_repo_path(&intent.repo_path, &attempt.repo_path) =>
                {
                    match intent.state {
                        MergeIntentState::Rejected => {}
                        MergeIntentState::Merged => links.push(format!(
                            "merge intent {intent_id} landed and requires idempotent finalization"
                        )),
                        state => links.push(format!(
                            "merge intent {intent_id} remains unresolved in state {}",
                            state.as_str()
                        )),
                    }
                }
                Some(intent) => links.push(format!(
                    "merge intent {intent_id} identity mismatch (task={}, repo={})",
                    intent.task_id, intent.repo_path
                )),
                None => links.push(format!("merge intent {intent_id} is missing")),
            }
        }
    }

    let mut repos: HashSet<String> = attempt_snapshot
        .iter()
        .filter(|attempt| !attempt.repo_path.trim().is_empty())
        .map(|attempt| attempt.repo_path.clone())
        .collect();
    repos.extend(
        unresolved_intents
            .iter()
            .map(|intent| intent.repo_path.clone()),
    );
    let mut observed_worktrees = 0usize;
    for repo_path in &repos {
        let repo_attempts: Vec<_> = attempt_snapshot
            .iter()
            .filter(|attempt| same_repo_path(&attempt.repo_path, repo_path))
            .collect();
        let expected_branches: HashSet<_> = repo_attempts
            .iter()
            .filter_map(|attempt| {
                task_by_id
                    .get(attempt.identity.task_id.as_str())
                    .and_then(|task| task.source_branch.clone())
            })
            .collect();
        match crate::git::list_worktrees(repo_path) {
            Ok(worktrees) => {
                observed_worktrees = observed_worktrees.saturating_add(worktrees.len());
                for worktree in worktrees.iter().filter(|worktree| !worktree.is_main) {
                    if !expected_branches.contains(&worktree.branch) {
                        worktree_details.push(format!(
                            "repo {repo_path}: linked worktree branch {} has no durable task binding",
                            worktree.branch
                        ));
                    }
                }
                for attempt in repo_attempts {
                    if !effect_requires_worktree(attempt) {
                        continue;
                    }
                    let Some(source_branch) = task_by_id
                        .get(attempt.identity.task_id.as_str())
                        .and_then(|task| task.source_branch.as_deref())
                    else {
                        attempt_link_errors
                            .entry(attempt.identity.task_id.clone())
                            .or_default()
                            .push("post-effect execution has no source branch".into());
                        continue;
                    };
                    if !worktrees
                        .iter()
                        .any(|worktree| !worktree.is_main && worktree.branch == source_branch)
                    {
                        attempt_link_errors
                            .entry(attempt.identity.task_id.clone())
                            .or_default()
                            .push(format!(
                                "post-effect worktree for branch {source_branch} is missing"
                            ));
                    }
                }
            }
            Err(error) => {
                worktree_details.push(format!("repo {repo_path} is not inspectable: {error}"));
                for attempt in repo_attempts {
                    attempt_link_errors
                        .entry(attempt.identity.task_id.clone())
                        .or_default()
                        .push(format!("repository is not inspectable: {error}"));
                }
            }
        }
    }

    for intent in &unresolved_intents {
        match attempt_by_task.get(intent.task_id.as_str()) {
            Some(attempt) if attempt.merge_intent_id.as_deref() == Some(&intent.intent_id) => {}
            _ => {
                if task_by_id
                    .get(intent.task_id.as_str())
                    .is_some_and(|task| !task.status.is_terminal())
                {
                    quarantine_task_ids.insert(intent.task_id.clone());
                }
                worktree_details.push(format!(
                    "merge intent {} has no current execution binding for task {}",
                    intent.intent_id, intent.task_id
                ));
            }
        }
        if matches!(
            intent.state,
            MergeIntentState::Conflict
                | MergeIntentState::CleanupFailed
                | MergeIntentState::NeedsReconcile
        ) {
            if task_by_id
                .get(intent.task_id.as_str())
                .is_some_and(|task| !task.status.is_terminal())
            {
                quarantine_task_ids.insert(intent.task_id.clone());
            }
            worktree_details.push(format!(
                "merge intent {} requires attention in state {}",
                intent.intent_id,
                intent.state.as_str()
            ));
        }
    }

    let headless_by_attempt: HashMap<_, _> = runtime
        .headless_execution_identities
        .iter()
        .map(|identity| (identity.attempt_id.as_str(), identity))
        .collect();
    let pane_by_attempt: HashMap<_, _> = runtime
        .pane_execution_identities
        .iter()
        .map(|identity| (identity.attempt_id.as_str(), identity))
        .collect();
    for identity in runtime
        .headless_execution_identities
        .iter()
        .chain(runtime.pane_execution_identities.iter())
    {
        match attempt_by_id.get(identity.attempt_id.as_str()) {
            Some(attempt) if &attempt.identity == identity => {}
            Some(_) => pane_details.push(format!(
                "runtime attempt {} carries a stale execution generation",
                identity.attempt_id
            )),
            None => pane_details.push(format!(
                "runtime attempt {} has no durable execution generation",
                identity.attempt_id
            )),
        }
    }

    let mut safely_failed = 0usize;
    let mut active_observed = 0usize;
    for attempt in &attempt_snapshot {
        if matches!(
            attempt.state,
            WorkExecutionState::Completed | WorkExecutionState::Failed
        ) {
            continue;
        }
        active_observed = active_observed.saturating_add(1);
        let task_id = attempt.identity.task_id.as_str();
        let headless_projection = headless_by_attempt
            .get(attempt.identity.attempt_id.as_str())
            .is_some_and(|identity| *identity == &attempt.identity);
        let pane_projection = pane_by_attempt
            .get(attempt.identity.attempt_id.as_str())
            .is_some_and(|identity| *identity == &attempt.identity);
        let conflicting_runtime_projection = runtime
            .headless_execution_identities
            .iter()
            .chain(runtime.pane_execution_identities.iter())
            .any(|identity| identity.task_id == attempt.identity.task_id);
        let wired_pty = attempt
            .identity
            .pty_session_id
            .as_ref()
            .is_some_and(|id| runtime.wired_terminal_ids.contains(id));
        let generation_registered = attempt.identity.pty_session_id.as_ref().is_some_and(|id| {
            runtime
                .terminal_generations
                .get(id)
                .is_some_and(|value| *value > 0)
        });
        let has_runtime_projection =
            headless_projection || pane_projection || conflicting_runtime_projection || wired_pty;

        if wired_pty && !generation_registered {
            pane_details.push(format!(
                "task {task_id}: adopted PTY has no registered terminal generation"
            ));
        }
        if wired_pty && !pane_projection {
            pane_details.push(format!(
                "task {task_id}: adopted PTY has no exact PaneFleet execution owner"
            ));
        }
        if pane_projection && !wired_pty {
            pane_details.push(format!(
                "task {task_id}: PaneFleet execution owner has no wired PTY"
            ));
        }

        let links = attempt_link_errors
            .get(task_id)
            .cloned()
            .unwrap_or_default();
        let pre_first_effect = attempt.fence.effect == ExecutionEffect::Reservation
            || (attempt.fence.effect == ExecutionEffect::FirstEffect
                && attempt.fence.state == ExecutionFenceState::Reserved);
        let can_fail_observed = !has_runtime_projection
            && !matches!(
                attempt.fence.state,
                ExecutionFenceState::EffectStarted | ExecutionFenceState::NeedsReconcile
            )
            && (pre_first_effect || links.is_empty());

        if can_fail_observed {
            tasks
                .fail_execution(
                    &attempt.token(),
                    "startup_reconciliation: no external effect remains in flight",
                    now,
                )
                .map_err(|error| error.to_string())?;
            release_claim_task_ids.insert(task_id.to_string());
            safely_failed = safely_failed.saturating_add(1);
            continue;
        }

        let mut reasons = links;
        if has_runtime_projection {
            reasons.push("runtime projection survived without a complete execution owner".into());
        }
        if attempt.fence.state == ExecutionFenceState::EffectStarted {
            reasons.push(format!(
                "{} effect was started without a durable outcome",
                attempt.fence.effect.as_str()
            ));
        }
        if attempt.fence.state == ExecutionFenceState::NeedsReconcile
            || attempt.state == WorkExecutionState::NeedsReconcile
        {
            reasons.push("execution generation was already quarantined".into());
        }
        reasons.sort();
        reasons.dedup();
        if attempt.state != WorkExecutionState::NeedsReconcile {
            tasks
                .mark_execution_needs_reconcile(
                    &attempt.token(),
                    &format!("startup_reconciliation: {}", reasons.join("; ")),
                    now,
                )
                .map_err(|error| error.to_string())?;
        }
        quarantine_task_ids.insert(task_id.to_string());
        execution_details.push(format!("task {task_id}: {}", reasons.join("; ")));
    }

    let mut release_claim_task_ids: Vec<_> = release_claim_task_ids.into_iter().collect();
    release_claim_task_ids.sort();
    for task_id in &release_claim_task_ids {
        db.with(|database| OwnershipRepo::delete_file_claims_for_task(database, task_id))?;
        db.with(|database| OwnershipRepo::delete_symbol_claims_for_task(database, task_id))?;
    }

    let mut quarantine_task_ids: Vec<_> = quarantine_task_ids.into_iter().collect();
    quarantine_task_ids.sort();
    tasks
        .quarantine_tasks_for_startup(&quarantine_task_ids)
        .map_err(|error| error.to_string())?;
    task_details.extend(
        quarantine_task_ids
            .iter()
            .map(|task_id| format!("task {task_id} is blocked by startup quarantine")),
    );

    let live_leases = file_claims
        .iter()
        .filter(|claim| claim.lease_expires_at.is_some())
        .count()
        .saturating_add(symbol_claims.len());
    let mut reports = vec![
        report(
            "task_graph",
            task_snapshot.len(),
            task_snapshot.len().saturating_sub(task_details.len()),
            task_details,
        ),
        report(
            "execution_attempts",
            active_observed,
            safely_failed,
            execution_details,
        ),
        report(
            "pane_pty_generations",
            runtime
                .headless_execution_identities
                .len()
                .saturating_add(runtime.pane_execution_identities.len())
                .saturating_add(runtime.wired_terminal_ids.len()),
            runtime.terminal_generations.len(),
            pane_details,
        ),
        report(
            "ownership",
            file_claims.len().saturating_add(symbol_claims.len()),
            release_claim_task_ids.len(),
            ownership_details,
        ),
        report(
            "worktrees_merge_intents",
            observed_worktrees.saturating_add(unresolved_intents.len()),
            dangling_merges_reconciled,
            worktree_details,
        ),
        StartupAuthorityReport::reconciled(
            "leases",
            live_leases.saturating_add(pruned_leases),
            live_leases.saturating_add(pruned_leases),
        ),
        report(
            "event_bus",
            usize::try_from(event_audit.high_water_seq.max(0)).unwrap_or(usize::MAX),
            event_audit.consumer_count,
            event_details,
        ),
    ];
    reports.sort_by_key(|entry| {
        REQUIRED_STARTUP_AUTHORITIES
            .iter()
            .position(|name| *name == entry.authority.as_str())
            .unwrap_or(usize::MAX)
    });
    Ok(reports)
}

fn report(
    authority: &str,
    observed: usize,
    reconciled: usize,
    mut details: Vec<String>,
) -> StartupAuthorityReport {
    details.sort();
    details.dedup();
    if details.is_empty() {
        StartupAuthorityReport::reconciled(authority, observed, reconciled)
    } else {
        StartupAuthorityReport::quarantined(authority, observed, reconciled, details)
    }
}

fn validate_reservation_event(
    attempt: &WorkExecutionAttempt,
    event: &crate::event_bus::SeqEvent,
) -> Result<(), String> {
    if event.event.kind != AgentEventKind::ExecutionReserved {
        return Err(format!(
            "kind is {}, expected execution_reserved",
            event.event.kind.as_str()
        ));
    }
    let payload = &event.event.payload;
    let expect_string =
        |field: &str, expected: &str| match payload.get(field).and_then(|v| v.as_str()) {
            Some(actual) if actual == expected => Ok(()),
            Some(actual) => Err(format!("{field} is {actual}, expected {expected}")),
            None => Err(format!("{field} is missing")),
        };
    let expect_u64 = |field: &str, expected: u64| match payload.get(field).and_then(|v| v.as_u64())
    {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(format!("{field} is {actual}, expected {expected}")),
        None => Err(format!("{field} is missing")),
    };
    expect_string("attemptId", &attempt.identity.attempt_id)?;
    expect_string("taskId", &attempt.identity.task_id)?;
    expect_string("repoPath", &attempt.repo_path)?;
    expect_u64("executionGeneration", attempt.identity.execution_generation)?;
    expect_string("agentRunId", &attempt.identity.agent_run_id)?;
    expect_u64("processGeneration", attempt.identity.process_generation)?;
    expect_string("sessionId", &attempt.identity.session_id)?;
    match (
        payload.get("ptySessionId"),
        attempt.identity.pty_session_id.as_deref(),
    ) {
        (Some(value), Some(expected)) if value.as_str() == Some(expected) => {}
        (Some(value), None) if value.is_null() => {}
        _ => return Err("ptySessionId does not match the durable attempt".into()),
    }
    let claim_ids = payload
        .get("ownershipClaimIds")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "ownershipClaimIds is missing".to_string())?;
    let actual_claim_ids: Vec<_> = claim_ids
        .iter()
        .filter_map(|value| value.as_str())
        .collect();
    if actual_claim_ids != attempt.ownership_claim_ids {
        return Err("ownershipClaimIds do not match the durable attempt".into());
    }
    Ok(())
}

fn effect_requires_worktree(attempt: &WorkExecutionAttempt) -> bool {
    match attempt.fence.effect {
        ExecutionEffect::Reservation => false,
        ExecutionEffect::FirstEffect => attempt.fence.state != ExecutionFenceState::Reserved,
        ExecutionEffect::Spawn
        | ExecutionEffect::Review
        | ExecutionEffect::CandidateFreeze
        | ExecutionEffect::Merge
        | ExecutionEffect::Finalization => true,
    }
}

fn same_repo_path(left: &str, right: &str) -> bool {
    if left.trim().is_empty() || right.trim().is_empty() {
        return false;
    }
    let canonical = |value: &str| {
        std::fs::canonicalize(value)
            .ok()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
    };
    match (canonical(left), canonical(right)) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(&right),
        _ => left
            .replace('\\', "/")
            .trim_end_matches('/')
            .eq_ignore_ascii_case(right.replace('\\', "/").trim_end_matches('/')),
    }
}

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::event_bus::AgentEvent;
    use crate::task::{ExecutionReservation, Task, TaskStatus};
    use std::sync::Arc;

    fn record_required_authorities(state: &StartupReconciliationState) {
        for authority in REQUIRED_STARTUP_AUTHORITIES {
            state
                .record_authority(StartupAuthorityReport::reconciled(authority, 0, 0))
                .unwrap();
        }
    }

    fn runtime_fixture() -> (
        tempfile::TempDir,
        TaskManager,
        Arc<ManagedDb>,
        MergeIntentStore,
        WorkExecutionAttempt,
    ) {
        let repo_dir = tempfile::tempdir().unwrap();
        git2::Repository::init(repo_dir.path()).unwrap();
        let repo_path = repo_dir.path().to_string_lossy().to_string();
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = TaskManager::new_durable();
        tasks.attach_db(db.clone()).unwrap();
        tasks.create(Task::new("task-a", "A")).unwrap();
        let attempt = tasks
            .reserve_execution(ExecutionReservation {
                task_id: "task-a".to_string(),
                repo_path,
                runtime: crate::task::ExecutionRuntime::Headless,
                ownership_claim_ids: Vec::new(),
                now: 10,
            })
            .unwrap();
        let event = AgentEvent::new(
            AgentEventKind::ExecutionReserved,
            serde_json::json!({
                "attemptId": attempt.identity.attempt_id,
                "taskId": attempt.identity.task_id,
                "repoPath": attempt.repo_path,
                "executionGeneration": attempt.identity.execution_generation,
                "agentRunId": attempt.identity.agent_run_id,
                "processGeneration": attempt.identity.process_generation,
                "sessionId": attempt.identity.session_id,
                "ptySessionId": attempt.identity.pty_session_id,
                "ownershipClaimIds": attempt.ownership_claim_ids,
            }),
        )
        .with_idempotency_key(attempt.reservation_event_id.clone());
        db.with(|database| {
            EventRepo::append(database, &event)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();
        let merge_store = MergeIntentStore::new(db.clone());
        (repo_dir, tasks, db, merge_store, attempt)
    }

    #[test]
    fn spawn_and_dispatch_are_blocked_until_every_authority_is_reconciled() {
        let state = StartupReconciliationState::new();
        assert!(state
            .require_spawn_admitted()
            .unwrap_err()
            .contains("startup_reconciliation_pending"));
        assert!(state.complete(0, 0, 0).is_err());
        state.mark_database_ready().unwrap();
        assert!(!state.complete(2, 1, 1).unwrap());
        assert!(state.require_dispatch_admitted().is_err());
        record_required_authorities(&state);
        state.require_spawn_admitted().unwrap();
        state.require_dispatch_admitted().unwrap();
        let report = state.snapshot().unwrap();
        assert_eq!(report.phase, StartupReconciliationPhase::Ready);
        assert_eq!(report.adopted_terminals, 2);
        assert_eq!(report.authorities.len(), REQUIRED_STARTUP_AUTHORITIES.len());
    }

    #[test]
    fn failure_is_terminal_and_cannot_be_overwritten_by_late_success() {
        let state = StartupReconciliationState::new();
        state.mark_database_ready().unwrap();
        assert!(state.fail("sidecar", "unavailable").unwrap());
        assert!(!state.complete(1, 1, 1).unwrap());
        let error = state.require_spawn_admitted().unwrap_err();
        assert!(error.contains("startup_reconciliation_failed"));
        assert!(error.contains("sidecar"));
    }

    #[test]
    fn a4_12_remote_admission_rejects_stale_ready_and_keeps_latest_epoch_pending() {
        let host = StartupReconciliationState::new();
        host.mark_database_ready().unwrap();
        record_required_authorities(&host);
        let ready = host.preview_complete(2, 1, 1).unwrap();

        let mirror = StartupReconciliationState::new();
        let stale_epoch = uuid::Uuid::new_v4().to_string();
        let current_epoch = uuid::Uuid::new_v4().to_string();
        mirror.begin_remote_admission(&stale_epoch).unwrap();
        mirror.begin_remote_admission(&current_epoch).unwrap();
        assert!(mirror
            .apply_remote_admission(&stale_epoch, ready.clone())
            .unwrap_err()
            .contains("stale startup admission epoch"));
        assert!(mirror
            .require_effect_admitted("sidecar REST session creation")
            .unwrap_err()
            .contains("startup_reconciliation_pending"));

        mirror
            .apply_remote_admission(&current_epoch, ready)
            .unwrap();
        mirror
            .require_effect_admitted("sidecar REST session creation")
            .unwrap();
    }

    #[test]
    fn a4_12_ready_preview_does_not_expose_local_ready_before_remote_sync() {
        let state = StartupReconciliationState::new();
        state.mark_database_ready().unwrap();
        record_required_authorities(&state);

        let preview = state.preview_complete(2, 1, 1).unwrap();
        assert_eq!(preview.phase, StartupReconciliationPhase::Ready);
        assert_eq!(
            state.snapshot().unwrap().phase,
            StartupReconciliationPhase::Pending
        );
        assert!(state.require_spawn_admitted().is_err());

        assert!(state.complete(2, 1, 1).unwrap());
        state.require_spawn_admitted().unwrap();
    }

    #[test]
    fn a4_12_effectful_surfaces_share_pending_failed_and_ready_admission() {
        let state = StartupReconciliationState::new();
        for surface in ["Workflow start", "Proofbook start", "REST session creation"] {
            let pending = state.require_effect_admitted(surface).unwrap_err();
            assert!(pending.contains("startup_reconciliation_pending"));
            assert!(pending.contains(surface));
        }

        state.fail("fault", "injected failure").unwrap();
        for surface in ["Workflow start", "Proofbook start", "REST session creation"] {
            let failed = state.require_effect_admitted(surface).unwrap_err();
            assert!(failed.contains("startup_reconciliation_failed"));
            assert!(failed.contains(surface));
        }
    }

    #[test]
    fn a4_12_begin_waits_for_admitted_spawn_guard_before_returning_to_pending() {
        use std::sync::{mpsc, Arc};
        use std::time::Duration;

        let host = StartupReconciliationState::new();
        host.mark_database_ready().unwrap();
        record_required_authorities(&host);
        let ready = host.preview_complete(0, 0, 0).unwrap();

        let state = Arc::new(StartupReconciliationState::new());
        let ready_epoch = uuid::Uuid::new_v4().to_string();
        state.begin_remote_admission(&ready_epoch).unwrap();
        state.apply_remote_admission(&ready_epoch, ready).unwrap();

        let (spawn_locked_tx, spawn_locked_rx) = mpsc::channel();
        let (release_spawn_tx, release_spawn_rx) = mpsc::channel();
        let spawn_state = state.clone();
        let spawn = std::thread::spawn(move || {
            let _guard = spawn_state.acquire_spawn_admission().unwrap();
            spawn_locked_tx.send(()).unwrap();
            release_spawn_rx.recv().unwrap();
        });
        spawn_locked_rx.recv().unwrap();

        let (begin_done_tx, begin_done_rx) = mpsc::channel();
        let begin_state = state.clone();
        let next_epoch = uuid::Uuid::new_v4().to_string();
        let begin = std::thread::spawn(move || {
            begin_state.begin_remote_admission(&next_epoch).unwrap();
            begin_done_tx.send(()).unwrap();
        });

        assert!(
            begin_done_rx
                .recv_timeout(Duration::from_millis(100))
                .is_err(),
            "Begin crossed an admitted spawn guard before process creation completed"
        );
        release_spawn_tx.send(()).unwrap();
        spawn.join().unwrap();
        begin_done_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        begin.join().unwrap();
        assert!(state
            .require_spawn_admitted()
            .unwrap_err()
            .contains("startup_reconciliation_pending"));
    }

    #[test]
    fn timeout_fails_only_a_pending_state() {
        let state = StartupReconciliationState::new();
        assert!(state.fail_if_pending().unwrap());
        assert!(!state.fail_if_pending().unwrap());
        assert_eq!(
            state.snapshot().unwrap().failure_stage.as_deref(),
            Some("timeout")
        );
    }

    #[test]
    fn quarantined_authority_is_visible_but_does_not_get_guessed_away() {
        let state = StartupReconciliationState::new();
        state.mark_database_ready().unwrap();
        assert!(!state.complete(0, 0, 0).unwrap());
        for authority in REQUIRED_STARTUP_AUTHORITIES {
            let outcome = if authority == "execution_attempts" {
                StartupAuthorityReport::quarantined(
                    authority,
                    1,
                    0,
                    vec!["task-a: post-spawn effect is uncertain".to_string()],
                )
            } else {
                StartupAuthorityReport::reconciled(authority, 0, 0)
            };
            state.record_authority(outcome).unwrap();
        }
        let report = state.snapshot().unwrap();
        assert_eq!(report.phase, StartupReconciliationPhase::Ready);
        assert_eq!(report.quarantined_total, 1);
        assert_eq!(
            report.authorities[1].status,
            StartupAuthorityStatus::Quarantined
        );
    }

    #[test]
    fn duplicate_authority_result_is_idempotent_and_conflicts_fail_closed() {
        let state = StartupReconciliationState::new();
        let first = StartupAuthorityReport::reconciled("task_graph", 2, 2);
        assert!(!state.record_authority(first.clone()).unwrap());
        assert!(!state.record_authority(first).unwrap());
        assert!(state
            .record_authority(StartupAuthorityReport::reconciled("task_graph", 3, 3))
            .unwrap_err()
            .contains("conflicting"));
    }

    #[test]
    fn startup_reconciliation_safely_closes_a_pre_effect_generation() {
        let (_repo, tasks, db, merge_store, attempt) = runtime_fixture();
        let reports = reconcile_runtime_authorities(
            &tasks,
            &db,
            &merge_store,
            &StartupRuntimeSnapshot::default(),
            20,
        )
        .unwrap();
        assert_eq!(
            tasks.current_execution("task-a").unwrap().state,
            WorkExecutionState::Failed
        );
        assert_eq!(tasks.get("task-a").unwrap().status, TaskStatus::Ready);
        assert_eq!(
            reports
                .iter()
                .find(|report| report.authority == "execution_attempts")
                .unwrap()
                .reconciled,
            1
        );

        // A second pass performs no successor generation and leaves the same
        // durable attempt closed.
        reconcile_runtime_authorities(
            &tasks,
            &db,
            &merge_store,
            &StartupRuntimeSnapshot::default(),
            21,
        )
        .unwrap();
        let current = tasks.current_execution("task-a").unwrap();
        assert_eq!(current.identity.attempt_id, attempt.identity.attempt_id);
        assert_eq!(current.state, WorkExecutionState::Failed);
    }

    #[test]
    fn started_effect_is_quarantined_and_taskgraph_is_blocked_idempotently() {
        let (_repo, tasks, db, merge_store, attempt) = runtime_fixture();
        tasks
            .commit_execution_reservation(&attempt.token(), 11)
            .unwrap();
        tasks
            .reserve_execution_effect(&attempt.token(), ExecutionEffect::FirstEffect, None, 12)
            .unwrap();
        tasks
            .start_execution_effect(&attempt.token(), ExecutionEffect::FirstEffect, 13)
            .unwrap();

        let reports = reconcile_runtime_authorities(
            &tasks,
            &db,
            &merge_store,
            &StartupRuntimeSnapshot::default(),
            20,
        )
        .unwrap();
        assert_eq!(
            tasks.current_execution("task-a").unwrap().state,
            WorkExecutionState::NeedsReconcile
        );
        assert_eq!(tasks.get("task-a").unwrap().status, TaskStatus::Blocked);
        assert_eq!(
            reports
                .iter()
                .find(|report| report.authority == "execution_attempts")
                .unwrap()
                .status,
            StartupAuthorityStatus::Quarantined
        );

        reconcile_runtime_authorities(
            &tasks,
            &db,
            &merge_store,
            &StartupRuntimeSnapshot::default(),
            21,
        )
        .unwrap();
        assert_eq!(
            tasks.current_execution("task-a").unwrap().state,
            WorkExecutionState::NeedsReconcile
        );
        assert_eq!(tasks.get("task-a").unwrap().status, TaskStatus::Blocked);
    }

    #[test]
    fn stale_live_runtime_projection_prevents_safe_generation_close() {
        let (_repo, tasks, db, merge_store, attempt) = runtime_fixture();
        let mut stale_runtime = attempt.identity.clone();
        stale_runtime.process_generation = stale_runtime.process_generation.saturating_add(1);
        let runtime = StartupRuntimeSnapshot {
            headless_execution_identities: vec![stale_runtime],
            ..StartupRuntimeSnapshot::default()
        };

        reconcile_runtime_authorities(&tasks, &db, &merge_store, &runtime, 20).unwrap();
        assert_eq!(
            tasks.current_execution("task-a").unwrap().state,
            WorkExecutionState::NeedsReconcile
        );
        assert_eq!(tasks.get("task-a").unwrap().status, TaskStatus::Blocked);
    }

    #[test]
    fn a4_12_production_pty_owner_rejects_spawn_before_reconciliation() {
        let state = std::sync::Arc::new(StartupReconciliationState::new());
        let pty = crate::pty::PtyManager::new().with_startup_reconciliation(state.clone());
        let pending = pty
            .spawn_with_id("blocked-pending", &crate::pty::ShellType::Cmd, 80, 24, None)
            .unwrap_err();
        assert!(pending.contains("startup_reconciliation_pending"));
        state.fail("fixture", "failed").unwrap();
        let failed = pty
            .spawn_with_id("blocked-failed", &crate::pty::ShellType::Cmd, 80, 24, None)
            .unwrap_err();
        assert!(failed.contains("startup_reconciliation_failed"));
        assert!(pty.list().is_empty());
    }
}
