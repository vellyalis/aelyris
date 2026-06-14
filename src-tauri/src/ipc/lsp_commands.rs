//! Language Server Protocol command handlers.
//!
//! Thin wrappers over the `crate::lsp::LspManager` Tauri state: start and
//! stop language servers, forward JSON-RPC. Extracted from `commands.rs`
//! during the IPC god-file split.

use tauri::{AppHandle, Manager};

/// Start a language server for a file's language
#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
) -> Result<crate::lsp::LspServerInfo, String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.start(language, &root_path)
}

/// Send a JSON-RPC request to a running language server
#[tauri::command]
pub fn lsp_request(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
    json_rpc: String,
) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.send(&language, &root_path, &json_rpc)
}

/// Stop a language server
#[tauri::command]
pub fn lsp_stop(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.stop(&language, &root_path)
}

/// List running language servers
#[tauri::command]
pub fn lsp_list(app: AppHandle) -> Vec<crate::lsp::LspServerInfo> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.list()
}
