//! Intent Bus — the pre-fact coordination layer (the Event Bus' upstream half).
//!
//! Where the Event Bus carries facts after they happen (`auth_done`,
//! `file_locked`), the Intent Bus carries *proposals before they happen*
//! ("switch auth_method to JWT", "extract AuthService"). Sharing intent before
//! acting lets peers react — align, object, defer, supersede — so conflicts and
//! design disagreements surface in discussion rather than at merge time. This is
//! the substrate for agents holding the same world-model and for "meetings":
//! parallel proposal + convergence rather than serial discovery.

pub mod manager;

pub use manager::IntentBus;

use serde::{Deserialize, Serialize};

/// Where a proposed change stands in the fleet's deliberation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntentStatus {
    /// Proposed, awaiting reaction.
    Open,
    /// Accepted — the agent may proceed (typically recorded as an ADR after).
    Accepted,
    /// Rejected — the agent should not proceed.
    Rejected,
    /// Replaced by a newer intent.
    Superseded,
}

impl IntentStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Accepted => "accepted",
            Self::Rejected => "rejected",
            Self::Superseded => "superseded",
        }
    }
}

/// A proposed change an agent intends to make, shared before acting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intent {
    pub id: String,
    pub agent_id: String,
    /// The proposal in plain language.
    pub proposal: String,
    /// Optional file/domain targets the intent touches, for conflict hints.
    #[serde(default)]
    pub targets: Vec<String>,
    pub status: IntentStatus,
    pub created_at: u64,
}
