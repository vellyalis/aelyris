//! Vertical scrollbar widget.
//!
//! Renders a thin track + draggable thumb. Handles:
//! - Thumb size proportional to viewport / content ratio
//! - Mouse hover highlight
//! - Thumb dragging (caller manages drag state)
//! - Auto-hide when content fits within viewport
//!
//! Usage:
//! ```ignore
//! let state = ScrollBarState::new(content_h, viewport_h, scroll_offset);
//! let out = scrollbar::build(&state, x, y, h, mouse_pos);
//! rects.extend(out.rects);
//! ```

use crate::gpu::renderer::RectInstance;
use crate::ui::tokens::*;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Immutable snapshot of scroll state, passed to `build`.
#[derive(Debug, Clone)]
pub struct ScrollBarState {
    /// Total height of the scrollable content.
    pub content_height: f32,
    /// Visible viewport height.
    pub viewport_height: f32,
    /// Current scroll offset (0 = top).
    pub scroll_offset: f32,
}

/// Mutable drag state, owned by the parent component.
#[derive(Debug, Clone, Default)]
pub struct ScrollBarDrag {
    /// Whether the thumb is currently being dragged.
    pub active: bool,
    /// Mouse Y at drag start (absolute window coords).
    pub start_mouse_y: f32,
    /// Scroll offset at drag start.
    pub start_offset: f32,
}

/// Output from scrollbar rendering.
pub struct ScrollBarOutput {
    pub rects: Vec<RectInstance>,
    /// The thumb hit region (x, y, w, h) for mouse interaction.
    pub thumb_rect: Option<(f32, f32, f32, f32)>,
    /// The track hit region (x, y, w, h).
    pub track_rect: (f32, f32, f32, f32),
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/// Render a vertical scrollbar.
///
/// - `x, y`: top-left of the scrollbar track (window coords).
/// - `track_h`: total height of the scrollbar track.
/// - `mouse_pos`: current mouse position for hover detection.
/// - `drag`: current drag state for active highlight.
///
/// Returns empty output if content fits within viewport (auto-hide).
pub fn build(
    state: &ScrollBarState,
    x: f32,
    y: f32,
    track_h: f32,
    mouse_pos: Option<(f32, f32)>,
    drag: &ScrollBarDrag,
) -> ScrollBarOutput {
    let track_rect = (x, y, SCROLLBAR_WIDTH, track_h);

    // Auto-hide: content fits in viewport
    if state.content_height <= state.viewport_height {
        return ScrollBarOutput {
            rects: Vec::new(),
            thumb_rect: None,
            track_rect,
        };
    }

    let mut rects = Vec::new();

    // Track background
    rects.push(RectInstance::rounded(
        [x, y],
        [SCROLLBAR_WIDTH, track_h],
        SCROLLBAR_TRACK,
        SCROLLBAR_RADIUS,
    ));

    // Thumb geometry
    let (thumb_y, thumb_h) = thumb_geometry(state, y, track_h);

    // Thumb color based on interaction state
    let is_hovered = mouse_pos
        .map(|(mx, my)| {
            mx >= x && mx <= x + SCROLLBAR_WIDTH && my >= thumb_y && my <= thumb_y + thumb_h
        })
        .unwrap_or(false);

    let thumb_color = if drag.active {
        SCROLLBAR_THUMB_ACTIVE
    } else if is_hovered {
        SCROLLBAR_THUMB_HOVER
    } else {
        SCROLLBAR_THUMB
    };

    rects.push(RectInstance::rounded(
        [x, thumb_y],
        [SCROLLBAR_WIDTH, thumb_h],
        thumb_color,
        SCROLLBAR_RADIUS,
    ));

    ScrollBarOutput {
        rects,
        thumb_rect: Some((x, thumb_y, SCROLLBAR_WIDTH, thumb_h)),
        track_rect,
    }
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

/// Calculate the new scroll offset from a thumb drag.
///
/// Call this each frame while `drag.active` is true.
pub fn drag_scroll(
    state: &ScrollBarState,
    drag: &ScrollBarDrag,
    current_mouse_y: f32,
    track_h: f32,
) -> f32 {
    let ratio = state.content_height / track_h;
    let delta_y = current_mouse_y - drag.start_mouse_y;
    let new_offset = drag.start_offset + delta_y * ratio;
    clamp_offset(new_offset, state.content_height, state.viewport_height)
}

/// Calculate the scroll offset for a click on the track (page scroll).
///
/// Scrolls so the thumb center aligns with the click position.
pub fn click_scroll(
    state: &ScrollBarState,
    click_y: f32,
    track_y: f32,
    track_h: f32,
) -> f32 {
    let relative = (click_y - track_y) / track_h;
    let target_offset = relative * state.content_height - state.viewport_height / 2.0;
    clamp_offset(target_offset, state.content_height, state.viewport_height)
}

/// Hit test: is the mouse over the thumb?
pub fn hit_thumb(
    state: &ScrollBarState,
    x: f32,
    y: f32,
    track_h: f32,
    mouse_x: f32,
    mouse_y: f32,
) -> bool {
    if state.content_height <= state.viewport_height {
        return false;
    }
    let (thumb_y, thumb_h) = thumb_geometry(state, y, track_h);
    mouse_x >= x
        && mouse_x <= x + SCROLLBAR_WIDTH
        && mouse_y >= thumb_y
        && mouse_y <= thumb_y + thumb_h
}

/// Hit test: is the mouse over the track (but not the thumb)?
pub fn hit_track(
    state: &ScrollBarState,
    x: f32,
    y: f32,
    track_h: f32,
    mouse_x: f32,
    mouse_y: f32,
) -> bool {
    mouse_x >= x
        && mouse_x <= x + SCROLLBAR_WIDTH
        && mouse_y >= y
        && mouse_y <= y + track_h
        && !hit_thumb(state, x, y, track_h, mouse_x, mouse_y)
}

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

/// Calculate thumb position and height.
fn thumb_geometry(state: &ScrollBarState, track_y: f32, track_h: f32) -> (f32, f32) {
    let ratio = state.viewport_height / state.content_height;
    let thumb_h = (track_h * ratio).max(SCROLLBAR_THUMB_MIN).min(track_h);

    let scroll_range = state.content_height - state.viewport_height;
    let scroll_fraction = if scroll_range > 0.0 {
        state.scroll_offset / scroll_range
    } else {
        0.0
    };

    let available = track_h - thumb_h;
    let thumb_y = track_y + available * scroll_fraction;

    (thumb_y, thumb_h)
}

/// Clamp a scroll offset to valid range.
fn clamp_offset(offset: f32, content_h: f32, viewport_h: f32) -> f32 {
    offset.max(0.0).min((content_h - viewport_h).max(0.0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn state(content: f32, viewport: f32, offset: f32) -> ScrollBarState {
        ScrollBarState {
            content_height: content,
            viewport_height: viewport,
            scroll_offset: offset,
        }
    }

    #[test]
    fn test_auto_hide_when_content_fits() {
        let s = state(100.0, 200.0, 0.0);
        let drag = ScrollBarDrag::default();
        let out = build(&s, 0.0, 0.0, 200.0, None, &drag);
        assert!(out.rects.is_empty());
        assert!(out.thumb_rect.is_none());
    }

    #[test]
    fn test_visible_when_content_exceeds_viewport() {
        let s = state(500.0, 200.0, 0.0);
        let drag = ScrollBarDrag::default();
        let out = build(&s, 0.0, 0.0, 200.0, None, &drag);
        assert!(!out.rects.is_empty());
        assert!(out.thumb_rect.is_some());
    }

    #[test]
    fn test_thumb_at_top_when_offset_zero() {
        let s = state(1000.0, 200.0, 0.0);
        let (thumb_y, _) = thumb_geometry(&s, 100.0, 400.0);
        assert!((thumb_y - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_thumb_at_bottom_when_fully_scrolled() {
        let s = state(1000.0, 200.0, 800.0); // offset = content - viewport
        let (thumb_y, thumb_h) = thumb_geometry(&s, 0.0, 400.0);
        let bottom = thumb_y + thumb_h;
        assert!((bottom - 400.0).abs() < 0.5);
    }

    #[test]
    fn test_thumb_proportional_size() {
        let s = state(400.0, 200.0, 0.0); // 50% visible
        let (_, thumb_h) = thumb_geometry(&s, 0.0, 400.0);
        // thumb should be ~50% of track (200px), but min is SCROLLBAR_THUMB_MIN
        assert!((thumb_h - 200.0).abs() < 0.01);
    }

    #[test]
    fn test_thumb_minimum_size() {
        let s = state(10000.0, 200.0, 0.0); // tiny ratio
        let (_, thumb_h) = thumb_geometry(&s, 0.0, 400.0);
        assert!((thumb_h - SCROLLBAR_THUMB_MIN).abs() < 0.01);
    }

    #[test]
    fn test_clamp_offset_min() {
        assert!((clamp_offset(-50.0, 1000.0, 200.0)).abs() < 0.01);
    }

    #[test]
    fn test_clamp_offset_max() {
        let clamped = clamp_offset(900.0, 1000.0, 200.0);
        assert!((clamped - 800.0).abs() < 0.01);
    }

    #[test]
    fn test_drag_scroll_proportional() {
        let s = state(1000.0, 200.0, 0.0);
        let drag = ScrollBarDrag {
            active: true,
            start_mouse_y: 100.0,
            start_offset: 0.0,
        };
        // Drag 40px down on a 400px track with 1000px content → ratio 2.5
        let new_offset = drag_scroll(&s, &drag, 140.0, 400.0);
        assert!((new_offset - 100.0).abs() < 0.01); // 40 * 2.5 = 100
    }

    #[test]
    fn test_click_scroll_center() {
        let s = state(1000.0, 200.0, 0.0);
        // Click at the center of a 400px track
        let offset = click_scroll(&s, 200.0, 0.0, 400.0);
        // relative = 0.5, target = 0.5 * 1000 - 100 = 400
        assert!((offset - 400.0).abs() < 0.01);
    }

    #[test]
    fn test_hit_thumb_basic() {
        let s = state(1000.0, 200.0, 0.0);
        // Thumb at top, x=100, track_y=0, track_h=400
        assert!(hit_thumb(&s, 100.0, 0.0, 400.0, 104.0, 10.0));
        assert!(!hit_thumb(&s, 100.0, 0.0, 400.0, 50.0, 10.0)); // outside x
        assert!(!hit_thumb(&s, 100.0, 0.0, 400.0, 104.0, 300.0)); // below thumb
    }

    #[test]
    fn test_hit_thumb_hidden_when_content_fits() {
        let s = state(100.0, 200.0, 0.0);
        assert!(!hit_thumb(&s, 0.0, 0.0, 200.0, 4.0, 50.0));
    }
}
