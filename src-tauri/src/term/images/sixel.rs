//! Sixel parameter parser — Sprint 1 stub.
//!
//! Sprint 1 only needs `SixelHeader` as a landing pad so the next sprint
//! can drop the full parameter parser without churning module wiring.
//! The boundary scanner in `sequences.rs` already extracts the parameter
//! bytes; full DCS parameter semantics (`P1`=aspect ratio, `P2`=background
//! mode, `P3`=horizontal grid size) live with the decoder in Sprint 2.

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SixelHeader {
    pub raw_params: Vec<u8>,
}

/// Stub: store the raw parameter bytes for Sprint 2 to interpret. The
/// real parser will return aspect-ratio / background / grid-size fields.
pub fn parse_sixel_header(raw: &[u8]) -> SixelHeader {
    SixelHeader {
        raw_params: raw.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_raw_params() {
        let h = parse_sixel_header(b"0;1;0");
        assert_eq!(h.raw_params, b"0;1;0");
    }

    #[test]
    fn empty_params_yield_empty_raw() {
        let h = parse_sixel_header(b"");
        assert!(h.raw_params.is_empty());
    }
}
