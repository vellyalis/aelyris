//! Phase 3B-2 — Semantic history search.
//!
//! Provides a simple, dependency-free embedder for command history entries
//! plus a SQLite-backed vector store that does brute-force cosine similarity
//! over a small corpus (history length is capped well under 100k in practice,
//! so a linear scan is faster than loading a vector extension).
//!
//! The `Embedder` trait is the extension point: if we later want to swap in
//! `fastembed` or a remote provider, only `embedding::HashingNgramEmbedder`
//! needs to be replaced.

pub mod embedding;
pub mod store;
pub mod types;

pub use embedding::{Embedder, HashingNgramEmbedder, EMBED_DIM, MODEL_ID};
pub use store::HistoryStore;
pub use types::{HistoryEntry, SearchFilters, SearchHit};
