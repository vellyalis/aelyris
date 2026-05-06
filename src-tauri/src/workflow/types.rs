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
    /// Optional terminal pane target. Examples: "@build", "role:test", "Review Pane".
    #[serde(default, alias = "targetPane")]
    pub target_pane: Option<String>,
    /// Optional Orchestra/Conductor role used for headless agent tracking.
    #[serde(default, alias = "agentRole")]
    pub agent_role: Option<String>,
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

fn default_model() -> String {
    "sonnet".to_string()
}
fn default_max_cost() -> f64 {
    2.0
}
fn default_timeout() -> u64 {
    600
}

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
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub resume_point: Option<WorkflowResumePoint>,
    #[serde(default)]
    pub final_report: Option<String>,
    pub phases: Vec<PhaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhaseResult {
    pub name: String,
    pub status: PhaseStatus,
    pub agent_session_id: Option<String>,
    pub target_pane: Option<String>,
    pub agent_role: Option<String>,
    pub cost: f64,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub retry_count: u32,
    #[serde(default)]
    pub artifacts: Vec<WorkflowArtifact>,
    #[serde(default)]
    pub commands: Vec<WorkflowCommandRecord>,
    #[serde(default)]
    pub validation: Vec<WorkflowValidationRecord>,
    #[serde(default)]
    pub final_report: Option<String>,
    #[serde(default)]
    pub decision_request: Option<WorkflowDecisionRequest>,
    #[serde(default)]
    pub gate_decision: Option<WorkflowGateDecision>,
    #[serde(default)]
    pub split_from: Option<String>,
    #[serde(default)]
    pub split_reason: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResumePoint {
    pub phase_index: usize,
    pub phase_name: String,
    pub reason: String,
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowArtifact {
    pub path: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowCommandRecord {
    pub command: String,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowValidationRecord {
    pub command: String,
    pub status: String,
    #[serde(default)]
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDecisionRequest {
    pub kind: String,
    pub reason: String,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub default_option: Option<String>,
    pub requested_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowGateDecision {
    pub decision: GateDecisionKind,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub conditional: bool,
    pub decided_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateDecisionKind {
    Approved,
    Rejected,
    Conditional,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_workflow_yaml() {
        let yaml = r#"
name: Test Workflow
description: A test workflow
phases:
  - name: plan
    target_pane: "@plan"
    agent_role: implementer
    agent:
      model: opus
      prompt: "Create a plan"
      max_cost: 0.5
    quality_gate:
      type: human_review
  - name: implement
    depends_on: [plan]
    agent:
      prompt: "Implement the plan"
"#;
        let wf: Workflow = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(wf.name, "Test Workflow");
        assert_eq!(wf.phases.len(), 2);
        assert_eq!(wf.phases[0].name, "plan");
        assert_eq!(wf.phases[0].target_pane.as_deref(), Some("@plan"));
        assert_eq!(wf.phases[0].agent_role.as_deref(), Some("implementer"));
        assert_eq!(wf.phases[0].agent.model, "opus");
        assert_eq!(wf.phases[0].agent.max_cost, 0.5);
        assert!(wf.phases[0].quality_gate.is_some());
        assert_eq!(wf.phases[1].depends_on, vec!["plan"]);
        assert_eq!(wf.phases[1].agent.model, "sonnet"); // default
        assert_eq!(wf.phases[1].agent.max_cost, 2.0); // default
    }

    #[test]
    fn parse_phase_status_serialization() {
        let json = serde_json::to_string(&PhaseStatus::WaitingGate).unwrap();
        assert_eq!(json, "\"waiting_gate\"");
        let back: PhaseStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back, PhaseStatus::WaitingGate);
    }

    #[test]
    fn parse_gate_type_variants() {
        let yaml_test = "type: test_pass";
        let gate: QualityGate = serde_yaml::from_str(yaml_test).unwrap();
        assert!(matches!(gate.gate_type, GateType::TestPass));

        let yaml_human = "type: human_review";
        let gate: QualityGate = serde_yaml::from_str(yaml_human).unwrap();
        assert!(matches!(gate.gate_type, GateType::HumanReview));
    }

    #[test]
    fn parse_phase_routing_aliases() {
        let yaml = r#"
name: build
targetPane: "@build"
agentRole: implementer
agent:
  prompt: "Build it"
"#;
        let phase: Phase = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(phase.target_pane.as_deref(), Some("@build"));
        assert_eq!(phase.agent_role.as_deref(), Some("implementer"));
    }

    #[test]
    fn workflow_status_initial_state() {
        let status = WorkflowStatus {
            id: "wf-1".to_string(),
            workflow_name: "test".to_string(),
            task_title: "Fix bug".to_string(),
            current_phase: 0,
            started_at: "0".to_string(),
            updated_at: "0".to_string(),
            resume_point: None,
            final_report: None,
            phases: vec![
                PhaseResult {
                    name: "plan".to_string(),
                    status: PhaseStatus::Pending,
                    agent_session_id: None,
                    target_pane: Some("@plan".to_string()),
                    agent_role: Some("implementer".to_string()),
                    cost: 0.0,
                    started_at: None,
                    completed_at: None,
                    duration_ms: None,
                    retry_count: 0,
                    artifacts: Vec::new(),
                    commands: Vec::new(),
                    validation: Vec::new(),
                    final_report: None,
                    decision_request: None,
                    gate_decision: None,
                    split_from: None,
                    split_reason: None,
                    blocked_reason: None,
                },
                PhaseResult {
                    name: "fix".to_string(),
                    status: PhaseStatus::Pending,
                    agent_session_id: None,
                    target_pane: None,
                    agent_role: None,
                    cost: 0.0,
                    started_at: None,
                    completed_at: None,
                    duration_ms: None,
                    retry_count: 0,
                    artifacts: Vec::new(),
                    commands: Vec::new(),
                    validation: Vec::new(),
                    final_report: None,
                    decision_request: None,
                    gate_decision: None,
                    split_from: None,
                    split_reason: None,
                    blocked_reason: None,
                },
            ],
        };
        assert_eq!(status.phases.len(), 2);
        assert_eq!(status.phases[0].status, PhaseStatus::Pending);
        assert_eq!(status.current_phase, 0);
    }

    #[test]
    fn agent_config_defaults() {
        let yaml = r#"
prompt: "Do something"
"#;
        let config: AgentConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.model, "sonnet");
        assert_eq!(config.max_cost, 2.0);
        assert_eq!(config.timeout_secs, 600);
        assert!(config.allowed_tools.is_empty());
    }
}
