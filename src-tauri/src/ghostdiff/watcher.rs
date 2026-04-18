//! Per-layer filesystem watcher.
//!
//! The pool owns one `notify-debouncer-mini` instance per registered layer.
//! When the worktree's files change, a 300ms-debounced event fires and the
//! pool invokes the caller's `on_change(layer_id)` callback. The callback
//! is expected to call `diff_engine::compute_diff` + `LayerRegistry::refresh`.
//!
//! 300ms was picked because a single `claude -p` run typically writes
//! several files in quick succession; the existing project watcher uses
//! 100ms, but ghost-diff pays a heavier per-tick cost (spawning git diff)
//! so a slightly longer window keeps churn tolerable.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};

use super::layer::LayerId;

const DEBOUNCE_MS: u64 = 300;

/// Callback invoked with the layer id whenever its worktree changes.
pub type OnChange = std::sync::Arc<dyn Fn(&str) + Send + Sync + 'static>;

/// One live watcher. Drop to stop watching.
struct WatcherHandle {
    _debouncer: Debouncer<notify::RecommendedWatcher>,
}

/// Pool of per-layer watchers.
pub struct WatcherPool {
    handles: Mutex<HashMap<LayerId, WatcherHandle>>,
}

impl WatcherPool {
    pub fn new() -> Self {
        Self {
            handles: Mutex::new(HashMap::new()),
        }
    }

    /// Start watching `worktree_path`. Fires `on_change(layer_id)` on every
    /// debounced event. Replaces any existing watcher for the same id.
    pub fn watch(
        &self,
        id: LayerId,
        worktree_path: PathBuf,
        on_change: OnChange,
    ) -> Result<(), String> {
        if !worktree_path.exists() {
            return Err(format!(
                "watch target does not exist: {}",
                worktree_path.display()
            ));
        }

        let (tx, rx) = mpsc::channel();
        let mut debouncer = new_debouncer(Duration::from_millis(DEBOUNCE_MS), tx)
            .map_err(|e| format!("new_debouncer failed: {e}"))?;
        debouncer
            .watcher()
            .watch(&worktree_path, RecursiveMode::Recursive)
            .map_err(|e| format!("watch failed: {e}"))?;

        let id_for_thread = id.clone();
        thread::Builder::new()
            .name(format!("ghostdiff-watch-{id}"))
            .spawn(move || {
                while let Ok(result) = rx.recv() {
                    let Ok(events) = result else { continue };
                    // Ignore events buried inside `.git/objects/` and
                    // `node_modules/` — they fire constantly and never
                    // reflect a user-visible change.
                    let relevant = events.iter().any(|e| {
                        e.kind == DebouncedEventKind::Any
                            && !is_noise(&e.path)
                    });
                    if relevant {
                        on_change(&id_for_thread);
                    }
                }
            })
            .map_err(|e| format!("spawn watcher thread: {e}"))?;

        let mut guard = self
            .handles
            .lock()
            .map_err(|_| "watcher pool poisoned".to_string())?;
        guard.insert(
            id,
            WatcherHandle {
                _debouncer: debouncer,
            },
        );
        Ok(())
    }

    /// Stop watching a layer. No-op if unknown.
    pub fn unwatch(&self, id: &str) {
        if let Ok(mut guard) = self.handles.lock() {
            guard.remove(id);
        }
    }

    pub fn len(&self) -> usize {
        self.handles.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for WatcherPool {
    fn default() -> Self {
        Self::new()
    }
}

fn is_noise(path: &std::path::Path) -> bool {
    let s = path.to_string_lossy();
    let norm = s.replace('\\', "/");
    norm.contains("/.git/objects/")
        || norm.contains("/.git/refs/")
        || norm.contains("/.git/logs/")
        || norm.contains("/node_modules/")
        || norm.contains("/target/")
        || norm.contains("/.next/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn is_noise_filters_git_internals() {
        assert!(is_noise(Path::new("/tmp/repo/.git/objects/ab/cd")));
        assert!(is_noise(Path::new("/tmp/repo/.git/refs/heads/main")));
        assert!(is_noise(Path::new("/tmp/repo/.git/logs/HEAD")));
    }

    #[test]
    fn is_noise_filters_build_output() {
        assert!(is_noise(Path::new("/tmp/repo/node_modules/foo/index.js")));
        assert!(is_noise(Path::new("/tmp/repo/target/debug/foo.rlib")));
        assert!(is_noise(Path::new("/tmp/repo/.next/static/chunks/a.js")));
    }

    #[test]
    fn is_noise_allows_regular_source() {
        assert!(!is_noise(Path::new("/tmp/repo/src/foo.ts")));
        assert!(!is_noise(Path::new("/tmp/repo/README.md")));
    }

    #[test]
    fn is_noise_handles_windows_separators() {
        assert!(is_noise(Path::new("C:\\tmp\\repo\\.git\\objects\\ab\\cd")));
        assert!(is_noise(Path::new("C:\\tmp\\repo\\node_modules\\foo")));
    }

    #[test]
    fn pool_starts_empty_and_tracks_len() {
        let pool = WatcherPool::new();
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
    }

    #[test]
    fn watch_missing_path_errors() {
        let pool = WatcherPool::new();
        let err = pool
            .watch(
                "j1".into(),
                PathBuf::from("/definitely/does/not/exist/xyz"),
                std::sync::Arc::new(|_id| {}),
            )
            .unwrap_err();
        assert!(err.contains("does not exist"), "got: {err}");
    }

    #[test]
    fn unwatch_unknown_is_noop() {
        let pool = WatcherPool::new();
        pool.unwatch("nope"); // should not panic
    }

    #[test]
    fn watch_and_unwatch_updates_len() {
        let tmp = tempfile::tempdir().unwrap();
        let pool = WatcherPool::new();
        pool.watch(
            "j1".into(),
            tmp.path().to_path_buf(),
            std::sync::Arc::new(|_id| {}),
        )
        .unwrap();
        assert_eq!(pool.len(), 1);
        pool.unwatch("j1");
        assert_eq!(pool.len(), 0);
    }
}
