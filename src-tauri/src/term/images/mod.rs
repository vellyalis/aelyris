//! Inline image support — Sprint 1 (foundation) + Sprint 2 (decode).
//!
//! Recognises and consumes Kitty graphics protocol (`\x1b_G…\x1b\\`) and
//! Sixel (`\x1bP…q…\x1b\\`) escape sequences so they never leak into the
//! alacritty grid as garbage characters. Sprint 2 adds a uniform RGBA8
//! decoded representation (`DecodedImage`) and a Kitty chunked re-
//! assembler so multi-chunk transmissions land as one image. Snapshot
//! exposure + frontend paint land in Sprint 3 — see
//! `docs/sixel-kitty-spike.md` for the full plan.

pub mod chunked_osc;
pub mod decoded;
pub mod kitty;
pub mod sequences;
pub mod sixel;
pub mod store;

pub use chunked_osc::{
    AssemblerError, AssemblerOutcome, ChunkAssembler, ChunkedOscFormat, ChunkedOscPayload,
    ParseStep as ChunkedOscParseStep, try_parse as try_parse_chunked_osc,
};
pub use decoded::{DecodedImage, DecodedPayload};
pub use kitty::{
    KittyChunkAssembler, KittyDecodeError, KittyHeader, decode_kitty, parse_kitty_header,
    png_dimensions,
};
pub use sequences::{ImagePayload, ImageProtocol, ParseStep, try_parse};
pub use sixel::{SixelDecodeError, SixelHeader, decode_sixel, parse_sixel_header};
pub use store::{
    EvictionStats, IMAGE_BYTE_CAP, ImageEntry, ImageId, ImagePlacement, ImageStore,
};
