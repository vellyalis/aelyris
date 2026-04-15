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
    fn workflow_status_initial_state() {
        let status = WorkflowStatus {
            id: "wf-1".to_string(),
            workflow_name: "test".to_string(),
            task_title: "Fix bug".to_string(),
            current_phase: 0,
            phases: vec![
                PhaseResult { name: "plan".to_string(), status: PhaseStatus::Pending, agent_session_id: None, cost: 0.0 },
                PhaseResult { name: "fix".to_string(), status: PhaseStatus::Pending, agent_session_id: None, cost: 0.0 },
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
