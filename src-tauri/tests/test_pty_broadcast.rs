//! PTY Broadcast / Multi-subscriber tests (3D-1 v2c).
//!
//! Validates that `PtyManager::subscribe_output` returns a fresh
//! `broadcast::Receiver` on every call and that multiple subscribers see
//! the same byte stream without racing each other on the physical PTY
//! master.

mod pty_harness;

use aether_terminal_lib::pty::{PtyManager, ShellType};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time::timeout as tokio_timeout;

/// Drain a broadcast receiver until `marker` appears or the deadline hits.
async fn drain_until(
    rx: &mut broadcast::Receiver<Vec<u8>>,
    marker: &str,
    total: Duration,
) -> String {
    let start = std::time::Instant::now();
    let mut acc = String::new();
    loop {
        let elapsed = start.elapsed();
        if elapsed >= total {
            break;
        }
        let remaining = total - elapsed;
        match tokio_timeout(remaining, rx.recv()).await {
            Ok(Ok(chunk)) => {
                acc.push_str(&String::from_utf8_lossy(&chunk));
                if acc.contains(marker) {
                    break;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => break,
            Err(_) => break,
        }
    }
    acc
}

#[test]
fn subscribe_output_unknown_id_returns_notfound() {
    let mgr = PtyManager::new();
    let res = mgr.subscribe_output("no-such-id");
    assert!(res.is_err(), "subscribe on missing id should fail");
}

#[test]
fn contains_tracks_session_lifecycle() {
    let mgr = PtyManager::new();

    assert!(!mgr.contains("no-such-id"));

    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");
    assert!(mgr.contains(&id), "spawned id must be tracked");

    mgr.close(&id).expect("close");
    assert!(!mgr.contains(&id), "closed id must not be tracked");
}

#[test]
fn subscribe_output_after_close_returns_notfound() {
    // Guards against a regression where `close` would remove the
    // `PtyInstance` from the map but leave the `broadcast::Sender` reachable
    // via an Arc cycle — a late subscriber would then silently get a
    // never-producing receiver instead of an explicit NotFound.
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");

    // Subscribe once so the Sender has a known live external handle.
    let _rx = mgr.subscribe_output(&id).expect("subscribe pre-close");

    mgr.close(&id).expect("close");

    let res = mgr.subscribe_output(&id);
    assert!(res.is_err(), "subscribe after close must fail");
}

#[test]
fn existing_receiver_sees_closed_after_close() {
    // Companion to the NotFound check: a receiver that was issued *before*
    // close must eventually observe `RecvError::Closed`, not hang forever.
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");

    let mut rx = mgr.subscribe_output(&id).expect("subscribe");

    mgr.close(&id).expect("close");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");

    let outcome = rt.block_on(async {
        loop {
            match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
                Ok(Ok(_)) => continue, // buffered data still flushing — keep draining
                Ok(Err(broadcast::error::RecvError::Closed)) => return Ok(()),
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Err(_) => return Err("timed out waiting for Closed"),
            }
        }
    });

    assert!(outcome.is_ok(), "receiver never observed Closed: {:?}", outcome);
}

#[test]
fn two_subscribers_receive_same_marker() {
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");

    let mut rx_a = mgr.subscribe_output(&id).expect("subscribe a");
    let mut rx_b = mgr.subscribe_output(&id).expect("subscribe b");

    // Give cmd.exe a moment to finish its banner so the echo we issue next
    // lands in the broadcast cleanly.
    std::thread::sleep(Duration::from_millis(300));
    mgr.write(&id, b"echo MULTI_SUB_MARKER\r\n").expect("write");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");

    let (a, b) = rt.block_on(async {
        let total = Duration::from_secs(5);
        let a = drain_until(&mut rx_a, "MULTI_SUB_MARKER", total);
        let b = drain_until(&mut rx_b, "MULTI_SUB_MARKER", total);
        tokio::join!(a, b)
    });

    assert!(
        a.contains("MULTI_SUB_MARKER"),
        "subscriber A did not see marker: {:?}",
        &a[..a.len().min(200)],
    );
    assert!(
        b.contains("MULTI_SUB_MARKER"),
        "subscriber B did not see marker: {:?}",
        &b[..b.len().min(200)],
    );

    mgr.close_all();
}

#[test]
fn slow_subscriber_does_not_block_fast() {
    // Simulates the UI+API race: both subscribe, but only one drains. The
    // fast reader must still see the marker even though the slow reader
    // is never polled.
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");

    let _rx_slow = mgr.subscribe_output(&id).expect("subscribe slow");
    let mut rx_fast = mgr.subscribe_output(&id).expect("subscribe fast");

    std::thread::sleep(Duration::from_millis(300));
    mgr.write(&id, b"echo FAST_READER_OK\r\n").expect("write");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");

    let fast = rt.block_on(drain_until(&mut rx_fast, "FAST_READER_OK", Duration::from_secs(5)));

    assert!(
        fast.contains("FAST_READER_OK"),
        "fast subscriber missed marker while slow one held idle: {:?}",
        &fast[..fast.len().min(200)],
    );

    // Slow receiver is dropped here without ever being polled — the
    // important assertion is that doing so did not affect the fast one.
    mgr.close_all();
}

#[test]
fn late_subscriber_sees_future_bytes() {
    // A subscriber attached after an earlier write must still receive the
    // bytes produced *after* it subscribes. We deliberately do NOT assert
    // the absence of pre-subscribe text on the late receiver — Windows
    // cmd.exe repaints the visible region using cursor-positioning ANSI,
    // which can legitimately surface old line text in the future byte
    // stream. The guarantee we care about is "future bytes are delivered,"
    // not "no replay of any substring ever."
    let mgr = PtyManager::new();
    let id = mgr.spawn(&ShellType::Cmd, 80, 24, None).expect("spawn");

    let mut rx_early = mgr.subscribe_output(&id).expect("subscribe early");

    std::thread::sleep(Duration::from_millis(300));
    mgr.write(&id, b"echo EARLY_MARKER\r\n").expect("write early");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("rt");

    let early_seen = rt.block_on(drain_until(
        &mut rx_early,
        "EARLY_MARKER",
        Duration::from_secs(5),
    ));
    assert!(
        early_seen.contains("EARLY_MARKER"),
        "early subscriber did not see EARLY_MARKER (setup failure): {:?}",
        &early_seen[..early_seen.len().min(200)],
    );

    let mut rx_late = mgr.subscribe_output(&id).expect("subscribe late");
    mgr.write(&id, b"echo LATE_MARKER\r\n").expect("write late");

    let late_seen = rt.block_on(drain_until(
        &mut rx_late,
        "LATE_MARKER",
        Duration::from_secs(5),
    ));
    assert!(
        late_seen.contains("LATE_MARKER"),
        "late subscriber did not see LATE_MARKER: {:?}",
        &late_seen[..late_seen.len().min(200)],
    );

    mgr.close_all();
}
