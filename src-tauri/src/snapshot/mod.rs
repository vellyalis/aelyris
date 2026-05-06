//! Time-travel snapshot engine (Phase 3C-3a).
//!
//! Captures point-in-time copies of the alacritty grid per PTY session so the
//! user can scrub back through past terminal screens. MVP scope: in-memory
//! only, bounded ring buffer per session, triggered by user Enter in the PTY
//! write path. See `docs/phase3_plan.md` §3C-3 for the full design.

pub mod store;
pub mod types;

pub use store::{SnapshotStore, DEFAULT_MAX_PER_SESSION};
pub use types::{SnapshotId, SnapshotSummary, SnapshotTrigger, TerminalSnapshot};
