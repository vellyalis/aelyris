//! SCM (Source Control Management) panel — Git staging, commit, push.
//!
//! Rendered as a section in the sidebar or as a standalone overlay.
//! Uses git2 via the existing git module for all operations.

use crate::git::{self, ChangedFile, GitStatusInfo};
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const ROW_HEIGHT: f32 = 22.0;
const HEADER_HEIGHT: f32 = 28.0;
const COMMIT_INPUT_HEIGHT: f32 = 28.0;

/// SCM panel state.
pub struct ScmState {
    pub repo_path: Option<String>,
    pub status: Option<GitStatusInfo>,
    pub commit_message: String,
    pub scroll_offset: f32,
    pub selected: Option<usize>,
    pub expanded_staged: bool,
    pub expanded_unstaged: bool,
}

/// Actions produced by the SCM panel.
#[derive(Debug)]
pub enum ScmAction {
    StageFile(String),
    UnstageFile(String),
    StageAll,
    Commit(String),
    Push,
    DiscardFile(String),
    None,
}

impl ScmState {
    pub fn new() -> Self {
        Self {
            repo_path: None,
            status: None,
            commit_message: String::new(),
            scroll_offset: 0.0,
            selected: None,
            expanded_staged: true,
            expanded_unstaged: true,
        }
    }

    /// Refresh git status from the repo.
    pub fn refresh(&mut self) {
        if let Some(path) = &self.repo_path {
            match git::git_status(path) {
                Ok(status) => self.status = Some(status),
                Err(e) => {
                    log::trace!("SCM refresh: {}", e);
                    self.status = None;
                }
            }
        }
    }

    /// Set the repo path and refresh.
    pub fn set_repo(&mut self, path: String) {
        self.repo_path = Some(path);
        self.refresh();
    }

    /// Execute a git operation.
    pub fn execute(&self, action: &ScmAction) {
        let repo = match &self.repo_path {
            Some(p) => p,
            None => return,
        };
        match action {
            ScmAction::StageFile(path) => {
                let _ = run_git(repo, &["add", "--", path]);
            }
            ScmAction::UnstageFile(path) => {
                let _ = run_git(repo, &["reset", "HEAD", "--", path]);
            }
            ScmAction::StageAll => {
                let _ = run_git(repo, &["add", "-A"]);
            }
            ScmAction::Commit(msg) => {
                let _ = run_git(repo, &["commit", "-m", msg]);
            }
            ScmAction::Push => {
                let _ = run_git(repo, &["push"]);
            }
            ScmAction::DiscardFile(path) => {
                let _ = run_git(repo, &["checkout", "--", path]);
            }
            ScmAction::None => {}
        }
    }

    /// Build the SCM panel UI.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        max_h: f32,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        let status = match &self.status {
            Some(s) => s,
            None => return (rects, glyphs),
        };

        let mut cy = y;

        // Header: branch name
        rects.push(RectInstance {
            pos: [x, cy],
            size: [w, HEADER_HEIGHT],
            color: cat::pm(24, 24, 37, 200),
        });
        let header_text = format!("SCM: {}", status.branch);
        let text_y = cy + (HEADER_HEIGHT - font.cell_height) / 2.0;
        super::render_text(font, atlas, &header_text, x + 8.0, text_y, cat::TEXT, &mut glyphs);
        cy += HEADER_HEIGHT;

        // Staged files
        let staged: Vec<&ChangedFile> = status.changed_files.iter().filter(|f| f.staged).collect();
        if !staged.is_empty() {
            let label = format!("Staged ({})", staged.len());
            let label_y = cy + (ROW_HEIGHT - font.cell_height) / 2.0;
            super::render_text(font, atlas, &label, x + 8.0, label_y, cat::pm(166, 227, 161, 255), &mut glyphs);
            cy += ROW_HEIGHT;

            for file in &staged {
                if cy - y > max_h { break; }
                let fy = cy + (ROW_HEIGHT - font.cell_height) / 2.0;
                let icon = status_icon(&file.status);
                let display = format!("{} {}", icon, file.path);
                super::render_text(font, atlas, &display, x + 16.0, fy, cat::TEXT, &mut glyphs);
                cy += ROW_HEIGHT;
            }
        }

        // Unstaged/untracked files
        let unstaged: Vec<&ChangedFile> = status.changed_files.iter().filter(|f| !f.staged).collect();
        if !unstaged.is_empty() {
            let label = format!("Changes ({})", unstaged.len());
            let label_y = cy + (ROW_HEIGHT - font.cell_height) / 2.0;
            super::render_text(font, atlas, &label, x + 8.0, label_y, cat::pm(250, 179, 135, 255), &mut glyphs);
            cy += ROW_HEIGHT;

            for file in &unstaged {
                if cy - y > max_h { break; }
                let fy = cy + (ROW_HEIGHT - font.cell_height) / 2.0;
                let icon = status_icon(&file.status);
                let display = format!("{} {}", icon, file.path);
                super::render_text(font, atlas, &display, x + 16.0, fy, cat::TEXT, &mut glyphs);
                cy += ROW_HEIGHT;
            }
        }

        // Commit input area
        if cy - y + COMMIT_INPUT_HEIGHT < max_h {
            rects.push(RectInstance {
                pos: [x + 4.0, cy + 4.0],
                size: [w - 8.0, COMMIT_INPUT_HEIGHT],
                color: cat::pm(24, 24, 37, 220),
            });
            let input_y = cy + 4.0 + (COMMIT_INPUT_HEIGHT - font.cell_height) / 2.0;
            let display = if self.commit_message.is_empty() {
                "Commit message..."
            } else {
                &self.commit_message
            };
            let color = if self.commit_message.is_empty() { cat::OVERLAY0 } else { cat::TEXT };
            super::render_text(font, atlas, display, x + 10.0, input_y, color, &mut glyphs);
        }

        (rects, glyphs)
    }
}

fn status_icon(status: &str) -> &'static str {
    match status {
        "added" | "untracked" => "+",
        "modified" => "~",
        "deleted" => "-",
        "renamed" => "R",
        "conflicted" => "!",
        _ => "?",
    }
}

fn run_git(repo_path: &str, args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

impl Default for ScmState {
    fn default() -> Self {
        Self::new()
    }
}
