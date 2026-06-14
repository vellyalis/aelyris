//! Filesystem watcher command handlers and registry.
//!
//! `start_fs_watcher` / `stop_fs_watcher` plus the `FsWatcherRegistry`
//! Tauri state tracking active `crate::watcher` handles. Extracted from
//! `commands.rs` during the IPC god-file split.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Start watching a directory for file changes (100ms debounce → "fs:changed" event)
#[tauri::command]
pub fn start_fs_watcher(app: AppHandle, watch_path: String) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.start(app.clone(), watch_path)
}

/// Stop watching a directory
#[tauri::command]
pub fn stop_fs_watcher(watch_path: String, app: AppHandle) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.stop(&watch_path);
    Ok(())
}

/// Registry for active file watchers
#[derive(Default)]
pub struct FsWatcherRegistry {
    watchers: Mutex<HashMap<String, crate::watcher::WatcherHandle>>,
}

impl FsWatcherRegistry {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self, app: AppHandle, path: String) -> Result<(), String> {
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        if watchers.contains_key(&path) {
            return Ok(()); // Already watching
        }
        let handle = crate::watcher::start_watcher(app, path.clone())?;
        watchers.insert(path, handle);
        Ok(())
    }

    pub fn stop(&self, path: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(path); // WatcherHandle drop stops the watcher
        }
    }
}
