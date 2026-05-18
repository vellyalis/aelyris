//! Native terminal engine (Phase 2).
//!
//! Wraps `alacritty_terminal::Term` so the Rust side owns parsing and grid state.
//! Downstream layers (IPC, diff engine) read from this module instead of piping
//! raw PTY bytes to the frontend.

pub mod diff;
pub mod engine;
pub mod images;
pub mod native;
pub mod native_input;
pub mod prompt_marks;
pub mod snapshot;

pub use diff::{diff_snapshots, DiffTracker, GridDiff, RowDiff};
pub use engine::{TermEngine, TermEngineError};
pub use native::NativeTerminalRegistry;
pub use native_input::{NativeInputSurfaceRect, NativeTerminalInputHost, NativeTerminalInputStatus};
pub use prompt_marks::{PromptMark, PromptMarkKind};
pub use snapshot::{
    attr, CellSnapshot, CursorShapeSnapshot, CursorSnapshot, GridSnapshot, HistorySearchMatch,
};
