use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SplitAxis {
    Horizontal,
    Vertical,
}

impl SplitAxis {
    pub fn opposite(self) -> Self {
        match self {
            Self::Horizontal => Self::Vertical,
            Self::Vertical => Self::Horizontal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LayoutNode {
    Pane {
        #[serde(rename = "paneId", alias = "pane_id")]
        pane_id: String,
    },
    Split {
        axis: SplitAxis,
        ratio: f32,
        first: Box<LayoutNode>,
        second: Box<LayoutNode>,
    },
}

impl LayoutNode {
    pub fn single(pane_id: impl Into<String>) -> Self {
        Self::Pane {
            pane_id: pane_id.into(),
        }
    }

    pub fn split(
        axis: SplitAxis,
        ratio: f32,
        first: LayoutNode,
        second: LayoutNode,
    ) -> Result<Self, LayoutError> {
        validate_ratio(ratio)?;
        Ok(Self::Split {
            axis,
            ratio,
            first: Box::new(first),
            second: Box::new(second),
        })
    }

    pub fn contains(&self, pane_id: &str) -> bool {
        match self {
            Self::Pane { pane_id: id } => id == pane_id,
            Self::Split { first, second, .. } => {
                first.contains(pane_id) || second.contains(pane_id)
            }
        }
    }

    pub fn pane_ids(&self) -> Vec<String> {
        let mut ids = Vec::new();
        self.collect_pane_ids(&mut ids);
        ids
    }

    pub fn validate(&self) -> Result<(), LayoutError> {
        let mut seen = HashSet::new();
        self.validate_inner(&mut seen)?;
        if seen.is_empty() {
            return Err(LayoutError::EmptyLayout);
        }
        Ok(())
    }

    fn collect_pane_ids(&self, ids: &mut Vec<String>) {
        match self {
            Self::Pane { pane_id } => ids.push(pane_id.clone()),
            Self::Split { first, second, .. } => {
                first.collect_pane_ids(ids);
                second.collect_pane_ids(ids);
            }
        }
    }

    fn validate_inner(&self, seen: &mut HashSet<String>) -> Result<(), LayoutError> {
        match self {
            Self::Pane { pane_id } => {
                if pane_id.trim().is_empty() {
                    return Err(LayoutError::InvalidPaneId);
                }
                if !seen.insert(pane_id.clone()) {
                    return Err(LayoutError::DuplicatePane(pane_id.clone()));
                }
                Ok(())
            }
            Self::Split {
                ratio,
                first,
                second,
                ..
            } => {
                validate_ratio(*ratio)?;
                first.validate_inner(seen)?;
                second.validate_inner(seen)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabLayout {
    pub root: LayoutNode,
    pub active_pane_id: String,
    pub zoomed_pane_id: Option<String>,
}

impl TabLayout {
    pub fn single(pane_id: impl Into<String>) -> Self {
        let pane_id = pane_id.into();
        Self {
            root: LayoutNode::single(pane_id.clone()),
            active_pane_id: pane_id,
            zoomed_pane_id: None,
        }
    }

    pub fn validate(&self) -> Result<(), LayoutError> {
        self.root.validate()?;
        if !self.root.contains(&self.active_pane_id) {
            return Err(LayoutError::MissingActivePane(self.active_pane_id.clone()));
        }
        if let Some(zoomed) = &self.zoomed_pane_id {
            if !self.root.contains(zoomed) {
                return Err(LayoutError::MissingZoomedPane(zoomed.clone()));
            }
        }
        Ok(())
    }

    pub fn pane_ids(&self) -> Vec<String> {
        self.root.pane_ids()
    }

    pub fn split_pane(
        &mut self,
        target_pane_id: &str,
        new_pane_id: impl Into<String>,
        axis: SplitAxis,
        ratio: f32,
        place_after: bool,
    ) -> Result<(), LayoutError> {
        let new_pane_id = new_pane_id.into();
        if self.root.contains(&new_pane_id) {
            return Err(LayoutError::DuplicatePane(new_pane_id));
        }
        replace_leaf(&mut self.root, target_pane_id, |old| {
            let new = LayoutNode::single(new_pane_id.clone());
            if place_after {
                LayoutNode::split(axis, ratio, old, new)
            } else {
                LayoutNode::split(axis, ratio, new, old)
            }
        })?;
        self.active_pane_id = new_pane_id;
        self.validate()
    }

    pub fn close_pane(&mut self, pane_id: &str) -> Result<(), LayoutError> {
        let before = self.root.pane_ids();
        if before.len() <= 1 {
            return Err(LayoutError::CannotCloseLastPane);
        }
        self.root = remove_leaf(self.root.clone(), pane_id)?.ok_or(LayoutError::EmptyLayout)?;
        if self.active_pane_id == pane_id {
            self.active_pane_id = self
                .root
                .pane_ids()
                .into_iter()
                .next()
                .ok_or(LayoutError::EmptyLayout)?;
        }
        if self.zoomed_pane_id.as_deref() == Some(pane_id) {
            self.zoomed_pane_id = None;
        }
        self.validate()
    }

    pub fn swap_panes(
        &mut self,
        first_pane_id: &str,
        second_pane_id: &str,
    ) -> Result<(), LayoutError> {
        if first_pane_id == second_pane_id {
            return Ok(());
        }
        if !self.root.contains(first_pane_id) {
            return Err(LayoutError::PaneNotFound(first_pane_id.to_string()));
        }
        if !self.root.contains(second_pane_id) {
            return Err(LayoutError::PaneNotFound(second_pane_id.to_string()));
        }
        swap_leaf_ids(&mut self.root, first_pane_id, second_pane_id);
        if self.active_pane_id == first_pane_id {
            self.active_pane_id = second_pane_id.to_string();
        } else if self.active_pane_id == second_pane_id {
            self.active_pane_id = first_pane_id.to_string();
        }
        if self.zoomed_pane_id.as_deref() == Some(first_pane_id) {
            self.zoomed_pane_id = Some(second_pane_id.to_string());
        } else if self.zoomed_pane_id.as_deref() == Some(second_pane_id) {
            self.zoomed_pane_id = Some(first_pane_id.to_string());
        }
        self.validate()
    }

    pub fn move_pane_next_to(
        &mut self,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: SplitAxis,
        place_after: bool,
    ) -> Result<(), LayoutError> {
        if source_pane_id == target_pane_id {
            return Ok(());
        }
        if !self.root.contains(source_pane_id) {
            return Err(LayoutError::PaneNotFound(source_pane_id.to_string()));
        }
        if !self.root.contains(target_pane_id) {
            return Err(LayoutError::PaneNotFound(target_pane_id.to_string()));
        }

        self.root =
            remove_leaf(self.root.clone(), source_pane_id)?.ok_or(LayoutError::EmptyLayout)?;
        replace_leaf(&mut self.root, target_pane_id, |target| {
            let source = LayoutNode::single(source_pane_id.to_string());
            if place_after {
                LayoutNode::split(axis, 0.5, target, source)
            } else {
                LayoutNode::split(axis, 0.5, source, target)
            }
        })?;
        self.active_pane_id = source_pane_id.to_string();
        self.validate()
    }

    pub fn apply_even(&mut self, axis: SplitAxis) -> Result<(), LayoutError> {
        let ids = self.root.pane_ids();
        self.root = build_even(&ids, axis)?;
        self.validate()
    }

    pub fn equalize_ratios(&mut self) -> Result<(), LayoutError> {
        equalize_split_ratios(&mut self.root);
        self.validate()
    }

    pub fn apply_tiled(&mut self) -> Result<(), LayoutError> {
        let ids = self.root.pane_ids();
        self.root = build_tiled(&ids, SplitAxis::Horizontal)?;
        self.validate()
    }

    pub fn rotate_panes(&mut self, reverse: bool) -> Result<(), LayoutError> {
        let ids = self.root.pane_ids();
        if ids.len() <= 1 {
            return Ok(());
        }
        let mut rotated = ids;
        if reverse {
            rotated.rotate_left(1);
        } else {
            rotated.rotate_right(1);
        }
        assign_leaf_ids_in_order(&mut self.root, &mut rotated.into_iter())?;
        self.validate()
    }

    pub fn set_zoomed(&mut self, pane_id: Option<String>) -> Result<(), LayoutError> {
        if let Some(id) = &pane_id {
            if !self.root.contains(id) {
                return Err(LayoutError::PaneNotFound(id.clone()));
            }
        }
        self.zoomed_pane_id = pane_id;
        self.validate()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutError {
    CannotCloseLastPane,
    DuplicatePane(String),
    EmptyLayout,
    InvalidPaneId,
    InvalidRatio,
    MissingActivePane(String),
    MissingZoomedPane(String),
    PaneNotFound(String),
}

impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CannotCloseLastPane => write!(f, "cannot close the last pane"),
            Self::DuplicatePane(id) => write!(f, "duplicate pane id: {id}"),
            Self::EmptyLayout => write!(f, "layout must contain at least one pane"),
            Self::InvalidPaneId => write!(f, "pane id must not be empty"),
            Self::InvalidRatio => write!(f, "split ratio must be between 0.05 and 0.95"),
            Self::MissingActivePane(id) => write!(f, "active pane is not in layout: {id}"),
            Self::MissingZoomedPane(id) => write!(f, "zoomed pane is not in layout: {id}"),
            Self::PaneNotFound(id) => write!(f, "pane not found: {id}"),
        }
    }
}

impl std::error::Error for LayoutError {}

fn validate_ratio(ratio: f32) -> Result<(), LayoutError> {
    if (0.05..=0.95).contains(&ratio) {
        Ok(())
    } else {
        Err(LayoutError::InvalidRatio)
    }
}

fn equalize_split_ratios(node: &mut LayoutNode) {
    match node {
        LayoutNode::Pane { .. } => {}
        LayoutNode::Split {
            ratio,
            first,
            second,
            ..
        } => {
            *ratio = 0.5;
            equalize_split_ratios(first);
            equalize_split_ratios(second);
        }
    }
}

fn replace_leaf<F>(node: &mut LayoutNode, pane_id: &str, make_node: F) -> Result<(), LayoutError>
where
    F: FnOnce(LayoutNode) -> Result<LayoutNode, LayoutError>,
{
    fn go<F>(
        node: &mut LayoutNode,
        pane_id: &str,
        make_node: &mut Option<F>,
    ) -> Result<bool, LayoutError>
    where
        F: FnOnce(LayoutNode) -> Result<LayoutNode, LayoutError>,
    {
        match node {
            LayoutNode::Pane { pane_id: id } if id == pane_id => {
                let old = std::mem::replace(node, LayoutNode::single("__aelyris_pending__"));
                let maker = make_node
                    .take()
                    .ok_or(LayoutError::PaneNotFound(pane_id.to_string()))?;
                *node = maker(old)?;
                Ok(true)
            }
            LayoutNode::Pane { .. } => Ok(false),
            LayoutNode::Split { first, second, .. } => {
                if go(first, pane_id, make_node)? {
                    Ok(true)
                } else {
                    go(second, pane_id, make_node)
                }
            }
        }
    }

    let mut make_node = Some(make_node);
    if go(node, pane_id, &mut make_node)? {
        Ok(())
    } else {
        Err(LayoutError::PaneNotFound(pane_id.to_string()))
    }
}

fn remove_leaf(node: LayoutNode, pane_id: &str) -> Result<Option<LayoutNode>, LayoutError> {
    match node {
        LayoutNode::Pane { pane_id: id } if id == pane_id => Ok(None),
        LayoutNode::Pane { pane_id: id } => Ok(Some(LayoutNode::Pane { pane_id: id })),
        LayoutNode::Split {
            axis,
            ratio,
            first,
            second,
        } => {
            let first = remove_leaf(*first, pane_id)?;
            let second = remove_leaf(*second, pane_id)?;
            match (first, second) {
                (Some(first), Some(second)) => {
                    LayoutNode::split(axis, ratio, first, second).map(Some)
                }
                (Some(only), None) | (None, Some(only)) => Ok(Some(only)),
                (None, None) => Ok(None),
            }
        }
    }
}

fn swap_leaf_ids(node: &mut LayoutNode, first_pane_id: &str, second_pane_id: &str) {
    match node {
        LayoutNode::Pane { pane_id } if pane_id == first_pane_id => {
            *pane_id = second_pane_id.to_string();
        }
        LayoutNode::Pane { pane_id } if pane_id == second_pane_id => {
            *pane_id = first_pane_id.to_string();
        }
        LayoutNode::Pane { .. } => {}
        LayoutNode::Split { first, second, .. } => {
            swap_leaf_ids(first, first_pane_id, second_pane_id);
            swap_leaf_ids(second, first_pane_id, second_pane_id);
        }
    }
}

fn assign_leaf_ids_in_order(
    node: &mut LayoutNode,
    ids: &mut impl Iterator<Item = String>,
) -> Result<(), LayoutError> {
    match node {
        LayoutNode::Pane { pane_id } => {
            *pane_id = ids.next().ok_or(LayoutError::EmptyLayout)?;
            Ok(())
        }
        LayoutNode::Split { first, second, .. } => {
            assign_leaf_ids_in_order(first, ids)?;
            assign_leaf_ids_in_order(second, ids)
        }
    }
}

fn build_even(ids: &[String], axis: SplitAxis) -> Result<LayoutNode, LayoutError> {
    if ids.is_empty() {
        return Err(LayoutError::EmptyLayout);
    }
    let mut iter = ids.iter();
    let first = LayoutNode::single(iter.next().expect("checked non-empty").clone());
    iter.try_fold(first, |acc, id| {
        LayoutNode::split(axis, 0.5, acc, LayoutNode::single(id.clone()))
    })
}

fn build_tiled(ids: &[String], axis: SplitAxis) -> Result<LayoutNode, LayoutError> {
    match ids {
        [] => Err(LayoutError::EmptyLayout),
        [id] => Ok(LayoutNode::single(id.clone())),
        _ => {
            let mid = ids.len() / 2;
            let first = build_tiled(&ids[..mid], axis.opposite())?;
            let second = build_tiled(&ids[mid..], axis.opposite())?;
            LayoutNode::split(axis, 0.5, first, second)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_close_and_focus_round_trip() {
        let mut layout = TabLayout::single("pane-a");
        layout
            .split_pane("pane-a", "pane-b", SplitAxis::Horizontal, 0.5, true)
            .unwrap();
        layout
            .split_pane("pane-b", "pane-c", SplitAxis::Vertical, 0.4, true)
            .unwrap();

        assert_eq!(layout.pane_ids(), vec!["pane-a", "pane-b", "pane-c"]);
        assert_eq!(layout.active_pane_id, "pane-c");

        layout.close_pane("pane-c").unwrap();
        assert_eq!(layout.pane_ids(), vec!["pane-a", "pane-b"]);
        assert_eq!(layout.active_pane_id, "pane-a");
        layout.validate().unwrap();
    }

    #[test]
    fn swap_updates_active_and_zoomed_pane() {
        let mut layout = TabLayout::single("left");
        layout
            .split_pane("left", "right", SplitAxis::Horizontal, 0.5, true)
            .unwrap();
        layout.set_zoomed(Some("right".to_string())).unwrap();

        layout.swap_panes("left", "right").unwrap();

        assert_eq!(layout.pane_ids(), vec!["right", "left"]);
        assert_eq!(layout.active_pane_id, "left");
        assert_eq!(layout.zoomed_pane_id.as_deref(), Some("left"));
    }

    #[test]
    fn move_pane_next_to_target_collapses_source_branch() {
        let mut layout = TabLayout::single("a");
        layout
            .split_pane("a", "b", SplitAxis::Horizontal, 0.5, true)
            .unwrap();
        layout
            .split_pane("b", "c", SplitAxis::Vertical, 0.5, true)
            .unwrap();

        layout
            .move_pane_next_to("a", "c", SplitAxis::Horizontal, false)
            .unwrap();

        assert_eq!(layout.pane_ids(), vec!["b", "a", "c"]);
        assert_eq!(layout.active_pane_id, "a");
        layout.validate().unwrap();
    }

    #[test]
    fn even_and_tiled_keep_pane_identity() {
        let mut layout = TabLayout::single("a");
        layout
            .split_pane("a", "b", SplitAxis::Horizontal, 0.5, true)
            .unwrap();
        layout
            .split_pane("b", "c", SplitAxis::Vertical, 0.5, true)
            .unwrap();
        layout
            .split_pane("c", "d", SplitAxis::Horizontal, 0.5, true)
            .unwrap();

        layout.apply_even(SplitAxis::Vertical).unwrap();
        assert_eq!(layout.pane_ids(), vec!["a", "b", "c", "d"]);
        layout.apply_tiled().unwrap();
        assert_eq!(layout.pane_ids(), vec!["a", "b", "c", "d"]);
        layout.validate().unwrap();
    }

    #[test]
    fn rejects_duplicate_and_invalid_layouts() {
        let mut layout = TabLayout::single("a");
        let err = layout
            .split_pane("a", "a", SplitAxis::Horizontal, 0.5, true)
            .unwrap_err();
        assert_eq!(err, LayoutError::DuplicatePane("a".to_string()));

        let err = LayoutNode::split(
            SplitAxis::Horizontal,
            0.99,
            LayoutNode::single("a"),
            LayoutNode::single("b"),
        )
        .unwrap_err();
        assert_eq!(err, LayoutError::InvalidRatio);
    }

    #[test]
    fn rotate_panes_preserves_topology_and_focus_identity() {
        let mut layout = TabLayout::single("a");
        layout
            .split_pane("a", "b", SplitAxis::Horizontal, 0.3, true)
            .unwrap();
        layout
            .split_pane("b", "c", SplitAxis::Vertical, 0.7, true)
            .unwrap();
        layout.active_pane_id = "b".to_string();
        layout.set_zoomed(Some("c".to_string())).unwrap();

        layout.rotate_panes(false).unwrap();
        assert_eq!(layout.pane_ids(), vec!["c", "a", "b"]);
        assert_eq!(layout.active_pane_id, "b");
        assert_eq!(layout.zoomed_pane_id.as_deref(), Some("c"));
        match &layout.root {
            LayoutNode::Split { ratio, second, .. } => {
                assert_eq!(*ratio, 0.3);
                match second.as_ref() {
                    LayoutNode::Split { ratio, .. } => assert_eq!(*ratio, 0.7),
                    other => panic!("expected nested split, got {other:?}"),
                }
            }
            other => panic!("expected split, got {other:?}"),
        }

        layout.rotate_panes(true).unwrap();
        assert_eq!(layout.pane_ids(), vec!["a", "b", "c"]);
        layout.validate().unwrap();
    }
}
