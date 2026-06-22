//! Task Graph subsystem.
//!
//! The canonical orchestration model for the autonomous build loop: every unit
//! of work is a `Task` with a lifecycle and explicit dependencies, so the
//! Planner can fan work out and the loop can gate `Ready` on completed deps.
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 4. This is distinct from the UI kanban board
//! (`src/shared/types/kanban.ts`), which is a presentation projection.

pub mod decompose;
pub mod graph;
pub mod manager;
pub mod planner;
pub mod replan;
pub mod status;

pub use decompose::decompose_to_plan;
pub use graph::{Task, TaskGraph, TaskGraphError, TaskPriority};
pub use manager::TaskManager;
pub use planner::validate_plan;
pub use replan::{replan_into, ReplanOutcome};
pub use status::{TaskStatus, TASK_STATUS_NAMES};
