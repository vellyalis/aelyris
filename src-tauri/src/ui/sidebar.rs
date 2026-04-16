//! Sidebar panel — file tree, agents, workflow, toolkit.
//!
//! Renders as a vertical panel on the left side of the terminal.
//! Toggle with Ctrl+B. Currently shows file tree only.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::animation::AnimatedValue;
use super::cat;

pub const SIDEBAR_WIDTH: f32 = 260.0;
const ROW_HEIGHT: f32 = 22.0;
const INDENT_PX: f32 = 16.0;
const TEXT_PAD_LEFT: f32 = 6.0;
const HEADER_HEIGHT: f32 = 28.0;

/// A flattened entry in the file tree.
#[derive(Clone)]
pub struct TreeEntry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub depth: u16,
}

/// File tree state for one root directory.
pub struct FileTreeState {
    pub root: PathBuf,
    pub entries: Vec<TreeEntry>,
    pub expanded: HashSet<PathBuf>,
    pub scroll_offset: f32,
    pub selected: Option<usize>,
    pub max_scroll: f32,
}

impl FileTreeState {
    pub fn new(root: PathBuf) -> Self {
        let mut state = Self {
            root: root.clone(),
            entries: Vec::new(),
            expanded: HashSet::new(),
            scroll_offset: 0.0,
            selected: None,
            max_scroll: 0.0,
        };
        state.expanded.insert(root);
        state.rebuild();
        state
    }

    /// Rebuild the flattened entry list from the file system.
    pub fn rebuild(&mut self) {
        self.entries.clear();
        self.build_entries(&self.root.clone(), 0);
        self.max_scroll =
            (self.entries.len() as f32 * ROW_HEIGHT - 400.0).max(0.0);
    }

    fn build_entries(&mut self, dir: &Path, depth: u16) {
        let read = match std::fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => return,
        };

        let mut dirs = Vec::new();
        let mut files = Vec::new();

        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Skip hidden files/dirs and common noise
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let path = entry.path();
            let is_dir = path.is_dir();
            let te = TreeEntry {
                name,
                path,
                is_dir,
                depth,
            };
            if is_dir {
                dirs.push(te);
            } else {
                files.push(te);
            }
        }

        // Sort alphabetically, dirs first
        dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        for d in dirs {
            let expanded = self.expanded.contains(&d.path);
            let child_path = d.path.clone();
            self.entries.push(d);
            if expanded {
                self.build_entries(&child_path, depth + 1);
            }
        }
        for f in files {
            self.entries.push(f);
        }
    }

    /// Toggle expand/collapse for a directory entry.
    pub fn toggle(&mut self, idx: usize) {
        if idx >= self.entries.len() {
            return;
        }
        let entry = &self.entries[idx];
        if !entry.is_dir {
            return;
        }
        let path = entry.path.clone();
        if self.expanded.contains(&path) {
            self.expanded.remove(&path);
        } else {
            self.expanded.insert(path);
        }
        self.rebuild();
    }

    pub fn scroll(&mut self, delta: f32) {
        self.scroll_offset = (self.scroll_offset + delta).clamp(0.0, self.max_scroll);
    }

    /// Hit-test: which entry index was clicked at pixel y within the sidebar content area?
    pub fn entry_at_y(&self, y: f32, content_top: f32) -> Option<usize> {
        let local_y = y - content_top + self.scroll_offset;
        if local_y < 0.0 {
            return None;
        }
        let idx = (local_y / ROW_HEIGHT) as usize;
        if idx < self.entries.len() {
            Some(idx)
        } else {
            None
        }
    }
}

/// Sidebar state.
pub struct SidebarState {
    pub visible: bool,
    pub file_tree: Option<FileTreeState>,
    /// Animated width for smooth open/close transitions.
    width_anim: AnimatedValue,
}

impl SidebarState {
    pub fn new() -> Self {
        Self {
            visible: false,
            file_tree: None,
            width_anim: AnimatedValue::spring(0.0, 400.0, 35.0),
        }
    }

    pub fn toggle(&mut self) {
        self.visible = !self.visible;
        if self.visible {
            self.width_anim.set_target(SIDEBAR_WIDTH);
            if self.file_tree.is_none() {
                // Default to current working directory
                if let Ok(cwd) = std::env::current_dir() {
                    self.file_tree = Some(FileTreeState::new(cwd));
                }
            }
        } else {
            self.width_anim.set_target(0.0);
        }
    }

    /// Set the sidebar root directory (e.g. when switching worktrees).
    /// Does not change visibility — caller should manage that if needed.
    pub fn set_root(&mut self, path: PathBuf) {
        self.file_tree = Some(FileTreeState::new(path));
    }

    /// Advance the sidebar animation by one frame.
    pub fn tick(&mut self) {
        self.width_anim.tick();
    }

    /// Returns true if the sidebar is currently animating.
    pub fn is_animating(&self) -> bool {
        self.width_anim.is_animating()
    }

    /// Get the sidebar width (animated, 0 when fully hidden).
    pub fn width(&self) -> f32 {
        self.width_anim.current
    }

    /// Build sidebar visual instances.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        chrome_top: f32,
        window_h: f32,
        mouse_pos: Option<(f32, f32)>,
    ) -> SidebarOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        if !self.visible {
            return SidebarOutput { rects, glyphs };
        }

        let sidebar_h = window_h - chrome_top - super::STATUS_BAR_HEIGHT;

        // Sidebar background
        rects.push(RectInstance::new([0.0, chrome_top], [SIDEBAR_WIDTH, sidebar_h], cat::pm(20, 20, 33, 240)));

        // Divider line (right edge)
        rects.push(RectInstance::new([SIDEBAR_WIDTH - 1.0, chrome_top], [1.0, sidebar_h], cat::pm(49, 50, 68, 200)));

        // Header: "EXPLORER"
        let header_y = chrome_top + (HEADER_HEIGHT - font.cell_height) / 2.0;
        super::render_text(
            font,
            atlas,
            "EXPLORER",
            TEXT_PAD_LEFT,
            header_y,
            cat::SUBTEXT0,
            &mut glyphs,
        );

        // File tree entries
        if let Some(tree) = &self.file_tree {
            let content_top = chrome_top + HEADER_HEIGHT;
            let visible_h = sidebar_h - HEADER_HEIGHT;
            let first_visible = (tree.scroll_offset / ROW_HEIGHT).floor() as usize;
            let visible_count = (visible_h / ROW_HEIGHT).ceil() as usize + 1;

            for i in first_visible..tree.entries.len().min(first_visible + visible_count) {
                let entry = &tree.entries[i];
                let row_y =
                    content_top + (i as f32 * ROW_HEIGHT) - tree.scroll_offset;

                // Skip if out of bounds
                if row_y + ROW_HEIGHT < content_top || row_y > chrome_top + sidebar_h {
                    continue;
                }

                let indent = TEXT_PAD_LEFT + entry.depth as f32 * INDENT_PX;

                // Hover highlight
                if let Some((mx, my)) = mouse_pos {
                    if mx < SIDEBAR_WIDTH
                        && my >= row_y
                        && my < row_y + ROW_HEIGHT
                        && my >= content_top
                    {
                        rects.push(RectInstance::rounded([2.0, row_y], [SIDEBAR_WIDTH - 3.0, ROW_HEIGHT], cat::BTN_HOVER, 4.0));
                    }
                }

                // Selected highlight
                if tree.selected == Some(i) {
                    rects.push(RectInstance::rounded([2.0, row_y], [SIDEBAR_WIDTH - 3.0, ROW_HEIGHT], cat::pm(49, 50, 68, 180), 4.0));
                }

                // Icon + name
                let text_y = row_y + (ROW_HEIGHT - font.cell_height) / 2.0;

                if entry.is_dir {
                    let arrow = if tree.expanded.contains(&entry.path) {
                        "\u{25BE}" // ▾
                    } else {
                        "\u{25B8}" // ▸
                    };
                    super::render_text(font, atlas, arrow, indent, text_y, cat::OVERLAY0, &mut glyphs);
                    let icon_w = font.cell_width;
                    // Truncate name to fit sidebar
                    let max_chars =
                        ((SIDEBAR_WIDTH - indent - icon_w * 2.0) / font.cell_width) as usize;
                    let display_name = truncate_name(&entry.name, max_chars);
                    super::render_text(
                        font,
                        atlas,
                        &display_name,
                        indent + icon_w,
                        text_y,
                        cat::TEXT,
                        &mut glyphs,
                    );
                } else {
                    // File — dim color, no arrow
                    let max_chars =
                        ((SIDEBAR_WIDTH - indent - font.cell_width) / font.cell_width) as usize;
                    let display_name = truncate_name(&entry.name, max_chars);
                    super::render_text(
                        font,
                        atlas,
                        &display_name,
                        indent + font.cell_width, // align with dir names
                        text_y,
                        cat::SUBTEXT1,
                        &mut glyphs,
                    );
                }
            }
        }

        SidebarOutput { rects, glyphs }
    }
}

impl Default for SidebarState {
    fn default() -> Self {
        Self::new()
    }
}

pub struct SidebarOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

fn truncate_name(name: &str, max: usize) -> String {
    if name.chars().count() <= max {
        name.to_string()
    } else if max > 2 {
        let mut s: String = name.chars().take(max - 1).collect();
        s.push('\u{2026}'); // …
        s
    } else {
        name.chars().take(max).collect()
    }
}
