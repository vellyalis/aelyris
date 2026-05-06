use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Start watching a directory for file changes.
/// Emits "fs:changed" events to the frontend with a 100ms debounce.
/// Returns a handle that stops the watcher when dropped.
pub fn start_watcher(app: AppHandle, watch_path: String) -> Result<WatcherHandle, String> {
    let (tx, rx) = mpsc::channel();

    let mut debouncer = new_debouncer(Duration::from_millis(100), tx)
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    debouncer
        .watcher()
        .watch(Path::new(&watch_path), notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    let path_clone = watch_path.clone();

    // Spawn a thread to receive debounced events and emit to frontend
    std::thread::spawn(move || {
        while let Ok(result) = rx.recv() {
            match result {
                Ok(events) => {
                    let changed_paths: Vec<String> = events
                        .iter()
                        .filter(|e| e.kind == DebouncedEventKind::Any)
                        .map(|e| e.path.to_string_lossy().to_string().replace('\\', "/"))
                        .filter(|p| !p.contains("/.git/objects/") && !p.contains("/node_modules/"))
                        .collect();

                    if !changed_paths.is_empty() {
                        let _ = app.emit(
                            "fs:changed",
                            serde_json::json!({
                                "root": path_clone,
                                "paths": changed_paths,
                            }),
                        );
                    }
                }
                Err(e) => {
                    log::warn!("File watcher error: {:?}", e);
                }
            }
        }
    });

    Ok(WatcherHandle {
        _debouncer: debouncer,
    })
}

/// Handle that keeps the watcher alive. Drop to stop watching.
pub struct WatcherHandle {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}
