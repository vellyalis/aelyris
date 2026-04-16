//! Helm panel — simple todo list for task tracking.
//!
//! Persisted to ~/.aether/helm.json.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

/// A single task.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct HelmTask {
    pub text: String,
    pub done: bool,
}

/// Helm state.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct HelmState {
    pub tasks: Vec<HelmTask>,
    #[serde(skip)]
    pub selected: Option<usize>,
}

pub struct HelmOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

impl HelmState {
    pub fn new() -> Self {
        Self { tasks: Vec::new(), selected: None }
    }

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
        std::path::PathBuf::from(home).join(".aether").join("helm.json")
    }

    pub fn add_task(&mut self, text: String) {
        self.tasks.push(HelmTask { text, done: false });
        self.save();
    }

    pub fn toggle_selected(&mut self) {
        if let Some(idx) = self.selected {
            if idx < self.tasks.len() {
                self.tasks[idx].done = !self.tasks[idx].done;
                self.save();
            }
        }
    }

    pub fn delete_selected(&mut self) {
        if let Some(idx) = self.selected {
            if idx < self.tasks.len() {
                self.tasks.remove(idx);
                self.selected = None;
                self.save();
            }
        }
    }

    pub fn select_up(&mut self) {
        if let Some(idx) = self.selected {
            if idx > 0 { self.selected = Some(idx - 1); }
        } else if !self.tasks.is_empty() {
            self.selected = Some(0);
        }
    }

    pub fn select_down(&mut self) {
        if let Some(idx) = self.selected {
            if idx + 1 < self.tasks.len() { self.selected = Some(idx + 1); }
        } else if !self.tasks.is_empty() {
            self.selected = Some(0);
        }
    }

    pub fn done_count(&self) -> usize {
        self.tasks.iter().filter(|t| t.done).count()
    }

    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> HelmOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background
        rects.push(RectInstance::new([x, y], [w, h], cat::pm(24, 24, 37, 240)));

        // Header
        let header = format!("Tasks — {}/{} done", self.done_count(), self.tasks.len());
        let header_y = y + (28.0 - font.cell_height) / 2.0;
        super::render_text(font, atlas, &header, x + 12.0, header_y, cat::subtext0(), &mut glyphs);

        // Tasks
        let task_top = y + 32.0;
        let task_h = 26.0;
        for (i, task) in self.tasks.iter().enumerate() {
            let ty = task_top + i as f32 * task_h;
            if ty + task_h > y + h { break; }

            let is_selected = self.selected == Some(i);
            if is_selected {
                rects.push(RectInstance::rounded(
                    [x + 4.0, ty], [w - 8.0, task_h],
                    cat::pm(69, 71, 90, 150), 4.0,
                ));
            }

            let text_y = ty + (task_h - font.cell_height) / 2.0;
            let checkbox = if task.done { "\u{f058} " } else { "\u{f111} " }; // ✓ or ○
            let check_color = if task.done { cat::green() } else { cat::overlay0() };
            super::render_text(font, atlas, checkbox, x + 12.0, text_y, check_color, &mut glyphs);

            let text_color = if task.done { cat::overlay0() } else { cat::text() };
            let max_chars = ((w - 48.0) / font.cell_width) as usize;
            let display = if task.text.len() > max_chars {
                format!("{}...", &task.text[..max_chars.saturating_sub(3)])
            } else {
                task.text.clone()
            };
            super::render_text(font, atlas, &display, x + 12.0 + font.cell_width * 2.5, text_y, text_color, &mut glyphs);
        }

        HelmOutput { rects, glyphs }
    }
}

impl Default for HelmState {
    fn default() -> Self {
        Self::new()
    }
}
