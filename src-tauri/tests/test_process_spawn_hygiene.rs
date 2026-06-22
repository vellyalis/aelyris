use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn backend_helper_processes_use_hidden_command_wrapper() {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();

    visit_rs_files(&src, &mut |path| {
        if path.file_name().and_then(|name| name.to_str()) == Some("process.rs") {
            return;
        }
        let Ok(text) = fs::read_to_string(path) else {
            return;
        };
        for (index, line) in text.lines().enumerate() {
            if spawns_raw_command(line) {
                offenders.push(format!(
                    "{}:{}: {}",
                    path.strip_prefix(src.parent().unwrap_or(&src))
                        .unwrap_or(path)
                        .display(),
                    index + 1,
                    line.trim()
                ));
            }
        }
    });

    assert!(
        offenders.is_empty(),
        "use crate::process::hidden_command for non-PTY helper spawns:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn vendored_portable_pty_hides_conpty_children() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let conpty = root.join("vendor/portable-pty-0.8.1/src/win/psuedocon.rs");
    let text = fs::read_to_string(&conpty).expect("portable-pty ConPTY source should be vendored");

    assert!(
        text.contains("STARTF_USESHOWWINDOW") && text.contains("SW_HIDE"),
        "ConPTY child spawn should request a hidden startup window"
    );
}

#[test]
fn ipc_commands_do_not_block_on_async_runtime() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let commands = root.join("src/ipc/commands.rs");
    let text = fs::read_to_string(&commands).expect("IPC commands source should be readable");

    assert!(
        !text.contains("block_on("),
        "Tauri IPC commands must use async commands or spawn_blocking instead of block_on"
    );
}

#[test]
fn pty_sidecar_startup_probe_is_bounded() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let sidecar = root.join("src/pty_sidecar.rs");
    let text = fs::read_to_string(&sidecar).expect("PTY sidecar source should be readable");
    let block_on_count = text.matches("block_on(").count();

    assert!(
        text.contains("SIDECAR_READY_TIMEOUT") && text.contains("SIDECAR_PROBE_CONNECT_TIMEOUT"),
        "sidecar startup must have explicit total and per-probe time budgets"
    );
    assert!(
        text.contains("TcpStream::connect_timeout"),
        "sidecar startup must use a cheap TCP preflight before HTTP probing"
    );
    assert!(
        !text.contains("for _ in 0..40"),
        "sidecar startup must not use the old fixed retry loop"
    );
    assert!(
        block_on_count <= 1,
        "sidecar startup probe should keep async runtime blocking to one bounded probe"
    );
    assert!(
        !text.contains("block_on(client.list())"),
        "sidecar startup probe must not perform a second blocking list call"
    );
}

#[test]
fn tauri_builder_does_not_launch_sidecar_synchronously() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let lib = root.join("src/lib.rs");
    let text = fs::read_to_string(&lib).expect("lib source should be readable");
    let commands = root.join("src/ipc/commands.rs");
    let commands_text =
        fs::read_to_string(&commands).expect("IPC commands source should be readable");

    assert!(
        !text.contains("PtySidecarState::new(pty_sidecar::launch_or_connect())"),
        "Tauri Builder setup must not call launch_or_connect synchronously"
    );
    assert!(
        text.contains("PtySidecarState::new(None)") && text.contains("spawn_blocking"),
        "sidecar connection should be initialized in the background"
    );
    assert!(
        !text.contains("sidecar_state.lock_native_backend()"),
        "builder setup must not lock native before the bounded sidecar probe can finish"
    );
    assert!(
        commands_text.contains("sidecar_state.lock_native_backend()"),
        "first native PTY spawn must lock out late sidecar adoption after native state exists"
    );
}

/// True iff `line` spawns a process through the bare std API rather than the
/// `crate::process::hidden_command` wrapper. Matches `std::process::Command` and
/// the `Command::new` token, but NOT a longer identifier that merely ends in
/// `Command` — e.g. `GateCommand::new` is a data-struct constructor, not a spawn,
/// so it must not trip the gate (a word-boundary guard the old substring lacked).
fn spawns_raw_command(line: &str) -> bool {
    if line.contains("std::process::Command") {
        return true;
    }
    let needle = "Command::new";
    let mut rest = line;
    while let Some(pos) = rest.find(needle) {
        let part_of_longer_ident = rest[..pos]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_');
        if !part_of_longer_ident {
            return true;
        }
        rest = &rest[pos + needle.len()..];
    }
    false
}

fn visit_rs_files(path: &Path, on_file: &mut impl FnMut(&Path)) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            visit_rs_files(&path, on_file);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            on_file(&path);
        }
    }
}
