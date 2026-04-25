//! In-memory image registry with a per-session byte cap.
//!
//! Each completed image escape (Kitty or Sixel) gets a monotonic
//! `ImageId` and a payload retained in memory. When `bytes_used` exceeds
//! `IMAGE_BYTE_CAP` the oldest entries are evicted FIFO until the new
//! entry fits — this matches the roadmap risk hedge ("scrollback ×
//! inline images × eviction is a real memory trap"). LRU was rejected
//! because most inline images are written once and shown once, so the
//! tracker overhead would not pay itself back.
//!
//! Sprint 1 only stores raw payloads; decoded pixels and snapshot
//! references land in Sprints 2–3.

use std::collections::VecDeque;

use super::sequences::ImageProtocol;

/// 50 MiB per the post-0.2.2 roadmap. Tuned so a multi-image agent flow
/// stays comfortable without letting a runaway tool drain memory. Test
/// builds may construct stores with smaller caps via the `with_cap`
/// constructor.
pub const IMAGE_BYTE_CAP: usize = 50 * 1024 * 1024;

/// Strongly-typed monotonic image identifier. Wraps `u64` so a session
/// could plausibly run for the heat-death of the universe before the
/// counter saturated, which is the right safety margin for an id that
/// never recycles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ImageId(pub u64);

#[derive(Debug, Clone)]
pub struct ImageEntry {
    pub id: ImageId,
    pub protocol: ImageProtocol,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub struct ImageStore {
    next_id: u64,
    cap: usize,
    bytes_used: usize,
    /// `entries` holds (id, payload) in insertion order so FIFO eviction
    /// is `pop_front`. A separate id index is intentionally not built —
    /// lookups are rare relative to inserts on the inline-image path.
    entries: VecDeque<ImageEntry>,
}

impl ImageStore {
    pub fn new() -> Self {
        Self::with_cap(IMAGE_BYTE_CAP)
    }

    pub fn with_cap(cap: usize) -> Self {
        Self {
            next_id: 0,
            cap,
            bytes_used: 0,
            entries: VecDeque::new(),
        }
    }

    pub fn cap(&self) -> usize {
        self.cap
    }

    pub fn bytes_used(&self) -> usize {
        self.bytes_used
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Insert a payload, evicting oldest entries first if the cap would
    /// be exceeded. Returns the assigned `ImageId`. A payload larger than
    /// the cap is *still* inserted (after evicting everything else) — the
    /// alternative is silently dropping a real user image, which would be
    /// a worse failure mode than a transient cap overshoot.
    pub fn insert(&mut self, protocol: ImageProtocol, bytes: Vec<u8>) -> ImageId {
        let id = ImageId(self.next_id);
        self.next_id = self.next_id.checked_add(1).expect("ImageId u64 overflow");

        let needed = bytes.len();
        // Evict only when we have non-zero room to free. If `needed` is
        // already larger than the cap, we'll still flush everything older
        // before storing — but stop trying to make room once the deque
        // is empty so we don't spin.
        while !self.entries.is_empty() && self.bytes_used + needed > self.cap {
            if let Some(evicted) = self.entries.pop_front() {
                self.bytes_used -= evicted.bytes.len();
            }
        }

        self.bytes_used += needed;
        self.entries.push_back(ImageEntry {
            id,
            protocol,
            bytes,
        });
        id
    }

    pub fn get(&self, id: ImageId) -> Option<&ImageEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Drop everything. Returns the number of entries removed.
    pub fn clear(&mut self) -> usize {
        let n = self.entries.len();
        self.entries.clear();
        self.bytes_used = 0;
        n
    }
}

impl Default for ImageStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_store_starts_at_zero() {
        let s = ImageStore::with_cap(1024);
        assert_eq!(s.bytes_used(), 0);
        assert_eq!(s.len(), 0);
        assert!(s.is_empty());
    }

    #[test]
    fn inserted_entries_are_retrievable() {
        let mut s = ImageStore::with_cap(1024);
        let id = s.insert(ImageProtocol::Kitty, b"hello".to_vec());
        let e = s.get(id).expect("entry should exist");
        assert_eq!(e.bytes, b"hello");
        assert_eq!(e.protocol, ImageProtocol::Kitty);
        assert_eq!(s.bytes_used(), 5);
    }

    #[test]
    fn ids_are_monotonic() {
        let mut s = ImageStore::with_cap(1024);
        let a = s.insert(ImageProtocol::Kitty, b"a".to_vec());
        let b = s.insert(ImageProtocol::Sixel, b"b".to_vec());
        assert!(a < b);
    }

    #[test]
    fn fifo_evicts_oldest_when_cap_exceeded() {
        // Cap 10 bytes. Insert 5+5+5: the third insert should evict the
        // first.
        let mut s = ImageStore::with_cap(10);
        let a = s.insert(ImageProtocol::Kitty, b"aaaaa".to_vec());
        let b = s.insert(ImageProtocol::Kitty, b"bbbbb".to_vec());
        let c = s.insert(ImageProtocol::Kitty, b"ccccc".to_vec());
        assert!(s.get(a).is_none(), "oldest entry should have been evicted");
        assert!(s.get(b).is_some());
        assert!(s.get(c).is_some());
        assert_eq!(s.bytes_used(), 10);
    }

    #[test]
    fn payload_larger_than_cap_is_still_inserted() {
        let mut s = ImageStore::with_cap(10);
        let _ = s.insert(ImageProtocol::Kitty, b"x".to_vec());
        let big = vec![b'B'; 100];
        let id = s.insert(ImageProtocol::Kitty, big.clone());
        // The small entry is gone (we evicted to make room), and the
        // oversized entry still landed.
        assert_eq!(s.len(), 1);
        assert_eq!(s.get(id).unwrap().bytes, big);
        assert_eq!(s.bytes_used(), 100);
    }

    #[test]
    fn clear_resets_size_and_returns_count() {
        let mut s = ImageStore::with_cap(1024);
        s.insert(ImageProtocol::Kitty, b"a".to_vec());
        s.insert(ImageProtocol::Kitty, b"b".to_vec());
        assert_eq!(s.clear(), 2);
        assert_eq!(s.bytes_used(), 0);
        assert!(s.is_empty());
    }

    #[test]
    fn missing_id_returns_none() {
        let s = ImageStore::with_cap(1024);
        assert!(s.get(ImageId(999)).is_none());
    }

    #[test]
    fn ids_continue_to_climb_after_eviction() {
        // Eviction must NOT recycle ids — the frontend keeps stale
        // `ImageRef`s after scroll-off and depends on lookups returning
        // None rather than mistakenly resolving to a different image.
        let mut s = ImageStore::with_cap(5);
        let a = s.insert(ImageProtocol::Kitty, b"aaaaa".to_vec());
        let b = s.insert(ImageProtocol::Kitty, b"bbbbb".to_vec());
        assert!(s.get(a).is_none());
        assert_eq!(b.0, a.0 + 1);
    }
}
