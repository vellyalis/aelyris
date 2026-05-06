//! Character-n-gram hashing embedder.
//!
//! Keeps the backend zero-dep while still producing embeddings that capture
//! substring similarity well enough for short shell commands. The feature
//! pipeline:
//!
//! 1. Lowercase + NFC (approximated via `to_lowercase`) — shell commands are
//!    case-insensitive in practice and Unicode casing is fine for Japanese
//!    queries against English commands (they simply don't collide).
//! 2. Tokenize to (whitespace-split) words and pad each with leading/trailing
//!    `^` / `$` so prefixes/suffixes contribute to distinct features.
//! 3. Emit char n-grams for n ∈ {2, 3, 4} and whole words.
//! 4. Hash each feature into `EMBED_DIM` buckets using a stable FxHash-like
//!    mixer. Feature sign is toggled by the top hash bit (signed hashing) so
//!    collisions tend to cancel out.
//! 5. L2-normalize the final vector so cosine similarity is a simple dot
//!    product.
//!
//! The output is deterministic and does not require any model file.

use serde::{Deserialize, Serialize};

/// Fixed embedding dimension.
pub const EMBED_DIM: usize = 256;

/// Identifier persisted next to each vector so future model swaps can be
/// detected + backfilled.
pub const MODEL_ID: &str = "char-ngram-hash-v1";

/// Minimum and maximum n-gram sizes. 2-grams capture short commands like
/// `ls`, 4-grams pick up subtokens like `test` / `merge`.
const NGRAM_MIN: usize = 2;
const NGRAM_MAX: usize = 4;

/// Embedder trait — swappable so we can plug in `fastembed` later without
/// touching the store or the IPC surface.
pub trait Embedder: Send + Sync {
    /// Returns the model identifier stored alongside each vector.
    fn model_id(&self) -> &str;

    /// Returns the embedding dimension.
    fn dim(&self) -> usize;

    /// Encode `text` into a unit-length `dim()`-sized vector.
    fn embed(&self, text: &str) -> Vec<f32>;
}

/// Default embedder — dependency-free, fully deterministic.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct HashingNgramEmbedder;

impl HashingNgramEmbedder {
    pub fn new() -> Self {
        Self
    }
}

impl Embedder for HashingNgramEmbedder {
    fn model_id(&self) -> &str {
        MODEL_ID
    }

    fn dim(&self) -> usize {
        EMBED_DIM
    }

    fn embed(&self, text: &str) -> Vec<f32> {
        let mut vec = vec![0f32; EMBED_DIM];

        // Normalize once. Collecting chars lets us slice by grapheme-ish units
        // without pulling in `unicode-segmentation`.
        let lowered: String = text.to_lowercase();
        if lowered.trim().is_empty() {
            return vec;
        }

        for token in lowered.split_whitespace() {
            // Whole token as a feature (helps exact-match commands).
            accumulate(&mut vec, &format!("w:{}", token));

            // Guard characters so prefix/suffix n-grams look different from
            // internal ones.
            let guarded: Vec<char> = std::iter::once('^')
                .chain(token.chars())
                .chain(std::iter::once('$'))
                .collect();

            for n in NGRAM_MIN..=NGRAM_MAX {
                if guarded.len() < n {
                    continue;
                }
                for window in guarded.windows(n) {
                    let feat: String = window.iter().collect();
                    accumulate(&mut vec, &feat);
                }
            }
        }

        l2_normalize(&mut vec);
        vec
    }
}

fn accumulate(vec: &mut [f32], feature: &str) {
    let h = fxhash(feature.as_bytes());
    let idx = (h as usize) % EMBED_DIM;
    // Signed hashing: top bit selects sign so collisions are unbiased.
    let sign = if (h >> 63) & 1 == 1 { -1f32 } else { 1f32 };
    vec[idx] += sign;
}

fn l2_normalize(vec: &mut [f32]) {
    let norm = vec.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > f32::EPSILON {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
}

/// Fast, stable 64-bit hash. Adapted from the FxHash public-domain idea —
/// good enough for bucketing, not cryptographic.
fn fxhash(bytes: &[u8]) -> u64 {
    const SEED: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut h: u64 = SEED;
    for &b in bytes {
        h = h.wrapping_mul(PRIME) ^ (b as u64);
    }
    h
}

/// Cosine similarity between two unit-length vectors of the same length.
/// If either vector is degenerate (all zeros) returns 0.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0f32;
    let mut an = 0f32;
    let mut bn = 0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        an += a[i] * a[i];
        bn += b[i] * b[i];
    }
    if an < f32::EPSILON || bn < f32::EPSILON {
        return 0.0;
    }
    dot / (an.sqrt() * bn.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embed(s: &str) -> Vec<f32> {
        HashingNgramEmbedder::new().embed(s)
    }

    #[test]
    fn dim_and_unit_length() {
        let v = embed("cargo build");
        assert_eq!(v.len(), EMBED_DIM);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        // Allow tiny floating point slack.
        assert!((norm - 1.0).abs() < 1e-3, "expected unit vec, got {norm}");
    }

    #[test]
    fn empty_text_is_zero() {
        let v = embed("   ");
        assert!(v.iter().all(|x| *x == 0.0));
    }

    #[test]
    fn similar_commands_score_higher_than_unrelated() {
        let a = embed("cargo build --release");
        let b = embed("cargo build");
        let c = embed("git push origin main");
        let sim_ab = cosine(&a, &b);
        let sim_ac = cosine(&a, &c);
        assert!(
            sim_ab > sim_ac,
            "related pair should beat unrelated: {sim_ab} vs {sim_ac}"
        );
        assert!(sim_ab > 0.3, "related sim too low: {sim_ab}");
    }

    #[test]
    fn case_insensitive() {
        let a = embed("Cargo BUILD");
        let b = embed("cargo build");
        let sim = cosine(&a, &b);
        assert!(sim > 0.99, "case should not matter: {sim}");
    }

    #[test]
    fn deterministic() {
        let a = embed("pnpm test");
        let b = embed("pnpm test");
        assert_eq!(a, b);
    }

    #[test]
    fn prefix_match_scores_reasonably() {
        // Query "test" should find "pnpm test" much better than "docker ps".
        let q = embed("test");
        let hit = embed("pnpm test");
        let miss = embed("docker ps");
        assert!(cosine(&q, &hit) > cosine(&q, &miss));
    }

    #[test]
    fn model_id_is_stable() {
        let e = HashingNgramEmbedder::new();
        assert_eq!(e.model_id(), MODEL_ID);
        assert_eq!(e.dim(), EMBED_DIM);
    }

    #[test]
    fn japanese_query_is_stable() {
        // We don't expect high cross-language similarity, but the embedder
        // must not panic on non-ASCII and must stay deterministic.
        let a = embed("ビルド エラー");
        let b = embed("ビルド エラー");
        assert_eq!(a, b);
        assert_eq!(a.len(), EMBED_DIM);
    }
}
