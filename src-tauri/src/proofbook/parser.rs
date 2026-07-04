use crate::proofbook::{ProofbookDefinition, ProofbookError, ProofbookErrorCode, ProofbookSummary};
use std::path::Path;

pub fn parse_proofbook(path: &str) -> Result<ProofbookDefinition, ProofbookError> {
    let content = std::fs::read_to_string(path).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::IoError,
            format!("cannot read proofbook: {error}"),
        )
        .with_path(path)
    })?;

    serde_yaml::from_str::<ProofbookDefinition>(&content).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::YamlParseError,
            format!("cannot parse proofbook YAML: {error}"),
        )
        .with_path(path)
    })
}

pub fn list_proofbook_files(project_path: &str) -> Vec<ProofbookSummary> {
    let dir = Path::new(project_path).join(".aelyris").join("proofbooks");
    if !dir.exists() {
        return Vec::new();
    }

    let mut summaries = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return summaries;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_proofbook_file(&path) {
            continue;
        }

        let path_string = normalize_path_for_json(&path);
        match parse_proofbook(&path_string) {
            Ok(definition) => {
                let report =
                    crate::proofbook::validate_definition(project_path, &definition, &path_string);
                summaries.push(ProofbookSummary {
                    id: definition.id,
                    title: definition.title,
                    path: path_string,
                    step_count: definition.steps.len(),
                    valid: report.valid,
                    error_count: report.errors.len(),
                });
            }
            Err(_) => summaries.push(ProofbookSummary {
                id: String::new(),
                title: String::new(),
                path: path_string,
                step_count: 0,
                valid: false,
                error_count: 1,
            }),
        }
    }

    summaries.sort_by(|a, b| a.path.cmp(&b.path));
    summaries
}

fn is_proofbook_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".proofbook.yaml") || name.ends_with(".proofbook.yml"))
        .unwrap_or(false)
}

pub(crate) fn normalize_path_for_json(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn valid_yaml(id: &str) -> String {
        format!(
            r#"
schema: aelyris.proofbook.v1
id: {id}
title: {id}
steps:
  - id: status
    type: shell
settlement:
  requiredSteps: [status]
"#
        )
    }

    #[test]
    fn proofbook_parser_discovers_yaml_and_yml_under_project_directory_only() {
        let temp = tempfile::tempdir().unwrap();
        let proofbook_dir = temp.path().join(".aelyris").join("proofbooks");
        fs::create_dir_all(&proofbook_dir).unwrap();
        fs::write(
            proofbook_dir.join("release.proofbook.yaml"),
            valid_yaml("release"),
        )
        .unwrap();
        fs::write(
            proofbook_dir.join("smoke.proofbook.yml"),
            valid_yaml("smoke"),
        )
        .unwrap();
        fs::write(proofbook_dir.join("ignored.yaml"), valid_yaml("ignored")).unwrap();

        let summaries = list_proofbook_files(&temp.path().to_string_lossy());

        assert_eq!(summaries.len(), 2);
        assert!(summaries.iter().all(|summary| summary.valid));
        assert!(summaries
            .iter()
            .all(|summary| summary.path.contains("/.aelyris/proofbooks/")));
        assert!(summaries.iter().any(|summary| summary.id == "release"));
        assert!(summaries.iter().any(|summary| summary.id == "smoke"));
    }

    #[test]
    fn proofbook_parser_maps_yaml_errors_to_typed_errors() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("bad.proofbook.yaml");
        fs::write(&path, "schema: [").unwrap();

        let error = parse_proofbook(&path.to_string_lossy()).unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::YamlParseError);
        assert!(error.path.is_some());
    }
}
