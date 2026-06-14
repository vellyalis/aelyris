//! PTY Test Harness
//!
//! Utilities for testing PTY spawn, I/O, lifecycle via nested ConPTY.
//! Spawns real shells as child processes and validates stdin/stdout behavior.

#![allow(dead_code)]

use aether_terminal_lib::pty::{PtyManager, ShellType};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Default timeout for PTY output reads.
///
/// Real ConPTY shells can be slow to produce the first post-startup bytes on
/// loaded Windows machines, especially when the full Rust and frontend suites
/// are running at the same time.
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;

fn shell_ready(shell: &ShellType, output: &str) -> bool {
    match shell {
        ShellType::PowerShell => {
            output.contains("\x1b]133;A") || output.contains("PS ") || output.contains("PowerShell")
        }
        ShellType::Cmd => output.contains(">"),
        _ => !output.is_empty(),
    }
}

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

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {}", e))?;

    let startup_output = rt.block_on(async {
        let mut acc = String::new();
        let total = match shell {
            ShellType::PowerShell => Duration::from_millis(15_000),
            _ => Duration::from_millis(2_000),
        };
        let start = Instant::now();
        loop {
            if shell_ready(shell, &acc) || start.elapsed() >= total {
                break;
            }
            let remaining = total.saturating_sub(start.elapsed());
            match tokio::time::timeout(remaining.min(Duration::from_millis(500)), rx.recv()).await {
                Ok(Ok(chunk)) => acc.push_str(&String::from_utf8_lossy(&chunk)),
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(broadcast::error::RecvError::Closed)) | Err(_) => break,
            }
        }
        acc
    });

    if let Some(payload) = input {
        manager.write(&id, payload.as_bytes())?;
    }

    let output = rt.block_on(async {
        let mut acc = startup_output;
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
    let result = spawn_and_exec(
        manager,
        shell,
        Some(input),
        DEFAULT_TIMEOUT_MS,
        Some(expected),
    );
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
    available
        .iter()
        .any(|s| std::mem::discriminant(s) == std::mem::discriminant(shell))
}
