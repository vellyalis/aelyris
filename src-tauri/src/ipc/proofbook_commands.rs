use crate::proofbook::{
    self, ProofbookError, ProofbookErrorCode, ProofbookSummary, ProofbookValidationReport,
};
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn list_proofbooks(project_path: String) -> Vec<ProofbookSummary> {
    proofbook::list_proofbook_files(&project_path)
}

#[tauri::command]
pub fn validate_proofbook(
    project_path: String,
    proofbook_path: String,
) -> Result<ProofbookValidationReport, ProofbookError> {
    let root = proofbook::validator::canonical_project_root(&project_path)?;
    let proofbook_path = resolve_candidate_path(&root, &proofbook_path)?;

    match proofbook::parse_proofbook(&proofbook_path) {
        Ok(definition) => Ok(proofbook::validate_definition(
            &project_path,
            &definition,
            &proofbook_path,
        )),
        Err(error) => Ok(ProofbookValidationReport {
            definition_id: None,
            path: proofbook_path,
            valid: false,
            errors: vec![error],
        }),
    }
}

fn resolve_candidate_path(root: &Path, raw_path: &str) -> Result<String, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    proofbook::validator::ensure_path_under_root(root, &candidate.to_string_lossy(), "path")?;
    Ok(normalize_path(&candidate))
}

fn normalize_path(path: &PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[allow(dead_code)]
fn proofbook_runtime_not_available(operation: &str) -> Result<(), ProofbookError> {
    Err(ProofbookError::runtime_not_available(operation))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_project_proofbook(project: &Path, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("release.proofbook.yaml");
        fs::write(&path, yaml).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn proofbook_ipc_validate_returns_structured_report() {
        let temp = tempfile::tempdir().unwrap();
        let path = write_project_proofbook(
            temp.path(),
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
steps:
  - id: status
    type: shell
settlement:
  requiredSteps: [status]
"#,
        );

        let report = validate_proofbook(temp.path().to_string_lossy().to_string(), path).unwrap();

        assert!(report.valid, "{:?}", report.errors);
        assert_eq!(report.definition_id.as_deref(), Some("release-closeout"));
    }

    #[test]
    fn proofbook_ipc_validate_folds_parse_errors_into_report() {
        let temp = tempfile::tempdir().unwrap();
        let path = write_project_proofbook(temp.path(), "schema: [");

        let report = validate_proofbook(temp.path().to_string_lossy().to_string(), path).unwrap();

        assert!(!report.valid);
        assert_eq!(report.errors[0].code, ProofbookErrorCode::YamlParseError);
    }

    #[test]
    fn proofbook_ipc_validate_rejects_path_escape_as_caller_error() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();

        let error = validate_proofbook(
            temp.path().to_string_lossy().to_string(),
            outside.path().to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::PathOutsideProject);
    }

    #[test]
    fn proofbook_ipc_runtime_boundary_is_fail_closed() {
        let error = proofbook_runtime_not_available("run").unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::RuntimeNotAvailable);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["code"],
            "runtime_not_available"
        );
    }
}
