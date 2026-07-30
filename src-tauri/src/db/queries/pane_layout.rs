use rusqlite::{params, OptionalExtension};

use super::{Database, PaneTreeLayoutRecord};

const MAX_PANE_LAYOUT_KEY_BYTES: usize = 256;
const MAX_PANE_LAYOUT_JSON_BYTES: usize = 256 * 1024;

impl Database {
    pub fn save_pane_tree_layout(
        &self,
        storage_key: &str,
        project_path: &str,
        layout_json: &str,
    ) -> Result<(), String> {
        validate_pane_layout_key(storage_key)?;
        validate_pane_layout_json(layout_json)?;
        self.conn
            .execute(
                "INSERT INTO pane_tree_layouts (storage_key, project_path, layout_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(storage_key) DO UPDATE SET
                    project_path = excluded.project_path,
                    layout_json = excluded.layout_json,
                    updated_at = datetime('now')",
                params![storage_key, project_path, layout_json],
            )
            .map_err(|e| format!("Save pane tree layout: {}", e))?;
        Ok(())
    }

    pub fn get_pane_tree_layout(
        &self,
        storage_key: &str,
    ) -> Result<Option<PaneTreeLayoutRecord>, String> {
        validate_pane_layout_key(storage_key)?;
        self.conn
            .query_row(
                "SELECT storage_key, project_path, layout_json, updated_at
                 FROM pane_tree_layouts
                 WHERE storage_key = ?1",
                params![storage_key],
                |row| {
                    Ok(PaneTreeLayoutRecord {
                        storage_key: row.get(0)?,
                        project_path: row.get(1)?,
                        layout_json: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Get pane tree layout: {}", e))
    }

    pub fn delete_pane_tree_layout(&self, storage_key: &str) -> Result<(), String> {
        validate_pane_layout_key(storage_key)?;
        self.conn
            .execute(
                "DELETE FROM pane_tree_layouts WHERE storage_key = ?1",
                params![storage_key],
            )
            .map_err(|e| format!("Delete pane tree layout: {}", e))?;
        Ok(())
    }
}

fn validate_pane_layout_key(storage_key: &str) -> Result<(), String> {
    if storage_key.trim().is_empty() {
        return Err("Pane layout storage key is required".to_string());
    }
    if storage_key.len() > MAX_PANE_LAYOUT_KEY_BYTES {
        return Err("Pane layout storage key is too long".to_string());
    }
    Ok(())
}

fn validate_pane_layout_json(layout_json: &str) -> Result<(), String> {
    if layout_json.len() > MAX_PANE_LAYOUT_JSON_BYTES {
        return Err("Pane layout snapshot is too large".to_string());
    }
    serde_json::from_str::<serde_json::Value>(layout_json)
        .map_err(|e| format!("Pane layout snapshot is invalid JSON: {}", e))?;
    Ok(())
}
