use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::db::ManagedDb;

use super::{CostCaps, CostCapsPolicy, CostCapsValidationError};

const COST_CAPS_RECORD_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{code}: {operation}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct CostCapsPersistenceError {
    pub code: &'static str,
    pub operation: &'static str,
    pub message: String,
}

impl CostCapsPersistenceError {
    pub(crate) fn new(operation: &'static str, message: impl Into<String>) -> Self {
        Self {
            code: "cost_caps_persistence_failed",
            operation,
            message: message.into(),
        }
    }

    pub(crate) fn unavailable() -> Self {
        Self::new(
            "persist",
            "the durable Aelyris database is not attached to the Cost Manager",
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(untagged)]
pub enum CostCapsUpdateError {
    #[error(transparent)]
    Validation(#[from] CostCapsValidationError),
    #[error(transparent)]
    Persistence(#[from] CostCapsPersistenceError),
}

pub(crate) fn load(
    db: &ManagedDb,
    policy: CostCapsPolicy,
) -> Result<Option<CostCaps>, CostCapsPersistenceError> {
    let row = db
        .with(|database| {
            database
                .conn()
                .query_row(
                    "SELECT schema_version, caps_json
                       FROM cost_caps_state
                      WHERE singleton_id = 1",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string())
        })
        .map_err(|message| CostCapsPersistenceError::new("restore", message))?;
    let Some((schema_version, caps_json)) = row else {
        return Ok(None);
    };
    if schema_version != COST_CAPS_RECORD_SCHEMA_VERSION {
        return Err(CostCapsPersistenceError::new(
            "restore",
            format!(
                "unsupported cost cap record schema version {schema_version}; expected {COST_CAPS_RECORD_SCHEMA_VERSION}"
            ),
        ));
    }
    let caps = serde_json::from_str::<CostCaps>(&caps_json).map_err(|error| {
        CostCapsPersistenceError::new("restore", format!("invalid cost cap JSON: {error}"))
    })?;
    caps.validate_for_update(policy)
        .map_err(|error| malformed_record(error.field, &error.message))?;
    Ok(Some(caps))
}

pub(crate) fn save(db: &ManagedDb, caps: CostCaps) -> Result<(), CostCapsPersistenceError> {
    let caps_json = serde_json::to_string(&caps).map_err(|error| {
        CostCapsPersistenceError::new("persist", format!("could not serialize cost caps: {error}"))
    })?;
    let updated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64;
    db.with(|database| {
        database
            .conn()
            .execute(
                "INSERT INTO cost_caps_state (
                    singleton_id, schema_version, caps_json, updated_at_ms
                 ) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(singleton_id) DO UPDATE SET
                    schema_version = excluded.schema_version,
                    caps_json = excluded.caps_json,
                    updated_at_ms = excluded.updated_at_ms",
                params![COST_CAPS_RECORD_SCHEMA_VERSION, caps_json, updated_at_ms],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .map_err(|message| CostCapsPersistenceError::new("persist", message))
}

fn malformed_record(field: &str, message: &str) -> CostCapsPersistenceError {
    CostCapsPersistenceError::new(
        "restore",
        format!("persisted {field} is invalid: {message}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_errors_preserve_the_existing_structured_wire_shapes() {
        let validation = CostCaps {
            max_agents: None,
            ..CostCaps::default()
        }
        .validate_for_update(CostCapsPolicy::default())
        .unwrap_err();
        let validation_value = serde_json::to_value(CostCapsUpdateError::from(validation)).unwrap();
        assert_eq!(validation_value["code"], "invalid_cost_caps");
        assert_eq!(validation_value["field"], "max_agents");

        let persistence_value = serde_json::to_value(CostCapsUpdateError::from(
            CostCapsPersistenceError::new("persist", "database is read-only"),
        ))
        .unwrap();
        assert_eq!(persistence_value["code"], "cost_caps_persistence_failed");
        assert_eq!(persistence_value["operation"], "persist");
        assert_eq!(persistence_value["message"], "database is read-only");
    }
}
