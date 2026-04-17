//! Native terminal engine (Phase 2).
//!
//! Wraps `alacritty_terminal::Term` so the Rust side owns parsing and grid state.
//! Downstream layers (IPC, diff engine) read from this module instead of piping
//! raw PTY bytes to the frontend.

pub mod engine;

pub use engine::{TermEngine, TermEngineError};
