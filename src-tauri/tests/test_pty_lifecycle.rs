//! PTY Lifecycle Tests — resize, close, error handling

mod pty_harness;

use aether_terminal_lib::pty::{PtyManager, ShellType};
use pty_harness::*;

#[test]
fn test_resize() {
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::Cmd);

    // Resize to various sizes
    mgr.resize(&id, 40, 10).expect("resize to 40x10 failed");
    mgr.resize(&id, 200, 50).expect("resize to 200x50 failed");
    mgr.resize(&id, 120, 30).expect("resize to 120x30 failed");

    mgr.close(&id).expect("close failed");
}

#[test]
fn test_close_removes_from_list() {
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::Cmd);

    assert!(mgr.list().contains(&id));
    mgr.close(&id).expect("close failed");
    assert!(
        !mgr.list().contains(&id),
        "Terminal should be removed after close"
    );
}

#[test]
fn test_close_all() {
    let mgr = PtyManager::new();

    let id1 = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn 1");
    let id2 = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn 2");
    let id3 = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn 3");

    assert_eq!(mgr.list().len(), 3);
    mgr.close_all();
    assert!(
        mgr.list().is_empty(),
        "All terminals should be removed after close_all"
    );
}

#[test]
fn test_write_after_close() {
    let mgr = PtyManager::new();
    let id = assert_spawn_succeeds(&mgr, &ShellType::Cmd);

    mgr.close(&id).expect("close failed");

    let result = mgr.write(&id, b"echo test\r\n");
    assert!(result.is_err(), "Write to closed terminal should fail");
}
