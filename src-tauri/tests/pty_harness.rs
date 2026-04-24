//! PTY Test Harness
//!
//! Utilities for testing PTY spawn, I/O, lifecycle via nested ConPTY.
//! Spawns real shells as child processes and validates stdin/stdout behavior.

use aether_terminal_lib::pty::{PtyManager, ShellType};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Default timeout for PTY output reads
pub const DEFAULT_TIMEOUT_MS: u64 = 5000;

/// Spawn a PTY, send input, collect output until timeout or expected string found.
///
/// Returns the (terminal_id, accumulated_output).
pub fn spawn_and_exec(
    manager: &PtyManager,
    shell: &ShellType,
    input: Option<&str>,
    timeout_ms: u64,
    wait_for: Option<&str>,
) -> Result<(String, String), String> {
    let id = manager.spawn(shell, 120, 30, None)?;

    // Subscribe *before* sending input so the first bytes echoed back by
    // the shell are not dropped (broadcast discards bytes when no receiver
    // is live).
    let mut rx = manager
        .subscribe_output(&id)
        .map_err(|e| format!("subscribe_output: {}", e))?;

    // Small delay to let the shell initialize
    std::thread::sleep(Duration::from_millis(300));

    if let Some(payload) = input {
        manager.write(&id, payload.as_bytes())?;
    }

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {}", e))?;

    let output = rt.block_on(async {
        let mut acc = String::new();
        let start = Instant::now();
        let total = Duration::from_millis(timeout_ms);
        loop {
            let elapsed = start.elapsed();
            if elapsed >= total {
                break;
            }
            let remaining = total - elapsed;
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Ok(chunk)) => {
                    acc.push_str(&String::from_utf8_lossy(&chunk));
                    if let Some(expected) = wait_for {
                        if acc.contains(expected) {
                            break;
                        }
                    }
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(broadcast::error::RecvError::Closed)) => break,
                Err(_) => break, // recv timeout
            }
        }
        acc
    });

    let _ = manager.close(&id);

    Ok((id, output))
}

/// Assert that running a command in a shell produces output containing expected string.
pub fn assert_output_contains(
    manager: &PtyManager,
    shell: &ShellType,
    input: &str,
    expected: &str,
) {
    let result = spawn_and_exec(manager, shell, Some(input), DEFAULT_TIMEOUT_MS, Some(expected));
    match result {
        Ok((_, output)) => {
            assert!(
                output.contains(expected),
                "Expected output to contain '{}', got: '{}'",
                expected,
                truncate_output(&output, 500),
            );
        }
        Err(e) => panic!("PTY execution failed: {}", e),
    }
}

/// Spawn a PTY and verify it's in the active list.
pub fn assert_spawn_succeeds(manager: &PtyManager, shell: &ShellType) -> String {
    let id = manager
        .spawn(shell, 120, 30, None)
        .unwrap_or_else(|e| panic!("Failed to spawn {:?}: {}", shell, e));

    let active = manager.list();
    assert!(
        active.contains(&id),
        "Spawned terminal {} not found in active list: {:?}",
        id,
        active
    );

    id
}

/// Truncate output for display in assertions
fn truncate_output(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...(truncated {} bytes)", &s[..max], s.len() - max)
    }
}

/// Check if a shell is available on this system
pub fn is_shell_available(shell: &ShellType) -> bool {
    let available = ShellType::detect_available();
    available.iter().any(|s| std::mem::discriminant(s) == std::mem::discriminant(shell))
}
