//! Persistence repositories — the write-through bridge between the Agent
//! Runtime Core's in-memory domain state and SQLite (the source of truth).
//!
//! See docs/hardening/02_SPEC.md §2/§5. Each repo takes a `&Database`, owns its
//! own SQL, and exposes `load_*` (startup restore) plus `upsert`/`delete`
//! (write-through on each real change). The domain core (`ContextStore`,
//! `TaskGraph`) stays I/O-free; managers call these repos after mutating memory.

pub mod decision_repo;
pub mod event_repo;
pub mod merge_repo;
pub mod task_repo;

pub use decision_repo::DecisionRepo;
pub use event_repo::EventRepo;
pub use merge_repo::MergeRepo;
pub use task_repo::TaskRepo;
