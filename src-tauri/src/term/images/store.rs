//! In-memory image registry with a per-session byte cap.
//!
//! Each completed image escape (Kitty or Sixel) gets a monotonic
//! `ImageId`, retains its raw payload for diagnostic / re-decode purposes,
//! and (Sprint 2) an optional decoded RGBA8 / PNG buffer ready for the
//! Sprint-3 paint pass. When `bytes_used` exceeds `IMAGE_BYTE_CAP` the
//! oldest entries are evicted FIFO until the new entry fits — this matches
//! the roadmap risk hedge ("scrollback × inline images × eviction is a
//! real memory trap"). LRU was rejected because most inline images are
//! written once and shown once, so the tracker overhead would not pay
//! itself back.
//!
//! `bytes_used` accounts for both the raw payload **and** any attached
//! decoded buffer. Decoded buffers are typically larger than the raw
//! base64 / DCS body, so charging both halves to the same cap keeps the
//! per-session memory ceiling honest in worst-case mixed workloads.

use std::collections::VecDeque;

use super::decoded::DecodedImage;
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
    /// Decoded representation, populated by Sprint 2 once a decoder
    /// succeeds. `None` means the raw bytes are present but the decoder
    /// either failed or was not yet run — Sprint 3's paint pass will
    /// silently skip such entries rather than block on a re-decode.
    pub decoded: Option<DecodedImage>,
}

impl ImageEntry {
    /// Total bytes attributable to this entry (raw + decoded). Drives
    /// the FIFO eviction loop in `ImageStore::insert`.
    fn footprint(&self) -> usize {
        self.bytes.len() + self.decoded.as_ref().map(|d| d.payload.byte_len()).unwrap_or(0)
    }
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
        self.insert_full(protocol, bytes, None)
    }

    /// Insert with an optional decoded payload. The decoded buffer's
    /// length counts against the same per-session cap as the raw bytes.
    pub fn insert_full(
        &mut self,
        protocol: ImageProtocol,
        bytes: Vec<u8>,
        decoded: Option<DecodedImage>,
    ) -> ImageId {
        let id = ImageId(self.next_id);
        self.next_id = self.next_id.checked_add(1).expect("ImageId u64 overflow");

        let needed = bytes.len() + decoded.as_ref().map(|d| d.payload.byte_len()).unwrap_or(0);
        // Evict only when we have non-zero room to free. If `needed` is
        // already larger than the cap, we'll still flush everything older
        // before storing — but stop trying to make room once the deque
        // is empty so we don't spin.
        while !self.entries.is_empty() && self.bytes_used + needed > self.cap {
            if let Some(evicted) = self.entries.pop_front() {
                self.bytes_used -= evicted.footprint();
            }
        }

        self.bytes_used += needed;
        self.entries.push_back(ImageEntry {
            id,
            protocol,
            bytes,
            decoded,
        });
        id
    }

    /// Attach a decoded payload to an existing entry. Returns `true` if
    /// the entry was found and updated. The new buffer's length counts
    /// against the cap, evicting oldest entries (excluding the one being
    /// updated) if needed.
    pub fn attach_decoded(&mut self, id: ImageId, decoded: DecodedImage) -> bool {
        if !self.entries.iter().any(|e| e.id == id) {
            return false;
        }
        let added = decoded.payload.byte_len();
        // Evict from the front, but never the entry we're updating.
        while self.bytes_used + added > self.cap {
            // Front of deque or nothing left to evict.
            let Some(front) = self.entries.front() else {
                break;
            };
            if front.id == id {
                // The entry we want to update is at the front; evicting
                // it would be perverse. Stop here and accept the
                // overshoot.
                break;
            }
            if let Some(evicted) = self.entries.pop_front() {
                self.bytes_used -= evicted.footprint();
            }
        }
        // Re-locate after potential evictions (front pops can shift idx).
        let Some(idx) = self.entries.iter().position(|e| e.id == id) else {
            return false;
        };
        let entry = &mut self.entries[idx];
        // Subtract any prior decoded footprint, swap in the new one,
        // then re-add.
        if let Some(prev) = entry.decoded.as_ref() {
            self.bytes_used -= prev.payload.byte_len();
        }
        self.bytes_used += added;
        entry.decoded = Some(decoded);
        true
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
    use crate::term::images::decoded::{DecodedImage, DecodedPayload};

    fn rgba8(width: u32, height: u32) -> DecodedImage {
        let len = (width as usize) * (height as usize) * 4;
        DecodedImage {
            protocol: ImageProtocol::Sixel,
            payload: DecodedPayload::Rgba8 {
                bytes: vec![0; len],
            },
            width_px: width,
            height_px: height,
            cell_cols: None,
            cell_rows: None,
        }
    }

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
        assert!(e.decoded.is_none());
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
        let mut s = ImageStore::with_cap(5);
        let a = s.insert(ImageProtocol::Kitty, b"aaaaa".to_vec());
        let b = s.insert(ImageProtocol::Kitty, b"bbbbb".to_vec());
        assert!(s.get(a).is_none());
        assert_eq!(b.0, a.0 + 1);
    }

    // ---------- Sprint 2 ----------

    #[test]
    fn insert_full_charges_decoded_buffer_to_cap() {
        let mut s = ImageStore::with_cap(1024);
        let dec = rgba8(2, 2); // 16 bytes
        let id = s.insert_full(ImageProtocol::Sixel, b"raw".to_vec(), Some(dec));
        let e = s.get(id).unwrap();
        assert!(e.decoded.is_some());
        assert_eq!(s.bytes_used(), 3 + 16);
    }

    #[test]
    fn attach_decoded_updates_existing_entry_and_cap() {
        let mut s = ImageStore::with_cap(1024);
        let id = s.insert(ImageProtocol::Sixel, b"raw".to_vec());
        assert_eq!(s.bytes_used(), 3);
        let attached = s.attach_decoded(id, rgba8(3, 3));
        assert!(attached);
        let e = s.get(id).unwrap();
        assert!(e.decoded.is_some());
        assert_eq!(s.bytes_used(), 3 + 36);
    }

    #[test]
    fn attach_decoded_replaces_prior_decoded_buffer() {
        let mut s = ImageStore::with_cap(1024);
        let id = s.insert_full(ImageProtocol::Sixel, b"raw".to_vec(), Some(rgba8(2, 2)));
        assert_eq!(s.bytes_used(), 3 + 16);
        s.attach_decoded(id, rgba8(4, 4));
        assert_eq!(s.bytes_used(), 3 + 64);
    }

    #[test]
    fn attach_decoded_returns_false_for_missing_id() {
        let mut s = ImageStore::with_cap(1024);
        assert!(!s.attach_decoded(ImageId(999), rgba8(1, 1)));
    }

    #[test]
    fn fifo_eviction_accounts_for_decoded_payload() {
        // Cap 100. First entry: raw 5 + decoded 36 = 41. Second: raw 5 +
        // decoded 36 = 41. Third: raw 5 + decoded 25 = 30 — total without
        // eviction would be 112, so the first entry evicts.
        let mut s = ImageStore::with_cap(100);
        let a = s.insert_full(ImageProtocol::Sixel, vec![0; 5], Some(rgba8(3, 3)));
        let b = s.insert_full(ImageProtocol::Sixel, vec![0; 5], Some(rgba8(3, 3)));
        let c = s.insert_full(ImageProtocol::Sixel, vec![0; 5], Some(rgba8(2, 3)));
        assert!(s.get(a).is_none(), "oldest should evict");
        assert!(s.get(b).is_some());
        assert!(s.get(c).is_some());
    }
}
