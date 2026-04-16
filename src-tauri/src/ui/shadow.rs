//! Drop shadow rendering — multi-layer soft shadows using concentric rects.
//!
//! No shader changes needed: shadows are built from 3-4 semi-transparent
//! rounded rects rendered beneath the target element.

use crate::gpu::renderer::RectInstance;

/// Generate shadow rects for a floating element.
///
/// Returns rects that should be rendered BEFORE the element itself.
/// The shadow uses concentric rounded rects with decreasing alpha
/// to simulate a soft Gaussian blur.
///
/// * `pos`    — element top-left [x, y]
/// * `size`   — element [width, height]
/// * `radius` — element corner radius
/// * `blur`   — shadow blur radius (8-16 for subtle, 20-32 for dramatic)
/// * `offset` — shadow offset [dx, dy] (positive = down-right)
/// * `alpha`  — base shadow opacity (0.0-1.0, typically 0.25-0.5)
pub fn shadow_rects(
    pos: [f32; 2],
    size: [f32; 2],
    radius: f32,
    blur: f32,
    offset: [f32; 2],
    alpha: f32,
) -> Vec<RectInstance> {
    const LAYERS: usize = 4;
    let mut rects = Vec::with_capacity(LAYERS);

    for i in (0..LAYERS).rev() {
        let t = (i + 1) as f32 / LAYERS as f32;
        let spread = blur * t;
        let layer_alpha = alpha * (1.0 - t) * 0.4;
        let pa = layer_alpha; // premultiplied: black * alpha = [0,0,0,alpha]

        rects.push(RectInstance::rounded(
            [
                pos[0] + offset[0] - spread,
                pos[1] + offset[1] - spread,
            ],
            [
                size[0] + spread * 2.0,
                size[1] + spread * 2.0,
            ],
            [0.0, 0.0, 0.0, pa],
            radius + spread * 0.5,
        ));
    }

    rects
}

/// Small, subtle shadow for cards and panels.
pub fn card_shadow(pos: [f32; 2], size: [f32; 2], radius: f32) -> Vec<RectInstance> {
    shadow_rects(pos, size, radius, 8.0, [0.0, 2.0], 0.3)
}

/// Medium shadow for floating panels (palette, dialogs).
pub fn panel_shadow(pos: [f32; 2], size: [f32; 2], radius: f32) -> Vec<RectInstance> {
    shadow_rects(pos, size, radius, 16.0, [0.0, 4.0], 0.45)
}

/// Shadow for context menus and dropdowns.
pub fn menu_shadow(pos: [f32; 2], size: [f32; 2], radius: f32) -> Vec<RectInstance> {
    shadow_rects(pos, size, radius, 12.0, [0.0, 3.0], 0.4)
}

/// Small shadow for toasts sliding in from the side.
pub fn toast_shadow(pos: [f32; 2], size: [f32; 2], radius: f32) -> Vec<RectInstance> {
    shadow_rects(pos, size, radius, 10.0, [2.0, 2.0], 0.35)
}
