//! IME (Input Method Editor) handling via Win32 IMM32 API.
//!
//! Manages the composition window position and retrieves composition/result strings.
//! This replaces the custom DOM-based IME overlay from TerminalArea.tsx.

/// IME composition state.
#[derive(Clone, Debug, Default)]
pub struct ImeState {
    /// Currently composing text (e.g. "にほ" while typing "nihon").
    pub composing: String,
    /// True if composition is in progress.
    pub active: bool,
}

impl ImeState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the composition text.
    pub fn set_composing(&mut self, text: String) {
        self.composing = text;
        self.active = !self.composing.is_empty();
    }

    /// Commit the composition (user selected a candidate).
    /// Returns the committed string and clears state.
    pub fn commit(&mut self) -> String {
        let result = std::mem::take(&mut self.composing);
        self.active = false;
        result
    }

    /// Cancel the composition.
    pub fn cancel(&mut self) {
        self.composing.clear();
        self.active = false;
    }
}

// TODO: Phase 6 — Win32 IMM32 API integration:
// - ImmGetContext / ImmReleaseContext
// - ImmSetCompositionWindow (position candidate window at cursor)
// - WM_IME_COMPOSITION handler (GCS_COMPSTR, GCS_RESULTSTR)
// - ImmSetCandidateWindow (optional: control candidate list position)
