//! wgpu render pipeline for terminal text rendering.
//!
//! Draws the terminal grid as instanced quads, each textured from the glyph atlas.
//! Supports transparent background (alpha blending with Mica/Acrylic).

/// Per-instance data sent to the GPU for each visible cell.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GlyphInstance {
    /// Cell position in pixels (top-left corner).
    pub pos: [f32; 2],
    /// Atlas UV rect: [u0, v0, u1, v1].
    pub uv_rect: [f32; 4],
    /// Foreground color (RGBA, premultiplied alpha).
    pub fg_color: [f32; 4],
    /// Background color (RGBA, a=0 for transparent).
    pub bg_color: [f32; 4],
    /// Glyph size in pixels.
    pub size: [f32; 2],
}

/// The wgpu terminal renderer.
pub struct TerminalRenderer {
    // TODO: Phase 3 — wgpu device, queue, surface, pipeline, buffers
    pub width: u32,
    pub height: u32,
}

impl TerminalRenderer {
    /// Create a placeholder renderer (Phase 3 will initialize wgpu).
    pub fn new_placeholder(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    /// Resize the render surface.
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        // TODO: Phase 3 — reconfigure wgpu surface
    }
}
