//! Native terminal render-frame contract.
//!
//! This module is intentionally renderer-neutral. It converts the Rust-owned
//! terminal grid snapshot into positioned cells and stable metrics that a
//! native renderer can consume without depending on React, WebView, Canvas, or
//! xterm semantics. The current `aelyris-native` proof renders this frame with
//! Win32/GDI; the next renderer can consume the same frame through winit/wgpu.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::snapshot::{CellSnapshot, CursorSnapshot, GridSnapshot, ImageRef};

const RENDER_FRAME_SCHEMA: &str = "aelyris.native.render-frame.v1";
const RENDER_DIFF_SCHEMA: &str = "aelyris.native.render-diff.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCellMetrics {
    pub width_px: u16,
    pub height_px: u16,
}

impl NativeCellMetrics {
    pub fn new(width_px: u16, height_px: u16) -> Result<Self, NativeRenderFrameError> {
        if width_px == 0 || height_px == 0 {
            return Err(NativeRenderFrameError::InvalidCellMetrics {
                width_px,
                height_px,
            });
        }
        Ok(Self {
            width_px,
            height_px,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCellRect {
    pub x_px: u32,
    pub y_px: u32,
    pub width_px: u16,
    pub height_px: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderCell {
    pub row: u16,
    pub col: u16,
    pub ch: char,
    pub fg: u32,
    pub bg: u32,
    pub attrs: u16,
    pub rect: NativeCellRect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hyperlink: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderFrame {
    pub schema: String,
    pub cols: u16,
    pub rows: u16,
    pub cell_width_px: u16,
    pub cell_height_px: u16,
    pub width_px: u32,
    pub height_px: u32,
    pub cells: Vec<NativeRenderCell>,
    pub cursor: CursorSnapshot,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderFrameSummary {
    pub schema: String,
    pub cols: u16,
    pub rows: u16,
    pub cell_width_px: u16,
    pub cell_height_px: u16,
    pub width_px: u32,
    pub height_px: u32,
    pub cell_count: usize,
    pub non_blank_cells: usize,
    pub paintable_cells: usize,
    pub occupied_rows: usize,
    pub styled_cells: usize,
    pub hyperlink_cells: usize,
    pub image_count: usize,
    pub cursor: CursorSnapshot,
    pub line_preview: Vec<String>,
    pub frame_sha256: String,
    pub renderer_boundary: String,
    pub webview_used: bool,
    pub react_used: bool,
    pub next_renderer: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRenderFrameDiff {
    pub schema: String,
    pub previous_frame_sha256: Option<String>,
    pub current_frame_sha256: String,
    pub cols: u16,
    pub rows: u16,
    pub cell_width_px: u16,
    pub cell_height_px: u16,
    pub dirty_cells: usize,
    pub dirty_rows: usize,
    pub dirty_rects: Vec<NativeCellRect>,
    pub cursor_dirty: bool,
    pub image_dirty: bool,
    pub full_repaint: bool,
    pub renderer_boundary: String,
    pub webview_used: bool,
    pub react_used: bool,
    pub next_renderer: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum NativeRenderFrameError {
    #[error("native render cell metrics must be non-zero, got {width_px}x{height_px}")]
    InvalidCellMetrics { width_px: u16, height_px: u16 },
}

impl NativeRenderFrame {
    pub fn from_snapshot(snapshot: &GridSnapshot, metrics: NativeCellMetrics) -> NativeRenderFrame {
        let width_px = u32::from(snapshot.cols) * u32::from(metrics.width_px);
        let height_px = u32::from(snapshot.rows) * u32::from(metrics.height_px);
        let mut cells = Vec::with_capacity(usize::from(snapshot.cols) * usize::from(snapshot.rows));

        for (row_idx, row) in snapshot.cells.iter().enumerate() {
            for (col_idx, cell) in row.iter().enumerate() {
                cells.push(NativeRenderCell::from_snapshot_cell(
                    row_idx as u16,
                    col_idx as u16,
                    cell,
                    metrics,
                ));
            }
        }

        NativeRenderFrame {
            schema: RENDER_FRAME_SCHEMA.to_string(),
            cols: snapshot.cols,
            rows: snapshot.rows,
            cell_width_px: metrics.width_px,
            cell_height_px: metrics.height_px,
            width_px,
            height_px,
            cells,
            cursor: snapshot.cursor,
            images: snapshot.images.clone(),
        }
    }

    pub fn summary(&self) -> NativeRenderFrameSummary {
        let non_blank_cells = self.cells.iter().filter(|cell| cell.is_non_blank()).count();
        let paintable_cells = self.cells.iter().filter(|cell| cell.is_paintable()).count();
        let styled_cells = self.cells.iter().filter(|cell| cell.attrs != 0).count();
        let hyperlink_cells = self
            .cells
            .iter()
            .filter(|cell| cell.hyperlink.is_some())
            .count();
        let occupied_rows = (0..self.rows)
            .filter(|row| {
                self.cells
                    .iter()
                    .any(|cell| cell.row == *row && cell.is_non_blank())
            })
            .count();

        NativeRenderFrameSummary {
            schema: self.schema.clone(),
            cols: self.cols,
            rows: self.rows,
            cell_width_px: self.cell_width_px,
            cell_height_px: self.cell_height_px,
            width_px: self.width_px,
            height_px: self.height_px,
            cell_count: self.cells.len(),
            non_blank_cells,
            paintable_cells,
            occupied_rows,
            styled_cells,
            hyperlink_cells,
            image_count: self.images.len(),
            cursor: self.cursor,
            line_preview: self.non_empty_lines(4),
            frame_sha256: self.frame_sha256(),
            renderer_boundary: "rust-native-render-frame".to_string(),
            webview_used: false,
            react_used: false,
            next_renderer: "winit-wgpu-terminal-grid".to_string(),
        }
    }

    pub fn non_empty_lines(&self, limit: usize) -> Vec<String> {
        let mut lines = Vec::new();
        for row in self.cells.chunks(self.cols as usize) {
            let line = row.iter().map(|cell| cell.ch).collect::<String>();
            let line = line.trim_end().to_string();
            if !line.trim().is_empty() {
                lines.push(line);
            }
            if lines.len() >= limit {
                break;
            }
        }
        if lines.is_empty() {
            lines.push("Aelyris Native Grid".to_string());
        }
        lines
    }

    pub fn frame_sha256(&self) -> String {
        let bytes = serde_json::to_vec(self).unwrap_or_default();
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    pub fn diff_against(&self, previous: Option<&NativeRenderFrame>) -> NativeRenderFrameDiff {
        let previous_compatible = previous.filter(|frame| self.is_diff_compatible_with(frame));
        let cursor_dirty = previous_compatible
            .map(|frame| frame.cursor != self.cursor)
            .unwrap_or(true);
        let image_dirty = previous_compatible
            .map(|frame| frame.images != self.images)
            .unwrap_or(!self.images.is_empty());
        let mut dirty = vec![false; self.cells.len()];

        if let Some(previous) = previous_compatible {
            for (idx, cell) in self.cells.iter().enumerate() {
                dirty[idx] = previous.cells.get(idx) != Some(cell);
            }
            if cursor_dirty {
                self.mark_cursor_cell(&mut dirty, Some(&self.cursor));
                self.mark_cursor_cell(&mut dirty, Some(&previous.cursor));
            }
            if image_dirty {
                dirty.fill(true);
            }
        } else {
            dirty.fill(true);
        }

        let dirty_cells = dirty.iter().filter(|value| **value).count();
        let dirty_rows = dirty
            .chunks(usize::from(self.cols))
            .filter(|row| row.iter().any(|value| *value))
            .count();

        NativeRenderFrameDiff {
            schema: RENDER_DIFF_SCHEMA.to_string(),
            previous_frame_sha256: previous_compatible.map(NativeRenderFrame::frame_sha256),
            current_frame_sha256: self.frame_sha256(),
            cols: self.cols,
            rows: self.rows,
            cell_width_px: self.cell_width_px,
            cell_height_px: self.cell_height_px,
            dirty_cells,
            dirty_rows,
            dirty_rects: self.dirty_rects_from_mask(&dirty),
            cursor_dirty,
            image_dirty,
            full_repaint: previous_compatible.is_none()
                || image_dirty
                || dirty_cells == self.cells.len(),
            renderer_boundary: "rust-native-render-frame-diff".to_string(),
            webview_used: false,
            react_used: false,
            next_renderer: "winit-wgpu-dirty-rects".to_string(),
        }
    }

    fn is_diff_compatible_with(&self, previous: &NativeRenderFrame) -> bool {
        self.schema == previous.schema
            && self.cols == previous.cols
            && self.rows == previous.rows
            && self.cell_width_px == previous.cell_width_px
            && self.cell_height_px == previous.cell_height_px
            && self.cells.len() == previous.cells.len()
    }

    fn mark_cursor_cell(&self, dirty: &mut [bool], cursor: Option<&CursorSnapshot>) {
        let Some(cursor) = cursor else {
            return;
        };
        if cursor.row >= self.rows || cursor.col >= self.cols {
            return;
        }
        let index = usize::from(cursor.row) * usize::from(self.cols) + usize::from(cursor.col);
        if let Some(cell) = dirty.get_mut(index) {
            *cell = true;
        }
    }

    fn dirty_rects_from_mask(&self, dirty: &[bool]) -> Vec<NativeCellRect> {
        let mut rects = Vec::new();
        let cols = usize::from(self.cols);
        for (row_idx, row) in dirty.chunks(cols).enumerate() {
            let mut col = 0usize;
            while col < row.len() {
                if !row[col] {
                    col += 1;
                    continue;
                }
                let start_col = col;
                while col < row.len() && row[col] {
                    col += 1;
                }
                let width_cells = col - start_col;
                rects.push(NativeCellRect {
                    x_px: (start_col as u32) * u32::from(self.cell_width_px),
                    y_px: (row_idx as u32) * u32::from(self.cell_height_px),
                    width_px: self.cell_width_px.saturating_mul(width_cells as u16),
                    height_px: self.cell_height_px,
                });
            }
        }
        rects
    }
}

impl NativeRenderCell {
    fn from_snapshot_cell(
        row: u16,
        col: u16,
        cell: &CellSnapshot,
        metrics: NativeCellMetrics,
    ) -> NativeRenderCell {
        NativeRenderCell {
            row,
            col,
            ch: if cell.ch == '\0' { ' ' } else { cell.ch },
            fg: cell.fg,
            bg: cell.bg,
            attrs: cell.attrs,
            rect: NativeCellRect {
                x_px: u32::from(col) * u32::from(metrics.width_px),
                y_px: u32::from(row) * u32::from(metrics.height_px),
                width_px: metrics.width_px,
                height_px: metrics.height_px,
            },
            hyperlink: cell.hyperlink.clone(),
        }
    }

    fn is_non_blank(&self) -> bool {
        self.ch != ' '
    }

    fn is_paintable(&self) -> bool {
        self.is_non_blank() || self.attrs != 0 || self.hyperlink.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::TermEngine;

    #[test]
    fn render_frame_positions_every_cell() {
        let mut engine = TermEngine::new(4, 2).expect("engine");
        engine.advance_str("ab\r\nc");
        let snapshot = engine.snapshot();
        let frame = NativeRenderFrame::from_snapshot(
            &snapshot,
            NativeCellMetrics::new(9, 18).expect("metrics"),
        );

        assert_eq!(frame.schema, "aelyris.native.render-frame.v1");
        assert_eq!(frame.cells.len(), 8);
        assert_eq!(frame.width_px, 36);
        assert_eq!(frame.height_px, 36);
        assert_eq!(frame.cells[5].row, 1);
        assert_eq!(frame.cells[5].col, 1);
        assert_eq!(frame.cells[5].rect.x_px, 9);
        assert_eq!(frame.cells[5].rect.y_px, 18);

        let summary = frame.summary();
        assert_eq!(summary.non_blank_cells, 3);
        assert_eq!(summary.occupied_rows, 2);
        assert!(!summary.webview_used);
        assert!(!summary.react_used);
        assert_eq!(summary.line_preview[0], "ab");
        assert_eq!(summary.line_preview[1], "c");
    }

    #[test]
    fn render_frame_rejects_zero_cell_metrics() {
        assert!(matches!(
            NativeCellMetrics::new(0, 18),
            Err(NativeRenderFrameError::InvalidCellMetrics { .. })
        ));
        assert!(matches!(
            NativeCellMetrics::new(9, 0),
            Err(NativeRenderFrameError::InvalidCellMetrics { .. })
        ));
    }

    #[test]
    fn render_frame_diff_tracks_dirty_cells_and_cursor() {
        let metrics = NativeCellMetrics::new(9, 18).expect("metrics");
        let mut previous_engine = TermEngine::new(4, 2).expect("engine");
        previous_engine.advance_str("a");
        let previous = NativeRenderFrame::from_snapshot(&previous_engine.snapshot(), metrics);

        let mut current_engine = TermEngine::new(4, 2).expect("engine");
        current_engine.advance_str("a\r\n");
        let current = NativeRenderFrame::from_snapshot(&current_engine.snapshot(), metrics);
        let diff = current.diff_against(Some(&previous));

        assert_eq!(diff.schema, "aelyris.native.render-diff.v1");
        assert_eq!(diff.previous_frame_sha256, Some(previous.frame_sha256()));
        assert_eq!(diff.current_frame_sha256, current.frame_sha256());
        assert!(diff.dirty_cells >= 2);
        assert_eq!(diff.dirty_rows, 2);
        assert!(diff.cursor_dirty);
        assert!(!diff.full_repaint);
        assert!(!diff.webview_used);
        assert!(!diff.react_used);
        assert_eq!(diff.dirty_rects[0].y_px, 0);
    }

    #[test]
    fn render_frame_diff_for_incompatible_previous_requires_full_repaint() {
        let mut previous_engine = TermEngine::new(3, 2).expect("engine");
        previous_engine.advance_str("old");
        let previous = NativeRenderFrame::from_snapshot(
            &previous_engine.snapshot(),
            NativeCellMetrics::new(9, 18).expect("metrics"),
        );

        let mut current_engine = TermEngine::new(4, 2).expect("engine");
        current_engine.advance_str("new");
        let current = NativeRenderFrame::from_snapshot(
            &current_engine.snapshot(),
            NativeCellMetrics::new(9, 18).expect("metrics"),
        );
        let diff = current.diff_against(Some(&previous));

        assert_eq!(diff.previous_frame_sha256, None);
        assert_eq!(diff.dirty_cells, current.cells.len());
        assert_eq!(diff.dirty_rows, usize::from(current.rows));
        assert!(diff.full_repaint);
    }
}
