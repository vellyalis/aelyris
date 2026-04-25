//! Boundary scanner for Kitty + Sixel image escape sequences.
//!
//! Mirrors the `ParseStep` shape used by `prompt_marks::try_parse` so the
//! engine's `advance()` method can multiplex both scanners over the same
//! combined buffer. The scanner does **not** decode payloads — it just
//! determines whether `bytes` begins with a complete image escape, an
//! incomplete prefix waiting for more data, or something unrelated.
//!
//! # Recognised sequences
//!
//! - **Kitty graphics protocol**: `ESC _ G <header> ; <payload> ESC \`
//!   - The header is `key=value` pairs separated by `,`. The semicolon
//!     splits the header from the payload (typically base64-encoded image
//!     bytes). Some Kitty escapes have *no* payload (control commands like
//!     `a=d` to delete images) in which case the `;` may be absent — we
//!     accept either form.
//! - **Sixel**: `ESC P <params> q <bitmap> ESC \`
//!   - `<params>` is `;`-separated decimal digits before the literal `q`.
//!     The `q` is what distinguishes a Sixel DCS from any other DCS
//!     introducer; without it we report `None` and let alacritty handle
//!     the bytes (it currently no-ops unknown DCS).
//!
//! Both formats terminate with `ST` = `ESC \` (`0x1b 0x5c`). Callers MUST
//! pass a buffer starting at an `ESC` byte; mid-sequence offsets return
//! `None`.

/// Image protocol identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageProtocol {
    Kitty,
    Sixel,
}

/// Raw payload extracted from a complete image escape, plus the protocol
/// it came from. Decoding lives in Sprint 2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImagePayload {
    pub protocol: ImageProtocol,
    /// Header bytes between the introducer and the payload separator.
    /// For Kitty this is the `key=value,…` block; for Sixel the
    /// `;`-separated parameter digits before `q`.
    pub header: Vec<u8>,
    /// Body bytes between the header separator and `ST`. For Kitty this
    /// is typically base64-encoded image data; for Sixel it is the raw
    /// six-bit bitmap encoding.
    pub body: Vec<u8>,
}

/// Result of inspecting the start of a buffer.
#[derive(Debug)]
pub enum ParseStep {
    /// A complete image escape was consumed.
    Consumed { bytes: usize, payload: ImagePayload },
    /// The buffer starts with a recognised image-escape introducer but the
    /// terminating `ST` has not arrived yet. The caller should stash the
    /// tail and wait for more bytes.
    Incomplete,
    /// The buffer does not start with an image escape.
    None,
}

const ESC: u8 = 0x1b;
const ST_BACKSLASH: u8 = 0x5c;

/// Try to parse `bytes` as a single image escape sequence starting at
/// offset 0. Returns one of `Consumed | Incomplete | None`.
pub fn try_parse(bytes: &[u8]) -> ParseStep {
    if bytes.len() < 3 || bytes[0] != ESC {
        return ParseStep::None;
    }
    match bytes[1] {
        b'_' if bytes[2] == b'G' => parse_kitty(bytes),
        b'P' => parse_sixel(bytes),
        _ => ParseStep::None,
    }
}

/// Parse `ESC _ G <header>[;<body>] ESC \`.
fn parse_kitty(bytes: &[u8]) -> ParseStep {
    debug_assert!(bytes.starts_with(&[ESC, b'_', b'G']));
    let after_introducer = 3usize;
    let Some(st_offset) = find_st(bytes, after_introducer) else {
        return ParseStep::Incomplete;
    };
    let inner = &bytes[after_introducer..st_offset];
    // Split header / body on the first ';'. Absence of ';' means a
    // header-only control command — body stays empty.
    let (header, body) = match inner.iter().position(|&b| b == b';') {
        Some(i) => (inner[..i].to_vec(), inner[i + 1..].to_vec()),
        None => (inner.to_vec(), Vec::new()),
    };
    ParseStep::Consumed {
        bytes: st_offset + 2,
        payload: ImagePayload {
            protocol: ImageProtocol::Kitty,
            header,
            body,
        },
    }
}

/// Parse `ESC P <params> q <bitmap> ESC \`.
///
/// Crucially we require the `q` introducer *before* the ST search: a
/// generic DCS without `q` is some other application (DECRQSS,
/// device-control queries, etc.) and we must report `None` so the bytes
/// flow to alacritty.
fn parse_sixel(bytes: &[u8]) -> ParseStep {
    debug_assert!(bytes[0] == ESC && bytes[1] == b'P');
    // Scan past optional decimal+`;` parameters until we find the final
    // byte. `q` means "this is Sixel"; anything else means it's not us.
    let mut i = 2usize;
    while i < bytes.len() {
        match bytes[i] {
            b'0'..=b'9' | b';' => i += 1,
            b'q' => break,
            // Any other byte before `q` disqualifies this DCS as Sixel.
            _ => return ParseStep::None,
        }
    }
    if i >= bytes.len() {
        // Could still grow into a Sixel introducer once more bytes arrive.
        return ParseStep::Incomplete;
    }
    debug_assert_eq!(bytes[i], b'q');
    let header = bytes[2..i].to_vec();
    let body_start = i + 1;
    let Some(st_offset) = find_st(bytes, body_start) else {
        return ParseStep::Incomplete;
    };
    let body = bytes[body_start..st_offset].to_vec();
    ParseStep::Consumed {
        bytes: st_offset + 2,
        payload: ImagePayload {
            protocol: ImageProtocol::Sixel,
            header,
            body,
        },
    }
}

/// Locate the first `ESC \` (`ST`) at or after `from`. The returned offset
/// is the index of the `ESC`; the full ST occupies offsets `[off, off+1]`.
fn find_st(bytes: &[u8], from: usize) -> Option<usize> {
    let mut i = from;
    while i + 1 < bytes.len() {
        if bytes[i] == ESC && bytes[i + 1] == ST_BACKSLASH {
            return Some(i);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_consumed(step: ParseStep) -> (usize, ImagePayload) {
        match step {
            ParseStep::Consumed { bytes, payload } => (bytes, payload),
            other => panic!("expected Consumed, got {other:?}"),
        }
    }

    #[test]
    fn returns_none_for_empty_or_short_buffers() {
        assert!(matches!(try_parse(&[]), ParseStep::None));
        assert!(matches!(try_parse(&[ESC]), ParseStep::None));
        assert!(matches!(try_parse(&[ESC, b'_']), ParseStep::None));
    }

    #[test]
    fn returns_none_when_not_starting_with_esc() {
        assert!(matches!(try_parse(b"hello"), ParseStep::None));
        assert!(matches!(try_parse(b"_Ghdr;body\x1b\\"), ParseStep::None));
    }

    #[test]
    fn parses_kitty_header_with_payload() {
        let input = b"\x1b_Ga=T,f=100;aGVsbG8=\x1b\\";
        let (n, payload) = assert_consumed(try_parse(input));
        assert_eq!(n, input.len());
        assert_eq!(payload.protocol, ImageProtocol::Kitty);
        assert_eq!(payload.header, b"a=T,f=100");
        assert_eq!(payload.body, b"aGVsbG8=");
    }

    #[test]
    fn parses_kitty_header_without_payload() {
        // `a=d` (delete image) takes no payload; the `;` separator is
        // optional in this case.
        let input = b"\x1b_Ga=d,d=A\x1b\\";
        let (n, payload) = assert_consumed(try_parse(input));
        assert_eq!(n, input.len());
        assert_eq!(payload.header, b"a=d,d=A");
        assert!(payload.body.is_empty());
    }

    #[test]
    fn kitty_incomplete_when_st_missing() {
        let input = b"\x1b_Ga=T,f=100;abc";
        assert!(matches!(try_parse(input), ParseStep::Incomplete));
    }

    #[test]
    fn parses_sixel_with_params() {
        let input = b"\x1bP0;1;0q!1~~~~\x1b\\";
        let (n, payload) = assert_consumed(try_parse(input));
        assert_eq!(n, input.len());
        assert_eq!(payload.protocol, ImageProtocol::Sixel);
        assert_eq!(payload.header, b"0;1;0");
        assert_eq!(payload.body, b"!1~~~~");
    }

    #[test]
    fn parses_sixel_without_params() {
        let input = b"\x1bPq~~~\x1b\\";
        let (n, payload) = assert_consumed(try_parse(input));
        assert_eq!(n, input.len());
        assert!(payload.header.is_empty());
        assert_eq!(payload.body, b"~~~");
    }

    #[test]
    fn sixel_incomplete_when_q_missing() {
        // No `q` yet — could still arrive in the next chunk.
        let input = b"\x1bP0;1";
        assert!(matches!(try_parse(input), ParseStep::Incomplete));
    }

    #[test]
    fn sixel_incomplete_when_st_missing() {
        let input = b"\x1bPq~~~";
        assert!(matches!(try_parse(input), ParseStep::Incomplete));
    }

    #[test]
    fn dcs_without_q_is_not_sixel() {
        // DECRQSS form: `ESC P $ q ... ESC \`. `$` before `q` means it's a
        // device control request, not Sixel — must report None.
        let input = b"\x1bP$qm\x1b\\";
        assert!(matches!(try_parse(input), ParseStep::None));
    }

    #[test]
    fn sixel_body_can_contain_high_ascii() {
        // Real sixel bitmaps include `~` (0x7e) and other printable bytes.
        let body: Vec<u8> = (0x3f..=0x7e).collect();
        let mut input = vec![ESC, b'P', b'q'];
        input.extend_from_slice(&body);
        input.extend_from_slice(b"\x1b\\");
        let (_, payload) = assert_consumed(try_parse(&input));
        assert_eq!(payload.body, body);
    }

    #[test]
    fn kitty_body_can_be_long() {
        let body = vec![b'A'; 4096];
        let mut input = vec![ESC, b'_', b'G', b'a', b'=', b'T', b';'];
        input.extend_from_slice(&body);
        input.extend_from_slice(b"\x1b\\");
        let (n, payload) = assert_consumed(try_parse(&input));
        assert_eq!(n, input.len());
        assert_eq!(payload.body, body);
    }

    #[test]
    fn unrelated_esc_returns_none() {
        // OSC 133 prefix — must not be mistaken for an image.
        assert!(matches!(try_parse(b"\x1b]133;A\x07"), ParseStep::None));
        // CSI clear screen.
        assert!(matches!(try_parse(b"\x1b[2J"), ParseStep::None));
    }
}
