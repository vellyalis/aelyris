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
pub struct AgentSession {
    pub id: String,
    pub run_mode: AgentRunMode,
    pub status: AgentRunStatus,
    pub model: String,
    pub prompt: Option<String>,
    pub cwd: String,
    pub workspace_scope: Option<String>,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: Option<u64>,
    pub cli: Option<String>,
    pub backend: Option<String>,
    pub pty_id: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub repo_path: Option<String>,
}

impl AgentSession {
    fn parse_status(status: &str) -> AgentRunStatus {
        AgentRunStatus::from_str(status).unwrap_or(AgentRunStatus::Error)
    }
}

impl From<AgentSessionInfo> for AgentSession {
    fn from(info: AgentSessionInfo) -> Self {
        Self {
            id: info.id,
            run_mode: AgentRunMode::Headless,
            status: Self::parse_status(&info.status),
            model: info.model,
            prompt: Some(info.prompt),
            cwd: info.cwd.clone(),
            workspace_scope: Some(info.cwd),
            cost: info.cost,
            tokens_used: info.tokens_used,
            started_at: Some(info.started_at),
            cli: None,
            backend: None,
            pty_id: None,
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
            run_mode: AgentRunMode::Interactive,
            status: Self::parse_status(&info.status),
            model: info.model,
            prompt: info.initial_prompt,
            cwd: info.cwd,
            workspace_scope,
            cost: info.cost,
            tokens_used: info.tokens_used,
            started_at: Some(info.started_at),
            cli: Some(cli_name(&info.cli)),
            backend: Some(info.backend),
            pty_id: Some(info.pty_id),
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
        });

        assert_eq!(session.run_mode, AgentRunMode::Headless);
        assert_eq!(session.status, AgentRunStatus::Thinking);
        assert_eq!(session.prompt.as_deref(), Some("implement"));
        assert_eq!(session.started_at, Some(123));
        assert_eq!(session.workspace_scope.as_deref(), Some("C:/repo"));
        assert_eq!(session.cli, None);
    }

    #[test]
    fn maps_interactive_session_to_unified_contract() {
        let session = AgentSession::from(InteractiveSessionInfo {
            id: "i1".to_string(),
            pty_id: "pty-1".to_string(),
            backend: "sidecar".to_string(),
            cli: AgentCli::Codex,
            status: "waiting".to_string(),
            model: "codex".to_string(),
            initial_prompt: Some("review".to_string()),
            cwd: "C:/repo".to_string(),
            worktree_branch: Some("agent/review".to_string()),
            worktree_path: Some("C:/repo/.worktrees/agent-review".to_string()),
            repo_path: Some("C:/repo".to_string()),
            cost: 0.0,
            tokens_used: 0,
            started_at: 123,
        });

        assert_eq!(session.run_mode, AgentRunMode::Interactive);
        assert_eq!(session.status, AgentRunStatus::WaitingApproval);
        assert_eq!(session.prompt.as_deref(), Some("review"));
        assert_eq!(session.cli.as_deref(), Some("codex"));
        assert_eq!(session.pty_id.as_deref(), Some("pty-1"));
        assert_eq!(
            session.workspace_scope.as_deref(),
            Some("C:/repo/.worktrees/agent-review")
        );
    }

    #[test]
    fn preserves_absent_interactive_prompt_and_custom_cli_name() {
        let session = AgentSession::from(InteractiveSessionInfo {
            id: "i2".to_string(),
            pty_id: "pty-2".to_string(),
            backend: "native".to_string(),
            cli: AgentCli::Custom("aider".to_string()),
            status: "idle".to_string(),
            model: "aider".to_string(),
            initial_prompt: None,
            cwd: "C:/repo".to_string(),
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
            cost: 0.0,
            tokens_used: 0,
            started_at: 456,
        });

        assert_eq!(session.prompt, None);
        assert_eq!(session.cli.as_deref(), Some("aider"));
        assert_eq!(session.workspace_scope.as_deref(), Some("C:/repo"));
    }
}
