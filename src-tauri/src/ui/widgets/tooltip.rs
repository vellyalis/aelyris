//! Tooltip widget — hover-delayed info popup.
//!
//! Design:
//! - Only one tooltip visible at a time (single global state).
//! - Appears after TOOLTIP_DELAY frames of continuous hover.
//! - Positions above the target by default; flips below if near top edge.
//! - Dismissed immediately when the mouse moves to a different target.
//!
//! Usage:
//! ```ignore
//! // On hover, register the target:
//! tooltip.set_target("Save file", mx, my, target_y);
//!
//! // Each frame:
//! tooltip.tick(mouse_pos);
//! let out = tooltip.build(font, atlas, window_w, window_h);
//! rects.extend(out.rects);
//! glyphs.extend(out.glyphs);
//! ```

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use crate::ui::tokens::*;

/// Tooltip rendering output.
pub struct TooltipOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Global tooltip state (one per application).
pub struct TooltipState {
    /// Current tooltip text.
    text: String,
    /// Target element's anchor position (center-x, top-y of the element).
    anchor: (f32, f32),
    /// Unique key identifying the current hover target (prevents re-triggering).
    target_key: u64,
    /// Frames spent hovering on the current target.
    hover_frames: u32,
    /// Whether the tooltip is currently visible.
    visible: bool,
}

impl TooltipState {
    pub fn new() -> Self {
        Self {
            text: String::new(),
            anchor: (0.0, 0.0),
            target_key: 0,
            hover_frames: 0,
            visible: false,
        }
    }

    /// Register a hover target. Call each frame while hovering over a tooltipped element.
    ///
    /// - `text`: tooltip content.
    /// - `anchor_x`: horizontal center of the target element.
    /// - `anchor_y`: top edge of the target element (tooltip appears above).
    /// - `key`: unique identifier for this target (hash of label, pointer, etc.).
    pub fn set_target(&mut self, text: &str, anchor_x: f32, anchor_y: f32, key: u64) {
        if self.target_key != key {
            // New target — reset timer
            self.target_key = key;
            self.text = text.to_string();
            self.anchor = (anchor_x, anchor_y);
            self.hover_frames = 0;
            self.visible = false;
        }
    }

    /// Call when the mouse is NOT hovering over any tooltipped element.
    pub fn clear(&mut self) {
        self.hover_frames = 0;
        self.visible = false;
        self.target_key = 0;
    }

    /// Advance one frame. Call from `about_to_wait`.
    pub fn tick(&mut self) {
        if self.target_key != 0 {
            self.hover_frames = self.hover_frames.saturating_add(1);
            if self.hover_frames >= TOOLTIP_DELAY {
                self.visible = true;
            }
        }
    }

    /// Whether the tooltip is currently showing.
    pub fn is_visible(&self) -> bool {
        self.visible
    }

    /// Render the tooltip.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
        window_h: f32,
    ) -> TooltipOutput {
        if !self.visible || self.text.is_empty() {
            return TooltipOutput {
                rects: Vec::new(),
                glyphs: Vec::new(),
            };
        }

        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        let text_w = self.text.chars().count() as f32 * font.cell_width;
        let pad = SPACE_MD;
        let box_w = text_w.min(TOOLTIP_MAX_WIDTH) + pad * 2.0;
        let box_h = font.cell_height + pad * 2.0;

        // Position: centered above anchor, flipped below if near top
        let (box_x, box_y) = tooltip_position(
            self.anchor.0,
            self.anchor.1,
            box_w,
            box_h,
            window_w,
            window_h,
        );

        // Background
        rects.push(RectInstance::rounded(
            [box_x, box_y],
            [box_w, box_h],
            TOOLTIP_BG,
            RADIUS_SM,
        ));

        // Border (1px inset simulation via slightly smaller overlay)
        rects.push(RectInstance::rounded(
            [box_x, box_y],
            [box_w, 1.0],
            TOOLTIP_BORDER,
            0.0,
        ));

        // Text
        let text_x = box_x + pad;
        let text_y = box_y + pad;
        let max_chars = ((box_w - pad * 2.0) / font.cell_width) as usize;
        let display: String = self.text.chars().take(max_chars).collect();
        super::super::render_text(font, atlas, &display, text_x, text_y, TOOLTIP_TEXT, &mut glyphs);

        TooltipOutput { rects, glyphs }
    }
}

impl Default for TooltipState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

/// Calculate tooltip box position, clamped to window bounds.
fn tooltip_position(
    anchor_x: f32,
    anchor_y: f32,
    box_w: f32,
    box_h: f32,
    window_w: f32,
    window_h: f32,
) -> (f32, f32) {
    // Prefer above
    let mut y = anchor_y - box_h - TOOLTIP_OFFSET;
    if y < 0.0 {
        // Flip below
        y = anchor_y + TOOLTIP_OFFSET + BUTTON_HEIGHT;
    }
    // Clamp to bottom
    if y + box_h > window_h {
        y = window_h - box_h;
    }

    // Center horizontally on anchor, clamp to edges
    let mut x = anchor_x - box_w / 2.0;
    x = x.max(SPACE_SM).min(window_w - box_w - SPACE_SM);

    (x, y)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tooltip_starts_hidden() {
        let state = TooltipState::new();
        assert!(!state.is_visible());
    }

    #[test]
    fn test_tooltip_appears_after_delay() {
        let mut state = TooltipState::new();
        state.set_target("Hello", 100.0, 50.0, 1);
        for _ in 0..TOOLTIP_DELAY {
            assert!(!state.is_visible());
            state.tick();
        }
        assert!(state.is_visible());
    }

    #[test]
    fn test_tooltip_resets_on_new_target() {
        let mut state = TooltipState::new();
        state.set_target("A", 100.0, 50.0, 1);
        for _ in 0..TOOLTIP_DELAY {
            state.tick();
        }
        assert!(state.is_visible());

        // Move to new target
        state.set_target("B", 200.0, 50.0, 2);
        assert!(!state.is_visible()); // reset
    }

    #[test]
    fn test_tooltip_clear() {
        let mut state = TooltipState::new();
        state.set_target("X", 100.0, 50.0, 1);
        for _ in 0..TOOLTIP_DELAY {
            state.tick();
        }
        assert!(state.is_visible());

        state.clear();
        assert!(!state.is_visible());
    }

    #[test]
    fn test_tooltip_same_target_no_reset() {
        let mut state = TooltipState::new();
        state.set_target("A", 100.0, 50.0, 1);
        for _ in 0..20 {
            state.tick();
        }
        // Re-register same target — should not reset
        state.set_target("A", 100.0, 50.0, 1);
        assert_eq!(state.hover_frames, 20);
    }

    #[test]
    fn test_position_clamped_to_window() {
        // Anchor near left edge
        let (x, _) = tooltip_position(10.0, 100.0, 200.0, 30.0, 800.0, 600.0);
        assert!(x >= SPACE_SM);

        // Anchor near right edge
        let (x, _) = tooltip_position(790.0, 100.0, 200.0, 30.0, 800.0, 600.0);
        assert!(x + 200.0 <= 800.0);
    }

    #[test]
    fn test_position_flips_when_near_top() {
        // Anchor very near top — tooltip should flip below
        let (_, y) = tooltip_position(400.0, 10.0, 200.0, 30.0, 800.0, 600.0);
        assert!(y > 10.0); // below anchor
    }

    #[test]
    fn test_position_above_by_default() {
        let (_, y) = tooltip_position(400.0, 300.0, 200.0, 30.0, 800.0, 600.0);
        assert!(y < 300.0); // above anchor
    }
}
