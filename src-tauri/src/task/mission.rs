//! A7.1 inert Mission request and versioned plan-preview contract.
//!
//! These values are durable planning facts, not runtime authority. In particular,
//! accepting a preview does not add Tasks, reserve execution, create a worktree,
//! spawn an agent, run a gate, review, or merge. A7.2 owns later activation.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{validate_plan, Task};

pub const MISSION_DEFINITION_SCHEMA: &str = "aelyris.mission_definition/v1";
pub const MISSION_PLAN_PREVIEW_SCHEMA: &str = "aelyris.mission_plan_preview/v1";
pub const MISSION_PLAN_CANONICALIZATION: &str = "rfc8785_json_utf8";
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
pub const A7_FIXTURE_REQUEST_ID: &str = "0197c000-0000-7000-8000-000000000001";
pub const A7_FIXTURE_MISSION_ID: &str = "0197c000-0000-7000-8000-000000000002";
pub const A7_FIXTURE_WORK_UNIT_ID: &str = "0197c000-0000-7000-8000-000000000003";
pub const A7_FIXTURE_PLAN_ID: &str = "0197c000-0000-7000-8000-000000000004";
const A7_FIXTURE_WORKSPACE_ID: &str = "0197c000-0000-7000-8000-000000000005";
const A7_FIXTURE_PROJECT_ID: &str = "0197c000-0000-7000-8000-000000000006";
const A7_FIXTURE_ACTOR_ID: &str = "0197c000-0000-7000-8000-000000000007";
const A7_FIXTURE_REPOSITORY_ID: &str = "0197c000-0000-7000-8000-000000000008";
const A7_FIXTURE_UNLOCK_ID: &str = "0197c000-0000-7000-8000-00000000000d";
pub const A7_FIXTURE_OWNED_TARGET: &str = "src-tauri/src/task/graph.rs";
pub const A7_FIXTURE_GATE_ID: &str = "a7-fixed-test";
pub const COMPLETED_WORK_PACKET_SCHEMA: &str = "aelyris.completed_work_packet/v1";
pub const BLOCKED_WORK_PACKET_SCHEMA: &str = "aelyris.blocked_work_packet/v1";
pub const MISSION_COMPLETION_PACKET_SCHEMA: &str = "aelyris.mission_completion_packet/v1";
pub const A7_SETTLEMENT_PROOF_VERSION: &str = "aelyris.a7-settlement-proof/v1";
pub const A7_FIXTURE_REQUEST: &str = "Add a Rust regression test named equal_priority_ready_tasks_preserve_insertion_order in src-tauri/src/task/graph.rs. It must insert two Medium root tasks in order, recompute readiness, and prove ready_tasks() preserves insertion order. Change no production behavior unless the new test first demonstrates a defect.";
pub const A7_FIXTURE_TEST_ARGV: [&str; 8] = [
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
    "--",
    "--exact",
];
const A7_FIXTURE_CLAUSE_IDS: [&str; 4] = [
    "0197c000-0000-7000-8000-000000000009",
    "0197c000-0000-7000-8000-00000000000a",
    "0197c000-0000-7000-8000-00000000000b",
    "0197c000-0000-7000-8000-00000000000c",
];
const A7_FIXTURE_ACCEPTANCE: [&str; 4] = [
    "A7-FIX-01: add exactly the named deterministic regression test",
    "A7-FIX-02: preserve production behavior unless the test first demonstrates a defect",
    "A7-FIX-03: the declared focused test passes at the exact candidate OID",
    "A7-FIX-04: the owned diff contains no path outside src-tauri/src/task/graph.rs",
];

#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum MissionPlanError {
    #[error("mission plan validation failed: {0}")]
    Validation(String),
    #[error("mission plan durability is unavailable")]
    DurabilityUnavailable,
    #[error("mission plan not found: {plan_id} revision {plan_revision}")]
    NotFound { plan_id: String, plan_revision: u64 },
    #[error("mission plan content conflict: {0}")]
    ContentConflict(String),
    #[error("illegal mission plan transition from {from} to {to}")]
    IllegalTransition { from: String, to: String },
    #[error("mission plan persistence failed: {0}")]
    Persistence(String),
}

impl From<String> for MissionPlanError {
    fn from(value: String) -> Self {
        Self::Persistence(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    Low,
    Moderate,
    High,
    Irreversible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceClause {
    pub clause_id: String,
    pub statement: String,
    pub required_gate_ids: Vec<String>,
    pub required_artifact_ids: Vec<String>,
    pub completion_blocking: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskPolicy {
    pub policy_id: String,
    pub policy_version: String,
    pub maximum_risk_class: RiskClass,
    pub human_approval_risk_classes: Vec<String>,
    pub reconciliation_policy_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetKind {
    Currency,
    Tokens,
    WallTimeMs,
    CpuMs,
    DiskBytes,
    NetworkBytes,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetLimit {
    pub kind: BudgetKind,
    pub unit: String,
    pub amount: String,
    pub currency_iso_code: Option<String>,
    pub hard: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetExhaustionResult {
    Blocked,
    OperatorRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetPolicy {
    pub policy_id: String,
    pub policy_version: String,
    pub limits: Vec<BudgetLimit>,
    pub exhaustion_result: BudgetExhaustionResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterCapability {
    Prompt,
    Steer,
    Interrupt,
    Resume,
    Fork,
    ApproveReject,
    ToolEventStream,
    DiffStream,
    UsageCost,
    AttentionState,
    SessionExport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimePolicy {
    pub policy_id: String,
    pub policy_version: String,
    pub allowed_runtime_domain_ids: Vec<String>,
    pub required_adapter_capabilities: Vec<AdapterCapability>,
    pub visible_pty_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamRolePolicy {
    pub role_id: String,
    pub capability_profile_ids: Vec<String>,
    pub budget_profile_id: String,
    pub proof_profile_id: String,
    pub may_implement: bool,
    pub may_review: bool,
    pub may_authorize_completion: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamExecutionPolicy {
    pub roles: Vec<TeamRolePolicy>,
    pub reviewer_independence_policy_id: String,
    pub ownership_policy_id: String,
    pub governance_policy_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionDefinitionRevision {
    pub schema: String,
    pub mission_id: String,
    pub revision: u64,
    pub workspace_id: String,
    pub project_id: String,
    pub goal: String,
    pub desired_outcome: String,
    pub capability_outcome: String,
    pub non_goals: Vec<String>,
    pub base_oid: String,
    pub acceptance: Vec<AcceptanceClause>,
    pub risk_policy: RiskPolicy,
    pub budget_policy: BudgetPolicy,
    pub runtime_policy: RuntimePolicy,
    pub team_policy: TeamExecutionPolicy,
    pub work_graph_definition_revision: u64,
    pub created_by: String,
    pub approved_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceFreshnessPolicy {
    pub policy_id: String,
    pub max_age_ms: String,
    pub require_same_head_oid: bool,
    pub require_same_contract_version: bool,
    pub require_same_environment_fingerprint: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GateRequirement {
    pub gate_id: String,
    pub contract_version: String,
    pub command_argv: Vec<String>,
    pub cwd_role: String,
    pub required_result: String,
    pub freshness_policy: EvidenceFreshnessPolicy,
}

/// The fixed A7 journey's declared test. `GateRequirement.requiredResult` stays
/// aligned to its catalog value `passed`; this preview-level projection binds
/// that pass to the accepted Mission HEAD and therefore requires
/// `passed_exact_oid` before later A7 settlement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedTest {
    pub gate_id: String,
    pub command_argv: Vec<String>,
    pub cwd_role: String,
    pub required_result: String,
    pub freshness_policy: EvidenceFreshnessPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactRequirement {
    pub artifact_id: String,
    pub kind: String,
    pub locator_policy_id: String,
    pub digest_algorithm: String,
    pub freshness_policy: EvidenceFreshnessPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityTemplate {
    pub capability_template_id: String,
    pub version: String,
    pub action: String,
    pub scope_kinds: Vec<String>,
    pub one_use_required: bool,
    pub approval_policy_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryResourceRef {
    pub repository_id: String,
    pub repo_relative_path: String,
    pub base_oid: String,
    pub head_oid: String,
    pub blob_oid: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceOperation {
    Read,
    Update,
    Create,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceIntent {
    pub resource_ref: RepositoryResourceRef,
    pub operation: ResourceOperation,
    pub expected_base_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolIntent {
    pub resource_ref: RepositoryResourceRef,
    pub language: String,
    pub symbol_kind: String,
    pub qualified_name: String,
    pub stable_locator: String,
    pub operation: ResourceOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityUnlock {
    pub unlock_id: String,
    pub capability: String,
    pub condition_clause_ids: Vec<String>,
    pub available_after_work_unit_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkUnitDefinition {
    pub work_unit_id: String,
    pub mission_id: String,
    pub definition_revision: u64,
    pub title: String,
    pub objective: String,
    pub depends_on: Vec<String>,
    pub required_role: String,
    pub completion_authority_role_ids: Vec<String>,
    pub required_adapter_capabilities: Vec<AdapterCapability>,
    pub file_intents: Vec<ResourceIntent>,
    pub symbol_intents: Vec<SymbolIntent>,
    pub required_capability_templates: Vec<CapabilityTemplate>,
    pub required_gates: Vec<GateRequirement>,
    pub required_artifacts: Vec<ArtifactRequirement>,
    pub risk_class: RiskClass,
    pub capability_unlock: CapabilityUnlock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewerDifference {
    PrincipalId,
    LogicalSessionId,
    ForkLineage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndependentReviewRequirement {
    pub role: String,
    pub policy_id: String,
    pub must_differ_from_implementer_by: Vec<ReviewerDifference>,
    pub required_verdict: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergePolicy {
    pub result: String,
    pub target_branch_role: String,
    pub automatic_main_merge: bool,
}

/// Caller-supplied declarative facts. Status, normalized text, digests, derived
/// targets/tests, and persistence metadata are deliberately not caller-shaped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionPlanPreviewInput {
    pub request_id: String,
    pub request: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub mission_definition: MissionDefinitionRevision,
    pub work_units: Vec<WorkUnitDefinition>,
    pub review_requirement: IndependentReviewRequirement,
    pub merge_policy: MergePolicy,
    pub explicit_risks: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionPlanStatus {
    Previewed,
    Accepted,
    Rejected,
    Cancelled,
}

impl MissionPlanStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Previewed => "previewed",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Cancelled => "cancelled",
        }
    }

    pub const fn is_terminal(self) -> bool {
        !matches!(self, Self::Previewed)
    }
}

impl std::str::FromStr for MissionPlanStatus {
    type Err = MissionPlanError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "previewed" => Ok(Self::Previewed),
            "accepted" => Ok(Self::Accepted),
            "rejected" => Ok(Self::Rejected),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(MissionPlanError::Persistence(format!(
                "unknown mission plan status: {value}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionPlanPreview {
    pub schema: String,
    pub request_id: String,
    pub request: String,
    pub normalized_request: String,
    pub request_digest: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub status: MissionPlanStatus,
    pub canonicalization: String,
    pub repository_id: String,
    pub repository_root: String,
    pub accepted_mission_head_oid: String,
    pub mission_definition: MissionDefinitionRevision,
    pub work_units: Vec<WorkUnitDefinition>,
    pub work_unit_ids: Vec<String>,
    pub owned_targets: Vec<String>,
    pub expected_tests: Vec<ExpectedTest>,
    pub review_requirement: IndependentReviewRequirement,
    pub merge_policy: MergePolicy,
    pub explicit_risks: Vec<String>,
    pub content_digest: String,
    pub decision_principal_id: Option<String>,
    pub decision_reason: Option<String>,
    pub persisted_at_unix_ms: u64,
    pub decided_at_unix_ms: Option<u64>,
}

/// Immutable bridge from an accepted A7.1 preview into the existing TaskGraph.
/// It records authority derivation only; live execution state remains owned by
/// WorkExecutionAttempt and the graph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionPlanActivation {
    pub schema: String,
    pub activation_id: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub mission_id: String,
    pub mission_revision: u64,
    pub work_unit_id: String,
    pub task_id: String,
    pub plan_content_digest: String,
    pub accepted_base_oid: String,
    pub repository_root: String,
    pub source_branch: String,
    pub target_branch: String,
    pub owned_targets: Vec<String>,
    pub test_argv: Vec<String>,
    pub activated_by: String,
    pub activated_at_unix_ms: u64,
}

impl MissionPlanActivation {
    pub fn task(&self, title: &str, objective: &str) -> Task {
        let mut task = Task::new(self.task_id.clone(), title.to_string())
            .with_branches(self.source_branch.clone(), self.target_branch.clone());
        task.description = objective.to_string();
        task.owner = Some("implementer".to_string());
        task.model = Some("codex-no-hooks".to_string());
        task.outputs = self.owned_targets.clone();
        task
    }
}

/// Immutable A7.2 fresh-test fact. `tested_oid == candidate_oid` is enforced
/// both by construction and SQLite; A7.3 consumes it but owns review/merge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionGateEvidence {
    pub schema: String,
    pub evidence_id: String,
    pub activation_id: String,
    pub plan_content_digest: String,
    pub attempt_id: String,
    pub execution_generation: u64,
    pub agent_run_id: String,
    pub runtime_domain_id: String,
    pub pty_session_id: String,
    pub gate_id: String,
    pub contract_version: String,
    pub command_argv: Vec<String>,
    pub command_fingerprint: String,
    pub environment_fingerprint: String,
    pub result: String,
    pub evidence_digest: String,
    pub base_oid: String,
    pub candidate_oid: String,
    pub tested_oid: String,
    pub started_at_unix_ms: u64,
    pub ended_at_unix_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementBlockerKind {
    Repo,
    Policy,
    Operator,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementNextActionKind {
    Reprove,
    ResolveRepo,
    ResolvePolicy,
    OperatorAction,
    ExternalAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementNextAction {
    pub kind: SettlementNextActionKind,
    pub owner: String,
    pub input_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementBlocker {
    pub blocker_id: String,
    pub kind: SettlementBlockerKind,
    pub authority: String,
    pub code: String,
    pub message: String,
    pub required_inputs: Vec<String>,
    pub command_argv: Vec<String>,
    pub command_result: Option<String>,
    pub artifact_refs: Vec<String>,
    pub next_action: SettlementNextAction,
}

impl SettlementBlocker {
    pub fn validate(&self) -> Result<(), MissionPlanError> {
        let action_matches = matches!(
            (self.kind, self.next_action.kind),
            (
                SettlementBlockerKind::Repo,
                SettlementNextActionKind::Reprove | SettlementNextActionKind::ResolveRepo
            ) | (
                SettlementBlockerKind::Policy,
                SettlementNextActionKind::ResolvePolicy
            ) | (
                SettlementBlockerKind::Operator,
                SettlementNextActionKind::OperatorAction
            ) | (
                SettlementBlockerKind::External,
                SettlementNextActionKind::ExternalAction
            )
        );
        fn bounded_identifier_ref(value: &str) -> bool {
            !value.is_empty()
                && value.len() <= 160
                && value.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
                })
        }
        let bounded_refs = self
            .required_inputs
            .iter()
            .chain(self.artifact_refs.iter())
            .chain(self.next_action.input_refs.iter())
            .all(|value| bounded_identifier_ref(value));
        if self.blocker_id.trim().is_empty()
            || self.authority.trim().is_empty()
            || self.code.trim().is_empty()
            || self.message.trim().is_empty()
            || self.required_inputs.is_empty()
            || !bounded_refs
            || !self.command_argv.is_empty()
            || self
                .command_result
                .as_ref()
                .is_none_or(|value| value.trim().is_empty())
            || self.artifact_refs.is_empty()
            || self.next_action.owner.trim().is_empty()
            || self.next_action.input_refs.is_empty()
            || !action_matches
            || self.command_result.as_ref().is_some_and(|value| {
                value.len() > 160
                    || value.contains('\0')
                    || value.contains('\n')
                    || value.contains('\r')
            })
        {
            return validation(
                "settlement blocker must be typed, bounded, category-compatible data",
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AcceptanceCoverageEntry {
    pub clause_id: String,
    pub required_gate_ids: Vec<String>,
    pub evidence_ids: Vec<String>,
    pub accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletedWorkPacket {
    pub schema: String,
    pub packet_id: String,
    pub activation_id: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub mission_id: String,
    pub mission_revision: u64,
    pub work_unit_id: String,
    pub plan_content_digest: String,
    pub contract_proof_version: String,
    pub settlement_expected_version: String,
    #[serde(default = "default_settlement_generation")]
    pub settlement_generation: u64,
    #[serde(default)]
    pub supersedes_packet_id: Option<String>,
    #[serde(default = "legacy_git_fingerprint")]
    pub observed_git_fingerprint: String,
    pub base_oid: String,
    pub tested_oid: String,
    pub reviewed_oid: String,
    pub integrated_oid: String,
    pub owned_paths: Vec<String>,
    pub owned_diff_digest: String,
    pub gate_evidence_id: String,
    pub gate_evidence_digest: String,
    pub review_id: String,
    pub review_digest: String,
    pub reviewer_principal_id: String,
    pub reviewer_independence: crate::review::ReviewerIndependenceProof,
    pub merge_intent_id: String,
    pub merge_receipt_id: String,
    pub merge_result: String,
    pub acceptance_coverage: Vec<AcceptanceCoverageEntry>,
    pub repo_blockers: Vec<SettlementBlocker>,
    pub policy_blockers: Vec<SettlementBlocker>,
    pub operator_blockers: Vec<SettlementBlocker>,
    pub external_blockers: Vec<SettlementBlocker>,
    pub created_at_unix_ms: u64,
    pub packet_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockedWorkPacket {
    pub schema: String,
    pub packet_id: String,
    pub activation_id: String,
    pub plan_id: String,
    pub plan_revision: u64,
    pub mission_id: String,
    pub mission_revision: u64,
    pub work_unit_id: String,
    pub plan_content_digest: String,
    pub contract_proof_version: String,
    pub settlement_expected_version: String,
    #[serde(default = "default_settlement_generation")]
    pub settlement_generation: u64,
    #[serde(default)]
    pub supersedes_packet_id: Option<String>,
    #[serde(default = "legacy_git_fingerprint")]
    pub observed_git_fingerprint: String,
    pub base_oid: String,
    pub candidate_oid: Option<String>,
    pub tested_oid: Option<String>,
    pub reviewed_oid: Option<String>,
    pub integrated_oid: Option<String>,
    pub evidence_ids: Vec<String>,
    pub review_id: Option<String>,
    pub merge_intent_id: Option<String>,
    pub acceptance_coverage: Vec<AcceptanceCoverageEntry>,
    pub repo_blockers: Vec<SettlementBlocker>,
    pub policy_blockers: Vec<SettlementBlocker>,
    pub operator_blockers: Vec<SettlementBlocker>,
    pub external_blockers: Vec<SettlementBlocker>,
    pub completion_credit: u8,
    pub created_at_unix_ms: u64,
    pub packet_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MissionCompletionPacket {
    pub schema: String,
    pub packet_id: String,
    pub mission_id: String,
    pub mission_revision: u64,
    pub required_work_unit_packet_ids_by_work_unit: BTreeMap<String, String>,
    pub mission_acceptance_coverage: Vec<AcceptanceCoverageEntry>,
    pub final_head_oid: String,
    pub integrated_oid: String,
    pub contract_proof_version: String,
    pub settlement_expected_version: String,
    #[serde(default = "default_settlement_generation")]
    pub settlement_generation: u64,
    #[serde(default = "legacy_git_fingerprint")]
    pub observed_git_fingerprint: String,
    pub merge_result: String,
    pub repo_blockers: Vec<SettlementBlocker>,
    pub policy_blockers: Vec<SettlementBlocker>,
    pub operator_blockers: Vec<SettlementBlocker>,
    pub external_blockers: Vec<SettlementBlocker>,
    pub created_at_unix_ms: u64,
    pub packet_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum MissionSettlementOutcome {
    Completed {
        work_packet: CompletedWorkPacket,
        mission_packet: MissionCompletionPacket,
    },
    Blocked {
        blocked_packet: BlockedWorkPacket,
    },
}

fn packet_digest<T: Serialize>(packet: &T) -> Result<String, MissionPlanError> {
    let bytes = serde_json::to_vec(packet).map_err(|error| {
        MissionPlanError::Validation(format!("serialize settlement packet: {error}"))
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

const fn default_settlement_generation() -> u64 {
    1
}

fn legacy_git_fingerprint() -> String {
    "0".repeat(64)
}

impl CompletedWorkPacket {
    pub fn seal(mut self) -> Result<Self, MissionPlanError> {
        self.packet_digest.clear();
        self.packet_digest = packet_digest(&self)?;
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), MissionPlanError> {
        let mut canonical = self.clone();
        let digest = std::mem::take(&mut canonical.packet_digest);
        validate_sha256("planContentDigest", &self.plan_content_digest)?;
        validate_sha256(
            "settlementExpectedVersion",
            &self.settlement_expected_version,
        )?;
        validate_sha256("observedGitFingerprint", &self.observed_git_fingerprint)?;
        validate_git_oid("baseOid", &self.base_oid)?;
        validate_git_oid("testedOid", &self.tested_oid)?;
        validate_git_oid("reviewedOid", &self.reviewed_oid)?;
        validate_git_oid("integratedOid", &self.integrated_oid)?;
        validate_sha256("ownedDiffDigest", &self.owned_diff_digest)?;
        validate_sha256("gateEvidenceDigest", &self.gate_evidence_digest)?;
        validate_sha256("reviewDigest", &self.review_digest)?;
        crate::review::mission::validate_independence_proof(&self.reviewer_independence)
            .map_err(MissionPlanError::Validation)?;
        let mut clause_ids = HashSet::new();
        let exact_acceptance_coverage = self.acceptance_coverage.iter().all(|entry| {
            let gate_ids = entry.required_gate_ids.iter().collect::<HashSet<_>>();
            let evidence_ids = entry.evidence_ids.iter().collect::<HashSet<_>>();
            !entry.clause_id.trim().is_empty()
                && clause_ids.insert(entry.clause_id.as_str())
                && gate_ids.len() == entry.required_gate_ids.len()
                && entry
                    .required_gate_ids
                    .iter()
                    .all(|gate_id| !gate_id.trim().is_empty())
                && !entry.evidence_ids.is_empty()
                && evidence_ids.len() == entry.evidence_ids.len()
                && entry
                    .evidence_ids
                    .iter()
                    .all(|evidence_id| !evidence_id.trim().is_empty())
                && entry.accepted
        });
        let independence = &self.reviewer_independence;
        if self.schema != COMPLETED_WORK_PACKET_SCHEMA
            || self.contract_proof_version != A7_SETTLEMENT_PROOF_VERSION
            || self.packet_id.trim().is_empty()
            || self.activation_id.trim().is_empty()
            || self.plan_id.trim().is_empty()
            || self.plan_revision == 0
            || self.settlement_generation == 0
            || self
                .supersedes_packet_id
                .as_ref()
                .is_some_and(|packet_id| packet_id.trim().is_empty())
            || self.mission_id.trim().is_empty()
            || self.mission_revision == 0
            || self.work_unit_id.trim().is_empty()
            || self.owned_paths.is_empty()
            || self.owned_paths.iter().collect::<HashSet<_>>().len() != self.owned_paths.len()
            || self.owned_paths.iter().any(|path| path.trim().is_empty())
            || self.gate_evidence_id.trim().is_empty()
            || self.review_id.trim().is_empty()
            || self.merge_intent_id.trim().is_empty()
            || self.merge_receipt_id.trim().is_empty()
            || self.created_at_unix_ms == 0
            || self.acceptance_coverage.is_empty()
            || !exact_acceptance_coverage
            || !self.repo_blockers.is_empty()
            || !self.policy_blockers.is_empty()
            || !self.operator_blockers.is_empty()
            || !self.external_blockers.is_empty()
            || self.tested_oid != self.reviewed_oid
            || self.reviewed_oid != self.integrated_oid
            || self.reviewer_principal_id != independence.reviewer_principal_id
            || independence.reviewer_principal_id == independence.builder_principal_id
            || independence.reviewer_logical_session_id == independence.builder_logical_session_id
            || independence.reviewer_lineage_ref.id == independence.builder_lineage_ref.id
            || !independence.eligible
            || independence.shared_ancestor_or_fork
            || !independence.disqualifying_relations.is_empty()
            || self.merge_result != "merged_exact_oid"
            || digest != packet_digest(&canonical)?
        {
            return validation("CompletedWorkPacket integrity or zero-blocker contract failed");
        }
        Ok(())
    }
}

impl BlockedWorkPacket {
    pub fn seal(mut self) -> Result<Self, MissionPlanError> {
        self.packet_digest.clear();
        self.packet_digest = packet_digest(&self)?;
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), MissionPlanError> {
        let mut canonical = self.clone();
        let digest = std::mem::take(&mut canonical.packet_digest);
        validate_sha256("planContentDigest", &self.plan_content_digest)?;
        validate_sha256(
            "settlementExpectedVersion",
            &self.settlement_expected_version,
        )?;
        validate_sha256("observedGitFingerprint", &self.observed_git_fingerprint)?;
        validate_git_oid("baseOid", &self.base_oid)?;
        for (name, oid) in [
            ("candidateOid", &self.candidate_oid),
            ("testedOid", &self.tested_oid),
            ("reviewedOid", &self.reviewed_oid),
            ("integratedOid", &self.integrated_oid),
        ] {
            if let Some(oid) = oid {
                validate_git_oid(name, oid)?;
            }
        }
        let blockers = self.repo_blockers.len()
            + self.policy_blockers.len()
            + self.operator_blockers.len()
            + self.external_blockers.len();
        let typed = self
            .repo_blockers
            .iter()
            .all(|b| b.kind == SettlementBlockerKind::Repo)
            && self
                .policy_blockers
                .iter()
                .all(|b| b.kind == SettlementBlockerKind::Policy)
            && self
                .operator_blockers
                .iter()
                .all(|b| b.kind == SettlementBlockerKind::Operator)
            && self
                .external_blockers
                .iter()
                .all(|b| b.kind == SettlementBlockerKind::External);
        let valid_blockers = self
            .repo_blockers
            .iter()
            .chain(self.policy_blockers.iter())
            .chain(self.operator_blockers.iter())
            .chain(self.external_blockers.iter())
            .all(|blocker| blocker.validate().is_ok());
        let blocker_ids = self
            .repo_blockers
            .iter()
            .chain(self.policy_blockers.iter())
            .chain(self.operator_blockers.iter())
            .chain(self.external_blockers.iter())
            .map(|blocker| blocker.blocker_id.as_str())
            .collect::<HashSet<_>>();
        let mut clause_ids = HashSet::new();
        let valid_coverage = self.acceptance_coverage.iter().all(|entry| {
            let gate_ids = entry.required_gate_ids.iter().collect::<HashSet<_>>();
            let evidence_ids = entry.evidence_ids.iter().collect::<HashSet<_>>();
            !entry.clause_id.trim().is_empty()
                && clause_ids.insert(entry.clause_id.as_str())
                && gate_ids.len() == entry.required_gate_ids.len()
                && entry
                    .required_gate_ids
                    .iter()
                    .all(|gate_id| !gate_id.trim().is_empty())
                && evidence_ids.len() == entry.evidence_ids.len()
                && entry
                    .evidence_ids
                    .iter()
                    .all(|evidence_id| !evidence_id.trim().is_empty())
        });
        let evidence_ids = self.evidence_ids.iter().collect::<HashSet<_>>();
        if self.schema != BLOCKED_WORK_PACKET_SCHEMA
            || self.contract_proof_version != A7_SETTLEMENT_PROOF_VERSION
            || self.packet_id.trim().is_empty()
            || self.activation_id.trim().is_empty()
            || self.plan_id.trim().is_empty()
            || self.plan_revision == 0
            || self.settlement_generation == 0
            || self
                .supersedes_packet_id
                .as_ref()
                .is_some_and(|packet_id| packet_id.trim().is_empty())
            || self.mission_id.trim().is_empty()
            || self.mission_revision == 0
            || self.work_unit_id.trim().is_empty()
            || self.created_at_unix_ms == 0
            || evidence_ids.len() != self.evidence_ids.len()
            || self
                .evidence_ids
                .iter()
                .any(|evidence_id| evidence_id.trim().is_empty())
            || self
                .review_id
                .as_ref()
                .is_some_and(|review_id| review_id.trim().is_empty())
            || self
                .merge_intent_id
                .as_ref()
                .is_some_and(|intent_id| intent_id.trim().is_empty())
            || self.completion_credit != 0
            || blockers == 0
            || blocker_ids.len() != blockers
            || !typed
            || !valid_blockers
            || !valid_coverage
            || digest != packet_digest(&canonical)?
        {
            return validation("BlockedWorkPacket integrity or zero-credit contract failed");
        }
        Ok(())
    }
}

impl MissionCompletionPacket {
    pub fn seal(mut self) -> Result<Self, MissionPlanError> {
        self.packet_digest.clear();
        self.packet_digest = packet_digest(&self)?;
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), MissionPlanError> {
        let mut canonical = self.clone();
        let digest = std::mem::take(&mut canonical.packet_digest);
        validate_git_oid("finalHeadOid", &self.final_head_oid)?;
        validate_git_oid("integratedOid", &self.integrated_oid)?;
        validate_sha256(
            "settlementExpectedVersion",
            &self.settlement_expected_version,
        )?;
        validate_sha256("observedGitFingerprint", &self.observed_git_fingerprint)?;
        let mut clause_ids = HashSet::new();
        let exact_mission_coverage = self.mission_acceptance_coverage.iter().all(|entry| {
            let gate_ids = entry.required_gate_ids.iter().collect::<HashSet<_>>();
            let evidence_ids = entry.evidence_ids.iter().collect::<HashSet<_>>();
            !entry.clause_id.trim().is_empty()
                && clause_ids.insert(entry.clause_id.as_str())
                && gate_ids.len() == entry.required_gate_ids.len()
                && entry
                    .required_gate_ids
                    .iter()
                    .all(|gate_id| !gate_id.trim().is_empty())
                && !entry.evidence_ids.is_empty()
                && evidence_ids.len() == entry.evidence_ids.len()
                && entry
                    .evidence_ids
                    .iter()
                    .all(|evidence_id| !evidence_id.trim().is_empty())
                && entry.accepted
        });
        let packet_ids = self
            .required_work_unit_packet_ids_by_work_unit
            .values()
            .collect::<HashSet<_>>();
        if self.schema != MISSION_COMPLETION_PACKET_SCHEMA
            || self.contract_proof_version != A7_SETTLEMENT_PROOF_VERSION
            || self.packet_id.trim().is_empty()
            || self.mission_id.trim().is_empty()
            || self.mission_revision == 0
            || self.settlement_generation == 0
            || self.created_at_unix_ms == 0
            || self.required_work_unit_packet_ids_by_work_unit.is_empty()
            || self.required_work_unit_packet_ids_by_work_unit.iter().any(
                |(work_unit_id, packet_id)| {
                    work_unit_id.trim().is_empty() || packet_id.trim().is_empty()
                },
            )
            || packet_ids.len() != self.required_work_unit_packet_ids_by_work_unit.len()
            || self.mission_acceptance_coverage.is_empty()
            || !exact_mission_coverage
            || !self.repo_blockers.is_empty()
            || !self.policy_blockers.is_empty()
            || !self.operator_blockers.is_empty()
            || !self.external_blockers.is_empty()
            || self.final_head_oid != self.integrated_oid
            || self.merge_result != "merged_exact_oid"
            || digest != packet_digest(&canonical)?
        {
            return validation("MissionCompletionPacket aggregate integrity failed");
        }
        Ok(())
    }
}

/// Derive the only executable A7.2 authority from a durable accepted preview.
/// No caller-provided repo, branch, target, or gate may enter this path.
pub fn activation_from_accepted_plan(
    preview: &MissionPlanPreview,
    activation_id: String,
    activated_at_unix_ms: u64,
) -> Result<(MissionPlanActivation, Task), MissionPlanError> {
    preview.verify_integrity()?;
    if preview.status != MissionPlanStatus::Accepted {
        return validation("only an accepted Mission plan can be activated");
    }
    validate_uuid_v7("activationId", &activation_id)?;
    let work = preview
        .work_units
        .first()
        .ok_or_else(|| MissionPlanError::Validation("accepted plan has no work unit".into()))?;
    if preview.work_units.len() != 1
        || preview.owned_targets != [A7_FIXTURE_OWNED_TARGET.to_string()]
        || preview.expected_tests.len() != 1
        || work.required_role != "implementer"
    {
        return validation("A7.2 activation authority differs from the frozen one-work-unit plan");
    }
    let activated_by = preview.decision_principal_id.clone().ok_or_else(|| {
        MissionPlanError::Validation("accepted plan lacks decision principal".into())
    })?;
    validate_decision_principal(&activated_by)?;
    let activation = MissionPlanActivation {
        schema: "aelyris.mission_plan_activation/v1".into(),
        activation_id,
        plan_id: preview.plan_id.clone(),
        plan_revision: preview.plan_revision,
        mission_id: preview.mission_definition.mission_id.clone(),
        mission_revision: preview.mission_definition.revision,
        work_unit_id: work.work_unit_id.clone(),
        task_id: work.work_unit_id.clone(),
        plan_content_digest: preview.content_digest.clone(),
        accepted_base_oid: preview.accepted_mission_head_oid.clone(),
        repository_root: preview.repository_root.clone(),
        source_branch: format!("a7-preview/{}", work.work_unit_id),
        target_branch: "a7-acceptance".into(),
        owned_targets: preview.owned_targets.clone(),
        test_argv: preview.expected_tests[0].command_argv.clone(),
        activated_by,
        activated_at_unix_ms,
    };
    let acceptance = preview
        .mission_definition
        .acceptance
        .iter()
        .map(|clause| format!("- {}", clause.statement))
        .collect::<Vec<_>>()
        .join("\n");
    let exact_argv = serde_json::to_string(&activation.test_argv)
        .map_err(|error| MissionPlanError::Validation(error.to_string()))?;
    let runtime_description = format!(
        "{}\n\nAccepted immutable Mission request:\n{}\n\nAcceptance clauses:\n{}\n\nOwned target (exclusive): {}\nExact post-freeze test argv (the backend runs this; do not widen or replace it): {}\nOn Windows, use apply_patch with repo-relative paths only. Do not run the declared cargo test yourself; the backend freezes the candidate and runs it at the exact OID. Edit no other path. Do not commit or merge; Aelyris freezes the owned diff after your exact done marker.",
        work.objective,
        preview.request,
        acceptance,
        activation.owned_targets.join(", "),
        exact_argv,
    );
    let task = activation.task(&work.title, &runtime_description);
    Ok((activation, task))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DigestContent<'a> {
    schema: &'a str,
    request_id: &'a str,
    request: &'a str,
    normalized_request: &'a str,
    request_digest: &'a str,
    plan_id: &'a str,
    plan_revision: u64,
    canonicalization: &'a str,
    repository_id: &'a str,
    repository_root: &'a str,
    accepted_mission_head_oid: &'a str,
    mission_definition: &'a MissionDefinitionRevision,
    work_units: &'a [WorkUnitDefinition],
    work_unit_ids: &'a [String],
    owned_targets: &'a [String],
    expected_tests: &'a [ExpectedTest],
    review_requirement: &'a IndependentReviewRequirement,
    merge_policy: &'a MergePolicy,
    explicit_risks: &'a [String],
}

impl MissionPlanPreview {
    pub(crate) fn from_input_with_repository(
        input: MissionPlanPreviewInput,
        repository_root: String,
        trusted_head_oid: String,
    ) -> Result<Self, MissionPlanError> {
        validate_uuid_v7("requestId", &input.request_id)?;
        validate_uuid_v7("planId", &input.plan_id)?;
        require_positive("planRevision", input.plan_revision)?;
        let normalized_request = normalize_request(&input.request);
        require_nonempty("request", &normalized_request)?;
        if input.request_id != A7_FIXTURE_REQUEST_ID
            || input.plan_id != A7_FIXTURE_PLAN_ID
            || input.request != A7_FIXTURE_REQUEST
        {
            return validation("A7.1 admits only the frozen A7 Core request and plan identity");
        }
        require_nonempty("repositoryRoot", &repository_root)?;
        validate_git_oid("trustedHeadOid", &trusted_head_oid)?;
        if trusted_head_oid != input.mission_definition.base_oid {
            return validation("accepted_mission_head does not match Mission baseOid");
        }
        let request_digest = sha256_hex(normalized_request.as_bytes());

        let ordered_work_units = validate_and_order(&input)?;
        let repository_ids = ordered_work_units
            .iter()
            .flat_map(|work| {
                work.file_intents
                    .iter()
                    .map(|intent| intent.resource_ref.repository_id.as_str())
                    .chain(
                        work.symbol_intents
                            .iter()
                            .map(|intent| intent.resource_ref.repository_id.as_str()),
                    )
            })
            .collect::<HashSet<_>>();
        if repository_ids.len() != 1 {
            return validation("A7 fixture must bind exactly one repository identity");
        }
        let repository_id = (*repository_ids.iter().next().expect("one repository id")).to_string();
        let work_unit_ids = ordered_work_units
            .iter()
            .map(|work| work.work_unit_id.clone())
            .collect::<Vec<_>>();
        let mut owned_targets = Vec::new();
        let mut owned_seen = HashSet::new();
        let mut expected_tests = Vec::new();
        for work in &ordered_work_units {
            for intent in &work.file_intents {
                if !matches!(intent.operation, ResourceOperation::Read)
                    && owned_seen.insert(intent.resource_ref.repo_relative_path.clone())
                {
                    owned_targets.push(intent.resource_ref.repo_relative_path.clone());
                }
            }
            expected_tests.extend(work.required_gates.iter().map(|gate| ExpectedTest {
                gate_id: gate.gate_id.clone(),
                command_argv: gate.command_argv.clone(),
                cwd_role: gate.cwd_role.clone(),
                required_result: "passed_exact_oid".to_string(),
                freshness_policy: gate.freshness_policy.clone(),
            }));
        }
        if owned_targets.is_empty() {
            return validation("plan declares no owned write target");
        }
        if expected_tests.is_empty() {
            return validation("plan declares no expected test gate");
        }

        let mut preview = Self {
            schema: MISSION_PLAN_PREVIEW_SCHEMA.to_string(),
            request_id: input.request_id,
            request: input.request,
            normalized_request,
            request_digest,
            plan_id: input.plan_id,
            plan_revision: input.plan_revision,
            status: MissionPlanStatus::Previewed,
            canonicalization: MISSION_PLAN_CANONICALIZATION.to_string(),
            repository_id,
            repository_root,
            accepted_mission_head_oid: trusted_head_oid,
            mission_definition: input.mission_definition,
            work_units: ordered_work_units,
            work_unit_ids,
            owned_targets,
            expected_tests,
            review_requirement: input.review_requirement,
            merge_policy: input.merge_policy,
            explicit_risks: input.explicit_risks,
            content_digest: String::new(),
            decision_principal_id: None,
            decision_reason: None,
            persisted_at_unix_ms: now_unix_ms()?,
            decided_at_unix_ms: None,
        };
        preview.content_digest = preview.recompute_content_digest()?;
        Ok(preview)
    }

    pub fn verify_integrity(&self) -> Result<(), MissionPlanError> {
        if self.schema != MISSION_PLAN_PREVIEW_SCHEMA
            || self.canonicalization != MISSION_PLAN_CANONICALIZATION
        {
            return validation("unsupported mission plan schema or canonicalization");
        }
        validate_uuid_v7("repositoryId", &self.repository_id)?;
        require_nonempty("repositoryRoot", &self.repository_root)?;
        validate_git_oid("acceptedMissionHeadOid", &self.accepted_mission_head_oid)?;
        if self.accepted_mission_head_oid != self.mission_definition.base_oid {
            return validation("persisted accepted_mission_head does not match Mission baseOid");
        }
        let input = MissionPlanPreviewInput {
            request_id: self.request_id.clone(),
            request: self.request.clone(),
            plan_id: self.plan_id.clone(),
            plan_revision: self.plan_revision,
            mission_definition: self.mission_definition.clone(),
            work_units: self.work_units.clone(),
            review_requirement: self.review_requirement.clone(),
            merge_policy: self.merge_policy.clone(),
            explicit_risks: self.explicit_risks.clone(),
        };
        let ordered = validate_and_order(&input)?;
        if ordered != self.work_units {
            return validation("persisted work-unit order is not canonical dependency order");
        }
        if normalize_request(&self.request) != self.normalized_request
            || sha256_hex(self.normalized_request.as_bytes()) != self.request_digest
        {
            return validation("request normalization or digest mismatch");
        }
        let expected_ids = self
            .work_units
            .iter()
            .map(|work| work.work_unit_id.clone())
            .collect::<Vec<_>>();
        let mut expected_targets = Vec::new();
        let mut seen = HashSet::new();
        let mut expected_tests = Vec::new();
        for work in &self.work_units {
            for intent in &work.file_intents {
                if !matches!(intent.operation, ResourceOperation::Read)
                    && seen.insert(intent.resource_ref.repo_relative_path.clone())
                {
                    expected_targets.push(intent.resource_ref.repo_relative_path.clone());
                }
            }
            expected_tests.extend(work.required_gates.iter().map(|gate| ExpectedTest {
                gate_id: gate.gate_id.clone(),
                command_argv: gate.command_argv.clone(),
                cwd_role: gate.cwd_role.clone(),
                required_result: "passed_exact_oid".to_string(),
                freshness_policy: gate.freshness_policy.clone(),
            }));
            if work
                .file_intents
                .iter()
                .any(|intent| intent.resource_ref.repository_id != self.repository_id)
                || work
                    .symbol_intents
                    .iter()
                    .any(|intent| intent.resource_ref.repository_id != self.repository_id)
            {
                return validation("repository identity binding was tampered");
            }
        }
        if expected_ids != self.work_unit_ids
            || expected_targets != self.owned_targets
            || expected_tests != self.expected_tests
        {
            return validation("derived plan preview fields were tampered");
        }
        if self.recompute_content_digest()? != self.content_digest {
            return validation("mission plan content digest mismatch");
        }
        if self.persisted_at_unix_ms > MAX_SAFE_JSON_INTEGER
            || self
                .decided_at_unix_ms
                .is_some_and(|value| value > MAX_SAFE_JSON_INTEGER)
        {
            return validation("mission plan timestamps exceed the RFC8785-safe integer range");
        }
        if let Some(principal) = &self.decision_principal_id {
            validate_decision_principal(principal)?;
        }
        match self.status {
            MissionPlanStatus::Previewed => {
                if self.decision_principal_id.is_some()
                    || self.decision_reason.is_some()
                    || self.decided_at_unix_ms.is_some()
                {
                    return validation("previewed plan carries terminal decision metadata");
                }
            }
            MissionPlanStatus::Accepted => {
                if self.decision_reason.is_some()
                    || self.decided_at_unix_ms.is_none()
                    || self.decision_principal_id.is_none()
                {
                    return validation("accepted plan has invalid decision metadata");
                }
            }
            MissionPlanStatus::Rejected | MissionPlanStatus::Cancelled => {
                if self
                    .decision_reason
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or("")
                    .is_empty()
                    || self.decision_principal_id.is_none()
                    || self.decided_at_unix_ms.is_none()
                {
                    return validation("rejected/cancelled plan lacks decision reason or time");
                }
            }
        }
        Ok(())
    }

    fn recompute_content_digest(&self) -> Result<String, MissionPlanError> {
        let content = DigestContent {
            schema: &self.schema,
            request_id: &self.request_id,
            request: &self.request,
            normalized_request: &self.normalized_request,
            request_digest: &self.request_digest,
            plan_id: &self.plan_id,
            plan_revision: self.plan_revision,
            canonicalization: &self.canonicalization,
            repository_id: &self.repository_id,
            repository_root: &self.repository_root,
            accepted_mission_head_oid: &self.accepted_mission_head_oid,
            mission_definition: &self.mission_definition,
            work_units: &self.work_units,
            work_unit_ids: &self.work_unit_ids,
            owned_targets: &self.owned_targets,
            expected_tests: &self.expected_tests,
            review_requirement: &self.review_requirement,
            merge_policy: &self.merge_policy,
            explicit_risks: &self.explicit_risks,
        };
        let value = serde_json::to_value(content)
            .map_err(|error| MissionPlanError::Validation(error.to_string()))?;
        Ok(sha256_hex(&canonical_json_bytes(&value)?))
    }
}

fn validate_and_order(
    input: &MissionPlanPreviewInput,
) -> Result<Vec<WorkUnitDefinition>, MissionPlanError> {
    let mission = &input.mission_definition;
    if mission.schema != MISSION_DEFINITION_SCHEMA {
        return validation("mission definition schema must be aelyris.mission_definition/v1");
    }
    for (name, id) in [
        ("missionId", mission.mission_id.as_str()),
        ("workspaceId", mission.workspace_id.as_str()),
        ("projectId", mission.project_id.as_str()),
        ("createdBy", mission.created_by.as_str()),
    ] {
        validate_uuid_v7(name, id)?;
    }
    if mission.mission_id != A7_FIXTURE_MISSION_ID
        || mission.revision != input.plan_revision
        || mission.work_graph_definition_revision != input.plan_revision
    {
        return validation(
            "A7.1 requires the frozen Mission identity and one aligned plan/Mission/work-graph revision",
        );
    }
    if mission.workspace_id != A7_FIXTURE_WORKSPACE_ID
        || mission.project_id != A7_FIXTURE_PROJECT_ID
        || mission.created_by != A7_FIXTURE_ACTOR_ID
        || mission.goal != "Add the named deterministic TaskGraph regression test"
        || mission.desired_outcome != "Insertion order remains proven"
        || mission.capability_outcome != "One bounded test-only change is reviewable"
        || mission.non_goals != ["No production behavior change without demonstrated defect"]
        || mission.created_at != "2026-08-01T00:00:00Z"
    {
        return validation("A7 fixture Mission identity and narrative contract must remain exact");
    }
    if let Some(approved_by) = &mission.approved_by {
        validate_uuid_v7("approvedBy", approved_by)?;
        return validation("preview input cannot pre-authorize approvedBy");
    }
    require_positive("mission revision", mission.revision)?;
    require_positive(
        "workGraphDefinitionRevision",
        mission.work_graph_definition_revision,
    )?;
    for (name, value) in [
        ("goal", mission.goal.as_str()),
        ("desiredOutcome", mission.desired_outcome.as_str()),
        ("capabilityOutcome", mission.capability_outcome.as_str()),
    ] {
        require_nonempty(name, value)?;
    }
    validate_rfc3339("createdAt", &mission.created_at)?;
    validate_git_oid("baseOid", &mission.base_oid)?;
    validate_nonempty_strings("nonGoals", &mission.non_goals)?;
    if mission.acceptance.is_empty() {
        return validation("mission acceptance cannot be empty");
    }
    validate_risk_policy(&mission.risk_policy)?;
    validate_budget_policy(&mission.budget_policy)?;
    validate_runtime_policy(&mission.runtime_policy)?;
    validate_team_policy(&mission.team_policy)?;

    if input.work_units.is_empty() {
        return validation("plan must contain at least one work unit");
    }
    if input.work_units.len() != 1
        || input.work_units[0].work_unit_id != A7_FIXTURE_WORK_UNIT_ID
        || input.work_units[0].definition_revision != input.plan_revision
    {
        return validation("A7.1 admits exactly the frozen single WorkUnit definition");
    }
    if input.explicit_risks != ["TaskGraph ordering regression"] {
        return validation("A7 fixture must declare exactly its frozen explicit risk");
    }
    validate_nonempty_strings("explicitRisks", &input.explicit_risks)?;
    validate_review_requirement(&input.review_requirement, &mission.team_policy)?;
    if input.merge_policy.result != "merged_exact_oid"
        || input.merge_policy.target_branch_role != "isolated_mission_acceptance_target"
        || input.merge_policy.automatic_main_merge
    {
        return validation(
            "merge policy must require isolated exact-OID merge with automaticMainMerge=false",
        );
    }

    let mut clause_ids = HashSet::new();
    if mission.acceptance.len() != A7_FIXTURE_ACCEPTANCE.len() {
        return validation("A7 fixture requires exactly four acceptance clauses");
    }
    for (index, clause) in mission.acceptance.iter().enumerate() {
        validate_uuid_v7("acceptance.clauseId", &clause.clause_id)?;
        require_nonempty("acceptance.statement", &clause.statement)?;
        let expected_gate_ids: &[&str] = if index == 2 {
            &[A7_FIXTURE_GATE_ID]
        } else {
            &[]
        };
        if clause.clause_id != A7_FIXTURE_CLAUSE_IDS[index]
            || clause.statement != A7_FIXTURE_ACCEPTANCE[index]
            || clause.required_gate_ids
                != expected_gate_ids
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect::<Vec<_>>()
            || !clause.required_artifact_ids.is_empty()
            || !clause.completion_blocking
        {
            return validation("A7 fixture acceptance clauses differ from the frozen contract");
        }
        if !clause_ids.insert(clause.clause_id.clone()) {
            return validation("duplicate acceptance clause id");
        }
        validate_nonempty_strings("acceptance.requiredGateIds", &clause.required_gate_ids)?;
        validate_nonempty_strings(
            "acceptance.requiredArtifactIds",
            &clause.required_artifact_ids,
        )?;
    }

    let all_work_ids = input
        .work_units
        .iter()
        .map(|work| work.work_unit_id.clone())
        .collect::<HashSet<_>>();
    if all_work_ids.len() != input.work_units.len() {
        return validation("duplicate workUnitId");
    }
    let role_map = mission
        .team_policy
        .roles
        .iter()
        .map(|role| (role.role_id.as_str(), role))
        .collect::<HashMap<_, _>>();
    let mut gate_ids = HashSet::new();
    let mut artifact_ids = HashSet::new();
    let mut tasks = Vec::with_capacity(input.work_units.len());
    for work in &input.work_units {
        validate_uuid_v7("workUnitId", &work.work_unit_id)?;
        validate_uuid_v7("workUnit.missionId", &work.mission_id)?;
        if work.mission_id != mission.mission_id {
            return validation("work unit missionId does not match Mission");
        }
        if work.definition_revision != mission.work_graph_definition_revision {
            return validation("work unit definitionRevision does not match work graph revision");
        }
        require_nonempty("workUnit.title", &work.title)?;
        require_nonempty("workUnit.objective", &work.objective)?;
        if work.title != "Add stable-order regression test"
            || work.objective != "Prove equal-priority roots preserve insertion order"
            || !work.depends_on.is_empty()
            || work.risk_class != RiskClass::Low
            || work.capability_unlock.unlock_id != A7_FIXTURE_UNLOCK_ID
        {
            return validation("A7 fixture WorkUnit contract must remain exact");
        }
        let role = role_map.get(work.required_role.as_str()).ok_or_else(|| {
            MissionPlanError::Validation("work unit requiredRole is undeclared".into())
        })?;
        if !role.may_implement {
            return validation("work unit requiredRole may not implement");
        }
        if work.required_role == input.review_requirement.role {
            return validation("independent reviewer role cannot be the implementer role");
        }
        if work.required_role != "implementer"
            || work.completion_authority_role_ids != ["independent_reviewer"]
        {
            return validation(
                "A7 fixture requires implementer execution and independent_reviewer completion authority",
            );
        }
        if work.completion_authority_role_ids.is_empty() {
            return validation("work unit lacks completion authority roles");
        }
        for role_id in &work.completion_authority_role_ids {
            let authority = role_map.get(role_id.as_str()).ok_or_else(|| {
                MissionPlanError::Validation("undeclared completion authority role".into())
            })?;
            if !authority.may_authorize_completion {
                return validation("completion authority role lacks authorization policy");
            }
        }
        for dep in &work.depends_on {
            validate_uuid_v7("workUnit.dependsOn", dep)?;
            if dep == &work.work_unit_id || !all_work_ids.contains(dep) {
                return validation("work unit has self or unknown dependency");
            }
        }
        if work.file_intents.is_empty() {
            return validation("work unit must declare fileIntents");
        }
        if work.required_adapter_capabilities != [AdapterCapability::Prompt]
            || work.file_intents.len() != 1
            || work.file_intents[0].operation != ResourceOperation::Update
            || work.file_intents[0].resource_ref.repository_id != A7_FIXTURE_REPOSITORY_ID
            || work.file_intents[0].resource_ref.repo_relative_path != A7_FIXTURE_OWNED_TARGET
            || work.file_intents[0].resource_ref.blob_oid.is_some()
            || work.file_intents[0].expected_base_digest.is_some()
            || !work.symbol_intents.is_empty()
            || !work.required_capability_templates.is_empty()
            || !work.required_artifacts.is_empty()
        {
            return validation(
                "A7 fixture requires Prompt and exactly one graph.rs update with no extra authority",
            );
        }
        for intent in &work.file_intents {
            validate_resource_ref(&intent.resource_ref, &mission.base_oid)?;
            if let Some(digest) = &intent.expected_base_digest {
                validate_sha256("expectedBaseDigest", digest)?;
            }
        }
        for intent in &work.symbol_intents {
            validate_resource_ref(&intent.resource_ref, &mission.base_oid)?;
            for (name, value) in [
                ("symbol.language", intent.language.as_str()),
                ("symbol.symbolKind", intent.symbol_kind.as_str()),
                ("symbol.qualifiedName", intent.qualified_name.as_str()),
                ("symbol.stableLocator", intent.stable_locator.as_str()),
            ] {
                require_nonempty(name, value)?;
            }
        }
        for template in &work.required_capability_templates {
            for (name, value) in [
                (
                    "capabilityTemplateId",
                    template.capability_template_id.as_str(),
                ),
                ("capability.version", template.version.as_str()),
                ("capability.action", template.action.as_str()),
                (
                    "capability.approvalPolicyId",
                    template.approval_policy_id.as_str(),
                ),
            ] {
                require_nonempty(name, value)?;
            }
            validate_nonempty_strings("capability.scopeKinds", &template.scope_kinds)?;
            if !template.one_use_required {
                return validation("A7 capability templates must be one-use");
            }
        }
        if work.required_gates.is_empty() {
            return validation("work unit must declare at least one required gate");
        }
        if work.required_gates.len() != 1 {
            return validation("A7 fixture requires exactly one declared focused gate");
        }
        for gate in &work.required_gates {
            validate_gate(gate)?;
            if !gate_ids.insert(gate.gate_id.clone()) {
                return validation("duplicate gateId across plan");
            }
        }
        for artifact in &work.required_artifacts {
            validate_artifact(artifact)?;
            if !artifact_ids.insert(artifact.artifact_id.clone()) {
                return validation("duplicate artifactId across plan");
            }
        }
        if work.risk_class > mission.risk_policy.maximum_risk_class {
            return validation("work-unit risk exceeds Mission risk policy");
        }
        validate_uuid_v7(
            "capabilityUnlock.unlockId",
            &work.capability_unlock.unlock_id,
        )?;
        validate_uuid_v7(
            "capabilityUnlock.availableAfterWorkUnitId",
            &work.capability_unlock.available_after_work_unit_id,
        )?;
        require_nonempty(
            "capabilityUnlock.capability",
            &work.capability_unlock.capability,
        )?;
        if work.capability_unlock.capability != "a7.2.activate_visible_implementation"
            || work.capability_unlock.available_after_work_unit_id != A7_FIXTURE_WORK_UNIT_ID
            || work.capability_unlock.condition_clause_ids
                != A7_FIXTURE_CLAUSE_IDS
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect::<Vec<_>>()
        {
            return validation("A7 fixture capability unlock differs from the frozen A7.2 seam");
        }
        if !all_work_ids.contains(&work.capability_unlock.available_after_work_unit_id) {
            return validation("capability unlock references unknown work unit");
        }
        for clause_id in &work.capability_unlock.condition_clause_ids {
            validate_uuid_v7("capabilityUnlock.conditionClauseIds", clause_id)?;
            if !clause_ids.contains(clause_id) {
                return validation("capability unlock references unknown acceptance clause");
            }
        }

        let outputs = work
            .file_intents
            .iter()
            .filter(|intent| !matches!(intent.operation, ResourceOperation::Read))
            .map(|intent| intent.resource_ref.repo_relative_path.clone())
            .collect::<Vec<_>>();
        let mut task = Task::new(&work.work_unit_id, &work.title);
        task.description = work.objective.clone();
        task.owner = Some(work.required_role.clone());
        task.dependencies = work.depends_on.clone();
        task.outputs = outputs;
        // Validation-only names. They are never stored or published and confer no
        // execution/merge authority.
        task.source_branch = Some(format!("a7-preview/{}", work.work_unit_id));
        task.target_branch = Some("a7-acceptance".to_string());
        tasks.push(task);
    }

    for clause in &mission.acceptance {
        if clause
            .required_gate_ids
            .iter()
            .any(|gate| !gate_ids.contains(gate))
            || clause
                .required_artifact_ids
                .iter()
                .any(|artifact| !artifact_ids.contains(artifact))
        {
            return validation("acceptance clause references undeclared gate or artifact");
        }
    }

    let ordered_tasks = validate_plan(tasks).map_err(|errors| {
        MissionPlanError::Validation(format!(
            "TaskGraph projection rejected: {}",
            errors.join("; ")
        ))
    })?;
    let by_id = input
        .work_units
        .iter()
        .cloned()
        .map(|work| (work.work_unit_id.clone(), work))
        .collect::<HashMap<_, _>>();
    ordered_tasks
        .into_iter()
        .map(|task| {
            by_id.get(&task.id).cloned().ok_or_else(|| {
                MissionPlanError::Validation("TaskGraph projection lost a work unit".into())
            })
        })
        .collect()
}

fn validate_review_requirement(
    review: &IndependentReviewRequirement,
    team: &TeamExecutionPolicy,
) -> Result<(), MissionPlanError> {
    require_nonempty("review.role", &review.role)?;
    if review.role != "independent_reviewer"
        || review.policy_id != "a7-core-reviewer-independence/v1"
        || review.policy_id != team.reviewer_independence_policy_id
    {
        return validation("review policy does not match Mission team policy");
    }
    let role = team.roles.iter().find(|role| role.role_id == review.role);
    if !role.is_some_and(|role| role.may_review && !role.may_implement) {
        return validation("independent reviewer role is absent or may not review");
    }
    let required = HashSet::from([
        ReviewerDifference::PrincipalId,
        ReviewerDifference::LogicalSessionId,
        ReviewerDifference::ForkLineage,
    ]);
    let actual = review
        .must_differ_from_implementer_by
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    if actual != required || review.must_differ_from_implementer_by.len() != required.len() {
        return validation("review independence must cover principal, logical session, and fork lineage exactly once");
    }
    if review.required_verdict != "accepted_exact_oid" {
        return validation("review must require accepted_exact_oid");
    }
    Ok(())
}

fn validate_risk_policy(policy: &RiskPolicy) -> Result<(), MissionPlanError> {
    for (name, value) in [
        ("riskPolicy.policyId", policy.policy_id.as_str()),
        ("riskPolicy.policyVersion", policy.policy_version.as_str()),
        (
            "riskPolicy.reconciliationPolicyId",
            policy.reconciliation_policy_id.as_str(),
        ),
    ] {
        require_nonempty(name, value)?;
    }
    validate_nonempty_strings(
        "riskPolicy.humanApprovalRiskClasses",
        &policy.human_approval_risk_classes,
    )?;
    if policy.policy_id != "a7-core-risk/v1"
        || policy.policy_version != "1"
        || policy.maximum_risk_class != RiskClass::Moderate
        || policy.human_approval_risk_classes != ["high", "irreversible"]
        || policy.reconciliation_policy_id != "a7-reconcile/v1"
    {
        return validation("A7 fixture risk policy must remain exact");
    }
    Ok(())
}

fn validate_budget_policy(policy: &BudgetPolicy) -> Result<(), MissionPlanError> {
    require_nonempty("budgetPolicy.policyId", &policy.policy_id)?;
    require_nonempty("budgetPolicy.policyVersion", &policy.policy_version)?;
    for limit in &policy.limits {
        require_nonempty("budgetLimit.unit", &limit.unit)?;
        validate_decimal_string("budgetLimit.amount", &limit.amount)?;
        if matches!(limit.kind, BudgetKind::Currency)
            && limit
                .currency_iso_code
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
        {
            return validation("currency budget requires currencyIsoCode");
        }
    }
    if policy.policy_id != "a7-budget/v1"
        || policy.policy_version != "1"
        || policy.limits.len() != 1
        || policy.limits[0].kind != BudgetKind::WallTimeMs
        || policy.limits[0].unit != "ms"
        || policy.limits[0].amount != "600000"
        || policy.limits[0].currency_iso_code.is_some()
        || !policy.limits[0].hard
        || policy.exhaustion_result != BudgetExhaustionResult::Blocked
    {
        return validation("A7 fixture budget policy must remain exact");
    }
    Ok(())
}

fn validate_runtime_policy(policy: &RuntimePolicy) -> Result<(), MissionPlanError> {
    require_nonempty("runtimePolicy.policyId", &policy.policy_id)?;
    require_nonempty("runtimePolicy.policyVersion", &policy.policy_version)?;
    validate_nonempty_strings(
        "runtimePolicy.allowedRuntimeDomainIds",
        &policy.allowed_runtime_domain_ids,
    )?;
    if policy.policy_id != "visible-pty/v1"
        || policy.policy_version != "1"
        || !policy.visible_pty_required
        || policy.allowed_runtime_domain_ids != ["visible_pty"]
        || policy.required_adapter_capabilities != [AdapterCapability::Prompt]
    {
        return validation(
            "A7 fixture runtime must be exactly visible_pty with Prompt and visiblePtyRequired=true",
        );
    }
    Ok(())
}

fn validate_team_policy(policy: &TeamExecutionPolicy) -> Result<(), MissionPlanError> {
    if policy.roles.is_empty() {
        return validation("teamPolicy.roles cannot be empty");
    }
    let mut roles = HashSet::new();
    for role in &policy.roles {
        require_nonempty("teamPolicy.roleId", &role.role_id)?;
        require_nonempty("teamPolicy.budgetProfileId", &role.budget_profile_id)?;
        require_nonempty("teamPolicy.proofProfileId", &role.proof_profile_id)?;
        validate_nonempty_strings(
            "teamPolicy.capabilityProfileIds",
            &role.capability_profile_ids,
        )?;
        if !roles.insert(role.role_id.as_str()) {
            return validation("duplicate team role id");
        }
    }
    for (name, value) in [
        (
            "teamPolicy.reviewerIndependencePolicyId",
            policy.reviewer_independence_policy_id.as_str(),
        ),
        (
            "teamPolicy.ownershipPolicyId",
            policy.ownership_policy_id.as_str(),
        ),
        (
            "teamPolicy.governancePolicyId",
            policy.governance_policy_id.as_str(),
        ),
    ] {
        require_nonempty(name, value)?;
    }
    let role_matches = |role: &TeamRolePolicy,
                        role_id: &str,
                        capability_profile: &str,
                        may_implement: bool,
                        may_review: bool,
                        may_authorize_completion: bool| {
        role.role_id == role_id
            && role.capability_profile_ids == [capability_profile]
            && role.budget_profile_id == "bounded/v1"
            && role.proof_profile_id == "exact-oid/v1"
            && role.may_implement == may_implement
            && role.may_review == may_review
            && role.may_authorize_completion == may_authorize_completion
    };
    if policy.roles.len() != 2
        || !role_matches(
            &policy.roles[0],
            "implementer",
            "a7-impl/v1",
            true,
            false,
            false,
        )
        || !role_matches(
            &policy.roles[1],
            "independent_reviewer",
            "a7-review/v1",
            false,
            true,
            true,
        )
        || policy.reviewer_independence_policy_id != "a7-core-reviewer-independence/v1"
        || policy.ownership_policy_id != "a7-exact-path/v1"
        || policy.governance_policy_id != "a7-core/v1"
    {
        return validation("A7 fixture team and authority policy must remain exact");
    }
    Ok(())
}

fn validate_gate(gate: &GateRequirement) -> Result<(), MissionPlanError> {
    require_nonempty("gateId", &gate.gate_id)?;
    require_nonempty("gate.contractVersion", &gate.contract_version)?;
    validate_nonempty_strings("gate.commandArgv", &gate.command_argv)?;
    if gate.contract_version != "1"
        || gate.cwd_role != "mission_worktree"
        || gate.required_result != "passed"
    {
        return validation("gate must require passed in mission_worktree");
    }
    if gate.gate_id != A7_FIXTURE_GATE_ID
        || gate.command_argv
            != A7_FIXTURE_TEST_ARGV
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
    {
        return validation("A7 fixture gate command differs from the frozen declared test");
    }
    validate_freshness(&gate.freshness_policy)?;
    Ok(())
}

fn validate_artifact(artifact: &ArtifactRequirement) -> Result<(), MissionPlanError> {
    for (name, value) in [
        ("artifactId", artifact.artifact_id.as_str()),
        ("artifact.kind", artifact.kind.as_str()),
        (
            "artifact.locatorPolicyId",
            artifact.locator_policy_id.as_str(),
        ),
    ] {
        require_nonempty(name, value)?;
    }
    if artifact.digest_algorithm != "sha256" {
        return validation("artifact digestAlgorithm must be sha256");
    }
    validate_freshness(&artifact.freshness_policy)
}

fn validate_freshness(policy: &EvidenceFreshnessPolicy) -> Result<(), MissionPlanError> {
    require_nonempty("freshness.policyId", &policy.policy_id)?;
    validate_decimal_string("freshness.maxAgeMs", &policy.max_age_ms)?;
    if policy.policy_id != "a7-exact-oid/v1"
        || policy.max_age_ms != "300000"
        || !policy.require_same_head_oid
        || !policy.require_same_contract_version
        || !policy.require_same_environment_fingerprint
    {
        return validation("A7 fixture freshness policy must bind OID, contract, and environment");
    }
    Ok(())
}

fn validate_resource_ref(
    resource: &RepositoryResourceRef,
    mission_base_oid: &str,
) -> Result<(), MissionPlanError> {
    validate_uuid_v7("repositoryId", &resource.repository_id)?;
    validate_repo_relative_path(&resource.repo_relative_path)?;
    validate_git_oid("resource.baseOid", &resource.base_oid)?;
    validate_git_oid("resource.headOid", &resource.head_oid)?;
    if resource.base_oid != mission_base_oid || resource.head_oid != mission_base_oid {
        return validation("preview resource OIDs must equal the accepted Mission base OID");
    }
    if let Some(blob_oid) = &resource.blob_oid {
        validate_git_oid("resource.blobOid", blob_oid)?;
    }
    Ok(())
}

fn require_nonempty(name: &str, value: &str) -> Result<(), MissionPlanError> {
    if value.trim().is_empty() {
        validation(format!("{name} cannot be empty"))
    } else {
        Ok(())
    }
}

fn validate_nonempty_strings(name: &str, values: &[String]) -> Result<(), MissionPlanError> {
    if values.iter().any(|value| value.trim().is_empty()) {
        validation(format!("{name} contains an empty string"))
    } else {
        Ok(())
    }
}

fn require_positive(name: &str, value: u64) -> Result<(), MissionPlanError> {
    if value == 0 || value > MAX_SAFE_JSON_INTEGER {
        validation(format!("{name} must be a positive RFC8785-safe integer"))
    } else {
        Ok(())
    }
}

fn validate_uuid_v7(name: &str, value: &str) -> Result<(), MissionPlanError> {
    let uuid = Uuid::parse_str(value)
        .map_err(|_| MissionPlanError::Validation(format!("{name} must be UUIDv7")))?;
    if uuid.get_version_num() != 7
        || uuid.get_variant() != uuid::Variant::RFC4122
        || uuid.hyphenated().to_string() != value
    {
        return validation(format!(
            "{name} must be canonical lowercase hyphenated UUIDv7"
        ));
    }
    Ok(())
}

fn validate_rfc3339(name: &str, value: &str) -> Result<(), MissionPlanError> {
    fn digits(bytes: &[u8]) -> Option<u32> {
        if bytes.iter().all(u8::is_ascii_digit) {
            std::str::from_utf8(bytes).ok()?.parse().ok()
        } else {
            None
        }
    }

    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return validation(format!("{name} must be RFC3339"));
    }
    let year = digits(&bytes[0..4]).unwrap_or(0);
    let month = digits(&bytes[5..7]).unwrap_or(0);
    let day = digits(&bytes[8..10]).unwrap_or(0);
    let hour = digits(&bytes[11..13]).unwrap_or(99);
    let minute = digits(&bytes[14..16]).unwrap_or(99);
    let second = digits(&bytes[17..19]).unwrap_or(99);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if year == 0 || day == 0 || day > max_day || hour > 23 || minute > 59 || second > 60 {
        return validation(format!("{name} must be RFC3339"));
    }
    let mut tail = &bytes[19..];
    if tail.first() == Some(&b'.') {
        let fraction_len = tail[1..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if fraction_len == 0 {
            return validation(format!("{name} must be RFC3339"));
        }
        tail = &tail[1 + fraction_len..];
    }
    let valid_zone = tail == b"Z"
        || (tail.len() == 6
            && matches!(tail[0], b'+' | b'-')
            && tail[3] == b':'
            && digits(&tail[1..3]).is_some_and(|hour| hour <= 23)
            && digits(&tail[4..6]).is_some_and(|minute| minute <= 59));
    if !valid_zone {
        return validation(format!("{name} must be RFC3339"));
    }
    Ok(())
}

fn validate_git_oid(name: &str, value: &str) -> Result<(), MissionPlanError> {
    if value.len() != 40
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase())
    {
        return validation(format!("{name} must be a 40-character lowercase Git OID"));
    }
    git2::Oid::from_str(value)
        .map(|_| ())
        .map_err(|_| MissionPlanError::Validation(format!("{name} is not a Git OID")))
}

fn validate_sha256(name: &str, value: &str) -> Result<(), MissionPlanError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Ok(())
    } else {
        validation(format!("{name} must be a lowercase SHA-256 digest"))
    }
}

fn validate_decimal_string(name: &str, value: &str) -> Result<(), MissionPlanError> {
    let valid = value == "0"
        || (!value.starts_with('0')
            && !value.is_empty()
            && value.bytes().all(|b| b.is_ascii_digit()));
    if valid {
        Ok(())
    } else {
        validation(format!(
            "{name} must be an unsigned canonical decimal string"
        ))
    }
}

fn validate_repo_relative_path(value: &str) -> Result<(), MissionPlanError> {
    if value.is_empty()
        || value.starts_with('/')
        || value.ends_with('/')
        || value.contains('\\')
        || value.contains(':')
        || value.contains('\0')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return validation("owned target must be an exact normalized repo-relative path");
    }
    Ok(())
}

fn normalize_request(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn decision_unix_ms() -> Result<u64, MissionPlanError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
        .as_millis();
    u64::try_from(millis)
        .map_err(|_| MissionPlanError::Persistence("system time exceeds u64".into()))
}

fn now_unix_ms() -> Result<u64, MissionPlanError> {
    decision_unix_ms()
}

pub(crate) fn validate_decision_principal(value: &str) -> Result<(), MissionPlanError> {
    validate_uuid_v7("decisionPrincipalId", value)
}

fn validation<T>(message: impl Into<String>) -> Result<T, MissionPlanError> {
    Err(MissionPlanError::Validation(message.into()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// RFC 8785-compatible subset used by the A7 contracts. Object keys use UTF-16
/// lexical order and integers use ECMAScript-safe exact forms. Floating-point or
/// unsafe integer shapes fail closed instead of being mislabeled RFC 8785.
fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, MissionPlanError> {
    fn write(value: &Value, out: &mut Vec<u8>) -> Result<(), MissionPlanError> {
        match value {
            Value::Null => out.extend_from_slice(b"null"),
            Value::Bool(true) => out.extend_from_slice(b"true"),
            Value::Bool(false) => out.extend_from_slice(b"false"),
            Value::String(text) => out.extend_from_slice(
                serde_json::to_string(text)
                    .map_err(|error| MissionPlanError::Validation(error.to_string()))?
                    .as_bytes(),
            ),
            Value::Number(number) => {
                let safe = number
                    .as_u64()
                    .is_some_and(|value| value <= MAX_SAFE_JSON_INTEGER)
                    || number
                        .as_i64()
                        .is_some_and(|value| value.unsigned_abs() <= MAX_SAFE_JSON_INTEGER);
                if !safe || number.is_f64() {
                    return validation("unsupported RFC8785 number shape");
                }
                out.extend_from_slice(number.to_string().as_bytes());
            }
            Value::Array(items) => {
                out.push(b'[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    write(item, out)?;
                }
                out.push(b']');
            }
            Value::Object(map) => {
                let mut keys = map.keys().collect::<Vec<_>>();
                keys.sort_by(|left, right| utf16_cmp(left, right));
                out.push(b'{');
                for (index, key) in keys.into_iter().enumerate() {
                    if index > 0 {
                        out.push(b',');
                    }
                    out.extend_from_slice(
                        serde_json::to_string(key)
                            .map_err(|error| MissionPlanError::Validation(error.to_string()))?
                            .as_bytes(),
                    );
                    out.push(b':');
                    write(&map[key], out)?;
                }
                out.push(b'}');
            }
        }
        Ok(())
    }

    let mut output = Vec::new();
    write(value, &mut output)?;
    Ok(output)
}

fn utf16_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const REQUEST_ID: &str = "0197c000-0000-7000-8000-000000000001";
    const MISSION_ID: &str = "0197c000-0000-7000-8000-000000000002";
    const WORK_ID: &str = "0197c000-0000-7000-8000-000000000003";
    const PLAN_ID: &str = "0197c000-0000-7000-8000-000000000004";
    const WORKSPACE_ID: &str = "0197c000-0000-7000-8000-000000000005";
    const PROJECT_ID: &str = "0197c000-0000-7000-8000-000000000006";
    const ACTOR_ID: &str = "0197c000-0000-7000-8000-000000000007";
    const REPO_ID: &str = "0197c000-0000-7000-8000-000000000008";
    const CLAUSE_1_ID: &str = "0197c000-0000-7000-8000-000000000009";
    const CLAUSE_2_ID: &str = "0197c000-0000-7000-8000-00000000000a";
    const CLAUSE_3_ID: &str = "0197c000-0000-7000-8000-00000000000b";
    const CLAUSE_4_ID: &str = "0197c000-0000-7000-8000-00000000000c";
    const UNLOCK_ID: &str = "0197c000-0000-7000-8000-00000000000d";
    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    pub(crate) fn fixed_preview(
        input: MissionPlanPreviewInput,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        fixed_preview_at_root(input, "C:/a7-fixture-repository")
    }

    pub(crate) fn fixed_preview_at_root(
        input: MissionPlanPreviewInput,
        repository_root: &str,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        MissionPlanPreview::from_input_with_repository(input, repository_root.into(), OID.into())
    }

    pub(crate) fn fixed_input() -> MissionPlanPreviewInput {
        let freshness = EvidenceFreshnessPolicy {
            policy_id: "a7-exact-oid/v1".into(),
            max_age_ms: "300000".into(),
            require_same_head_oid: true,
            require_same_contract_version: true,
            require_same_environment_fingerprint: true,
        };
        let implementer = TeamRolePolicy {
            role_id: "implementer".into(),
            capability_profile_ids: vec!["a7-impl/v1".into()],
            budget_profile_id: "bounded/v1".into(),
            proof_profile_id: "exact-oid/v1".into(),
            may_implement: true,
            may_review: false,
            may_authorize_completion: false,
        };
        let reviewer = TeamRolePolicy {
            role_id: "independent_reviewer".into(),
            capability_profile_ids: vec!["a7-review/v1".into()],
            budget_profile_id: "bounded/v1".into(),
            proof_profile_id: "exact-oid/v1".into(),
            may_implement: false,
            may_review: true,
            may_authorize_completion: true,
        };
        MissionPlanPreviewInput {
            request_id: REQUEST_ID.into(),
            request: "Add a Rust regression test named equal_priority_ready_tasks_preserve_insertion_order in src-tauri/src/task/graph.rs. It must insert two Medium root tasks in order, recompute readiness, and prove ready_tasks() preserves insertion order. Change no production behavior unless the new test first demonstrates a defect.".into(),
            plan_id: PLAN_ID.into(),
            plan_revision: 1,
            mission_definition: MissionDefinitionRevision {
                schema: MISSION_DEFINITION_SCHEMA.into(),
                mission_id: MISSION_ID.into(),
                revision: 1,
                workspace_id: WORKSPACE_ID.into(),
                project_id: PROJECT_ID.into(),
                goal: "Add the named deterministic TaskGraph regression test".into(),
                desired_outcome: "Insertion order remains proven".into(),
                capability_outcome: "One bounded test-only change is reviewable".into(),
                non_goals: vec!["No production behavior change without demonstrated defect".into()],
                base_oid: OID.into(),
                acceptance: vec![
                    AcceptanceClause {
                        clause_id: CLAUSE_1_ID.into(),
                        statement: "A7-FIX-01: add exactly the named deterministic regression test".into(),
                        required_gate_ids: vec![],
                        required_artifact_ids: vec![],
                        completion_blocking: true,
                    },
                    AcceptanceClause {
                        clause_id: CLAUSE_2_ID.into(),
                        statement: "A7-FIX-02: preserve production behavior unless the test first demonstrates a defect".into(),
                        required_gate_ids: vec![],
                        required_artifact_ids: vec![],
                        completion_blocking: true,
                    },
                    AcceptanceClause {
                        clause_id: CLAUSE_3_ID.into(),
                        statement: "A7-FIX-03: the declared focused test passes at the exact candidate OID".into(),
                        // GateRequirement's catalog result is `passed`; the same-head-OID
                        // freshness policy plus A7 review/merge exact-OID requirements
                        // compose the fixture's `passed_exact_oid` outcome.
                        required_gate_ids: vec!["a7-fixed-test".into()],
                        required_artifact_ids: vec![],
                        completion_blocking: true,
                    },
                    AcceptanceClause {
                        clause_id: CLAUSE_4_ID.into(),
                        statement: "A7-FIX-04: the owned diff contains no path outside src-tauri/src/task/graph.rs".into(),
                        required_gate_ids: vec![],
                        required_artifact_ids: vec![],
                        completion_blocking: true,
                    },
                ],
                risk_policy: RiskPolicy {
                    policy_id: "a7-core-risk/v1".into(),
                    policy_version: "1".into(),
                    maximum_risk_class: RiskClass::Moderate,
                    human_approval_risk_classes: vec!["high".into(), "irreversible".into()],
                    reconciliation_policy_id: "a7-reconcile/v1".into(),
                },
                budget_policy: BudgetPolicy {
                    policy_id: "a7-budget/v1".into(),
                    policy_version: "1".into(),
                    limits: vec![BudgetLimit {
                        kind: BudgetKind::WallTimeMs,
                        unit: "ms".into(),
                        amount: "600000".into(),
                        currency_iso_code: None,
                        hard: true,
                    }],
                    exhaustion_result: BudgetExhaustionResult::Blocked,
                },
                runtime_policy: RuntimePolicy {
                    policy_id: "visible-pty/v1".into(),
                    policy_version: "1".into(),
                    allowed_runtime_domain_ids: vec!["visible_pty".into()],
                    required_adapter_capabilities: vec![AdapterCapability::Prompt],
                    visible_pty_required: true,
                },
                team_policy: TeamExecutionPolicy {
                    roles: vec![implementer, reviewer],
                    reviewer_independence_policy_id: "a7-core-reviewer-independence/v1".into(),
                    ownership_policy_id: "a7-exact-path/v1".into(),
                    governance_policy_id: "a7-core/v1".into(),
                },
                work_graph_definition_revision: 1,
                created_by: ACTOR_ID.into(),
                approved_by: None,
                created_at: "2026-08-01T00:00:00Z".into(),
            },
            work_units: vec![WorkUnitDefinition {
                work_unit_id: WORK_ID.into(),
                mission_id: MISSION_ID.into(),
                definition_revision: 1,
                title: "Add stable-order regression test".into(),
                objective: "Prove equal-priority roots preserve insertion order".into(),
                depends_on: vec![],
                required_role: "implementer".into(),
                completion_authority_role_ids: vec!["independent_reviewer".into()],
                required_adapter_capabilities: vec![AdapterCapability::Prompt],
                file_intents: vec![ResourceIntent {
                    resource_ref: RepositoryResourceRef {
                        repository_id: REPO_ID.into(),
                        repo_relative_path: "src-tauri/src/task/graph.rs".into(),
                        base_oid: OID.into(),
                        head_oid: OID.into(),
                        blob_oid: None,
                    },
                    operation: ResourceOperation::Update,
                    expected_base_digest: None,
                }],
                symbol_intents: vec![],
                required_capability_templates: vec![],
                required_gates: vec![GateRequirement {
                    gate_id: "a7-fixed-test".into(),
                    contract_version: "1".into(),
                    command_argv: vec![
                        "cargo".into(),
                        "test".into(),
                        "--manifest-path".into(),
                        "src-tauri/Cargo.toml".into(),
                        "--lib".into(),
                        "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order".into(),
                        "--".into(),
                        "--exact".into(),
                    ],
                    cwd_role: "mission_worktree".into(),
                    required_result: "passed".into(),
                    freshness_policy: freshness,
                }],
                required_artifacts: vec![],
                risk_class: RiskClass::Low,
                capability_unlock: CapabilityUnlock {
                    unlock_id: UNLOCK_ID.into(),
                    capability: "a7.2.activate_visible_implementation".into(),
                    condition_clause_ids: vec![
                        CLAUSE_1_ID.into(),
                        CLAUSE_2_ID.into(),
                        CLAUSE_3_ID.into(),
                        CLAUSE_4_ID.into(),
                    ],
                    available_after_work_unit_id: WORK_ID.into(),
                },
            }],
            review_requirement: IndependentReviewRequirement {
                role: "independent_reviewer".into(),
                policy_id: "a7-core-reviewer-independence/v1".into(),
                must_differ_from_implementer_by: vec![
                    ReviewerDifference::PrincipalId,
                    ReviewerDifference::LogicalSessionId,
                    ReviewerDifference::ForkLineage,
                ],
                required_verdict: "accepted_exact_oid".into(),
            },
            merge_policy: MergePolicy {
                result: "merged_exact_oid".into(),
                target_branch_role: "isolated_mission_acceptance_target".into(),
                automatic_main_merge: false,
            },
            explicit_risks: vec!["TaskGraph ordering regression".into()],
        }
    }

    #[test]
    fn fixed_fixture_builds_deterministic_inert_preview() {
        let first = fixed_preview(fixed_input()).unwrap();
        let second = fixed_preview(fixed_input()).unwrap();
        assert_eq!(first.content_digest, second.content_digest);
        assert_eq!(first.status, MissionPlanStatus::Previewed);
        assert_eq!(first.owned_targets, ["src-tauri/src/task/graph.rs"]);
        assert_eq!(first.expected_tests.len(), 1);
        assert_eq!(first.mission_definition.acceptance.len(), 4);
        assert_eq!(first.expected_tests[0].required_result, "passed_exact_oid");
        assert!(
            first.expected_tests[0]
                .freshness_policy
                .require_same_head_oid
        );
        assert_eq!(
            first.review_requirement.required_verdict,
            "accepted_exact_oid"
        );
        assert_eq!(first.merge_policy.result, "merged_exact_oid");
        first.verify_integrity().unwrap();
    }

    #[test]
    fn unknown_fields_uuid_versions_paths_and_hidden_approval_fail_closed() {
        let mut value = serde_json::to_value(fixed_input()).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("hiddenAuthority".into(), Value::Bool(true));
        assert!(serde_json::from_value::<MissionPlanPreviewInput>(value).is_err());

        let mut bad = fixed_input();
        bad.request_id = Uuid::new_v4().to_string();
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.request_id = "0197c000-0000-7000-0000-000000000001".into();
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.mission_definition.created_by = ACTOR_ID.to_uppercase();
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.mission_definition.created_by = ACTOR_ID.replace('-', "");
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.work_units[0].file_intents[0]
            .resource_ref
            .repo_relative_path = "../escape".into();
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.mission_definition.approved_by = Some(ACTOR_ID.into());
        assert!(fixed_preview(bad).is_err());
        let mut bad = fixed_input();
        bad.mission_definition.created_at = "2026-02-30T25:00:00Z".into();
        assert!(fixed_preview(bad).is_err());
    }

    #[test]
    fn digest_tamper_and_unsafe_json_numbers_fail_closed() {
        let mut preview = fixed_preview(fixed_input()).unwrap();
        preview.owned_targets.push("src/hidden.rs".into());
        assert!(preview.verify_integrity().is_err());
        assert!(canonical_json_bytes(&serde_json::json!(9007199254740992_u64)).is_err());
        assert!(canonical_json_bytes(&serde_json::json!(1.5)).is_err());
    }

    #[test]
    fn frozen_fixture_rejects_runtime_gate_target_and_unlock_widening() {
        let mut bad = fixed_input();
        bad.mission_definition.runtime_policy.visible_pty_required = false;
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.mission_definition.risk_policy.policy_id = "caller-risk/v1".into();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.mission_definition.budget_policy.limits.clear();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.mission_definition
            .runtime_policy
            .allowed_runtime_domain_ids
            .push("headless".into());
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0]
            .required_adapter_capabilities
            .push(AdapterCapability::Steer);
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.mission_definition.team_policy.roles[0].capability_profile_ids =
            vec!["caller-broader-profile/v1".into()];
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].completion_authority_role_ids = vec!["implementer".into()];
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].file_intents[0]
            .resource_ref
            .repo_relative_path = "src-tauri/src/task/manager.rs".into();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].required_gates[0].command_argv[4] = "wrong::test".into();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].required_gates[0].contract_version = "caller-version".into();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].required_gates[0]
            .freshness_policy
            .require_same_head_oid = false;
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].required_gates[0]
            .freshness_policy
            .require_same_contract_version = false;
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].required_gates[0]
            .freshness_policy
            .require_same_environment_fingerprint = false;
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0].capability_unlock.capability = "spawn_now".into();
        assert!(fixed_preview(bad).is_err());

        let mut bad = fixed_input();
        bad.work_units[0]
            .capability_unlock
            .condition_clause_ids
            .pop();
        assert!(fixed_preview(bad).is_err());
    }

    fn typed_blocker(kind: SettlementBlockerKind) -> SettlementBlocker {
        let action = match kind {
            SettlementBlockerKind::Repo => SettlementNextActionKind::Reprove,
            SettlementBlockerKind::Policy => SettlementNextActionKind::ResolvePolicy,
            SettlementBlockerKind::Operator => SettlementNextActionKind::OperatorAction,
            SettlementBlockerKind::External => SettlementNextActionKind::ExternalAction,
        };
        SettlementBlocker {
            blocker_id: format!("{kind:?}-blocker"),
            kind,
            authority: "typed-authority".into(),
            code: "BLOCKED".into(),
            message: "exact acceptance blocker".into(),
            required_inputs: vec!["typed-input-ref".into()],
            command_argv: vec![],
            command_result: Some("blocked".into()),
            artifact_refs: vec!["artifact/ref".into()],
            next_action: SettlementNextAction {
                kind: action,
                owner: "typed-owner".into(),
                input_refs: vec!["typed-input-ref".into()],
            },
        }
    }

    fn blocked_packet_with(blocker: SettlementBlocker) -> BlockedWorkPacket {
        let mut packet = BlockedWorkPacket {
            schema: BLOCKED_WORK_PACKET_SCHEMA.into(),
            packet_id: "packet-blocked".into(),
            activation_id: "activation".into(),
            plan_id: "plan".into(),
            plan_revision: 1,
            mission_id: "mission".into(),
            mission_revision: 1,
            work_unit_id: "work".into(),
            plan_content_digest: "a".repeat(64),
            contract_proof_version: A7_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: "b".repeat(64),
            settlement_generation: 1,
            supersedes_packet_id: None,
            observed_git_fingerprint: "d".repeat(64),
            base_oid: "c".repeat(40),
            candidate_oid: None,
            tested_oid: None,
            reviewed_oid: None,
            integrated_oid: None,
            evidence_ids: vec![],
            review_id: None,
            merge_intent_id: None,
            acceptance_coverage: vec![],
            repo_blockers: vec![],
            policy_blockers: vec![],
            operator_blockers: vec![],
            external_blockers: vec![],
            completion_credit: 0,
            created_at_unix_ms: 1,
            packet_digest: String::new(),
        };
        match blocker.kind {
            SettlementBlockerKind::Repo => packet.repo_blockers.push(blocker),
            SettlementBlockerKind::Policy => packet.policy_blockers.push(blocker),
            SettlementBlockerKind::Operator => packet.operator_blockers.push(blocker),
            SettlementBlockerKind::External => packet.external_blockers.push(blocker),
        }
        packet
    }

    #[test]
    fn a7_4_blocked_packets_keep_all_blocker_categories_typed_and_zero_credit() {
        for kind in [
            SettlementBlockerKind::Repo,
            SettlementBlockerKind::Policy,
            SettlementBlockerKind::Operator,
            SettlementBlockerKind::External,
        ] {
            let packet = blocked_packet_with(typed_blocker(kind)).seal().unwrap();
            assert_eq!(packet.completion_credit, 0);
            packet.validate().unwrap();
        }
    }

    #[test]
    fn a7_4_rejects_tamper_wrong_bucket_and_raw_recovery_data() {
        let mut packet = blocked_packet_with(typed_blocker(SettlementBlockerKind::Policy))
            .seal()
            .unwrap();
        packet.completion_credit = 1;
        assert!(packet.validate().is_err());
        let mut wrong = typed_blocker(SettlementBlockerKind::External);
        wrong.next_action.kind = SettlementNextActionKind::OperatorAction;
        assert!(blocked_packet_with(wrong).seal().is_err());
        let mut raw = typed_blocker(SettlementBlockerKind::Operator);
        raw.next_action.input_refs = vec!["powershell\nRemove-Item -Recurse".into()];
        assert!(blocked_packet_with(raw).seal().is_err());
    }
}
