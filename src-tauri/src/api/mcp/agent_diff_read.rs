use serde::Serialize;

use crate::ghostdiff::{LayerSource, LayerSummary};

use super::super::{ApiError, ApiResult, ApiState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerProjection {
    id: String,
    source_kind: &'static str,
    is_complete: bool,
    created_at: u64,
    file_count: usize,
    hunk_count: usize,
    file_paths: Vec<String>,
}

fn source_kind(source: &LayerSource) -> &'static str {
    match source {
        LayerSource::Worktree { .. } => "worktree",
        LayerSource::BranchComparison { .. } => "branchComparison",
        LayerSource::Snapshot { .. } => "snapshot",
    }
}

fn project_layer(summary: LayerSummary) -> LayerProjection {
    let mut file_paths = summary.file_paths;
    file_paths.sort();
    file_paths.dedup();
    LayerProjection {
        id: summary.id,
        source_kind: source_kind(&summary.source),
        is_complete: summary.is_complete,
        created_at: summary.created_at,
        file_count: summary.file_count,
        hunk_count: summary.hunk_count,
        file_paths,
    }
}

pub(super) fn get(
    state: &ApiState,
    layer_id: &str,
    path: Option<&str>,
) -> ApiResult<serde_json::Value> {
    let layers = state.ghost_layers.as_ref().ok_or_else(|| {
        ApiError::Internal("GhostDiff layer registry is not attached to this process".to_string())
    })?;
    let summary = crate::control::diff::list_layers(layers)
        .layers
        .into_iter()
        .find(|summary| summary.id == layer_id)
        .ok_or_else(|| ApiError::NotFound(format!("GhostDiff layer {layer_id}")))?;
    let layer = project_layer(summary);
    let file = path
        .map(|path| {
            crate::control::diff::get_file(layers, layer_id, path).ok_or_else(|| {
                ApiError::NotFound(format!("GhostDiff file {path} in layer {layer_id}"))
            })
        })
        .transpose()?;
    let raw_source_returned = file.is_some();
    let mut result = serde_json::json!({
        "source": "ghostdiff-layer-registry",
        "against": "base",
        "layer": layer,
        "rawSourceReturned": raw_source_returned,
        "sensitiveOutputPossible": raw_source_returned,
        "repoRelativePathsReturned": true,
        "filesystemPathsExposed": false,
        "unrelatedLayersExposed": false,
        "readOnly": true,
    });
    if let Some(file) = file {
        result
            .as_object_mut()
            .expect("agent diff projection is an object")
            .insert(
                "file".to_string(),
                serde_json::to_value(file).map_err(|error| {
                    ApiError::Internal(format!("serialize GhostDiff file: {error}"))
                })?,
            );
    }
    Ok(result)
}
