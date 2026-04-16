//! Analytics — cost/token tracking with wgpu-rendered line chart.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use super::cat;

/// A single usage data point.
pub struct UsagePoint {
    pub timestamp: i64,    // Unix timestamp (seconds)
    pub cli: String,       // "claude", "codex", "gemini"
    pub cost: f64,
    pub tokens: u64,
}

/// Aggregated analytics state.
pub struct AnalyticsState {
    pub data: Vec<UsagePoint>,
    pub visible: bool,
}

/// Output of analytics rendering.
pub struct AnalyticsOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

impl AnalyticsState {
    pub fn new() -> Self {
        Self {
            data: Vec::new(),
            visible: false,
        }
    }

    /// Record a usage data point with current Unix timestamp.
    pub fn record(&mut self, cli: String, cost: f64, tokens: u64) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.data.push(UsagePoint {
            timestamp,
            cli,
            cost,
            tokens,
        });
    }

    /// Sum of all recorded costs.
    pub fn total_cost(&self) -> f64 {
        self.data.iter().map(|p| p.cost).sum()
    }

    /// Sum of all recorded tokens.
    pub fn total_tokens(&self) -> u64 {
        self.data.iter().map(|p| p.tokens).sum()
    }

    /// Cost since midnight today (local time).
    pub fn today_cost(&self) -> f64 {
        let midnight = midnight_today();
        self.data
            .iter()
            .filter(|p| p.timestamp >= midnight)
            .map(|p| p.cost)
            .sum()
    }

    /// Tokens since midnight today (local time).
    pub fn today_tokens(&self) -> u64 {
        let midnight = midnight_today();
        self.data
            .iter()
            .filter(|p| p.timestamp >= midnight)
            .map(|p| p.tokens)
            .sum()
    }

    /// Build the analytics view into rect and glyph instances.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> AnalyticsOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background panel
        rects.push(RectInstance::rounded(
            [x, y],
            [w, h],
            cat::pm(24, 24, 37, 230),
            8.0,
        ));

        // --- Summary cards ---
        let card_h = 48.0;
        let card_gap = 8.0;
        let card_w = ((w - card_gap * 5.0) / 4.0).max(80.0);
        let cards_y = y + 12.0;

        let today_cost_str = format!("Today: ${:.2}", self.today_cost());
        let today_tok_str = format!("Today: {}tok", self.today_tokens());
        let total_cost_str = format!("Total: ${:.2}", self.total_cost());
        let total_tok_str = format!("Total: {}tok", self.total_tokens());

        let card_specs: [(&str, [f32; 4], [f32; 4]); 4] = [
            (&today_cost_str, cat::pm(166, 227, 161, 40), cat::GREEN),
            (&today_tok_str, cat::pm(137, 180, 250, 40), cat::BLUE),
            (&total_cost_str, cat::pm(166, 227, 161, 25), [0.50, 0.72, 0.48, 1.0]),
            (&total_tok_str, cat::pm(137, 180, 250, 25), [0.42, 0.56, 0.78, 1.0]),
        ];

        for (i, (label, bg_color, text_color)) in card_specs.iter().enumerate() {
            let cx = x + card_gap + (card_w + card_gap) * i as f32;
            rects.push(RectInstance::rounded(
                [cx, cards_y],
                [card_w, card_h],
                *bg_color,
                8.0,
            ));
            let text_y = cards_y + (card_h - font.cell_height) / 2.0;
            let text_x = cx + 8.0;
            super::render_text(font, atlas, label, text_x, text_y, *text_color, &mut glyphs);
        }

        // --- Line chart ---
        let chart_top = cards_y + card_h + 16.0;
        let chart_left = x + 60.0; // room for Y-axis labels
        let chart_right = x + w - 16.0;
        let chart_bottom = y + h - 32.0; // room for X-axis labels
        let chart_w = chart_right - chart_left;
        let chart_h = chart_bottom - chart_top;

        if chart_w < 40.0 || chart_h < 40.0 {
            return AnalyticsOutput { rects, glyphs };
        }

        // Axes
        // Y axis
        rects.push(RectInstance::new(
            [chart_left, chart_top],
            [1.0, chart_h],
            cat::pm(69, 71, 90, 180),
        ));
        // X axis
        rects.push(RectInstance::new(
            [chart_left, chart_bottom],
            [chart_w, 1.0],
            cat::pm(69, 71, 90, 180),
        ));

        // Aggregate cost per day for last 7 days
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let day_secs: i64 = 86400;
        let today_start = midnight_today();

        let mut daily_costs: [f64; 7] = [0.0; 7];
        for point in &self.data {
            for day_idx in 0..7i64 {
                let day_start = today_start - day_idx * day_secs;
                let day_end = day_start + day_secs;
                if point.timestamp >= day_start && point.timestamp < day_end {
                    daily_costs[day_idx as usize] += point.cost;
                    break;
                }
            }
        }
        // Reverse so index 0 = 6 days ago, index 6 = today
        daily_costs.reverse();

        // Find max for Y scale
        let max_cost = daily_costs.iter().cloned().fold(0.01_f64, f64::max);

        // Day labels
        let day_labels = compute_day_labels(now);

        let num_days = 7;
        let step_x = chart_w / (num_days as f32 - 1.0_f32).max(1.0);

        // X axis labels and grid lines
        for i in 0..num_days {
            let dx = chart_left + step_x * i as f32;
            // Grid line (subtle)
            rects.push(RectInstance::new(
                [dx, chart_top],
                [1.0, chart_h],
                cat::pm(69, 71, 90, 40),
            ));
            // Label
            let label_y = chart_bottom + 4.0;
            let label_x = dx - font.cell_width; // center roughly
            super::render_text(
                font,
                atlas,
                &day_labels[i],
                label_x,
                label_y,
                cat::SUBTEXT0,
                &mut glyphs,
            );
        }

        // Y axis labels (0 and max)
        let y_label_0 = format!("$0");
        let y_label_max = format!("${:.2}", max_cost);
        super::render_text(
            font,
            atlas,
            &y_label_0,
            x + 4.0,
            chart_bottom - font.cell_height,
            cat::SUBTEXT0,
            &mut glyphs,
        );
        super::render_text(
            font,
            atlas,
            &y_label_max,
            x + 4.0,
            chart_top,
            cat::SUBTEXT0,
            &mut glyphs,
        );

        // Data points and staircase connections
        let dot_radius = 4.0;
        let dot_color = cat::pm(137, 180, 250, 220);
        let line_color = cat::pm(137, 180, 250, 120);
        let line_thickness = 2.0;

        let mut prev_point: Option<(f32, f32)> = None;
        for i in 0..num_days {
            let dx = chart_left + step_x * i as f32;
            let ratio = (daily_costs[i] / max_cost) as f32;
            let dy = chart_bottom - ratio * chart_h;

            // Dot
            rects.push(RectInstance::rounded(
                [dx - dot_radius, dy - dot_radius],
                [dot_radius * 2.0, dot_radius * 2.0],
                dot_color,
                dot_radius,
            ));

            // Staircase line from previous point
            if let Some((px, py)) = prev_point {
                // Horizontal segment: from prev_x to curr_x at prev_y
                let seg_x = px;
                let seg_w = dx - px;
                rects.push(RectInstance::new(
                    [seg_x, py - line_thickness / 2.0],
                    [seg_w, line_thickness],
                    line_color,
                ));
                // Vertical segment: from prev_y to curr_y at curr_x
                let seg_y = py.min(dy);
                let seg_h = (py - dy).abs();
                rects.push(RectInstance::new(
                    [dx - line_thickness / 2.0, seg_y],
                    [line_thickness, seg_h],
                    line_color,
                ));
            }

            prev_point = Some((dx, dy));
        }

        // Title
        super::render_text(
            font,
            atlas,
            "Cost / Last 7 Days",
            chart_left,
            chart_top - font.cell_height - 4.0,
            cat::SUBTEXT1,
            &mut glyphs,
        );

        AnalyticsOutput { rects, glyphs }
    }
}

impl Default for AnalyticsState {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute Unix timestamp of midnight today (UTC approximation).
/// For simplicity we use UTC midnight. A more refined version would
/// query the local timezone, but that adds platform complexity.
fn midnight_today() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let day_secs: i64 = 86400;
    (now / day_secs) * day_secs
}

/// Generate short day labels for the last 7 days ending at `now_ts`.
fn compute_day_labels(now_ts: i64) -> [String; 7] {
    let day_secs: i64 = 86400;
    // Compute the weekday of today. Unix epoch (1970-01-01) was a Thursday (day 4).
    let today_day = ((now_ts / day_secs) % 7 + 4) % 7; // 0=Sun,1=Mon,...6=Sat
    let weekday_labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let mut labels: [String; 7] = Default::default();
    for i in 0..7 {
        let days_ago = 6 - i as i64;
        let day_of_week = ((today_day - days_ago % 7 + 7) % 7) as usize;
        labels[i] = weekday_labels[day_of_week].to_string();
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_and_totals() {
        let mut state = AnalyticsState::new();
        state.record("claude".into(), 0.05, 1000);
        state.record("codex".into(), 0.10, 2000);
        state.record("gemini".into(), 0.03, 500);

        assert!((state.total_cost() - 0.18).abs() < 1e-9);
        assert_eq!(state.total_tokens(), 3500);
    }

    #[test]
    fn test_today_cost_filters_by_date() {
        let mut state = AnalyticsState::new();
        // Record a point "today"
        state.record("claude".into(), 0.10, 1000);

        // Manually insert a point from yesterday
        let yesterday_ts = midnight_today() - 86400;
        state.data.push(UsagePoint {
            timestamp: yesterday_ts,
            cli: "codex".into(),
            cost: 0.50,
            tokens: 5000,
        });

        // today_cost should only include today's point
        assert!((state.today_cost() - 0.10).abs() < 1e-9);
        assert_eq!(state.today_tokens(), 1000);

        // total should include both
        assert!((state.total_cost() - 0.60).abs() < 1e-9);
        assert_eq!(state.total_tokens(), 6000);
    }

    #[test]
    fn test_build_empty_data_no_panic() {
        let state = AnalyticsState::new();
        let font = FontManager::new(14.0, 1.2);
        let mut atlas = crate::gpu::atlas::GlyphAtlas::new(512, 512);
        let output = state.build(&font, &mut atlas, 0.0, 0.0, 800.0, 600.0);
        // Should produce some rects (at least the background + axes + cards)
        assert!(!output.rects.is_empty());
    }

    #[test]
    fn test_build_single_data_point_no_panic() {
        let mut state = AnalyticsState::new();
        state.record("claude".into(), 0.05, 1000);
        let font = FontManager::new(14.0, 1.2);
        let mut atlas = crate::gpu::atlas::GlyphAtlas::new(512, 512);
        let output = state.build(&font, &mut atlas, 100.0, 100.0, 600.0, 400.0);
        assert!(!output.rects.is_empty());
        assert!(!output.glyphs.is_empty());
    }
}
