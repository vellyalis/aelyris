//! Cockpit packet coverage builders inside the Mission domain.
//!
//! These helpers are pure: they own no graph, database, merge, or settlement
//! state. They validate that per-Task review evidence covers exactly the clauses
//! accepted by its WorkUnit, and that the final Mission packet aggregates every
//! clause exactly once.

use super::*;

pub(crate) fn cockpit_settlement_coverage(
    preview: &MissionPlanPreview,
    activation: &MissionPlanActivation,
    evidence: &MissionGateEvidence,
    review: &crate::review::MissionReviewRecord,
) -> Result<Vec<AcceptanceCoverageEntry>, MissionPlanError> {
    let work = preview
        .work_units
        .iter()
        .find(|work| work.work_unit_id == activation.work_unit_id)
        .ok_or_else(|| {
            MissionPlanError::Validation(
                "cockpit activation lacks its accepted WorkUnit definition".into(),
            )
        })?;
    let clause_ids = work
        .capability_unlock
        .condition_clause_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let review_by_id = review
        .clause_coverage
        .iter()
        .map(|entry| (entry.clause_id.as_str(), entry.accepted))
        .collect::<HashMap<_, _>>();
    let coverage = preview
        .mission_definition
        .acceptance
        .iter()
        .filter(|clause| clause_ids.contains(clause.clause_id.as_str()))
        .map(|clause| AcceptanceCoverageEntry {
            clause_id: clause.clause_id.clone(),
            required_gate_ids: clause.required_gate_ids.clone(),
            evidence_ids: vec![evidence.evidence_id.clone()],
            accepted: evidence.result == "passed"
                && clause.required_gate_ids == [evidence.gate_id.clone()]
                && review_by_id.get(clause.clause_id.as_str()) == Some(&true),
        })
        .collect::<Vec<_>>();
    if coverage.is_empty()
        || coverage.len() != clause_ids.len()
        || coverage.iter().any(|entry| !entry.accepted)
        || review.clause_coverage.len() != coverage.len()
    {
        return Err(MissionPlanError::Validation(
            "cockpit Task lacks exact gate/review coverage for its accepted clauses".into(),
        ));
    }
    Ok(coverage)
}

pub(crate) fn aggregate_cockpit_coverage(
    preview: &MissionPlanPreview,
    packets: &[CompletedWorkPacket],
) -> Result<Vec<AcceptanceCoverageEntry>, MissionPlanError> {
    let by_clause = packets
        .iter()
        .flat_map(|packet| packet.acceptance_coverage.iter())
        .map(|entry| (entry.clause_id.as_str(), entry))
        .collect::<HashMap<_, _>>();
    if by_clause.len()
        != packets
            .iter()
            .map(|packet| packet.acceptance_coverage.len())
            .sum::<usize>()
    {
        return Err(MissionPlanError::Validation(
            "cockpit work packets duplicate acceptance coverage".into(),
        ));
    }
    let aggregate = preview
        .mission_definition
        .acceptance
        .iter()
        .map(|clause| {
            by_clause
                .get(clause.clause_id.as_str())
                .cloned()
                .cloned()
                .ok_or_else(|| {
                    MissionPlanError::Validation(format!(
                        "cockpit Mission completion lacks clause {}",
                        clause.clause_id
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if aggregate.len() != by_clause.len() || aggregate.iter().any(|entry| !entry.accepted) {
        return Err(MissionPlanError::Validation(
            "cockpit Mission aggregate coverage is incomplete".into(),
        ));
    }
    Ok(aggregate)
}
