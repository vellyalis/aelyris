pub mod buffer;
pub mod error;
mod manager;
pub mod registry;
pub mod scrollback;
mod shell;

pub use error::PtyError;
pub use manager::{ExitInfo, PtyManager, TerminalInfo};
pub use registry::PaneRegistry;
pub use scrollback::{FilePtyScrollbackStore, PtyScrollbackSearchMatch};
pub use shell::ShellType;
