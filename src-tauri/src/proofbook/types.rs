use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PROOFBOOK_SCHEMA_V1: &str = "aelyris.proofbook.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookDefinition {
    #[serde(default)]
    pub schema: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, ProofbookInputSpec>,
    #[serde(default)]
    pub secrets: BTreeMap<String, ProofbookSecretRef>,
    #[serde(default)]
    pub steps: Vec<ProofbookStep>,
    #[serde(default)]
    pub settlement: Option<ProofbookSettlement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookInputSpec {
    #[serde(rename = "type", default)]
    pub input_type: String,
    #[serde(default)]
    pub default: Option<serde_yaml::Value>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSecretRef {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub value: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookStep {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(flatten, default)]
    pub params: BTreeMap<String, serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSettlement {
    #[serde(default)]
    pub required_steps: Vec<String>,
    #[serde(default)]
    pub required_artifacts: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProofbookStepKind {
    Shell,
    Verifier,
    McpTool,
    AgentSession,
    Http,
    ManualGate,
    WaitFor,
    FanOut,
    SubProofbook,
    #[serde(rename = "evidence.write")]
    EvidenceWrite,
    #[serde(rename = "evidence.read")]
    EvidenceRead,
}

impl ProofbookStepKind {
    pub fn from_wire(value: &str) -> Option<Self> {
        Some(match value {
            "shell" => Self::Shell,
            "verifier" => Self::Verifier,
            "mcpTool" => Self::McpTool,
            "agentSession" => Self::AgentSession,
            "http" => Self::Http,
            "manualGate" => Self::ManualGate,
            "waitFor" => Self::WaitFor,
            "fanOut" => Self::FanOut,
            "subProofbook" => Self::SubProofbook,
            "evidence.write" => Self::EvidenceWrite,
            "evidence.read" => Self::EvidenceRead,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookSummary {
    pub id: String,
    pub title: String,
    pub path: String,
    pub step_count: usize,
    pub valid: bool,
    pub error_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookValidationReport {
    pub definition_id: Option<String>,
    pub path: String,
    pub valid: bool,
    pub errors: Vec<crate::proofbook::ProofbookError>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proofbook_step_kind_round_trips_special_wire_names() {
        let evidence = serde_json::to_string(&ProofbookStepKind::EvidenceWrite).unwrap();
        assert_eq!(evidence, "\"evidence.write\"");
        let back: ProofbookStepKind = serde_json::from_str(&evidence).unwrap();
        assert_eq!(back, ProofbookStepKind::EvidenceWrite);

        let mcp = serde_json::to_string(&ProofbookStepKind::McpTool).unwrap();
        assert_eq!(mcp, "\"mcpTool\"");
        let back: ProofbookStepKind = serde_json::from_str(&mcp).unwrap();
        assert_eq!(back, ProofbookStepKind::McpTool);
    }

    #[test]
    fn proofbook_validation_report_uses_camel_case_and_omits_empty_error_fields() {
        let report = ProofbookValidationReport {
            definition_id: Some("release-closeout".to_string()),
            path: "C:/repo/.aelyris/proofbooks/release.proofbook.yaml".to_string(),
            valid: false,
            errors: vec![crate::proofbook::ProofbookError::runtime_not_available(
                "run",
            )],
        };

        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(value["definitionId"], "release-closeout");
        assert_eq!(value["errors"][0]["code"], "runtime_not_available");
        assert!(value["errors"][0].get("definitionId").is_none());
    }
}
