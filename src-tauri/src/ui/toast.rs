//! Toast notification overlay — transient messages at bottom-right.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const TOAST_WIDTH: f32 = 300.0;
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

            let border_color = match toast.level {
                ToastLevel::Info => cat::pm(137, 180, 250, (200.0 * alpha) as u8),
                ToastLevel::Success => cat::pm(166, 227, 161, (200.0 * alpha) as u8),
                ToastLevel::Warning => cat::pm(249, 226, 175, (200.0 * alpha) as u8),
                ToastLevel::Error => cat::pm(243, 139, 168, (200.0 * alpha) as u8),
            };

            // Background
            rects.push(RectInstance::rounded([x, y], [TOAST_WIDTH, TOAST_HEIGHT], cat::pm(30, 30, 46, (230.0 * alpha) as u8), 6.0));

            // Left border
            rects.push(RectInstance::new([x, y], [3.0, TOAST_HEIGHT], border_color));

            // Text
            let text_y = y + (TOAST_HEIGHT - font.cell_height) / 2.0;
            let max_chars = ((TOAST_WIDTH - 16.0) / font.cell_width) as usize;
            let display = if toast.message.chars().count() > max_chars {
                let t: String = toast.message.chars().take(max_chars.saturating_sub(3)).collect();
                format!("{}...", t)
            } else {
                toast.message.clone()
            };
            let text_color = [
                cat::TEXT[0] * alpha,
                cat::TEXT[1] * alpha,
                cat::TEXT[2] * alpha,
                alpha,
            ];
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
