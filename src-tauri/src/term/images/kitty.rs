//! Kitty graphics protocol header parser, payload decoder, and chunk
//! re-assembler.
//!
//! Headers are `key=value` pairs separated by `,`. Per the Kitty spec we
//! recognise (Sprint 1+2):
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
//! Sprint 2 only handles `t=d` (base64-encoded payload in-band). Other
//! transmission media (`t=f`, `t=t`, `t=s`) require filesystem or shared-
//! memory I/O and are deferred — emitting `UnsupportedTransmission` keeps
//! the failure visible without breaking the engine pipeline.
//!
//! Unknown header keys are tolerated and ignored — the protocol explicitly
//! reserves room for forward compatibility, so a newer Kitty can mix in
//! keys we haven't taught the parser yet without breaking the stream.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::decoded::{DecodedImage, DecodedPayload};
use super::sequences::ImageProtocol;

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

// ---------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------

/// Hard ceiling on a single Kitty image's resolved dimensions. Mirrors
/// the Sixel ceiling — anything larger is almost certainly a malformed
/// or hostile escape, and the decode would already exceed the per-
/// session memory cap before painting.
const MAX_DIMENSION: u32 = 8192;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum KittyDecodeError {
    #[error("transmission medium '{0}' is not supported (only 'd' / direct base64)")]
    UnsupportedTransmission(u8),
    #[error("pixel format {0} is not supported (only 24, 32, 100)")]
    UnsupportedFormat(u32),
    #[error("base64 decode failed at byte {offset}: {message}")]
    Base64 { offset: usize, message: String },
    #[error("payload requires width/height (s=, v=) for raw pixel formats")]
    DimensionsMissing,
    #[error("declared dimensions {width}x{height} exceed cap {cap}")]
    OversizedDimension { width: u32, height: u32, cap: u32 },
    #[error("payload size {got} does not match declared {expected} bytes")]
    SizeMismatch { expected: usize, got: usize },
    #[error("payload is empty")]
    Empty,
}

/// Decode a fully-assembled Kitty payload into a `DecodedImage`. The
/// payload is the base64 body the boundary scanner extracted (or the
/// concatenation of a chunked stream).
pub fn decode_kitty(
    header: &KittyHeader,
    payload: &[u8],
) -> Result<DecodedImage, KittyDecodeError> {
    if let Some(t) = header.transmission {
        if t != b'd' {
            return Err(KittyDecodeError::UnsupportedTransmission(t));
        }
    }
    if payload.is_empty() {
        return Err(KittyDecodeError::Empty);
    }

    let raw = B64.decode(payload).map_err(|e| KittyDecodeError::Base64 {
        offset: 0,
        message: e.to_string(),
    })?;
    if raw.is_empty() {
        return Err(KittyDecodeError::Empty);
    }

    // Default format is `100` (PNG) per the spec.
    let format = header.format.unwrap_or(100);
    match format {
        100 => decode_png(header, raw),
        32 => decode_rgba(header, raw),
        24 => decode_rgb(header, raw),
        other => Err(KittyDecodeError::UnsupportedFormat(other)),
    }
}

fn decode_png(header: &KittyHeader, raw: Vec<u8>) -> Result<DecodedImage, KittyDecodeError> {
    let (w, h) = png_dimensions(&raw).unwrap_or_else(|| {
        // Fall back to the header's declared dims; if neither path yields
        // a size, default to (0,0) — the caller can still ship the bytes
        // to the frontend which will decode the PNG itself.
        (
            header.pixel_width.unwrap_or(0),
            header.pixel_height.unwrap_or(0),
        )
    });
    if w > MAX_DIMENSION || h > MAX_DIMENSION {
        return Err(KittyDecodeError::OversizedDimension {
            width: w,
            height: h,
            cap: MAX_DIMENSION,
        });
    }
    Ok(DecodedImage {
        protocol: ImageProtocol::Kitty,
        payload: DecodedPayload::Png { bytes: raw },
        width_px: w,
        height_px: h,
        cell_cols: header.cell_cols,
        cell_rows: header.cell_rows,
    })
}

fn decode_rgba(header: &KittyHeader, raw: Vec<u8>) -> Result<DecodedImage, KittyDecodeError> {
    let (w, h) = require_dims(header)?;
    let expected = (w as usize)
        .checked_mul(h as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or(KittyDecodeError::OversizedDimension {
            width: w,
            height: h,
            cap: MAX_DIMENSION,
        })?;
    if raw.len() != expected {
        return Err(KittyDecodeError::SizeMismatch {
            expected,
            got: raw.len(),
        });
    }
    Ok(DecodedImage {
        protocol: ImageProtocol::Kitty,
        payload: DecodedPayload::Rgba8 { bytes: raw },
        width_px: w,
        height_px: h,
        cell_cols: header.cell_cols,
        cell_rows: header.cell_rows,
    })
}

fn decode_rgb(header: &KittyHeader, raw: Vec<u8>) -> Result<DecodedImage, KittyDecodeError> {
    let (w, h) = require_dims(header)?;
    let expected = (w as usize)
        .checked_mul(h as usize)
        .and_then(|n| n.checked_mul(3))
        .ok_or(KittyDecodeError::OversizedDimension {
            width: w,
            height: h,
            cap: MAX_DIMENSION,
        })?;
    if raw.len() != expected {
        return Err(KittyDecodeError::SizeMismatch {
            expected,
            got: raw.len(),
        });
    }
    // Inflate RGB → RGBA8 by appending a fully-opaque alpha byte.
    let mut rgba = Vec::with_capacity(expected / 3 * 4);
    for chunk in raw.chunks_exact(3) {
        rgba.extend_from_slice(chunk);
        rgba.push(0xff);
    }
    Ok(DecodedImage {
        protocol: ImageProtocol::Kitty,
        payload: DecodedPayload::Rgba8 { bytes: rgba },
        width_px: w,
        height_px: h,
        cell_cols: header.cell_cols,
        cell_rows: header.cell_rows,
    })
}

fn require_dims(header: &KittyHeader) -> Result<(u32, u32), KittyDecodeError> {
    let w = header
        .pixel_width
        .ok_or(KittyDecodeError::DimensionsMissing)?;
    let h = header
        .pixel_height
        .ok_or(KittyDecodeError::DimensionsMissing)?;
    if w == 0 || h == 0 {
        return Err(KittyDecodeError::DimensionsMissing);
    }
    if w > MAX_DIMENSION || h > MAX_DIMENSION {
        return Err(KittyDecodeError::OversizedDimension {
            width: w,
            height: h,
            cap: MAX_DIMENSION,
        });
    }
    Ok((w, h))
}

/// Pull `(width, height)` out of a PNG's IHDR chunk if the bytes look
/// like a PNG. Returns `None` for inputs that don't have the magic
/// signature so the caller can fall back to the Kitty header's
/// declared dimensions.
pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    // PNG signature (8 B) + IHDR length (4 B) + "IHDR" (4 B) + width (4 B)
    // + height (4 B) = 24 bytes minimum.
    if bytes.len() < 24 {
        return None;
    }
    if &bytes[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((w, h))
}

// ---------------------------------------------------------------------
// Chunk re-assembly
// ---------------------------------------------------------------------

/// Re-assembler for chunked Kitty escapes (`m=1` continuations under a
/// shared `i=N`). Caller feeds *every* `(header, body)` pair the boundary
/// scanner extracts; the assembler returns `Some((header, payload))` only
/// once the final `m=0` (or implied terminator) of a chain arrives.
///
/// Single-shot escapes (`m` flag absent) round-trip immediately. The
/// originating header is preserved across the chain so the caller still
/// sees the format / dimensions / cell rectangle the source declared.
#[derive(Debug, Default)]
pub struct KittyChunkAssembler {
    pending: HashMap<u32, PendingChunk>,
}

#[derive(Debug)]
struct PendingChunk {
    header: KittyHeader,
    body: Vec<u8>,
}

impl KittyChunkAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ingest one Kitty escape. Returns `Some((header, payload))` when
    /// the input completes an image (either standalone or the final
    /// chunk of a chain), otherwise `None` while the assembler waits for
    /// more chunks.
    pub fn ingest(&mut self, header: KittyHeader, body: Vec<u8>) -> Option<(KittyHeader, Vec<u8>)> {
        let Some(id) = header.image_id else {
            // No id means chunked re-assembly is impossible per the
            // protocol. Pass it through immediately — a `m=1` without
            // `i=` is malformed but we'd rather decode the fragment we
            // have than drop it silently.
            return Some((header, body));
        };

        if header.more {
            self.append_chunk(id, header, body);
            None
        } else if let Some(mut existing) = self.pending.remove(&id) {
            existing.body.extend_from_slice(&body);
            Some((existing.header, existing.body))
        } else {
            Some((header, body))
        }
    }

    fn append_chunk(&mut self, id: u32, header: KittyHeader, body: Vec<u8>) {
        match self.pending.get_mut(&id) {
            Some(existing) => existing.body.extend_from_slice(&body),
            None => {
                self.pending.insert(id, PendingChunk { header, body });
            }
        }
    }

    /// Drop everything currently in flight. Used on engine reset / clear.
    pub fn clear(&mut self) {
        self.pending.clear();
    }

    pub fn pending_ids(&self) -> usize {
        self.pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &str) -> Vec<u8> {
        B64.encode(s).into_bytes()
    }

    fn b64_bytes(b: &[u8]) -> Vec<u8> {
        B64.encode(b).into_bytes()
    }

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

    // ---------- decode_kitty ----------

    #[test]
    fn rejects_unsupported_transmission_medium() {
        let h = KittyHeader {
            transmission: Some(b'f'),
            ..Default::default()
        };
        let err = decode_kitty(&h, b"abc").unwrap_err();
        assert_eq!(err, KittyDecodeError::UnsupportedTransmission(b'f'));
    }

    #[test]
    fn rejects_unsupported_format() {
        let h = KittyHeader {
            format: Some(99),
            ..Default::default()
        };
        let err = decode_kitty(&h, &b64("hi")).unwrap_err();
        assert_eq!(err, KittyDecodeError::UnsupportedFormat(99));
    }

    #[test]
    fn empty_payload_rejected() {
        let h = KittyHeader::default();
        let err = decode_kitty(&h, b"").unwrap_err();
        assert_eq!(err, KittyDecodeError::Empty);
    }

    #[test]
    fn invalid_base64_returns_decode_error() {
        let h = KittyHeader::default();
        let err = decode_kitty(&h, b"!!!not-base64!!!").unwrap_err();
        assert!(matches!(err, KittyDecodeError::Base64 { .. }));
    }

    #[test]
    fn png_payload_passes_through_with_header_dims() {
        // Fake PNG: signature + IHDR with width=4, height=3.
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR length (13) + type (IHDR) + width (4) + height (3) + 5 bytes
        // of IHDR fields + 4-byte CRC placeholder.
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&4u32.to_be_bytes());
        png.extend_from_slice(&3u32.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]); // bit depth, color type, etc.
        png.extend_from_slice(&[0, 0, 0, 0]); // CRC placeholder
        let payload = b64_bytes(&png);
        let h = KittyHeader {
            format: Some(100),
            ..Default::default()
        };
        let img = decode_kitty(&h, &payload).unwrap();
        assert!(matches!(img.payload, DecodedPayload::Png { .. }));
        assert_eq!(img.width_px, 4);
        assert_eq!(img.height_px, 3);
    }

    #[test]
    fn rgba_payload_normalised_when_size_matches() {
        // 2x1 RGBA = 8 bytes.
        let raw = vec![0x10, 0x20, 0x30, 0xff, 0x40, 0x50, 0x60, 0xff];
        let payload = b64_bytes(&raw);
        let h = KittyHeader {
            format: Some(32),
            pixel_width: Some(2),
            pixel_height: Some(1),
            cell_cols: Some(1),
            cell_rows: Some(1),
            ..Default::default()
        };
        let img = decode_kitty(&h, &payload).unwrap();
        let DecodedPayload::Rgba8 { bytes } = &img.payload else {
            panic!("expected rgba")
        };
        assert_eq!(bytes, &raw);
        assert_eq!(img.cell_cols, Some(1));
        assert_eq!(img.cell_rows, Some(1));
    }

    #[test]
    fn rgb_payload_inflates_to_rgba_with_full_alpha() {
        let raw = vec![0x10, 0x20, 0x30];
        let payload = b64_bytes(&raw);
        let h = KittyHeader {
            format: Some(24),
            pixel_width: Some(1),
            pixel_height: Some(1),
            ..Default::default()
        };
        let img = decode_kitty(&h, &payload).unwrap();
        let DecodedPayload::Rgba8 { bytes } = &img.payload else {
            panic!("expected rgba")
        };
        assert_eq!(bytes, &[0x10, 0x20, 0x30, 0xff]);
    }

    #[test]
    fn rgba_size_mismatch_rejected() {
        let raw = vec![0u8; 7]; // expected 8 for 2x1 RGBA
        let payload = b64_bytes(&raw);
        let h = KittyHeader {
            format: Some(32),
            pixel_width: Some(2),
            pixel_height: Some(1),
            ..Default::default()
        };
        let err = decode_kitty(&h, &payload).unwrap_err();
        assert_eq!(
            err,
            KittyDecodeError::SizeMismatch {
                expected: 8,
                got: 7
            }
        );
    }

    #[test]
    fn raw_format_requires_dimensions() {
        let h = KittyHeader {
            format: Some(32),
            ..Default::default()
        };
        let err = decode_kitty(&h, &b64("aGVsbG8=")).unwrap_err();
        assert_eq!(err, KittyDecodeError::DimensionsMissing);
    }

    #[test]
    fn png_dimensions_returns_none_for_non_png_bytes() {
        assert!(png_dimensions(b"GIF89a....").is_none());
        assert!(png_dimensions(b"too-short").is_none());
    }

    // ---------- KittyChunkAssembler ----------

    #[test]
    fn standalone_image_passes_through_immediately() {
        let mut a = KittyChunkAssembler::new();
        let h = KittyHeader {
            format: Some(100),
            ..Default::default()
        };
        let out = a.ingest(h.clone(), b"hello".to_vec()).unwrap();
        assert_eq!(out.0, h);
        assert_eq!(out.1, b"hello");
        assert_eq!(a.pending_ids(), 0);
    }

    #[test]
    fn chunked_image_completes_only_on_final_chunk() {
        let mut a = KittyChunkAssembler::new();
        let head = KittyHeader {
            format: Some(100),
            image_id: Some(42),
            more: true,
            ..Default::default()
        };
        // First chunk — accumulator stashes.
        assert!(a.ingest(head.clone(), b"AAA".to_vec()).is_none());
        // Middle chunk — header is mostly empty (real Kitty middle
        // chunks omit format/dimensions; only `i=` and `m=1` survive).
        let mid = KittyHeader {
            image_id: Some(42),
            more: true,
            ..Default::default()
        };
        assert!(a.ingest(mid, b"BBB".to_vec()).is_none());
        // Final chunk — m=0, header still carries id.
        let tail = KittyHeader {
            image_id: Some(42),
            more: false,
            ..Default::default()
        };
        let (header, body) = a.ingest(tail, b"CCC".to_vec()).unwrap();
        // Original head.format must survive — that's the whole point of
        // preserving the first chunk's header across the chain.
        assert_eq!(header.format, Some(100));
        assert_eq!(body, b"AAABBBCCC");
        assert_eq!(a.pending_ids(), 0);
    }

    #[test]
    fn chunks_with_no_image_id_pass_through_each_time() {
        let mut a = KittyChunkAssembler::new();
        let head = KittyHeader {
            format: Some(100),
            more: true,
            ..Default::default()
        };
        assert!(a.ingest(head, b"AAA".to_vec()).is_some());
        assert_eq!(a.pending_ids(), 0);
    }

    #[test]
    fn distinct_image_ids_assemble_independently() {
        let mut a = KittyChunkAssembler::new();
        let h1 = KittyHeader {
            image_id: Some(1),
            more: true,
            format: Some(100),
            ..Default::default()
        };
        let h2 = KittyHeader {
            image_id: Some(2),
            more: true,
            format: Some(100),
            ..Default::default()
        };
        assert!(a.ingest(h1, b"X".to_vec()).is_none());
        assert!(a.ingest(h2.clone(), b"Y".to_vec()).is_none());
        assert_eq!(a.pending_ids(), 2);

        let tail1 = KittyHeader {
            image_id: Some(1),
            ..Default::default()
        };
        let (_, body1) = a.ingest(tail1, b"x".to_vec()).unwrap();
        assert_eq!(body1, b"Xx");
        assert_eq!(a.pending_ids(), 1);

        let tail2 = KittyHeader {
            image_id: Some(2),
            ..Default::default()
        };
        let (_, body2) = a.ingest(tail2, b"y".to_vec()).unwrap();
        assert_eq!(body2, b"Yy");
        assert_eq!(a.pending_ids(), 0);
    }

    #[test]
    fn clear_drops_pending_chunks() {
        let mut a = KittyChunkAssembler::new();
        let h = KittyHeader {
            image_id: Some(1),
            more: true,
            ..Default::default()
        };
        a.ingest(h, b"X".to_vec());
        assert_eq!(a.pending_ids(), 1);
        a.clear();
        assert_eq!(a.pending_ids(), 0);
    }
}
