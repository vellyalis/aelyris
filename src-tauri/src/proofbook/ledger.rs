use crate::proofbook::{ProofbookDefinition, ProofbookError, ProofbookErrorCode, ProofbookStep};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PROOFBOOK_RUN_SCHEMA_V1: &str = "aelyris.proofbook_run.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofbookStepStatus {
    Pending,
    Running,
    Passed,
    Failed,
    Skipped,
    WaitingGate,
    Blocked,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofbookRunStatus {
    Pending,
    Running,
    WaitingGate,
    Passed,
    Failed,
    #[serde(rename = "blocked-by-policy")]
    BlockedByPolicy,
    #[serde(rename = "blocked-by-external-gates")]
    BlockedByExternalGates,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookRunError {
    pub code: String,
    pub message: String,
}

impl ProofbookRunError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookArtifactRef {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub redaction_count: usize,
    pub step_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookGateDecision {
    pub gate_id: String,
    pub gate_hash: String,
    pub step_id: String,
    pub decision: String,
    pub actor: String,
    pub comment: String,
    pub decided_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookResidualBlocker {
    pub code: String,
    pub step_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookRunEvent {
    pub id: String,
    pub at: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub step_id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<ProofbookRunError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookStepSummary {
    pub step_id: String,
    pub kind: String,
    pub status: ProofbookStepStatus,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub duration_ms: Option<u64>,
    pub attempt: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stdout_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub stderr_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub structured_output: Option<serde_json::Value>,
    #[serde(default)]
    pub artifact_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub gate_decision: Option<ProofbookGateDecision>,
    pub redaction_count: usize,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub risk: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<ProofbookRunError>,
}

impl ProofbookStepSummary {
    pub fn pending(step: &ProofbookStep) -> Self {
        Self {
            step_id: step.id.clone(),
            kind: step.kind.clone(),
            status: ProofbookStepStatus::Pending,
            started_at: None,
            completed_at: None,
            duration_ms: None,
            attempt: 0,
            stdout_ref: None,
            stderr_ref: None,
            exit_code: None,
            structured_output: None,
            artifact_refs: Vec::new(),
            gate_decision: None,
            redaction_count: 0,
            risk: None,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookRunLedger {
    pub schema: String,
    pub run_id: String,
    pub proofbook_id: String,
    pub project_path: String,
    pub definition_path: String,
    pub status: ProofbookRunStatus,
    pub started_at: String,
    pub updated_at: String,
    pub definition_hash: String,
    pub input_hash: String,
    pub events: Vec<ProofbookRunEvent>,
    pub steps: Vec<ProofbookStepSummary>,
    pub artifacts: Vec<ProofbookArtifactRef>,
    pub decisions: Vec<ProofbookGateDecision>,
    pub residual_blockers: Vec<ProofbookResidualBlocker>,
}

impl ProofbookRunLedger {
    pub fn step_mut(&mut self, step_id: &str) -> Option<&mut ProofbookStepSummary> {
        self.steps.iter_mut().find(|step| step.step_id == step_id)
    }

    pub fn step(&self, step_id: &str) -> Option<&ProofbookStepSummary> {
        self.steps.iter().find(|step| step.step_id == step_id)
    }

    pub fn append_event(
        &mut self,
        kind: impl Into<String>,
        step_id: Option<String>,
        message: impl Into<String>,
        status: Option<String>,
        error: Option<ProofbookRunError>,
    ) {
        self.updated_at = now_timestamp();
        self.events.push(ProofbookRunEvent {
            id: format!("evt-{:04}", self.events.len() + 1),
            at: self.updated_at.clone(),
            kind: kind.into(),
            step_id,
            message: message.into(),
            status,
            error,
        });
    }
}

pub fn new_run_ledger(
    project_root: &Path,
    definition_path: &str,
    definition: &ProofbookDefinition,
    inputs: &serde_json::Value,
) -> Result<ProofbookRunLedger, ProofbookError> {
    let definition_hash = hash_json(definition)?;
    let input_hash = hash_json(inputs)?;
    let run_id = deterministic_run_id(&definition.id, &definition_hash, &input_hash);
    let now = now_timestamp();
    let mut ledger = ProofbookRunLedger {
        schema: PROOFBOOK_RUN_SCHEMA_V1.to_string(),
        run_id,
        proofbook_id: definition.id.clone(),
        project_path: normalize_path(project_root),
        definition_path: definition_path.to_string(),
        status: ProofbookRunStatus::Pending,
        started_at: now.clone(),
        updated_at: now,
        definition_hash,
        input_hash,
        events: Vec::new(),
        steps: definition
            .steps
            .iter()
            .map(ProofbookStepSummary::pending)
            .collect(),
        artifacts: Vec::new(),
        decisions: Vec::new(),
        residual_blockers: Vec::new(),
    };
    ledger.append_event(
        "run_created",
        None,
        "Proofbook run ledger created before step execution",
        Some("pending".to_string()),
        None,
    );
    Ok(ledger)
}

pub fn now_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0);
    millis.to_string()
}

pub fn duration_ms(started_at: &Option<String>, completed_at: &str) -> Option<u64> {
    let start = started_at.as_deref()?.parse::<u64>().ok()?;
    let end = completed_at.parse::<u64>().ok()?;
    Some(end.saturating_sub(start))
}

pub fn deterministic_run_id(proofbook_id: &str, definition_hash: &str, input_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(proofbook_id.as_bytes());
    hasher.update(definition_hash.as_bytes());
    hasher.update(input_hash.as_bytes());
    let digest = hex_digest(&hasher.finalize());
    format!("pb-run-{}-{}", sanitize_id(proofbook_id), &digest[..12])
}

pub fn hash_json<T: Serialize>(value: &T) -> Result<String, ProofbookError> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::IoError,
            format!("cannot serialize proofbook hash input: {error}"),
        )
    })?;
    Ok(format!("sha256:{}", hash_bytes(&bytes)))
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex_digest(&digest)
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn sanitize_id(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "proofbook".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}

pub fn runs_dir(project_root: &Path) -> PathBuf {
    project_root.join(".aelyris").join("proofbook-runs")
}

pub fn artifacts_dir(project_root: &Path, run_id: &str) -> PathBuf {
    runs_dir(project_root).join("artifacts").join(run_id)
}

pub fn ledger_path(project_root: &Path, run_id: &str) -> PathBuf {
    runs_dir(project_root).join(format!("{run_id}.json"))
}

pub fn write_ledger(
    project_root: &Path,
    ledger: &ProofbookRunLedger,
) -> Result<(), ProofbookError> {
    let path = ledger_path(project_root, &ledger.run_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| io_error("create proofbook run dir", error))?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(ledger).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::IoError,
            format!("cannot serialize proofbook run ledger: {error}"),
        )
    })?;
    fs::write(&tmp_path, format!("{content}\n"))
        .map_err(|error| io_error("write proofbook run ledger", error))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| io_error("replace proofbook run ledger", error))?;
    }
    fs::rename(&tmp_path, &path).map_err(|error| io_error("commit proofbook run ledger", error))?;
    Ok(())
}

pub fn read_ledger(path: &Path) -> Result<ProofbookRunLedger, ProofbookError> {
    let content =
        fs::read_to_string(path).map_err(|error| io_error("read proofbook run ledger", error))?;
    serde_json::from_str(&content).map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::YamlParseError,
            format!("cannot parse proofbook run ledger JSON: {error}"),
        )
        .with_path(normalize_path(path))
    })
}

pub fn list_ledgers(project_root: &Path) -> Result<Vec<ProofbookRunLedger>, ProofbookError> {
    let dir = runs_dir(project_root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut ledgers = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| io_error("read proofbook runs dir", error))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        if let Ok(ledger) = read_ledger(&path) {
            ledgers.push(ledger);
        }
    }
    ledgers.sort_by(|a, b| {
        a.started_at
            .cmp(&b.started_at)
            .then(a.run_id.cmp(&b.run_id))
    });
    Ok(ledgers)
}

pub fn write_text_artifact(
    project_root: &Path,
    run_id: &str,
    step_id: &str,
    kind: &str,
    text: &str,
) -> Result<ProofbookArtifactRef, ProofbookError> {
    let (redacted, redaction_count) = redact_persisted_text(text);
    write_bytes_artifact(
        project_root,
        run_id,
        step_id,
        kind,
        redacted.as_bytes(),
        redaction_count,
    )
}

pub fn record_existing_artifact(
    project_root: &Path,
    step_id: &str,
    kind: &str,
    artifact_path: &Path,
) -> Result<ProofbookArtifactRef, ProofbookError> {
    let bytes = fs::read(artifact_path)
        .map_err(|error| io_error("read expected proofbook artifact", error))?;
    let relative = artifact_path
        .strip_prefix(project_root)
        .ok()
        .map(normalize_path)
        .unwrap_or_else(|| normalize_path(artifact_path));
    let artifact_id = format!(
        "artifact-{step_id}-{kind}-{}",
        &hash_bytes(relative.as_bytes())[..8]
    );
    Ok(ProofbookArtifactRef {
        id: artifact_id,
        path: relative,
        kind: kind.to_string(),
        size_bytes: bytes.len() as u64,
        sha256: format!("sha256:{}", hash_bytes(&bytes)),
        redaction_count: 0,
        step_id: step_id.to_string(),
    })
}

fn write_bytes_artifact(
    project_root: &Path,
    run_id: &str,
    step_id: &str,
    kind: &str,
    bytes: &[u8],
    redaction_count: usize,
) -> Result<ProofbookArtifactRef, ProofbookError> {
    let dir = artifacts_dir(project_root, run_id);
    fs::create_dir_all(&dir).map_err(|error| io_error("create proofbook artifact dir", error))?;
    let file_name = format!("{}-{}.txt", sanitize_id(step_id), sanitize_id(kind));
    let path = dir.join(file_name);
    fs::write(&path, bytes).map_err(|error| io_error("write proofbook artifact", error))?;
    let relative = path
        .strip_prefix(project_root)
        .ok()
        .map(normalize_path)
        .unwrap_or_else(|| normalize_path(&path));
    let artifact_id = format!(
        "artifact-{step_id}-{kind}-{}",
        &hash_bytes(relative.as_bytes())[..8]
    );
    Ok(ProofbookArtifactRef {
        id: artifact_id,
        path: relative,
        kind: kind.to_string(),
        size_bytes: bytes.len() as u64,
        sha256: format!("sha256:{}", hash_bytes(bytes)),
        redaction_count,
        step_id: step_id.to_string(),
    })
}

pub fn redact_persisted_text(text: &str) -> (String, usize) {
    let redacted = crate::command_risk::redact_sensitive_command(text);
    let count = usize::from(redacted != text);
    (redacted, count)
}

pub fn normalize_path(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().replace('\\', "/")
}

fn io_error(action: &str, error: std::io::Error) -> ProofbookError {
    ProofbookError::new(ProofbookErrorCode::IoError, format!("{action}: {error}"))
}

#[derive(Debug, Clone)]
pub struct ProofbookStepOutcome {
    pub status: ProofbookStepStatus,
    pub stdout_ref: Option<String>,
    pub stderr_ref: Option<String>,
    pub exit_code: Option<i32>,
    pub structured_output: Option<serde_json::Value>,
    pub artifact_refs: Vec<String>,
    pub artifacts: Vec<ProofbookArtifactRef>,
    pub redaction_count: usize,
    pub risk: Option<serde_json::Value>,
    pub error: Option<ProofbookRunError>,
}

impl ProofbookStepOutcome {
    pub fn passed() -> Self {
        Self {
            status: ProofbookStepStatus::Passed,
            stdout_ref: None,
            stderr_ref: None,
            exit_code: None,
            structured_output: None,
            artifact_refs: Vec::new(),
            artifacts: Vec::new(),
            redaction_count: 0,
            risk: None,
            error: None,
        }
    }

    pub fn failed(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: ProofbookStepStatus::Failed,
            error: Some(ProofbookRunError::new(code, message)),
            ..Self::passed()
        }
    }

    pub fn blocked(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: ProofbookStepStatus::Blocked,
            error: Some(ProofbookRunError::new(code, message)),
            ..Self::passed()
        }
    }

    pub fn waiting_gate(output: serde_json::Value, risk: Option<serde_json::Value>) -> Self {
        Self {
            status: ProofbookStepStatus::WaitingGate,
            structured_output: Some(output),
            risk,
            ..Self::passed()
        }
    }
}
