//! Mouse text selection (click-drag, double-click word, triple-click line).

/// A text selection range in the terminal grid.
#[derive(Clone, Debug, Default)]
pub struct Selection {
    /// Selection anchor (where mouse-down started).
    pub anchor: Option<SelectionPoint>,
    /// Selection end (current mouse position).
    pub end: Option<SelectionPoint>,
}

#[derive(Clone, Debug)]
pub struct SelectionPoint {
    pub row: u16,
    pub col: u16,
}

impl Selection {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a new selection at the given grid position.
    pub fn start(&mut self, row: u16, col: u16) {
        let point = SelectionPoint { row, col };
        self.anchor = Some(point.clone());
        self.end = Some(point);
    }

    /// Update the selection end point (mouse move).
    pub fn update(&mut self, row: u16, col: u16) {
        self.end = Some(SelectionPoint { row, col });
    }

    /// Clear the selection.
    pub fn clear(&mut self) {
        self.anchor = None;
        self.end = None;
    }

    /// Returns true if a selection is active.
    pub fn is_active(&self) -> bool {
        self.anchor.is_some() && self.end.is_some()
    }

    /// Get the normalized (start, end) range, ordered top-to-bottom, left-to-right.
    pub fn normalized(&self) -> Option<(SelectionPoint, SelectionPoint)> {
        match (&self.anchor, &self.end) {
            (Some(a), Some(e)) => {
                if a.row < e.row || (a.row == e.row && a.col <= e.col) {
                    Some((a.clone(), e.clone()))
                } else {
                    Some((e.clone(), a.clone()))
                }
            }
            _ => None,
        }
    }

    /// Check if a cell is within the selection.
    pub fn contains(&self, row: u16, col: u16) -> bool {
        if let Some((start, end)) = self.normalized() {
            if row < start.row || row > end.row {
                return false;
            }
            if row == start.row && row == end.row {
                return col >= start.col && col <= end.col;
            }
            if row == start.row {
                return col >= start.col;
            }
            if row == end.row {
                return col <= end.col;
            }
            true
        } else {
            false
        }
    }
}
