//! Native terminal engine (Phase 2).
//!
//! Wraps `alacritty_terminal::Term` so the Rust side owns parsing and grid state.
//! Downstream layers (IPC, diff engine) read from this module instead of piping
//! raw PTY bytes to the frontend.

pub mod diff;
pub mod engine;
pub mod native;
pub mod snapshot;

pub use diff::{DiffTracker, GridDiff, RowDiff, diff_snapshots};
pub use engine::{TermEngine, TermEngineError};
pub use native::NativeTerminalRegistry;
pub use snapshot::{CellSnapshot, CursorShapeSnapshot, CursorSnapshot, GridSnapshot, attr};
