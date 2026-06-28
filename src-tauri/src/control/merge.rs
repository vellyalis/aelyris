use serde::{Deserialize, Serialize};

use crate::control::ControlResult;
use crate::git::{BoundMergeResult, MergeOutcome, MergeReadiness};
use crate::merge_intent::store::MergeIntentStore;
use crate::merge_intent::{MergeIntent, MergeIntentState};

fn strip_local_verbatim_prefix(path: &str) -> String {
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub session_id: String,
    pub source_branch: String,
    pub target_branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMergeIntent {
    pub intent_id: String,
    pub session_id: String,
    pub source_branch: String,
    pub target_branch: String,
    /// One of `MergeIntentStatus::as_str` — kept as a string on the wire for
    /// backward compatibility with the existing MCP/IPC consumers.
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableMergeExecution {
    pub intent_id: String,
    pub status: String,
    pub outcome: Option<MergeOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DurableMergeError {
    NotFound(String),
    InvalidRequest(String),
    Persistence(String),
}

impl std::fmt::Display for DurableMergeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(message)
            | Self::InvalidRequest(message)
            | Self::Persistence(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for DurableMergeError {}

/// The lifecycle a queued merge intent moves through. `queued -> merging ->
/// (merged | rejected | conflict)`. A reject may also short-circuit from
/// `queued` (rejected before it is ever attempted).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeIntentStatus {
    Queued,
    Merging,
    Merged,
    Rejected,
    Conflict,
}

impl MergeIntentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Merging => "merging",
            Self::Merged => "merged",
            Self::Rejected => "rejected",
            Self::Conflict => "conflict",
        }
    }

    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Merged | Self::Rejected | Self::Conflict)
    }
}

pub fn queue_request(request: MergeRequest) -> ControlResult<QueuedMergeIntent> {
    crate::git::validate_branch_name(&request.source_branch)?;
    crate::git::validate_branch_name(&request.target_branch)?;

    if request.source_branch == request.target_branch {
        return Err("source and target branch must be different".to_string());
    }

    if request.session_id.trim().is_empty() {
        return Err("session id is required".to_string());
    }

    Ok(QueuedMergeIntent {
        intent_id: format!("merge:{}:{}", request.session_id, uuid::Uuid::new_v4()),
        session_id: request.session_id,
        source_branch: request.source_branch,
        target_branch: request.target_branch,
        status: MergeIntentStatus::Queued.as_str().to_string(),
    })
}

pub fn inspect(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> ControlResult<MergeReadiness> {
    crate::git::inspect_merge_worktree_branch(repo_path, source_branch, target_branch)
}

pub fn request_durable_intent(
    store: &MergeIntentStore,
    repo_path: &str,
    task_id: &str,
    session_id: Option<&str>,
    source_branch: &str,
    target_branch: &str,
    now: i64,
) -> ControlResult<MergeIntent> {
    if task_id.trim().is_empty() {
        return Err("task id is required".to_string());
    }
    let canonical = std::fs::canonicalize(repo_path)
        .map_err(|_| "repo path must exist and be accessible".to_string())?;
    if !canonical.is_dir() {
        return Err("repo path must be a directory".to_string());
    }
    let repo_path = strip_local_verbatim_prefix(&canonical.to_string_lossy());
    let readiness = inspect(&repo_path, source_branch, target_branch)?;
    let intent = MergeIntent {
        intent_id: format!("merge:{task_id}:{}", uuid::Uuid::new_v4()),
        repo_path,
        source_branch: source_branch.to_string(),
        target_branch: target_branch.to_string(),
        source_oid: readiness.source_oid,
        target_oid: readiness.target_oid,
        merge_base_oid: readiness.merge_base_oid,
        task_id: task_id.to_string(),
        created_at: now,
        state: MergeIntentState::Queued,
        updated_at: now,
        session_id: session_id.map(str::to_string),
        reviewer_id: None,
        gates_digest: None,
    };
    store.create_or_get(&intent)
}

pub fn approve_durable_intent(
    store: &MergeIntentStore,
    intent_id: &str,
    reviewer_id: &str,
    gates_digest: Option<&str>,
    now: i64,
) -> Result<DurableMergeExecution, DurableMergeError> {
    if reviewer_id.trim().is_empty() {
        return Err(DurableMergeError::InvalidRequest(
            "reviewer id is required".to_string(),
        ));
    }
    let intent = store
        .get(intent_id)
        .map_err(DurableMergeError::Persistence)?
        .ok_or_else(|| {
            DurableMergeError::NotFound(format!("merge intent not found: {intent_id}"))
        })?;
    if !store
        .claim_for_merge(intent_id, now)
        .map_err(DurableMergeError::Persistence)?
    {
        return Err(DurableMergeError::InvalidRequest(format!(
            "intent {intent_id} is not claimable (state {}): already merging, terminal, or needs reconcile",
            intent.state.as_str()
        )));
    }
    if let Err(err) = store.record_approval(intent_id, reviewer_id, gates_digest, now) {
        if let Err(reconcile_err) =
            store.set_state(intent_id, MergeIntentState::NeedsReconcile, now)
        {
            return Err(DurableMergeError::Persistence(format!(
                "{err}; additionally failed to mark needs_reconcile: {reconcile_err}"
            )));
        }
        return Err(DurableMergeError::Persistence(err));
    }

    match crate::git::branch_contains_commit(
        &intent.repo_path,
        &intent.target_branch,
        &intent.source_oid,
    ) {
        Ok(true) => {
            store
                .set_state(intent_id, MergeIntentState::Merged, now)
                .map_err(DurableMergeError::Persistence)?;
            return Ok(DurableMergeExecution {
                intent_id: intent_id.to_string(),
                status: MergeIntentState::Merged.as_str().to_string(),
                outcome: Some(MergeOutcome::AlreadyMerged),
            });
        }
        Ok(false) => {}
        Err(err) => {
            store
                .set_state(intent_id, MergeIntentState::NeedsReconcile, now)
                .map_err(DurableMergeError::Persistence)?;
            return Err(DurableMergeError::InvalidRequest(format!(
                "intent {intent_id}: repo unreadable, marked needs_reconcile: {err}"
            )));
        }
    }

    match crate::git::perform_merge_bound(
        &intent.repo_path,
        &intent.source_branch,
        &intent.target_branch,
        &intent.source_oid,
        &intent.target_oid,
    ) {
        Ok(BoundMergeResult::StaleTips) => {
            store
                .set_state(intent_id, MergeIntentState::NeedsReconcile, now)
                .map_err(DurableMergeError::Persistence)?;
            Err(DurableMergeError::InvalidRequest(format!(
                "intent {intent_id}: branch tips moved since request; marked needs_reconcile"
            )))
        }
        Ok(BoundMergeResult::Merged(outcome)) => {
            let final_state = match &outcome {
                MergeOutcome::Conflict { .. } => MergeIntentState::Conflict,
                _ => MergeIntentState::Merged,
            };
            store
                .set_state(intent_id, final_state, now)
                .map_err(DurableMergeError::Persistence)?;
            Ok(DurableMergeExecution {
                intent_id: intent_id.to_string(),
                status: final_state.as_str().to_string(),
                outcome: Some(outcome),
            })
        }
        Err(err) => {
            store
                .set_state(intent_id, MergeIntentState::NeedsReconcile, now)
                .map_err(DurableMergeError::Persistence)?;
            Err(DurableMergeError::InvalidRequest(err))
        }
    }
}

/// Serialized merge queue: per-target-branch FIFO that guarantees at most one
/// in-flight (`merging`) merge per target branch, so concurrent Reviewer merges
/// into the same branch never race (BR9). Pure state machine — the Reviewer
/// loop drives it (begin -> perform_merge -> resolve).
#[derive(Debug, Default)]
pub struct MergeQueue {
    intents: Vec<QueuedMergeIntent>,
}

impl MergeQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn intents(&self) -> &[QueuedMergeIntent] {
        &self.intents
    }

    /// Validate + enqueue a request (FIFO append). Returns the queued intent.
    pub fn enqueue(&mut self, request: MergeRequest) -> ControlResult<QueuedMergeIntent> {
        let intent = queue_request(request)?;
        self.intents.push(intent.clone());
        Ok(intent)
    }

    fn target_has_merging(&self, target: &str) -> bool {
        self.intents
            .iter()
            .any(|i| i.target_branch == target && i.status == MergeIntentStatus::Merging.as_str())
    }

    /// The next queued intent eligible to start: FIFO order, skipping any whose
    /// target already has a merge in flight.
    pub fn next_ready(&self) -> Option<&QueuedMergeIntent> {
        self.intents.iter().find(|i| {
            i.status == MergeIntentStatus::Queued.as_str()
                && !self.target_has_merging(&i.target_branch)
        })
    }

    /// Move a queued intent to `merging`, refusing if its target already has one
    /// in flight (serialization guarantee).
    pub fn begin(&mut self, intent_id: &str) -> ControlResult<()> {
        let target = {
            let intent = self.find(intent_id)?;
            if intent.status != MergeIntentStatus::Queued.as_str() {
                return Err(format!(
                    "intent {intent_id} is not queued (status: {})",
                    intent.status
                ));
            }
            intent.target_branch.clone()
        };
        if self.target_has_merging(&target) {
            return Err(format!("a merge into {target} is already in flight"));
        }
        self.set_status(intent_id, MergeIntentStatus::Merging)
    }

    /// Move an intent to a terminal status (`merged`/`rejected`/`conflict`).
    pub fn resolve(&mut self, intent_id: &str, status: MergeIntentStatus) -> ControlResult<()> {
        if !status.is_terminal() {
            return Err(format!(
                "resolve requires a terminal status, got {}",
                status.as_str()
            ));
        }
        self.set_status(intent_id, status)
    }

    fn find(&self, intent_id: &str) -> ControlResult<&QueuedMergeIntent> {
        self.intents
            .iter()
            .find(|i| i.intent_id == intent_id)
            .ok_or_else(|| format!("merge intent not found: {intent_id}"))
    }

    fn set_status(&mut self, intent_id: &str, status: MergeIntentStatus) -> ControlResult<()> {
        let intent = self
            .intents
            .iter_mut()
            .find(|i| i.intent_id == intent_id)
            .ok_or_else(|| format!("merge intent not found: {intent_id}"))?;
        intent.status = status.as_str().to_string();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(session: &str, source: &str, target: &str) -> MergeRequest {
        MergeRequest {
            session_id: session.to_string(),
            source_branch: source.to_string(),
            target_branch: target.to_string(),
        }
    }

    #[test]
    fn queues_without_merging_to_main() {
        let queued = queue_request(request("agent-1", "agent/feature", "main"))
            .expect("merge request should queue");
        assert_eq!(queued.status, "queued");
        assert!(queued.intent_id.starts_with("merge:agent-1:"));
    }

    #[test]
    fn rejects_same_branch_merge_request() {
        let err = queue_request(request("agent-1", "main", "main")).expect_err("same branch");
        assert!(err.contains("different"));
    }

    #[test]
    fn serializes_one_in_flight_merge_per_target() {
        let mut queue = MergeQueue::new();
        let a = queue
            .enqueue(request("agent-1", "agent/a", "main"))
            .unwrap();
        let b = queue
            .enqueue(request("agent-2", "agent/b", "main"))
            .unwrap();

        // FIFO: the first queued intent is next.
        assert_eq!(queue.next_ready().unwrap().intent_id, a.intent_id);

        queue.begin(&a.intent_id).unwrap();
        // main now has an in-flight merge: nothing else into main is ready, and
        // a second begin into main is refused.
        assert!(queue.next_ready().is_none());
        assert!(queue.begin(&b.intent_id).unwrap_err().contains("in flight"));

        // Resolving the first frees the target; the second becomes ready.
        queue
            .resolve(&a.intent_id, MergeIntentStatus::Merged)
            .unwrap();
        assert_eq!(queue.next_ready().unwrap().intent_id, b.intent_id);
        queue.begin(&b.intent_id).unwrap();
        queue
            .resolve(&b.intent_id, MergeIntentStatus::Conflict)
            .unwrap();
    }

    #[test]
    fn different_targets_run_in_parallel() {
        let mut queue = MergeQueue::new();
        let a = queue
            .enqueue(request("agent-1", "agent/a", "main"))
            .unwrap();
        let b = queue
            .enqueue(request("agent-2", "agent/b", "develop"))
            .unwrap();
        queue.begin(&a.intent_id).unwrap();
        // A different target is not blocked by main's in-flight merge.
        assert_eq!(queue.next_ready().unwrap().intent_id, b.intent_id);
    }

    #[test]
    fn rejects_unknown_intent_and_non_terminal_resolve() {
        let mut queue = MergeQueue::new();
        let a = queue
            .enqueue(request("agent-1", "agent/a", "main"))
            .unwrap();
        assert!(queue.begin("ghost").unwrap_err().contains("not found"));
        assert!(queue
            .resolve(&a.intent_id, MergeIntentStatus::Queued)
            .unwrap_err()
            .contains("terminal"));
    }
}
