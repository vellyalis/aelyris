//! PTY Basic Tests — spawn + I/O for each shell type

mod pty_harness;

use aether_terminal_lib::pty::{PtyManager, ShellType};
use pty_harness::*;

#[test]
fn test_pwsh_spawn() {
    if !is_shell_available(&ShellType::PowerShell) {
        eprintln!("SKIP: PowerShell not available");
        return;
    }
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::PowerShell);
    mgr.close(&id).expect("close failed");
}

#[test]
fn test_pwsh_echo() {
    if !is_shell_available(&ShellType::PowerShell) {
        eprintln!("SKIP: PowerShell not available");
        return;
    }
    let mgr = PtyManager::new();
    assert_output_contains(
        &mgr,
        &ShellType::PowerShell,
        "echo \"hello_pty_test\"\r\n",
        "hello_pty_test",
    );
}

#[test]
fn test_cmd_spawn() {
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::Cmd);
    mgr.close(&id).expect("close failed");
}

#[test]
fn test_cmd_echo() {
    let mgr = PtyManager::new();
    assert_output_contains(
        &mgr,
        &ShellType::Cmd,
        "echo hello_cmd_test\r\n",
        "hello_cmd_test",
    );
}

#[test]
fn test_gitbash_spawn() {
    if !is_shell_available(&ShellType::GitBash) {
        eprintln!("SKIP: Git Bash not available");
        return;
    }
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::GitBash);
    mgr.close(&id).expect("close failed");
}

#[test]
fn test_gitbash_echo() {
    if !is_shell_available(&ShellType::GitBash) {
        eprintln!("SKIP: Git Bash not available");
        return;
    }
    let mgr = PtyManager::new();
    assert_output_contains(
        &mgr,
        &ShellType::GitBash,
        "echo \"hello_bash_test\"\n",
        "hello_bash_test",
    );
}
