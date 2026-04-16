//! Design tokens — centralized spacing, sizing, and radius constants.
//!
//! All UI components should reference these tokens instead of hardcoding
//! pixel values. This ensures visual consistency and makes global adjustments
//! trivial (change one constant, everything adapts).
//!
//! Naming: `{category}_{size}` where size is XS/SM/MD/LG/XL.

// ---------------------------------------------------------------------------
// Spacing (margins, paddings, gaps between elements)
// ---------------------------------------------------------------------------

pub const SPACE_XS: f32 = 2.0;
pub const SPACE_SM: f32 = 4.0;
pub const SPACE_MD: f32 = 8.0;
pub const SPACE_LG: f32 = 12.0;
pub const SPACE_XL: f32 = 16.0;
pub const SPACE_2XL: f32 = 24.0;

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------

pub const RADIUS_SM: f32 = 3.0;
pub const RADIUS_MD: f32 = 6.0;
pub const RADIUS_LG: f32 = 8.0;
pub const RADIUS_XL: f32 = 12.0;

// ---------------------------------------------------------------------------
// Interactive element sizing
// ---------------------------------------------------------------------------

/// Standard row height for lists (file tree, command history, search results).
pub const ROW_HEIGHT: f32 = 22.0;

/// Taller row height for cards and complex list items.
pub const ROW_HEIGHT_LG: f32 = 36.0;

/// Header row height (section headers in sidebar, panels).
pub const HEADER_HEIGHT: f32 = 28.0;

/// Standard input field height (palette input, search box).
pub const INPUT_HEIGHT: f32 = 32.0;

/// Standard button height.
pub const BUTTON_HEIGHT: f32 = 28.0;

// ---------------------------------------------------------------------------
// Scrollbar
// ---------------------------------------------------------------------------

/// Scrollbar track width (thin, non-intrusive).
pub const SCROLLBAR_WIDTH: f32 = 8.0;

/// Minimum scrollbar thumb height (prevents invisible thumb on large content).
pub const SCROLLBAR_THUMB_MIN: f32 = 24.0;

/// Scrollbar track corner radius.
pub const SCROLLBAR_RADIUS: f32 = 4.0;

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/// Frames before tooltip appears (~750ms at 60fps).
pub const TOOLTIP_DELAY: u32 = 45;

/// Maximum tooltip width before wrapping.
pub const TOOLTIP_MAX_WIDTH: f32 = 300.0;

/// Tooltip vertical offset from target element.
pub const TOOLTIP_OFFSET: f32 = 6.0;

// ---------------------------------------------------------------------------
// Scrollbar colors (theme-aware via cat module)
// ---------------------------------------------------------------------------

/// Scrollbar track background (very subtle).
pub const SCROLLBAR_TRACK: [f32; 4] = [0.15, 0.15, 0.20, 0.3];

/// Scrollbar thumb at rest.
pub const SCROLLBAR_THUMB: [f32; 4] = [0.35, 0.36, 0.45, 0.5];

/// Scrollbar thumb on hover.
pub const SCROLLBAR_THUMB_HOVER: [f32; 4] = [0.45, 0.46, 0.55, 0.7];

/// Scrollbar thumb while dragging.
pub const SCROLLBAR_THUMB_ACTIVE: [f32; 4] = [0.55, 0.56, 0.65, 0.8];

// ---------------------------------------------------------------------------
// Tooltip colors
// ---------------------------------------------------------------------------

/// Tooltip background.
pub const TOOLTIP_BG: [f32; 4] = [0.17, 0.17, 0.27, 0.95];

/// Tooltip border.
pub const TOOLTIP_BORDER: [f32; 4] = [0.30, 0.31, 0.40, 0.6];

/// Tooltip text.
pub const TOOLTIP_TEXT: [f32; 4] = [0.81, 0.83, 0.88, 1.0];

// ---------------------------------------------------------------------------
// Button colors
// ---------------------------------------------------------------------------

/// Ghost button (transparent bg, visible on hover).
pub const BTN_GHOST_BG: [f32; 4] = [0.0, 0.0, 0.0, 0.0];
pub const BTN_GHOST_HOVER: [f32; 4] = [0.27, 0.28, 0.35, 0.4];
pub const BTN_GHOST_ACTIVE: [f32; 4] = [0.22, 0.23, 0.30, 0.5];

/// Primary button (accent color).
pub const BTN_PRIMARY_BG: [f32; 4] = [0.54, 0.71, 0.98, 0.9];
pub const BTN_PRIMARY_HOVER: [f32; 4] = [0.60, 0.76, 1.0, 1.0];
pub const BTN_PRIMARY_ACTIVE: [f32; 4] = [0.45, 0.62, 0.88, 1.0];
pub const BTN_PRIMARY_TEXT: [f32; 4] = [0.12, 0.12, 0.18, 1.0];

/// Disabled state overlay.
pub const BTN_DISABLED_OPACITY: f32 = 0.4;
