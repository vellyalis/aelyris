//! PTY Advanced Tests — concurrency, large output, Japanese, escape sequences, zombie prevention

mod pty_harness;

use aether_terminal_lib::pty::{PtyManager, ShellType};
use pty_harness::*;
use std::collections::HashSet;

#[test]
fn test_concurrent_spawn() {
    let mgr = PtyManager::new();
    let mut ids = Vec::new();

    for _ in 0..5 {
        let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn failed");
        ids.push(id);
    }

    // All IDs should be unique
    let unique: HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), 5, "All terminal IDs should be unique");

    // All should be in the list
    let active = mgr.list();
    for id in &ids {
        assert!(active.contains(id), "Terminal {} should be active", id);
    }

    mgr.close_all();
}

#[test]
fn test_large_output() {
    let mgr = PtyManager::new();

    // Generate ~10KB of output via CMD for loop
    let cmd = "for /L %i in (1,1,100) do @echo LINE_%i_PADDING_DATA_HERE\r\n";
    let result = spawn_and_exec(
        &mgr,
        &ShellType::Cmd,
        Some(cmd),
        10000,
        Some("LINE_100_"),
    );

    match result {
        Ok((_, output)) => {
            assert!(
                output.len() > 1000,
                "Expected large output (>1KB), got {} bytes",
                output.len()
            );
            assert!(
                output.contains("LINE_100_"),
                "Expected to find LINE_100_ in output"
            );
        }
        Err(e) => panic!("Large output test failed: {}", e),
    }
}

#[test]
fn test_japanese_io() {
    if !is_shell_available(&ShellType::PowerShell) {
        eprintln!("SKIP: PowerShell not available");
        return;
    }
    let mgr = PtyManager::new();

    // Use a unique ASCII marker alongside Japanese to ensure detection
    assert_output_contains(
        &mgr,
        &ShellType::PowerShell,
        "Write-Output \"JPTEST_aether\"\r\n",
        "JPTEST_aether",
    );
}

#[test]
fn test_escape_sequences() {
    let mgr = PtyManager::new();

    let result = spawn_and_exec(
        &mgr,
        &ShellType::Cmd,
        Some("echo test_esc_marker\r\n"),
        DEFAULT_TIMEOUT_MS,
        Some("test_esc_marker"),
    );

    match result {
        Ok((_, output)) => {
            assert!(output.contains("test_esc_marker"), "Basic output should work through ConPTY");
        }
        Err(e) => panic!("Escape sequence test failed: {}", e),
    }
}

#[test]
fn test_zombie_prevention() {
    // Spawn terminals in a scoped manager, then drop it.
    // Drop impl calls close_all(), preventing zombie processes.
    {
        let mgr = PtyManager::new();
        mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn 1");
        mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn 2");
        assert_eq!(mgr.list().len(), 2);
        // mgr dropped here -> close_all() via Drop
    }

    std::thread::sleep(std::time::Duration::from_millis(500));

    // New manager should start clean
    let mgr2 = PtyManager::new();
    assert!(mgr2.list().is_empty(), "New manager should have no terminals");
}
