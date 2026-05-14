//! Durable terminal mux model.
//!
//! This module is intentionally UI-agnostic. React/Tauri, a future native
//! shell, CLI control, and daemon clients should all project from this model
//! instead of owning their own incompatible pane/session truth.

pub mod graph;
pub mod keymap;
pub mod layout;
pub mod manager;
pub mod store;
