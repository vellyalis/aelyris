//! Kanban board — task management with columns and cards.
//!
//! Rendered as a ContentPane with 3 columns (Todo, In Progress, Done).
//! Persisted to ~/.aether/kanban.json.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const COLUMN_GAP: f32 = 8.0;
const CARD_HEIGHT: f32 = 40.0;
const CARD_GAP: f32 = 6.0;
const HEADER_HEIGHT: f32 = 32.0;
const CARD_PAD: f32 = 8.0;

/// A kanban card.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct KanbanCard {
    pub id: u32,
    pub title: String,
}

/// A kanban column.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct KanbanColumn {
    pub name: String,
    pub cards: Vec<KanbanCard>,
}

/// Full kanban board state.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct KanbanState {
    pub columns: Vec<KanbanColumn>,
    next_id: u32,
    pub selected_col: usize,
    pub selected_card: Option<usize>,
}

/// Output from kanban rendering.
pub struct KanbanOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

impl KanbanState {
    pub fn new() -> Self {
        Self {
            columns: vec![
                KanbanColumn { name: "Todo".into(), cards: Vec::new() },
                KanbanColumn { name: "In Progress".into(), cards: Vec::new() },
                KanbanColumn { name: "Done".into(), cards: Vec::new() },
            ],
            next_id: 1,
            selected_col: 0,
            selected_card: None,
        }
    }

    /// Load from file or create default.
    pub fn load() -> Self {
        let path = Self::file_path();
        if path.exists() {
            std::fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(Self::new)
        } else {
            Self::new()
        }
    }

    /// Save to file.
    pub fn save(&self) {
        let path = Self::file_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    fn file_path() -> std::path::PathBuf {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home).join(".aether").join("kanban.json")
    }

    /// Add a card to a column.
    pub fn add_card(&mut self, col: usize, title: String) {
        if col < self.columns.len() {
            self.columns[col].cards.push(KanbanCard {
                id: self.next_id,
                title,
            });
            self.next_id += 1;
            self.save();
        }
    }

    /// Move selected card to the next column.
    pub fn move_right(&mut self) {
        if let Some(card_idx) = self.selected_card {
            if self.selected_col + 1 < self.columns.len() {
                let card = self.columns[self.selected_col].cards.remove(card_idx);
                self.selected_col += 1;
                self.columns[self.selected_col].cards.push(card);
                self.selected_card = Some(self.columns[self.selected_col].cards.len() - 1);
                self.save();
            }
        }
    }

    /// Move selected card to the previous column.
    pub fn move_left(&mut self) {
        if let Some(card_idx) = self.selected_card {
            if self.selected_col > 0 {
                let card = self.columns[self.selected_col].cards.remove(card_idx);
                self.selected_col -= 1;
                self.columns[self.selected_col].cards.push(card);
                self.selected_card = Some(self.columns[self.selected_col].cards.len() - 1);
                self.save();
            }
        }
    }

    /// Delete selected card.
    pub fn delete_selected(&mut self) {
        if let Some(card_idx) = self.selected_card {
            if self.selected_col < self.columns.len()
                && card_idx < self.columns[self.selected_col].cards.len()
            {
                self.columns[self.selected_col].cards.remove(card_idx);
                self.selected_card = None;
                self.save();
            }
        }
    }

    /// Select next card in current column.
    pub fn select_down(&mut self) {
        let col = &self.columns[self.selected_col];
        if col.cards.is_empty() { return; }
        self.selected_card = Some(match self.selected_card {
            Some(idx) => (idx + 1).min(col.cards.len() - 1),
            None => 0,
        });
    }

    /// Select previous card.
    pub fn select_up(&mut self) {
        if let Some(idx) = self.selected_card {
            if idx == 0 {
                self.selected_card = None;
            } else {
                self.selected_card = Some(idx - 1);
            }
        }
    }

    /// Switch column focus.
    pub fn focus_col(&mut self, delta: i32) {
        let new_col = (self.selected_col as i32 + delta)
            .clamp(0, self.columns.len() as i32 - 1) as usize;
        self.selected_col = new_col;
        self.selected_card = None;
    }

    /// Build the kanban board rendering.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> KanbanOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        let col_count = self.columns.len() as f32;
        let col_w = (w - COLUMN_GAP * (col_count + 1.0)) / col_count;

        for (ci, col) in self.columns.iter().enumerate() {
            let cx = x + COLUMN_GAP + ci as f32 * (col_w + COLUMN_GAP);
            let is_focused = ci == self.selected_col;

            // Column background
            rects.push(RectInstance::rounded([cx, y], [col_w, h], cat::pm(30, 30, 46, 180), 8.0));

            // Column header
            let header_color = match ci {
                0 => cat::pm(137, 180, 250, 255), // Blue
                1 => cat::pm(249, 226, 175, 255), // Yellow
                2 => cat::pm(166, 227, 161, 255), // Green
                _ => cat::TEXT,
            };
            let header_y = y + (HEADER_HEIGHT - font.cell_height) / 2.0;
            let header_text = format!("{} ({})", col.name, col.cards.len());
            super::render_text(font, atlas, &header_text, cx + CARD_PAD, header_y, header_color, &mut glyphs);

            // Focus indicator
            if is_focused {
                rects.push(RectInstance::new([cx, y], [col_w, 2.0], header_color));
            }

            // Cards
            for (ki, card) in col.cards.iter().enumerate() {
                let ky = y + HEADER_HEIGHT + ki as f32 * (CARD_HEIGHT + CARD_GAP) + CARD_GAP;
                if ky + CARD_HEIGHT > y + h { break; }

                let is_selected = is_focused && self.selected_card == Some(ki);

                // Card background
                let card_color = if is_selected {
                    cat::pm(69, 71, 90, 200)
                } else {
                    cat::pm(45, 45, 59, 200)
                };
                rects.push(RectInstance::rounded([cx + 4.0, ky], [col_w - 8.0, CARD_HEIGHT], card_color, 6.0));

                // Card text
                let text_y = ky + (CARD_HEIGHT - font.cell_height) / 2.0;
                let max_chars = ((col_w - 20.0) / font.cell_width) as usize;
                let display = if card.title.chars().count() > max_chars {
                    let t: String = card.title.chars().take(max_chars.saturating_sub(2)).collect();
                    format!("{}..", t)
                } else {
                    card.title.clone()
                };
                super::render_text(font, atlas, &display, cx + CARD_PAD + 4.0, text_y, cat::TEXT, &mut glyphs);
            }
        }

        KanbanOutput { rects, glyphs }
    }
}

impl Default for KanbanState {
    fn default() -> Self {
        Self::new()
    }
}
