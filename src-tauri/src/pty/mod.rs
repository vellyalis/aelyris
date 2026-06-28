pub mod buffer;
pub mod error;
mod manager;
pub mod registry;
pub mod scrollback;
mod shell;

pub use error::PtyError;
pub use manager::{ExitInfo, PtyManager, PtyRuntimeIdentity, TerminalInfo, PTY_SCROLLBACK_DIR_ENV};
pub use registry::PaneRegistry;
pub use scrollback::{FilePtyScrollbackStore, PtyScrollbackSearchMatch};
pub use shell::ShellType;
