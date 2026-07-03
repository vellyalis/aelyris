use super::context_lifecycle::ContextRemaining;
use crate::persistence::{SessionCheckpointRecord, SessionHandoffRecord, SessionHandoffState};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use super::{AgentCli, AgentRunStatus, AgentSessionInfo, InteractiveSessionInfo};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunMode {
    Headless,
    Interactive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLineageEntry {
    pub logical_session_id: String,
    pub checkpoint_seq: Option<u64>,
    pub pty_id: Option<String>,
    pub status: Option<String>,
    pub predecessor_session_id: Option<String>,
    pub updated_at: Option<u64>,
}

impl SessionLineageEntry {
    pub fn from_checkpoint(checkpoint: &SessionCheckpointRecord) -> Self {
        Self {
            logical_session_id: checkpoint.logical_session_id.clone(),
            checkpoint_seq: Some(checkpoint.checkpoint_seq),
            pty_id: Some(checkpoint.pty_id.clone()),
            status: Some(checkpoint.status.clone()),
            predecessor_session_id: checkpoint.predecessor_session_id.clone(),
            updated_at: Some(checkpoint.updated_at),
        }
    }

    pub fn unresolved(logical_session_id: String) -> Self {
        Self {
            logical_session_id,
            checkpoint_seq: None,
            pty_id: None,
            status: None,
            predecessor_session_id: None,
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecycleStatus {
    pub predecessor_id: String,
    pub successor_id: String,
    pub handoff_seq: u64,
    pub state: SessionHandoffState,
    pub correlation_id: String,
    pub failure_reason: Option<String>,
    pub updated_at: u64,
}

impl From<&SessionHandoffRecord> for SessionRecycleStatus {
    fn from(handoff: &SessionHandoffRecord) -> Self {
        Self {
            predecessor_id: handoff.predecessor_id.clone(),
            successor_id: handoff.successor_id.clone(),
            handoff_seq: handoff.handoff_seq,
            state: handoff.state,
            correlation_id: handoff.correlation_id.clone(),
            failure_reason: handoff.failure_reason.clone(),
            updated_at: handoff.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub logical_session_id: Option<String>,
    pub run_mode: AgentRunMode,
    pub status: AgentRunStatus,
    pub model: String,
    pub prompt: Option<String>,
    pub cwd: String,
    pub workspace_scope: Option<String>,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: Option<u64>,
    pub last_activity: Option<u64>,
    pub turn_count: Option<u64>,
    pub context_remaining: Option<ContextRemaining>,
    pub cli: Option<String>,
    pub backend: Option<String>,
    pub pty_id: Option<String>,
    /// The captured permission-menu prompt while an interactive session is
    /// `waiting_approval`. Must ride the unified fleet snapshot: the right
    /// rail consumes THIS contract (not the interactive list), and the
    /// Decision Inbox only surfaces a gate when the prompt is present.
    pub approval_prompt: Option<String>,
    pub predecessor_session_id: Option<String>,
    pub lineage: Vec<SessionLineageEntry>,
    pub recycle_status: Option<SessionRecycleStatus>,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub repo_path: Option<String>,
}

impl AgentSession {
    fn parse_status(status: &str) -> AgentRunStatus {
        AgentRunStatus::from_str(status).unwrap_or(AgentRunStatus::Error)
    }

    pub fn with_visibility(
        mut self,
        predecessor_session_id: Option<String>,
        lineage: Vec<SessionLineageEntry>,
        recycle_status: Option<SessionRecycleStatus>,
    ) -> Self {
        self.predecessor_session_id = predecessor_session_id;
        self.lineage = lineage;
        self.recycle_status = recycle_status;
        self
    }
}

impl From<AgentSessionInfo> for AgentSession {
    fn from(info: AgentSessionInfo) -> Self {
        Self {
            id: info.id,
            logical_session_id: None,
            run_mode: AgentRunMode::Headless,
            status: Self::parse_status(&info.status),
            model: info.model,
            prompt: Some(info.prompt),
            cwd: info.cwd.clone(),
            workspace_scope: Some(info.cwd),
            cost: info.cost,
            tokens_used: info.tokens_used,
            started_at: Some(info.started_at),
            last_activity: None,
            turn_count: None,
            context_remaining: None,
            cli: None,
            backend: None,
            pty_id: None,
            approval_prompt: None,
            predecessor_session_id: None,
            lineage: Vec::new(),
            recycle_status: None,
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
        }
    }
}

impl From<InteractiveSessionInfo> for AgentSession {
    fn from(info: InteractiveSessionInfo) -> Self {
        let workspace_scope = info
            .worktree_path
            .clone()
            .or_else(|| Some(info.cwd.clone()));
        Self {
            id: info.id,
            logical_session_id: Some(info.logical_session_id),
            run_mode: AgentRunMode::Interactive,
            status: Self::parse_status(&info.status),
            model: info.model,
            prompt: info.initial_prompt,
            cwd: info.cwd,
            workspace_scope,
            cost: info.cost,
            tokens_used: info.tokens_used,
            started_at: Some(info.started_at),
            last_activity: Some(info.last_activity),
            turn_count: Some(info.turn_count),
            context_remaining: info.context_remaining,
            cli: Some(cli_name(&info.cli)),
            backend: Some(info.backend),
            pty_id: Some(info.pty_id),
            approval_prompt: info.approval_prompt,
            predecessor_session_id: None,
            lineage: Vec::new(),
            recycle_status: None,
            worktree_branch: info.worktree_branch,
            worktree_path: info.worktree_path,
            repo_path: info.repo_path,
        }
    }
}

fn cli_name(cli: &AgentCli) -> String {
    match cli {
        AgentCli::Claude => "claude".to_string(),
        AgentCli::Gemini => "gemini".to_string(),
        AgentCli::Codex => "codex".to_string(),
        AgentCli::Custom(name) => name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_headless_session_to_unified_contract() {
        let session = AgentSession::from(AgentSessionInfo {
            id: "h1".to_string(),
            status: "thinking".to_string(),
            model: "sonnet".to_string(),
            prompt: "implement".to_string(),
            cwd: "C:/repo".to_string(),
            cost: 0.25,
            tokens_used: 42,
            started_at: 123,
            task_id: None,
            current_activity: None,
        });

        assert_eq!(session.run_mode, AgentRunMode::Headless);
        assert_eq!(session.status, AgentRunStatus::Thinking);
        assert_eq!(session.prompt.as_deref(), Some("implement"));
        assert_eq!(session.started_at, Some(123));
        assert_eq!(session.workspace_scope.as_deref(), Some("C:/repo"));
        assert_eq!(session.cli, None);
        assert!(session.lineage.is_empty());
        assert!(session.recycle_status.is_none());
    }

    #[test]
    fn maps_interactive_session_to_unified_contract() {
        let session = AgentSession::from(InteractiveSessionInfo {
            id: "i1".to_string(),
            logical_session_id: "logical-i1".to_string(),
            pty_id: "pty-1".to_string(),
            backend: "sidecar".to_string(),
            cli: AgentCli::Codex,
            status: "waiting".to_string(),
            model: "codex".to_string(),
            initial_prompt: Some("review".to_string()),
            approval_prompt: Some(
                "Bash(git push origin main) · Do you want to proceed?".to_string(),
            ),
            cwd: "C:/repo".to_string(),
            worktree_branch: Some("agent/review".to_string()),
            worktree_path: Some("C:/repo/.worktrees/agent-review".to_string()),
            repo_path: Some("C:/repo".to_string()),
            cost: 0.0,
            tokens_used: 0,
            started_at: 123,
            last_activity: 130,
            turn_count: 2,
            context_remaining: Some(super::ContextRemaining::parsed_claude_grid(22.0, 130)),
        });

        assert_eq!(session.run_mode, AgentRunMode::Interactive);
        assert_eq!(session.status, AgentRunStatus::WaitingApproval);
        assert_eq!(session.prompt.as_deref(), Some("review"));
        assert_eq!(session.cli.as_deref(), Some("codex"));
        assert_eq!(session.pty_id.as_deref(), Some("pty-1"));
        // The unified fleet snapshot is what the right rail / Decision Inbox
        // consume — dropping the captured menu here silently kills the inbox.
        assert_eq!(
            session.approval_prompt.as_deref(),
            Some("Bash(git push origin main) · Do you want to proceed?")
        );
        assert_eq!(session.predecessor_session_id, None);
        assert!(session.lineage.is_empty());
        assert_eq!(
            session.workspace_scope.as_deref(),
            Some("C:/repo/.worktrees/agent-review")
        );
    }

    #[test]
    fn preserves_absent_interactive_prompt_and_custom_cli_name() {
        let session = AgentSession::from(InteractiveSessionInfo {
            id: "i2".to_string(),
            logical_session_id: "logical-i2".to_string(),
            pty_id: "pty-2".to_string(),
            backend: "native".to_string(),
            cli: AgentCli::Custom("aider".to_string()),
            status: "idle".to_string(),
            model: "aider".to_string(),
            initial_prompt: None,
            approval_prompt: None,
            cwd: "C:/repo".to_string(),
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
            cost: 0.0,
            tokens_used: 0,
            started_at: 456,
            last_activity: 456,
            turn_count: 0,
            context_remaining: None,
        });

        assert_eq!(session.prompt, None);
        assert_eq!(session.cli.as_deref(), Some("aider"));
        assert_eq!(session.workspace_scope.as_deref(), Some("C:/repo"));
    }
}
