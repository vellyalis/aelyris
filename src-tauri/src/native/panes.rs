//! Pane tree data structures for split terminal layouts.

use std::sync::{Arc, Mutex};
use crate::gpu::grid::Grid;
use crate::ui::block::BlockTracker;
use super::types::AgentTabInfo;

/// Split direction for pane splitting.
#[derive(Clone, Copy, Debug)]
pub enum SplitDir {
    Horizontal,
    Vertical,
}

/// A leaf pane — single terminal with its own PTY.
pub struct PaneLeaf {
    pub id: u32,
    pub pty_id: String,
    pub grid: Arc<Mutex<Grid>>,
    pub agent_info: Option<AgentTabInfo>,
    /// Tracks command blocks (prompt detection + collapse state).
    pub block_tracker: BlockTracker,
}

/// Pane tree node — either a leaf or a split.
pub enum PaneNode {
    Leaf(PaneLeaf),
    Split {
        dir: SplitDir,
        ratio: f32,
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}

impl PaneNode {
    /// Find a leaf by pane ID.
    pub fn find_leaf(&self, id: u32) -> Option<&PaneLeaf> {
        match self {
            PaneNode::Leaf(leaf) => {
                if leaf.id == id { Some(leaf) } else { None }
            }
            PaneNode::Split { first, second, .. } => {
                first.find_leaf(id).or_else(|| second.find_leaf(id))
            }
        }
    }

    pub fn find_leaf_mut(&mut self, id: u32) -> Option<&mut PaneLeaf> {
        match self {
            PaneNode::Leaf(leaf) => {
                if leaf.id == id { Some(leaf) } else { None }
            }
            PaneNode::Split { first, second, .. } => {
                if let Some(l) = first.find_leaf_mut(id) {
                    Some(l)
                } else {
                    second.find_leaf_mut(id)
                }
            }
        }
    }

    /// Collect all leaf pane IDs (left-to-right / top-to-bottom order).
    pub fn leaf_ids(&self) -> Vec<u32> {
        match self {
            PaneNode::Leaf(leaf) => vec![leaf.id],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.leaf_ids();
                ids.extend(second.leaf_ids());
                ids
            }
        }
    }

    /// Collect all PTY IDs for cleanup.
    pub fn all_pty_ids(&self) -> Vec<String> {
        match self {
            PaneNode::Leaf(leaf) => vec![leaf.pty_id.clone()],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.all_pty_ids();
                ids.extend(second.all_pty_ids());
                ids
            }
        }
    }

    /// Apply a function to all leaves (for resize, etc.)
    pub fn for_each_leaf<F: FnMut(&PaneLeaf)>(&self, f: &mut F) {
        match self {
            PaneNode::Leaf(leaf) => f(leaf),
            PaneNode::Split { first, second, .. } => {
                first.for_each_leaf(f);
                second.for_each_leaf(f);
            }
        }
    }

    /// Remove a leaf pane by ID. Returns the PTY ID of the removed pane, or None.
    pub fn close_leaf(&mut self, target_id: u32) -> Option<String> {
        match self {
            PaneNode::Split { first, second, .. } => {
                if matches!(first.as_ref(), PaneNode::Leaf(l) if l.id == target_id) {
                    let pty_id = if let PaneNode::Leaf(l) = first.as_ref() {
                        l.pty_id.clone()
                    } else {
                        return None;
                    };
                    let sibling = std::mem::replace(
                        second.as_mut(),
                        PaneNode::Leaf(PaneLeaf {
                            id: 0, pty_id: String::new(),
                            grid: Arc::new(Mutex::new(Grid::new(1, 1, 0))),
                            agent_info: None,
                            block_tracker: BlockTracker::new(),
                        }),
                    );
                    *self = sibling;
                    return Some(pty_id);
                }
                if matches!(second.as_ref(), PaneNode::Leaf(l) if l.id == target_id) {
                    let pty_id = if let PaneNode::Leaf(l) = second.as_ref() {
                        l.pty_id.clone()
                    } else {
                        return None;
                    };
                    let sibling = std::mem::replace(
                        first.as_mut(),
                        PaneNode::Leaf(PaneLeaf {
                            id: 0, pty_id: String::new(),
                            grid: Arc::new(Mutex::new(Grid::new(1, 1, 0))),
                            agent_info: None,
                            block_tracker: BlockTracker::new(),
                        }),
                    );
                    *self = sibling;
                    return Some(pty_id);
                }
                first.close_leaf(target_id).or_else(|| second.close_leaf(target_id))
            }
            PaneNode::Leaf(_) => None,
        }
    }

    /// Find the split node containing target_id and adjust its ratio.
    pub fn adjust_ratio(&mut self, target_id: u32, delta: f32) -> bool {
        match self {
            PaneNode::Split { first, second, ratio, .. } => {
                let first_ids = first.leaf_ids();
                let second_ids = second.leaf_ids();
                if first_ids.contains(&target_id) || second_ids.contains(&target_id) {
                    *ratio = (*ratio + delta).clamp(0.15, 0.85);
                    return true;
                }
                first.adjust_ratio(target_id, delta) || second.adjust_ratio(target_id, delta)
            }
            PaneNode::Leaf(_) => false,
        }
    }

    /// Split a leaf pane by ID, returning the new leaf's ID.
    pub fn split_leaf(
        &mut self,
        target_id: u32,
        dir: SplitDir,
        new_leaf: PaneLeaf,
    ) -> bool {
        match self {
            PaneNode::Leaf(leaf) if leaf.id == target_id => {
                let old = std::mem::replace(
                    self,
                    PaneNode::Leaf(PaneLeaf {
                        id: 0,
                        pty_id: String::new(),
                        grid: Arc::new(Mutex::new(Grid::new(1, 1, 0))),
                        agent_info: None,
                        block_tracker: BlockTracker::new(),
                    }),
                );
                *self = PaneNode::Split {
                    dir,
                    ratio: 0.5,
                    first: Box::new(old),
                    second: Box::new(PaneNode::Leaf(new_leaf)),
                };
                true
            }
            PaneNode::Split { first, second, .. } => {
                if first.find_leaf(target_id).is_some() {
                    first.split_leaf(target_id, dir, new_leaf)
                } else {
                    second.split_leaf(target_id, dir, new_leaf)
                }
            }
            _ => false,
        }
    }
}

/// Per-tab state: pane tree with focused pane tracking.
pub struct TabState {
    pub root: PaneNode,
    pub focused_pane_id: u32,
    pub next_pane_id: u32,
}

impl TabState {
    pub fn new_single(pty_id: String, grid: Arc<Mutex<Grid>>, agent_info: Option<AgentTabInfo>) -> Self {
        Self {
            root: PaneNode::Leaf(PaneLeaf { id: 0, pty_id, grid, agent_info, block_tracker: BlockTracker::new() }),
            focused_pane_id: 0,
            next_pane_id: 1,
        }
    }

    pub fn focused_leaf(&self) -> Option<&PaneLeaf> {
        self.root.find_leaf(self.focused_pane_id)
    }

    pub fn focused_leaf_mut(&mut self) -> Option<&mut PaneLeaf> {
        self.root.find_leaf_mut(self.focused_pane_id)
    }

    pub fn focus_next(&mut self) {
        let ids = self.root.leaf_ids();
        if let Some(pos) = ids.iter().position(|&id| id == self.focused_pane_id) {
            self.focused_pane_id = ids[(pos + 1) % ids.len()];
        }
    }

    pub fn grid(&self) -> Option<&Arc<Mutex<Grid>>> {
        self.focused_leaf().map(|l| &l.grid)
    }

    pub fn pty_id(&self) -> Option<&str> {
        self.focused_leaf().map(|l| l.pty_id.as_str())
    }

    pub fn agent_info(&self) -> Option<&AgentTabInfo> {
        self.focused_leaf().and_then(|l| l.agent_info.as_ref())
    }
}
