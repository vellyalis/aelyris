//! Cockpit-only packet settlement behind the existing [`TaskManager`] authority.
//!
//! This module owns no state, database, graph, or completion truth. It is a
//! private implementation slice that keeps the exact-OID lineage checks and the
//! atomic packet/TaskGraph projection together while `TaskManager` remains the
//! public authority and lock owner.

use super::*;

impl TaskManager {
    /// Return the exact packet-backed authority for a cockpit Task whose Git
    /// integration and settlement committed, but whose idempotent resource
    /// cleanup / execution Finalization has not yet committed. This is the only
    /// startup-resume admission for that boundary: a bare `Done` Task, a merged
    /// intent, or a partially advanced execution fence is never enough.
    pub(crate) fn pending_cockpit_finalization(
        &self,
        task_id: &str,
    ) -> Result<Option<(MissionPlanActivation, CompletedWorkPacket)>, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        let Some(activation) =
            db.try_with(|database| TaskRepo::load_mission_activation_for_task(database, task_id))?
        else {
            return Ok(None);
        };
        let preview = db
            .try_with(|database| {
                TaskRepo::load_mission_plan(database, &activation.plan_id, activation.plan_revision)
            })?
            .ok_or_else(|| MissionPlanError::NotFound {
                plan_id: activation.plan_id.clone(),
                plan_revision: activation.plan_revision,
            })?;
        preview.verify_integrity()?;
        if !preview.is_cockpit_profile() {
            return Ok(None);
        }
        if preview.status != MissionPlanStatus::Accepted
            || activation.task_id != task_id
            || activation.mission_id != preview.mission_definition.mission_id
            || activation.mission_revision != preview.mission_definition.revision
            || activation.plan_content_digest != preview.content_digest
        {
            return Err(MissionPlanError::ContentConflict(
                "cockpit finalization activation differs from its accepted Mission".into(),
            ));
        }

        let task = self.get(task_id).ok_or_else(|| {
            MissionPlanError::ContentConflict(
                "cockpit finalization activation has no TaskGraph projection".into(),
            )
        })?;
        let packet = db.try_with(|database| {
            TaskRepo::load_completed_work_packet(database, &activation.activation_id)
        })?;
        let Some(packet) = packet else {
            if task.status == TaskStatus::Done {
                return Err(MissionPlanError::ContentConflict(
                    "cockpit Task is Done without an immutable work completion packet".into(),
                ));
            }
            return Ok(None);
        };
        packet.validate()?;
        let packet_paths = packet.owned_paths.iter().collect::<HashSet<_>>();
        let activation_paths = activation.owned_targets.iter().collect::<HashSet<_>>();
        if packet.contract_proof_version != COCKPIT_SETTLEMENT_PROOF_VERSION
            || packet.activation_id != activation.activation_id
            || packet.plan_id != activation.plan_id
            || packet.plan_revision != activation.plan_revision
            || packet.mission_id != activation.mission_id
            || packet.mission_revision != activation.mission_revision
            || packet.work_unit_id != activation.work_unit_id
            || packet.plan_content_digest != activation.plan_content_digest
            || packet_paths != activation_paths
            || task.status != TaskStatus::Done
        {
            return Err(MissionPlanError::ContentConflict(
                "cockpit finalization packet differs from its activation or Done Task".into(),
            ));
        }

        let execution = self.current_execution(task_id).ok_or_else(|| {
            MissionPlanError::ContentConflict(
                "packet-backed cockpit Task has no durable execution attempt".into(),
            )
        })?;
        if execution.merge_intent_id.as_deref() != Some(packet.merge_intent_id.as_str()) {
            return Err(MissionPlanError::ContentConflict(
                "packet-backed cockpit Finalization has a different merge intent".into(),
            ));
        }
        if execution.state == WorkExecutionState::Completed
            && execution.fence.effect == ExecutionEffect::Finalization
            && execution.fence.state == ExecutionFenceState::Committed
        {
            return Ok(None);
        }
        let resumable = execution.state == WorkExecutionState::MergeReady
            && matches!(
                (execution.fence.effect, execution.fence.state),
                (ExecutionEffect::Merge, ExecutionFenceState::Committed)
                    | (ExecutionEffect::Finalization, ExecutionFenceState::Reserved)
                    | (
                        ExecutionEffect::Finalization,
                        ExecutionFenceState::EffectStarted
                    )
            );
        if !resumable {
            return Err(MissionPlanError::ContentConflict(
                "packet-backed cockpit Finalization is outside its resumable fence states".into(),
            ));
        }
        Ok(Some((activation, packet)))
    }

    /// Settle one accepted cockpit Task through the existing A7 packet owner.
    /// Git integration is only a lineage fact; Task Done and optional aggregate
    /// Mission completion linearize with immutable packet persistence here.
    pub fn settle_cockpit_task(
        &self,
        task_id: &str,
    ) -> Result<CockpitTaskSettlementOutcome, MissionPlanError> {
        let db = self.db().ok_or(MissionPlanError::DurabilityUnavailable)?;
        let _writer = self.persistence_lock();
        let now = decision_unix_ms()?;
        let activation = db
            .try_with(|database| TaskRepo::load_mission_activation_for_task(database, task_id))?
            .ok_or_else(|| {
                MissionPlanError::Validation(
                    "cockpit Task has no immutable Mission activation".into(),
                )
            })?;
        let preview = db
            .try_with(|database| {
                TaskRepo::load_mission_plan(database, &activation.plan_id, activation.plan_revision)
            })?
            .ok_or_else(|| MissionPlanError::NotFound {
                plan_id: activation.plan_id.clone(),
                plan_revision: activation.plan_revision,
            })?;
        preview.verify_integrity()?;
        if preview.status != MissionPlanStatus::Accepted
            || !preview.is_cockpit_profile()
            || preview.mission_definition.team_policy.governance_policy_id
                != COCKPIT_GOVERNANCE_POLICY_ID
        {
            return Err(MissionPlanError::Validation(
                "only an accepted cockpit Mission Task may settle".into(),
            ));
        }

        if let Some(work_packet) = db.try_with(|database| {
            TaskRepo::load_completed_work_packet(database, &activation.activation_id)
        })? {
            if self.read(|graph| graph.get(task_id).map(|task| task.status))
                != Some(TaskStatus::Done)
            {
                return Err(MissionPlanError::ContentConflict(
                    "durable cockpit work packet and Task projection disagree".into(),
                ));
            }
            let mission_packet = db.try_with(|database| {
                TaskRepo::load_cockpit_mission_completion(
                    database,
                    &activation.plan_id,
                    activation.plan_revision,
                )
            })?;
            return Ok(CockpitTaskSettlementOutcome {
                work_packet,
                mission_packet,
            });
        }

        let evidence = db
            .try_with(|database| {
                TaskRepo::load_mission_gate_evidence(database, &activation.activation_id)
            })?
            .ok_or_else(|| {
                MissionPlanError::Validation(
                    "cockpit settlement lacks durable exact gate evidence".into(),
                )
            })?;
        evidence.cockpit_gate_suite()?.ok_or_else(|| {
            MissionPlanError::Validation(
                "cockpit settlement requires the typed gate-suite evidence".into(),
            )
        })?;
        let review = db
            .with(|database| {
                crate::persistence::ReviewRepo::latest_for_activation(
                    database,
                    &activation.activation_id,
                )
            })
            .map_err(MissionPlanError::Persistence)?
            .ok_or_else(|| {
                MissionPlanError::Validation("cockpit settlement lacks independent review".into())
            })?;
        let binding = db
            .with(|database| {
                crate::persistence::MergeRepo::mission_binding_for_activation(
                    database,
                    &activation.activation_id,
                )
            })
            .map_err(MissionPlanError::Persistence)?
            .ok_or_else(|| {
                MissionPlanError::Validation("cockpit settlement lacks exact merge binding".into())
            })?;
        let receipt = db
            .with(|database| {
                crate::persistence::MergeRepo::mission_receipt(database, &binding.intent_id)
            })
            .map_err(MissionPlanError::Persistence)?
            .ok_or_else(|| {
                MissionPlanError::Validation(
                    "cockpit settlement lacks exact integration receipt".into(),
                )
            })?;
        let intent = db
            .with(|database| crate::persistence::MergeRepo::get(database, &binding.intent_id))
            .map_err(MissionPlanError::Persistence)?
            .ok_or_else(|| {
                MissionPlanError::Validation(
                    "cockpit settlement lacks its durable merge intent".into(),
                )
            })?;
        let expected_gates_digest =
            crate::control::gate_runner::gate_results_digest(&crate::review::GateResults {
                tests_pass: true,
                lint_pass: true,
                types_pass: true,
                design_consistent: true,
                context_aligned: true,
            })
            .map_err(MissionPlanError::Validation)?;
        crate::review::mission::validate_mission_review_record(&review)
            .map_err(MissionPlanError::Validation)?;
        if evidence.activation_id != activation.activation_id
            || evidence.plan_content_digest != activation.plan_content_digest
            || evidence.result != "passed"
            || evidence.candidate_oid != evidence.tested_oid
            || evidence.ended_at_unix_ms > review.created_at_unix_ms
            || review.created_at_unix_ms > now
            || review.activation_id != activation.activation_id
            || review.mission_id != activation.mission_id
            || review.mission_revision != activation.mission_revision
            || review.work_unit_id != activation.work_unit_id
            || review.plan_content_digest != activation.plan_content_digest
            || review.tested_evidence_id != evidence.evidence_id
            || review.reviewed_oid != evidence.tested_oid
            || review.verdict != crate::review::MissionReviewVerdict::AcceptedExactOid
            || !review.reviewer_independence.eligible
            || review.reviewer_independence.shared_ancestor_or_fork
            || !review
                .reviewer_independence
                .disqualifying_relations
                .is_empty()
            || binding.activation_id != activation.activation_id
            || binding.mission_id != activation.mission_id
            || binding.mission_revision != activation.mission_revision
            || binding.work_unit_id != activation.work_unit_id
            || binding.tested_evidence_id != evidence.evidence_id
            || binding.review_id != review.review_id
            || binding.reviewer_independence_digest != review.reviewer_independence.digest
            || binding.source_oid != evidence.tested_oid
            || binding.target_oid != evidence.base_oid
            || receipt.intent_id != binding.intent_id
            || receipt.integrated_oid != binding.source_oid
            || receipt.merge_result != "merged_exact_oid"
            || intent.state != crate::merge_intent::MergeIntentState::Merged
            || intent.task_id != activation.task_id
            || intent.session_id.as_deref() != Some(activation.task_id.as_str())
            || intent.source_branch != activation.source_branch
            || intent.target_branch != activation.target_branch
            || intent.source_oid != binding.source_oid
            || intent.target_oid != binding.target_oid
            || intent.reviewer_id.as_deref()
                != Some(review.reviewer_independence.reviewer_principal_id.as_str())
            || intent.gates_digest.as_deref() != Some(expected_gates_digest.as_str())
        {
            return Err(MissionPlanError::ContentConflict(
                "cockpit exact-OID gate/review/merge lineage drifted".into(),
            ));
        }
        let execution = self.current_execution(task_id).ok_or_else(|| {
            MissionPlanError::Validation(
                "cockpit settlement lacks its durable execution attempt".into(),
            )
        })?;
        if execution.state != WorkExecutionState::MergeReady
            || execution.fence.effect != ExecutionEffect::Merge
            || execution.fence.state != ExecutionFenceState::Committed
            || execution.merge_intent_id.as_deref() != Some(binding.intent_id.as_str())
            || execution.identity.attempt_id != evidence.attempt_id
            || execution.identity.execution_generation != evidence.execution_generation
            || execution.identity.agent_run_id != evidence.agent_run_id
            || execution.identity.pty_session_id.as_deref() != Some(&evidence.pty_session_id)
        {
            return Err(MissionPlanError::ContentConflict(
                "cockpit Task is not at the trusted MergeReady settlement fence".into(),
            ));
        }

        let observation = observe_cockpit_settlement_git(&activation, &evidence);
        if observation.candidate_state != "exact-owned-clean"
            || observation.candidate_oid.as_deref() != Some(receipt.integrated_oid.as_str())
            || observation.target_oid.as_deref() != Some(receipt.integrated_oid.as_str())
            || observation.changed_paths.is_empty()
        {
            return Err(MissionPlanError::ContentConflict(
                "cockpit candidate, target, or owned worktree changed before settlement".into(),
            ));
        }
        let observed_git_fingerprint = observation.fingerprint()?;
        let expected_version = db.try_with(|database| {
            TaskRepo::settlement_expected_version(
                database,
                &activation.activation_id,
                &observed_git_fingerprint,
            )
        })?;
        let coverage = cockpit_settlement_coverage(&preview, &activation, &evidence, &review)?;
        let work_packet = CompletedWorkPacket {
            schema: COMPLETED_WORK_PACKET_SCHEMA.into(),
            packet_id: uuid::Uuid::now_v7().to_string(),
            activation_id: activation.activation_id.clone(),
            plan_id: activation.plan_id.clone(),
            plan_revision: activation.plan_revision,
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            plan_content_digest: activation.plan_content_digest.clone(),
            contract_proof_version: COCKPIT_SETTLEMENT_PROOF_VERSION.into(),
            settlement_expected_version: expected_version.clone(),
            settlement_generation: 1,
            supersedes_packet_id: None,
            observed_git_fingerprint: observed_git_fingerprint.clone(),
            base_oid: evidence.base_oid.clone(),
            tested_oid: evidence.tested_oid.clone(),
            reviewed_oid: review.reviewed_oid.clone(),
            integrated_oid: receipt.integrated_oid.clone(),
            owned_paths: observation.changed_paths.clone(),
            owned_diff_digest: observation.owned_diff_digest.clone().ok_or_else(|| {
                MissionPlanError::Validation("cockpit settlement lacks an owned diff digest".into())
            })?,
            gate_evidence_id: evidence.evidence_id.clone(),
            gate_evidence_digest: evidence.evidence_digest.clone(),
            review_id: review.review_id.clone(),
            review_digest: review.review_digest.clone(),
            reviewer_principal_id: review.reviewer_independence.reviewer_principal_id.clone(),
            reviewer_independence: review.reviewer_independence.clone(),
            merge_intent_id: binding.intent_id.clone(),
            merge_receipt_id: receipt.receipt_id.clone(),
            merge_result: receipt.merge_result.clone(),
            acceptance_coverage: coverage,
            repo_blockers: Vec::new(),
            policy_blockers: Vec::new(),
            operator_blockers: Vec::new(),
            external_blockers: Vec::new(),
            created_at_unix_ms: now,
            packet_digest: String::new(),
        }
        .seal()?;

        let mut completed_packets = db.try_with(|database| {
            TaskRepo::load_completed_work_packets_for_plan(
                database,
                &activation.plan_id,
                activation.plan_revision,
            )
        })?;
        completed_packets.retain(|packet| packet.activation_id != activation.activation_id);
        completed_packets.push(work_packet.clone());
        let accepted_work_units = preview
            .work_units
            .iter()
            .map(|work| work.work_unit_id.as_str())
            .collect::<HashSet<_>>();
        let completed_work_units = completed_packets
            .iter()
            .map(|packet| packet.work_unit_id.as_str())
            .collect::<HashSet<_>>();
        let mission_packet = if completed_work_units == accepted_work_units {
            let required = completed_packets
                .iter()
                .map(|packet| (packet.work_unit_id.clone(), packet.packet_id.clone()))
                .collect::<std::collections::BTreeMap<_, _>>();
            let aggregate_coverage = aggregate_cockpit_coverage(&preview, &completed_packets)?;
            Some(
                MissionCompletionPacket {
                    schema: MISSION_COMPLETION_PACKET_SCHEMA.into(),
                    packet_id: uuid::Uuid::now_v7().to_string(),
                    mission_id: activation.mission_id.clone(),
                    mission_revision: activation.mission_revision,
                    required_work_unit_packet_ids_by_work_unit: required,
                    mission_acceptance_coverage: aggregate_coverage,
                    final_head_oid: receipt.integrated_oid.clone(),
                    integrated_oid: receipt.integrated_oid.clone(),
                    contract_proof_version: COCKPIT_SETTLEMENT_PROOF_VERSION.into(),
                    settlement_expected_version: expected_version,
                    settlement_generation: 1,
                    observed_git_fingerprint: observed_git_fingerprint.clone(),
                    merge_result: "merged_exact_oid".into(),
                    repo_blockers: Vec::new(),
                    policy_blockers: Vec::new(),
                    operator_blockers: Vec::new(),
                    external_blockers: Vec::new(),
                    created_at_unix_ms: now,
                    packet_digest: String::new(),
                }
                .seal()?,
            )
        } else {
            None
        };

        let mut state = self.lock();
        Self::require_mutation_available(&state)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        let mut staging = state.graph.clone();
        if staging.get(task_id).map(|task| task.status) != Some(TaskStatus::Review) {
            return Err(MissionPlanError::ContentConflict(
                "cockpit Task left Review before packet settlement".into(),
            ));
        }
        project_cockpit_settlement_completion(&mut staging, task_id)?;
        let final_activation = activation.clone();
        let final_evidence = evidence.clone();
        db.try_with(|database| {
            TaskRepo::persist_cockpit_completed_settlement(
                database,
                &staging,
                &activation,
                &work_packet,
                mission_packet.as_ref(),
                || observe_cockpit_settlement_git(&final_activation, &final_evidence).fingerprint(),
            )
        })?;
        Self::publish_mutation(&mut state, staging);
        Ok(CockpitTaskSettlementOutcome {
            work_packet,
            mission_packet,
        })
    }
    pub(super) fn cockpit_settlement_resume_fact(
        db: &crate::db::Database,
        attempt: &WorkExecutionAttempt,
        task_status: TaskStatus,
    ) -> Result<bool, String> {
        use crate::merge_intent::MergeIntentState;

        if task_status != TaskStatus::Review
            || attempt.runtime != crate::task::ExecutionRuntime::VisiblePty
            || attempt.state != WorkExecutionState::MergeReady
            || attempt.fence.effect != ExecutionEffect::Merge
            || attempt.fence.state != ExecutionFenceState::Committed
        {
            return Ok(false);
        }
        let Some(intent_id) = attempt.merge_intent_id.as_deref() else {
            return Ok(false);
        };
        let Some(activation) =
            TaskRepo::load_mission_activation_for_task(db, &attempt.identity.task_id)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        let Some(preview) =
            TaskRepo::load_mission_plan(db, &activation.plan_id, activation.plan_revision)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        preview
            .verify_integrity()
            .map_err(|error| error.to_string())?;
        if preview.status != MissionPlanStatus::Accepted
            || !preview.is_cockpit_profile()
            || activation.task_id != attempt.identity.task_id
            || activation.mission_id != preview.mission_definition.mission_id
            || activation.mission_revision != preview.mission_definition.revision
            || activation.plan_content_digest != preview.content_digest
            || TaskRepo::load_completed_work_packet(db, &activation.activation_id)
                .map_err(|error| error.to_string())?
                .is_some()
        {
            return Ok(false);
        }

        let Some(evidence) = TaskRepo::load_mission_gate_evidence(db, &activation.activation_id)
            .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        if evidence
            .cockpit_gate_suite()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(false);
        }
        let Some(review) =
            crate::persistence::ReviewRepo::latest_for_activation(db, &activation.activation_id)?
        else {
            return Ok(false);
        };
        crate::review::mission::validate_mission_review_record(&review)?;
        let Some(binding) = crate::persistence::MergeRepo::mission_binding_for_activation(
            db,
            &activation.activation_id,
        )?
        else {
            return Ok(false);
        };
        let Some(receipt) = crate::persistence::MergeRepo::mission_receipt(db, &binding.intent_id)?
        else {
            return Ok(false);
        };
        let Some(intent) = crate::persistence::MergeRepo::get(db, &binding.intent_id)? else {
            return Ok(false);
        };
        let expected_gates_digest =
            crate::control::gate_runner::gate_results_digest(&crate::review::GateResults {
                tests_pass: true,
                lint_pass: true,
                types_pass: true,
                design_consistent: true,
                context_aligned: true,
            })?;

        if evidence.activation_id != activation.activation_id
            || evidence.plan_content_digest != activation.plan_content_digest
            || evidence.result != "passed"
            || evidence.candidate_oid != evidence.tested_oid
            || review.activation_id != activation.activation_id
            || review.mission_id != activation.mission_id
            || review.mission_revision != activation.mission_revision
            || review.work_unit_id != activation.work_unit_id
            || review.plan_content_digest != activation.plan_content_digest
            || review.tested_evidence_id != evidence.evidence_id
            || review.reviewed_oid != evidence.tested_oid
            || review.verdict != crate::review::MissionReviewVerdict::AcceptedExactOid
            || !review.reviewer_independence.eligible
            || binding.intent_id != intent_id
            || binding.activation_id != activation.activation_id
            || binding.mission_id != activation.mission_id
            || binding.mission_revision != activation.mission_revision
            || binding.work_unit_id != activation.work_unit_id
            || binding.tested_evidence_id != evidence.evidence_id
            || binding.review_id != review.review_id
            || binding.reviewer_independence_digest != review.reviewer_independence.digest
            || binding.source_oid != evidence.tested_oid
            || binding.target_oid != evidence.base_oid
            || receipt.intent_id != binding.intent_id
            || receipt.integrated_oid != binding.source_oid
            || receipt.merge_result != "merged_exact_oid"
            || intent.state != MergeIntentState::Merged
            || intent.task_id != activation.task_id
            || intent.source_branch != activation.source_branch
            || intent.target_branch != activation.target_branch
            || intent.source_oid != binding.source_oid
            || intent.target_oid != binding.target_oid
            || intent.reviewer_id.as_deref()
                != Some(review.reviewer_independence.reviewer_principal_id.as_str())
            || intent.gates_digest.as_deref() != Some(expected_gates_digest.as_str())
            || intent.session_id.as_deref() != Some(activation.task_id.as_str())
            || attempt.identity.attempt_id != evidence.attempt_id
            || attempt.identity.execution_generation != evidence.execution_generation
            || attempt.identity.agent_run_id != evidence.agent_run_id
            || attempt.identity.pty_session_id.as_deref() != Some(&evidence.pty_session_id)
        {
            return Ok(false);
        }

        let observation = observe_cockpit_settlement_git(&activation, &evidence);
        Ok(observation.candidate_state == "exact-owned-clean"
            && observation.target_state == "resolved"
            && observation.candidate_oid.as_deref() == Some(evidence.tested_oid.as_str())
            && observation.target_oid.as_deref() == Some(receipt.integrated_oid.as_str())
            && observation.owned_diff_digest.is_some())
    }

    pub fn is_resumable_cockpit_settlement(
        &self,
        attempt: &WorkExecutionAttempt,
    ) -> Result<bool, String> {
        let Some(task) = self.get(&attempt.identity.task_id) else {
            return Ok(false);
        };
        let db = self
            .db()
            .ok_or_else(|| "Task persistence unavailable".to_string())?;
        db.with(|database| Self::cockpit_settlement_resume_fact(database, attempt, task.status))
    }

    pub(super) fn cockpit_merge_reconciliation_candidate_fact(
        db: &crate::db::Database,
        attempt: &WorkExecutionAttempt,
        task_status: TaskStatus,
    ) -> Result<bool, String> {
        if task_status != TaskStatus::Review
            || attempt.runtime != crate::task::ExecutionRuntime::VisiblePty
            || attempt.state != WorkExecutionState::MergeReady
            || attempt.fence.effect != ExecutionEffect::Merge
            || attempt.fence.state != ExecutionFenceState::EffectStarted
            || attempt.merge_intent_id.is_none()
        {
            return Ok(false);
        }
        let Some(activation) =
            TaskRepo::load_mission_activation_for_task(db, &attempt.identity.task_id)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        let Some(preview) =
            TaskRepo::load_mission_plan(db, &activation.plan_id, activation.plan_revision)
                .map_err(|error| error.to_string())?
        else {
            return Ok(false);
        };
        preview
            .verify_integrity()
            .map_err(|error| error.to_string())?;
        Ok(preview.status == MissionPlanStatus::Accepted
            && preview.is_cockpit_profile()
            && activation.task_id == attempt.identity.task_id
            && activation.plan_content_digest == preview.content_digest)
    }

    /// Reconcile only the narrow crash window where the exact Git merge landed
    /// but the Mission receipt and/or durable Merge-fence commit did not. The
    /// source/target refs, clean owned history, accepted review, intent approval,
    /// and execution generation are re-proved first; Git is never executed here.
    pub fn reconcile_cockpit_merge_completion(
        &self,
        attempt: &WorkExecutionAttempt,
        now: u64,
    ) -> Result<bool, String> {
        use crate::merge_intent::{MergeIntentState, MissionMergeReceipt};

        let Some(task) = self.get(&attempt.identity.task_id) else {
            return Ok(false);
        };
        let db = self
            .db()
            .ok_or_else(|| "Task persistence unavailable".to_string())?;
        if !db.with(|database| {
            Self::cockpit_merge_reconciliation_candidate_fact(database, attempt, task.status)
        })? {
            return Ok(false);
        }
        let intent_id = attempt
            .merge_intent_id
            .as_deref()
            .ok_or_else(|| "cockpit merge reconciliation lost intent identity".to_string())?;
        let (activation, evidence, review, binding, intent, receipt) = db.with(|database| {
            let activation =
                TaskRepo::load_mission_activation_for_task(database, &attempt.identity.task_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| "cockpit merge reconciliation lost activation".to_string())?;
            let evidence =
                TaskRepo::load_mission_gate_evidence(database, &activation.activation_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| "cockpit merge reconciliation lost gate evidence".to_string())?;
            evidence
                .cockpit_gate_suite()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "cockpit merge reconciliation evidence is not a typed suite".to_string()
                })?;
            let review = crate::persistence::ReviewRepo::latest_for_activation(
                database,
                &activation.activation_id,
            )?
            .ok_or_else(|| "cockpit merge reconciliation lost review".to_string())?;
            crate::review::mission::validate_mission_review_record(&review)?;
            let binding = crate::persistence::MergeRepo::mission_binding_for_activation(
                database,
                &activation.activation_id,
            )?
            .ok_or_else(|| "cockpit merge reconciliation lost binding".to_string())?;
            let intent = crate::persistence::MergeRepo::get(database, intent_id)?
                .ok_or_else(|| "cockpit merge reconciliation lost intent".to_string())?;
            let receipt = crate::persistence::MergeRepo::mission_receipt(database, intent_id)?;
            Ok::<_, String>((activation, evidence, review, binding, intent, receipt))
        })?;
        let expected_gates_digest =
            crate::control::gate_runner::gate_results_digest(&crate::review::GateResults {
                tests_pass: true,
                lint_pass: true,
                types_pass: true,
                design_consistent: true,
                context_aligned: true,
            })?;
        if evidence.activation_id != activation.activation_id
            || evidence.plan_content_digest != activation.plan_content_digest
            || evidence.result != "passed"
            || evidence.candidate_oid != evidence.tested_oid
            || review.verdict != crate::review::MissionReviewVerdict::AcceptedExactOid
            || review.activation_id != activation.activation_id
            || review.tested_evidence_id != evidence.evidence_id
            || review.reviewed_oid != evidence.tested_oid
            || !review.reviewer_independence.eligible
            || binding.intent_id != intent_id
            || binding.activation_id != activation.activation_id
            || binding.review_id != review.review_id
            || binding.tested_evidence_id != evidence.evidence_id
            || binding.source_oid != evidence.tested_oid
            || binding.target_oid != evidence.base_oid
            || intent.state != MergeIntentState::Merged
            || intent.task_id != activation.task_id
            || intent.session_id.as_deref() != Some(activation.task_id.as_str())
            || intent.source_branch != activation.source_branch
            || intent.target_branch != activation.target_branch
            || intent.source_oid != binding.source_oid
            || intent.target_oid != binding.target_oid
            || intent.reviewer_id.as_deref()
                != Some(review.reviewer_independence.reviewer_principal_id.as_str())
            || intent.gates_digest.as_deref() != Some(expected_gates_digest.as_str())
            || attempt.identity.attempt_id != evidence.attempt_id
            || attempt.identity.execution_generation != evidence.execution_generation
            || attempt.identity.agent_run_id != evidence.agent_run_id
            || attempt.identity.pty_session_id.as_deref() != Some(&evidence.pty_session_id)
        {
            return Err("cockpit merge reconciliation lineage drifted".to_string());
        }
        let observation = observe_cockpit_settlement_git(&activation, &evidence);
        if observation.candidate_state != "exact-owned-clean"
            || observation.target_state != "resolved"
            || observation.candidate_oid.as_deref() != Some(binding.source_oid.as_str())
            || observation.target_oid.as_deref() != Some(binding.source_oid.as_str())
        {
            return Err("cockpit merge reconciliation Git witness drifted".to_string());
        }
        match receipt {
            Some(receipt)
                if receipt.intent_id == binding.intent_id
                    && receipt.integrated_oid == binding.source_oid
                    && receipt.merge_result == "merged_exact_oid" => {}
            Some(_) => return Err("cockpit merge reconciliation receipt drifted".to_string()),
            None => {
                let receipt = MissionMergeReceipt {
                    receipt_id: uuid::Uuid::now_v7().to_string(),
                    intent_id: binding.intent_id.clone(),
                    integrated_oid: binding.source_oid.clone(),
                    merge_result: "merged_exact_oid".into(),
                    created_at_unix_ms: decision_unix_ms().map_err(|error| error.to_string())?,
                };
                db.with(|database| {
                    crate::persistence::MergeRepo::insert_mission_receipt(database, &receipt)
                        .map(|_| ())
                })?;
            }
        }
        self.commit_execution_effect(&attempt.token(), ExecutionEffect::Merge, now)
            .map_err(|error| error.to_string())?;
        Ok(true)
    }
}

pub(super) fn project_cockpit_settlement_completion(
    graph: &mut TaskGraph,
    task_id: &str,
) -> Result<Vec<String>, MissionPlanError> {
    graph
        .transition(task_id, TaskStatus::Done)
        .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
    // Settlement, not Git merge, owns the trusted Done transition. Re-run the
    // existing dependency gate in the same staged snapshot so downstream Tasks
    // become Ready atomically with the completion packet.
    Ok(graph.recompute_ready())
}

pub(super) fn observe_cockpit_settlement_git(
    activation: &MissionPlanActivation,
    evidence: &MissionGateEvidence,
) -> SettlementGitObservation {
    let candidate = crate::git::inspect_integrated_owned_candidate_at_oids(
        &activation.repository_root,
        &activation.source_branch,
        &activation.target_branch,
        &activation.owned_targets,
        &evidence.base_oid,
        &evidence.tested_oid,
    )
    .and_then(|snapshot| {
        let diff = crate::git::diff_between_oids(
            &activation.repository_root,
            &evidence.base_oid,
            &evidence.tested_oid,
            1_048_576,
        )?;
        Ok((snapshot, diff))
    });
    match candidate {
        Ok((snapshot, diff)) => SettlementGitObservation {
            candidate_oid: Some(snapshot.source_oid),
            target_oid: Some(snapshot.target_oid),
            changed_paths: snapshot.changed_paths,
            owned_diff_digest: Some(format!("{:x}", Sha256::digest(diff.as_bytes()))),
            candidate_state: "exact-owned-clean".into(),
            target_state: "resolved".into(),
        },
        Err(error) => SettlementGitObservation {
            candidate_oid: None,
            target_oid: crate::git::resolve_branch_oid(
                &activation.repository_root,
                &activation.target_branch,
            )
            .ok(),
            changed_paths: Vec::new(),
            owned_diff_digest: None,
            candidate_state: match error.as_str() {
                "integrated candidate source or target OID moved after merge receipt" => {
                    "source-ref-drift"
                }
                "candidate worktree is dirty" => "worktree-dirty",
                "integrated candidate worktree branch/OID binding changed" => {
                    "worktree-binding-drift"
                }
                _ => "candidate-unavailable",
            }
            .into(),
            target_state: "unavailable".into(),
        },
    }
}
