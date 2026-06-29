//! Stateful native render pipeline contract.
//!
//! `render_frame` proves the Rust side can produce a renderer-neutral grid.
//! This pipeline adds the renderer-neutral commit contract: every commit is
//! compared with the previous native frame so the current React canvas
//! presentation and a future winit/wgpu present loop can consume the same full,
//! partial, or unchanged repaint decisions without treating WebView state as
//! terminal truth.

use serde::{Deserialize, Serialize};

use super::render_frame::{
    NativeCellMetrics, NativeRenderFrame, NativeRenderFrameDiff, NativeRenderFrameSummary,
};
use super::snapshot::GridSnapshot;

const RENDER_COMMIT_SCHEMA: &str = "aelyris.native.render-commit.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderCommit {
    pub schema: String,
    pub sequence: u64,
    pub repaint_mode: String,
    pub dirty_cell_basis_points: u16,
    pub frame: NativeRenderFrameSummary,
    pub diff: NativeRenderFrameDiff,
    pub renderer_boundary: String,
    pub webview_used: bool,
    pub react_used: bool,
    pub next_renderer: String,
}

#[derive(Debug, Clone)]
pub struct NativeRenderPipeline {
    metrics: NativeCellMetrics,
    sequence: u64,
    previous_frame: Option<NativeRenderFrame>,
}

impl NativeRenderPipeline {
    pub fn new(metrics: NativeCellMetrics) -> Self {
        Self {
            metrics,
            sequence: 0,
            previous_frame: None,
        }
    }

    pub fn commit_snapshot(&mut self, snapshot: &GridSnapshot) -> NativeRenderCommit {
        let frame = NativeRenderFrame::from_snapshot(snapshot, self.metrics);
        let diff = frame.diff_against(self.previous_frame.as_ref());
        let summary = frame.summary();
        self.sequence = self.sequence.saturating_add(1);
        let commit = NativeRenderCommit {
            schema: RENDER_COMMIT_SCHEMA.to_string(),
            sequence: self.sequence,
            repaint_mode: repaint_mode(&diff).to_string(),
            dirty_cell_basis_points: dirty_cell_basis_points(diff.dirty_cells, summary.cell_count),
            frame: summary,
            diff,
            renderer_boundary: "rust-native-render-pipeline".to_string(),
            webview_used: false,
            react_used: false,
            next_renderer: "winit-wgpu-present-loop".to_string(),
        };
        self.previous_frame = Some(frame);
        commit
    }

    pub fn reset(&mut self) {
        self.previous_frame = None;
        self.sequence = 0;
    }
}

fn repaint_mode(diff: &NativeRenderFrameDiff) -> &'static str {
    if diff.full_repaint {
        "full"
    } else if diff.dirty_cells == 0 {
        "unchanged"
    } else {
        "partial"
    }
}

fn dirty_cell_basis_points(dirty_cells: usize, cell_count: usize) -> u16 {
    if cell_count == 0 {
        return 0;
    }
    let basis_points = dirty_cells.saturating_mul(10_000) / cell_count;
    basis_points.min(10_000) as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::TermEngine;

    fn metrics() -> NativeCellMetrics {
        NativeCellMetrics::new(9, 18).expect("metrics")
    }

    #[test]
    fn first_commit_is_full_repaint_without_webview() {
        let engine = TermEngine::new(4, 2).expect("engine");
        let mut pipeline = NativeRenderPipeline::new(metrics());
        let commit = pipeline.commit_snapshot(&engine.snapshot());

        assert_eq!(commit.schema, "aelyris.native.render-commit.v1");
        assert_eq!(commit.sequence, 1);
        assert_eq!(commit.repaint_mode, "full");
        assert!(commit.diff.full_repaint);
        assert_eq!(commit.diff.dirty_cells, commit.frame.cell_count);
        assert_eq!(commit.dirty_cell_basis_points, 10_000);
        assert!(!commit.webview_used);
        assert!(!commit.react_used);
        assert_eq!(commit.renderer_boundary, "rust-native-render-pipeline");
        assert_eq!(commit.diff.current_frame_sha256, commit.frame.frame_sha256);
    }

    #[test]
    fn unchanged_commit_emits_zero_dirty_cells() {
        let engine = TermEngine::new(4, 2).expect("engine");
        let mut pipeline = NativeRenderPipeline::new(metrics());
        let first = pipeline.commit_snapshot(&engine.snapshot());
        let second = pipeline.commit_snapshot(&engine.snapshot());

        assert_eq!(second.sequence, 2);
        assert_eq!(second.repaint_mode, "unchanged");
        assert!(!second.diff.full_repaint);
        assert_eq!(second.diff.dirty_cells, 0);
        assert!(second.diff.dirty_rects.is_empty());
        assert_eq!(second.dirty_cell_basis_points, 0);
        assert_eq!(
            second.diff.previous_frame_sha256.as_deref(),
            Some(first.frame.frame_sha256.as_str())
        );
    }

    #[test]
    fn text_update_commit_is_partial_with_dirty_rects() {
        let mut engine = TermEngine::new(8, 3).expect("engine");
        let mut pipeline = NativeRenderPipeline::new(metrics());
        let first = pipeline.commit_snapshot(&engine.snapshot());
        engine.advance_str("abc");
        let second = pipeline.commit_snapshot(&engine.snapshot());

        assert_eq!(first.repaint_mode, "full");
        assert_eq!(second.repaint_mode, "partial");
        assert!(!second.diff.full_repaint);
        assert!(second.diff.dirty_cells > 0);
        assert!(!second.diff.dirty_rects.is_empty());
        assert!(second.dirty_cell_basis_points > 0);
        assert_eq!(second.diff.current_frame_sha256, second.frame.frame_sha256);
    }

    #[test]
    fn reset_forces_next_commit_to_full_repaint() {
        let mut engine = TermEngine::new(4, 2).expect("engine");
        let mut pipeline = NativeRenderPipeline::new(metrics());
        pipeline.commit_snapshot(&engine.snapshot());
        engine.advance_str("x");
        let partial = pipeline.commit_snapshot(&engine.snapshot());
        pipeline.reset();
        let full = pipeline.commit_snapshot(&engine.snapshot());

        assert_eq!(partial.repaint_mode, "partial");
        assert_eq!(full.sequence, 1);
        assert_eq!(full.repaint_mode, "full");
        assert!(full.diff.full_repaint);
        assert_eq!(full.diff.previous_frame_sha256, None);
    }
}
