//! Durable A7 Mission review facts. Review owns the append-only reviewer
//! invocation receipt and review record. Every insert/load reconstructs trust
//! from the exact DB receipt, gate evidence, activation, Task, and execution
//! attempt rather than accepting caller-authored identity claims.

use rusqlite::{params, OptionalExtension};

use crate::db::Database;
use crate::review::{
    MissionReviewRecord, MissionReviewVerdict, ReviewerInvocationReceipt, VersionedRef,
};

pub struct ReviewRepo;

impl ReviewRepo {
    pub fn insert_reviewer_invocation_receipt(
        db: &Database,
        receipt: &ReviewerInvocationReceipt,
    ) -> Result<ReviewerInvocationReceipt, String> {
        receipt.validate()?;
        let started = i64::try_from(receipt.started_at_unix_ms())
            .map_err(|_| "reviewer receipt start exceeds SQLite i64".to_string())?;
        let ended = i64::try_from(receipt.ended_at_unix_ms())
            .map_err(|_| "reviewer receipt end exceeds SQLite i64".to_string())?;
        let lineage = serde_json::to_string(receipt.lineage_ref())
            .map_err(|error| format!("encode reviewer receipt lineage: {error}"))?;
        let ancestors = serde_json::to_string(receipt.ancestor_lineage_ids())
            .map_err(|error| format!("encode reviewer receipt ancestors: {error}"))?;
        db.conn()
            .execute(
                "INSERT INTO mission_reviewer_invocation_receipts (
                    receipt_id,invocation_id,schema_id,provider,model,adapter_version,
                    runtime_domain_id,command_fingerprint,argv_contract_digest,
                    canonical_response_json,response_digest,started_at_ms,ended_at_ms,
                    exit_code,process_status,lineage_ref,principal_id,logical_session_id,
                    ancestor_lineage_ids_json,receipt_digest
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
                params![
                    receipt.receipt_id(),
                    receipt.invocation_id(),
                    crate::review::mission::REVIEWER_INVOCATION_RECEIPT_SCHEMA,
                    receipt.provider(),
                    receipt.model(),
                    receipt.adapter_version(),
                    receipt.runtime_domain_id(),
                    receipt.command_fingerprint(),
                    receipt.argv_contract_digest(),
                    receipt.canonical_response_json(),
                    receipt.response_digest(),
                    started,
                    ended,
                    receipt.exit_code(),
                    receipt.status(),
                    lineage,
                    receipt.principal_id(),
                    receipt.logical_session_id(),
                    ancestors,
                    receipt.receipt_digest(),
                ],
            )
            .map_err(|error| format!("insert reviewer invocation receipt: {error}"))?;
        Ok(receipt.clone())
    }

    pub fn reviewer_invocation_receipt_by_id(
        db: &Database,
        receipt_id: &str,
    ) -> Result<Option<ReviewerInvocationReceipt>, String> {
        let row = db
            .conn()
            .query_row(
                "SELECT schema_id,invocation_id,provider,model,adapter_version,runtime_domain_id,
                        command_fingerprint,argv_contract_digest,canonical_response_json,
                        response_digest,started_at_ms,ended_at_ms,exit_code,process_status,
                        lineage_ref,principal_id,logical_session_id,ancestor_lineage_ids_json,
                        receipt_digest
                   FROM mission_reviewer_invocation_receipts WHERE receipt_id=?1",
                [receipt_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, i64>(10)?,
                        row.get::<_, i64>(11)?,
                        row.get::<_, i32>(12)?,
                        row.get::<_, String>(13)?,
                        row.get::<_, String>(14)?,
                        row.get::<_, String>(15)?,
                        row.get::<_, String>(16)?,
                        row.get::<_, String>(17)?,
                        row.get::<_, String>(18)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("load reviewer invocation receipt: {error}"))?;
        row.map(|row| {
            ReviewerInvocationReceipt::from_durable_row(
                row.0,
                receipt_id.to_string(),
                row.1,
                row.2,
                row.3,
                row.4,
                row.5,
                row.6,
                row.7,
                row.8,
                row.9,
                u64::try_from(row.10).map_err(|_| "negative reviewer receipt start".to_string())?,
                u64::try_from(row.11).map_err(|_| "negative reviewer receipt end".to_string())?,
                row.12,
                row.13,
                serde_json::from_str(&row.14)
                    .map_err(|error| format!("decode reviewer receipt lineage: {error}"))?,
                row.15,
                row.16,
                serde_json::from_str(&row.17)
                    .map_err(|error| format!("decode reviewer receipt ancestors: {error}"))?,
                row.18,
            )
        })
        .transpose()
    }

    pub fn insert_mission_review(
        db: &Database,
        record: &MissionReviewRecord,
    ) -> Result<MissionReviewRecord, String> {
        validate_against_authoritative_db(db, record)?;
        let revision = i64::try_from(record.mission_revision)
            .map_err(|_| "mission review revision exceeds SQLite i64".to_string())?;
        let created_at = i64::try_from(record.created_at_unix_ms)
            .map_err(|_| "mission review time exceeds SQLite i64".to_string())?;
        let coverage = serde_json::to_string(&record.clause_coverage)
            .map_err(|error| format!("encode clause coverage: {error}"))?;
        let findings = serde_json::to_string(&record.findings)
            .map_err(|error| format!("encode review findings: {error}"))?;
        let proof = &record.reviewer_independence;
        let reviewer_lineage = serde_json::to_string(&proof.reviewer_lineage_ref)
            .map_err(|error| format!("encode reviewer lineage ref: {error}"))?;
        let builder_lineage = serde_json::to_string(&proof.builder_lineage_ref)
            .map_err(|error| format!("encode builder lineage ref: {error}"))?;
        let receipt_ref = serde_json::to_string(&record.reviewer_invocation_receipt_ref)
            .map_err(|error| format!("encode reviewer receipt ref: {error}"))?;
        let independence = serde_json::to_string(proof)
            .map_err(|error| format!("encode reviewer independence: {error}"))?;
        db.conn()
            .execute(
                "INSERT INTO mission_review_records (
                    review_id,activation_id,mission_id,mission_revision,work_unit_id,
                    plan_content_digest,tested_evidence_id,reviewed_oid,
                    reviewer_invocation_receipt_id,reviewer_invocation_receipt_ref,
                    reviewer_principal_id,builder_principal_id,reviewer_logical_session_id,
                    builder_logical_session_id,reviewer_lineage_ref,builder_lineage_ref,independence_json,
                    independence_digest,independence_eligible,verdict,clause_coverage_json,
                    findings_json,next_action,review_digest,created_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
                params![
                    record.review_id, record.activation_id, record.mission_id, revision,
                    record.work_unit_id, record.plan_content_digest, record.tested_evidence_id,
                    record.reviewed_oid, record.reviewer_invocation_receipt_ref.id, receipt_ref,
                    proof.reviewer_principal_id, proof.builder_principal_id,
                    proof.reviewer_logical_session_id, proof.builder_logical_session_id,
                    reviewer_lineage, builder_lineage, independence, proof.digest,
                    i64::from(proof.eligible), record.verdict.as_str(), coverage, findings,
                    record.next_action, record.review_digest, created_at,
                ],
            )
            .map_err(|error| format!("insert Mission review record: {error}"))?;
        Ok(record.clone())
    }

    pub fn latest_for_activation(
        db: &Database,
        activation_id: &str,
    ) -> Result<Option<MissionReviewRecord>, String> {
        let review_id = db
            .conn()
            .query_row(
                "SELECT review_id FROM mission_review_records WHERE activation_id=?1
                 ORDER BY created_at_ms DESC, review_id DESC LIMIT 1",
                [activation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("load latest Mission review id: {error}"))?;
        review_id
            .map(|review_id| Self::mission_review_by_id(db, &review_id))
            .transpose()
            .map(Option::flatten)
    }

    pub fn mission_review_by_id(
        db: &Database,
        review_id: &str,
    ) -> Result<Option<MissionReviewRecord>, String> {
        let row = db
            .conn()
            .query_row(
                "SELECT activation_id,mission_id,mission_revision,work_unit_id,plan_content_digest,
                    tested_evidence_id,reviewed_oid,reviewer_invocation_receipt_ref,
                    independence_json,verdict,clause_coverage_json,findings_json,next_action,
                    review_digest,created_at_ms
               FROM mission_review_records WHERE review_id=?1",
                [review_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?,
                        row.get::<_, String>(13)?,
                        row.get::<_, i64>(14)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("load Mission review record by id: {error}"))?;
        row.map(|row| {
            let verdict = match row.9.as_str() {
                "accepted_exact_oid" => MissionReviewVerdict::AcceptedExactOid,
                "changes_requested" => MissionReviewVerdict::ChangesRequested,
                "blocked" => MissionReviewVerdict::Blocked,
                other => return Err(format!("unknown Mission review verdict: {other}")),
            };
            let record = MissionReviewRecord {
                schema: crate::review::mission::MISSION_REVIEW_SCHEMA.to_string(),
                review_id: review_id.to_string(),
                activation_id: row.0,
                mission_id: row.1,
                mission_revision: u64::try_from(row.2)
                    .map_err(|_| "negative mission revision".to_string())?,
                work_unit_id: row.3,
                plan_content_digest: row.4,
                tested_evidence_id: row.5,
                reviewed_oid: row.6,
                reviewer_invocation_receipt_ref: serde_json::from_str(&row.7)
                    .map_err(|error| format!("decode reviewer receipt ref: {error}"))?,
                reviewer_independence: serde_json::from_str(&row.8)
                    .map_err(|error| format!("decode reviewer independence: {error}"))?,
                verdict,
                clause_coverage: serde_json::from_str(&row.10)
                    .map_err(|error| format!("decode clause coverage: {error}"))?,
                findings: serde_json::from_str(&row.11)
                    .map_err(|error| format!("decode review findings: {error}"))?,
                next_action: row.12,
                review_digest: row.13,
                created_at_unix_ms: u64::try_from(row.14)
                    .map_err(|_| "negative review time".to_string())?,
            };
            let scalar = db.conn().query_row(
                "SELECT reviewer_invocation_receipt_id,reviewer_principal_id,builder_principal_id,
                        reviewer_logical_session_id,builder_logical_session_id,reviewer_lineage_ref,
                        builder_lineage_ref,independence_digest,independence_eligible
                   FROM mission_review_records WHERE review_id=?1",
                [review_id],
                |row| Ok((
                    row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, i64>(8)?,
                )),
            ).map_err(|error| format!("load Mission review scalar bindings: {error}"))?;
            let proof = &record.reviewer_independence;
            let reviewer_lineage: VersionedRef = serde_json::from_str(&scalar.5)
                .map_err(|error| format!("decode reviewer lineage ref: {error}"))?;
            let builder_lineage: VersionedRef = serde_json::from_str(&scalar.6)
                .map_err(|error| format!("decode builder lineage ref: {error}"))?;
            if scalar.0 != record.reviewer_invocation_receipt_ref.id
                || scalar.1 != proof.reviewer_principal_id
                || scalar.2 != proof.builder_principal_id
                || scalar.3 != proof.reviewer_logical_session_id
                || scalar.4 != proof.builder_logical_session_id
                || reviewer_lineage != proof.reviewer_lineage_ref
                || builder_lineage != proof.builder_lineage_ref
                || scalar.7 != proof.digest
                || scalar.8 != i64::from(proof.eligible)
            {
                return Err("stored reviewer independence JSON/scalar columns disagree".to_string());
            }
            validate_against_authoritative_db(db, &record)?;
            Ok(record)
        })
        .transpose()
    }
}

fn validate_against_authoritative_db(
    db: &Database,
    record: &MissionReviewRecord,
) -> Result<(), String> {
    crate::review::mission::validate_mission_review_record(record)?;
    let receipt = ReviewRepo::reviewer_invocation_receipt_by_id(
        db,
        &record.reviewer_invocation_receipt_ref.id,
    )?
    .ok_or_else(|| "Mission review has no exact durable reviewer invocation receipt".to_string())?;
    if receipt.receipt_ref() != record.reviewer_invocation_receipt_ref
        || receipt.invocation_id() != record.reviewer_independence.reviewer_invocation_id
        || record.created_at_unix_ms < receipt.ended_at_unix_ms()
    {
        return Err("Mission review receipt binding or ordering disagrees".to_string());
    }
    let evidence = crate::persistence::TaskRepo::load_mission_gate_evidence_by_id(
        db,
        &record.tested_evidence_id,
    )
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "Mission review lacks exact gate evidence".to_string())?;
    let authority = db.conn().query_row(
        "SELECT activation.mission_id,activation.mission_revision,activation.work_unit_id,
                activation.plan_content_digest,task.model,attempt.attempt_id,
                attempt.execution_generation,attempt.agent_run_id,attempt.runtime,attempt.pty_session_id
           FROM mission_plan_activations AS activation
           JOIN tasks AS task ON task.id=activation.task_id
           JOIN work_execution_attempts AS attempt ON attempt.task_id=activation.task_id
          WHERE activation.activation_id=?1 AND attempt.attempt_id=?2",
        params![record.activation_id, evidence.attempt_id],
        |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?, row.get::<_, String>(5)?,
            row.get::<_, i64>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?,
            row.get::<_, Option<String>>(9)?,
        )),
    ).optional().map_err(|error| format!("load authoritative review context: {error}"))?
        .ok_or_else(|| "Mission review lacks exact activation/task/attempt authority".to_string())?;
    if authority.0 != record.mission_id
        || u64::try_from(authority.1).ok() != Some(record.mission_revision)
        || authority.2 != record.work_unit_id
        || authority.3 != record.plan_content_digest
        || evidence.activation_id != record.activation_id
        || evidence.plan_content_digest != record.plan_content_digest
        || evidence.tested_oid != record.reviewed_oid
        || evidence.result != "passed"
        || authority.5 != evidence.attempt_id
        || u64::try_from(authority.6).ok() != Some(evidence.execution_generation)
        || authority.7 != evidence.agent_run_id
        || authority.8 != evidence.runtime_domain_id
        || authority.9.as_deref() != Some(evidence.pty_session_id.as_str())
    {
        return Err(
            "Mission review authoritative activation/task/evidence binding disagrees".to_string(),
        );
    }
    let builder_adapter = authority.4.as_deref().ok_or_else(|| {
        "Mission builder adapter fact is missing from the authoritative Task".to_string()
    })?;
    let builder = crate::review::mission::builder_runtime_attestation_for_policy(
        &evidence,
        builder_adapter,
        &record.reviewer_independence.policy_version,
    )?;
    let reviewer = receipt.runtime_attestation();
    let expected = crate::review::mission::compute_independence_with_policy(
        &evidence,
        &reviewer,
        &builder,
        record.reviewer_independence.different_provider_required,
        &record.review_id,
        &record.reviewer_independence.policy_version,
    )?;
    if expected != record.reviewer_independence {
        return Err(
            "Mission review independence proof is not canonical DB-derived truth".to_string(),
        );
    }
    let (coverage, findings) = crate::review::mission::receipt_response_projection(&receipt)?;
    if coverage != record.clause_coverage || findings != record.findings {
        return Err(
            "Mission review projection differs from the durable reviewer response".to_string(),
        );
    }
    crate::review::mission::validate_mission_review_record(record)
}
