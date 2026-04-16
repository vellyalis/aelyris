//! File system watcher — auto-refresh sidebar and SCM on file changes.

use std::path::PathBuf;
use std::sync::mpsc;
use notify::{Watcher, RecursiveMode, Event};

/// File change events from the watcher thread.
pub enum FsEvent {
    Changed,
}

/// Start watching a directory for changes. Returns a receiver for events.
pub fn start_watcher(root: PathBuf) -> Option<mpsc::Receiver<FsEvent>> {
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        let (notify_tx, notify_rx) = std::sync::mpsc::channel::<Result<Event, notify::Error>>();

        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = notify_tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("Failed to create file watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
            log::warn!("Failed to watch {}: {}", root.display(), e);
            return;
        }
        log::info!("File watcher started for: {}", root.display());

        // Debounce: collect events for 200ms then emit one FsEvent::Changed
        let mut last_event = std::time::Instant::now();
        let debounce = std::time::Duration::from_millis(200);

        loop {
            match notify_rx.recv_timeout(std::time::Duration::from_millis(500)) {
                Ok(Ok(_event)) => {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_event) >= debounce {
                        if tx.send(FsEvent::Changed).is_err() {
                            break; // receiver dropped
                        }
                        last_event = now;
                    }
                }
                Ok(Err(e)) => {
                    log::trace!("Watch error: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Some(rx)
}
