use crate::proofbook::agent_settlement;
use crate::proofbook::ledger::{
    self, ProofbookGateDecision, ProofbookResidualBlocker, ProofbookRunError, ProofbookRunLedger,
    ProofbookRunStatus, ProofbookStepOutcome, ProofbookStepStatus,
};
use crate::proofbook::{
    parse_proofbook, validate_definition, ProofbookAgentSessionCompletionProof,
    ProofbookAgentSessionExecutor, ProofbookAgentSessionSettlementContext,
    ProofbookArtifactPreview, ProofbookDefinition, ProofbookError, ProofbookErrorCode,
    ProofbookStep, ProofbookStepKind,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const PROOFBOOK_ARTIFACT_PREVIEW_MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy)]
enum CockpitStartContract<'a> {
    InputFree(&'a str),
    StringInputs(&'a str),
}

pub trait ProofbookMcpToolExecutor {
    fn execute_mcp_tool(
        &self,
        run_id: &str,
        ledger: &ProofbookRunLedger,
        step: &ProofbookStep,
        approved_gate: Option<&ProofbookGateDecision>,
    ) -> Result<ProofbookStepOutcome, ProofbookError>;
}

#[derive(Clone, Copy, Default)]
struct ProofbookExecutorRefs<'a> {
    mcp: Option<&'a dyn ProofbookMcpToolExecutor>,
    agent: Option<&'a dyn ProofbookAgentSessionExecutor>,
}

#[derive(Clone, Default)]
pub struct ProofbookRunner {
    runs: Arc<Mutex<BTreeMap<String, Arc<Mutex<ProofbookRunLedger>>>>>,
}

impl ProofbookRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_run(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_inner(
            project_path,
            proofbook_path,
            inputs,
            ProofbookExecutorRefs::default(),
            None,
            None,
        )
    }

    pub fn start_input_free_run(
        &self,
        project_path: &str,
        proofbook_path: &str,
        expected_definition_hash: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_inner(
            project_path,
            proofbook_path,
            serde_json::json!({}),
            ProofbookExecutorRefs::default(),
            Some(CockpitStartContract::InputFree(expected_definition_hash)),
            None,
        )
    }

    pub fn start_string_input_run(
        &self,
        project_path: &str,
        proofbook_path: &str,
        expected_definition_hash: &str,
        inputs: serde_json::Value,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_inner(
            project_path,
            proofbook_path,
            inputs,
            ProofbookExecutorRefs::default(),
            Some(CockpitStartContract::StringInputs(expected_definition_hash)),
            None,
        )
    }

    pub fn start_run_with_mcp_executor(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
        mcp_executor: &dyn ProofbookMcpToolExecutor,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_with_executors(
            project_path,
            proofbook_path,
            inputs,
            Some(mcp_executor),
            None,
        )
    }

    pub fn start_run_with_agent_executor(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
        agent_executor: &dyn ProofbookAgentSessionExecutor,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_with_executors(
            project_path,
            proofbook_path,
            inputs,
            None,
            Some(agent_executor),
        )
    }

    pub fn start_run_with_executors(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
        mcp_executor: Option<&dyn ProofbookMcpToolExecutor>,
        agent_executor: Option<&dyn ProofbookAgentSessionExecutor>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.start_run_inner(
            project_path,
            proofbook_path,
            inputs,
            ProofbookExecutorRefs {
                mcp: mcp_executor,
                agent: agent_executor,
            },
            None,
            None,
        )
    }

    pub fn start_run_with_executors_as_actor(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
        actor: &str,
        mcp_executor: Option<&dyn ProofbookMcpToolExecutor>,
        agent_executor: Option<&dyn ProofbookAgentSessionExecutor>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let actor = actor.trim();
        if actor.is_empty() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ValidationFailed,
                "Proofbook initiating actor must be non-empty",
            ));
        }
        self.start_run_inner(
            project_path,
            proofbook_path,
            inputs,
            ProofbookExecutorRefs {
                mcp: mcp_executor,
                agent: agent_executor,
            },
            None,
            Some(actor),
        )
    }

    fn start_run_inner(
        &self,
        project_path: &str,
        proofbook_path: &str,
        mut inputs: serde_json::Value,
        executors: ProofbookExecutorRefs<'_>,
        cockpit_start: Option<CockpitStartContract<'_>>,
        initiating_actor: Option<&str>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let proofbook_path = resolve_proofbook_path(&root, proofbook_path)?;
        let definition = parse_proofbook(&proofbook_path)?;
        let report = validate_definition(project_path, &definition, &proofbook_path);
        if !report.valid {
            return Err(validation_failed(report.errors));
        }
        if let Some(contract) = cockpit_start {
            let admission = &report.start_admission;
            let actual_definition_hash = admission.definition_hash.as_deref().ok_or_else(|| {
                ProofbookError::new(
                    ProofbookErrorCode::ValidationFailed,
                    "Proofbook definition hash is unavailable for cockpit start",
                )
            })?;
            let expected_definition_hash = match contract {
                CockpitStartContract::InputFree(hash)
                | CockpitStartContract::StringInputs(hash) => hash,
            };
            if actual_definition_hash != expected_definition_hash {
                return Err(ProofbookError::new(
                    ProofbookErrorCode::StaleDefinitionHash,
                    "Proofbook definition changed after validation; validate again before starting",
                ));
            }
            match contract {
                CockpitStartContract::InputFree(_) => {
                    let mut blockers = admission.blockers.clone();
                    if !definition.inputs.is_empty() {
                        blockers.push("runtime_inputs_declared".to_string());
                    }
                    if !blockers.is_empty() {
                        return Err(ProofbookError::new(
                            ProofbookErrorCode::ValidationFailed,
                            format!(
                                "Proofbook is not eligible for input-free cockpit start: {}",
                                blockers.join(", ")
                            ),
                        ));
                    }
                }
                CockpitStartContract::StringInputs(_) => {
                    if !admission.eligible {
                        return Err(ProofbookError::new(
                            ProofbookErrorCode::ValidationFailed,
                            format!(
                                "Proofbook is not eligible for string-input cockpit start: {}",
                                admission.blockers.join(", ")
                            ),
                        ));
                    }
                    inputs = normalize_string_inputs(&definition, inputs)?;
                }
            }
        }

        let candidate = match initiating_actor {
            Some(actor) => ledger::new_run_ledger_with_actor(
                &root,
                &proofbook_path,
                &definition,
                &inputs,
                Some(actor),
            )?,
            None => ledger::new_run_ledger(&root, &proofbook_path, &definition, &inputs)?,
        };
        let (mut ledger, initialized) = self.initialize_ledger(&root, candidate)?;
        if !initialized {
            return Ok(ledger);
        }
        self.drive_run(&root, &definition, &mut ledger, executors)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    pub fn status(
        &self,
        project_path: &str,
        run_id: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        self.load_run(&root, run_id)
    }

    pub fn settle_agent_session(
        &self,
        project_path: &str,
        run_id: &str,
        step_id: &str,
        proof: ProofbookAgentSessionCompletionProof,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.settle_agent_session_inner(project_path, run_id, step_id, None, None, proof)
    }

    pub fn agent_session_settlement_context(
        &self,
        project_path: &str,
        run_id: &str,
        step_id: &str,
        expected_revision: u64,
    ) -> Result<ProofbookAgentSessionSettlementContext, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let (_, _, _, _, context) = self.load_agent_session_settlement_state(
            &root,
            project_path,
            run_id,
            step_id,
            Some(expected_revision),
        )?;
        Ok(context)
    }

    pub fn settle_agent_session_if_current(
        &self,
        project_path: &str,
        run_id: &str,
        step_id: &str,
        expected_revision: u64,
        expected_session_id: &str,
        proof: ProofbookAgentSessionCompletionProof,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.settle_agent_session_inner(
            project_path,
            run_id,
            step_id,
            Some(expected_revision),
            Some(expected_session_id),
            proof,
        )
    }

    fn settle_agent_session_inner(
        &self,
        project_path: &str,
        run_id: &str,
        step_id: &str,
        expected_revision: Option<u64>,
        expected_session_id: Option<&str>,
        proof: ProofbookAgentSessionCompletionProof,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let (mut ledger, definition, step, summary, context) = self
            .load_agent_session_settlement_state(
                &root,
                project_path,
                run_id,
                step_id,
                expected_revision,
            )?;
        if expected_session_id.is_some_and(|expected| expected != context.session_id) {
            return Err(agent_session_completion_validation(
                step_id,
                "Proofbook agentSession runtime identity changed; refresh completion evidence",
            ));
        }

        let outcome = agent_session_completion_outcome(&root, &step, &summary, proof)?;
        let completed_status = outcome.status;
        let completed_error = outcome.error.clone();
        self.apply_step_outcome(&root, &mut ledger, &step, outcome)?;
        let (event_kind, event_message, event_status) = match completed_status {
            ProofbookStepStatus::Passed => (
                "agent_session_completed",
                "Proofbook agentSession completed with explicit proof",
                "passed",
            ),
            ProofbookStepStatus::Blocked => (
                "agent_session_blocked",
                "Proofbook agentSession reported a blocker",
                "blocked",
            ),
            _ => (
                "agent_session_failed",
                "Proofbook agentSession reported failure",
                "failed",
            ),
        };
        ledger.append_event(
            event_kind,
            Some(step_id.to_string()),
            event_message,
            Some(event_status.to_string()),
            completed_error,
        );
        self.commit_ledger(&root, &mut ledger)?;

        if completed_status == ProofbookStepStatus::Passed {
            self.drive_run(
                &root,
                &definition,
                &mut ledger,
                ProofbookExecutorRefs::default(),
            )?;
        }
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    fn load_agent_session_settlement_state(
        &self,
        root: &Path,
        project_path: &str,
        run_id: &str,
        step_id: &str,
        expected_revision: Option<u64>,
    ) -> Result<
        (
            ProofbookRunLedger,
            ProofbookDefinition,
            ProofbookStep,
            ledger::ProofbookStepSummary,
            ProofbookAgentSessionSettlementContext,
        ),
        ProofbookError,
    > {
        let ledger = self.load_run(root, run_id)?;
        if let Some(expected_revision) = expected_revision {
            if ledger.revision != expected_revision {
                return Err(stale_revision_error(
                    run_id,
                    expected_revision,
                    ledger.revision,
                ));
            }
        }
        let definition = parse_proofbook(&ledger.definition_path)?;
        let current_hash = ledger::hash_json(&definition)?;
        if current_hash != ledger.definition_hash {
            return Err(agent_session_completion_validation(
                step_id,
                "Proofbook definition changed after agentSession started; refresh run status and restart",
            ));
        }
        let report = validate_definition(project_path, &definition, &ledger.definition_path);
        if !report.valid {
            return Err(validation_failed(report.errors));
        }
        let step = definition
            .steps
            .iter()
            .find(|step| step.id == step_id)
            .cloned()
            .ok_or_else(|| {
                agent_session_completion_validation(
                    step_id,
                    format!("Proofbook agentSession step not found: {step_id}"),
                )
            })?;
        if ProofbookStepKind::from_wire(&step.kind) != Some(ProofbookStepKind::AgentSession) {
            return Err(agent_session_completion_validation(
                step_id,
                "Proofbook agentSession settlement requires an agentSession step",
            ));
        }
        let summary = ledger.step(step_id).cloned().ok_or_else(|| {
            agent_session_completion_validation(
                step_id,
                format!("Proofbook ledger step not found: {step_id}"),
            )
        })?;
        if summary.status != ProofbookStepStatus::Running {
            return Err(agent_session_completion_validation(
                step_id,
                "Proofbook agentSession settlement requires a running step",
            ));
        }
        let context = agent_settlement::context_from(root, &ledger, &summary)?;
        Ok((ledger, definition, step, summary, context))
    }
    pub fn list_runs(&self, project_path: &str) -> Result<Vec<ProofbookRunLedger>, ProofbookError> {
        self.restore_project(project_path)?;
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        ledger::list_ledgers(&root)
    }

    pub fn preview_artifact_if_current(
        &self,
        project_path: &str,
        run_id: &str,
        artifact_id: &str,
        expected_revision: u64,
    ) -> Result<ProofbookArtifactPreview, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let ledger = self.load_run(&root, run_id)?;
        if ledger.revision != expected_revision {
            return Err(stale_revision_error(
                run_id,
                expected_revision,
                ledger.revision,
            ));
        }

        let mut matches = ledger
            .artifacts
            .iter()
            .filter(|artifact| artifact.id == artifact_id);
        let artifact = matches.next().cloned().ok_or_else(|| {
            ProofbookError::new(
                ProofbookErrorCode::ArtifactNotFound,
                format!("Proofbook artifact not found in current ledger: {artifact_id}"),
            )
        })?;
        if matches.next().is_some() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ArtifactIntegrityMismatch,
                format!("Proofbook ledger contains duplicate artifact id: {artifact_id}"),
            ));
        }

        let path = runner_owned_artifact_path(&root, run_id, &artifact.path)?;
        if path.extension().and_then(|extension| extension.to_str()) != Some("txt") {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ArtifactNotPreviewable,
                "Proofbook cockpit preview supports runner-owned .txt artifacts only",
            )
            .with_path(ledger::normalize_path(&path)));
        }

        let metadata = fs::metadata(&path).map_err(|error| {
            ProofbookError::new(
                ProofbookErrorCode::ArtifactNotFound,
                format!("cannot read Proofbook artifact metadata: {error}"),
            )
            .with_path(ledger::normalize_path(&path))
        })?;
        if !metadata.is_file() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ArtifactNotPreviewable,
                "Proofbook artifact preview target is not a regular file",
            )
            .with_path(ledger::normalize_path(&path)));
        }
        if metadata.len() != artifact.size_bytes {
            return Err(artifact_integrity_error(
                &artifact.id,
                format!(
                    "recorded size {} does not match current size {}",
                    artifact.size_bytes,
                    metadata.len()
                ),
            ));
        }
        if metadata.len() > PROOFBOOK_ARTIFACT_PREVIEW_MAX_BYTES {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ArtifactNotPreviewable,
                format!(
                    "Proofbook artifact exceeds the {} byte cockpit preview limit",
                    PROOFBOOK_ARTIFACT_PREVIEW_MAX_BYTES
                ),
            )
            .with_path(ledger::normalize_path(&path)));
        }

        let bytes = fs::read(&path).map_err(|error| {
            ProofbookError::new(
                ProofbookErrorCode::ArtifactNotFound,
                format!("cannot read Proofbook artifact: {error}"),
            )
            .with_path(ledger::normalize_path(&path))
        })?;
        if bytes.len() as u64 != artifact.size_bytes {
            return Err(artifact_integrity_error(
                &artifact.id,
                "artifact size changed while reading",
            ));
        }
        let current_sha256 = format!("sha256:{}", ledger::hash_bytes(&bytes));
        if current_sha256 != artifact.sha256 {
            return Err(artifact_integrity_error(
                &artifact.id,
                format!(
                    "recorded hash {} does not match current hash {current_sha256}",
                    artifact.sha256
                ),
            ));
        }
        let content = String::from_utf8(bytes).map_err(|_| {
            ProofbookError::new(
                ProofbookErrorCode::ArtifactNotPreviewable,
                "Proofbook cockpit preview supports UTF-8 text only",
            )
            .with_path(ledger::normalize_path(&path))
        })?;

        Ok(ProofbookArtifactPreview {
            ledger_revision: ledger.revision,
            run_id: ledger.run_id,
            artifact_id: artifact.id,
            step_id: artifact.step_id,
            kind: artifact.kind,
            size_bytes: artifact.size_bytes,
            sha256: artifact.sha256,
            redaction_count: artifact.redaction_count,
            encoding: "utf-8".to_string(),
            content,
        })
    }

    pub fn cancel_run(
        &self,
        project_path: &str,
        run_id: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let ledger = self.load_run(&root, run_id)?;
        let expected_revision = ledger.revision;
        self.cancel_loaded_run(&root, ledger, expected_revision, None)
    }

    pub fn cancel_run_if_current(
        &self,
        project_path: &str,
        run_id: &str,
        expected_revision: u64,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let ledger = self.load_run(&root, run_id)?;
        self.cancel_loaded_run(&root, ledger, expected_revision, None)
    }

    pub fn cancel_run_if_current_as_actor(
        &self,
        project_path: &str,
        run_id: &str,
        expected_revision: u64,
        actor: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let actor = actor.trim();
        if actor.is_empty() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ValidationFailed,
                "Proofbook cancellation actor must be non-empty",
            ));
        }
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let ledger = self.load_run(&root, run_id)?;
        self.cancel_loaded_run(&root, ledger, expected_revision, Some(actor))
    }

    fn cancel_loaded_run(
        &self,
        root: &Path,
        mut ledger: ProofbookRunLedger,
        expected_revision: u64,
        actor: Option<&str>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        if ledger.revision != expected_revision {
            return Err(stale_revision_error(
                &ledger.run_id,
                expected_revision,
                ledger.revision,
            ));
        }
        if !matches!(
            ledger.status,
            ProofbookRunStatus::Pending
                | ProofbookRunStatus::Running
                | ProofbookRunStatus::WaitingGate
        ) {
            return Err(ProofbookError::new(
                ProofbookErrorCode::RunNotCancellable,
                format!(
                    "Proofbook run {} is terminal ({:?}) and cannot be cancelled",
                    ledger.run_id, ledger.status
                ),
            ));
        }
        ledger.status = ProofbookRunStatus::Cancelled;
        let completed_at = ledger::now_timestamp();
        for step in &mut ledger.steps {
            if matches!(
                step.status,
                ProofbookStepStatus::Pending
                    | ProofbookStepStatus::Running
                    | ProofbookStepStatus::WaitingGate
            ) {
                step.status = ProofbookStepStatus::Cancelled;
                step.completed_at = Some(completed_at.clone());
            }
        }
        let message = actor
            .map(|_| "Proofbook run cancelled by authenticated principal".to_string())
            .unwrap_or_else(|| "Proofbook run cancelled by operator".to_string());
        ledger.append_event_with_actor(
            "run_cancelled",
            None,
            message,
            Some("cancelled".to_string()),
            actor.map(str::to_string),
            None,
        );
        self.commit_ledger(root, &mut ledger)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resolve_manual_gate(
        &self,
        project_path: &str,
        run_id: &str,
        gate_id: String,
        gate_hash: String,
        decision: String,
        actor: Option<String>,
        comment: Option<String>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.resolve_gate_inner(
            project_path,
            run_id,
            gate_id,
            gate_hash,
            decision,
            actor,
            comment,
            None,
            Some("manualGate"),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resolve_gate_with_mcp_executor(
        &self,
        project_path: &str,
        run_id: &str,
        gate_id: String,
        gate_hash: String,
        decision: String,
        actor: Option<String>,
        comment: Option<String>,
        mcp_executor: &dyn ProofbookMcpToolExecutor,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        self.resolve_gate_inner(
            project_path,
            run_id,
            gate_id,
            gate_hash,
            decision,
            actor,
            comment,
            Some(mcp_executor),
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve_gate_inner(
        &self,
        project_path: &str,
        run_id: &str,
        gate_id: String,
        gate_hash: String,
        decision: String,
        actor: Option<String>,
        comment: Option<String>,
        mcp_executor: Option<&dyn ProofbookMcpToolExecutor>,
        expected_gate_kind: Option<&str>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let mut ledger = self.load_run(&root, run_id)?;
        let Some((step_id, gate_kind)) = waiting_gate_for(&ledger, &gate_id) else {
            return Err(ProofbookError::new(
                ProofbookErrorCode::RunNotFound,
                format!("no waiting Proofbook gate found for {gate_id}"),
            ));
        };
        if let Some(expected_gate_kind) = expected_gate_kind {
            if gate_kind != expected_gate_kind {
                return Err(ProofbookError::new(
                    ProofbookErrorCode::ValidationFailed,
                    format!(
                        "Proofbook gate {gate_id} is {gate_kind}, not {expected_gate_kind}; use its owning resolver"
                    ),
                )
                .with_step(step_id));
            }
        }
        let expected_hash = gate_hash_for(&ledger, &gate_id).unwrap_or_default();
        if expected_hash != gate_hash {
            return Err(ProofbookError::new(
                ProofbookErrorCode::StaleGateHash,
                "Proofbook gate hash mismatch; refresh run status and retry",
            )
            .with_step(step_id));
        }

        let normalized_decision = decision.trim().to_ascii_lowercase();
        let gate_decision = crate::proofbook::step_manual_gate::decision(
            gate_id,
            gate_hash,
            step_id.clone(),
            normalized_decision.clone(),
            actor,
            comment,
        );
        apply_gate_decision(
            &mut ledger,
            &step_id,
            gate_kind.as_str(),
            gate_decision.clone(),
            &normalized_decision,
        );
        ledger.status = if normalized_decision == "approve" || normalized_decision == "approved" {
            ProofbookRunStatus::Running
        } else {
            ProofbookRunStatus::Failed
        };
        self.commit_ledger(&root, &mut ledger)?;

        if ledger.status == ProofbookRunStatus::Running {
            let definition = parse_proofbook(&ledger.definition_path)?;
            let current_hash = ledger::hash_json(&definition)?;
            if current_hash != ledger.definition_hash {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "definition_changed_after_gate".to_string(),
                    step_id: Some(step_id),
                    message: "Proofbook definition changed after the gate was issued.".to_string(),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    "Proofbook definition changed after manual gate approval",
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new(
                        "definition_changed_after_gate",
                        "refresh and restart the Proofbook run before continuing",
                    )),
                );
                self.commit_ledger(&root, &mut ledger)?;
            } else {
                let report =
                    validate_definition(project_path, &definition, &ledger.definition_path);
                if !report.valid {
                    let error = validation_failed(report.errors);
                    ledger.status = ProofbookRunStatus::Failed;
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: "validation_failed_after_gate".to_string(),
                        step_id: None,
                        message: error.message.clone(),
                    });
                    ledger.append_event(
                        "run_failed",
                        None,
                        "Proofbook validation failed after manual gate approval",
                        Some("failed".to_string()),
                        Some(ProofbookRunError::new(
                            "validation_failed_after_gate",
                            error.message,
                        )),
                    );
                    self.commit_ledger(&root, &mut ledger)?;
                } else {
                    if gate_kind == "mcpTool" {
                        let executor = mcp_executor.ok_or_else(|| {
                            ProofbookError::runtime_not_available(
                                "resolving Proofbook MCP tool gates requires the MCP runtime",
                            )
                        })?;
                        let step = definition
                            .steps
                            .iter()
                            .find(|step| step.id == step_id)
                            .ok_or_else(|| {
                                ProofbookError::new(
                                    ProofbookErrorCode::ValidationFailed,
                                    format!("Proofbook gate step disappeared: {step_id}"),
                                )
                            })?;
                        if let Some(summary) = ledger.step_mut(&step_id) {
                            summary.status = ProofbookStepStatus::Running;
                            summary.started_at.get_or_insert_with(ledger::now_timestamp);
                        }
                        self.commit_ledger(&root, &mut ledger)?;
                        let outcome = executor.execute_mcp_tool(
                            &ledger.run_id,
                            &ledger,
                            step,
                            Some(&gate_decision),
                        )?;
                        self.apply_step_outcome(&root, &mut ledger, step, outcome)?;
                    }
                    self.drive_run(
                        &root,
                        &definition,
                        &mut ledger,
                        ProofbookExecutorRefs {
                            mcp: mcp_executor,
                            agent: None,
                        },
                    )?;
                }
            }
        }
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    pub fn restore_project(&self, project_path: &str) -> Result<usize, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let mut restored = 0;
        for mut ledger in ledger::list_ledgers(&root)? {
            let already_registered = self
                .runs
                .lock()
                .map_err(|_| runner_lock_error())?
                .contains_key(&ledger.run_id);
            if !already_registered {
                restored += 1;
            }
            self.remember(ledger.clone())?;
            let mut changed = false;
            if ledger.status == ProofbookRunStatus::Running {
                for step in &mut ledger.steps {
                    if step.status == ProofbookStepStatus::Running {
                        step.status = ProofbookStepStatus::Blocked;
                        step.completed_at = Some(ledger::now_timestamp());
                        step.error = Some(if step.kind == "agentSession" {
                            crate::proofbook::agent_step::interrupted_agent_session_error()
                        } else {
                            ProofbookRunError::new(
                                "interrupted_by_restart",
                                "running step was interrupted by process restart",
                            )
                        });
                        changed = true;
                    }
                }
                if changed {
                    let interrupted_code = if ledger.steps.iter().any(|step| {
                        step.error.as_ref().is_some_and(|error| {
                            error.code == "agent_session_interrupted_by_restart"
                        })
                    }) {
                        "agent_session_interrupted_by_restart"
                    } else {
                        "interrupted_by_restart"
                    };
                    ledger.status = ProofbookRunStatus::Failed;
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: interrupted_code.to_string(),
                        step_id: None,
                        message: "A running Proofbook step was found during hydration.".to_string(),
                    });
                    ledger.append_event(
                        "run_hydrated_fail_closed",
                        None,
                        format!("Converted dead running steps to {interrupted_code}"),
                        Some("failed".to_string()),
                        Some(ProofbookRunError::new(
                            interrupted_code,
                            "running steps cannot be resumed blindly",
                        )),
                    );
                    self.commit_ledger(&root, &mut ledger)?;
                }
            }
        }
        Ok(restored)
    }

    fn drive_run(
        &self,
        root: &Path,
        definition: &ProofbookDefinition,
        ledger: &mut ProofbookRunLedger,
        executors: ProofbookExecutorRefs<'_>,
    ) -> Result<(), ProofbookError> {
        if matches!(
            ledger.status,
            ProofbookRunStatus::Cancelled | ProofbookRunStatus::Failed
        ) {
            return Ok(());
        }
        ledger.status = ProofbookRunStatus::Running;
        ledger.append_event(
            "run_started",
            None,
            "Proofbook runner started deterministic queue",
            Some("running".to_string()),
            None,
        );
        self.commit_ledger(root, ledger)?;

        loop {
            let mut progressed = false;
            for step in &definition.steps {
                if ledger.step(&step.id).map(|s| s.status) != Some(ProofbookStepStatus::Pending) {
                    continue;
                }
                if !dependencies_passed(ledger, step) {
                    continue;
                }
                progressed = true;
                self.mark_step_running(root, ledger, step)?;
                let outcome = self.execute_step(root, ledger, step, executors)?;
                self.apply_step_outcome(root, ledger, step, outcome)?;
                match ledger.step(&step.id).map(|s| s.status) {
                    Some(ProofbookStepStatus::WaitingGate | ProofbookStepStatus::Running) => {
                        return Ok(());
                    }
                    Some(ProofbookStepStatus::Failed | ProofbookStepStatus::Blocked) => {
                        return Ok(());
                    }
                    _ => {}
                }
            }
            if !progressed {
                break;
            }
        }

        self.settle_run(root, definition, ledger)?;
        Ok(())
    }

    fn mark_step_running(
        &self,
        root: &Path,
        ledger: &mut ProofbookRunLedger,
        step: &ProofbookStep,
    ) -> Result<(), ProofbookError> {
        let now = ledger::now_timestamp();
        if let Some(summary) = ledger.step_mut(&step.id) {
            summary.status = ProofbookStepStatus::Running;
            summary.started_at.get_or_insert_with(|| now.clone());
            summary.attempt = summary.attempt.saturating_add(1);
        }
        ledger.append_event(
            "step_started",
            Some(step.id.clone()),
            format!("Proofbook step {} started", step.id),
            Some("running".to_string()),
            None,
        );
        self.commit_ledger(root, ledger)
    }

    fn execute_step(
        &self,
        root: &Path,
        ledger: &ProofbookRunLedger,
        step: &ProofbookStep,
        executors: ProofbookExecutorRefs<'_>,
    ) -> Result<ProofbookStepOutcome, ProofbookError> {
        match ProofbookStepKind::from_wire(&step.kind) {
            Some(ProofbookStepKind::Shell) => {
                crate::proofbook::step_shell::execute_shell_step(root, &ledger.run_id, step, false)
            }
            Some(ProofbookStepKind::Verifier) => {
                crate::proofbook::step_shell::execute_shell_step(root, &ledger.run_id, step, true)
            }
            Some(ProofbookStepKind::WaitFor) => {
                crate::proofbook::step_wait::execute_wait_for_step(root, step)
            }
            Some(ProofbookStepKind::ManualGate) => Ok(
                crate::proofbook::step_manual_gate::wait_for_manual_gate(&ledger.run_id, step),
            ),
            Some(ProofbookStepKind::McpTool) => match executors.mcp {
                Some(executor) => executor.execute_mcp_tool(&ledger.run_id, ledger, step, None),
                None => Ok(ProofbookStepOutcome::blocked(
                    "not_implemented",
                    "Proofbook mcpTool steps require the PB-3 MCP runtime",
                )),
            },
            Some(ProofbookStepKind::AgentSession) => {
                crate::proofbook::agent_step::execute_agent_session_step(
                    root,
                    ledger,
                    step,
                    executors.agent,
                )
            }
            Some(kind) => Ok(ProofbookStepOutcome::blocked(
                "not_implemented",
                format!("Proofbook step kind {kind:?} is not executable in PB-2"),
            )),
            None => Ok(ProofbookStepOutcome::failed(
                "unknown_step_type",
                format!("unknown proofbook step type: {}", step.kind),
            )),
        }
    }

    fn apply_step_outcome(
        &self,
        root: &Path,
        ledger: &mut ProofbookRunLedger,
        step: &ProofbookStep,
        outcome: ProofbookStepOutcome,
    ) -> Result<(), ProofbookError> {
        let completed_at = ledger::now_timestamp();
        let status = outcome.status;
        let error = outcome.error.clone();
        let artifact_refs = outcome.artifact_refs.clone();
        if let Some(summary) = ledger.step_mut(&step.id) {
            summary.status = status;
            summary.completed_at = if matches!(
                status,
                ProofbookStepStatus::WaitingGate | ProofbookStepStatus::Running
            ) {
                None
            } else {
                Some(completed_at.clone())
            };
            summary.duration_ms = summary
                .completed_at
                .as_ref()
                .and_then(|completed_at| ledger::duration_ms(&summary.started_at, completed_at));
            summary.stdout_ref = outcome.stdout_ref;
            summary.stderr_ref = outcome.stderr_ref;
            summary.exit_code = outcome.exit_code;
            summary.structured_output = outcome.structured_output;
            summary.artifact_refs = artifact_refs;
            summary.redaction_count = outcome.redaction_count;
            summary.risk = outcome.risk;
            summary.error = error.clone();
        }
        ledger.artifacts.extend(outcome.artifacts);

        match status {
            ProofbookStepStatus::Passed => {
                ledger.append_event(
                    "step_passed",
                    Some(step.id.clone()),
                    format!("Proofbook step {} passed", step.id),
                    Some("passed".to_string()),
                    None,
                );
            }
            ProofbookStepStatus::WaitingGate => {
                ledger.status = ProofbookRunStatus::WaitingGate;
                ledger.append_event(
                    "step_waiting_gate",
                    Some(step.id.clone()),
                    format!("Proofbook step {} is waiting for a gate", step.id),
                    Some("waiting_gate".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Running => {
                ledger.status = ProofbookRunStatus::Running;
                ledger.append_event(
                    "step_running",
                    Some(step.id.clone()),
                    format!("Proofbook step {} is running", step.id),
                    Some("running".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Blocked => {
                ledger.status = if error
                    .as_ref()
                    .is_some_and(|e| e.code == "blocked_by_policy")
                {
                    ProofbookRunStatus::BlockedByPolicy
                } else {
                    ProofbookRunStatus::Failed
                };
                if let Some(error) = error.clone() {
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: error.code.clone(),
                        step_id: Some(step.id.clone()),
                        message: error.message.clone(),
                    });
                }
                ledger.append_event(
                    "step_blocked",
                    Some(step.id.clone()),
                    format!("Proofbook step {} blocked", step.id),
                    Some("blocked".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Failed => {
                ledger.status = ProofbookRunStatus::Failed;
                if let Some(error) = error.clone() {
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: error.code.clone(),
                        step_id: Some(step.id.clone()),
                        message: error.message.clone(),
                    });
                }
                ledger.append_event(
                    "step_failed",
                    Some(step.id.clone()),
                    format!("Proofbook step {} failed", step.id),
                    Some("failed".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Cancelled
            | ProofbookStepStatus::Skipped
            | ProofbookStepStatus::Pending => {}
        }
        self.commit_ledger(root, ledger)
    }

    fn settle_run(
        &self,
        root: &Path,
        definition: &ProofbookDefinition,
        ledger: &mut ProofbookRunLedger,
    ) -> Result<(), ProofbookError> {
        let Some(settlement) = definition.settlement.as_ref() else {
            ledger.status = ProofbookRunStatus::Failed;
            return self.commit_ledger(root, ledger);
        };
        for required in &settlement.required_steps {
            if ledger.step(required).map(|s| s.status) != Some(ProofbookStepStatus::Passed) {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "required_step_not_passed".to_string(),
                    step_id: Some(required.clone()),
                    message: format!("required step did not pass: {required}"),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    format!("required step did not pass: {required}"),
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new("required_step_not_passed", required)),
                );
                self.commit_ledger(root, ledger)?;
                return Ok(());
            }
        }
        for artifact in &settlement.required_artifacts {
            let path = crate::proofbook::step_shell::resolve_under_root(root, artifact)?;
            if !path.exists() {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "missing_required_artifact".to_string(),
                    step_id: None,
                    message: format!("required artifact does not exist: {artifact}"),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    format!("required artifact does not exist: {artifact}"),
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new(
                        "missing_required_artifact",
                        artifact,
                    )),
                );
                self.commit_ledger(root, ledger)?;
                return Ok(());
            }
        }
        ledger.status = ProofbookRunStatus::Passed;
        ledger.append_event(
            "run_passed",
            None,
            "Proofbook settlement passed",
            Some("passed".to_string()),
            None,
        );
        self.commit_ledger(root, ledger)
    }

    fn remember(&self, ledger: ProofbookRunLedger) -> Result<(), ProofbookError> {
        let mut runs = self.runs.lock().map_err(|_| runner_lock_error())?;
        match runs.get(&ledger.run_id) {
            Some(slot) => {
                let mut current = slot
                    .lock()
                    .map_err(|_| run_slot_lock_error(&ledger.run_id))?;
                if ledger.revision > current.revision {
                    *current = ledger;
                }
            }
            None => {
                runs.insert(ledger.run_id.clone(), Arc::new(Mutex::new(ledger)));
            }
        }
        Ok(())
    }

    fn initialize_ledger(
        &self,
        root: &Path,
        candidate: ProofbookRunLedger,
    ) -> Result<(ProofbookRunLedger, bool), ProofbookError> {
        let path = ledger::ledger_path(root, &candidate.run_id);
        if path.exists() {
            let existing = ledger::read_ledger(&path)?;
            self.remember(existing.clone())?;
            return Ok((existing, false));
        }

        let slot = {
            let mut runs = self.runs.lock().map_err(|_| runner_lock_error())?;
            if let Some(slot) = runs.get(&candidate.run_id).cloned() {
                slot
            } else {
                let slot = Arc::new(Mutex::new(candidate.clone()));
                runs.insert(candidate.run_id.clone(), slot.clone());
                drop(runs);

                // Another daemon/process may have durably initialized the same
                // deterministic run after our first existence check. Adopt it rather
                // than overwriting its newer state.
                if path.exists() {
                    let existing = ledger::read_ledger(&path)?;
                    *slot
                        .lock()
                        .map_err(|_| run_slot_lock_error(&candidate.run_id))? = existing.clone();
                    return Ok((existing, false));
                }
                if let Err(error) = ledger::write_ledger(root, &candidate) {
                    self.runs
                        .lock()
                        .map_err(|_| runner_lock_error())?
                        .remove(&candidate.run_id);
                    return Err(error);
                }
                return Ok((candidate, true));
            }
        };
        let existing = slot
            .lock()
            .map_err(|_| run_slot_lock_error(&candidate.run_id))?
            .clone();
        Ok((existing, false))
    }

    /// Commit one ledger mutation iff the caller still owns the current revision.
    ///
    /// The global run map is held only long enough to clone the per-run slot. File
    /// validation and durable replacement happen under that run's lock, so unrelated
    /// Proofbooks remain concurrent while stale cancel/gate/worker snapshots fail closed.
    fn commit_ledger(
        &self,
        root: &Path,
        ledger: &mut ProofbookRunLedger,
    ) -> Result<(), ProofbookError> {
        let slot = self
            .runs
            .lock()
            .map_err(|_| runner_lock_error())?
            .get(&ledger.run_id)
            .cloned()
            .ok_or_else(|| {
                ProofbookError::new(
                    ProofbookErrorCode::RunNotFound,
                    format!("Proofbook run not registered: {}", ledger.run_id),
                )
            })?;
        let mut current = slot
            .lock()
            .map_err(|_| run_slot_lock_error(&ledger.run_id))?;
        if current.revision != ledger.revision {
            return Err(stale_revision_error(
                &ledger.run_id,
                ledger.revision,
                current.revision,
            ));
        }

        let path = ledger::ledger_path(root, &ledger.run_id);
        if path.exists() {
            let durable = ledger::read_ledger(&path)?;
            if durable.revision != ledger.revision {
                return Err(stale_revision_error(
                    &ledger.run_id,
                    ledger.revision,
                    durable.revision,
                ));
            }
        }

        let mut committed = ledger.clone();
        committed.revision = committed.revision.checked_add(1).ok_or_else(|| {
            ProofbookError::new(
                ProofbookErrorCode::StaleLedgerRevision,
                format!("Proofbook ledger revision exhausted: {}", ledger.run_id),
            )
        })?;
        ledger::write_ledger(root, &committed)?;
        *current = committed.clone();
        *ledger = committed;
        Ok(())
    }

    fn load_run(&self, root: &Path, run_id: &str) -> Result<ProofbookRunLedger, ProofbookError> {
        if let Some(slot) = self
            .runs
            .lock()
            .map_err(|_| runner_lock_error())?
            .get(run_id)
            .cloned()
        {
            return slot
                .lock()
                .map_err(|_| run_slot_lock_error(run_id))
                .map(|ledger| ledger.clone());
        }
        let path = ledger::ledger_path(root, run_id);
        if !path.exists() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::RunNotFound,
                format!("Proofbook run not found: {run_id}"),
            ));
        }
        let ledger = ledger::read_ledger(&path)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }
}

fn runner_lock_error() -> ProofbookError {
    ProofbookError::new(
        ProofbookErrorCode::IoError,
        "proofbook runner lock poisoned",
    )
}

fn run_slot_lock_error(run_id: &str) -> ProofbookError {
    ProofbookError::new(
        ProofbookErrorCode::IoError,
        format!("proofbook run lock poisoned: {run_id}"),
    )
}

fn stale_revision_error(run_id: &str, expected: u64, actual: u64) -> ProofbookError {
    ProofbookError::new(
        ProofbookErrorCode::StaleLedgerRevision,
        format!(
            "Proofbook ledger revision conflict for {run_id}: expected {expected}, current {actual}; refresh run status and retry"
        ),
    )
}

fn runner_owned_artifact_path(
    project_root: &Path,
    run_id: &str,
    recorded_path: &str,
) -> Result<PathBuf, ProofbookError> {
    let relative = Path::new(recorded_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ProofbookError::new(
            ProofbookErrorCode::ArtifactNotPreviewable,
            "Proofbook artifact path is not a contained relative path",
        )
        .with_path(recorded_path));
    }

    let artifact_root = ledger::artifacts_dir(project_root, run_id);
    let canonical_artifact_root = fs::canonicalize(&artifact_root).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::ArtifactNotPreviewable,
            format!("runner-owned Proofbook artifact root is unavailable: {error}"),
        )
        .with_path(ledger::normalize_path(&artifact_root))
    })?;
    if !canonical_artifact_root.starts_with(project_root) {
        return Err(ProofbookError::new(
            ProofbookErrorCode::ArtifactNotPreviewable,
            "runner-owned Proofbook artifact root escapes the project",
        )
        .with_path(ledger::normalize_path(&artifact_root)));
    }

    let candidate = project_root.join(relative);
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::ArtifactNotFound,
            format!("Proofbook artifact is unavailable: {error}"),
        )
        .with_path(recorded_path)
    })?;
    if !canonical_candidate.starts_with(&canonical_artifact_root) {
        return Err(ProofbookError::new(
            ProofbookErrorCode::ArtifactNotPreviewable,
            "Proofbook artifact is not contained under the current run's runner-owned artifact root",
        )
        .with_path(recorded_path));
    }
    Ok(canonical_candidate)
}

fn artifact_integrity_error(artifact_id: &str, detail: impl Into<String>) -> ProofbookError {
    ProofbookError::new(
        ProofbookErrorCode::ArtifactIntegrityMismatch,
        format!(
            "Proofbook artifact integrity mismatch for {artifact_id}: {}",
            detail.into()
        ),
    )
}

fn agent_session_completion_outcome(
    root: &Path,
    step: &ProofbookStep,
    summary: &ledger::ProofbookStepSummary,
    proof: ProofbookAgentSessionCompletionProof,
) -> Result<ProofbookStepOutcome, ProofbookError> {
    let status_key = compact_key(&proof.status);
    let proof_kind = trim_optional(&proof.proof_kind).unwrap_or_else(|| "unspecified".to_string());
    let proof_kind_key = compact_key(&proof_kind);
    let done_signal = trim_optional(proof.done_signal.as_deref().unwrap_or_default());
    let final_report_path = trim_optional(proof.final_report_path.as_deref().unwrap_or_default());
    let reviewer_batch_id = trim_optional(proof.reviewer_batch_id.as_deref().unwrap_or_default());
    let summary_text = trim_optional(proof.summary.as_deref().unwrap_or_default());

    match status_key.as_str() {
        "passed" | "pass" | "done" | "completed" => agent_session_passed_outcome(
            root,
            step,
            summary,
            &proof,
            proof_kind,
            proof_kind_key,
            done_signal,
            final_report_path,
            reviewer_batch_id,
            summary_text,
        ),
        "failed" | "fail" | "error" | "timeout" | "timedout" => Ok(agent_session_error_outcome(
            summary,
            "failed",
            &proof_kind,
            proof.blocker_code.as_deref(),
            proof.blocker_message.as_deref(),
            summary_text.as_deref(),
            if status_key.starts_with("timeout") {
                "agent_session_timeout"
            } else {
                "agent_session_reported_failure"
            },
            "agentSession reported failure",
            ProofbookStepStatus::Failed,
        )),
        "blocked" | "blocker" => Ok(agent_session_error_outcome(
            summary,
            "blocked",
            &proof_kind,
            proof.blocker_code.as_deref(),
            proof.blocker_message.as_deref(),
            summary_text.as_deref(),
            "agent_session_reported_blocker",
            "agentSession reported a blocker",
            ProofbookStepStatus::Blocked,
        )),
        "cancelled" | "canceled" => Err(agent_session_completion_validation(
            &step.id,
            "agentSession cancellation uses cancel_proofbook_run or aelyris.proofbook.cancel",
        )),
        _ => Err(agent_session_completion_validation(
            &step.id,
            "agentSession completion proof status must be passed, failed, blocked, timeout, or cancelled",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn agent_session_passed_outcome(
    root: &Path,
    step: &ProofbookStep,
    summary: &ledger::ProofbookStepSummary,
    proof: &ProofbookAgentSessionCompletionProof,
    proof_kind: String,
    proof_kind_key: String,
    done_signal: Option<String>,
    final_report_path: Option<String>,
    reviewer_batch_id: Option<String>,
    summary_text: Option<String>,
) -> Result<ProofbookStepOutcome, ProofbookError> {
    let mut artifacts = Vec::new();
    let mut artifact_refs = Vec::new();
    let mut artifact_paths = Vec::new();
    let mut proof_sources = Vec::new();
    let mut final_report_refs = Vec::new();

    if let Some(signal) = done_signal.as_ref() {
        if !signal.is_empty() {
            proof_sources.push("explicitDoneSignal".to_string());
        }
    } else if proof_kind_key == "explicitdonesignal" {
        return Err(agent_session_completion_validation(
            &step.id,
            "explicitDoneSignal proof requires doneSignal",
        ));
    }

    if let Some(path) = final_report_path.as_ref() {
        let artifact =
            record_agent_session_completion_artifact(root, &step.id, "finalReport", path)?;
        final_report_refs.push(artifact.id.clone());
        artifact_refs.push(artifact.id.clone());
        artifact_paths.push(artifact.path.clone());
        artifacts.push(artifact);
        proof_sources.push("finalReport".to_string());
    } else if proof_kind_key == "finalreport" {
        return Err(agent_session_completion_validation(
            &step.id,
            "finalReport proof requires finalReportPath",
        ));
    }

    let mut recorded_required_artifacts = false;
    if proof_kind_key == "requiredartifactsettlement" {
        let mut settlement_paths = agent_settlement::expected_artifacts(summary);
        if settlement_paths.is_empty() {
            settlement_paths = trimmed_vec(&proof.artifact_paths);
        }
        if settlement_paths.is_empty() {
            return Err(agent_session_completion_validation(
                &step.id,
                "requiredArtifactSettlement proof requires expectedArtifacts or artifactPaths",
            ));
        }
        for path in settlement_paths {
            let artifact = record_agent_session_completion_artifact(
                root,
                &step.id,
                "expectedArtifact",
                &path,
            )?;
            artifact_refs.push(artifact.id.clone());
            artifact_paths.push(artifact.path.clone());
            artifacts.push(artifact);
        }
        recorded_required_artifacts = true;
        proof_sources.push("requiredArtifactSettlement".to_string());
    }

    if let Some(batch_id) = reviewer_batch_id.as_ref() {
        if !batch_id.is_empty() {
            proof_sources.push("reviewerBatch".to_string());
        }
    } else if proof_kind_key == "reviewerbatch" || proof_kind_key == "reviewerbatchproof" {
        return Err(agent_session_completion_validation(
            &step.id,
            "reviewerBatch proof requires reviewerBatchId",
        ));
    }

    if proof_sources.is_empty() {
        return Err(agent_session_completion_validation(
            &step.id,
            "agent_session_completion_proof_missing: completion requires explicit done signal, final report, required artifact settlement, or reviewer-batch proof",
        ));
    }

    if !recorded_required_artifacts {
        for path in trimmed_vec(&proof.artifact_paths) {
            let artifact = record_agent_session_completion_artifact(
                root,
                &step.id,
                "agentCompletionEvidence",
                &path,
            )?;
            artifact_refs.push(artifact.id.clone());
            artifact_paths.push(artifact.path.clone());
            artifacts.push(artifact);
        }
    }

    let output = agent_session_completion_output(
        summary,
        "passed",
        &proof_kind,
        proof_sources,
        done_signal,
        final_report_path,
        reviewer_batch_id,
        None,
        summary_text,
        &artifact_refs,
        &artifact_paths,
        &final_report_refs,
    );
    Ok(ProofbookStepOutcome {
        status: ProofbookStepStatus::Passed,
        structured_output: Some(output),
        artifact_refs,
        artifacts,
        ..ProofbookStepOutcome::passed()
    })
}

#[allow(clippy::too_many_arguments)]
fn agent_session_error_outcome(
    summary: &ledger::ProofbookStepSummary,
    status_label: &str,
    proof_kind: &str,
    blocker_code: Option<&str>,
    blocker_message: Option<&str>,
    summary_text: Option<&str>,
    default_code: &str,
    default_message: &str,
    step_status: ProofbookStepStatus,
) -> ProofbookStepOutcome {
    let code =
        trim_optional(blocker_code.unwrap_or_default()).unwrap_or_else(|| default_code.to_string());
    let message = trim_optional(blocker_message.unwrap_or_default())
        .or_else(|| summary_text.and_then(trim_optional))
        .unwrap_or_else(|| default_message.to_string());
    let blocker = json!({ "code": code, "message": message });
    let output = agent_session_completion_output(
        summary,
        status_label,
        proof_kind,
        Vec::new(),
        None,
        None,
        None,
        Some(blocker),
        summary_text.map(str::to_string),
        &[],
        &[],
        &[],
    );
    ProofbookStepOutcome {
        status: step_status,
        structured_output: Some(output),
        error: Some(ProofbookRunError::new(code, message)),
        ..ProofbookStepOutcome::passed()
    }
}

#[allow(clippy::too_many_arguments)]
fn agent_session_completion_output(
    summary: &ledger::ProofbookStepSummary,
    status: &str,
    proof_kind: &str,
    proof_sources: Vec<String>,
    done_signal: Option<String>,
    final_report_path: Option<String>,
    reviewer_batch_id: Option<String>,
    blocker: Option<Value>,
    summary_text: Option<String>,
    artifact_refs: &[String],
    artifact_paths: &[String],
    final_report_refs: &[String],
) -> Value {
    let mut output = summary
        .structured_output
        .clone()
        .unwrap_or_else(|| json!({ "kind": "agentSession" }));
    if !output.is_object() {
        output = json!({ "kind": "agentSession", "previousOutput": output });
    }
    let completion = json!({
        "status": status,
        "proofKind": proof_kind,
        "proofSources": proof_sources,
        "doneSignal": done_signal,
        "finalReportPath": final_report_path,
        "reviewerBatchId": reviewer_batch_id,
        "blocker": blocker,
        "summary": summary_text,
        "artifactRefs": artifact_refs,
        "artifactPaths": artifact_paths,
        "settledAt": ledger::now_timestamp()
    });
    if let Some(map) = output.as_object_mut() {
        map.insert("completion".to_string(), completion);
        if !final_report_refs.is_empty() {
            let lifecycle = map
                .entry("lifecycleArtifacts".to_string())
                .or_insert_with(|| json!({}));
            if let Some(lifecycle) = lifecycle.as_object_mut() {
                lifecycle.insert("finalReport".to_string(), json!(final_report_refs));
            }
        }
    }
    output
}

fn record_agent_session_completion_artifact(
    root: &Path,
    step_id: &str,
    kind: &str,
    raw_path: &str,
) -> Result<ledger::ProofbookArtifactRef, ProofbookError> {
    let path = crate::proofbook::step_shell::resolve_under_root(root, raw_path)?;
    if !path.exists() {
        return Err(agent_session_completion_validation(
            step_id,
            format!("agentSession completion artifact does not exist: {raw_path}"),
        ));
    }
    ledger::record_existing_artifact(root, step_id, kind, &path)
}

fn trimmed_vec(values: &[String]) -> Vec<String> {
    values
        .iter()
        .filter_map(|value| trim_optional(value))
        .collect()
}

fn trim_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn compact_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(*ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_ascii_lowercase()
}

fn agent_session_completion_validation(
    step_id: &str,
    message: impl Into<String>,
) -> ProofbookError {
    ProofbookError::new(ProofbookErrorCode::ValidationFailed, message).with_step(step_id)
}
fn resolve_proofbook_path(root: &Path, raw_path: &str) -> Result<String, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let path = crate::proofbook::validator::ensure_path_under_root(
        root,
        &candidate.to_string_lossy(),
        "proofbookPath",
    )?;
    Ok(ledger::normalize_path(path))
}

fn validation_failed(errors: Vec<ProofbookError>) -> ProofbookError {
    let message = errors
        .first()
        .map(|error| format!("proofbook validation failed: {}", error.message))
        .unwrap_or_else(|| "proofbook validation failed".to_string());
    ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
}

fn normalize_string_inputs(
    definition: &ProofbookDefinition,
    submitted: serde_json::Value,
) -> Result<serde_json::Value, ProofbookError> {
    let mut submitted = submitted.as_object().cloned().ok_or_else(|| {
        ProofbookError::new(
            ProofbookErrorCode::ValidationFailed,
            "Proofbook cockpit inputs must be an object of declared string values",
        )
        .with_definition(definition.id.clone())
        .with_field("inputs")
    })?;

    for key in submitted.keys() {
        if !definition.inputs.contains_key(key) {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ValidationFailed,
                format!("unknown Proofbook input: {key}"),
            )
            .with_definition(definition.id.clone())
            .with_field(format!("inputs.{key}")));
        }
    }

    let mut normalized = BTreeMap::<String, serde_json::Value>::new();
    for (key, spec) in &definition.inputs {
        if spec.input_type != "string" {
            return Err(ProofbookError::new(
                ProofbookErrorCode::ValidationFailed,
                format!(
                    "unsupported Proofbook input type for {key}: {}",
                    spec.input_type
                ),
            )
            .with_definition(definition.id.clone())
            .with_field(format!("inputs.{key}.type")));
        }

        if let Some(value) = submitted.remove(key) {
            let value = value.as_str().ok_or_else(|| {
                ProofbookError::new(
                    ProofbookErrorCode::ValidationFailed,
                    format!("Proofbook input {key} must be a string"),
                )
                .with_definition(definition.id.clone())
                .with_field(format!("inputs.{key}"))
            })?;
            normalized.insert(key.clone(), serde_json::Value::String(value.to_string()));
            continue;
        }

        match &spec.default {
            Some(serde_yaml::Value::String(value)) => {
                normalized.insert(key.clone(), serde_json::Value::String(value.clone()));
            }
            Some(_) => {
                return Err(ProofbookError::new(
                    ProofbookErrorCode::ValidationFailed,
                    format!("Proofbook input {key} has a non-string default"),
                )
                .with_definition(definition.id.clone())
                .with_field(format!("inputs.{key}.default")));
            }
            None if spec.required => {
                return Err(ProofbookError::new(
                    ProofbookErrorCode::ValidationFailed,
                    format!("missing required Proofbook input: {key}"),
                )
                .with_definition(definition.id.clone())
                .with_field(format!("inputs.{key}")));
            }
            None => {}
        }
    }

    serde_json::to_value(normalized).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::ValidationFailed,
            format!("could not normalize Proofbook inputs: {error}"),
        )
        .with_definition(definition.id.clone())
        .with_field("inputs")
    })
}

fn dependencies_passed(ledger: &ProofbookRunLedger, step: &ProofbookStep) -> bool {
    step.depends_on.iter().all(|dependency| {
        ledger
            .step(dependency)
            .map(|summary| summary.status == ProofbookStepStatus::Passed)
            .unwrap_or(false)
    })
}

fn waiting_gate_for(ledger: &ProofbookRunLedger, gate_id: &str) -> Option<(String, String)> {
    for step in &ledger.steps {
        if step.status != ProofbookStepStatus::WaitingGate {
            continue;
        }
        let output = step.structured_output.as_ref()?;
        if output.get("gateId").and_then(|v| v.as_str()) == Some(gate_id) {
            let kind = output
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            return Some((step.step_id.clone(), kind));
        }
    }
    None
}

fn gate_hash_for(ledger: &ProofbookRunLedger, gate_id: &str) -> Option<String> {
    ledger.steps.iter().find_map(|step| {
        let output = step.structured_output.as_ref()?;
        if output.get("gateId").and_then(|v| v.as_str()) == Some(gate_id) {
            output
                .get("gateHash")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        } else {
            None
        }
    })
}

fn apply_gate_decision(
    ledger: &mut ProofbookRunLedger,
    step_id: &str,
    gate_kind: &str,
    decision: ProofbookGateDecision,
    normalized_decision: &str,
) {
    let passed = normalized_decision == "approve" || normalized_decision == "approved";
    let is_manual_gate = gate_kind == "manualGate";
    let rejection_code = if is_manual_gate {
        "manual_gate_rejected"
    } else {
        "proofbook_gate_rejected"
    };
    let rejection_message = if is_manual_gate {
        "manual Proofbook gate was rejected".to_string()
    } else {
        format!("{gate_kind} Proofbook gate was rejected")
    };
    if let Some(step) = ledger.step_mut(step_id) {
        step.status = if passed {
            ProofbookStepStatus::Passed
        } else {
            ProofbookStepStatus::Failed
        };
        step.completed_at = Some(ledger::now_timestamp());
        step.gate_decision = Some(decision.clone());
        if !passed {
            step.error = Some(ProofbookRunError::new(
                rejection_code,
                rejection_message.clone(),
            ));
        }
    }
    ledger.decisions.push(decision.clone());
    if !passed {
        ledger.residual_blockers.push(ProofbookResidualBlocker {
            code: rejection_code.to_string(),
            step_id: Some(step_id.to_string()),
            message: rejection_message.clone(),
        });
    }
    let event_kind = if is_manual_gate {
        "manual_gate_decided"
    } else {
        "proofbook_gate_decided"
    };
    let event_message = if is_manual_gate {
        format!("Proofbook manual gate decided: {normalized_decision}")
    } else {
        format!("Proofbook {gate_kind} gate decided: {normalized_decision}")
    };
    ledger.append_event(
        event_kind,
        Some(step_id.to_string()),
        event_message,
        Some(if passed { "passed" } else { "failed" }.to_string()),
        if passed {
            None
        } else {
            Some(ProofbookRunError::new(rejection_code, rejection_message))
        },
    );
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_proofbook(project: &Path, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.proofbook.yaml");
        fs::write(&path, yaml).unwrap();
        path.to_string_lossy().to_string()
    }

    fn project_path(project: &tempfile::TempDir) -> String {
        project.path().to_string_lossy().to_string()
    }

    fn start_echo_artifact(
        project: &tempfile::TempDir,
        runner: &ProofbookRunner,
    ) -> (ProofbookRunLedger, ledger::ProofbookArtifactRef) {
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-artifact-preview
steps:
  - id: echo
    type: shell
    command: echo artifact-preview
settlement:
  requiredSteps: [echo]
"#,
        );
        let run = runner
            .start_run(&project_path(project), &proofbook, json!({}))
            .unwrap();
        let artifact = run
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "stdout")
            .cloned()
            .expect("stdout artifact");
        (run, artifact)
    }

    #[test]
    fn proofbook_ledger_commit_rejects_a_stale_snapshot_without_overwrite() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cas-stale
steps:
  - id: approve
    type: manualGate
    gateId: cas-check
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [approve]
"#,
        );
        let runner = ProofbookRunner::new();
        let current = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let mut winner = current.clone();
        let mut stale = current.clone();
        winner.append_event("winner", None, "winner", None, None);
        stale.append_event("stale", None, "stale", None, None);

        runner.commit_ledger(project.path(), &mut winner).unwrap();
        let error = runner
            .commit_ledger(project.path(), &mut stale)
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::StaleLedgerRevision);
        let durable =
            ledger::read_ledger(&ledger::ledger_path(project.path(), &current.run_id)).unwrap();
        assert_eq!(durable.revision, winner.revision);
        assert!(durable.events.iter().any(|event| event.kind == "winner"));
        assert!(!durable.events.iter().any(|event| event.kind == "stale"));
    }

    #[test]
    fn proofbook_ledger_commit_detects_a_newer_durable_revision() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cas-durable
steps:
  - id: approve
    type: manualGate
    gateId: durable-check
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [approve]
"#,
        );
        let runner = ProofbookRunner::new();
        let mut stale = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let mut external = stale.clone();
        external.revision += 1;
        external.append_event("external", None, "external", None, None);
        ledger::write_ledger(project.path(), &external).unwrap();
        stale.append_event("stale", None, "stale", None, None);

        let error = runner
            .commit_ledger(project.path(), &mut stale)
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::StaleLedgerRevision);
        let durable =
            ledger::read_ledger(&ledger::ledger_path(project.path(), &stale.run_id)).unwrap();
        assert_eq!(durable.revision, external.revision);
        assert!(durable.events.iter().any(|event| event.kind == "external"));
    }

    #[test]
    fn proofbook_start_is_idempotent_for_an_existing_deterministic_run() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cas-idempotent
steps:
  - id: echo
    type: shell
    command: echo once
settlement:
  requiredSteps: [echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let first = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let second = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        assert_eq!(second.revision, first.revision);
        assert_eq!(second.events.len(), first.events.len());
        assert_eq!(second.status, ProofbookRunStatus::Passed);
    }

    #[test]
    fn input_free_start_requires_the_fresh_validated_definition_hash() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-input-free
steps:
  - id: echo
    type: shell
    command: echo input-free
settlement:
  requiredSteps: [echo]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let definition_hash = ledger::hash_json(&definition).unwrap();
        let runner = ProofbookRunner::new();

        let stale = runner
            .start_input_free_run(&project_path(&project), &proofbook, "sha256:stale")
            .unwrap_err();
        assert_eq!(stale.code, ProofbookErrorCode::StaleDefinitionHash);

        let started = runner
            .start_input_free_run(&project_path(&project), &proofbook, &definition_hash)
            .unwrap();
        assert_eq!(started.status, ProofbookRunStatus::Passed);
        assert_eq!(started.input_hash, ledger::hash_json(&json!({})).unwrap());
    }

    #[test]
    fn input_free_start_rejects_inputs_secrets_and_unsupported_steps() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-not-input-free
inputs:
  target:
    type: string
    required: true
steps:
  - id: agent
    type: agentSession
settlement:
  requiredSteps: [agent]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let definition_hash = ledger::hash_json(&definition).unwrap();
        let runner = ProofbookRunner::new();

        let error = runner
            .start_input_free_run(&project_path(&project), &proofbook, &definition_hash)
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::ValidationFailed);
        assert!(error.message.contains("runtime_inputs_declared"));
        assert!(error.message.contains("unsupported_step_kinds"));
    }

    #[test]
    fn string_input_start_normalizes_declared_values_and_defaults() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-string-inputs
inputs:
  mode:
    type: string
    default: release
  target:
    type: string
    required: true
steps:
  - id: echo
    type: shell
    command: echo string-inputs
settlement:
  requiredSteps: [echo]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let definition_hash = ledger::hash_json(&definition).unwrap();
        let runner = ProofbookRunner::new();

        let started = runner
            .start_string_input_run(
                &project_path(&project),
                &proofbook,
                &definition_hash,
                json!({ "target": "main" }),
            )
            .unwrap();

        assert_eq!(started.status, ProofbookRunStatus::Passed);
        assert_eq!(
            started.input_hash,
            ledger::hash_json(&json!({ "mode": "release", "target": "main" })).unwrap()
        );
    }

    #[test]
    fn string_input_start_rejects_invalid_objects_before_creating_a_ledger() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-string-input-errors
inputs:
  target:
    type: string
    required: true
steps:
  - id: echo
    type: shell
    command: echo string-input-errors
settlement:
  requiredSteps: [echo]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let definition_hash = ledger::hash_json(&definition).unwrap();
        let runner = ProofbookRunner::new();

        for (inputs, field) in [
            (json!({}), "inputs.target"),
            (json!({ "target": 7 }), "inputs.target"),
            (
                json!({ "target": "main", "unexpected": "value" }),
                "inputs.unexpected",
            ),
        ] {
            let error = runner
                .start_string_input_run(
                    &project_path(&project),
                    &proofbook,
                    &definition_hash,
                    inputs,
                )
                .unwrap_err();
            assert_eq!(error.code, ProofbookErrorCode::ValidationFailed);
            assert_eq!(error.field.as_deref(), Some(field));
        }

        let stale = runner
            .start_string_input_run(
                &project_path(&project),
                &proofbook,
                "sha256:stale",
                json!({ "target": "main" }),
            )
            .unwrap_err();
        assert_eq!(stale.code, ProofbookErrorCode::StaleDefinitionHash);
        assert!(runner
            .list_runs(&project_path(&project))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn cancel_current_run_cancels_waiting_gate_at_the_exact_revision() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cancel-current
steps:
  - id: approve
    type: manualGate
    gateId: cancellation-check
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [approve]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        let cancelled = runner
            .cancel_run_if_current(&project_path(&project), &waiting.run_id, waiting.revision)
            .unwrap();

        assert_eq!(cancelled.status, ProofbookRunStatus::Cancelled);
        assert_eq!(cancelled.revision, waiting.revision + 1);
        assert_eq!(cancelled.steps[0].status, ProofbookStepStatus::Cancelled);
        assert!(cancelled.steps[0].completed_at.is_some());
        assert!(cancelled
            .events
            .iter()
            .any(|event| event.kind == "run_cancelled"));
    }

    #[test]
    fn cancel_current_run_rejects_a_stale_revision_without_mutation() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cancel-stale
steps:
  - id: approve
    type: manualGate
    gateId: stale-cancel
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [approve]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        let error = runner
            .cancel_run_if_current(
                &project_path(&project),
                &waiting.run_id,
                waiting.revision + 1,
            )
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::StaleLedgerRevision);

        let current = runner
            .status(&project_path(&project), &waiting.run_id)
            .unwrap();
        assert_eq!(current.revision, waiting.revision);
        assert_eq!(current.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(current.steps[0].status, ProofbookStepStatus::WaitingGate);
    }

    #[test]
    fn cancel_current_run_rejects_terminal_ledgers_without_rewriting_history() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cancel-terminal
steps:
  - id: echo
    type: shell
    command: echo done
settlement:
  requiredSteps: [echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let passed = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        assert_eq!(passed.status, ProofbookRunStatus::Passed);

        let error = runner
            .cancel_run_if_current(&project_path(&project), &passed.run_id, passed.revision)
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::RunNotCancellable);

        let current = runner
            .status(&project_path(&project), &passed.run_id)
            .unwrap();
        assert_eq!(current.revision, passed.revision);
        assert_eq!(current.status, ProofbookRunStatus::Passed);
    }

    #[test]
    fn artifact_preview_verifies_the_current_runner_owned_text_artifact() {
        let project = tempfile::tempdir().unwrap();
        let runner = ProofbookRunner::new();
        let (run, artifact) = start_echo_artifact(&project, &runner);

        let preview = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &run.run_id,
                &artifact.id,
                run.revision,
            )
            .unwrap();

        assert_eq!(preview.ledger_revision, run.revision);
        assert_eq!(preview.artifact_id, artifact.id);
        assert_eq!(preview.sha256, artifact.sha256);
        assert_eq!(preview.size_bytes, artifact.size_bytes);
        assert_eq!(preview.encoding, "utf-8");
        assert!(preview.content.contains("artifact-preview"));
    }

    #[test]
    fn artifact_preview_rejects_a_stale_ledger_revision_before_reading() {
        let project = tempfile::tempdir().unwrap();
        let runner = ProofbookRunner::new();
        let (run, artifact) = start_echo_artifact(&project, &runner);

        let error = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &run.run_id,
                &artifact.id,
                run.revision + 1,
            )
            .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::StaleLedgerRevision);
    }

    #[test]
    fn artifact_preview_rejects_a_ledger_path_outside_the_runner_owned_root() {
        let project = tempfile::tempdir().unwrap();
        let runner = ProofbookRunner::new();
        let (run, _) = start_echo_artifact(&project, &runner);
        let root =
            crate::proofbook::validator::canonical_project_root(&project_path(&project)).unwrap();
        let external_path = root.join("outside.txt");
        let bytes = b"external artifact";
        fs::write(&external_path, bytes).unwrap();
        let mut current = run.clone();
        current.artifacts.push(ledger::ProofbookArtifactRef {
            id: "artifact-external".to_string(),
            path: "outside.txt".to_string(),
            kind: "text".to_string(),
            size_bytes: bytes.len() as u64,
            sha256: format!("sha256:{}", ledger::hash_bytes(bytes)),
            redaction_count: 0,
            step_id: "echo".to_string(),
        });
        runner.commit_ledger(&root, &mut current).unwrap();

        let error = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &current.run_id,
                "artifact-external",
                current.revision,
            )
            .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::ArtifactNotPreviewable);
    }

    #[test]
    fn artifact_preview_rejects_content_that_no_longer_matches_the_ledger_hash() {
        let project = tempfile::tempdir().unwrap();
        let runner = ProofbookRunner::new();
        let (run, artifact) = start_echo_artifact(&project, &runner);
        let root =
            crate::proofbook::validator::canonical_project_root(&project_path(&project)).unwrap();
        let path = root.join(&artifact.path);
        let mut bytes = fs::read(&path).unwrap();
        bytes[0] ^= 1;
        fs::write(&path, bytes).unwrap();

        let error = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &run.run_id,
                &artifact.id,
                run.revision,
            )
            .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::ArtifactIntegrityMismatch);
    }

    #[test]
    fn artifact_preview_rejects_oversized_and_non_utf8_runner_artifacts() {
        let project = tempfile::tempdir().unwrap();
        let runner = ProofbookRunner::new();
        let (run, artifact) = start_echo_artifact(&project, &runner);
        let root =
            crate::proofbook::validator::canonical_project_root(&project_path(&project)).unwrap();
        let path = root.join(&artifact.path);

        let oversized = vec![b'x'; PROOFBOOK_ARTIFACT_PREVIEW_MAX_BYTES as usize + 1];
        fs::write(&path, &oversized).unwrap();
        let mut oversized_ledger = run.clone();
        let oversized_artifact = oversized_ledger
            .artifacts
            .iter_mut()
            .find(|entry| entry.id == artifact.id)
            .unwrap();
        oversized_artifact.size_bytes = oversized.len() as u64;
        oversized_artifact.sha256 = format!("sha256:{}", ledger::hash_bytes(&oversized));
        runner.commit_ledger(&root, &mut oversized_ledger).unwrap();
        let oversized_error = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &oversized_ledger.run_id,
                &artifact.id,
                oversized_ledger.revision,
            )
            .unwrap_err();
        assert_eq!(
            oversized_error.code,
            ProofbookErrorCode::ArtifactNotPreviewable
        );

        let non_utf8 = vec![0xff, 0xfe, 0xfd];
        fs::write(&path, &non_utf8).unwrap();
        let mut non_utf8_ledger = oversized_ledger.clone();
        let non_utf8_artifact = non_utf8_ledger
            .artifacts
            .iter_mut()
            .find(|entry| entry.id == artifact.id)
            .unwrap();
        non_utf8_artifact.size_bytes = non_utf8.len() as u64;
        non_utf8_artifact.sha256 = format!("sha256:{}", ledger::hash_bytes(&non_utf8));
        runner.commit_ledger(&root, &mut non_utf8_ledger).unwrap();
        let non_utf8_error = runner
            .preview_artifact_if_current(
                &project_path(&project),
                &non_utf8_ledger.run_id,
                &artifact.id,
                non_utf8_ledger.revision,
            )
            .unwrap_err();
        assert_eq!(
            non_utf8_error.code,
            ProofbookErrorCode::ArtifactNotPreviewable
        );
    }

    #[test]
    fn concurrent_proofbook_settlements_have_exactly_one_cas_winner() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb-cas-concurrent
steps:
  - id: approve
    type: manualGate
    gateId: concurrent-check
    options: [approve, reject]
    default: reject
    risk: medium
settlement:
  requiredSteps: [approve]
"#,
        );
        let runner = ProofbookRunner::new();
        let current = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut handles = Vec::new();
        for kind in ["concurrent-a", "concurrent-b"] {
            let runner = runner.clone();
            let root = project.path().to_path_buf();
            let barrier = barrier.clone();
            let mut snapshot = current.clone();
            handles.push(std::thread::spawn(move || {
                snapshot.append_event(kind, None, kind, None, None);
                barrier.wait();
                runner.commit_ledger(&root, &mut snapshot)
            }));
        }
        barrier.wait();
        let outcomes: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            outcomes
                .iter()
                .filter(|result| {
                    result
                        .as_ref()
                        .err()
                        .is_some_and(|error| error.code == ProofbookErrorCode::StaleLedgerRevision)
                })
                .count(),
            1
        );
        let durable =
            ledger::read_ledger(&ledger::ledger_path(project.path(), &current.run_id)).unwrap();
        let committed = durable
            .events
            .iter()
            .filter(|event| matches!(event.kind.as_str(), "concurrent-a" | "concurrent-b"))
            .count();
        assert_eq!(committed, 1);
    }

    #[test]
    fn proofbook_runner_writes_ledger_before_shell_execution_and_passes() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-smoke
steps:
  - id: echo
    type: shell
    command: echo proofbook
settlement:
  requiredSteps: [echo]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert!(ledger::ledger_path(project.path(), &ledger.run_id).exists());
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
        assert!(ledger
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "stdout"));
        assert!(ledger
            .events
            .iter()
            .any(|event| event.kind == "run_created"));
    }

    #[test]
    fn proofbook_runner_gates_review_command_before_spawn() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-gated
steps:
  - id: commit
    type: shell
    command: git commit -m proofbook
settlement:
  requiredSteps: [commit]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::WaitingGate);
        let gate = ledger.steps[0].structured_output.as_ref().unwrap();
        assert_eq!(gate["kind"], "commandRisk");
    }

    #[test]
    fn proofbook_runner_resolves_manual_gate_and_continues() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual
steps:
  - id: approve
    type: manualGate
    gateId: release-check
    options: [approve, reject]
    default: reject
    risk: medium
  - id: echo
    type: shell
    command: echo after-gate
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let gate = waiting.steps[0].structured_output.as_ref().unwrap();

        let done = runner
            .resolve_manual_gate(
                &project_path(&project),
                &waiting.run_id,
                "release-check".to_string(),
                gate["gateHash"].as_str().unwrap().to_string(),
                "approve".to_string(),
                Some("tester".to_string()),
                Some("ok".to_string()),
            )
            .unwrap();

        assert_eq!(done.status, ProofbookRunStatus::Passed);
        assert_eq!(done.decisions.len(), 1);
        assert_eq!(done.steps[1].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn manual_gate_resolver_rejects_command_risk_gate_without_mutation() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-command-risk
steps:
  - id: commit
    type: shell
    command: git commit -m proofbook
settlement:
  requiredSteps: [commit]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let gate = waiting.steps[0].structured_output.as_ref().unwrap();

        let error = runner
            .resolve_manual_gate(
                &project_path(&project),
                &waiting.run_id,
                gate["gateId"].as_str().unwrap().to_string(),
                gate["gateHash"].as_str().unwrap().to_string(),
                "approve".to_string(),
                Some("tester".to_string()),
                None,
            )
            .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::ValidationFailed);
        let current = runner
            .status(&project_path(&project), &waiting.run_id)
            .unwrap();
        assert_eq!(current.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(current.steps[0].status, ProofbookStepStatus::WaitingGate);
        assert!(current.decisions.is_empty());
    }

    #[test]
    fn proofbook_runner_fails_closed_when_definition_changes_after_gate() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual-drift
steps:
  - id: approve
    type: manualGate
    gateId: release-check
  - id: echo
    type: shell
    command: echo original
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let gate = waiting.steps[0].structured_output.as_ref().unwrap();

        fs::write(
            &proofbook,
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual-drift
steps:
  - id: approve
    type: manualGate
    gateId: release-check
  - id: echo
    type: shell
    command: echo changed
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        )
        .unwrap();

        let done = runner
            .resolve_manual_gate(
                &project_path(&project),
                &waiting.run_id,
                "release-check".to_string(),
                gate["gateHash"].as_str().unwrap().to_string(),
                "approve".to_string(),
                Some("tester".to_string()),
                Some("ok".to_string()),
            )
            .unwrap();

        assert_eq!(done.status, ProofbookRunStatus::Failed);
        assert_eq!(done.steps[1].status, ProofbookStepStatus::Pending);
        assert!(done
            .residual_blockers
            .iter()
            .any(|blocker| blocker.code == "definition_changed_after_gate"));
    }
    #[test]
    fn proofbook_runner_wait_for_file_passes_without_busy_looping() {
        let project = tempfile::tempdir().unwrap();
        fs::write(project.path().join("ready.txt"), "ok").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-wait
steps:
  - id: wait
    type: waitFor
    path: ready.txt
    intervalMs: 10
    timeoutMs: 100
settlement:
  requiredSteps: [wait]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn proofbook_runner_marks_future_step_kinds_not_implemented() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-future
steps:
  - id: mcp
    type: mcpTool
settlement:
  requiredSteps: [mcp]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Failed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Blocked);
        assert_eq!(
            ledger.steps[0].error.as_ref().unwrap().code,
            "not_implemented"
        );
    }

    #[test]
    fn proofbook_runner_hydrates_running_steps_fail_closed() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-hydrate
steps:
  - id: echo
    type: shell
    command: echo proofbook
settlement:
  requiredSteps: [echo]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let mut ledger =
            ledger::new_run_ledger(project.path(), &proofbook, &definition, &json!({})).unwrap();
        ledger.status = ProofbookRunStatus::Running;
        ledger.steps[0].status = ProofbookStepStatus::Running;
        ledger::write_ledger(project.path(), &ledger).unwrap();

        let runner = ProofbookRunner::new();
        assert_eq!(runner.restore_project(&project_path(&project)).unwrap(), 1);
        let restored = runner
            .status(&project_path(&project), &ledger.run_id)
            .unwrap();

        assert_eq!(restored.status, ProofbookRunStatus::Failed);
        assert_eq!(
            restored.steps[0].error.as_ref().unwrap().code,
            "interrupted_by_restart"
        );
    }

    struct FakeAgentExecutor;

    impl ProofbookAgentSessionExecutor for FakeAgentExecutor {
        fn start_agent_session(
            &self,
            _run_id: &str,
            _ledger: &ProofbookRunLedger,
            step: &ProofbookStep,
            request: &crate::proofbook::ProofbookAgentSessionRequest,
        ) -> Result<crate::proofbook::ProofbookAgentSessionSpawn, ProofbookError> {
            Ok(crate::proofbook::ProofbookAgentSessionSpawn {
                session_id: format!("session-{}", step.id),
                pane_id: request.visible.then(|| format!("pane-{}", step.id)),
                pty_id: request.visible.then(|| format!("pty-{}", step.id)),
                backend: if request.visible {
                    "native"
                } else {
                    "headless"
                }
                .to_string(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                repo_path: request.repo_path.clone(),
                worktree_path: request.worktree_path.clone(),
                worktree_branch: request.worktree_branch.clone(),
                visible: request.visible,
            })
        }
    }

    #[test]
    fn proofbook_runner_agent_session_spawn_records_running_ledger_metadata() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-visible
steps:
  - id: agent
    type: agentSession
    task: continue PB-4 runtime
    role: implementation
    model: codex-mini
    branch: proofbook-agent-runtime
    expectedArtifacts:
      - .aelyris/proofbooks/agent-summary.md
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Running);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Running);
        assert!(ledger.steps[0].completed_at.is_none());
        let output = ledger.steps[0].structured_output.as_ref().unwrap();
        assert_eq!(output["kind"], "agentSession");
        assert_eq!(output["sessionId"], "session-agent");
        assert_eq!(output["paneId"], "pane-agent");
        assert_eq!(output["ptyId"], "pty-agent");
        assert_eq!(output["visibleMode"], "visible");
        assert_eq!(output["costTokensStatus"], "unknown");
        assert_eq!(output["worktreeBranch"], "proofbook-agent-runtime");
        assert!(ledger
            .events
            .iter()
            .any(|event| event.kind == "step_running"));
    }

    #[test]
    fn agent_session_settlement_context_and_cas_keep_revision_and_session_exact() {
        let project = tempfile::tempdir().unwrap();
        let expected = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("agent-summary.md");
        fs::create_dir_all(expected.parent().unwrap()).unwrap();
        fs::write(&expected, "summary").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-current-settlement
steps:
  - id: agent
    type: agentSession
    task: complete PB-4 runtime
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/agent-summary.md
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        let context = runner
            .agent_session_settlement_context(
                &project_path(&project),
                &running.run_id,
                "agent",
                running.revision,
            )
            .unwrap();
        assert_eq!(context.session_id, "session-agent");
        assert_eq!(context.pty_id.as_deref(), Some("pty-agent"));
        assert!(context.visible);
        assert_eq!(context.expected_artifacts.len(), 1);
        assert!(context.expected_artifacts[0].present);

        let stale = runner
            .agent_session_settlement_context(
                &project_path(&project),
                &running.run_id,
                "agent",
                running.revision.saturating_sub(1),
            )
            .unwrap_err();
        assert_eq!(stale.code, ProofbookErrorCode::StaleLedgerRevision);

        let wrong_session = runner
            .settle_agent_session_if_current(
                &project_path(&project),
                &running.run_id,
                "agent",
                running.revision,
                "session-replaced",
                ProofbookAgentSessionCompletionProof {
                    status: "passed".to_string(),
                    proof_kind: "requiredArtifactSettlement".to_string(),
                    done_signal: Some("aelyris.runtime.session:session-agent:done".to_string()),
                    ..ProofbookAgentSessionCompletionProof::default()
                },
            )
            .unwrap_err();
        assert_eq!(wrong_session.code, ProofbookErrorCode::ValidationFailed);
        let unchanged = runner
            .status(&project_path(&project), &running.run_id)
            .unwrap();
        assert_eq!(unchanged.revision, running.revision);
        assert_eq!(unchanged.steps[0].status, ProofbookStepStatus::Running);

        let settled = runner
            .settle_agent_session_if_current(
                &project_path(&project),
                &running.run_id,
                "agent",
                running.revision,
                "session-agent",
                ProofbookAgentSessionCompletionProof {
                    status: "passed".to_string(),
                    proof_kind: "requiredArtifactSettlement".to_string(),
                    done_signal: Some("aelyris.runtime.session:session-agent:done".to_string()),
                    ..ProofbookAgentSessionCompletionProof::default()
                },
            )
            .unwrap();
        assert_eq!(settled.status, ProofbookRunStatus::Passed);
        assert_eq!(settled.steps[0].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn proofbook_runner_agent_session_requires_pb4_runtime() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-runtime-required
steps:
  - id: agent
    type: agentSession
    task: continue PB-4 runtime
    role: implementation
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Failed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Blocked);
        assert_eq!(
            ledger.steps[0].error.as_ref().unwrap().code,
            "agent_session_runtime_unavailable"
        );
    }

    #[test]
    fn proofbook_runner_agent_session_headless_planner_records_reason() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-headless
steps:
  - id: agent
    type: agentSession
    task: review the proof artifacts
    role: planner
    visible: false
    headlessReason: batch planning evidence only
    model: sonnet
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Running);
        let output = ledger.steps[0].structured_output.as_ref().unwrap();
        assert_eq!(output["visibleMode"], "headless");
        assert_eq!(output["headlessReason"], "batch planning evidence only");
        assert_eq!(output["backend"], "headless");
        assert!(output["paneId"].is_null());
        assert!(output["ptyId"].is_null());
    }

    #[test]
    fn proofbook_runner_agent_session_settles_with_final_report_proof() {
        let project = tempfile::tempdir().unwrap();
        let final_report = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("agent-final.md");
        fs::create_dir_all(final_report.parent().unwrap()).unwrap();
        fs::write(&final_report, "agent done").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-complete-final-report
steps:
  - id: agent
    type: agentSession
    task: complete PB-4 runtime
    role: implementation
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        let settled = runner
            .settle_agent_session(
                &project_path(&project),
                &running.run_id,
                "agent",
                ProofbookAgentSessionCompletionProof {
                    status: "passed".to_string(),
                    proof_kind: "finalReport".to_string(),
                    final_report_path: Some(".aelyris/proofbooks/agent-final.md".to_string()),
                    summary: Some("completed".to_string()),
                    ..ProofbookAgentSessionCompletionProof::default()
                },
            )
            .unwrap();

        assert_eq!(settled.status, ProofbookRunStatus::Passed);
        assert_eq!(settled.steps[0].status, ProofbookStepStatus::Passed);
        let output = settled.steps[0].structured_output.as_ref().unwrap();
        assert_eq!(output["completion"]["status"], "passed");
        assert!(output["completion"]["proofSources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|source| source.as_str() == Some("finalReport")));
        assert!(settled
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "finalReport"));
        assert!(settled
            .events
            .iter()
            .any(|event| event.kind == "agent_session_completed"));
    }

    #[test]
    fn proofbook_runner_agent_session_settles_required_artifacts_only_with_explicit_proof() {
        let project = tempfile::tempdir().unwrap();
        let expected = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("agent-summary.md");
        fs::create_dir_all(expected.parent().unwrap()).unwrap();
        fs::write(&expected, "summary").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-complete-required-artifact
steps:
  - id: agent
    type: agentSession
    task: complete PB-4 runtime
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/agent-summary.md
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        let settled = runner
            .settle_agent_session(
                &project_path(&project),
                &running.run_id,
                "agent",
                ProofbookAgentSessionCompletionProof {
                    status: "passed".to_string(),
                    proof_kind: "requiredArtifactSettlement".to_string(),
                    ..ProofbookAgentSessionCompletionProof::default()
                },
            )
            .unwrap();

        assert_eq!(settled.status, ProofbookRunStatus::Passed);
        assert_eq!(settled.steps[0].status, ProofbookStepStatus::Passed);
        let output = settled.steps[0].structured_output.as_ref().unwrap();
        assert!(output["completion"]["proofSources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|source| source.as_str() == Some("requiredArtifactSettlement")));
        assert!(settled
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "expectedArtifact"));
    }

    #[test]
    fn proofbook_runner_agent_session_rejects_first_file_exists_without_completion_signal() {
        let project = tempfile::tempdir().unwrap();
        let expected = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("agent-summary.md");
        fs::create_dir_all(expected.parent().unwrap()).unwrap();
        fs::write(&expected, "summary").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-reject-first-file
steps:
  - id: agent
    type: agentSession
    task: complete PB-4 runtime
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/agent-summary.md
settlement:
  requiredSteps: [agent]
"#,
        );
        let runner = ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path(&project),
                &proofbook,
                json!({}),
                &FakeAgentExecutor,
            )
            .unwrap();

        let error = runner
            .settle_agent_session(
                &project_path(&project),
                &running.run_id,
                "agent",
                ProofbookAgentSessionCompletionProof {
                    status: "passed".to_string(),
                    ..ProofbookAgentSessionCompletionProof::default()
                },
            )
            .unwrap_err();
        assert_eq!(error.code, ProofbookErrorCode::ValidationFailed);
        assert!(error
            .message
            .contains("agent_session_completion_proof_missing"));
        let current = runner
            .status(&project_path(&project), &running.run_id)
            .unwrap();
        assert_eq!(current.status, ProofbookRunStatus::Running);
        assert_eq!(current.steps[0].status, ProofbookStepStatus::Running);
    }
    #[test]
    fn proofbook_runner_hydrates_running_agent_session_with_typed_blocker() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb4-agent-hydrate
steps:
  - id: agent
    type: agentSession
    task: continue PB-4 runtime
    role: implementation
settlement:
  requiredSteps: [agent]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let mut ledger =
            ledger::new_run_ledger(project.path(), &proofbook, &definition, &json!({})).unwrap();
        ledger.status = ProofbookRunStatus::Running;
        ledger.steps[0].status = ProofbookStepStatus::Running;
        ledger::write_ledger(project.path(), &ledger).unwrap();

        let runner = ProofbookRunner::new();
        assert_eq!(runner.restore_project(&project_path(&project)).unwrap(), 1);
        let restored = runner
            .status(&project_path(&project), &ledger.run_id)
            .unwrap();

        assert_eq!(restored.status, ProofbookRunStatus::Failed);
        assert_eq!(restored.steps[0].status, ProofbookStepStatus::Blocked);
        assert_eq!(
            restored.steps[0].error.as_ref().unwrap().code,
            "agent_session_interrupted_by_restart"
        );
        assert!(restored
            .residual_blockers
            .iter()
            .any(|blocker| blocker.code == "agent_session_interrupted_by_restart"));
    }
}
