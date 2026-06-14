use serde::{Deserialize, Serialize};
use std::str::FromStr;

pub const AGENT_RUN_STATUS_NAMES: [&str; 9] = [
    "spawning",
    "thinking",
    "coding",
    "running_tests",
    "waiting_approval",
    "blocked",
    "idle",
    "done",
    "error",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Spawning,
    Thinking,
    Coding,
    RunningTests,
    WaitingApproval,
    Blocked,
    Idle,
    Done,
    Error,
}

impl AgentRunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Spawning => "spawning",
            Self::Thinking => "thinking",
            Self::Coding => "coding",
            Self::RunningTests => "running_tests",
            Self::WaitingApproval => "waiting_approval",
            Self::Blocked => "blocked",
            Self::Idle => "idle",
            Self::Done => "done",
            Self::Error => "error",
        }
    }
}

impl FromStr for AgentRunStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "spawning" => Ok(Self::Spawning),
            "thinking" => Ok(Self::Thinking),
            "coding" => Ok(Self::Coding),
            "running_tests" => Ok(Self::RunningTests),
            "waiting_approval" | "waiting" => Ok(Self::WaitingApproval),
            "blocked" => Ok(Self::Blocked),
            "idle" => Ok(Self::Idle),
            "done" => Ok(Self::Done),
            "error" => Ok(Self::Error),
            other => Err(format!("unknown agent run status: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_contract_names() {
        let variants = [
            AgentRunStatus::Spawning,
            AgentRunStatus::Thinking,
            AgentRunStatus::Coding,
            AgentRunStatus::RunningTests,
            AgentRunStatus::WaitingApproval,
            AgentRunStatus::Blocked,
            AgentRunStatus::Idle,
            AgentRunStatus::Done,
            AgentRunStatus::Error,
        ];

        let names: Vec<String> = variants
            .into_iter()
            .map(|status| {
                serde_json::to_value(status)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();

        assert_eq!(names, AGENT_RUN_STATUS_NAMES);
    }

    #[test]
    fn parses_legacy_waiting_as_waiting_approval() {
        assert_eq!(
            AgentRunStatus::from_str("waiting").unwrap(),
            AgentRunStatus::WaitingApproval
        );
    }
}
