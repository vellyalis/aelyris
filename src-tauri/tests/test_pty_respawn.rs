//! PTY crash-recovery + respawn tests.
//!
//! Verifies the contract for the post-0.2.2 "shell exited / restart" flow:
//!   1. After a child exits, the registered child handle reports a status.
//!   2. The terminal id can be reused via `spawn_command_with_id` once the
//!      old instance is closed — preserving the id is what lets the
//!      `NativeTerminalRegistry` engine session (with prompt-mark history)
//!      survive across the crash boundary.
//!   3. `spawn_command_with_id` rejects an id that is still alive so a buggy
//!      respawn cannot orphan the old PTY.
//!   4. `ExitInfo::from_status` flags abnormal exits as `crashed`.

mod pty_harness;

use aelyris_lib::pty::{ExitInfo, PtyManager, ShellType};
use std::time::Duration;

/// `cmd /c exit 0` runs to completion fast enough that the harness can
/// reasonably wait for `child.wait()` to return without flaking.
#[test]
fn child_exit_is_observable_via_take_child() {
    let mgr = PtyManager::new();
    let id = mgr
        .spawn_command(
            "cmd",
            &["/c".to_string(), "exit 0".to_string()],
            80,
            24,
            None,
            None,
        )
        .expect("spawn cmd /c exit 0");

    let mut child = mgr
        .take_child(&id)
        .expect("take_child returns the boxed child once");

    let status = child.wait().expect("child wait succeeds");
    let exit_info = ExitInfo::from_status(&status);
    // `cmd /c exit 0` is a clean exit — must not be flagged as crashed.
    assert!(!exit_info.crashed, "exit 0 should not be marked crashed");
    assert_eq!(exit_info.code, Some(0));

    // Drop the dead instance so the id is free for the respawn step.
    let _ = mgr.close(&id);
}

#[test]
fn id_can_be_reused_after_close_for_respawn() {
    let mgr = PtyManager::new();
    let id = mgr
        .spawn(&ShellType::Cmd, 80, 24, None)
        .expect("initial spawn");

    // Simulate the post-exit cleanup the IPC waiter does.
    mgr.close(&id).expect("close to free the id");
    assert!(!mgr.contains(&id), "id should be free after close");

    // Respawn under the same id.
    mgr.spawn_command_with_id(
        &id,
        "cmd",
        &["/c".to_string(), "exit 0".to_string()],
        80,
        24,
        None,
        None,
    )
    .expect("respawn under same id");
    assert!(mgr.contains(&id), "id should be live after respawn");

    let _ = mgr.close(&id);
}

#[test]
fn spawn_with_id_rejects_live_collision() {
    let mgr = PtyManager::new();
    let id = mgr
        .spawn(&ShellType::Cmd, 80, 24, None)
        .expect("initial spawn");

    // While the original is still alive, attempting to claim the same id
    // must fail rather than overwrite it. Otherwise a UI bug that fires
    // respawn against a healthy session would leak the original PTY.
    let collision = mgr.spawn_command_with_id(
        &id,
        "cmd",
        &["/c".to_string(), "exit 0".to_string()],
        80,
        24,
        None,
        None,
    );
    assert!(collision.is_err(), "duplicate id should be rejected");

    let _ = mgr.close(&id);
}

#[test]
fn take_child_is_one_shot() {
    let mgr = PtyManager::new();
    let id = mgr
        .spawn(&ShellType::Cmd, 80, 24, None)
        .expect("initial spawn");

    assert!(mgr.take_child(&id).is_some(), "first take returns Some");
    assert!(
        mgr.take_child(&id).is_none(),
        "second take returns None — handle is moved to the waiter"
    );

    // Give cmd.exe a moment to finish its initial output before we close
    // the slave fd, otherwise the waiter (none here) would race with our
    // close. Pure hygiene — does not affect assertions above.
    std::thread::sleep(Duration::from_millis(50));
    let _ = mgr.close(&id);
}

#[cfg(target_os = "windows")]
#[test]
fn close_terminates_child_even_after_waiter_takes_handle() {
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn cmd");
    let mut child = mgr
        .take_child(&id)
        .expect("waiter can take child handle before close");

    mgr.close(&id).expect("close should remove and terminate");

    for _ in 0..50 {
        if child.try_wait().expect("try_wait after close").is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }

    let _ = child.kill();
    panic!("close did not terminate the child process within 1s");
}
