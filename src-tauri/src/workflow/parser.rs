use super::types::Workflow;
use std::path::Path;

/// Parse a workflow YAML file
pub fn parse_workflow(yaml_path: &str) -> Result<Workflow, String> {
    let content = std::fs::read_to_string(yaml_path)
        .map_err(|e| format!("Failed to read workflow file: {}", e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse workflow YAML: {}", e))
}

/// List all workflow files in a project's .aether/workflows/ directory
pub fn list_workflow_files(project_path: &str) -> Vec<WorkflowSummary> {
    let dir = Path::new(project_path).join(".aether").join("workflows");
    if !dir.exists() {
        return Vec::new();
    }

    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .map(|e| e == "yaml" || e == "yml")
                .unwrap_or(false)
            {
                match parse_workflow(&path.to_string_lossy()) {
                    Ok(wf) => results.push(WorkflowSummary {
                        name: wf.name,
                        description: wf.description,
                        path: path.to_string_lossy().to_string().replace('\\', "/"),
                        phase_count: wf.phases.len(),
                    }),
                    Err(_) => {} // skip invalid files
                }
            }
        }
    }
    results
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkflowSummary {
    pub name: String,
    pub description: String,
    pub path: String,
    pub phase_count: usize,
}
