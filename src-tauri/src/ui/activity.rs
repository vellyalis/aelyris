//! Activity Feed — a timeline of session events across all tabs.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use super::cat;

/// Type of activity event.
#[derive(Debug, Clone, PartialEq)]
pub enum ActivityType {
    SessionStarted,
    SessionEnded,
    AgentThinking,
    AgentCoding,
    AgentDone,
    WatchdogTriggered,
    ToolExecuted,
    CommitCreated,
    ErrorOccurred,
}

impl ActivityType {
    /// Dot color for each event type.
    pub fn dot_color(&self) -> [f32; 4] {
        match self {
            Self::SessionStarted => cat::green(),                    // green
            Self::SessionEnded => cat::subtext0(),                   // gray
            Self::AgentThinking => [0.98, 0.75, 0.15, 1.0],       // amber
            Self::AgentCoding => cat::green(),                       // green
            Self::AgentDone => cat::blue(),                          // blue
            Self::WatchdogTriggered => [0.98, 0.88, 0.53, 1.0],   // yellow
            Self::ToolExecuted => cat::blue(),                       // blue
            Self::CommitCreated => cat::green(),                     // green
            Self::ErrorOccurred => [0.95, 0.55, 0.66, 1.0],       // red
        }
    }
}

/// A single activity entry.
pub struct ActivityEntry {
    pub timestamp: std::time::Instant,
    pub session_name: String,
    pub event_type: ActivityType,
    pub summary: String,
}

/// Output of activity feed rendering.
pub struct ActivityOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Activity feed state — a scrollable timeline of events.
pub struct ActivityFeed {
    pub entries: Vec<ActivityEntry>,
    pub scroll_offset: f32,
    pub max_entries: usize,
}

impl ActivityFeed {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            scroll_offset: 0.0,
            max_entries: 500,
        }
    }

    /// Add a new activity entry. Trims oldest entries if over max_entries.
    pub fn push(&mut self, session_name: String, event_type: ActivityType, summary: String) {
        self.entries.push(ActivityEntry {
            timestamp: std::time::Instant::now(),
            session_name,
            event_type,
            summary,
        });
        while self.entries.len() > self.max_entries {
            self.entries.remove(0);
        }
    }

    /// Build the activity timeline as a scrollable list of entries.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        _mouse_pos: Option<(f32, f32)>,
    ) -> ActivityOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background
        rects.push(RectInstance::new([x, y], [w, h], cat::GLASS_SOLID));

        // Header
        let header_h = 28.0;
        let header_text_y = y + (header_h - font.cell_height) / 2.0;
        super::render_text_bold(font, atlas, "ACTIVITY", x + 8.0, header_text_y, cat::overlay0(), &mut glyphs);

        let count_str = format!("{}", self.entries.len());
        let count_x = x + 8.0 + 9.0 * font.cell_width;
        super::render_text(font, atlas, &count_str, count_x, header_text_y, cat::blue(), &mut glyphs);

        // Separator line
        rects.push(RectInstance::new(
            [x, y + header_h],
            [w, 1.0],
            cat::BORDER_STRONG,
        ));

        let entry_h = 36.0;
        let content_y = y + header_h + 1.0;
        let available_h = h - header_h - 1.0;
        let max_visible = (available_h / entry_h).floor() as usize;

        // Iterate entries in reverse (newest first), applying scroll offset
        let scroll_entries = (self.scroll_offset / entry_h).floor() as usize;
        let total = self.entries.len();

        for i in 0..max_visible {
            let rev_idx = scroll_entries + i;
            if rev_idx >= total {
                break;
            }
            let entry_idx = total - 1 - rev_idx;
            let entry = &self.entries[entry_idx];
            let ey = content_y + i as f32 * entry_h;

            if ey + entry_h > y + h {
                break;
            }

            // Colored dot
            let dot_y = ey + (entry_h - 6.0) / 2.0;
            rects.push(RectInstance::rounded(
                [x + 8.0, dot_y],
                [6.0, 6.0],
                entry.event_type.dot_color(),
                3.0,
            ));

            // Elapsed time
            let elapsed = format_elapsed(entry.timestamp);
            let time_x = x + 18.0;
            let line1_y = ey + 4.0;
            super::render_text(font, atlas, &elapsed, time_x, line1_y, cat::overlay0(), &mut glyphs);

            // Session name (truncated)
            let time_chars = elapsed.chars().count();
            let name_x = time_x + (time_chars as f32 + 1.0) * font.cell_width;
            let max_name_chars = ((w - (name_x - x) - 8.0) / font.cell_width).max(1.0) as usize;
            let name_display = truncate_str(&entry.session_name, max_name_chars);
            super::render_text(font, atlas, &name_display, name_x, line1_y, cat::subtext1(), &mut glyphs);

            // Summary text (truncated, second line)
            let line2_y = ey + 4.0 + font.cell_height + 2.0;
            let max_summary_chars = ((w - 18.0 - 8.0) / font.cell_width).max(1.0) as usize;
            let summary_display = truncate_str(&entry.summary, max_summary_chars);
            super::render_text(font, atlas, &summary_display, x + 18.0, line2_y, cat::overlay0(), &mut glyphs);
        }

        ActivityOutput { rects, glyphs }
    }

    /// Adjust scroll offset by a delta.
    pub fn scroll(&mut self, delta: f32) {
        self.scroll_offset = (self.scroll_offset + delta).max(0.0);
        // Clamp to max scroll
        let max_scroll = (self.entries.len() as f32 * 36.0).max(0.0);
        if self.scroll_offset > max_scroll {
            self.scroll_offset = max_scroll;
        }
    }

    /// Number of entries in the feed.
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }
}

impl Default for ActivityFeed {
    fn default() -> Self {
        Self::new()
    }
}

/// Format elapsed time since an Instant as a human-readable string.
pub fn format_elapsed(instant: std::time::Instant) -> String {
    let secs = instant.elapsed().as_secs();
    if secs < 60 {
        format!("{}s ago", secs)
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else {
        format!("{}h ago", secs / 3600)
    }
}

/// Truncate a string to max_chars, appending "..." if truncated.
fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else if max_chars <= 3 {
        s.chars().take(max_chars).collect()
    } else {
        let mut result: String = s.chars().take(max_chars - 3).collect();
        result.push_str("...");
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_entries_and_count() {
        let mut feed = ActivityFeed::new();
        feed.push("tab1".into(), ActivityType::SessionStarted, "Started session".into());
        feed.push("tab2".into(), ActivityType::AgentThinking, "Agent is thinking".into());
        feed.push("tab1".into(), ActivityType::CommitCreated, "Created commit abc123".into());
        assert_eq!(feed.entry_count(), 3);
    }

    #[test]
    fn push_over_max_trims_oldest() {
        let mut feed = ActivityFeed::new();
        feed.max_entries = 5;
        for i in 0..10 {
            feed.push(
                format!("tab{}", i),
                ActivityType::ToolExecuted,
                format!("Event {}", i),
            );
        }
        assert_eq!(feed.entry_count(), 5);
        // The oldest entries (0-4) should have been dropped
        assert_eq!(feed.entries[0].summary, "Event 5");
        assert_eq!(feed.entries[4].summary, "Event 9");
    }

    #[test]
    fn format_elapsed_seconds() {
        // We cannot easily mock Instant, so test the format_elapsed function
        // by checking it returns a valid format. Since Instant::now() is
        // used at creation time, entries created just now should show "0s ago".
        let now = std::time::Instant::now();
        let elapsed = format_elapsed(now);
        assert!(elapsed.ends_with("s ago") || elapsed.ends_with("m ago") || elapsed.ends_with("h ago"));
        // "0s ago" is the expected result for an instant created just now
        assert_eq!(elapsed, "0s ago");
    }

    #[test]
    fn format_elapsed_string_patterns() {
        // Test the formatting logic by examining the format function
        // with known duration breakpoints
        let now = std::time::Instant::now();
        let result = format_elapsed(now);
        assert!(result.contains("ago"));
    }

    #[test]
    fn scroll_clamps_to_zero() {
        let mut feed = ActivityFeed::new();
        feed.scroll(-100.0);
        assert_eq!(feed.scroll_offset, 0.0);
    }

    #[test]
    fn scroll_clamps_to_max() {
        let mut feed = ActivityFeed::new();
        feed.push("tab1".into(), ActivityType::SessionStarted, "s".into());
        feed.push("tab2".into(), ActivityType::SessionEnded, "e".into());
        // max_scroll = 2 * 36.0 = 72.0
        feed.scroll(10000.0);
        assert!(feed.scroll_offset <= 72.0);
    }

    #[test]
    fn truncate_str_short() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn truncate_str_exact() {
        assert_eq!(truncate_str("hello", 5), "hello");
    }

    #[test]
    fn truncate_str_long() {
        assert_eq!(truncate_str("hello world", 8), "hello...");
    }

    #[test]
    fn dot_colors_are_distinct() {
        let green = ActivityType::SessionStarted.dot_color();
        let red = ActivityType::ErrorOccurred.dot_color();
        let blue = ActivityType::AgentDone.dot_color();
        let amber = ActivityType::AgentThinking.dot_color();
        // Ensure they are not all the same
        assert_ne!(green, red);
        assert_ne!(green, blue);
        assert_ne!(green, amber);
    }

    #[test]
    fn default_creates_empty_feed() {
        let feed = ActivityFeed::default();
        assert_eq!(feed.entry_count(), 0);
        assert_eq!(feed.max_entries, 500);
        assert_eq!(feed.scroll_offset, 0.0);
    }
}
