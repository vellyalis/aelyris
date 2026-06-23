//! Durable merge intent (P0-3) — the immutable, persisted record of an
//! operator-approved merge. See `docs/specs/P0-3_DURABLE_MERGE_INTENT_PLAN.md`.
//!
//! The merge-defining fields (`repo_path`, `source_branch`, `target_branch`,
//! `source_oid`, `target_oid`, `task_id`, `intent_id`, `created_at`) are captured
//! at REQUEST time and are immutable thereafter — enforced both here (no setters)
//! and at the SQLite layer (an `UPDATE` trigger). Only `state`/`updated_at` and
//! late metadata (`reviewer_id`, `gates_digest`) change after creation. This is
//! what lets `aether.review.approve` take only an `intentId`: the merge target can
//! never be re-pointed by a caller (the P0-3 security property).
//!
//! The SQLite row is the source of truth; an in-memory copy is a read cache only.
//! The state transition that claims a merge is a conditional `UPDATE` (compare-and
//! -swap), never an in-memory mutation — so it survives restarts and serializes
//! across callers.

pub mod store;

use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// The lifecycle of a durable merge intent (audit §P0-3). `queued`/`reviewing`/
/// `ready_to_merge` are open; `merging` is the in-flight CAS-claimed state;
/// `merged`/`rejected` are clean terminals; `conflict`/`cleanup_failed`/
/// `needs_reconcile` are settled-but-need-attention outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeIntentState {
    Queued,
    Reviewing,
    ReadyToMerge,
    Merging,
    Merged,
    Conflict,
    Rejected,
    CleanupFailed,
    NeedsReconcile,
}

impl MergeIntentState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Reviewing => "reviewing",
            Self::ReadyToMerge => "ready_to_merge",
            Self::Merging => "merging",
            Self::Merged => "merged",
            Self::Conflict => "conflict",
            Self::Rejected => "rejected",
            Self::CleanupFailed => "cleanup_failed",
            Self::NeedsReconcile => "needs_reconcile",
        }
    }

    /// A clean, closed outcome — no further automatic transition is expected.
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Merged | Self::Rejected)
    }

    /// States from which a merge may be CAS-claimed into `merging`.
    pub const fn is_claimable(self) -> bool {
        matches!(self, Self::Queued | Self::ReadyToMerge)
    }

    /// Still being driven toward a merge (not yet a final/attention outcome).
    pub const fn is_open(self) -> bool {
        matches!(
            self,
            Self::Queued | Self::Reviewing | Self::ReadyToMerge | Self::Merging
        )
    }
}

impl FromStr for MergeIntentState {
    type Err = String;

    /// Parse a persisted state (inverse of `as_str`, round-trip tested).
    fn from_str(value: &str) -> Result<Self, String> {
        Ok(match value {
            "queued" => Self::Queued,
            "reviewing" => Self::Reviewing,
            "ready_to_merge" => Self::ReadyToMerge,
            "merging" => Self::Merging,
            "merged" => Self::Merged,
            "conflict" => Self::Conflict,
            "rejected" => Self::Rejected,
            "cleanup_failed" => Self::CleanupFailed,
            "needs_reconcile" => Self::NeedsReconcile,
            other => return Err(format!("unknown merge intent state: {other}")),
        })
    }
}

/// A durable merge intent. Immutable merge-defining fields + mutable state/metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeIntent {
    // ── Immutable, captured at request time (trigger-protected in SQLite) ──
    pub intent_id: String,
    /// Canonicalized absolute repo path (canonicalization happens at request).
    pub repo_path: String,
    pub source_branch: String,
    pub target_branch: String,
    /// Branch-tip OIDs at request time — the merge is bound to these commits.
    pub source_oid: String,
    pub target_oid: String,
    pub merge_base_oid: Option<String>,
    /// Task Graph node this merge belongs to — part of the idempotency key.
    pub task_id: String,
    pub created_at: i64,

    // ── Mutable: lifecycle + late-bound metadata ──
    pub state: MergeIntentState,
    pub updated_at: i64,
    /// Who requested the merge (author/session metadata — NOT a merge param).
    pub session_id: Option<String>,
    /// Who approved it (bound at approve time, operator authority).
    pub reviewer_id: Option<String>,
    /// Approval evidence digest (gates that were green at approval).
    pub gates_digest: Option<String>,
}

impl MergeIntent {
    /// The idempotency key (audit §P0-3): two requests for the same task to merge
    /// the same source commit into the same target commit are the SAME intent.
    pub fn idempotency_key(&self) -> (&str, &str, &str) {
        (
            self.task_id.as_str(),
            self.source_oid.as_str(),
            self.target_oid.as_str(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_as_str_from_str_round_trips_all_variants() {
        let all = [
            MergeIntentState::Queued,
            MergeIntentState::Reviewing,
            MergeIntentState::ReadyToMerge,
            MergeIntentState::Merging,
            MergeIntentState::Merged,
            MergeIntentState::Conflict,
            MergeIntentState::Rejected,
            MergeIntentState::CleanupFailed,
            MergeIntentState::NeedsReconcile,
        ];
        for s in all {
            assert_eq!(MergeIntentState::from_str(s.as_str()).unwrap(), s);
            // serde agrees with as_str.
            assert_eq!(serde_json::to_value(s).unwrap().as_str(), Some(s.as_str()));
        }
        assert!(MergeIntentState::from_str("bogus").is_err());
    }

    #[test]
    fn state_predicates_partition_as_expected() {
        assert!(MergeIntentState::Merged.is_terminal());
        assert!(MergeIntentState::Rejected.is_terminal());
        assert!(!MergeIntentState::Conflict.is_terminal());
        assert!(MergeIntentState::Queued.is_claimable());
        assert!(MergeIntentState::ReadyToMerge.is_claimable());
        assert!(!MergeIntentState::Merging.is_claimable());
        assert!(MergeIntentState::Merging.is_open());
        assert!(!MergeIntentState::Merged.is_open());
    }
}
