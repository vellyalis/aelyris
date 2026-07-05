use crate::proofbook::ledger::{self, ProofbookGateDecision, ProofbookStepOutcome};
use crate::proofbook::ProofbookStep;
use serde_json::json;

pub fn wait_for_manual_gate(run_id: &str, step: &ProofbookStep) -> ProofbookStepOutcome {
    let gate_id = crate::proofbook::step_shell::string_param(step, "gateId")
        .unwrap_or_else(|| format!("pb-gate-{run_id}-{}", step.id));
    let options = string_list_param(step, "options");
    let default_option = crate::proofbook::step_shell::string_param(step, "default")
        .unwrap_or_else(|| "reject".to_string());
    let risk = crate::proofbook::step_shell::string_param(step, "risk")
        .unwrap_or_else(|| "medium".to_string());
    let evidence = crate::proofbook::step_shell::string_param(step, "evidence")
        .unwrap_or_else(|| "Manual Proofbook gate requires operator decision.".to_string());
    let gate_hash = gate_hash(
        &gate_id,
        &step.id,
        &options,
        &default_option,
        &risk,
        &evidence,
    );

    ProofbookStepOutcome::waiting_gate(
        json!({
            "gateId": gate_id,
            "gateHash": gate_hash,
            "kind": "manualGate",
            "options": if options.is_empty() { vec!["approve".to_string(), "reject".to_string()] } else { options },
            "default": default_option,
            "risk": risk,
            "evidence": evidence,
        }),
        Some(json!({ "risk": risk })),
    )
}

pub fn gate_hash(
    gate_id: &str,
    step_id: &str,
    options: &[String],
    default_option: &str,
    risk: &str,
    evidence: &str,
) -> String {
    let body = format!(
        "{gate_id}\n{step_id}\n{}\n{default_option}\n{risk}\n{evidence}",
        options.join("|")
    );
    format!("sha256:{}", ledger::hash_bytes(body.as_bytes()))
}

pub fn decision(
    gate_id: String,
    gate_hash: String,
    step_id: String,
    decision: String,
    actor: Option<String>,
    comment: Option<String>,
) -> ProofbookGateDecision {
    ProofbookGateDecision {
        gate_id,
        gate_hash,
        step_id,
        decision,
        actor: actor.unwrap_or_else(|| "operator".to_string()),
        comment: comment.unwrap_or_default(),
        decided_at: ledger::now_timestamp(),
    }
}

fn string_list_param(step: &ProofbookStep, key: &str) -> Vec<String> {
    match step.params.get(key) {
        Some(serde_yaml::Value::Sequence(items)) => items
            .iter()
            .filter_map(|item| match item {
                serde_yaml::Value::String(value) => Some(value.clone()),
                _ => None,
            })
            .collect(),
        Some(serde_yaml::Value::String(value)) => vec![value.clone()],
        _ => Vec::new(),
    }
}
