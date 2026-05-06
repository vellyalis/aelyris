//! Sixel DCS body decoder.
//!
//! Sixel encodes a bitmap as 6-bit vertical pixel columns. Each printable
//! byte `?`..`~` (0x3f..0x7e) packs six pixels stacked top-to-bottom — bit
//! 0 of `(byte - 0x3f)` is the topmost pixel, bit 5 the bottommost.
//! Bands are six rows tall; `-` advances to the next band, `$` carriage-
//! returns to the band's start. Color introducer `#Pc` selects the active
//! palette slot; `#Pc;Pu;Px;Py;Pz` defines slot `Pc` (Pu=1 → HLS,
//! Pu=2 → RGB%). `!N` repeats the next sixel byte N times. Raster
//! attribute `"Pan;Pad;Ph;Pv` declares pixel dimensions.
//!
//! This module ships the minimum subset that decodes the output of every
//! tool we observed in the wild (chafa -f sixel, libsixel encode, viu's
//! sixel fallback). Notable simplifications:
//!
//! - Aspect ratio (`Pan/Pad`) is recorded only via the raster attribute's
//!   `Ph;Pv` which already encodes resolved pixel dimensions.
//! - Background mode `P2` is honoured to the extent that bits not written
//!   in the source stay transparent (alpha=0); opaque background fill is
//!   left to Sprint 3's paint layer.
//! - Palette is 256 slots; out-of-range indices saturate to slot 0.
//!
//! The decoder allocates a row-major RGBA8 buffer sized to the resolved
//! `(width × height)` so callers can hand the bytes straight to the
//! shared `DecodedImage` carrier.

use super::decoded::{DecodedImage, DecodedPayload};
use super::sequences::ImageProtocol;

/// Errors raised by the Sixel decoder. Each variant carries the byte
/// offset where the decoder gave up so a future logging pass can point
/// at the exact failure site without re-scanning the body.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SixelDecodeError {
    #[error("declared dimensions {width}x{height} exceed cap {cap}")]
    OversizedRaster { width: u32, height: u32, cap: u32 },
    #[error("decoded image is empty (no pixel data)")]
    Empty,
    #[error("malformed parameter list near byte {offset}")]
    BadParams { offset: usize },
}

/// Hard ceiling on a single Sixel image's resolved dimensions. 8192×8192
/// would already be 256 MiB of RGBA — well past the per-session cap.
/// Anything larger is almost certainly a malformed escape, not a real
/// image, and we'd rather refuse than allocate gigabytes.
const MAX_DIMENSION: u32 = 8192;

/// Decode a Sixel DCS body (the bytes between the introducer's `q` and
/// the terminating ST) into a `DecodedImage`. The optional `header` is
/// the parameter block before `q` (e.g. `b"0;1;0"`); it's accepted for
/// API symmetry with the Kitty decoder but Sprint 2 ignores it.
pub fn decode_sixel(body: &[u8], _header: &[u8]) -> Result<DecodedImage, SixelDecodeError> {
    let mut state = SixelState::new();
    state.run(body)?;
    state.finish()
}

/// Sprint-1 holdover: the boundary scanner already extracted the
/// parameter bytes; `SixelHeader` keeps them around so the decode call
/// can be wired without changing the scanner contract. Sprint 3 may
/// promote this to typed fields if the snapshot needs them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SixelHeader {
    pub raw_params: Vec<u8>,
}

pub fn parse_sixel_header(raw: &[u8]) -> SixelHeader {
    SixelHeader {
        raw_params: raw.to_vec(),
    }
}

#[derive(Debug, Clone, Copy)]
struct Rgba {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

const TRANSPARENT: Rgba = Rgba {
    r: 0,
    g: 0,
    b: 0,
    a: 0,
};

/// VT340-compatible default palette. `chafa -f sixel` and `libsixel`
/// both seed the same 16 colours before any `#Pc;…` definitions arrive,
/// so a body that only uses `#0..#15` decodes correctly even without
/// explicit palette setup.
const DEFAULT_PALETTE: [Rgba; 16] = [
    Rgba {
        r: 0,
        g: 0,
        b: 0,
        a: 255,
    }, // 0  black
    Rgba {
        r: 51,
        g: 51,
        b: 204,
        a: 255,
    }, // 1  blue
    Rgba {
        r: 204,
        g: 51,
        b: 51,
        a: 255,
    }, // 2  red
    Rgba {
        r: 51,
        g: 204,
        b: 51,
        a: 255,
    }, // 3  green
    Rgba {
        r: 204,
        g: 51,
        b: 204,
        a: 255,
    }, // 4  magenta
    Rgba {
        r: 51,
        g: 204,
        b: 204,
        a: 255,
    }, // 5  cyan
    Rgba {
        r: 204,
        g: 204,
        b: 51,
        a: 255,
    }, // 6  yellow
    Rgba {
        r: 128,
        g: 128,
        b: 128,
        a: 255,
    }, // 7  grey
    Rgba {
        r: 64,
        g: 64,
        b: 64,
        a: 255,
    }, // 8  dark grey
    Rgba {
        r: 102,
        g: 102,
        b: 153,
        a: 255,
    }, // 9  light blue
    Rgba {
        r: 153,
        g: 102,
        b: 102,
        a: 255,
    }, // 10 light red
    Rgba {
        r: 102,
        g: 153,
        b: 102,
        a: 255,
    }, // 11 light green
    Rgba {
        r: 153,
        g: 102,
        b: 153,
        a: 255,
    }, // 12 light magenta
    Rgba {
        r: 102,
        g: 153,
        b: 153,
        a: 255,
    }, // 13 light cyan
    Rgba {
        r: 153,
        g: 153,
        b: 102,
        a: 255,
    }, // 14 light yellow
    Rgba {
        r: 204,
        g: 204,
        b: 204,
        a: 255,
    }, // 15 white
];

struct SixelState {
    palette: [Rgba; 256],
    color: u8,
    /// Active band's top row in pixels. Each `-` (LF) advances by 6.
    band_top: u32,
    /// Cursor x within the current band.
    cursor_x: u32,
    /// Maximum x ever written + 1 (in pixels). Resolved width when the
    /// raster attribute did not declare one.
    max_x: u32,
    /// Maximum y ever written + 1 (in pixels).
    max_y: u32,
    /// Optional raster-attribute width (`Ph`).
    raster_w: Option<u32>,
    /// Optional raster-attribute height (`Pv`).
    raster_h: Option<u32>,
    /// Sparse pixel buffer keyed by `(x, y)`; densified on `finish()`.
    /// A `Vec<Vec<Option<u8>>>` indexed by band → x → palette slot would
    /// be denser for typical images but breaks down for anything taller
    /// than a screen. The flat `(x,y) -> color` map keeps allocator
    /// pressure low until we know the resolved dimensions.
    pixels: std::collections::HashMap<(u32, u32), u8>,
}

impl SixelState {
    fn new() -> Self {
        let mut palette = [TRANSPARENT; 256];
        for (i, c) in DEFAULT_PALETTE.iter().enumerate() {
            palette[i] = *c;
        }
        Self {
            palette,
            color: 0,
            band_top: 0,
            cursor_x: 0,
            max_x: 0,
            max_y: 0,
            raster_w: None,
            raster_h: None,
            pixels: std::collections::HashMap::new(),
        }
    }

    fn run(&mut self, body: &[u8]) -> Result<(), SixelDecodeError> {
        let mut i = 0usize;
        while i < body.len() {
            let b = body[i];
            match b {
                0x3f..=0x7e => {
                    self.write_sixel(b - 0x3f, 1);
                    i += 1;
                }
                b'!' => {
                    let (count, next) = read_uint(body, i + 1);
                    let count = count.unwrap_or(1).max(1);
                    if next < body.len() {
                        let ch = body[next];
                        if (0x3f..=0x7e).contains(&ch) {
                            self.write_sixel(ch - 0x3f, count);
                            i = next + 1;
                            continue;
                        }
                    }
                    // Trailing `!N` with nothing repeatable — treat as no-op.
                    i = next;
                }
                b'#' => {
                    let params = read_params(body, i + 1);
                    self.handle_color(&params.values, i)?;
                    i = params.end;
                }
                b'"' => {
                    let params = read_params(body, i + 1);
                    self.handle_raster(&params.values);
                    i = params.end;
                }
                b'$' => {
                    self.cursor_x = 0;
                    i += 1;
                }
                b'-' => {
                    self.cursor_x = 0;
                    self.band_top = self.band_top.saturating_add(6);
                    i += 1;
                }
                // Whitespace / unknown printable bytes inside a Sixel body
                // are spec-defined as ignored. This includes the literal
                // newlines some encoders insert for line-wrap niceness.
                _ => i += 1,
            }
        }
        Ok(())
    }

    fn handle_color(
        &mut self,
        params: &[Option<u32>],
        offset: usize,
    ) -> Result<(), SixelDecodeError> {
        match params.len() {
            0 => Ok(()),
            1 => {
                let pc = params[0].ok_or(SixelDecodeError::BadParams { offset })?;
                self.color = (pc.min(255)) as u8;
                Ok(())
            }
            _ => {
                // `#Pc;Pu;Px;Py;Pz`. Missing trailing components default
                // to 0 — matches libsixel's tolerance.
                let pc = params[0].ok_or(SixelDecodeError::BadParams { offset })?;
                let pu = params.get(1).copied().flatten().unwrap_or(2);
                let px = params.get(2).copied().flatten().unwrap_or(0);
                let py = params.get(3).copied().flatten().unwrap_or(0);
                let pz = params.get(4).copied().flatten().unwrap_or(0);
                let rgba = match pu {
                    1 => hls_to_rgb(px, py, pz),
                    _ => percent_to_rgb(px, py, pz),
                };
                let slot = pc.min(255) as usize;
                self.palette[slot] = rgba;
                self.color = slot as u8;
                Ok(())
            }
        }
    }

    fn handle_raster(&mut self, params: &[Option<u32>]) {
        // `"Pan;Pad;Ph;Pv` — only `Ph;Pv` (indices 2,3) become resolved
        // dimensions for our purposes. Aspect ratio numerator/denominator
        // are advisory and ignored at decode time.
        if let Some(Some(ph)) = params.get(2) {
            self.raster_w = Some(*ph);
        }
        if let Some(Some(pv)) = params.get(3) {
            self.raster_h = Some(*pv);
        }
    }

    fn write_sixel(&mut self, mask: u8, count: u32) {
        for _ in 0..count {
            let x = self.cursor_x;
            for bit in 0..6u32 {
                if (mask >> bit) & 1 == 1 {
                    let y = self.band_top + bit;
                    self.pixels.insert((x, y), self.color);
                    if x + 1 > self.max_x {
                        self.max_x = x + 1;
                    }
                    if y + 1 > self.max_y {
                        self.max_y = y + 1;
                    }
                }
            }
            self.cursor_x += 1;
        }
    }

    fn finish(self) -> Result<DecodedImage, SixelDecodeError> {
        let width = self.raster_w.unwrap_or(self.max_x);
        let height = self.raster_h.unwrap_or(self.max_y);
        if width == 0 || height == 0 {
            return Err(SixelDecodeError::Empty);
        }
        if width > MAX_DIMENSION || height > MAX_DIMENSION {
            return Err(SixelDecodeError::OversizedRaster {
                width,
                height,
                cap: MAX_DIMENSION,
            });
        }
        let total = (width as usize)
            .checked_mul(height as usize)
            .and_then(|v| v.checked_mul(4))
            .ok_or(SixelDecodeError::OversizedRaster {
                width,
                height,
                cap: MAX_DIMENSION,
            })?;
        let mut buf = vec![0u8; total];
        for ((x, y), slot) in self.pixels.into_iter() {
            if x >= width || y >= height {
                continue;
            }
            let c = self.palette[slot as usize];
            let off = ((y as usize) * (width as usize) + x as usize) * 4;
            buf[off] = c.r;
            buf[off + 1] = c.g;
            buf[off + 2] = c.b;
            buf[off + 3] = c.a;
        }
        Ok(DecodedImage {
            protocol: ImageProtocol::Sixel,
            payload: DecodedPayload::Rgba8 { bytes: buf },
            width_px: width,
            height_px: height,
            cell_cols: None,
            cell_rows: None,
        })
    }
}

/// Read an optional unsigned decimal at `start`. Returns the parsed value
/// (or `None` if there were no digits) and the index of the first byte
/// after the number.
fn read_uint(body: &[u8], start: usize) -> (Option<u32>, usize) {
    let mut i = start;
    let mut acc: u32 = 0;
    let mut any = false;
    while i < body.len() && body[i].is_ascii_digit() {
        acc = acc
            .saturating_mul(10)
            .saturating_add((body[i] - b'0') as u32);
        any = true;
        i += 1;
    }
    (if any { Some(acc) } else { None }, i)
}

struct ParamList {
    values: Vec<Option<u32>>,
    end: usize,
}

/// Parse a `;`-separated parameter list of optional decimals starting at
/// `start`. Stops at the first byte that is neither a digit nor `;`. The
/// return value's `values` mirrors the parameter positions (an empty
/// segment yields `None`), and `end` is the index of the first byte the
/// caller should resume scanning from.
fn read_params(body: &[u8], start: usize) -> ParamList {
    let mut values = Vec::new();
    let mut i = start;
    let mut current: Option<u32> = None;
    let mut any_digit_in_segment = false;
    loop {
        if i >= body.len() {
            break;
        }
        let b = body[i];
        if b.is_ascii_digit() {
            let acc = current.unwrap_or(0);
            current = Some(acc.saturating_mul(10).saturating_add((b - b'0') as u32));
            any_digit_in_segment = true;
            i += 1;
        } else if b == b';' {
            values.push(if any_digit_in_segment { current } else { None });
            current = None;
            any_digit_in_segment = false;
            i += 1;
        } else {
            break;
        }
    }
    if any_digit_in_segment || !values.is_empty() {
        values.push(if any_digit_in_segment { current } else { None });
    }
    ParamList { values, end: i }
}

/// Convert an RGB triplet expressed as 0..100 (Sixel color spec) into
/// 0..255 RGBA. Values above 100 saturate.
fn percent_to_rgb(r: u32, g: u32, b: u32) -> Rgba {
    Rgba {
        r: ((r.min(100) * 255) / 100) as u8,
        g: ((g.min(100) * 255) / 100) as u8,
        b: ((b.min(100) * 255) / 100) as u8,
        a: 255,
    }
}

/// Convert HLS (Sixel: H 0..360, L 0..100, S 0..100) into 8-bit RGBA.
/// Sixel uses HLS, not HSL — the order of L and S is swapped relative to
/// the more common CSS notation. We handle the protocol order here and
/// rely on the caller to supply (H, L, S) at indices (Px, Py, Pz).
fn hls_to_rgb(h: u32, l: u32, s: u32) -> Rgba {
    let h = (h.min(360) as f32) / 360.0;
    let l = (l.min(100) as f32) / 100.0;
    let s = (s.min(100) as f32) / 100.0;
    if s == 0.0 {
        let v = (l * 255.0).round() as u8;
        return Rgba {
            r: v,
            g: v,
            b: v,
            a: 255,
        };
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let r = hue_to_rgb(p, q, h + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h);
    let b = hue_to_rgb(p, q, h - 1.0 / 3.0);
    Rgba {
        r: (r * 255.0).round().clamp(0.0, 255.0) as u8,
        g: (g * 255.0).round().clamp(0.0, 255.0) as u8,
        b: (b * 255.0).round().clamp(0.0, 255.0) as u8,
        a: 255,
    }
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 1.0 / 2.0 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(img: &DecodedImage, x: u32, y: u32) -> [u8; 4] {
        let DecodedPayload::Rgba8 { bytes } = &img.payload else {
            panic!("expected RGBA payload");
        };
        let off = ((y as usize) * (img.width_px as usize) + x as usize) * 4;
        [bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]]
    }

    #[test]
    fn passes_through_raw_params() {
        let h = parse_sixel_header(b"0;1;0");
        assert_eq!(h.raw_params, b"0;1;0");
    }

    #[test]
    fn empty_params_yield_empty_raw() {
        let h = parse_sixel_header(b"");
        assert!(h.raw_params.is_empty());
    }

    #[test]
    fn empty_body_returns_empty_error() {
        let err = decode_sixel(b"", b"").unwrap_err();
        assert_eq!(err, SixelDecodeError::Empty);
    }

    #[test]
    fn single_sixel_writes_six_pixels_of_color_zero() {
        // `~` = 0x7e → all six bits set.
        let img = decode_sixel(b"~", b"").unwrap();
        assert_eq!(img.width_px, 1);
        assert_eq!(img.height_px, 6);
        for y in 0..6 {
            assert_eq!(
                pixel(&img, 0, y),
                [0, 0, 0, 255],
                "row {y} should be palette[0]"
            );
        }
    }

    #[test]
    fn sixel_question_mark_writes_no_pixels() {
        // `?` = 0x3f → mask 0, no pixels — image is empty -> error.
        let err = decode_sixel(b"?", b"").unwrap_err();
        assert_eq!(err, SixelDecodeError::Empty);
    }

    #[test]
    fn repeat_command_writes_n_columns() {
        // `!4~` → 4 columns of full sixels.
        let img = decode_sixel(b"!4~", b"").unwrap();
        assert_eq!(img.width_px, 4);
        assert_eq!(img.height_px, 6);
        for x in 0..4 {
            assert_eq!(pixel(&img, x, 0), [0, 0, 0, 255]);
        }
    }

    #[test]
    fn carriage_return_overlays_second_color() {
        // Define palette[1] as red, draw 4 columns of color 0, CR, draw 2
        // columns of color 1 → the first 2 columns are red, the next 2
        // remain palette[0].
        let body = b"#1;2;100;0;0#0!4~$#1!2~";
        let img = decode_sixel(body, b"").unwrap();
        assert_eq!(img.width_px, 4);
        assert_eq!(img.height_px, 6);
        assert_eq!(pixel(&img, 0, 0), [255, 0, 0, 255]);
        assert_eq!(pixel(&img, 1, 0), [255, 0, 0, 255]);
        assert_eq!(pixel(&img, 2, 0), [0, 0, 0, 255]);
        assert_eq!(pixel(&img, 3, 0), [0, 0, 0, 255]);
    }

    #[test]
    fn line_feed_advances_band_by_six_rows() {
        let img = decode_sixel(b"~-~", b"").unwrap();
        assert_eq!(img.width_px, 1);
        assert_eq!(img.height_px, 12);
        assert_eq!(pixel(&img, 0, 0), [0, 0, 0, 255]);
        assert_eq!(pixel(&img, 0, 6), [0, 0, 0, 255]);
        // Row 5 of band 0 is set; row 11 (=band 1, bit 5) is set; the
        // row in between (6..=11) is band 1 bit 0..5 — all set.
        for y in 0..12 {
            assert_eq!(pixel(&img, 0, y), [0, 0, 0, 255], "y={y}");
        }
    }

    #[test]
    fn raster_attribute_pads_image_to_declared_size() {
        // Single sixel, but raster says 4×6. The empty columns are
        // transparent (alpha=0).
        let img = decode_sixel(b"\"1;1;4;6~", b"").unwrap();
        assert_eq!(img.width_px, 4);
        assert_eq!(img.height_px, 6);
        assert_eq!(pixel(&img, 0, 0), [0, 0, 0, 255]);
        assert_eq!(pixel(&img, 3, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn rgb_color_definition_uses_percent_to_byte_scale() {
        let img = decode_sixel(b"#1;2;50;50;50#1~", b"").unwrap();
        // 50% of 255 = 127 (integer math).
        assert_eq!(pixel(&img, 0, 0), [127, 127, 127, 255]);
    }

    #[test]
    fn hls_color_definition_round_trips_pure_red() {
        // HLS (0, 50, 100) → pure red (0xff, 0, 0).
        let img = decode_sixel(b"#1;1;0;50;100#1~", b"").unwrap();
        assert_eq!(pixel(&img, 0, 0), [255, 0, 0, 255]);
    }

    #[test]
    fn oversized_raster_rejected() {
        let body = format!("\"1;1;{};{}~", MAX_DIMENSION + 1, MAX_DIMENSION + 1);
        let err = decode_sixel(body.as_bytes(), b"").unwrap_err();
        assert!(matches!(err, SixelDecodeError::OversizedRaster { .. }));
    }

    #[test]
    fn unknown_bytes_inside_body_are_skipped() {
        // `\n` between sixel chars is not in the spec but commonly
        // emitted by encoders for readability — must not poison decode.
        let img = decode_sixel(b"~\n~", b"").unwrap();
        assert_eq!(img.width_px, 2);
    }
}
