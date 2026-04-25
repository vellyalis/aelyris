//! Kitty graphics protocol header parser.
//!
//! Headers are `key=value` pairs separated by `,`. Per the Kitty spec we
//! recognise (Sprint 1):
//!
//! | Key | Meaning |
//! |-----|---------|
//! | `a` | Action (`T`=transmit+display, `t`=transmit, `p`=present, `d`=delete, `q`=query) |
//! | `f` | Pixel format (`100`=PNG, `32`=RGBA, `24`=RGB) |
//! | `t` | Transmission medium (`d`=direct base64, `f`=file path, `t`=temp file, `s`=shared mem) |
//! | `m` | More chunks follow (`1`=yes, `0`/missing=no) |
//! | `i` | Image id (numeric) |
//! | `s` | Pixel width |
//! | `v` | Pixel height |
//! | `c` | Display columns |
//! | `r` | Display rows |
//!
//! Unknown keys are tolerated and ignored — the protocol explicitly
//! reserves room for forward compatibility, so a newer Kitty can mix in
//! keys we haven't taught the parser yet without breaking the stream.

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KittyHeader {
    /// `a=` — action. Single character, defaults to `T` per the protocol.
    pub action: Option<u8>,
    /// `f=` — pixel format.
    pub format: Option<u32>,
    /// `t=` — transmission medium.
    pub transmission: Option<u8>,
    /// `m=` — more-chunks-follow flag. `true` when the next sequence
    /// continues the same image.
    pub more: bool,
    /// `i=` — image id.
    pub image_id: Option<u32>,
    /// `s=` — pixel width.
    pub pixel_width: Option<u32>,
    /// `v=` — pixel height.
    pub pixel_height: Option<u32>,
    /// `c=` — display columns.
    pub cell_cols: Option<u32>,
    /// `r=` — display rows.
    pub cell_rows: Option<u32>,
}

/// Parse the header part of a Kitty graphics escape (everything between
/// `ESC _ G` and `;` or `ESC \`). Unknown keys are silently dropped;
/// malformed values cause the affected key to stay `None` rather than
/// failing the whole header.
pub fn parse_kitty_header(header: &[u8]) -> KittyHeader {
    let mut out = KittyHeader::default();
    if header.is_empty() {
        return out;
    }
    for pair in header.split(|&b| b == b',') {
        if pair.is_empty() {
            continue;
        }
        let Some(eq) = pair.iter().position(|&b| b == b'=') else {
            continue;
        };
        let key = &pair[..eq];
        let value = &pair[eq + 1..];
        if value.is_empty() {
            continue;
        }
        match key {
            b"a" => out.action = first_byte(value),
            b"f" => out.format = parse_u32(value),
            b"t" => out.transmission = first_byte(value),
            b"m" => out.more = value == b"1",
            b"i" => out.image_id = parse_u32(value),
            b"s" => out.pixel_width = parse_u32(value),
            b"v" => out.pixel_height = parse_u32(value),
            b"c" => out.cell_cols = parse_u32(value),
            b"r" => out.cell_rows = parse_u32(value),
            _ => {} // forward-compat: ignore unknowns
        }
    }
    out
}

fn first_byte(value: &[u8]) -> Option<u8> {
    value.first().copied()
}

fn parse_u32(value: &[u8]) -> Option<u32> {
    std::str::from_utf8(value).ok()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_header_returns_default() {
        let h = parse_kitty_header(b"");
        assert_eq!(h, KittyHeader::default());
    }

    #[test]
    fn parses_full_transmit_display() {
        let h = parse_kitty_header(b"a=T,f=100,t=d,i=42,s=128,v=64,c=10,r=5");
        assert_eq!(h.action, Some(b'T'));
        assert_eq!(h.format, Some(100));
        assert_eq!(h.transmission, Some(b'd'));
        assert!(!h.more);
        assert_eq!(h.image_id, Some(42));
        assert_eq!(h.pixel_width, Some(128));
        assert_eq!(h.pixel_height, Some(64));
        assert_eq!(h.cell_cols, Some(10));
        assert_eq!(h.cell_rows, Some(5));
    }

    #[test]
    fn more_chunks_flag_only_true_for_one() {
        assert!(parse_kitty_header(b"a=T,m=1").more);
        assert!(!parse_kitty_header(b"a=T,m=0").more);
        assert!(!parse_kitty_header(b"a=T").more);
    }

    #[test]
    fn unknown_keys_are_ignored() {
        let h = parse_kitty_header(b"a=T,xyz=99,future=hello,f=100");
        assert_eq!(h.action, Some(b'T'));
        assert_eq!(h.format, Some(100));
    }

    #[test]
    fn malformed_pairs_are_skipped() {
        // Bare key, empty value, leading/trailing comma — none of these
        // should poison the keys that *do* parse.
        let h = parse_kitty_header(b",a=T,nope,empty=,f=100,");
        assert_eq!(h.action, Some(b'T'));
        assert_eq!(h.format, Some(100));
    }

    #[test]
    fn invalid_numeric_value_leaves_field_none() {
        let h = parse_kitty_header(b"a=T,i=abc,s=12");
        assert_eq!(h.action, Some(b'T'));
        assert_eq!(h.image_id, None);
        assert_eq!(h.pixel_width, Some(12));
    }
}
