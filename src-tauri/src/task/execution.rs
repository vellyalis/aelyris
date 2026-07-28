use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionRuntime {
    Headless,
    VisiblePty,
}

impl ExecutionRuntime {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Headless => "headless",
            Self::VisiblePty => "visible_pty",
        }
    }
}

impl FromStr for ExecutionRuntime {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "headless" => Ok(Self::Headless),
            "visible_pty" => Ok(Self::VisiblePty),
            other => Err(format!("unknown execution runtime: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionEffect {
    Reservation,
    FirstEffect,
    Spawn,
    Review,
    CandidateFreeze,
    Merge,
    Finalization,
}

impl ExecutionEffect {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reservation => "reservation",
            Self::FirstEffect => "first_effect",
            Self::Spawn => "spawn",
            Self::Review => "review",
            Self::CandidateFreeze => "candidate_freeze",
            Self::Merge => "merge",
            Self::Finalization => "finalization",
        }
    }
}

impl FromStr for ExecutionEffect {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "reservation" => Ok(Self::Reservation),
            "first_effect" => Ok(Self::FirstEffect),
            "spawn" => Ok(Self::Spawn),
            "review" => Ok(Self::Review),
            "candidate_freeze" => Ok(Self::CandidateFreeze),
            "merge" => Ok(Self::Merge),
            "finalization" => Ok(Self::Finalization),
            other => Err(format!("unknown execution effect: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionFenceState {
    Reserved,
    EffectStarted,
    Committed,
    NeedsReconcile,
}

impl ExecutionFenceState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::EffectStarted => "effect_started",
            Self::Committed => "committed",
            Self::NeedsReconcile => "needs_reconcile",
        }
    }
}

impl FromStr for ExecutionFenceState {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "reserved" => Ok(Self::Reserved),
            "effect_started" => Ok(Self::EffectStarted),
            "committed" => Ok(Self::Committed),
            "needs_reconcile" => Ok(Self::NeedsReconcile),
            other => Err(format!("unknown execution fence state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkExecutionState {
    Reserved,
    Running,
    Review,
    MergeReady,
    Completed,
    Failed,
    NeedsReconcile,
}

impl WorkExecutionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Running => "running",
            Self::Review => "review",
            Self::MergeReady => "merge_ready",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::NeedsReconcile => "needs_reconcile",
        }
    }

    pub const fn allows_successor(self) -> bool {
        matches!(self, Self::Failed)
    }
}

impl FromStr for WorkExecutionState {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "reserved" => Ok(Self::Reserved),
            "running" => Ok(Self::Running),
            "review" => Ok(Self::Review),
            "merge_ready" => Ok(Self::MergeReady),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "needs_reconcile" => Ok(Self::NeedsReconcile),
            other => Err(format!("unknown work execution state: {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionIdentity {
    pub attempt_id: String,
    pub task_id: String,
    pub execution_generation: u64,
    pub agent_run_id: String,
    pub process_generation: u64,
    pub session_id: String,
    pub pty_session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionFence {
    pub effect: ExecutionEffect,
    pub state: ExecutionFenceState,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkExecutionAttempt {
    #[serde(flatten)]
    pub identity: ExecutionIdentity,
    /// Repository root supplied to the dispatch boundary. It is immutable for
    /// the generation so startup can inspect the exact worktree namespace
    /// instead of guessing a root from a branch name.
    pub repo_path: String,
    pub runtime: ExecutionRuntime,
    pub state: WorkExecutionState,
    pub fence: ExecutionFence,
    pub ownership_claim_ids: Vec<String>,
    pub reservation_event_id: String,
    pub merge_intent_id: Option<String>,
    pub last_error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl WorkExecutionAttempt {
    pub fn token(&self) -> ExecutionToken {
        ExecutionToken {
            attempt_id: self.identity.attempt_id.clone(),
            task_id: self.identity.task_id.clone(),
            execution_generation: self.identity.execution_generation,
            agent_run_id: self.identity.agent_run_id.clone(),
            process_generation: self.identity.process_generation,
            session_id: self.identity.session_id.clone(),
            pty_session_id: self.identity.pty_session_id.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionToken {
    pub attempt_id: String,
    pub task_id: String,
    pub execution_generation: u64,
    pub agent_run_id: String,
    pub process_generation: u64,
    pub session_id: String,
    pub pty_session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ExecutionReservation {
    pub task_id: String,
    pub repo_path: String,
    pub runtime: ExecutionRuntime,
    pub ownership_claim_ids: Vec<String>,
    pub now: u64,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ExecutionFenceError {
    #[error("execution fence persistence failed: {0}")]
    Persistence(String),
    #[error("execution attempt not found for task {0}")]
    NotFound(String),
    #[error(
        "stale execution generation for task {task_id}: attempted {attempted}, current {current}"
    )]
    StaleGeneration {
        task_id: String,
        attempted: u64,
        current: u64,
    },
    #[error("task {task_id} has unresolved execution attempt {attempt_id} in state {state}")]
    ActiveAttempt {
        task_id: String,
        attempt_id: String,
        state: String,
    },
    #[error("invalid execution fence transition: {0}")]
    InvalidTransition(String),
}

impl From<String> for ExecutionFenceError {
    fn from(message: String) -> Self {
        Self::Persistence(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_contract_names_round_trip() {
        for value in [
            ExecutionEffect::Reservation,
            ExecutionEffect::FirstEffect,
            ExecutionEffect::Spawn,
            ExecutionEffect::Review,
            ExecutionEffect::CandidateFreeze,
            ExecutionEffect::Merge,
            ExecutionEffect::Finalization,
        ] {
            assert_eq!(ExecutionEffect::from_str(value.as_str()).unwrap(), value);
        }
        for value in [
            WorkExecutionState::Reserved,
            WorkExecutionState::Running,
            WorkExecutionState::Review,
            WorkExecutionState::MergeReady,
            WorkExecutionState::Completed,
            WorkExecutionState::Failed,
            WorkExecutionState::NeedsReconcile,
        ] {
            assert_eq!(WorkExecutionState::from_str(value.as_str()).unwrap(), value);
        }
    }
}
