use serde::{Deserialize, Serialize};

/// A complete workflow definition (parsed from YAML)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub name: String,
    pub description: String,
    pub phases: Vec<Phase>,
}

/// A single phase in a workflow pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase {
    pub name: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub agent: AgentConfig,
    #[serde(default)]
    pub quality_gate: Option<QualityGate>,
}

/// Agent configuration for a phase
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default = "default_model")]
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default = "default_max_cost")]
    pub max_cost: f64,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_model() -> String { "sonnet".to_string() }
fn default_max_cost() -> f64 { 2.0 }
fn default_timeout() -> u64 { 600 }

/// Quality gate between phases
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityGate {
    #[serde(rename = "type")]
    pub gate_type: GateType,
    #[serde(default)]
    pub criteria: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateType {
    TestPass,
    BuildSuccess,
    HumanReview,
    AgentReview,
    Custom,
}

// ── Runtime state ──

/// Status of a running workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStatus {
    pub id: String,
    pub workflow_name: String,
    pub task_title: String,
    pub current_phase: usize,
    pub phases: Vec<PhaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseResult {
    pub name: String,
    pub status: PhaseStatus,
    pub agent_session_id: Option<String>,
    pub cost: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseStatus {
    Pending,
    Running,
    WaitingGate,
    Passed,
    Failed,
    Skipped,
}
