mod migrations;
pub mod queries;

pub use queries::{Database, AgentSessionRecord};

use std::path::PathBuf;

/// Returns the path to the Aether database file (~/.aether/aether.db)
pub fn db_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".aether").join("aether.db")
}
