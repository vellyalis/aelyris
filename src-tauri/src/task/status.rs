use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Canonical Task Graph lifecycle states.
///
/// See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
/// Requirement 4 (Task Graph). Mirrored in TS by
/// `src/shared/types/taskStatus.ts` and kept in lockstep by
/// `src/__tests__/taskStatusContract.test.ts`.
pub const TASK_STATUS_NAMES: [&str; 7] = [
    "pending", "ready", "running", "blocked", "review", "done", "failed",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    /// Created, dependencies not yet satisfied.
    Pending,
    /// Dependencies satisfied; eligible for an agent to pick up.
    Ready,
    /// An agent is actively working the task.
    Running,
    /// Cannot proceed (missing input, conflict, external wait).
    Blocked,
    /// Implementation complete; awaiting Reviewer verdict.
    Review,
    /// Reviewed and merged (terminal, success).
    Done,
    /// Abandoned after failure (terminal, unless re-planned to Pending).
    Failed,
}

impl TaskStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Running => "running",
            Self::Blocked => "blocked",
            Self::Review => "review",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }

    /// Terminal states never transition further on their own (a re-plan may
    /// move `Failed` back to `Pending`, which `can_transition` allows).
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Failed)
    }

    /// Whether `self -> to` is a legal lifecycle transition. The graph keeps
    /// the orchestrator from making nonsensical jumps (e.g. `Done -> Running`
    /// or `Pending -> Done`) while leaving the orchestrator free to choose the
    /// path (e.g. route through `Review` or not).
    pub fn can_transition(self, to: TaskStatus) -> bool {
        use TaskStatus::*;
        matches!(
            (self, to),
            (Pending, Ready)
                | (Pending, Blocked)
                | (Pending, Failed)
                | (Ready, Running)
                | (Ready, Blocked)
                | (Ready, Failed)
                | (Running, Review)
                | (Running, Done)
                | (Running, Blocked)
                | (Running, Failed)
                | (Blocked, Ready)
                | (Blocked, Running)
                | (Blocked, Failed)
                | (Review, Done)
                | (Review, Running)
                | (Review, Failed)
                | (Failed, Pending)
        )
    }
}

impl FromStr for TaskStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "ready" => Ok(Self::Ready),
            "running" => Ok(Self::Running),
            "blocked" => Ok(Self::Blocked),
            "review" => Ok(Self::Review),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            other => Err(format!("unknown task status: {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [TaskStatus; 7] = [
        TaskStatus::Pending,
        TaskStatus::Ready,
        TaskStatus::Running,
        TaskStatus::Blocked,
        TaskStatus::Review,
        TaskStatus::Done,
        TaskStatus::Failed,
    ];

    #[test]
    fn serializes_to_contract_names() {
        let names: Vec<String> = ALL
            .into_iter()
            .map(|status| {
                serde_json::to_value(status)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(names, TASK_STATUS_NAMES);
    }

    #[test]
    fn as_str_matches_serde_and_from_str_roundtrips() {
        for status in ALL {
            assert_eq!(TaskStatus::from_str(status.as_str()).unwrap(), status);
        }
    }

    #[test]
    fn from_str_rejects_unknown() {
        assert!(TaskStatus::from_str("merged").is_err());
    }

    #[test]
    fn only_done_and_failed_are_terminal() {
        for status in ALL {
            let terminal = matches!(status, TaskStatus::Done | TaskStatus::Failed);
            assert_eq!(status.is_terminal(), terminal, "{status:?}");
        }
    }

    #[test]
    fn dependency_gate_path_is_legal() {
        // The canonical happy path a dependency-gated task walks.
        assert!(TaskStatus::Pending.can_transition(TaskStatus::Ready));
        assert!(TaskStatus::Ready.can_transition(TaskStatus::Running));
        assert!(TaskStatus::Running.can_transition(TaskStatus::Review));
        assert!(TaskStatus::Review.can_transition(TaskStatus::Done));
    }

    #[test]
    fn rejects_nonsensical_transitions() {
        assert!(!TaskStatus::Done.can_transition(TaskStatus::Running));
        assert!(!TaskStatus::Pending.can_transition(TaskStatus::Done));
        assert!(!TaskStatus::Pending.can_transition(TaskStatus::Running));
        assert!(!TaskStatus::Failed.can_transition(TaskStatus::Done));
        assert!(!TaskStatus::Review.can_transition(TaskStatus::Pending));
    }

    #[test]
    fn blocked_can_resume_and_failed_can_replan() {
        assert!(TaskStatus::Blocked.can_transition(TaskStatus::Ready));
        assert!(TaskStatus::Blocked.can_transition(TaskStatus::Running));
        assert!(TaskStatus::Failed.can_transition(TaskStatus::Pending));
    }
}
