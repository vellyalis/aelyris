//! Native terminal engine (Phase 2).
//!
//! Wraps `alacritty_terminal::Term` so the Rust side owns parsing and grid state.
//! Downstream layers (IPC, diff engine) read from this module instead of piping
//! raw PTY bytes to the frontend.

pub mod command_blocks;
pub mod diff;
pub mod engine;
pub mod images;
pub mod native;
pub mod native_input;
pub mod prompt_marks;
pub mod render_frame;
pub mod render_pipeline;
pub mod snapshot;
pub mod text_shaping;

pub use command_blocks::{CommandBlockJournal, CommandBlockRecord};
pub use diff::{diff_snapshots, DiffTracker, GridDiff, RowDiff};
pub use engine::{TermEngine, TermEngineError};
pub use native::NativeTerminalRegistry;
pub use native_input::{
    NativeInputSurfaceRect, NativeTerminalInputHost, NativeTerminalInputStatus,
    NativeTerminalPreedit,
};
pub use prompt_marks::{PromptMark, PromptMarkKind};
pub use render_frame::{
    NativeCellMetrics, NativeCellRect, NativeRenderCell, NativeRenderFrame, NativeRenderFrameDiff,
    NativeRenderFrameError, NativeRenderFrameSummary,
};
pub use render_pipeline::{NativeRenderCommit, NativeRenderPipeline};
pub use snapshot::{
    attr, CellSnapshot, CursorShapeSnapshot, CursorSnapshot, GridSnapshot, HistorySearchMatch,
};
pub use text_shaping::{
    classify_char, system_text_shaping_capability, terminal_text_shaping_policy, CellStyle,
    DirectWriteTextShaper, FontFallbackClass, GlyphCluster, LigaturePolicy, PolicyTextShaper,
    ShapeInput, ShapedRun, SystemTextShapingCapability, TerminalTextShapingPolicy, TextShapeError,
    TextShaper, TextShapingBackend,
};
