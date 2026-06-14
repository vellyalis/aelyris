use crate::control::ControlResult;
use crate::ghostdiff::{FileDelta, LayerRegistry, LayerSnapshot};

pub fn list_layers(registry: &LayerRegistry) -> LayerSnapshot {
    registry.snapshot()
}

pub fn get_file(registry: &LayerRegistry, layer_id: &str, path: &str) -> Option<FileDelta> {
    registry.get_file(layer_id, path)
}

pub fn ensure_distinct_branches(base_branch: &str, head_branch: &str) -> ControlResult<()> {
    if base_branch == head_branch {
        return Err("base and head branch must be different".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_read_only_layer_snapshot_and_file_lookup() {
        let registry = LayerRegistry::new();
        assert!(list_layers(&registry).layers.is_empty());
        assert!(get_file(&registry, "missing", "src/main.rs").is_none());
        assert!(ensure_distinct_branches("main", "agent/demo").is_ok());
        assert!(ensure_distinct_branches("main", "main").is_err());
    }
}
