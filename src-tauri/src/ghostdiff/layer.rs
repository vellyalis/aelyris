//! Layer types for the Ghost Diff Overlay (Phase 3C-1a).
//!
//! A `Layer` represents a set of file deltas that should be visualized as
//! ghost overlays in the editor. Each layer has a source (currently only
//! a worktree, but the variant keeps room for 3C-2/3C-3 reuse) and a
//! presentation tint (role color for orchestra agents, peach for auto-repair).
//!
//! Pure data + small helpers only — all I/O lives in `diff_engine` /
//! `registry` / `watcher` to keep this module trivially testable.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Stable identifier for a layer (mirrors the originating session/job id).
pub type LayerId = String;

/// Where this layer's content comes from.
///
/// The enum intentionally uses `#[serde(tag = ...)]` so 3C-2 (parallel
/// branches) and 3C-3 (time-travel snapshots) can add variants without
/// breaking the wire format.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayerSource {
    /// A live git worktree managed by auto-repair or an orchestra agent.
    #[serde(rename_all = "camelCase")]
    Worktree {
        path: PathBuf,
        branch: String,
        /// Main repository path — diffs are computed against this repo's HEAD.
        repo_path: PathBuf,
    },
    /// A user-triggered "show me what another branch looks like" overlay
    /// (Phase 3C-2). Read-only — applying hunks from this layer is rejected
    /// since the source isn't owned by the user's own session.
    #[serde(rename_all = "camelCase")]
    BranchComparison {
        /// Main repository path — `git diff base..head -- <path>` runs here.
        repo_path: PathBuf,
        /// The branch the user is currently on (the "before" in the diff).
        base_branch: String,
        /// The branch being peeked at (the "after" in the diff).
        head_branch: String,
    },
}

/// What the layer is showing. Currently a diff against a base revision,
/// but `LayerContent` is phrased as an enum so future layer types (e.g.
/// terminal state snapshots) can slot in without widening `Layer`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayerContent {
    #[serde(rename_all = "camelCase")]
    Diff {
        /// e.g. "HEAD" or a concrete SHA. Informational only for now.
        base_revision: String,
        files: Vec<FileDelta>,
    },
}

/// Per-file delta: which hunks changed and the full before/after text so the
/// frontend can render inline ghost lines without re-fetching the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDelta {
    /// Repo-relative path, forward-slash separated.
    pub path: String,
    pub hunks: Vec<DiffHunk>,
    pub base_content: String,
    pub head_content: String,
}

/// One contiguous hunk from a unified diff.
///
/// Line numbers are 1-based (matching git/unified-diff convention).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub base_start: u32,
    pub base_len: u32,
    pub head_start: u32,
    pub head_len: u32,
    pub lines: Vec<HunkLine>,
}

/// One line inside a hunk: kept / added / removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "text", rename_all = "camelCase")]
pub enum HunkLine {
    Context(String),
    Add(String),
    Remove(String),
}

/// Purely presentational metadata — which tint to paint the ghost with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerTint {
    /// Hex color (e.g. "#fab387" for peach) — orchestra role color or
    /// auto-repair default. Frontend decides opacity / usage.
    pub role_color: String,
    /// Short human label shown in badges (e.g. "repair", "impl", "test").
    pub role_label: String,
}

impl LayerTint {
    pub fn auto_repair() -> Self {
        Self {
            role_color: "#fab387".into(), // Catppuccin peach
            role_label: "repair".into(),
        }
    }

    /// Default tint for an orchestra interactive agent before role-color
    /// wiring (3C-1b+) lands. Mauve reads well against the panel background.
    pub fn orchestra_default() -> Self {
        Self {
            role_color: "#cba6f7".into(), // Catppuccin mauve
            role_label: "agent".into(),
        }
    }

    /// Phase 3C-2: read-only overlay comparing another branch. Sky blue to
    /// visually separate it from the write-capable agent-owned layers.
    pub fn branch_comparison() -> Self {
        Self {
            role_color: "#89dceb".into(), // Catppuccin sky
            role_label: "branch".into(),
        }
    }
}

/// A ghost layer visible to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: LayerId,
    pub source: LayerSource,
    pub content: LayerContent,
    pub tint: LayerTint,
    /// `true` once the originating agent run has finished. The frontend
    /// hides live-updating spinners when complete.
    pub is_complete: bool,
    /// Unix seconds when the layer was first registered. Used for stable
    /// ordering in the UI (oldest-first, newest last).
    pub created_at: u64,
}

/// Compact summary used by list endpoints and the status bar badge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerSummary {
    pub id: LayerId,
    pub source: LayerSource,
    pub tint: LayerTint,
    pub is_complete: bool,
    pub created_at: u64,
    pub file_count: usize,
    pub hunk_count: usize,
    /// Repo-relative paths touched by this layer — small enough to send on
    /// every update, saves a round-trip for the panel.
    pub file_paths: Vec<String>,
}

impl Layer {
    /// Build a fresh layer with an empty diff. Used right after registration,
    /// before the first `refresh()` populates `content`.
    pub fn new_worktree(
        id: LayerId,
        worktree_path: PathBuf,
        branch: String,
        repo_path: PathBuf,
        tint: LayerTint,
        created_at: u64,
    ) -> Self {
        Self {
            id,
            source: LayerSource::Worktree {
                path: worktree_path,
                branch,
                repo_path,
            },
            content: LayerContent::Diff {
                base_revision: "HEAD".into(),
                files: Vec::new(),
            },
            tint,
            is_complete: false,
            created_at,
        }
    }

    /// Build a read-only "peek at another branch" layer (Phase 3C-2).
    /// `base_revision` is prefilled with `branch:<head_branch>` so the
    /// summary reads clearly in the panel.
    pub fn new_branch_comparison(
        id: LayerId,
        repo_path: PathBuf,
        base_branch: String,
        head_branch: String,
        tint: LayerTint,
        created_at: u64,
    ) -> Self {
        let base_revision = format!("branch:{head_branch}");
        Self {
            id,
            source: LayerSource::BranchComparison {
                repo_path,
                base_branch,
                head_branch,
            },
            content: LayerContent::Diff {
                base_revision,
                files: Vec::new(),
            },
            tint,
            // Branch comparisons are always "complete" — there's no running
            // agent that will later flip this flag. Rendering with
            // `is_complete = true` means `liveMode` gating from 3C-1d
            // doesn't accidentally hide user-triggered comparisons.
            is_complete: true,
            created_at,
        }
    }

    /// `true` when apply operations against this layer must be rejected —
    /// the user does not own the source revision (e.g. branch comparisons).
    pub fn is_read_only(&self) -> bool {
        match &self.source {
            LayerSource::Worktree { .. } => false,
            LayerSource::BranchComparison { .. } => true,
        }
    }

    pub fn summary(&self) -> LayerSummary {
        let (file_count, hunk_count, file_paths) = match &self.content {
            LayerContent::Diff { files, .. } => {
                let hunks = files.iter().map(|f| f.hunks.len()).sum();
                let paths = files.iter().map(|f| f.path.clone()).collect();
                (files.len(), hunks, paths)
            }
        };
        LayerSummary {
            id: self.id.clone(),
            source: self.source.clone(),
            tint: self.tint.clone(),
            is_complete: self.is_complete,
            created_at: self.created_at,
            file_count,
            hunk_count,
            file_paths,
        }
    }

    /// Convenience accessor for the worktree path (returns `None` for
    /// non-worktree sources — `BranchComparison` has no worktree).
    pub fn worktree_path(&self) -> Option<&PathBuf> {
        match &self.source {
            LayerSource::Worktree { path, .. } => Some(path),
            LayerSource::BranchComparison { .. } => None,
        }
    }

    pub fn repo_path(&self) -> Option<&PathBuf> {
        match &self.source {
            LayerSource::Worktree { repo_path, .. } => Some(repo_path),
            LayerSource::BranchComparison { repo_path, .. } => Some(repo_path),
        }
    }

    /// Locate a single file delta by repo-relative path.
    pub fn find_file(&self, path: &str) -> Option<&FileDelta> {
        match &self.content {
            LayerContent::Diff { files, .. } => files.iter().find(|f| f.path == path),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_hunk() -> DiffHunk {
        DiffHunk {
            base_start: 10,
            base_len: 2,
            head_start: 10,
            head_len: 3,
            lines: vec![
                HunkLine::Context("unchanged".into()),
                HunkLine::Remove("old".into()),
                HunkLine::Add("new-a".into()),
                HunkLine::Add("new-b".into()),
            ],
        }
    }

    fn sample_file(path: &str) -> FileDelta {
        FileDelta {
            path: path.into(),
            hunks: vec![sample_hunk(), sample_hunk()],
            base_content: "base".into(),
            head_content: "head".into(),
        }
    }

    #[test]
    fn layer_summary_counts_files_and_hunks() {
        let mut layer = Layer::new_worktree(
            "job-1".into(),
            "/tmp/wt".into(),
            "fix/auto-0".into(),
            "/tmp/repo".into(),
            LayerTint::auto_repair(),
            0,
        );
        layer.content = LayerContent::Diff {
            base_revision: "HEAD".into(),
            files: vec![sample_file("src/a.ts"), sample_file("src/b.ts")],
        };
        let s = layer.summary();
        assert_eq!(s.file_count, 2);
        assert_eq!(s.hunk_count, 4);
        assert_eq!(s.file_paths, vec!["src/a.ts", "src/b.ts"]);
        assert!(!s.is_complete);
    }

    #[test]
    fn layer_summary_empty_is_zero() {
        let layer = Layer::new_worktree(
            "job-1".into(),
            "/tmp/wt".into(),
            "b".into(),
            "/tmp/repo".into(),
            LayerTint::auto_repair(),
            0,
        );
        let s = layer.summary();
        assert_eq!(s.file_count, 0);
        assert_eq!(s.hunk_count, 0);
        assert!(s.file_paths.is_empty());
    }

    #[test]
    fn find_file_matches_path() {
        let mut layer = Layer::new_worktree(
            "j".into(),
            "/w".into(),
            "b".into(),
            "/r".into(),
            LayerTint::auto_repair(),
            0,
        );
        layer.content = LayerContent::Diff {
            base_revision: "HEAD".into(),
            files: vec![sample_file("src/a.ts")],
        };
        assert!(layer.find_file("src/a.ts").is_some());
        assert!(layer.find_file("src/missing.ts").is_none());
    }

    #[test]
    fn worktree_path_and_repo_path_accessors() {
        let layer = Layer::new_worktree(
            "j".into(),
            "/worktree".into(),
            "b".into(),
            "/repo".into(),
            LayerTint::auto_repair(),
            0,
        );
        assert_eq!(
            layer.worktree_path().map(|p| p.to_string_lossy().to_string()),
            Some("/worktree".to_string())
        );
        assert_eq!(
            layer.repo_path().map(|p| p.to_string_lossy().to_string()),
            Some("/repo".to_string())
        );
    }

    #[test]
    fn tint_auto_repair_defaults() {
        let t = LayerTint::auto_repair();
        assert_eq!(t.role_color, "#fab387");
        assert_eq!(t.role_label, "repair");
    }

    #[test]
    fn layer_serde_round_trip() {
        let mut layer = Layer::new_worktree(
            "j".into(),
            "/w".into(),
            "b".into(),
            "/r".into(),
            LayerTint::auto_repair(),
            123,
        );
        layer.content = LayerContent::Diff {
            base_revision: "HEAD".into(),
            files: vec![sample_file("a.ts")],
        };
        let json = serde_json::to_string(&layer).expect("serialize");
        let back: Layer = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, layer);
    }

    #[test]
    fn summary_serde_round_trip() {
        let mut layer = Layer::new_worktree(
            "j".into(),
            "/w".into(),
            "b".into(),
            "/r".into(),
            LayerTint::auto_repair(),
            0,
        );
        layer.content = LayerContent::Diff {
            base_revision: "HEAD".into(),
            files: vec![sample_file("a.ts")],
        };
        let summary = layer.summary();
        let json = serde_json::to_string(&summary).expect("serialize");
        let back: LayerSummary = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, summary);
    }

    #[test]
    fn new_branch_comparison_marks_complete_and_read_only() {
        let layer = Layer::new_branch_comparison(
            "branch-xyz".into(),
            "/tmp/repo".into(),
            "main".into(),
            "feature/foo".into(),
            LayerTint::branch_comparison(),
            42,
        );
        // Branch overlays always start complete (no running agent) so the
        // 3C-1d `liveMode = false` default does not hide them.
        assert!(layer.is_complete);
        assert!(layer.is_read_only());
        assert!(layer.worktree_path().is_none());
        assert_eq!(
            layer.repo_path().map(|p| p.to_string_lossy().to_string()),
            Some("/tmp/repo".to_string())
        );
        match &layer.content {
            LayerContent::Diff { base_revision, .. } => {
                // base_revision carries the head branch so the panel can
                // render it without reaching into LayerSource.
                assert_eq!(base_revision, "branch:feature/foo");
            }
        }
    }

    #[test]
    fn new_worktree_is_not_read_only() {
        let layer = Layer::new_worktree(
            "job".into(),
            "/w".into(),
            "b".into(),
            "/r".into(),
            LayerTint::auto_repair(),
            0,
        );
        assert!(!layer.is_read_only());
    }

    #[test]
    fn tint_branch_comparison_is_sky_blue() {
        let t = LayerTint::branch_comparison();
        assert_eq!(t.role_color, "#89dceb");
        assert_eq!(t.role_label, "branch");
    }

    #[test]
    fn hunk_line_serde_variants() {
        let lines = vec![
            HunkLine::Context("c".into()),
            HunkLine::Add("a".into()),
            HunkLine::Remove("r".into()),
        ];
        let json = serde_json::to_string(&lines).unwrap();
        let back: Vec<HunkLine> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, lines);
    }
}
