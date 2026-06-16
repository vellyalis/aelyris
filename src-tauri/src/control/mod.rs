pub mod agent;
pub mod approval;
pub mod diff;
pub mod gate_runner;
pub mod loop_ports;
pub mod merge;
pub mod pane;
pub mod worktree;

pub type ControlResult<T> = Result<T, String>;
