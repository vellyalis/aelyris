//! Chunked OSC 1338 inline-image protocol — Sprint 1.
//!
//! On Win11 25H2 ConPTY silently strips Kitty APC sequences and truncates
//! any single OSC longer than ~512 bytes (see
//! `docs/ROADMAP_POST_0_2_4.md` Tier 🔴 #1). The chunked OSC protocol
//! works around both limits by splitting a real PNG / RGBA image into
//! many short OSC frames and re-assembling them in the engine.
//!
//! Wire format (full spec: `docs/chunked-osc-image-protocol.md`):
//!
//! ```text
//! ESC ] 1338 ; B ; <id> ; <format> ; <w> ; <h>   ( BEL | ESC \ )
//! ESC ] 1338 ; D ; <id> ; <chunk-idx> ; <base64> ( BEL | ESC \ )
//! ESC ] 1338 ; E ; <id>                          ( BEL | ESC \ )
//! ```
//!
//! `<format>` is `png` or `rgba`. Chunks may arrive out of order; `END`
//! validates contiguity and decodes base64 once over the concatenation.
//!
//! Linux / macOS PTYs already deliver Kitty APC end-to-end; this protocol
//! is portable but its primary purpose is restoring inline-image
//! rendering on Windows.

use std::collections::{BTreeMap, HashMap};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::decoded::{DecodedImage, DecodedPayload};
use super::sequences::ImageProtocol;

/// Per-image ceiling on raw decoded bytes. Mirrors `IMAGE_BYTE_CAP` so a
/// chunked transfer cannot blow the per-session memory cap on its own.
const MAX_RAW_BYTES_PER_IMAGE: usize = 50 * 1024 * 1024;

/// Per-image ceiling on the number of `DATA` chunks. A 32 KB PNG round-
/// trips in ~88 chunks under the ConPTY OSC cap; 16384 leaves a >180×
/// margin before a runaway emitter could stall the assembler with a
/// pathological chunk count.
const MAX_CHUNKS_PER_IMAGE: usize = 16_384;

/// Hard ceiling on declared dimensions. Matches the Kitty / Sixel decoder
/// guards — anything larger is almost certainly hostile or malformed and
/// would breach the per-session memory cap before reaching the paint pass.
const MAX_DIMENSION: u32 = 8192;

const PREFIX: &[u8] = b"\x1b]1338;";

/// Pixel encoding declared by the `BEGIN` frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkedOscFormat {
    /// PNG byte stream — passes through to the frontend untouched.
    Png,
    /// Raw RGBA8 pixel buffer — `width * height * 4` bytes.
    Rgba,
}

/// One parsed OSC 1338 frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChunkedOscPayload {
    Begin {
        image_id: u32,
        format: ChunkedOscFormat,
        width: u32,
        height: u32,
    },
    Data {
        image_id: u32,
        chunk_idx: u32,
        chunk_b64: Vec<u8>,
    },
    End {
        image_id: u32,
    },
    /// Frame opened with `\e]1338;` and terminated cleanly but the verb
    /// or fields did not parse. The bytes are consumed from the stream
    /// (so the grid never sees them) but the engine should not feed a
    /// malformed frame to the assembler.
    Malformed,
}

/// Result of inspecting the start of a buffer for an OSC 1338 frame.
#[derive(Debug)]
pub enum ParseStep {
    /// A complete frame was consumed.
    Consumed {
        bytes: usize,
        payload: ChunkedOscPayload,
    },
    /// The buffer starts with `\e]1338;` but the terminator (`BEL` or
    /// `ESC \`) has not arrived yet. Caller should stash and retry.
    Incomplete,
    /// The buffer does not start with an OSC 1338 prefix.
    None,
}

/// Try to parse `bytes` as an OSC 1338 frame starting at offset 0.
pub fn try_parse(bytes: &[u8]) -> ParseStep {
    if !bytes.starts_with(PREFIX) {
        // Could still be the opening of a partial prefix — return
        // Incomplete so the engine stashes the tail.
        if PREFIX.starts_with(bytes) {
            return ParseStep::Incomplete;
        }
        return ParseStep::None;
    }

    // Locate terminator: BEL or ST (`ESC \`).
    let body_start = PREFIX.len();
    let mut i = body_start;
    let mut term_len = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            0x07 => {
                term_len = 1;
                break;
            }
            0x1b if bytes.get(i + 1) == Some(&0x5c) => {
                term_len = 2;
                break;
            }
            _ => i += 1,
        }
    }
    if term_len == 0 {
        return ParseStep::Incomplete;
    }
    let body = &bytes[body_start..i];
    let consumed = i + term_len;

    let payload = parse_body(body);
    ParseStep::Consumed {
        bytes: consumed,
        payload,
    }
}

/// Split the body on `;` and dispatch to the verb-specific parser.
fn parse_body(body: &[u8]) -> ChunkedOscPayload {
    // base64 alphabet excludes `;`, so `;`-splitting is safe even when
    // `<base64-block>` is the last field.
    let fields: Vec<&[u8]> = body.split(|&b| b == b';').collect();
    if fields.is_empty() {
        return ChunkedOscPayload::Malformed;
    }
    match fields[0] {
        b"B" => parse_begin(&fields),
        b"D" => parse_data(&fields),
        b"E" => parse_end(&fields),
        _ => ChunkedOscPayload::Malformed,
    }
}

fn parse_begin(fields: &[&[u8]]) -> ChunkedOscPayload {
    if fields.len() != 5 {
        return ChunkedOscPayload::Malformed;
    }
    let Some(image_id) = parse_u32(fields[1]) else {
        return ChunkedOscPayload::Malformed;
    };
    let Some(format) = parse_format(fields[2]) else {
        return ChunkedOscPayload::Malformed;
    };
    let Some(width) = parse_u32(fields[3]).filter(|w| *w > 0 && *w <= MAX_DIMENSION) else {
        return ChunkedOscPayload::Malformed;
    };
    let Some(height) = parse_u32(fields[4]).filter(|h| *h > 0 && *h <= MAX_DIMENSION) else {
        return ChunkedOscPayload::Malformed;
    };
    ChunkedOscPayload::Begin {
        image_id,
        format,
        width,
        height,
    }
}

fn parse_data(fields: &[&[u8]]) -> ChunkedOscPayload {
    if fields.len() != 4 {
        return ChunkedOscPayload::Malformed;
    }
    let Some(image_id) = parse_u32(fields[1]) else {
        return ChunkedOscPayload::Malformed;
    };
    let Some(chunk_idx) = parse_u32(fields[2]) else {
        return ChunkedOscPayload::Malformed;
    };
    ChunkedOscPayload::Data {
        image_id,
        chunk_idx,
        chunk_b64: fields[3].to_vec(),
    }
}

fn parse_end(fields: &[&[u8]]) -> ChunkedOscPayload {
    if fields.len() != 2 {
        return ChunkedOscPayload::Malformed;
    }
    let Some(image_id) = parse_u32(fields[1]) else {
        return ChunkedOscPayload::Malformed;
    };
    ChunkedOscPayload::End { image_id }
}

fn parse_format(value: &[u8]) -> Option<ChunkedOscFormat> {
    match value {
        b"png" => Some(ChunkedOscFormat::Png),
        b"rgba" => Some(ChunkedOscFormat::Rgba),
        _ => None,
    }
}

fn parse_u32(value: &[u8]) -> Option<u32> {
    std::str::from_utf8(value).ok()?.parse().ok()
}

// ---------------------------------------------------------------------
// Chunk assembler
// ---------------------------------------------------------------------

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AssemblerError {
    /// `DATA` or `END` arrived for an `image-id` that has no open `BEGIN`.
    #[error("frame for unknown image_id={0}")]
    UnknownImageId(u32),
    /// Two `DATA` frames declared the same `chunk-idx`.
    #[error("duplicate chunk image_id={image_id} chunk_idx={chunk_idx}")]
    DuplicateChunk { image_id: u32, chunk_idx: u32 },
    /// `END` validation found `chunk-idx`es that were never received.
    #[error("missing chunk image_id={image_id} chunk_idx={chunk_idx}")]
    ChunkGap { image_id: u32, chunk_idx: u32 },
    /// More than `MAX_CHUNKS_PER_IMAGE` chunks were submitted for one id.
    #[error("chunk count exceeds limit ({MAX_CHUNKS_PER_IMAGE}) for image_id={0}")]
    ChunkLimitExceeded(u32),
    /// Accumulated base64 + decoded bytes would exceed the per-image cap.
    #[error("payload exceeds {MAX_RAW_BYTES_PER_IMAGE}-byte cap for image_id={0}")]
    SizeLimitExceeded(u32),
    /// `END` could not base64-decode the concatenation.
    #[error("base64 decode failed for image_id={0}")]
    InvalidBase64(u32),
    /// `format=rgba` declared `w*h*4` but the decoded byte length differed.
    #[error("rgba size mismatch image_id={image_id} expected={expected} got={got}")]
    DimensionMismatch {
        image_id: u32,
        expected: usize,
        got: usize,
    },
}

/// Per-id state carried between `BEGIN` and `END`.
#[derive(Debug)]
struct PendingImage {
    format: ChunkedOscFormat,
    width: u32,
    height: u32,
    chunks: BTreeMap<u32, Vec<u8>>,
    /// Sum of `chunks` payload lengths in base64 bytes. Bound by
    /// `MAX_RAW_BYTES_PER_IMAGE * 4 / 3` (the b64 inflation factor).
    base64_total: usize,
}

impl PendingImage {
    fn footprint_after(&self, additional: usize) -> usize {
        self.base64_total.saturating_add(additional)
    }
}

/// Outcome of feeding one frame to the assembler.
#[derive(Debug)]
pub enum AssemblerOutcome {
    /// More frames expected for this id.
    Pending,
    /// `END` validated; caller should promote to `ImageStore`.
    Completed {
        image_id: u32,
        format: ChunkedOscFormat,
        raw_bytes: Vec<u8>,
        decoded: DecodedImage,
    },
    /// Validation failed; the entry has been removed from the assembler.
    /// `partial_bytes` is the best-effort base64 concatenation of frames
    /// received before the failure, intentionally NOT base64-decoded —
    /// the diagnostic surface inserts it as `bytes` with `decoded=None`
    /// to mirror the existing single-shot Kitty error path.
    Failed {
        image_id: u32,
        error: AssemblerError,
        partial_bytes: Vec<u8>,
    },
}

#[derive(Debug, Default)]
pub struct ChunkAssembler {
    pending: HashMap<u32, PendingImage>,
}

impl ChunkAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of in-flight transfers. Test / diagnostic helper.
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    /// Drop all in-flight state. Called when the engine is reset or the
    /// session ends — partial transfers are discarded silently.
    pub fn clear(&mut self) {
        self.pending.clear();
    }

    /// Feed one parsed frame. The caller is responsible for filtering out
    /// `ChunkedOscPayload::Malformed` (the parser emits it for OSC 1338
    /// frames that we couldn't decode field-by-field; passing one in here
    /// would be a programmer error).
    pub fn ingest(&mut self, payload: ChunkedOscPayload) -> AssemblerOutcome {
        match payload {
            ChunkedOscPayload::Begin {
                image_id,
                format,
                width,
                height,
            } => {
                self.pending.insert(
                    image_id,
                    PendingImage {
                        format,
                        width,
                        height,
                        chunks: BTreeMap::new(),
                        base64_total: 0,
                    },
                );
                AssemblerOutcome::Pending
            }
            ChunkedOscPayload::Data {
                image_id,
                chunk_idx,
                chunk_b64,
            } => self.ingest_data(image_id, chunk_idx, chunk_b64),
            ChunkedOscPayload::End { image_id } => self.ingest_end(image_id),
            ChunkedOscPayload::Malformed => {
                // Treat as a soft no-op. The engine should not be passing
                // Malformed in here, but surfacing it as Pending keeps the
                // assembler pure rather than panicking.
                AssemblerOutcome::Pending
            }
        }
    }

    fn ingest_data(
        &mut self,
        image_id: u32,
        chunk_idx: u32,
        chunk_b64: Vec<u8>,
    ) -> AssemblerOutcome {
        let Some(entry) = self.pending.get_mut(&image_id) else {
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::UnknownImageId(image_id),
                partial_bytes: Vec::new(),
            };
        };

        if entry.chunks.contains_key(&chunk_idx) {
            let partial = drain_partial_bytes(self.pending.remove(&image_id));
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::DuplicateChunk {
                    image_id,
                    chunk_idx,
                },
                partial_bytes: partial,
            };
        }
        if entry.chunks.len() >= MAX_CHUNKS_PER_IMAGE {
            let partial = drain_partial_bytes(self.pending.remove(&image_id));
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::ChunkLimitExceeded(image_id),
                partial_bytes: partial,
            };
        }
        // base64 inflates by 4/3 — convert the cap up front so we compare
        // apples to apples without doing 64-bit math per chunk.
        let base64_cap = MAX_RAW_BYTES_PER_IMAGE.saturating_mul(4).saturating_div(3);
        if entry.footprint_after(chunk_b64.len()) > base64_cap {
            let partial = drain_partial_bytes(self.pending.remove(&image_id));
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::SizeLimitExceeded(image_id),
                partial_bytes: partial,
            };
        }

        entry.base64_total += chunk_b64.len();
        entry.chunks.insert(chunk_idx, chunk_b64);
        AssemblerOutcome::Pending
    }

    fn ingest_end(&mut self, image_id: u32) -> AssemblerOutcome {
        let Some(entry) = self.pending.remove(&image_id) else {
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::UnknownImageId(image_id),
                partial_bytes: Vec::new(),
            };
        };
        // Validate contiguity 0..N-1.
        let expected_len = entry.chunks.len() as u32;
        for idx in 0..expected_len {
            if !entry.chunks.contains_key(&idx) {
                let partial = concat_partial(&entry);
                return AssemblerOutcome::Failed {
                    image_id,
                    error: AssemblerError::ChunkGap {
                        image_id,
                        chunk_idx: idx,
                    },
                    partial_bytes: partial,
                };
            }
        }
        // Concat in chunk-idx order. BTreeMap iterates sorted, so a single
        // pass through `values()` is already in order.
        let mut concatenated = Vec::with_capacity(entry.base64_total);
        for buf in entry.chunks.values() {
            concatenated.extend_from_slice(buf);
        }
        // Decode base64 once over the concatenation.
        let raw_bytes = match B64.decode(&concatenated) {
            Ok(v) => v,
            Err(_) => {
                return AssemblerOutcome::Failed {
                    image_id,
                    error: AssemblerError::InvalidBase64(image_id),
                    partial_bytes: concatenated,
                };
            }
        };
        if raw_bytes.len() > MAX_RAW_BYTES_PER_IMAGE {
            return AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::SizeLimitExceeded(image_id),
                partial_bytes: concatenated,
            };
        }
        // Build the DecodedImage according to the declared format.
        let decoded = match entry.format {
            ChunkedOscFormat::Png => DecodedImage {
                protocol: ImageProtocol::Kitty,
                payload: DecodedPayload::Png {
                    bytes: raw_bytes.clone(),
                },
                width_px: entry.width,
                height_px: entry.height,
                cell_cols: None,
                cell_rows: None,
            },
            ChunkedOscFormat::Rgba => {
                let expected = (entry.width as usize)
                    .saturating_mul(entry.height as usize)
                    .saturating_mul(4);
                if raw_bytes.len() != expected {
                    return AssemblerOutcome::Failed {
                        image_id,
                        error: AssemblerError::DimensionMismatch {
                            image_id,
                            expected,
                            got: raw_bytes.len(),
                        },
                        partial_bytes: concatenated,
                    };
                }
                DecodedImage {
                    protocol: ImageProtocol::Kitty,
                    payload: DecodedPayload::Rgba8 {
                        bytes: raw_bytes.clone(),
                    },
                    width_px: entry.width,
                    height_px: entry.height,
                    cell_cols: None,
                    cell_rows: None,
                }
            }
        };
        AssemblerOutcome::Completed {
            image_id,
            format: entry.format,
            raw_bytes,
            decoded,
        }
    }
}

/// Concatenate the base64 chunks of a `PendingImage` in chunk-idx order
/// for the diagnostic `partial_bytes` field.
fn concat_partial(entry: &PendingImage) -> Vec<u8> {
    let mut out = Vec::with_capacity(entry.base64_total);
    for buf in entry.chunks.values() {
        out.extend_from_slice(buf);
    }
    out
}

fn drain_partial_bytes(entry: Option<PendingImage>) -> Vec<u8> {
    entry.map(|e| concat_partial(&e)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_consumed(step: ParseStep) -> (usize, ChunkedOscPayload) {
        match step {
            ParseStep::Consumed { bytes, payload } => (bytes, payload),
            other => panic!("expected Consumed, got {other:?}"),
        }
    }

    // -------- parser --------

    #[test]
    fn returns_none_when_not_osc_1338() {
        assert!(matches!(try_parse(b""), ParseStep::Incomplete));
        assert!(matches!(try_parse(b"hello"), ParseStep::None));
        // OSC 0 must NOT be claimed by us.
        assert!(matches!(try_parse(b"\x1b]0;title\x07"), ParseStep::None));
        // OSC 133 must NOT be claimed by us.
        assert!(matches!(try_parse(b"\x1b]133;A\x07"), ParseStep::None));
    }

    #[test]
    fn returns_incomplete_on_partial_prefix() {
        // `\x1b]13` is a valid prefix-of-prefix — wait for more bytes.
        assert!(matches!(try_parse(b"\x1b]13"), ParseStep::Incomplete));
        assert!(matches!(try_parse(b"\x1b]1338;"), ParseStep::Incomplete));
    }

    #[test]
    fn returns_incomplete_when_terminator_missing() {
        // Full prefix + body but no BEL / ST yet.
        assert!(matches!(
            try_parse(b"\x1b]1338;B;1;png;100;100"),
            ParseStep::Incomplete
        ));
    }

    #[test]
    fn parses_begin_with_bel() {
        let input = b"\x1b]1338;B;42;png;640;480\x07trailing";
        let (n, payload) = assert_consumed(try_parse(input));
        assert_eq!(n, b"\x1b]1338;B;42;png;640;480\x07".len());
        assert_eq!(
            payload,
            ChunkedOscPayload::Begin {
                image_id: 42,
                format: ChunkedOscFormat::Png,
                width: 640,
                height: 480,
            }
        );
    }

    #[test]
    fn parses_begin_with_st() {
        let input = b"\x1b]1338;B;7;rgba;2;2\x1b\\done";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert!(matches!(
            payload,
            ChunkedOscPayload::Begin {
                image_id: 7,
                format: ChunkedOscFormat::Rgba,
                width: 2,
                height: 2
            }
        ));
    }

    #[test]
    fn parses_data_chunk_with_base64_block() {
        let input = b"\x1b]1338;D;9;3;aGVsbG8=\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(
            payload,
            ChunkedOscPayload::Data {
                image_id: 9,
                chunk_idx: 3,
                chunk_b64: b"aGVsbG8=".to_vec(),
            }
        );
    }

    #[test]
    fn parses_data_with_empty_chunk() {
        // Probe / sentinel — base64 block can be empty.
        let input = b"\x1b]1338;D;1;0;\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(
            payload,
            ChunkedOscPayload::Data {
                image_id: 1,
                chunk_idx: 0,
                chunk_b64: Vec::new()
            }
        );
    }

    #[test]
    fn parses_end() {
        let input = b"\x1b]1338;E;77\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::End { image_id: 77 });
    }

    #[test]
    fn malformed_unknown_verb() {
        let input = b"\x1b]1338;X;1\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    #[test]
    fn malformed_begin_with_unknown_format() {
        let input = b"\x1b]1338;B;1;jpeg;10;10\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    #[test]
    fn malformed_begin_with_zero_dimension() {
        let input = b"\x1b]1338;B;1;png;0;100\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    #[test]
    fn malformed_begin_with_oversized_dimension() {
        let input = b"\x1b]1338;B;1;png;9000;100\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    #[test]
    fn malformed_begin_field_count_mismatch() {
        let input = b"\x1b]1338;B;1;png;100\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    #[test]
    fn malformed_data_non_numeric_chunk_idx() {
        let input = b"\x1b]1338;D;1;abc;aGk=\x07";
        let (_n, payload) = assert_consumed(try_parse(input));
        assert_eq!(payload, ChunkedOscPayload::Malformed);
    }

    // -------- assembler: happy paths --------

    #[test]
    fn assembler_pending_count_starts_at_zero() {
        let asm = ChunkAssembler::new();
        assert_eq!(asm.pending_count(), 0);
    }

    #[test]
    fn assembler_completes_single_chunk_png() {
        let mut asm = ChunkAssembler::new();
        // 8-byte PNG-shaped payload (validity not checked; engine treats
        // PNG as passthrough). The assembler only cares about base64
        // round-trip and dimension declaration.
        let raw = b"\x89PNGtest";
        let chunk = B64.encode(raw).into_bytes();
        match asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 4,
            height: 2,
        }) {
            AssemblerOutcome::Pending => {}
            other => panic!("BEGIN should be Pending, got {other:?}"),
        }
        assert_eq!(asm.pending_count(), 1);
        match asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: chunk,
        }) {
            AssemblerOutcome::Pending => {}
            other => panic!("DATA should be Pending, got {other:?}"),
        }
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Completed {
                image_id,
                format,
                raw_bytes,
                decoded,
            } => {
                assert_eq!(image_id, 1);
                assert_eq!(format, ChunkedOscFormat::Png);
                assert_eq!(raw_bytes, raw);
                assert_eq!(decoded.width_px, 4);
                assert_eq!(decoded.height_px, 2);
                assert!(matches!(decoded.payload, DecodedPayload::Png { .. }));
            }
            other => panic!("END should Complete, got {other:?}"),
        }
        assert_eq!(
            asm.pending_count(),
            0,
            "completed transfer should be drained"
        );
    }

    #[test]
    fn assembler_completes_multi_chunk_in_order() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 5,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        // Split "HELLO_WORLD!!" into three chunks at 4-base64-char
        // boundaries so each chunk decodes independently if we wanted to
        // (we concatenate before decode anyway).
        let raw = b"HELLO_WORLD!!"; // 13 bytes -> 20 b64 chars (with =)
        let b64_full = B64.encode(raw);
        let parts = [&b64_full[..8], &b64_full[8..16], &b64_full[16..]];
        for (idx, part) in parts.iter().enumerate() {
            asm.ingest(ChunkedOscPayload::Data {
                image_id: 5,
                chunk_idx: idx as u32,
                chunk_b64: part.as_bytes().to_vec(),
            });
        }
        match asm.ingest(ChunkedOscPayload::End { image_id: 5 }) {
            AssemblerOutcome::Completed { raw_bytes, .. } => {
                assert_eq!(raw_bytes, raw);
            }
            other => panic!("END should Complete, got {other:?}"),
        }
    }

    #[test]
    fn assembler_completes_multi_chunk_out_of_order() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 9,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        let raw = b"abcdefghij"; // 10 bytes -> 16 b64 chars (no padding)
        let b64_full = B64.encode(raw);
        let parts = [&b64_full[..8], &b64_full[8..]];
        // Send chunk 1 BEFORE chunk 0. Assembler must still concat them
        // in chunk-idx order on END.
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 9,
            chunk_idx: 1,
            chunk_b64: parts[1].as_bytes().to_vec(),
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 9,
            chunk_idx: 0,
            chunk_b64: parts[0].as_bytes().to_vec(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 9 }) {
            AssemblerOutcome::Completed { raw_bytes, .. } => assert_eq!(raw_bytes, raw),
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[test]
    fn assembler_supports_concurrent_image_ids() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 2,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        assert_eq!(asm.pending_count(), 2);
        let raw1 = b"AAA";
        let raw2 = b"BBB";
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: B64.encode(raw1).into_bytes(),
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 2,
            chunk_idx: 0,
            chunk_b64: B64.encode(raw2).into_bytes(),
        });
        let r1 = match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Completed { raw_bytes, .. } => raw_bytes,
            other => panic!("{other:?}"),
        };
        let r2 = match asm.ingest(ChunkedOscPayload::End { image_id: 2 }) {
            AssemblerOutcome::Completed { raw_bytes, .. } => raw_bytes,
            other => panic!("{other:?}"),
        };
        assert_eq!(r1, raw1);
        assert_eq!(r2, raw2);
    }

    #[test]
    fn assembler_rgba_validates_dimensions() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Rgba,
            width: 2,
            height: 2,
        });
        // 2*2*4 = 16 bytes RGBA.
        let raw = vec![0u8; 16];
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: B64.encode(&raw).into_bytes(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Completed { decoded, .. } => {
                assert!(matches!(decoded.payload, DecodedPayload::Rgba8 { .. }));
                assert_eq!(decoded.width_px, 2);
                assert_eq!(decoded.height_px, 2);
            }
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    // -------- assembler: failure paths --------

    #[test]
    fn assembler_data_without_begin_fails() {
        let mut asm = ChunkAssembler::new();
        let outcome = asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"AAAA".to_vec(),
        });
        match outcome {
            AssemblerOutcome::Failed {
                image_id,
                error: AssemblerError::UnknownImageId(_),
                ..
            } => {
                assert_eq!(image_id, 1);
            }
            other => panic!("expected UnknownImageId, got {other:?}"),
        }
    }

    #[test]
    fn assembler_end_without_begin_fails() {
        let mut asm = ChunkAssembler::new();
        match asm.ingest(ChunkedOscPayload::End { image_id: 99 }) {
            AssemblerOutcome::Failed {
                error: AssemblerError::UnknownImageId(99),
                ..
            } => {}
            other => panic!("expected UnknownImageId, got {other:?}"),
        }
    }

    #[test]
    fn assembler_duplicate_chunk_aborts_and_drops_pending() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"AAAA".to_vec(),
        });
        match asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"BBBB".to_vec(),
        }) {
            AssemblerOutcome::Failed {
                error: AssemblerError::DuplicateChunk { chunk_idx: 0, .. },
                partial_bytes,
                ..
            } => {
                assert_eq!(partial_bytes, b"AAAA");
            }
            other => panic!("expected DuplicateChunk, got {other:?}"),
        }
        assert_eq!(asm.pending_count(), 0);
    }

    #[test]
    fn assembler_chunk_gap_on_end_fails() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        // Send chunks 0 and 2 but not 1. END must report a gap.
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"AAAA".to_vec(),
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 2,
            chunk_b64: b"CCCC".to_vec(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Failed {
                error: AssemblerError::ChunkGap { chunk_idx: 1, .. },
                ..
            } => {}
            other => panic!("expected ChunkGap, got {other:?}"),
        }
    }

    #[test]
    fn assembler_invalid_base64_fails() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        // `!` is not a base64 char.
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"!!!!".to_vec(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Failed {
                error: AssemblerError::InvalidBase64(1),
                partial_bytes,
                ..
            } => {
                assert_eq!(partial_bytes, b"!!!!");
            }
            other => panic!("expected InvalidBase64, got {other:?}"),
        }
    }

    #[test]
    fn assembler_rgba_size_mismatch_fails() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Rgba,
            width: 4,
            height: 4, // expects 64 bytes
        });
        // Only 8 bytes of RGBA — far less than 64.
        let raw = vec![0u8; 8];
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: B64.encode(&raw).into_bytes(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Failed {
                error:
                    AssemblerError::DimensionMismatch {
                        expected: 64,
                        got: 8,
                        ..
                    },
                ..
            } => {}
            other => panic!("expected DimensionMismatch, got {other:?}"),
        }
    }

    #[test]
    fn assembler_begin_replaces_prior_pending() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: b"AAAA".to_vec(),
        });
        // Re-BEGIN drops the prior chunk silently.
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 2,
            height: 2,
        });
        asm.ingest(ChunkedOscPayload::Data {
            image_id: 1,
            chunk_idx: 0,
            chunk_b64: B64.encode(b"hi").into_bytes(),
        });
        match asm.ingest(ChunkedOscPayload::End { image_id: 1 }) {
            AssemblerOutcome::Completed {
                raw_bytes, decoded, ..
            } => {
                assert_eq!(raw_bytes, b"hi");
                // New BEGIN's dims won.
                assert_eq!(decoded.width_px, 2);
            }
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[test]
    fn assembler_clear_drops_all_pending() {
        let mut asm = ChunkAssembler::new();
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 1,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        asm.ingest(ChunkedOscPayload::Begin {
            image_id: 2,
            format: ChunkedOscFormat::Png,
            width: 1,
            height: 1,
        });
        assert_eq!(asm.pending_count(), 2);
        asm.clear();
        assert_eq!(asm.pending_count(), 0);
    }
}
