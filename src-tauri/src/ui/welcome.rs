//! Welcome screen — shown on first launch before a project is open.
//!
//! Displays logo, recent projects, and open folder option.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const MAX_RECENT: usize = 10;

/// A recent project entry.
#[derive(Clone)]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    pub branch: Option<String>,
}

/// Welcome screen output.
pub struct WelcomeOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Welcome screen state.
pub struct WelcomeState {
    pub recent_projects: Vec<RecentProject>,
    pub selected: usize,
    pub scan_done: bool,
}

impl WelcomeState {
    pub fn new() -> Self {
        Self {
            recent_projects: Vec::new(),
            selected: 0,
            scan_done: false,
        }
    }

    /// Scan common directories for git projects.
    pub fn scan_projects(&mut self) {
        if self.scan_done { return; }
        self.scan_done = true;

        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_else(|_| ".".to_string());

        let scan_dirs = [
            format!("{}/Documents", home),
            format!("{}/Projects", home),
            format!("{}/repos", home),
            format!("{}/code", home),
            home.clone(),
        ];

        let mut found = Vec::new();
        for dir in &scan_dirs {
            let path = std::path::Path::new(dir);
            if !path.is_dir() { continue; }
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    if found.len() >= MAX_RECENT { break; }
                    let p = entry.path();
                    if p.is_dir() && p.join(".git").exists() {
                        let name = p.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("?")
                            .to_string();
                        let branch = read_git_branch(&p);
                        found.push(RecentProject {
                            name,
                            path: p.to_string_lossy().to_string(),
                            branch,
                        });
                    }
                }
            }
        }
        self.recent_projects = found;
    }

    pub fn select_up(&mut self) {
        if self.selected > 0 { self.selected -= 1; }
    }

    pub fn select_down(&mut self) {
        if self.selected + 1 < self.recent_projects.len() {
            self.selected += 1;
        }
    }

    /// Get the selected project path.
    pub fn selected_path(&self) -> Option<&str> {
        self.recent_projects.get(self.selected).map(|p| p.path.as_str())
    }

    /// Build the welcome screen rendering.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> WelcomeOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background
        rects.push(RectInstance::new([x, y], [w, h], cat::pm(17, 17, 27, 240)));

        let center_x = x + w / 2.0;
        let mut cy = y + h * 0.15;

        // Title
        let title = "Aether Terminal";
        let title_w = title.len() as f32 * font.cell_width;
        super::render_text(font, atlas, title, center_x - title_w / 2.0, cy, cat::text(), &mut glyphs);
        cy += font.cell_height * 2.0;

        // Subtitle
        let subtitle = "Native GPU-Rendered Terminal";
        let sub_w = subtitle.len() as f32 * font.cell_width;
        super::render_text(font, atlas, subtitle, center_x - sub_w / 2.0, cy, cat::overlay0(), &mut glyphs);
        cy += font.cell_height * 3.0;

        // Recent projects header
        if !self.recent_projects.is_empty() {
            let header = "Recent Projects";
            let header_w = header.len() as f32 * font.cell_width;
            super::render_text(font, atlas, header, center_x - header_w / 2.0, cy, cat::subtext0(), &mut glyphs);
            cy += font.cell_height * 1.5;

            let list_w = 400.0f32.min(w * 0.7);
            let list_x = center_x - list_w / 2.0;

            for (i, project) in self.recent_projects.iter().enumerate() {
                let row_h = 36.0;
                let row_y = cy;
                if row_y + row_h > y + h - 40.0 { break; }

                let is_selected = i == self.selected;
                if is_selected {
                    rects.push(RectInstance::rounded(
                        [list_x, row_y],
                        [list_w, row_h],
                        cat::ACTIVE,
                        6.0,
                    ));
                }

                // Folder icon
                let icon = '\u{f07b}';
                let icon_str = icon.to_string();
                super::render_text(font, atlas, &icon_str, list_x + 8.0, row_y + 4.0, cat::blue(), &mut glyphs);

                // Project name
                super::render_text(font, atlas, &project.name, list_x + 8.0 + font.cell_width * 2.0, row_y + 4.0, cat::text(), &mut glyphs);

                // Branch (if available)
                if let Some(branch) = &project.branch {
                    let branch_display = format!(" {}", branch);
                    let name_end = list_x + 8.0 + font.cell_width * 2.0 + project.name.len() as f32 * font.cell_width;
                    super::render_text(font, atlas, &branch_display, name_end + font.cell_width, row_y + 4.0, cat::green(), &mut glyphs);
                }

                // Path (second line, dimmed)
                let max_path = (list_w / font.cell_width) as usize - 4;
                let path_display = if project.path.len() > max_path {
                    format!("...{}", &project.path[project.path.len().saturating_sub(max_path - 3)..])
                } else {
                    project.path.clone()
                };
                super::render_text(font, atlas, &path_display, list_x + 8.0 + font.cell_width * 2.0, row_y + 4.0 + font.cell_height + 2.0, cat::overlay0(), &mut glyphs);

                cy += row_h + 4.0;
            }
        }

        // Hint at bottom
        cy = y + h - 40.0;
        let hint = "Enter to open  |  Ctrl+Shift+P for commands";
        let hint_w = hint.len() as f32 * font.cell_width;
        super::render_text(font, atlas, hint, center_x - hint_w / 2.0, cy, cat::overlay0(), &mut glyphs);

        WelcomeOutput { rects, glyphs }
    }
}

/// Read the current git branch from HEAD.
fn read_git_branch(repo_path: &std::path::Path) -> Option<String> {
    let head_path = repo_path.join(".git/HEAD");
    let content = std::fs::read_to_string(head_path).ok()?;
    if let Some(branch) = content.strip_prefix("ref: refs/heads/") {
        Some(branch.trim().to_string())
    } else {
        Some(content[..7.min(content.len())].to_string()) // detached HEAD
    }
}
