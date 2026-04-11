use serde::{Deserialize, Serialize};

/// Supported language servers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum LspLanguage {
    Rust,
    Python,
    TypeScript,
    Go,
}

impl LspLanguage {
    /// The command and args to start the language server
    pub fn server_command(&self) -> (&str, Vec<&str>) {
        match self {
            LspLanguage::Rust => ("rust-analyzer", vec![]),
            LspLanguage::Python => ("pyright-langserver", vec!["--stdio"]),
            LspLanguage::TypeScript => ("typescript-language-server", vec!["--stdio"]),
            LspLanguage::Go => ("gopls", vec!["serve"]),
        }
    }

    /// Detect language from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext {
            "rs" => Some(LspLanguage::Rust),
            "py" => Some(LspLanguage::Python),
            "ts" | "tsx" | "js" | "jsx" => Some(LspLanguage::TypeScript),
            "go" => Some(LspLanguage::Go),
            _ => None,
        }
    }
}

/// Info about a running language server
#[derive(Debug, Clone, Serialize)]
pub struct LspServerInfo {
    pub language: LspLanguage,
    pub root_path: String,
    pub pid: u32,
}
