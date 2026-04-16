//! Cursor rendering (bar, block, underline) with blink animation.

/// Cursor visual style.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CursorStyle {
    Block,
    Bar,
    Underline,
}

impl Default for CursorStyle {
    fn default() -> Self {
        Self::Bar
    }
}

/// Cursor render state.
pub struct CursorRender {
    pub style: CursorStyle,
    pub blink: bool,
    pub blink_visible: bool,
    pub blink_interval_ms: u64,
    last_toggle: std::time::Instant,
}

impl CursorRender {
    pub fn new() -> Self {
        Self {
            style: CursorStyle::default(),
            blink: true,
            blink_visible: true,
            blink_interval_ms: 530,
            last_toggle: std::time::Instant::now(),
        }
    }

    /// Update blink state. Returns true if visibility changed.
    pub fn tick(&mut self) -> bool {
        if !self.blink {
            return false;
        }
        let elapsed = self.last_toggle.elapsed().as_millis() as u64;
        if elapsed >= self.blink_interval_ms {
            self.blink_visible = !self.blink_visible;
            self.last_toggle = std::time::Instant::now();
            true
        } else {
            false
        }
    }

    /// Reset blink to visible (e.g. after keypress).
    pub fn reset_blink(&mut self) {
        self.blink_visible = true;
        self.last_toggle = std::time::Instant::now();
    }
}
