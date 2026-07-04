use crate::proofbook::{
    ProofbookDefinition, ProofbookError, ProofbookErrorCode, ProofbookStepKind,
    ProofbookValidationReport, PROOFBOOK_SCHEMA_V1,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

pub fn validate_definition(
    project_path: &str,
    definition: &ProofbookDefinition,
    path: &str,
) -> ProofbookValidationReport {
    let mut errors = Vec::new();
    let root = match canonical_project_root(project_path) {
        Ok(root) => Some(root),
        Err(error) => {
            errors.push(error);
            None
        }
    };

    if let Some(root) = root.as_deref() {
        if let Err(error) = ensure_path_under_root(root, path, "path") {
            errors.push(error);
        }
    }

    validate_schema(definition, &mut errors);
    validate_required_fields(definition, &mut errors);
    validate_identifiers(definition, &mut errors);
    validate_step_kinds(definition, &mut errors);
    validate_dependencies(definition, &mut errors);
    validate_settlement(definition, root.as_deref(), &mut errors);
    validate_secrets(definition, &mut errors);

    ProofbookValidationReport {
        definition_id: if definition.id.trim().is_empty() {
            None
        } else {
            Some(definition.id.clone())
        },
        path: path.to_string(),
        valid: errors.is_empty(),
        errors,
    }
}

pub(crate) fn canonical_project_root(project_path: &str) -> Result<PathBuf, ProofbookError> {
    let path = Path::new(project_path);
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::InvalidProjectPath,
            format!("invalid project path: {error}"),
        )
        .with_path(project_path)
    })?;
    if !canonical.is_dir() {
        return Err(ProofbookError::new(
            ProofbookErrorCode::InvalidProjectPath,
            "project path is not a directory",
        )
        .with_path(project_path));
    }
    Ok(canonical)
}

pub(crate) fn ensure_path_under_root(
    root: &Path,
    raw_path: &str,
    field: &str,
) -> Result<PathBuf, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };

    let resolved = match std::fs::canonicalize(&candidate) {
        Ok(path) => path,
        Err(_) => normalize_path_without_fs(&candidate),
    };

    if !resolved.starts_with(root) {
        return Err(ProofbookError::new(
            ProofbookErrorCode::PathOutsideProject,
            "proofbook path escapes the project root",
        )
        .with_field(field)
        .with_path(raw_path));
    }

    Ok(resolved)
}

fn normalize_path_without_fs(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

fn validate_schema(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    if definition.schema != PROOFBOOK_SCHEMA_V1 {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::UnsupportedSchemaVersion,
                format!(
                    "unsupported Proofbook schema version: {}",
                    definition.schema
                ),
            )
            .with_definition(definition.id.clone())
            .with_field("schema"),
        );
    }
}

fn validate_required_fields(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    if definition.id.trim().is_empty() {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::MissingRequiredField,
                "proofbook id is required",
            )
            .with_field("id"),
        );
    }
    if definition.steps.is_empty() {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::MissingRequiredField,
                "at least one proofbook step is required",
            )
            .with_definition(definition.id.clone())
            .with_field("steps"),
        );
    }
    for step in &definition.steps {
        if step.id.trim().is_empty() {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::MissingRequiredField,
                    "step id is required",
                )
                .with_definition(definition.id.clone())
                .with_field("steps.id"),
            );
        }
        if step.kind.trim().is_empty() {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::MissingRequiredField,
                    "step type is required",
                )
                .with_definition(definition.id.clone())
                .with_step(step.id.clone())
                .with_field("steps.type"),
            );
        }
    }
}

fn validate_identifiers(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    if !definition.id.trim().is_empty() && !is_valid_identifier(&definition.id) {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::InvalidIdentifier,
                "proofbook id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}",
            )
            .with_definition(definition.id.clone())
            .with_field("id"),
        );
    }

    let mut seen_steps = BTreeSet::new();
    for step in &definition.steps {
        if !step.id.trim().is_empty() && !is_valid_identifier(&step.id) {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::InvalidIdentifier,
                    "step id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}",
                )
                .with_definition(definition.id.clone())
                .with_step(step.id.clone())
                .with_field("steps.id"),
            );
        }
        if !step.id.trim().is_empty() && !seen_steps.insert(step.id.clone()) {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::DuplicateId,
                    format!("duplicate step id: {}", step.id),
                )
                .with_definition(definition.id.clone())
                .with_step(step.id.clone())
                .with_field("steps.id"),
            );
        }
    }

    for key in definition.inputs.keys() {
        if !is_valid_identifier(key) {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::InvalidIdentifier,
                    "input id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}",
                )
                .with_definition(definition.id.clone())
                .with_field(format!("inputs.{key}")),
            );
        }
    }
    for key in definition.secrets.keys() {
        if !is_valid_identifier(key) {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::InvalidIdentifier,
                    "secret id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}",
                )
                .with_definition(definition.id.clone())
                .with_field(format!("secrets.{key}")),
            );
        }
    }
}

fn is_valid_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if value.len() > 64 || !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn validate_step_kinds(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    for step in &definition.steps {
        if !step.kind.trim().is_empty() && ProofbookStepKind::from_wire(&step.kind).is_none() {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::UnknownStepType,
                    format!("unknown proofbook step type: {}", step.kind),
                )
                .with_definition(definition.id.clone())
                .with_step(step.id.clone())
                .with_field("steps.type"),
            );
        }
    }
}

fn validate_dependencies(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    let step_ids: BTreeSet<_> = definition
        .steps
        .iter()
        .filter(|step| !step.id.trim().is_empty())
        .map(|step| step.id.as_str())
        .collect();

    for step in &definition.steps {
        for dependency in &step.depends_on {
            if !step_ids.contains(dependency.as_str()) {
                errors.push(
                    ProofbookError::new(
                        ProofbookErrorCode::MissingDependency,
                        format!("step depends on missing step: {dependency}"),
                    )
                    .with_definition(definition.id.clone())
                    .with_step(step.id.clone())
                    .with_field("dependsOn"),
                );
            }
        }
    }

    if let Some(step_id) = first_cycle_step(definition) {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::CycleDetected,
                "proofbook step dependency graph contains a cycle",
            )
            .with_definition(definition.id.clone())
            .with_step(step_id)
            .with_field("dependsOn"),
        );
    }
}

fn first_cycle_step(definition: &ProofbookDefinition) -> Option<String> {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Mark {
        Visiting,
        Visited,
    }

    fn visit(
        id: &str,
        graph: &BTreeMap<&str, Vec<&str>>,
        marks: &mut BTreeMap<String, Mark>,
    ) -> Option<String> {
        if matches!(marks.get(id), Some(Mark::Visiting)) {
            return Some(id.to_string());
        }
        if matches!(marks.get(id), Some(Mark::Visited)) {
            return None;
        }
        marks.insert(id.to_string(), Mark::Visiting);
        if let Some(dependencies) = graph.get(id) {
            for dependency in dependencies {
                if let Some(cycle) = visit(dependency, graph, marks) {
                    return Some(cycle);
                }
            }
        }
        marks.insert(id.to_string(), Mark::Visited);
        None
    }

    let ids: BTreeSet<_> = definition
        .steps
        .iter()
        .map(|step| step.id.as_str())
        .collect();
    let graph: BTreeMap<_, _> = definition
        .steps
        .iter()
        .map(|step| {
            (
                step.id.as_str(),
                step.depends_on
                    .iter()
                    .map(String::as_str)
                    .filter(|dependency| ids.contains(dependency))
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    let mut marks = BTreeMap::new();
    for step in &definition.steps {
        if let Some(cycle) = visit(&step.id, &graph, &mut marks) {
            return Some(cycle);
        }
    }
    None
}

fn validate_settlement(
    definition: &ProofbookDefinition,
    root: Option<&Path>,
    errors: &mut Vec<ProofbookError>,
) {
    let Some(settlement) = definition.settlement.as_ref() else {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::MissingSettlement,
                "proofbook settlement is required",
            )
            .with_definition(definition.id.clone())
            .with_field("settlement"),
        );
        return;
    };

    if settlement.required_steps.is_empty() && settlement.required_artifacts.is_empty() {
        errors.push(
            ProofbookError::new(
                ProofbookErrorCode::MissingSettlement,
                "settlement must require at least one step or artifact",
            )
            .with_definition(definition.id.clone())
            .with_field("settlement"),
        );
    }

    let step_ids: BTreeSet<_> = definition
        .steps
        .iter()
        .map(|step| step.id.as_str())
        .collect();
    for required_step in &settlement.required_steps {
        if !step_ids.contains(required_step.as_str()) {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::MissingSettlement,
                    format!("settlement requires missing step: {required_step}"),
                )
                .with_definition(definition.id.clone())
                .with_step(required_step.clone())
                .with_field("settlement.requiredSteps"),
            );
        }
    }

    if let Some(root) = root {
        for artifact in &settlement.required_artifacts {
            if artifact.trim().is_empty() {
                errors.push(
                    ProofbookError::new(
                        ProofbookErrorCode::MissingRequiredField,
                        "settlement required artifact path is empty",
                    )
                    .with_definition(definition.id.clone())
                    .with_field("settlement.requiredArtifacts"),
                );
                continue;
            }
            if let Err(error) =
                ensure_path_under_root(root, artifact, "settlement.requiredArtifacts")
            {
                errors.push(error.with_definition(definition.id.clone()));
            }
        }
    }
}

fn validate_secrets(definition: &ProofbookDefinition, errors: &mut Vec<ProofbookError>) {
    for (name, secret) in &definition.secrets {
        let inline_value = secret.value.as_ref().is_some_and(contains_secret_literal);
        let malformed_reference = secret.provider.is_none() && secret.key.is_none();
        let suspicious_ref_text = secret
            .provider
            .as_deref()
            .is_some_and(looks_like_token_literal)
            || secret.key.as_deref().is_some_and(looks_like_token_literal);

        if secret.value.is_some() || inline_value || malformed_reference || suspicious_ref_text {
            errors.push(
                ProofbookError::new(
                    ProofbookErrorCode::InvalidSecretRef,
                    "secret must be a reference, not an inline value",
                )
                .with_definition(definition.id.clone())
                .with_field(format!("secrets.{name}")),
            );
        }
    }
}

fn contains_secret_literal(value: &serde_yaml::Value) -> bool {
    match value {
        serde_yaml::Value::String(text) => looks_like_token_literal(text),
        serde_yaml::Value::Sequence(items) => items.iter().any(contains_secret_literal),
        serde_yaml::Value::Mapping(map) => map.values().any(contains_secret_literal),
        _ => false,
    }
}

fn looks_like_token_literal(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.contains("-----BEGIN ")
        || lower.contains("private_key")
        || lower.contains("api_key")
        || lower.contains("access_token")
        || value.starts_with("sk-")
        || value.starts_with("ghp_")
        || value.starts_with("github_pat_")
        || value.starts_with("xoxb-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_proofbook(project: &Path, name: &str, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, yaml).unwrap();
        path.to_string_lossy().to_string()
    }

    fn validate_yaml(yaml: &str) -> ProofbookValidationReport {
        let temp = tempfile::tempdir().unwrap();
        let path = write_proofbook(temp.path(), "test.proofbook.yaml", yaml);
        let definition = crate::proofbook::parse_proofbook(&path).unwrap();
        validate_definition(&temp.path().to_string_lossy(), &definition, &path)
    }

    fn base_yaml(extra: &str, settlement: &str) -> String {
        format!(
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
title: Release closeout
steps:
  - id: status
    type: shell
{extra}
settlement:
{settlement}
"#
        )
    }

    fn error_codes(report: &ProofbookValidationReport) -> Vec<ProofbookErrorCode> {
        report.errors.iter().map(|error| error.code).collect()
    }

    #[test]
    fn proofbook_validator_accepts_valid_minimal_definition() {
        let report = validate_yaml(&base_yaml("", "  requiredSteps: [status]"));

        assert!(report.valid, "{:?}", report.errors);
        assert_eq!(report.definition_id.as_deref(), Some("release-closeout"));
    }

    #[test]
    fn proofbook_validator_rejects_unsupported_schema() {
        let report = validate_yaml(
            r#"
schema: aelyris.proofbook.v0
id: release-closeout
steps:
  - id: status
    type: shell
settlement:
  requiredSteps: [status]
"#,
        );

        assert!(error_codes(&report).contains(&ProofbookErrorCode::UnsupportedSchemaVersion));
    }

    #[test]
    fn proofbook_validator_rejects_unknown_step_type() {
        let report = validate_yaml(&base_yaml(
            "  - id: bogus\n    type: bogus\n",
            "  requiredSteps: [status]",
        ));

        assert!(error_codes(&report).contains(&ProofbookErrorCode::UnknownStepType));
    }

    #[test]
    fn proofbook_validator_rejects_duplicate_step_id() {
        let report = validate_yaml(&base_yaml(
            "  - id: status\n    type: verifier\n",
            "  requiredSteps: [status]",
        ));

        assert!(error_codes(&report).contains(&ProofbookErrorCode::DuplicateId));
    }

    #[test]
    fn proofbook_validator_rejects_missing_dependency() {
        let report = validate_yaml(&base_yaml(
            "  - id: docs\n    type: verifier\n    dependsOn: [missing]\n",
            "  requiredSteps: [docs]",
        ));

        assert!(error_codes(&report).contains(&ProofbookErrorCode::MissingDependency));
    }

    #[test]
    fn proofbook_validator_rejects_dependency_cycle() {
        let report = validate_yaml(
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
steps:
  - id: a
    type: shell
    dependsOn: [b]
  - id: b
    type: shell
    dependsOn: [a]
settlement:
  requiredSteps: [a]
"#,
        );

        assert!(error_codes(&report).contains(&ProofbookErrorCode::CycleDetected));
    }

    #[test]
    fn proofbook_validator_rejects_missing_or_empty_settlement() {
        let missing = validate_yaml(
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
steps:
  - id: status
    type: shell
"#,
        );
        assert!(error_codes(&missing).contains(&ProofbookErrorCode::MissingSettlement));

        let empty = validate_yaml(&base_yaml(
            "",
            "  requiredSteps: []\n  requiredArtifacts: []",
        ));
        assert!(error_codes(&empty).contains(&ProofbookErrorCode::MissingSettlement));
    }

    #[test]
    fn proofbook_validator_rejects_settlement_step_that_does_not_exist() {
        let report = validate_yaml(&base_yaml("", "  requiredSteps: [missing]"));

        assert!(error_codes(&report).contains(&ProofbookErrorCode::MissingSettlement));
    }

    #[test]
    fn proofbook_validator_rejects_invalid_identifiers() {
        let report = validate_yaml(
            r#"
schema: aelyris.proofbook.v1
id: -bad
steps:
  - id: "bad id"
    type: shell
settlement:
  requiredSteps: ["bad id"]
"#,
        );

        assert!(error_codes(&report).contains(&ProofbookErrorCode::InvalidIdentifier));
    }

    #[test]
    fn proofbook_validator_rejects_inline_secret_values() {
        let report = validate_yaml(
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
secrets:
  github_token:
    value: ghp_inlineToken
steps:
  - id: status
    type: shell
settlement:
  requiredSteps: [status]
"#,
        );

        assert!(error_codes(&report).contains(&ProofbookErrorCode::InvalidSecretRef));
    }

    #[test]
    fn proofbook_validator_rejects_artifact_path_outside_project() {
        let report = validate_yaml(&base_yaml("", "  requiredArtifacts: [../outside.txt]"));

        assert!(error_codes(&report).contains(&ProofbookErrorCode::PathOutsideProject));
    }

    #[test]
    fn proofbook_validator_rejects_invalid_project_root() {
        let temp = tempfile::tempdir().unwrap();
        let path = write_proofbook(
            temp.path(),
            "test.proofbook.yaml",
            &base_yaml("", "  requiredSteps: [status]"),
        );
        let definition = crate::proofbook::parse_proofbook(&path).unwrap();
        let missing_root = temp.path().join("missing");

        let report = validate_definition(&missing_root.to_string_lossy(), &definition, &path);

        assert!(error_codes(&report).contains(&ProofbookErrorCode::InvalidProjectPath));
    }
}
