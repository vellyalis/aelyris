/// Typed errors for PTY operations
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("PTY spawn failed: {0}")]
    SpawnFailed(String),

    #[error("Terminal {0} not found")]
    NotFound(String),

    #[error("Lock poisoned")]
    LockPoisoned,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("PTY error: {0}")]
    Other(String),
}

// Tauri commands need String errors; provide easy conversion
impl From<PtyError> for String {
    fn from(e: PtyError) -> Self {
        e.to_string()
    }
}
