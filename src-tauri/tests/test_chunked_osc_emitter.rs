//! Offline integration test for the chunked-OSC emitter scripts.
//!
//! Tauri-free verification that the Sprint-2 emitter wrappers
//! (`scripts/aether-imgcat.{ps1,sh}`) produce wire bytes the Sprint-1
//! engine assembler accepts. Drives each emitter as a child process,
//! pipes its stdout into a fresh `TermEngine`, and asserts the
//! `ImageStore` ends up with a fully-decoded PNG entry.
//!
//! Sprint 3 — first wave. Companion of:
//!   - `e2e/image-flows.spec.ts` (Tauri-attached version of the same).
//!   - `e2e/chunked-osc-flows.spec.ts` (full E2E coverage).
//!   - `scripts/verify-chunked-osc-live.mjs` (live PTY round-trip).
//!
//! Skipped silently when the corresponding shell isn't on PATH.

use std::path::PathBuf;
use std::process::Command;

use aether_terminal_lib::term::images::DecodedPayload;
use aether_terminal_lib::term::TermEngine;

/// Repo root resolved from the Cargo manifest dir. The `tests/` directory
/// is one level under `src-tauri/`, so the repo root is two levels up.
fn repo_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .expect("src-tauri has parent")
        .to_path_buf()
}

fn fixture_tiny() -> PathBuf {
    repo_root()
        .join("e2e")
        .join("fixtures")
        .join("inline-image-1x1.png")
}

fn fixture_large() -> PathBuf {
    repo_root()
        .join("e2e")
        .join("fixtures")
        .join("inline-image-32x32.png")
}

/// Probe whether `cmd --help` (or similar) succeeds. Used to skip the
/// emitter test when bash / powershell isn't installed in the test env.
fn shell_available(program: &str, probe_args: &[&str]) -> bool {
    Command::new(program)
        .args(probe_args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Locate Git Bash directly. `Command::new("bash")` resolves to
/// `C:\Windows\System32\bash.exe` (WSL bash) on stock Win11 because
/// system32 sits above PATH order in `CreateProcess` search; WSL bash
/// then can't see the host filesystem under `/c/...` (it would map to
/// the WSL VM's root). Hard-coding Git Bash bypasses both problems.
fn git_bash_path() -> Option<PathBuf> {
    for c in [
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ] {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Convert a Windows path to the MSYS form Git Bash expects.
/// `C:\Users\…` is interpreted by bash as an escape-laden string and
/// fails to resolve; `C:/Users/…` resolves but only on a subset of
/// bash builds. `/c/Users/…` works on every Git Bash version we ship
/// against.
fn path_for_shell(p: &std::path::Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    // Map `<drive>:/...` → `/<drive>/...` (MSYS / Cygdrive style).
    if let Some((head, tail)) = s.split_once(':') {
        if head.len() == 1 && head.chars().next().unwrap().is_ascii_alphabetic() {
            let drive = head.chars().next().unwrap().to_ascii_lowercase();
            // tail starts with `/` already (we already replaced `\`),
            // but if not (e.g. `C:foo`) we still want `/c/foo`.
            let leading_slash = if tail.starts_with('/') { "" } else { "/" };
            return format!("/{drive}{leading_slash}{tail}");
        }
    }
    s
}

/// Run an emitter and feed its stdout into a fresh TermEngine.
/// Returns the resulting engine for assertion.
fn run_emitter_into_engine(program: &str, args: &[String]) -> TermEngine {
    let output = Command::new(program)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn {program}: {e}"));
    assert!(
        output.status.success(),
        "{program} exited non-zero: status={:?} stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
    );
    let mut engine = TermEngine::new(120, 30).expect("engine");
    engine.advance(&output.stdout);
    engine
}

fn assert_png_image_registered(engine: &TermEngine, expected_w: u32, expected_h: u32) {
    let store = engine.images();
    assert_eq!(
        store.len(),
        1,
        "expected exactly one image, got {}",
        store.len()
    );
    let entry = store
        .iter()
        .next()
        .expect("ImageStore should have at least one entry");
    let decoded = entry
        .decoded
        .as_ref()
        .expect("emitter output should produce a decoded PNG payload");
    assert!(
        matches!(decoded.payload, DecodedPayload::Png { .. }),
        "expected DecodedPayload::Png, got {:?}",
        decoded.payload,
    );
    assert_eq!(decoded.width_px, expected_w);
    assert_eq!(decoded.height_px, expected_h);
    if let DecodedPayload::Png { bytes } = &decoded.payload {
        assert_eq!(
            &bytes[..8],
            &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            "decoded bytes must start with the PNG signature",
        );
    }
}

// -------- bash emitter --------

#[test]
fn bash_emitter_single_chunk_round_trips_through_engine() {
    let Some(bash) = git_bash_path() else {
        eprintln!("SKIP: Git Bash not found at any expected path");
        return;
    };
    let script = repo_root().join("scripts").join("aether-imgcat.sh");
    let fixture = fixture_tiny();
    let engine = run_emitter_into_engine(
        bash.to_str().expect("bash path utf8"),
        &[path_for_shell(&script), path_for_shell(&fixture)],
    );
    assert_png_image_registered(&engine, 1, 1);
}

#[test]
fn bash_emitter_multi_chunk_round_trips_through_engine() {
    let Some(bash) = git_bash_path() else {
        eprintln!("SKIP: Git Bash not found at any expected path");
        return;
    };
    let script = repo_root().join("scripts").join("aether-imgcat.sh");
    let fixture = fixture_large();
    let engine = run_emitter_into_engine(
        bash.to_str().expect("bash path utf8"),
        &[path_for_shell(&script), path_for_shell(&fixture)],
    );
    assert_png_image_registered(&engine, 32, 32);
}

// -------- PowerShell emitter --------

#[test]
fn powershell_emitter_single_chunk_round_trips_through_engine() {
    if !shell_available("powershell", &["-NoProfile", "-Command", "exit 0"]) {
        eprintln!("SKIP: powershell not available");
        return;
    }
    let script = repo_root().join("scripts").join("aether-imgcat.ps1");
    let fixture = fixture_tiny();
    let engine = run_emitter_into_engine(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            script.to_string_lossy().into_owned(),
            fixture.to_string_lossy().into_owned(),
        ],
    );
    assert_png_image_registered(&engine, 1, 1);
}

#[test]
fn powershell_emitter_multi_chunk_round_trips_through_engine() {
    if !shell_available("powershell", &["-NoProfile", "-Command", "exit 0"]) {
        eprintln!("SKIP: powershell not available");
        return;
    }
    let script = repo_root().join("scripts").join("aether-imgcat.ps1");
    let fixture = fixture_large();
    let engine = run_emitter_into_engine(
        "powershell",
        &[
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            script.to_string_lossy().into_owned(),
            fixture.to_string_lossy().into_owned(),
        ],
    );
    assert_png_image_registered(&engine, 32, 32);
}

// -------- protocol-level coverage (no shell needed) --------

#[test]
fn malformed_then_valid_chunk_oscs_keep_assembler_clean() {
    // Drive a malformed OSC 1338 frame followed by a valid chunked
    // transfer constructed in pure Rust. Proves the engine's dispatch
    // path doesn't get poisoned when a malformed frame arrives between
    // valid ones — same scenario the chunked-osc-flows.spec.ts E2E
    // exercises, but executable without Tauri / a shell.
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let mut engine = TermEngine::new(120, 30).expect("engine");
    let raw = b"\x89PNG\r\n\x1a\nSPRINT3";
    let b64 = B64.encode(raw);

    // Malformed: unknown verb 'X'.
    engine.advance(b"\x1b]1338;X;weird\x07");
    // Valid BEGIN/DATA/END.
    let begin = "\x1b]1338;B;42;png;2;2\x07".to_string();
    let data = format!("\x1b]1338;D;42;0;{b64}\x07");
    let end = b"\x1b]1338;E;42\x07";
    engine.advance(begin.as_bytes());
    engine.advance(data.as_bytes());
    engine.advance(end);

    let store = engine.images();
    assert_eq!(store.len(), 1, "malformed frame must not register an entry");
    let entry = store.iter().next().expect("valid transfer should register");
    assert_eq!(entry.bytes, raw);
    let decoded = entry.decoded.as_ref().expect("PNG should decode");
    assert!(matches!(decoded.payload, DecodedPayload::Png { .. }));
}
