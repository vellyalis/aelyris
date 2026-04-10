//! PTY Test Harness
//!
//! Utilities for testing PTY spawn, I/O, lifecycle via nested ConPTY.
//! Spawns real shells as child processes and validates stdin/stdout behavior.

use aether_terminal_lib::pty::{PtyManager, ShellType};
use std::io::Read;
use std::time::{Duration, Instant};

/// Default timeout for PTY output reads
pub const DEFAULT_TIMEOUT_MS: u64 = 5000;

/// Buffer size for reading PTY output
const READ_BUF_SIZE: usize = 4096;

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

    // Small delay to let the shell initialize
    std::thread::sleep(Duration::from_millis(300));

    // Send input if provided
    if let Some(cmd) = input {
        manager.write(&id, cmd.as_bytes())?;
    }

    // Read output
    let mut reader = manager.take_reader(&id)?;
    let mut output = String::new();
    let mut buf = [0u8; READ_BUF_SIZE];
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    loop {
        if start.elapsed() >= timeout {
            break;
        }

        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]);
                output.push_str(&chunk);

                if let Some(expected) = wait_for {
                    if output.contains(expected) {
                        break;
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                // On Windows ConPTY, broken pipe means process exited
                if e.kind() == std::io::ErrorKind::BrokenPipe {
                    break;
                }
                return Err(format!("Read error: {}", e));
            }
        }
    }

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
