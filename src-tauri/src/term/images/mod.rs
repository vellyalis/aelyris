//! Inline image support — Sprint 1 (foundation).
//!
//! Recognises and consumes Kitty graphics protocol (`\x1b_G…\x1b\\`) and
//! Sixel (`\x1bP…q…\x1b\\`) escape sequences so they never leak into the
//! alacritty grid as garbage characters. Decoding and rendering are
//! deferred to Sprints 2–3 — see `docs/sixel-kitty-spike.md` for the full
//! plan.

pub mod kitty;
pub mod sequences;
pub mod sixel;
pub mod store;

pub use kitty::{KittyHeader, parse_kitty_header};
pub use sequences::{ImagePayload, ImageProtocol, ParseStep, try_parse};
pub use store::{IMAGE_BYTE_CAP, ImageEntry, ImageId, ImageStore};
