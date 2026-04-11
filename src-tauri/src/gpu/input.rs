//! Keyboard input handling — translates key events to PTY byte sequences.
//!
//! Handles normal keys, modifier combinations, and terminal mode-dependent
//! key mappings (e.g. DECCKM for arrow keys).

use crate::gpu::grid::TerminalMode;

/// Convert a key event to the byte sequence that should be sent to the PTY.
///
/// Returns None if the key should not be forwarded (e.g. handled by UI).
pub fn key_to_pty_bytes(
    key: &str,
    ctrl: bool,
    alt: bool,
    shift: bool,
    mode: &TerminalMode,
) -> Option<Vec<u8>> {
    // Special keys
    match key {
        "Enter" => return Some(b"\r".to_vec()),
        "Backspace" => return Some(vec![0x7f]),
        "Tab" => {
            if shift {
                return Some(b"\x1b[Z".to_vec()); // Back-tab
            }
            return Some(b"\t".to_vec());
        }
        "Escape" => return Some(b"\x1b".to_vec()),
        "Delete" => return Some(b"\x1b[3~".to_vec()),
        "Insert" => return Some(b"\x1b[2~".to_vec()),
        "Home" => return Some(if mode.app_cursor { b"\x1bOH".to_vec() } else { b"\x1b[H".to_vec() }),
        "End" => return Some(if mode.app_cursor { b"\x1bOF".to_vec() } else { b"\x1b[F".to_vec() }),
        "PageUp" => return Some(b"\x1b[5~".to_vec()),
        "PageDown" => return Some(b"\x1b[6~".to_vec()),

        // Arrow keys — DECCKM dependent
        "ArrowUp" => return Some(if mode.app_cursor { b"\x1bOA".to_vec() } else { b"\x1b[A".to_vec() }),
        "ArrowDown" => return Some(if mode.app_cursor { b"\x1bOB".to_vec() } else { b"\x1b[B".to_vec() }),
        "ArrowRight" => return Some(if mode.app_cursor { b"\x1bOC".to_vec() } else { b"\x1b[C".to_vec() }),
        "ArrowLeft" => return Some(if mode.app_cursor { b"\x1bOD".to_vec() } else { b"\x1b[D".to_vec() }),

        // Function keys
        "F1" => return Some(b"\x1bOP".to_vec()),
        "F2" => return Some(b"\x1bOQ".to_vec()),
        "F3" => return Some(b"\x1bOR".to_vec()),
        "F4" => return Some(b"\x1bOS".to_vec()),
        "F5" => return Some(b"\x1b[15~".to_vec()),
        "F6" => return Some(b"\x1b[17~".to_vec()),
        "F7" => return Some(b"\x1b[18~".to_vec()),
        "F8" => return Some(b"\x1b[19~".to_vec()),
        "F9" => return Some(b"\x1b[20~".to_vec()),
        "F10" => return Some(b"\x1b[21~".to_vec()),
        "F11" => return Some(b"\x1b[23~".to_vec()),
        "F12" => return Some(b"\x1b[24~".to_vec()),

        _ => {}
    }

    // Single character keys
    if key.len() == 1 {
        let c = key.chars().next().unwrap();

        if ctrl {
            // Ctrl+A..Z → 0x01..0x1A
            if c.is_ascii_alphabetic() {
                let byte = (c.to_ascii_lowercase() as u8) - b'a' + 1;
                return if alt {
                    Some(vec![0x1b, byte])
                } else {
                    Some(vec![byte])
                };
            }
            // Ctrl+special
            match c {
                '[' | '3' => return Some(vec![0x1b]),     // Ctrl+[ = ESC
                '\\' | '4' => return Some(vec![0x1c]),    // Ctrl+\ = FS
                ']' | '5' => return Some(vec![0x1d]),     // Ctrl+] = GS
                '6' => return Some(vec![0x1e]),            // Ctrl+6 = RS
                '/' | '7' => return Some(vec![0x1f]),      // Ctrl+/ = US
                ' ' | '2' => return Some(vec![0x00]),      // Ctrl+Space = NUL
                _ => {}
            }
        }

        if alt {
            let mut bytes = vec![0x1b];
            let mut buf = [0u8; 4];
            bytes.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            return Some(bytes);
        }

        // Normal character — encode as UTF-8
        let mut buf = [0u8; 4];
        let s = c.encode_utf8(&mut buf);
        return Some(s.as_bytes().to_vec());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_mode() -> TerminalMode {
        TerminalMode::default()
    }

    #[test]
    fn test_normal_char() {
        assert_eq!(key_to_pty_bytes("a", false, false, false, &default_mode()), Some(b"a".to_vec()));
    }

    #[test]
    fn test_ctrl_c() {
        assert_eq!(key_to_pty_bytes("c", true, false, false, &default_mode()), Some(vec![0x03]));
    }

    #[test]
    fn test_arrow_keys_normal() {
        assert_eq!(key_to_pty_bytes("ArrowUp", false, false, false, &default_mode()), Some(b"\x1b[A".to_vec()));
    }

    #[test]
    fn test_arrow_keys_app_cursor() {
        let mode = TerminalMode { app_cursor: true, ..Default::default() };
        assert_eq!(key_to_pty_bytes("ArrowUp", false, false, false, &mode), Some(b"\x1bOA".to_vec()));
    }

    #[test]
    fn test_alt_char() {
        assert_eq!(key_to_pty_bytes("x", false, true, false, &default_mode()), Some(vec![0x1b, b'x']));
    }

    #[test]
    fn test_enter() {
        assert_eq!(key_to_pty_bytes("Enter", false, false, false, &default_mode()), Some(b"\r".to_vec()));
    }
}
