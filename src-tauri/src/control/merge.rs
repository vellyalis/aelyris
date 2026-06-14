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
    pub status: String,
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
        status: "queued".to_string(),
    })
}

pub fn inspect(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
) -> ControlResult<MergeReadiness> {
    crate::git::inspect_merge_worktree_branch(repo_path, source_branch, target_branch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queues_without_merging_to_main() {
        let queued = queue_request(MergeRequest {
            session_id: "agent-1".to_string(),
            source_branch: "agent/feature".to_string(),
            target_branch: "main".to_string(),
        })
        .expect("merge request should queue");

        assert_eq!(queued.status, "queued");
        assert!(queued.intent_id.starts_with("merge:agent-1:"));
    }

    #[test]
    fn rejects_same_branch_merge_request() {
        let err = queue_request(MergeRequest {
            session_id: "agent-1".to_string(),
            source_branch: "main".to_string(),
            target_branch: "main".to_string(),
        })
        .expect_err("same branch must be rejected");

        assert!(err.contains("different"));
    }
}
