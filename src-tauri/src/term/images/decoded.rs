//! Decoded-image representation shared by the Kitty + Sixel decoders.
//!
//! Sprint 2 introduces a uniform RGBA8 buffer so the eventual snapshot
//! / paint pass (Sprint 3) can treat both protocols identically. The
//! payload either survives as raw bytes (PNG passthrough — the frontend
//! can drop a PNG straight into a `data:` URL without a re-encode) or as
//! decoded RGBA pixels (`Vec<u8>` length = `width * height * 4`).
//!
//! Cell rectangle (`cell_cols`, `cell_rows`) is the protocol-requested
//! size in *terminal cells* and may be `None` when the source did not
//! state one. Sprint 3 will fall back to a pixel-density heuristic at
//! paint time when both are absent.

use super::sequences::ImageProtocol;

/// Pixel encoding of the decoded payload.
///
/// `Rgba8` is the canonical decoded form (Sixel always produces it; Kitty
/// `f=24/32` is normalised into it). `Png` keeps the original PNG bytes
/// for the Kitty `f=100` passthrough path so we don't pay a decode tax
/// for an image that the browser will decode for us anyway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedPayload {
    /// RGBA8 pixel buffer — `bytes.len() == width * height * 4`.
    Rgba8 { bytes: Vec<u8> },
    /// PNG-encoded bytes ready for `<img src="data:image/png;base64,…">`.
    Png { bytes: Vec<u8> },
}

impl DecodedPayload {
    /// Memory footprint of the decoded payload in bytes. Used by
    /// `ImageStore` to keep the per-session cap honest when raw + decoded
    /// share the same budget.
    pub fn byte_len(&self) -> usize {
        match self {
            DecodedPayload::Rgba8 { bytes } | DecodedPayload::Png { bytes } => bytes.len(),
        }
    }
}

/// Fully resolved image payload after decode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedImage {
    pub protocol: ImageProtocol,
    pub payload: DecodedPayload,
    pub width_px: u32,
    pub height_px: u32,
    /// Display columns requested by the source (`c=` for Kitty; derived
    /// from raster attributes for Sixel when present). `None` means the
    /// Sprint-3 paint pass should compute a default from cell metrics.
    pub cell_cols: Option<u32>,
    /// Display rows requested by the source (`r=` for Kitty; derived
    /// from raster attributes for Sixel when present).
    pub cell_rows: Option<u32>,
}
