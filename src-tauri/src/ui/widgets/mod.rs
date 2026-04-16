//! Reusable UI widgets for wgpu immediate-mode rendering.
//!
//! Each widget follows the project's build pattern:
//!   `build(font, atlas, x, y, w, h, ...) → Output { rects, glyphs }`
//!
//! Widgets are stateless renderers where possible. State (hover, drag) lives
//! in the caller or in a small companion struct.

pub mod button;
pub mod scrollbar;
pub mod tooltip;
