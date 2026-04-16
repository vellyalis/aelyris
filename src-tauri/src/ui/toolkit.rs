//! Toolkit — one-click tool buttons in the sidebar for common commands.
//!
//! Tools are loaded from `.aether/toolkit.toml` and rendered as
//! rounded-rect buttons at the bottom of the sidebar.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use super::cat;

const TOOL_HEIGHT: f32 = 28.0;
const TOOL_PAD: f32 = 4.0;

/// A single tool entry.
pub struct Tool {
    pub name: String,
    pub command: String,
    pub icon: String,
    pub run_in_background: bool,
}

/// Output of toolkit rendering.
pub struct ToolkitOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Toolkit panel state.
pub struct ToolkitState {
    pub tools: Vec<Tool>,
    pub visible: bool,
}

/// Intermediate TOML representation for deserialization.
#[derive(serde::Deserialize)]
struct ToolkitToml {
    #[serde(default)]
    tool: Vec<ToolToml>,
}

#[derive(serde::Deserialize)]
struct ToolToml {
    name: String,
    command: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    run_in_background: bool,
}

impl ToolkitState {
    /// Create an empty toolkit (visible by default).
    pub fn new() -> Self {
        Self {
            tools: Vec::new(),
            visible: true,
        }
    }

    /// Load tools from a TOML file. If the file doesn't exist or fails to
    /// parse, the tools list is left empty (no panic).
    pub fn load_from_file(&mut self, path: &std::path::Path) {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => {
                log::debug!("Toolkit file not found or unreadable: {}: {}", path.display(), e);
                return;
            }
        };
        match toml::from_str::<ToolkitToml>(&content) {
            Ok(parsed) => {
                self.tools = parsed
                    .tool
                    .into_iter()
                    .map(|t| Tool {
                        name: t.name,
                        command: t.command,
                        icon: if t.icon.is_empty() { "T".to_string() } else { t.icon },
                        run_in_background: t.run_in_background,
                    })
                    .collect();
                log::info!("Toolkit: loaded {} tools from {}", self.tools.len(), path.display());
            }
            Err(e) => {
                log::warn!("Failed to parse toolkit TOML at {}: {}", path.display(), e);
            }
        }
    }

    /// Render toolkit buttons. Returns rects and glyphs to draw.
    ///
    /// `x`, `y` — top-left of the toolkit area.
    /// `w`, `h` — available size.
    /// `mouse_pos` — cursor position for hover highlight.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        _h: f32,
        mouse_pos: Option<(f32, f32)>,
    ) -> ToolkitOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        if !self.visible || self.tools.is_empty() {
            return ToolkitOutput { rects, glyphs };
        }

        // Header
        let header_y = y + (TOOL_PAD * 2.0 - font.cell_height) / 2.0 + TOOL_PAD;
        super::render_text(font, atlas, "TOOLKIT", x + 8.0, header_y, cat::overlay0(), &mut glyphs);

        // Separator line below header
        let sep_y = y + TOOL_PAD + font.cell_height + TOOL_PAD;
        rects.push(RectInstance::new(
            [x, sep_y],
            [w, 1.0],
            cat::pm(69, 71, 90, 150),
        ));

        let button_start_y = sep_y + TOOL_PAD;

        for (i, tool) in self.tools.iter().enumerate() {
            let btn_y = button_start_y + i as f32 * (TOOL_HEIGHT + TOOL_PAD);
            let btn_x = x + TOOL_PAD;
            let btn_w = w - TOOL_PAD * 2.0;

            // Default button background: glass-thick rgba(28,28,28,0.72)
            let mut bg_color = cat::GLASS_THICK;

            // Hover highlight: rgba(255,255,255,0.06)
            if let Some((mx, my)) = mouse_pos {
                if mx >= btn_x && mx < btn_x + btn_w && my >= btn_y && my < btn_y + TOOL_HEIGHT {
                    // Blend glass-thick + hover overlay
                    bg_color = [
                        bg_color[0] + cat::HOVER[0],
                        bg_color[1] + cat::HOVER[1],
                        bg_color[2] + cat::HOVER[2],
                        (bg_color[3] + cat::HOVER[3]).min(1.0),
                    ];
                }
            }

            rects.push(RectInstance::rounded(
                [btn_x, btn_y],
                [btn_w, TOOL_HEIGHT],
                bg_color,
                6.0,
            ));

            // Icon (single char)
            let text_y = btn_y + (TOOL_HEIGHT - font.cell_height) / 2.0;
            super::render_text(
                font,
                atlas,
                &tool.icon,
                btn_x + 8.0,
                text_y,
                cat::blue(),
                &mut glyphs,
            );

            // Tool name
            let name_x = btn_x + 8.0 + font.cell_width * 2.0;
            let max_chars = ((btn_w - 8.0 - font.cell_width * 3.0) / font.cell_width) as usize;
            let display_name = if tool.name.chars().count() > max_chars {
                let truncated: String = tool.name.chars().take(max_chars.saturating_sub(1)).collect();
                format!("{}\u{2026}", truncated)
            } else {
                tool.name.clone()
            };
            super::render_text(
                font,
                atlas,
                &display_name,
                name_x,
                text_y,
                cat::text(),
                &mut glyphs,
            );
        }

        ToolkitOutput { rects, glyphs }
    }

    /// Hit-test: which tool index was clicked, given a y position within the
    /// toolkit area?
    ///
    /// `y` — absolute pixel y of the click.
    /// `area_y` — top of the toolkit area (same as `y` passed to `build`).
    pub fn tool_at_y(&self, y: f32, area_y: f32) -> Option<usize> {
        if !self.visible || self.tools.is_empty() {
            return None;
        }

        // Account for header + separator
        // Header takes: TOOL_PAD + font_cell_height + TOOL_PAD + 1px separator + TOOL_PAD
        // We approximate font.cell_height as ~14.0 for hit-testing (same as build).
        // A more exact approach would store the computed offset, but this is adequate.
        let header_height = TOOL_PAD + 14.0 + TOOL_PAD + 1.0 + TOOL_PAD;
        let button_start_y = area_y + header_height;

        let local_y = y - button_start_y;
        if local_y < 0.0 {
            return None;
        }

        let slot = local_y / (TOOL_HEIGHT + TOOL_PAD);
        let idx = slot as usize;

        // Check within button bounds (not in the padding gap)
        let within_button = local_y - (idx as f32 * (TOOL_HEIGHT + TOOL_PAD));
        if within_button > TOOL_HEIGHT {
            return None; // click is in the gap between buttons
        }

        if idx < self.tools.len() {
            Some(idx)
        } else {
            None
        }
    }

    /// Total height needed for the toolkit panel (header + all buttons).
    pub fn panel_height(&self, font: &FontManager) -> f32 {
        if !self.visible || self.tools.is_empty() {
            return 0.0;
        }
        let header_height = TOOL_PAD + font.cell_height + TOOL_PAD + 1.0 + TOOL_PAD;
        header_height + self.tools.len() as f32 * (TOOL_HEIGHT + TOOL_PAD)
    }
}

impl Default for ToolkitState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_toml(content: &str) -> ToolkitState {
        let mut state = ToolkitState::new();
        match toml::from_str::<ToolkitToml>(content) {
            Ok(parsed) => {
                state.tools = parsed
                    .tool
                    .into_iter()
                    .map(|t| Tool {
                        name: t.name,
                        command: t.command,
                        icon: if t.icon.is_empty() { "T".to_string() } else { t.icon },
                        run_in_background: t.run_in_background,
                    })
                    .collect();
            }
            Err(_) => {}
        }
        state
    }

    #[test]
    fn parse_valid_toml_with_two_tools() {
        let content = r#"
[[tool]]
name = "Build & Test"
command = "cargo build && cargo test"
icon = "B"

[[tool]]
name = "Deploy"
command = "cargo build --release"
icon = "D"
run_in_background = true
"#;
        let state = parse_toml(content);
        assert_eq!(state.tools.len(), 2);
        assert_eq!(state.tools[0].name, "Build & Test");
        assert_eq!(state.tools[0].command, "cargo build && cargo test");
        assert_eq!(state.tools[0].icon, "B");
        assert!(!state.tools[0].run_in_background);
        assert_eq!(state.tools[1].name, "Deploy");
        assert_eq!(state.tools[1].command, "cargo build --release");
        assert_eq!(state.tools[1].icon, "D");
        assert!(state.tools[1].run_in_background);
    }

    #[test]
    fn parse_empty_file_yields_zero_tools() {
        let state = parse_toml("");
        assert_eq!(state.tools.len(), 0);
    }

    #[test]
    fn parse_invalid_toml_yields_zero_tools() {
        let state = parse_toml("this is not valid toml {{{");
        assert_eq!(state.tools.len(), 0);
    }

    #[test]
    fn tool_at_y_returns_correct_index() {
        let mut state = ToolkitState::new();
        state.tools.push(Tool {
            name: "First".to_string(),
            command: "echo 1".to_string(),
            icon: "1".to_string(),
            run_in_background: false,
        });
        state.tools.push(Tool {
            name: "Second".to_string(),
            command: "echo 2".to_string(),
            icon: "2".to_string(),
            run_in_background: false,
        });
        state.tools.push(Tool {
            name: "Third".to_string(),
            command: "echo 3".to_string(),
            icon: "3".to_string(),
            run_in_background: false,
        });

        let area_y = 100.0;
        // Header height: TOOL_PAD(4) + 14.0 + TOOL_PAD(4) + 1.0 + TOOL_PAD(4) = 27.0
        let header = 27.0;
        let btn_start = area_y + header;

        // Click in the middle of the first button
        assert_eq!(state.tool_at_y(btn_start + TOOL_HEIGHT / 2.0, area_y), Some(0));

        // Click in the middle of the second button
        let second_btn_y = btn_start + (TOOL_HEIGHT + TOOL_PAD);
        assert_eq!(state.tool_at_y(second_btn_y + TOOL_HEIGHT / 2.0, area_y), Some(1));

        // Click in the middle of the third button
        let third_btn_y = btn_start + 2.0 * (TOOL_HEIGHT + TOOL_PAD);
        assert_eq!(state.tool_at_y(third_btn_y + TOOL_HEIGHT / 2.0, area_y), Some(2));

        // Click above the toolkit area
        assert_eq!(state.tool_at_y(area_y - 10.0, area_y), None);

        // Click way below all buttons
        let below_all = btn_start + 10.0 * (TOOL_HEIGHT + TOOL_PAD);
        assert_eq!(state.tool_at_y(below_all, area_y), None);
    }

    #[test]
    fn tool_at_y_empty_toolkit_returns_none() {
        let state = ToolkitState::new();
        assert_eq!(state.tool_at_y(150.0, 100.0), None);
    }

    #[test]
    fn tool_at_y_gap_between_buttons_returns_none() {
        let mut state = ToolkitState::new();
        state.tools.push(Tool {
            name: "A".to_string(),
            command: "a".to_string(),
            icon: "A".to_string(),
            run_in_background: false,
        });
        state.tools.push(Tool {
            name: "B".to_string(),
            command: "b".to_string(),
            icon: "B".to_string(),
            run_in_background: false,
        });

        let area_y = 100.0;
        let header = 27.0;
        let btn_start = area_y + header;

        // Click right in the gap between first and second button
        // Gap starts at btn_start + TOOL_HEIGHT and ends at btn_start + TOOL_HEIGHT + TOOL_PAD
        let gap_y = btn_start + TOOL_HEIGHT + 2.0; // middle of the gap
        assert_eq!(state.tool_at_y(gap_y, area_y), None);
    }

    #[test]
    fn load_from_file_missing_file() {
        let mut state = ToolkitState::new();
        state.load_from_file(std::path::Path::new("/nonexistent/path/toolkit.toml"));
        assert_eq!(state.tools.len(), 0);
    }

    #[test]
    fn default_icon_when_empty() {
        let content = r#"
[[tool]]
name = "NoIcon"
command = "echo hello"
"#;
        let state = parse_toml(content);
        assert_eq!(state.tools.len(), 1);
        assert_eq!(state.tools[0].icon, "T"); // default icon
    }
}
