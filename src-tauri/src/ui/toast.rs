//! Toast notification overlay — transient messages at bottom-right.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, GradientRectInstance, RectInstance};

const TOAST_WIDTH: f32 = 320.0;
const TOAST_HEIGHT: f32 = 32.0;
const TOAST_MARGIN: f32 = 8.0;
const TOAST_DURATION: u32 = 180; // ~3 seconds at 60fps

/// Toast severity level.
#[derive(Clone)]
pub enum ToastLevel {
    Info,
    Success,
    Warning,
    Error,
}

/// A single toast notification.
#[derive(Clone)]
pub struct Toast {
    pub message: String,
    pub level: ToastLevel,
    pub remaining: u32,
}

/// Toast notification manager.
pub struct ToastManager {
    toasts: Vec<Toast>,
}

impl ToastManager {
    pub fn new() -> Self {
        Self { toasts: Vec::new() }
    }

    /// Show a toast notification.
    pub fn show(&mut self, message: String, level: ToastLevel) {
        self.toasts.push(Toast {
            message,
            level,
            remaining: TOAST_DURATION,
        });
        // Keep at most 5 active toasts
        if self.toasts.len() > 5 {
            self.toasts.remove(0);
        }
    }

    /// Convenience methods.
    pub fn info(&mut self, msg: impl Into<String>) {
        self.show(msg.into(), ToastLevel::Info);
    }

    pub fn success(&mut self, msg: impl Into<String>) {
        self.show(msg.into(), ToastLevel::Success);
    }

    pub fn error(&mut self, msg: impl Into<String>) {
        self.show(msg.into(), ToastLevel::Error);
    }

    /// Whether there are no active toasts.
    pub fn is_empty(&self) -> bool {
        self.toasts.is_empty()
    }

    /// Tick — decrement timers and remove expired.
    pub fn tick(&mut self) {
        for toast in &mut self.toasts {
            toast.remaining = toast.remaining.saturating_sub(1);
        }
        self.toasts.retain(|t| t.remaining > 0);
    }

    /// Build toast overlay (bottom-right of window).
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
        window_h: f32,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        for (i, toast) in self.toasts.iter().enumerate() {
            let x = window_w - TOAST_WIDTH - TOAST_MARGIN;
            let y = window_h - (i as f32 + 1.0) * (TOAST_HEIGHT + TOAST_MARGIN) - 30.0;

            // Fade out in last 30 frames
            let alpha = if toast.remaining < 30 {
                toast.remaining as f32 / 30.0
            } else {
                1.0
            };

            // Left accent stripe colors (3px)
            let stripe_color = match toast.level {
                ToastLevel::Info => [0.537 * alpha, 0.706 * alpha, 0.980 * alpha, alpha],    // #89b4fa
                ToastLevel::Success => [0.651 * alpha, 0.890 * alpha, 0.631 * alpha, alpha], // #a6e3a1
                ToastLevel::Warning => [0.976 * alpha, 0.886 * alpha, 0.686 * alpha, alpha], // #f9e2af
                ToastLevel::Error => [0.953 * alpha, 0.545 * alpha, 0.659 * alpha, alpha],   // #f38ba8
            };

            // Drop shadow (scaled by alpha for fade-out)
            if alpha > 0.3 {
                for mut sr in super::shadow::toast_shadow([x, y], [TOAST_WIDTH, TOAST_HEIGHT], 8.0) {
                    sr.color[3] *= alpha;
                    rects.push(sr);
                }
            }

            // Background: rgba(28,28,28,0.72) — glass-thick
            // Border: 1px rgba(255,255,255,0.1), corner radius 8
            let bg_alpha = 0.72 * alpha;
            let bg_r = 28.0 / 255.0 * bg_alpha;
            rects.push(RectInstance::bordered(
                [x, y], [TOAST_WIDTH, TOAST_HEIGHT],
                [bg_r, bg_r, bg_r, bg_alpha], 8.0, 1.0, 0.1,
            ));

            // Left accent stripe (3px)
            rects.push(RectInstance::rounded([x, y], [3.0, TOAST_HEIGHT], stripe_color, 8.0));

            // Text: rgba(255,255,255,0.88) — text-primary
            let text_y = y + (TOAST_HEIGHT - font.cell_height) / 2.0;
            let max_chars = ((TOAST_WIDTH - 24.0) / font.cell_width) as usize;
            let display = if toast.message.chars().count() > max_chars {
                let t: String = toast.message.chars().take(max_chars.saturating_sub(3)).collect();
                format!("{}...", t)
            } else {
                toast.message.clone()
            };
            let text_color = [0.88 * alpha, 0.88 * alpha, 0.88 * alpha, 0.88 * alpha];
            super::render_text(font, atlas, &display, x + 10.0, text_y, text_color, &mut glyphs);
        }

        (rects, glyphs)
    }
}

impl Default for ToastManager {
    fn default() -> Self {
        Self::new()
    }
}
