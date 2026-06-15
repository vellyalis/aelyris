use serde::{Deserialize, Serialize};

use crate::control::ControlResult;
use crate::git::MergeReadiness;

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
