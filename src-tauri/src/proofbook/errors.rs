use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofbookErrorCode {
    InvalidProjectPath,
    PathOutsideProject,
    ProofbookDirMissing,
    IoError,
    YamlParseError,
    UnsupportedSchemaVersion,
    MissingRequiredField,
    InvalidIdentifier,
    DuplicateId,
    UnknownStepType,
    MissingDependency,
    CycleDetected,
    MissingSettlement,
    InvalidSecretRef,
    RuntimeNotAvailable,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq, Serialize, Deserialize)]
#[error("{code:?}: {message}")]
#[serde(rename_all = "camelCase")]
pub struct ProofbookError {
    pub code: ProofbookErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub definition_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub path: Option<String>,
}

impl ProofbookError {
    pub fn new(code: ProofbookErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            definition_id: None,
            step_id: None,
            field: None,
            path: None,
        }
    }

    pub fn with_definition(mut self, id: impl Into<String>) -> Self {
        self.definition_id = Some(id.into());
        self
    }

    pub fn with_step(mut self, id: impl Into<String>) -> Self {
        self.step_id = Some(id.into());
        self
    }

    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn runtime_not_available(operation: &str) -> Self {
        Self::new(
            ProofbookErrorCode::RuntimeNotAvailable,
            format!("Proofbook runtime is not available in this build: {operation}"),
        )
    }
}

impl From<ProofbookError> for String {
    fn from(error: ProofbookError) -> Self {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proofbook_error_serializes_stable_code_and_camel_case_fields() {
        let error = ProofbookError::runtime_not_available("run")
            .with_definition("release-closeout")
            .with_step("status")
            .with_field("type");

        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], "runtime_not_available");
        assert_eq!(value["definitionId"], "release-closeout");
        assert_eq!(value["stepId"], "status");
        assert_eq!(value["field"], "type");
        assert!(value.get("path").is_none());
    }
}
