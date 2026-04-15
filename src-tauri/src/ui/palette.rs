//! Command palette — Ctrl+Shift+P overlay.
//!
//! Floating overlay with text input and filtered command list.
//! Rendered as RectInstance + GlyphInstance on top of all content.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const PALETTE_WIDTH: f32 = 500.0;
const INPUT_HEIGHT: f32 = 32.0;
const ITEM_HEIGHT: f32 = 26.0;
const MAX_VISIBLE_ITEMS: usize = 10;
const PADDING: f32 = 8.0;

/// A command that can be executed from the palette.
#[derive(Clone)]
pub struct PaletteCommand {
    pub id: &'static str,
    pub label: &'static str,
    pub shortcut: &'static str,
}

/// Actions produced by the command palette.
#[derive(Debug, Clone)]
pub enum PaletteAction {
    NewTab,
    CloseTab,
    ToggleSidebar,
    SaveFile,
    CloseEditor,
    None,
}

/// Built-in commands.
const COMMANDS: &[PaletteCommand] = &[
    PaletteCommand { id: "new_tab", label: "New Terminal Tab", shortcut: "" },
    PaletteCommand { id: "close_tab", label: "Close Tab", shortcut: "" },
    PaletteCommand { id: "toggle_sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B" },
    PaletteCommand { id: "save_file", label: "Save File", shortcut: "Ctrl+S" },
    PaletteCommand { id: "close_editor", label: "Close Editor", shortcut: "Esc" },
];

pub struct PaletteOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Command palette state.
pub struct PaletteState {
    pub visible: bool,
    pub input: String,
    pub selected: usize,
    filtered: Vec<usize>, // indices into COMMANDS
}

impl PaletteState {
    pub fn new() -> Self {
        let filtered = (0..COMMANDS.len()).collect();
        Self {
            visible: false,
            input: String::new(),
            selected: 0,
            filtered,
        }
    }

    pub fn toggle(&mut self) {
        self.visible = !self.visible;
        if self.visible {
            self.input.clear();
            self.selected = 0;
            self.update_filter();
        }
    }

    pub fn close(&mut self) {
        self.visible = false;
    }

    /// Insert a character into the input.
    pub fn insert_char(&mut self, ch: &str) {
        self.input.push_str(ch);
        self.selected = 0;
        self.update_filter();
    }

    /// Delete last character.
    pub fn backspace(&mut self) {
        self.input.pop();
        self.selected = 0;
        self.update_filter();
    }

    /// Move selection up.
    pub fn select_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
        }
    }

    /// Move selection down.
    pub fn select_down(&mut self) {
        if self.selected + 1 < self.filtered.len() {
            self.selected += 1;
        }
    }

    /// Execute the selected command.
    pub fn execute(&mut self) -> PaletteAction {
        let action = if let Some(&cmd_idx) = self.filtered.get(self.selected) {
            match COMMANDS[cmd_idx].id {
                "new_tab" => PaletteAction::NewTab,
                "close_tab" => PaletteAction::CloseTab,
                "toggle_sidebar" => PaletteAction::ToggleSidebar,
                "save_file" => PaletteAction::SaveFile,
                "close_editor" => PaletteAction::CloseEditor,
                _ => PaletteAction::None,
            }
        } else {
            PaletteAction::None
        };
        self.close();
        action
    }

    fn update_filter(&mut self) {
        let query = self.input.to_lowercase();
        self.filtered = (0..COMMANDS.len())
            .filter(|&i| {
                if query.is_empty() {
                    return true;
                }
                COMMANDS[i].label.to_lowercase().contains(&query)
            })
            .collect();
    }

    /// Build overlay rendering instances.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
    ) -> PaletteOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        if !self.visible {
            return PaletteOutput { rects, glyphs };
        }

        let palette_x = (window_w - PALETTE_WIDTH) / 2.0;
        let palette_y: f32 = 80.0;
        let visible_items = self.filtered.len().min(MAX_VISIBLE_ITEMS);
        let palette_h = INPUT_HEIGHT + visible_items as f32 * ITEM_HEIGHT + PADDING * 2.0;

        // Dimmed backdrop
        rects.push(RectInstance {
            pos: [0.0, 0.0],
            size: [window_w, 2000.0],
            color: [0.0, 0.0, 0.0, 0.4],
        });

        // Palette background
        rects.push(RectInstance {
            pos: [palette_x, palette_y],
            size: [PALETTE_WIDTH, palette_h],
            color: cat::pm(30, 30, 46, 250),
        });

        // Border
        rects.push(RectInstance {
            pos: [palette_x, palette_y],
            size: [PALETTE_WIDTH, 1.0],
            color: cat::pm(137, 180, 250, 200), // Blue border top
        });

        // Input background
        let input_y = palette_y + PADDING;
        rects.push(RectInstance {
            pos: [palette_x + PADDING, input_y],
            size: [PALETTE_WIDTH - PADDING * 2.0, INPUT_HEIGHT],
            color: cat::pm(24, 24, 37, 250),
        });

        // Input text
        let text_y = input_y + (INPUT_HEIGHT - font.cell_height) / 2.0;
        let display_input = if self.input.is_empty() {
            "> Type a command..."
        } else {
            &self.input
        };
        let input_color = if self.input.is_empty() {
            cat::OVERLAY0
        } else {
            cat::TEXT
        };
        super::render_text(
            font,
            atlas,
            display_input,
            palette_x + PADDING + 4.0,
            text_y,
            input_color,
            &mut glyphs,
        );

        // Cursor in input
        if !self.input.is_empty() {
            let cursor_x = palette_x + PADDING + 4.0
                + self.input.chars().count() as f32 * font.cell_width;
            rects.push(RectInstance {
                pos: [cursor_x, text_y],
                size: [2.0, font.cell_height],
                color: cat::TEXT,
            });
        }

        // Command list
        let list_y = input_y + INPUT_HEIGHT + 4.0;
        for (i, &cmd_idx) in self.filtered.iter().enumerate().take(MAX_VISIBLE_ITEMS) {
            let item_y = list_y + i as f32 * ITEM_HEIGHT;
            let cmd = &COMMANDS[cmd_idx];

            // Selected highlight
            if i == self.selected {
                rects.push(RectInstance {
                    pos: [palette_x + PADDING, item_y],
                    size: [PALETTE_WIDTH - PADDING * 2.0, ITEM_HEIGHT],
                    color: cat::pm(69, 71, 90, 150),
                });
            }

            // Command label
            let label_y = item_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
            super::render_text(
                font,
                atlas,
                cmd.label,
                palette_x + PADDING + 8.0,
                label_y,
                cat::TEXT,
                &mut glyphs,
            );

            // Shortcut (right-aligned)
            if !cmd.shortcut.is_empty() {
                let shortcut_w = cmd.shortcut.chars().count() as f32 * font.cell_width;
                super::render_text(
                    font,
                    atlas,
                    cmd.shortcut,
                    palette_x + PALETTE_WIDTH - PADDING - 8.0 - shortcut_w,
                    label_y,
                    cat::OVERLAY0,
                    &mut glyphs,
                );
            }
        }

        PaletteOutput { rects, glyphs }
    }
}

impl Default for PaletteState {
    fn default() -> Self {
        Self::new()
    }
}
