//! OSC 133 prompt mark parser + storage.
//!
//! OSC 133 is the de-facto "semantic prompt" protocol that zsh, fish, bash
//! (via Starship / ble.sh) and PowerShell can emit so the terminal can tell
//! *where* a prompt begins, *where* its command ends, and *where* the
//! resulting output ends. Terminals that parse these marks enable:
//!
//! - Jump to previous / next prompt
//! - Copy the output of the last command only
//! - Color-code failed commands via the `D;<exit_code>` payload
//!
//! # Wire format
//!
//! Each mark is `ESC ] 133 ; <kind> [; <n>] ST` where `ST` is either `BEL`
//! (`0x07`) or `ESC \` (`0x1b 0x5c`). Kinds:
//!
//! - `A`  — prompt start (line hosting the prompt)
//! - `B`  — prompt end / command start (cursor is where the user types)
//! - `C`  — command executed, output begins on the next line
//! - `D`  — command finished. Optional `;<exit_code>` payload.
//!
//! Other payload keys (`cl=m` for "clear last line on exit" etc.) are parsed
//! as tolerant trailers — we consume them but only the exit code is surfaced.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptMarkKind {
    /// `OSC 133 ; A ST` — prompt is about to render on the current line.
    PromptStart,
    /// `OSC 133 ; B ST` — prompt ended; cursor is at the command-input point.
    CommandStart,
    /// `OSC 133 ; C ST` — command executed; subsequent output is the result.
    OutputStart,
    /// `OSC 133 ; D [; exit] ST` — command finished; exit code optional.
    CommandEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptMark {
    pub kind: PromptMarkKind,
    /// Screen line (0-indexed from the visible top) where the mark landed.
    pub screen_line: u16,
    /// Exit code carried by a `CommandEnd`. `None` for other kinds or when
    /// the shell did not emit one.
    pub exit_code: Option<i32>,
    /// Monotonic counter across the engine's lifetime. Gives the frontend a
    /// stable ordering even after scrollback eviction shifts line numbers.
    pub sequence: u64,
    /// Snapshot of `history_size()` at the moment the mark was recorded.
    /// Combined with the current history size this lets consumers compute
    /// where the mark *is now* — as lines scroll off the live screen into
    /// history, the delta `history_size_now - history_size_at_mark` tells
    /// the frontend how far back in scrollback the mark sits.
    #[serde(rename = "historySize")]
    pub history_size: u32,
}

/// Upper bound on retained marks. A very long session is capped at ~1k
/// prompts which is ~a full workday of shell activity. Oldest-first drop
/// keeps memory O(1) without user-visible loss.
const MAX_MARKS: usize = 1024;

/// Parsed result of examining the first few bytes of a buffer.
pub enum ParseStep {
    /// A complete OSC 133 mark was consumed.
    Consumed {
        bytes: usize,
        mark: PromptMarkPayload,
    },
    /// A recognised `OSC 133;` prefix is present but the terminator has not
    /// yet arrived. Caller should wait for more bytes before re-scanning.
    Incomplete,
    /// The bytes do not start with an OSC 133 sequence.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromptMarkPayload {
    pub kind: PromptMarkKind,
    pub exit_code: Option<i32>,
}

/// Attempt to parse an OSC 133 mark starting at `bytes[0]`. Returns the
/// number of bytes consumed plus the parsed payload on success.
///
/// The byte stream outside of any recognised OSC 133 sequence is returned
/// unchanged — callers must still forward the raw bytes to their VT parser.
pub fn try_parse(bytes: &[u8]) -> ParseStep {
    // Shortest plausible match: `ESC ] 133 ; A BEL` = 7 bytes. Anything
    // shorter is either not an OSC 133 or is mid-stream; let the caller wait.
    const PREFIX: &[u8] = b"\x1b]133;";
    if bytes.len() < PREFIX.len() {
        // Could still be the opening partial of a longer match, but from
        // just the prefix length we cannot tell. Fall back to "None" and
        // let the caller re-enter when more bytes arrive — a single OSC
        // opener won't get double-consumed because `advance` pre-scans
        // on each call starting at the same byte index.
        if PREFIX.starts_with(bytes) {
            return ParseStep::Incomplete;
        }
        return ParseStep::None;
    }
    if !bytes.starts_with(PREFIX) {
        return ParseStep::None;
    }

    // Prefix fits but the kind byte itself hasn't arrived yet. Wait for more.
    let Some(&kind_byte) = bytes.get(PREFIX.len()) else {
        return ParseStep::Incomplete;
    };
    let kind = match kind_byte {
        b'A' => PromptMarkKind::PromptStart,
        b'B' => PromptMarkKind::CommandStart,
        b'C' => PromptMarkKind::OutputStart,
        b'D' => PromptMarkKind::CommandEnd,
        _ => return ParseStep::None,
    };

    // Find the terminator — BEL (`0x07`) or ST (`ESC \\` = `1b 5c`).
    let payload_start = PREFIX.len() + 1;
    let mut i = payload_start;
    let mut terminator_len = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b == 0x07 {
            terminator_len = 1;
            break;
        }
        if b == 0x1b && bytes.get(i + 1) == Some(&0x5c) {
            terminator_len = 2;
            break;
        }
        i += 1;
    }
    if terminator_len == 0 {
        return ParseStep::Incomplete;
    }

    // Payload between `kind_byte` position + 1 and terminator start. For `D`
    // this might be `;<exit>[;other...]`. Accept only the first numeric field.
    let payload = &bytes[payload_start..i];
    let exit_code = if kind == PromptMarkKind::CommandEnd {
        parse_exit_code(payload)
    } else {
        None
    };

    ParseStep::Consumed {
        bytes: i + terminator_len,
        mark: PromptMarkPayload { kind, exit_code },
    }
}

fn parse_exit_code(payload: &[u8]) -> Option<i32> {
    // Payload shape: `;<number>[;key=value]*`. Reject missing leading `;`
    // rather than silently accepting garbage.
    if !payload.starts_with(b";") {
        return None;
    }
    let tail = &payload[1..];
    // Take bytes up to next `;` if any.
    let num_end = tail.iter().position(|&b| b == b';').unwrap_or(tail.len());
    let num_bytes = &tail[..num_end];
    if num_bytes.is_empty() {
        return None;
    }
    std::str::from_utf8(num_bytes)
        .ok()
        .and_then(|s| s.parse::<i32>().ok())
}

/// Rolling window of prompt marks for a single terminal session.
#[derive(Debug, Default)]
pub struct PromptMarkLog {
    marks: VecDeque<PromptMark>,
    next_sequence: u64,
}

impl PromptMarkLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(
        &mut self,
        payload: PromptMarkPayload,
        screen_line: u16,
        history_size: u32,
    ) -> PromptMark {
        let mark = PromptMark {
            kind: payload.kind,
            screen_line,
            exit_code: payload.exit_code,
            sequence: self.next_sequence,
            history_size,
        };
        self.next_sequence += 1;
        if self.marks.len() >= MAX_MARKS {
            self.marks.pop_front();
        }
        self.marks.push_back(mark);
        mark
    }

    pub fn as_slice(&self) -> Vec<PromptMark> {
        self.marks.iter().copied().collect()
    }

    pub fn len(&self) -> usize {
        self.marks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.marks.is_empty()
    }

    pub fn clear(&mut self) {
        self.marks.clear();
        // Sequence intentionally preserved — if callers resubscribe we want
        // the monotonic counter to stay monotonic.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_prompt_start_with_bel_terminator() {
        // 8 bytes: ESC ']' '1' '3' '3' ';' 'A' BEL.
        let bytes = b"\x1b]133;A\x07after";
        let ParseStep::Consumed { bytes: n, mark } = try_parse(bytes) else {
            panic!("expected Consumed");
        };
        assert_eq!(n, 8);
        assert_eq!(mark.kind, PromptMarkKind::PromptStart);
        assert_eq!(mark.exit_code, None);
    }

    #[test]
    fn parses_command_end_with_st_terminator_and_exit_code() {
        // 12 bytes: ESC ']' '1' '3' '3' ';' 'D' ';' '4' '2' ESC '\\' + …
        let bytes = b"\x1b]133;D;42\x1b\\more";
        let ParseStep::Consumed { bytes: n, mark } = try_parse(bytes) else {
            panic!("expected Consumed");
        };
        assert_eq!(n, 12);
        assert_eq!(mark.kind, PromptMarkKind::CommandEnd);
        assert_eq!(mark.exit_code, Some(42));
    }

    #[test]
    fn parses_command_end_with_extra_trailing_fields() {
        // Shells (Starship, OSC 133 b) may append `aid=...` or `cl=m`
        // trailers. Only the first numeric field matters.
        let bytes = b"\x1b]133;D;0;aid=123;cl=m\x07";
        let ParseStep::Consumed { mark, .. } = try_parse(bytes) else {
            panic!("expected Consumed");
        };
        assert_eq!(mark.kind, PromptMarkKind::CommandEnd);
        assert_eq!(mark.exit_code, Some(0));
    }

    #[test]
    fn parses_command_end_with_negative_exit_code() {
        let bytes = b"\x1b]133;D;-1\x07";
        let ParseStep::Consumed { mark, .. } = try_parse(bytes) else {
            panic!("expected Consumed");
        };
        assert_eq!(mark.exit_code, Some(-1));
    }

    #[test]
    fn command_end_without_payload_is_still_valid() {
        let bytes = b"\x1b]133;D\x07";
        let ParseStep::Consumed { mark, .. } = try_parse(bytes) else {
            panic!("expected Consumed");
        };
        assert_eq!(mark.kind, PromptMarkKind::CommandEnd);
        assert_eq!(mark.exit_code, None);
    }

    #[test]
    fn incomplete_when_terminator_missing() {
        let bytes = b"\x1b]133;A";
        assert!(matches!(try_parse(bytes), ParseStep::Incomplete));
    }

    #[test]
    fn incomplete_when_only_opener_prefix_present() {
        // Mid-stream tear: only `ESC ]` arrived. Do not advance yet.
        let bytes = b"\x1b]";
        assert!(matches!(try_parse(bytes), ParseStep::Incomplete));
    }

    #[test]
    fn none_when_not_osc_133() {
        assert!(matches!(try_parse(b"hello"), ParseStep::None));
        // OSC 0 (set title) must not be consumed by the OSC 133 parser.
        assert!(matches!(try_parse(b"\x1b]0;title\x07"), ParseStep::None));
        // An OSC 133 with an unknown kind byte is also rejected.
        assert!(matches!(try_parse(b"\x1b]133;Z\x07"), ParseStep::None));
    }

    #[test]
    fn log_records_in_order_with_monotonic_sequence() {
        let mut log = PromptMarkLog::new();
        let a = log.record(
            PromptMarkPayload {
                kind: PromptMarkKind::PromptStart,
                exit_code: None,
            },
            3,
            0,
        );
        let b = log.record(
            PromptMarkPayload {
                kind: PromptMarkKind::CommandEnd,
                exit_code: Some(0),
            },
            5,
            0,
        );
        assert_eq!(a.sequence, 0);
        assert_eq!(b.sequence, 1);
        assert_eq!(log.len(), 2);
        assert_eq!(log.as_slice()[0].screen_line, 3);
        assert_eq!(log.as_slice()[1].exit_code, Some(0));
    }

    #[test]
    fn log_caps_at_max_marks_evicting_oldest() {
        let mut log = PromptMarkLog::new();
        for _ in 0..MAX_MARKS + 50 {
            log.record(
                PromptMarkPayload {
                    kind: PromptMarkKind::PromptStart,
                    exit_code: None,
                },
                0,
                0,
            );
        }
        assert_eq!(log.len(), MAX_MARKS);
        // Monotonic sequence must reflect every call, even after eviction,
        // so consumers can detect gaps.
        assert_eq!(log.as_slice()[0].sequence, 50);
        assert_eq!(
            log.as_slice().last().unwrap().sequence,
            (MAX_MARKS + 49) as u64
        );
    }

    #[test]
    fn clear_drops_marks_but_keeps_sequence_counter() {
        let mut log = PromptMarkLog::new();
        log.record(
            PromptMarkPayload {
                kind: PromptMarkKind::PromptStart,
                exit_code: None,
            },
            0,
            0,
        );
        log.record(
            PromptMarkPayload {
                kind: PromptMarkKind::CommandEnd,
                exit_code: Some(0),
            },
            0,
            0,
        );
        log.clear();
        let next = log.record(
            PromptMarkPayload {
                kind: PromptMarkKind::PromptStart,
                exit_code: None,
            },
            0,
            0,
        );
        assert_eq!(
            next.sequence, 2,
            "sequence counter must stay monotonic across clears"
        );
    }
}
