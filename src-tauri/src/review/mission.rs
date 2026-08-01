//! A7.3 exact-OID Mission review. The caller supplies no reviewer identity or
//! model choice. Independence is computed only after the fixed backend adapter
//! returns an attestation for a real invocation, and is bound to the durable
//! builder execution rather than to caller-shaped or randomly asserted names.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::task::mission::AcceptanceClause;
use crate::task::{MissionGateEvidence, MissionPlanActivation, MissionPlanPreview};

pub const MISSION_REVIEW_SCHEMA: &str = "aelyris.review_record/v1";
pub const REVIEW_INDEPENDENCE_SCHEMA: &str = "aelyris.reviewer_independence_proof/v1";
pub const REVIEW_POLICY_VERSION: &str = "a7-core-reviewer-independence/v1";
pub const REVIEW_EVIDENCE_MAX_AGE_MS: u64 = 300_000;
pub const REVIEWER_INVOCATION_RECEIPT_SCHEMA: &str =
    "aelyris.mission_reviewer_invocation_receipt/v1";
pub(crate) const A7_REVIEW_PROVIDER: &str = "codex";
pub(crate) const A7_REVIEW_MODEL: &str = "gpt-5.6-sol";
pub(crate) const A7_REVIEW_ADAPTER_VERSION: &str = "aelyris.a7-codex-review-adapter/v1";
pub(crate) const A7_REVIEW_RUNTIME: &str = "headless_fixed_reviewer";
pub(crate) const A7_BUILDER_ADAPTER: &str = "codex-no-hooks";
pub(crate) const A7_BUILDER_PROVIDER: &str = "codex";
pub(crate) const UNOBSERVED_MODEL_ID: &str = "unknown/unobserved";
pub(crate) const A7_REVIEW_OUTPUT_SCHEMA: &str = r#"{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "aelyris.a7-review-model-response/v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["clauseCoverage", "findings"],
  "properties": {
    "clauseCoverage": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["clauseId", "accepted", "reason"],
        "properties": {
          "clauseId": { "type": "string" },
          "accepted": { "type": "boolean" },
          "reason": { "type": "string" }
        }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["clauseId", "message"],
        "properties": {
          "clauseId": { "type": ["string", "null"] },
          "message": { "type": "string" }
        }
      }
    }
  }
}"#;

pub(crate) fn a7_review_argv_contract_digest() -> String {
    sha256_json(&(
        [
            "exec",
            "-m",
            A7_REVIEW_MODEL,
            "--ephemeral",
            "--ignore-user-config",
            "-s",
            "read-only",
            "--skip-git-repo-check",
            "--output-schema",
            "<OUTPUT_SCHEMA_FILE>",
            "<PROMPT>",
        ],
        sha256_text(A7_REVIEW_OUTPUT_SCHEMA),
    ))
    .expect("fixed reviewer argv contract is serializable")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionedRef {
    pub id: String,
    pub contract_version: String,
    pub content_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceRefV2 {
    pub evidence_id: String,
    pub kind: String,
    pub locator: String,
    pub content_digest_algorithm: String,
    pub content_digest: String,
    pub produced_by_event_id: String,
    pub environment_fingerprint: Option<String>,
    pub base_oid: Option<String>,
    pub head_oid: Option<String>,
    pub generated_at_unix_ms: u64,
    pub valid_until_unix_ms: Option<u64>,
    pub redaction_count: u32,
    pub provenance: VersionedRef,
    pub integrity: VersionedRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeInvocationAttestation {
    pub principal_id: String,
    pub logical_session_id: String,
    pub provider: String,
    pub model_ref: VersionedRef,
    pub invocation_id: String,
    pub lineage_ref: VersionedRef,
    pub ancestor_lineage_ids: Vec<String>,
    pub runtime_domain_id: String,
}

/// Sealed evidence from the fixed reviewer process. Fields are private, the type
/// is not deserializable, and production construction validates the fixed A7
/// adapter contract plus a successful real process result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewerInvocationReceipt {
    schema: String,
    receipt_id: String,
    invocation_id: String,
    provider: String,
    model: String,
    adapter_version: String,
    runtime_domain_id: String,
    command_fingerprint: String,
    argv_contract_digest: String,
    canonical_response_json: String,
    response_digest: String,
    started_at_unix_ms: u64,
    ended_at_unix_ms: u64,
    exit_code: i32,
    status: String,
    lineage_ref: VersionedRef,
    principal_id: String,
    logical_session_id: String,
    ancestor_lineage_ids: Vec<String>,
    receipt_digest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptDigest<'a> {
    schema: &'a str,
    receipt_id: &'a str,
    invocation_id: &'a str,
    provider: &'a str,
    model: &'a str,
    adapter_version: &'a str,
    runtime_domain_id: &'a str,
    command_fingerprint: &'a str,
    argv_contract_digest: &'a str,
    canonical_response_json: &'a str,
    response_digest: &'a str,
    started_at_unix_ms: u64,
    ended_at_unix_ms: u64,
    exit_code: i32,
    status: &'a str,
    lineage_ref: &'a VersionedRef,
    principal_id: &'a str,
    logical_session_id: &'a str,
    ancestor_lineage_ids: &'a [String],
}

impl ReviewerInvocationReceipt {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_successful_fixed_process(
        invocation_id: String,
        command_fingerprint: String,
        argv_contract_digest: String,
        response: &str,
        started_at_unix_ms: u64,
        ended_at_unix_ms: u64,
        exit_code: i32,
        status: &str,
    ) -> Result<Self, String> {
        let canonical_response_json = canonicalize_model_response(response)?;
        let receipt_id = uuid::Uuid::now_v7().to_string();
        let lineage_id = format!("codex-exec:{invocation_id}");
        let mut receipt = Self {
            schema: REVIEWER_INVOCATION_RECEIPT_SCHEMA.to_string(),
            receipt_id,
            invocation_id: invocation_id.clone(),
            provider: A7_REVIEW_PROVIDER.to_string(),
            model: A7_REVIEW_MODEL.to_string(),
            adapter_version: A7_REVIEW_ADAPTER_VERSION.to_string(),
            runtime_domain_id: A7_REVIEW_RUNTIME.to_string(),
            command_fingerprint,
            argv_contract_digest,
            response_digest: sha256_text(&canonical_response_json),
            canonical_response_json,
            started_at_unix_ms,
            ended_at_unix_ms,
            exit_code,
            status: status.to_string(),
            lineage_ref: VersionedRef {
                id: lineage_id.clone(),
                contract_version: A7_REVIEW_ADAPTER_VERSION.to_string(),
                content_digest: sha256_text(&lineage_id),
            },
            principal_id: invocation_id.clone(),
            logical_session_id: invocation_id,
            ancestor_lineage_ids: Vec::new(),
            receipt_digest: String::new(),
        };
        receipt.receipt_digest = receipt.canonical_digest()?;
        receipt.validate()?;
        Ok(receipt)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_durable_row(
        schema: String,
        receipt_id: String,
        invocation_id: String,
        provider: String,
        model: String,
        adapter_version: String,
        runtime_domain_id: String,
        command_fingerprint: String,
        argv_contract_digest: String,
        canonical_response_json: String,
        response_digest: String,
        started_at_unix_ms: u64,
        ended_at_unix_ms: u64,
        exit_code: i32,
        status: String,
        lineage_ref: VersionedRef,
        principal_id: String,
        logical_session_id: String,
        ancestor_lineage_ids: Vec<String>,
        receipt_digest: String,
    ) -> Result<Self, String> {
        let receipt = Self {
            schema,
            receipt_id,
            invocation_id,
            provider,
            model,
            adapter_version,
            runtime_domain_id,
            command_fingerprint,
            argv_contract_digest,
            canonical_response_json,
            response_digest,
            started_at_unix_ms,
            ended_at_unix_ms,
            exit_code,
            status,
            lineage_ref,
            principal_id,
            logical_session_id,
            ancestor_lineage_ids,
            receipt_digest,
        };
        receipt.validate()?;
        Ok(receipt)
    }

    fn canonical_digest(&self) -> Result<String, String> {
        sha256_json(&ReceiptDigest {
            schema: &self.schema,
            receipt_id: &self.receipt_id,
            invocation_id: &self.invocation_id,
            provider: &self.provider,
            model: &self.model,
            adapter_version: &self.adapter_version,
            runtime_domain_id: &self.runtime_domain_id,
            command_fingerprint: &self.command_fingerprint,
            argv_contract_digest: &self.argv_contract_digest,
            canonical_response_json: &self.canonical_response_json,
            response_digest: &self.response_digest,
            started_at_unix_ms: self.started_at_unix_ms,
            ended_at_unix_ms: self.ended_at_unix_ms,
            exit_code: self.exit_code,
            status: &self.status,
            lineage_ref: &self.lineage_ref,
            principal_id: &self.principal_id,
            logical_session_id: &self.logical_session_id,
            ancestor_lineage_ids: &self.ancestor_lineage_ids,
        })
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_versioned_ref(&self.lineage_ref, "reviewer receipt lineage")?;
        if self.schema != REVIEWER_INVOCATION_RECEIPT_SCHEMA
            || self.provider != A7_REVIEW_PROVIDER
            || self.model != A7_REVIEW_MODEL
            || self.adapter_version != A7_REVIEW_ADAPTER_VERSION
            || self.runtime_domain_id != A7_REVIEW_RUNTIME
            || self.receipt_id.trim().is_empty()
            || self.invocation_id.trim().is_empty()
            || self.principal_id != self.invocation_id
            || self.logical_session_id != self.invocation_id
            || self.lineage_ref.id != format!("codex-exec:{}", self.invocation_id)
            || self.lineage_ref.contract_version != A7_REVIEW_ADAPTER_VERSION
            || !is_sha256(&self.command_fingerprint)
            || self.argv_contract_digest != a7_review_argv_contract_digest()
            || canonicalize_model_response(&self.canonical_response_json)?
                != self.canonical_response_json
            || self.response_digest != sha256_text(&self.canonical_response_json)
            || self.ended_at_unix_ms < self.started_at_unix_ms
            || self.exit_code != 0
            || self.status != "exited"
            || self.receipt_digest != self.canonical_digest()?
        {
            return Err(
                "reviewer invocation receipt violates the fixed process contract".to_string(),
            );
        }
        Ok(())
    }

    pub fn receipt_id(&self) -> &str {
        &self.receipt_id
    }
    pub fn invocation_id(&self) -> &str {
        &self.invocation_id
    }
    pub fn provider(&self) -> &str {
        &self.provider
    }
    pub fn model(&self) -> &str {
        &self.model
    }
    pub fn adapter_version(&self) -> &str {
        &self.adapter_version
    }
    pub fn runtime_domain_id(&self) -> &str {
        &self.runtime_domain_id
    }
    pub fn command_fingerprint(&self) -> &str {
        &self.command_fingerprint
    }
    pub fn argv_contract_digest(&self) -> &str {
        &self.argv_contract_digest
    }
    pub fn canonical_response_json(&self) -> &str {
        &self.canonical_response_json
    }
    pub fn response_digest(&self) -> &str {
        &self.response_digest
    }
    pub fn started_at_unix_ms(&self) -> u64 {
        self.started_at_unix_ms
    }
    pub fn ended_at_unix_ms(&self) -> u64 {
        self.ended_at_unix_ms
    }
    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }
    pub fn status(&self) -> &str {
        &self.status
    }
    pub fn lineage_ref(&self) -> &VersionedRef {
        &self.lineage_ref
    }
    pub fn principal_id(&self) -> &str {
        &self.principal_id
    }
    pub fn logical_session_id(&self) -> &str {
        &self.logical_session_id
    }
    pub fn ancestor_lineage_ids(&self) -> &[String] {
        &self.ancestor_lineage_ids
    }
    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    pub fn receipt_ref(&self) -> VersionedRef {
        VersionedRef {
            id: self.receipt_id.clone(),
            contract_version: REVIEWER_INVOCATION_RECEIPT_SCHEMA.to_string(),
            content_digest: self.receipt_digest.clone(),
        }
    }

    pub(crate) fn runtime_attestation(&self) -> RuntimeInvocationAttestation {
        RuntimeInvocationAttestation {
            principal_id: self.principal_id.clone(),
            logical_session_id: self.logical_session_id.clone(),
            provider: self.provider.clone(),
            model_ref: VersionedRef {
                id: self.model.clone(),
                contract_version: self.adapter_version.clone(),
                content_digest: sha256_text(&self.model),
            },
            invocation_id: self.invocation_id.clone(),
            lineage_ref: self.lineage_ref.clone(),
            ancestor_lineage_ids: self.ancestor_lineage_ids.clone(),
            runtime_domain_id: self.runtime_domain_id.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewerInvocation {
    receipt: ReviewerInvocationReceipt,
}

impl ReviewerInvocation {
    pub(crate) fn from_receipt(receipt: ReviewerInvocationReceipt) -> Self {
        Self { receipt }
    }

    pub fn receipt(&self) -> &ReviewerInvocationReceipt {
        &self.receipt
    }

    #[cfg(test)]
    pub(crate) fn test_only(response: &str) -> Self {
        let invocation_id = uuid::Uuid::now_v7().to_string();
        let receipt = ReviewerInvocationReceipt::from_successful_fixed_process(
            invocation_id,
            sha256_text("test-fixed-command"),
            a7_review_argv_contract_digest(),
            response,
            1,
            2,
            0,
            "exited",
        )
        .expect("test reviewer receipt");
        Self { receipt }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewerIndependenceProof {
    pub schema: String,
    pub policy_version: String,
    pub reviewer_principal_id: String,
    pub builder_principal_id: String,
    pub reviewer_logical_session_id: String,
    pub builder_logical_session_id: String,
    pub reviewer_provider: String,
    pub builder_provider: String,
    pub reviewer_model_ref: VersionedRef,
    pub builder_model_ref: VersionedRef,
    pub reviewer_invocation_id: String,
    pub builder_invocation_id: String,
    pub reviewer_lineage_ref: VersionedRef,
    pub builder_lineage_ref: VersionedRef,
    pub shared_ancestor_or_fork: bool,
    pub disqualifying_relations: Vec<String>,
    pub different_provider_required: bool,
    pub eligible: bool,
    pub computed_by_event_id: String,
    pub evidence_refs: Vec<EvidenceRefV2>,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClauseCoverage {
    pub clause_id: String,
    pub accepted: bool,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionReviewFinding {
    pub clause_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionReviewVerdict {
    AcceptedExactOid,
    ChangesRequested,
    Blocked,
}

impl MissionReviewVerdict {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AcceptedExactOid => "accepted_exact_oid",
            Self::ChangesRequested => "changes_requested",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionReviewRecord {
    pub schema: String,
    pub review_id: String,
    pub activation_id: String,
    pub mission_id: String,
    pub mission_revision: u64,
    pub work_unit_id: String,
    pub plan_content_digest: String,
    pub tested_evidence_id: String,
    pub reviewed_oid: String,
    pub reviewer_invocation_receipt_ref: VersionedRef,
    pub reviewer_independence: ReviewerIndependenceProof,
    pub verdict: MissionReviewVerdict,
    pub clause_coverage: Vec<ClauseCoverage>,
    pub findings: Vec<MissionReviewFinding>,
    pub next_action: String,
    pub review_digest: String,
    pub created_at_unix_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModelReview {
    clause_coverage: Vec<ClauseCoverage>,
    findings: Vec<MissionReviewFinding>,
}

fn sha256_json(value: &impl Serialize) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn sha256_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_versioned_ref(value: &VersionedRef, field: &str) -> Result<(), String> {
    if value.id.trim().is_empty()
        || value.contract_version.trim().is_empty()
        || !is_sha256(&value.content_digest)
    {
        return Err(format!("invalid canonical {field} VersionedRef"));
    }
    Ok(())
}

fn gate_evidence_ref(evidence: &MissionGateEvidence) -> EvidenceRefV2 {
    EvidenceRefV2 {
        evidence_id: evidence.evidence_id.clone(),
        kind: "gate".to_string(),
        locator: format!("mission_gate_evidence:{}", evidence.evidence_id),
        content_digest_algorithm: "sha256".to_string(),
        content_digest: evidence.evidence_digest.clone(),
        produced_by_event_id: evidence.evidence_id.clone(),
        environment_fingerprint: Some(evidence.environment_fingerprint.clone()),
        base_oid: Some(evidence.base_oid.clone()),
        head_oid: Some(evidence.tested_oid.clone()),
        generated_at_unix_ms: evidence.ended_at_unix_ms,
        valid_until_unix_ms: evidence
            .ended_at_unix_ms
            .checked_add(REVIEW_EVIDENCE_MAX_AGE_MS),
        redaction_count: 0,
        provenance: VersionedRef {
            id: format!("mission-gate-provenance:{}", evidence.evidence_id),
            contract_version: "aelyris.evidence-provenance/v1".to_string(),
            content_digest: evidence.evidence_digest.clone(),
        },
        integrity: VersionedRef {
            id: format!("mission-gate-integrity:{}", evidence.evidence_id),
            contract_version: "aelyris.integrity-envelope/v1".to_string(),
            content_digest: evidence.evidence_digest.clone(),
        },
    }
}

pub fn builder_runtime_attestation(
    evidence: &MissionGateEvidence,
    builder_adapter: &str,
) -> Result<RuntimeInvocationAttestation, String> {
    if builder_adapter != A7_BUILDER_ADAPTER {
        return Err("builder adapter fact differs from the fixed visible Codex route".to_string());
    }
    let model_ref = VersionedRef {
        id: UNOBSERVED_MODEL_ID.to_string(),
        contract_version: "aelyris.agent-model-observation/v1".to_string(),
        content_digest: sha256_text(UNOBSERVED_MODEL_ID),
    };
    let lineage_id = format!(
        "visible-pty:{}:{}:{}",
        evidence.agent_run_id, evidence.pty_session_id, evidence.attempt_id
    );
    Ok(RuntimeInvocationAttestation {
        principal_id: evidence.agent_run_id.clone(),
        logical_session_id: evidence.pty_session_id.clone(),
        provider: A7_BUILDER_PROVIDER.to_string(),
        model_ref,
        invocation_id: evidence.attempt_id.clone(),
        lineage_ref: VersionedRef {
            content_digest: sha256_text(&lineage_id),
            id: lineage_id,
            contract_version: "aelyris.visible-pty-lineage/v1".to_string(),
        },
        ancestor_lineage_ids: Vec::new(),
        runtime_domain_id: evidence.runtime_domain_id.clone(),
    })
}

fn canonical_independence_digest(proof: &ReviewerIndependenceProof) -> Result<String, String> {
    let mut canonical = proof.clone();
    canonical.digest.clear();
    sha256_json(&canonical)
}

pub fn validate_independence_proof(proof: &ReviewerIndependenceProof) -> Result<(), String> {
    validate_versioned_ref(&proof.reviewer_model_ref, "reviewer model")?;
    validate_versioned_ref(&proof.builder_model_ref, "builder model")?;
    validate_versioned_ref(&proof.reviewer_lineage_ref, "reviewer lineage")?;
    validate_versioned_ref(&proof.builder_lineage_ref, "builder lineage")?;
    if proof.schema != REVIEW_INDEPENDENCE_SCHEMA
        || proof.policy_version != REVIEW_POLICY_VERSION
        || proof.reviewer_principal_id.trim().is_empty()
        || proof.builder_principal_id.trim().is_empty()
        || proof.reviewer_logical_session_id.trim().is_empty()
        || proof.builder_logical_session_id.trim().is_empty()
        || proof.reviewer_provider.trim().is_empty()
        || proof.builder_provider.trim().is_empty()
        || proof.reviewer_invocation_id.trim().is_empty()
        || proof.builder_invocation_id.trim().is_empty()
        || proof.computed_by_event_id.trim().is_empty()
        || proof.evidence_refs.len() != 1
    {
        return Err("reviewer independence proof has non-canonical scalar fields".to_string());
    }
    let evidence = &proof.evidence_refs[0];
    validate_versioned_ref(&evidence.provenance, "evidence provenance")?;
    validate_versioned_ref(&evidence.integrity, "evidence integrity")?;
    if evidence.kind != "gate"
        || evidence.content_digest_algorithm != "sha256"
        || !is_sha256(&evidence.content_digest)
        || evidence.evidence_id.trim().is_empty()
        || evidence.locator.trim().is_empty()
        || evidence.produced_by_event_id.trim().is_empty()
    {
        return Err("reviewer independence evidence ref is non-canonical".to_string());
    }
    let derived_shared = proof.reviewer_lineage_ref.id == proof.builder_lineage_ref.id
        || proof
            .disqualifying_relations
            .iter()
            .any(|relation| relation == "same_or_forked_lineage");
    let derived_eligible = proof.disqualifying_relations.is_empty() && !derived_shared;
    if proof.shared_ancestor_or_fork != derived_shared
        || proof.eligible != derived_eligible
        || (proof.different_provider_required
            && proof.reviewer_provider == proof.builder_provider
            && !proof
                .disqualifying_relations
                .iter()
                .any(|relation| relation == "same_provider_disallowed"))
        || proof.digest != canonical_independence_digest(proof)?
    {
        return Err("reviewer independence derived fields or digest disagree".to_string());
    }
    Ok(())
}

pub fn compute_independence(
    evidence: &MissionGateEvidence,
    reviewer: &RuntimeInvocationAttestation,
    builder: &RuntimeInvocationAttestation,
    different_provider_required: bool,
    computed_by_event_id: &str,
) -> Result<ReviewerIndependenceProof, String> {
    if builder.principal_id != evidence.agent_run_id
        || builder.logical_session_id != evidence.pty_session_id
        || builder.invocation_id != evidence.attempt_id
        || builder.runtime_domain_id != evidence.runtime_domain_id
    {
        return Err("builder runtime attestation does not bind the tested attempt".to_string());
    }
    for (value, field) in [(reviewer, "reviewer"), (builder, "builder")] {
        validate_versioned_ref(&value.model_ref, &format!("{field} model"))?;
        validate_versioned_ref(&value.lineage_ref, &format!("{field} lineage"))?;
        if value.principal_id.trim().is_empty()
            || value.logical_session_id.trim().is_empty()
            || value.provider.trim().is_empty()
            || value.invocation_id.trim().is_empty()
            || value.runtime_domain_id.trim().is_empty()
        {
            return Err(format!("{field} runtime attestation is incomplete"));
        }
    }
    let mut disqualifying_relations = Vec::new();
    if reviewer.principal_id == evidence.agent_run_id {
        disqualifying_relations.push("same_principal".to_string());
    }
    if reviewer.logical_session_id == evidence.pty_session_id {
        disqualifying_relations.push("same_logical_session".to_string());
    }
    if reviewer.lineage_ref.id == builder.lineage_ref.id
        || reviewer
            .ancestor_lineage_ids
            .contains(&builder.lineage_ref.id)
        || builder
            .ancestor_lineage_ids
            .contains(&reviewer.lineage_ref.id)
    {
        disqualifying_relations.push("same_or_forked_lineage".to_string());
    }
    if different_provider_required && reviewer.provider == builder.provider {
        disqualifying_relations.push("same_provider_disallowed".to_string());
    }
    let shared_ancestor_or_fork = disqualifying_relations
        .iter()
        .any(|relation| relation == "same_or_forked_lineage");
    let mut proof = ReviewerIndependenceProof {
        schema: REVIEW_INDEPENDENCE_SCHEMA.to_string(),
        policy_version: REVIEW_POLICY_VERSION.to_string(),
        reviewer_principal_id: reviewer.principal_id.clone(),
        builder_principal_id: evidence.agent_run_id.clone(),
        reviewer_logical_session_id: reviewer.logical_session_id.clone(),
        builder_logical_session_id: builder.logical_session_id.clone(),
        reviewer_provider: reviewer.provider.clone(),
        builder_provider: builder.provider.clone(),
        reviewer_model_ref: reviewer.model_ref.clone(),
        builder_model_ref: builder.model_ref.clone(),
        reviewer_invocation_id: reviewer.invocation_id.clone(),
        builder_invocation_id: builder.invocation_id.clone(),
        reviewer_lineage_ref: reviewer.lineage_ref.clone(),
        builder_lineage_ref: builder.lineage_ref.clone(),
        shared_ancestor_or_fork,
        disqualifying_relations,
        different_provider_required,
        eligible: false,
        computed_by_event_id: computed_by_event_id.to_string(),
        evidence_refs: vec![gate_evidence_ref(evidence)],
        digest: String::new(),
    };
    proof.eligible = proof.disqualifying_relations.is_empty() && !proof.shared_ancestor_or_fork;
    proof.digest = canonical_independence_digest(&proof)?;
    validate_independence_proof(&proof)?;
    Ok(proof)
}

fn reviewer_json_body(raw: &str) -> Result<&str, String> {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let first_newline = trimmed
            .find('\n')
            .ok_or_else(|| "reviewer returned an incomplete fenced response".to_string())?;
        let body = &trimmed[first_newline + 1..];
        let end = body
            .rfind("```")
            .ok_or_else(|| "reviewer returned an unterminated fenced response".to_string())?;
        Ok(body[..end].trim())
    } else {
        Ok(trimmed)
    }
}

fn canonicalize_model_response(raw: &str) -> Result<String, String> {
    let model: ModelReview = serde_json::from_str(reviewer_json_body(raw)?)
        .map_err(|error| format!("invalid reviewer JSON: {error}"))?;
    serde_json::to_string(&model).map_err(|error| format!("canonicalize reviewer JSON: {error}"))
}

fn parse_model_review(raw: &str) -> Result<ModelReview, String> {
    serde_json::from_str(reviewer_json_body(raw)?)
        .map_err(|error| format!("invalid reviewer JSON: {error}"))
}

pub(crate) fn receipt_response_projection(
    receipt: &ReviewerInvocationReceipt,
) -> Result<(Vec<ClauseCoverage>, Vec<MissionReviewFinding>), String> {
    receipt.validate()?;
    let model = parse_model_review(receipt.canonical_response_json())?;
    Ok((model.clause_coverage, model.findings))
}

pub(crate) fn build_review_prompt(
    preview: &MissionPlanPreview,
    evidence: &MissionGateEvidence,
    changed_paths: &[String],
    diff: &str,
) -> String {
    let gate_argv = serde_json::to_string(&evidence.command_argv)
        .unwrap_or_else(|_| "[\"unavailable\"]".to_string());
    format!(
        "You are the independent reviewer for one frozen Aelyris Mission candidate. Review only the exact OID and clauses below. Return strict JSON matching the supplied output schema with exactly two keys: clauseCoverage and findings. clauseCoverage is an array of objects and must contain every clauseId exactly once with accepted boolean and a concrete reason. findings is an array of {{clauseId|null,message}} objects. Do not return an object map for clauseCoverage. Do not suggest scope expansion.\n\nThe gate facts below are authoritative backend evidence: Aelyris executed the exact argv after freezing the candidate, bound the result to the exact tested OID, and revalidated freshness before this review. Treat result=passed as executed test evidence, not as an unverified caller claim.\nExact tested OID: {}\nGate evidence id: {}\nGate result: {}\nGate command argv: {}\nGate evidence digest: {}\nGate started at unix ms: {}\nGate ended at unix ms: {}\nAcceptance clauses:\n{}\nChanged paths: {}\nUnified diff:\n{}",
        evidence.tested_oid,
        evidence.evidence_id,
        evidence.result,
        gate_argv,
        evidence.evidence_digest,
        evidence.started_at_unix_ms,
        evidence.ended_at_unix_ms,
        preview
            .mission_definition
            .acceptance
            .iter()
            .map(|clause| format!("- {}: {}", clause.clause_id, clause.statement))
            .collect::<Vec<_>>()
            .join("\n"),
        changed_paths.join(", "),
        diff,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDigest<'a> {
    schema: &'a str,
    review_id: &'a str,
    activation_id: &'a str,
    mission_id: &'a str,
    mission_revision: u64,
    work_unit_id: &'a str,
    plan_content_digest: &'a str,
    tested_evidence_id: &'a str,
    reviewed_oid: &'a str,
    reviewer_invocation_receipt_ref: &'a VersionedRef,
    reviewer_independence: &'a ReviewerIndependenceProof,
    verdict: MissionReviewVerdict,
    clause_coverage: &'a [ClauseCoverage],
    findings: &'a [MissionReviewFinding],
    next_action: &'a str,
    created_at_unix_ms: u64,
}

#[allow(clippy::too_many_arguments)]
pub fn review_exact_candidate(
    preview: &MissionPlanPreview,
    activation: &MissionPlanActivation,
    evidence: &MissionGateEvidence,
    changed_paths: &[String],
    _diff: &str,
    now_ms: u64,
    builder: &RuntimeInvocationAttestation,
    different_provider_required: bool,
    invocation: &ReviewerInvocation,
) -> Result<MissionReviewRecord, String> {
    if preview.content_digest != activation.plan_content_digest
        || preview.review_requirement.policy_id != REVIEW_POLICY_VERSION
        || activation.activation_id != evidence.activation_id
        || activation.plan_content_digest != evidence.plan_content_digest
        || activation.accepted_base_oid != evidence.base_oid
        || evidence.candidate_oid != evidence.tested_oid
        || evidence.result != "passed"
        || changed_paths != activation.owned_targets
    {
        return Err("Mission review input binding changed or contains an unowned diff".to_string());
    }
    if now_ms < evidence.ended_at_unix_ms
        || now_ms.saturating_sub(evidence.ended_at_unix_ms) > REVIEW_EVIDENCE_MAX_AGE_MS
    {
        return Err("Mission test evidence is stale".to_string());
    }
    let clauses = &preview.mission_definition.acceptance;
    invocation.receipt.validate()?;
    let review_id = uuid::Uuid::now_v7().to_string();
    let independence = compute_independence(
        evidence,
        &invocation.receipt.runtime_attestation(),
        builder,
        different_provider_required,
        &review_id,
    )?;
    if !independence.eligible {
        return Err(format!(
            "reviewer is not independent: {}",
            independence.disqualifying_relations.join(",")
        ));
    }
    let model = parse_model_review(invocation.receipt.canonical_response_json())?;
    let expected_ids = clauses
        .iter()
        .map(|clause| clause.clause_id.as_str())
        .collect::<HashSet<_>>();
    let actual_ids = model
        .clause_coverage
        .iter()
        .map(|coverage| coverage.clause_id.as_str())
        .collect::<HashSet<_>>();
    if actual_ids != expected_ids || model.clause_coverage.len() != clauses.len() {
        return Err(
            "reviewer omitted, duplicated, or invented acceptance-clause coverage".to_string(),
        );
    }
    if model
        .clause_coverage
        .iter()
        .any(|coverage| coverage.reason.trim().is_empty())
        || model.findings.iter().any(|finding| {
            finding.message.trim().is_empty()
                || finding
                    .clause_id
                    .as_deref()
                    .is_some_and(|id| !expected_ids.contains(id))
        })
    {
        return Err("reviewer returned invalid clause reasons or findings".to_string());
    }
    let accepted = model
        .clause_coverage
        .iter()
        .all(|coverage| coverage.accepted)
        && model.findings.is_empty();
    let verdict = if accepted {
        MissionReviewVerdict::AcceptedExactOid
    } else {
        MissionReviewVerdict::ChangesRequested
    };
    let next_action = if accepted {
        "Create an A7-bound durable merge intent and integrate only this reviewed OID into the isolated acceptance target."
    } else {
        "Create a new implementation generation that addresses the exact findings, then freeze, test, and review the new OID."
    }
    .to_string();
    let created_at_unix_ms = now_ms;
    let reviewer_invocation_receipt_ref = invocation.receipt.receipt_ref();
    let review_digest = sha256_json(&ReviewDigest {
        schema: MISSION_REVIEW_SCHEMA,
        review_id: &review_id,
        activation_id: &activation.activation_id,
        mission_id: &activation.mission_id,
        mission_revision: activation.mission_revision,
        work_unit_id: &activation.work_unit_id,
        plan_content_digest: &activation.plan_content_digest,
        tested_evidence_id: &evidence.evidence_id,
        reviewed_oid: &evidence.tested_oid,
        reviewer_invocation_receipt_ref: &reviewer_invocation_receipt_ref,
        reviewer_independence: &independence,
        verdict,
        clause_coverage: &model.clause_coverage,
        findings: &model.findings,
        next_action: &next_action,
        created_at_unix_ms,
    })?;
    let record = MissionReviewRecord {
        schema: MISSION_REVIEW_SCHEMA.to_string(),
        review_id,
        activation_id: activation.activation_id.clone(),
        mission_id: activation.mission_id.clone(),
        mission_revision: activation.mission_revision,
        work_unit_id: activation.work_unit_id.clone(),
        plan_content_digest: activation.plan_content_digest.clone(),
        tested_evidence_id: evidence.evidence_id.clone(),
        reviewed_oid: evidence.tested_oid.clone(),
        reviewer_invocation_receipt_ref,
        reviewer_independence: independence,
        verdict,
        clause_coverage: model.clause_coverage,
        findings: model.findings,
        next_action,
        review_digest,
        created_at_unix_ms,
    };
    validate_mission_review_record(&record)?;
    Ok(record)
}

pub fn canonical_review_digest(record: &MissionReviewRecord) -> Result<String, String> {
    sha256_json(&ReviewDigest {
        schema: &record.schema,
        review_id: &record.review_id,
        activation_id: &record.activation_id,
        mission_id: &record.mission_id,
        mission_revision: record.mission_revision,
        work_unit_id: &record.work_unit_id,
        plan_content_digest: &record.plan_content_digest,
        tested_evidence_id: &record.tested_evidence_id,
        reviewed_oid: &record.reviewed_oid,
        reviewer_invocation_receipt_ref: &record.reviewer_invocation_receipt_ref,
        reviewer_independence: &record.reviewer_independence,
        verdict: record.verdict,
        clause_coverage: &record.clause_coverage,
        findings: &record.findings,
        next_action: &record.next_action,
        created_at_unix_ms: record.created_at_unix_ms,
    })
}

/// Canonical validation at the Review persistence boundary. This rejects a
/// typed-but-self-inconsistent record before SQLite scalar columns can diverge
/// from the immutable JSON envelope.
pub fn validate_mission_review_record(record: &MissionReviewRecord) -> Result<(), String> {
    validate_independence_proof(&record.reviewer_independence)?;
    validate_versioned_ref(
        &record.reviewer_invocation_receipt_ref,
        "reviewer invocation receipt",
    )?;
    if record.schema != MISSION_REVIEW_SCHEMA
        || record.review_id.trim().is_empty()
        || record.activation_id.trim().is_empty()
        || record.mission_id.trim().is_empty()
        || record.mission_revision == 0
        || record.work_unit_id.trim().is_empty()
        || !is_sha256(&record.plan_content_digest)
        || record.tested_evidence_id.trim().is_empty()
        || record.reviewed_oid.len() != 40
        || record.next_action.trim().is_empty()
        || record.reviewer_invocation_receipt_ref.contract_version
            != REVIEWER_INVOCATION_RECEIPT_SCHEMA
        || record.reviewer_independence.computed_by_event_id != record.review_id
        || record.reviewer_independence.evidence_refs[0].evidence_id != record.tested_evidence_id
    {
        return Err("Mission review has non-canonical scalar fields".to_string());
    }
    let mut ids = HashSet::new();
    if record.clause_coverage.is_empty()
        || record.clause_coverage.iter().any(|coverage| {
            coverage.clause_id.trim().is_empty()
                || coverage.reason.trim().is_empty()
                || !ids.insert(coverage.clause_id.as_str())
        })
        || record.findings.iter().any(|finding| {
            finding.message.trim().is_empty()
                || finding
                    .clause_id
                    .as_deref()
                    .is_some_and(|id| !ids.contains(id))
        })
    {
        return Err("Mission review coverage/findings are non-canonical".to_string());
    }
    let accepted =
        record.clause_coverage.iter().all(|item| item.accepted) && record.findings.is_empty();
    if (record.verdict == MissionReviewVerdict::AcceptedExactOid) != accepted
        || (accepted && !record.reviewer_independence.eligible)
        || record.review_digest != canonical_review_digest(record)?
    {
        return Err("Mission review verdict, eligibility, or digest disagrees".to_string());
    }
    Ok(())
}

pub fn acceptance_clause_ids(clauses: &[AcceptanceClause]) -> Vec<String> {
    clauses
        .iter()
        .map(|clause| clause.clause_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (
        MissionPlanPreview,
        MissionPlanActivation,
        MissionGateEvidence,
    ) {
        let mut preview =
            crate::task::mission::tests::fixed_preview(crate::task::mission::tests::fixed_input())
                .unwrap();
        preview.status = crate::task::MissionPlanStatus::Accepted;
        preview.decision_principal_id = Some("0197c000-0000-7000-8000-000000000007".into());
        preview.decided_at_unix_ms = Some(2);
        let (activation, _) = crate::task::mission::activation_from_accepted_plan(
            &preview,
            "0197c000-0000-7000-8000-000000000010".into(),
            1,
        )
        .unwrap();
        let evidence = MissionGateEvidence {
            schema: "aelyris.mission_gate_evidence/v1".into(),
            evidence_id: "0197c000-0000-7000-8000-000000000011".into(),
            activation_id: activation.activation_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            attempt_id: "0197c000-0000-7000-8000-000000000012".into(),
            execution_generation: 1,
            agent_run_id: "0197c000-0000-7000-8000-000000000013".into(),
            runtime_domain_id: "visible_pty".into(),
            pty_session_id: "0197c000-0000-7000-8000-000000000014".into(),
            gate_id: crate::task::A7_FIXTURE_GATE_ID.into(),
            contract_version: "1".into(),
            command_argv: activation.test_argv.clone(),
            command_fingerprint: "f".repeat(64),
            environment_fingerprint: "e".repeat(64),
            result: "passed".into(),
            evidence_digest: "a".repeat(64),
            base_oid: activation.accepted_base_oid.clone(),
            candidate_oid: "1234567890abcdef1234567890abcdef12345678".into(),
            tested_oid: "1234567890abcdef1234567890abcdef12345678".into(),
            started_at_unix_ms: 10,
            ended_at_unix_ms: 20,
        };
        (preview, activation, evidence)
    }

    fn attestation(
        principal: &str,
        session: &str,
        provider: &str,
        lineage: &str,
    ) -> RuntimeInvocationAttestation {
        RuntimeInvocationAttestation {
            principal_id: principal.into(),
            logical_session_id: session.into(),
            provider: provider.into(),
            model_ref: VersionedRef {
                id: format!("{provider}-model"),
                contract_version: "adapter/v1".into(),
                content_digest: sha256_text(&format!("{provider}-model")),
            },
            invocation_id: format!("invoke-{session}"),
            lineage_ref: VersionedRef {
                id: lineage.into(),
                contract_version: "lineage/v1".into(),
                content_digest: sha256_text(lineage),
            },
            ancestor_lineage_ids: vec![],
            runtime_domain_id: "headless_fixed_reviewer".into(),
        }
    }

    fn invocation(response: String) -> ReviewerInvocation {
        ReviewerInvocation::test_only(&response)
    }

    #[test]
    fn a7_3_fixed_reviewer_schema_requires_array_clause_coverage() {
        let schema: serde_json::Value =
            serde_json::from_str(A7_REVIEW_OUTPUT_SCHEMA).expect("valid fixed output schema");
        assert_eq!(
            schema.pointer("/properties/clauseCoverage/type"),
            Some(&serde_json::Value::String("array".into()))
        );
        assert_eq!(
            schema.pointer("/properties/findings/type"),
            Some(&serde_json::Value::String("array".into()))
        );
        assert_eq!(
            schema.pointer("/additionalProperties"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(a7_review_argv_contract_digest().len(), 64);
    }

    #[test]
    fn a7_3_review_prompt_exposes_executed_gate_result() {
        let (preview, activation, evidence) = fixture();
        let prompt = build_review_prompt(
            &preview,
            &evidence,
            &activation.owned_targets,
            "+ named regression test",
        );

        assert!(prompt.contains(&format!("Exact tested OID: {}", evidence.tested_oid)));
        assert!(prompt.contains(&format!("Gate result: {}", evidence.result)));
        assert!(prompt.contains(&format!(
            "Gate evidence digest: {}",
            evidence.evidence_digest
        )));
        assert!(prompt.contains(
            &serde_json::to_string(&evidence.command_argv).expect("serialize fixture argv")
        ));
        assert!(prompt.contains("Treat result=passed as executed test evidence"));
    }

    #[test]
    fn a7_3_exact_clause_coverage_accepts_only_fresh_tested_oid() {
        let (preview, activation, evidence) = fixture();
        let builder = builder_runtime_attestation(&evidence, "codex-no-hooks").unwrap();
        let clause_coverage = preview
            .mission_definition
            .acceptance
            .iter()
            .map(|clause| {
                serde_json::json!({
                    "clauseId": clause.clause_id,
                    "accepted": true,
                    "reason": "verified against the exact diff and gate evidence"
                })
            })
            .collect::<Vec<_>>();
        let response = serde_json::json!({
            "clauseCoverage": clause_coverage,
            "findings": []
        })
        .to_string();
        let invocation = invocation(response);
        let record = review_exact_candidate(
            &preview,
            &activation,
            &evidence,
            &activation.owned_targets,
            "+ named regression test",
            100,
            &builder,
            false,
            &invocation,
        )
        .unwrap();
        assert_eq!(record.verdict, MissionReviewVerdict::AcceptedExactOid);
        assert_eq!(record.reviewed_oid, evidence.tested_oid);
        assert!(record.reviewer_independence.eligible);
    }

    #[test]
    fn a7_3_missing_clause_coverage_and_stale_evidence_fail_closed() {
        let (preview, activation, evidence) = fixture();
        let builder = builder_runtime_attestation(&evidence, "codex-no-hooks").unwrap();
        let missing = serde_json::json!({"clauseCoverage": [], "findings": []}).to_string();
        let missing_invocation = invocation(missing);
        let error = review_exact_candidate(
            &preview,
            &activation,
            &evidence,
            &activation.owned_targets,
            "+ diff",
            100,
            &builder,
            false,
            &missing_invocation,
        )
        .unwrap_err();
        assert!(error.contains("omitted"));
        let stale_invocation =
            invocation(serde_json::json!({"clauseCoverage": [], "findings": []}).to_string());
        let stale = review_exact_candidate(
            &preview,
            &activation,
            &evidence,
            &activation.owned_targets,
            "+ diff",
            evidence.ended_at_unix_ms + REVIEW_EVIDENCE_MAX_AGE_MS + 1,
            &builder,
            false,
            &stale_invocation,
        )
        .unwrap_err();
        assert!(stale.contains("stale"));
    }

    #[test]
    fn a7_3_same_builder_principal_is_ineligible() {
        let evidence = MissionGateEvidence {
            schema: "aelyris.mission_gate_evidence/v1".into(),
            evidence_id: "e".into(),
            activation_id: "a".into(),
            plan_content_digest: "d".repeat(64),
            attempt_id: "x".into(),
            execution_generation: 1,
            agent_run_id: "0197c000-0000-7000-8000-000000000001".into(),
            runtime_domain_id: "visible_pty".into(),
            pty_session_id: "0197c000-0000-7000-8000-000000000002".into(),
            gate_id: "g".into(),
            contract_version: "1".into(),
            command_argv: vec![],
            command_fingerprint: "f".repeat(64),
            environment_fingerprint: "e".repeat(64),
            result: "passed".into(),
            evidence_digest: "a".repeat(64),
            base_oid: "b".repeat(40),
            candidate_oid: "c".repeat(40),
            tested_oid: "c".repeat(40),
            started_at_unix_ms: 1,
            ended_at_unix_ms: 2,
        };
        let builder = builder_runtime_attestation(&evidence, "codex-no-hooks").unwrap();
        let reviewer = attestation(
            &evidence.agent_run_id,
            "0197c000-0000-7000-8000-000000000003",
            "codex",
            "other",
        );
        let proof = compute_independence(&evidence, &reviewer, &builder, false, "review").unwrap();
        assert!(!proof.eligible);
        assert_eq!(proof.disqualifying_relations, ["same_principal"]);
    }

    #[test]
    fn a7_3_session_fork_descendant_and_provider_policy_are_ineligible() {
        let (_, _, evidence) = fixture();
        let builder = builder_runtime_attestation(&evidence, "codex-no-hooks").unwrap();

        let same_session = attestation(
            "reviewer",
            &evidence.pty_session_id,
            "other-provider",
            "other-lineage",
        );
        let proof =
            compute_independence(&evidence, &same_session, &builder, false, "review").unwrap();
        assert_eq!(proof.disqualifying_relations, ["same_logical_session"]);

        let mut descendant = attestation(
            "reviewer",
            "review-session",
            "other-provider",
            "descendant-lineage",
        );
        descendant
            .ancestor_lineage_ids
            .push(builder.lineage_ref.id.clone());
        let proof =
            compute_independence(&evidence, &descendant, &builder, false, "review").unwrap();
        assert_eq!(proof.disqualifying_relations, ["same_or_forked_lineage"]);

        let same_provider = attestation("reviewer", "review-session", "codex", "other-lineage");
        let proof =
            compute_independence(&evidence, &same_provider, &builder, true, "review").unwrap();
        assert_eq!(proof.disqualifying_relations, ["same_provider_disallowed"]);
    }

    #[test]
    fn a7_3_independence_digest_rejects_tampered_typed_refs() {
        let (_, _, evidence) = fixture();
        let builder = builder_runtime_attestation(&evidence, "codex-no-hooks").unwrap();
        let reviewer = attestation("reviewer", "review-session", "codex", "other-lineage");
        let mut proof =
            compute_independence(&evidence, &reviewer, &builder, false, "review").unwrap();
        proof.reviewer_model_ref.id = "tampered".into();
        assert!(validate_independence_proof(&proof)
            .unwrap_err()
            .contains("digest"));
    }
}
