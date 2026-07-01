use regex::Regex;
use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use crate::git::{ChangedFile, GitStatusInfo};
use crate::task::graph::Task;

pub const SUMMARY_SCHEMA: &str = "aelyris.session.v1";
const MAX_SUMMARY_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryDoc {
    pub schema: String,
    pub goal: String,
    pub current_task: SummaryCurrentTask,
    #[serde(deserialize_with = "deserialize_decisions")]
    pub decisions: Vec<SummaryDecision>,
    pub open_questions: Vec<String>,
    pub files: Vec<SummaryFile>,
    pub symbols: Vec<SummarySymbol>,
    pub in_flight_diff: InFlightDiffSummary,
    pub next_action: String,
    pub risks: Vec<SummaryRisk>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCurrentTask {
    pub id: String,
    pub status: String,
    pub subtasks: Vec<SummarySubtask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummarySubtask {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryDecision {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryFile {
    pub path: String,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummarySymbol {
    pub path: String,
    pub symbol: String,
    #[serde(default)]
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InFlightDiffSummary {
    pub present: bool,
    pub disposition: String,
    #[serde(default)]
    pub r#ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRisk {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub mitigation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummaryFiles {
    pub handoff_dir: PathBuf,
    pub summary_path: PathBuf,
    pub done_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactedSessionSummary {
    pub summary: SessionSummaryDoc,
    pub summary_json: Value,
    pub redaction_count: usize,
}

#[derive(Debug, Clone, Default)]
pub struct SummaryValidationContext {
    pub git_status: Option<GitStatusInfo>,
    pub tasks: Vec<Task>,
    pub decisions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryValidationReport {
    pub changed_files_checked: usize,
    pub task_checked: bool,
    pub decisions_checked: usize,
}

fn deserialize_decisions<'de, D>(deserializer: D) -> Result<Vec<SummaryDecision>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Array(items) => items
            .into_iter()
            .map(|item| serde_json::from_value(item).map_err(D::Error::custom))
            .collect(),
        Value::Object(entries) => Ok(entries
            .into_iter()
            .map(|(key, value)| SummaryDecision {
                key,
                value: value
                    .as_str()
                    .map(ToOwned::to_owned)
                    .or_else(|| (!value.is_null()).then(|| value.to_string())),
                summary: None,
            })
            .collect()),
        other => Err(D::Error::custom(format!(
            "decisions must be an array or object, got {other}"
        ))),
    }
}

pub fn handoff_dir(worktree_path: impl AsRef<Path>) -> PathBuf {
    worktree_path.as_ref().join(".aelyris").join("handoff")
}

pub fn sanitize_handoff_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "session".to_string()
    } else {
        out
    }
}

pub fn summary_files(
    worktree_path: impl AsRef<Path>,
    logical_session_id: &str,
    seq: u64,
) -> SessionSummaryFiles {
    let dir = handoff_dir(worktree_path);
    let stem = format!("{}.{}", sanitize_handoff_id(logical_session_id), seq);
    let summary_path = dir.join(format!("{stem}.json"));
    let done_path = dir.join(format!("{stem}.json.done"));
    SessionSummaryFiles {
        handoff_dir: dir,
        summary_path,
        done_path,
    }
}

pub fn canonical_summary_files_for_checkpoint(
    worktree_path: impl AsRef<Path>,
    logical_session_id: &str,
    seq: u64,
) -> Result<SessionSummaryFiles, String> {
    let files = summary_files(worktree_path, logical_session_id, seq);
    reject_parent_dir_components(&files.handoff_dir, "handoff_dir")?;
    reject_parent_dir_components(&files.summary_path, "summary_path")?;
    reject_parent_dir_components(&files.done_path, "done_path")?;
    let handoff_dir = files
        .handoff_dir
        .canonicalize()
        .map_err(|err| format!("canonicalize handoff_dir failed: {err}"))?;
    let summary_path = files
        .summary_path
        .canonicalize()
        .map_err(|err| format!("canonicalize summary_path failed: {err}"))?;
    let done_path = files
        .done_path
        .canonicalize()
        .map_err(|err| format!("canonicalize done_path failed: {err}"))?;
    ensure_under_handoff_dir(&summary_path, &handoff_dir, "summary_path")?;
    ensure_under_handoff_dir(&done_path, &handoff_dir, "done_path")?;
    Ok(SessionSummaryFiles {
        handoff_dir,
        summary_path,
        done_path,
    })
}

fn reject_parent_dir_components(path: &Path, label: &str) -> Result<(), String> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "{label} must not contain parent directory components"
        ));
    }
    Ok(())
}

fn ensure_under_handoff_dir(path: &Path, handoff_dir: &Path, label: &str) -> Result<(), String> {
    if path.starts_with(handoff_dir) {
        Ok(())
    } else {
        Err(format!(
            "{label} resolved outside .aelyris/handoff: {} not under {}",
            path.display(),
            handoff_dir.display()
        ))
    }
}
pub fn next_summary_seq(dir: impl AsRef<Path>, logical_session_id: &str) -> u64 {
    let prefix = format!("{}.", sanitize_handoff_id(logical_session_id));
    let Ok(entries) = fs::read_dir(dir) else {
        return 1;
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter_map(|name| {
            let rest = name.strip_prefix(&prefix)?.strip_suffix(".json")?;
            rest.parse::<u64>().ok()
        })
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

pub fn build_summary_prompt(
    logical_session_id: &str,
    seq: u64,
    files: &SessionSummaryFiles,
    reason: &str,
) -> String {
    format!(
        r#"Aelyris session_summarize request.
Reason: {reason}
Logical session: {logical_session_id}
Sequence: {seq}

When you are idle, write exactly one UTF-8 JSON file to:
{summary_path}

Then create this done marker only after the JSON write has fully completed:
{done_path}

Required schema:
{{
  "schema": "aelyris.session.v1",
  "goal": "current objective",
  "currentTask": {{ "id": "task id or unassigned", "status": "pending|ready|running|blocked|review|done|failed", "subtasks": [] }},
  "decisions": [{{ "key": "context-store-key", "value": "optional exact value", "summary": "why it matters" }}],
  "openQuestions": [],
  "files": [{{ "path": "repo/relative/path", "status": "modified|added|deleted|untracked|clean" }}],
  "symbols": [{{ "path": "repo/relative/path", "symbol": "name", "owner": "optional" }}],
  "inFlightDiff": {{ "present": false, "disposition": "clean", "ref": null }},
  "nextAction": "single concrete next action",
  "risks": [{{ "id": "risk-id", "title": "risk", "severity": "low|medium|high|critical", "mitigation": "next mitigation" }}]
}}

Redact credentials before writing. Do not put secret values, tokens, private keys, or passwords in the file.
"#,
        reason = reason,
        logical_session_id = logical_session_id,
        seq = seq,
        summary_path = files.summary_path.display(),
        done_path = files.done_path.display()
    )
}

pub fn read_redacted_summary(
    files: &SessionSummaryFiles,
    context: &SummaryValidationContext,
) -> Result<(RedactedSessionSummary, SummaryValidationReport), String> {
    if !files.done_path.is_file() {
        return Err(format!(
            "session summary done marker is missing: {}",
            files.done_path.display()
        ));
    }
    let metadata = fs::metadata(&files.summary_path)
        .map_err(|err| format!("session summary file missing or unreadable: {err}"))?;
    if metadata.len() > MAX_SUMMARY_BYTES {
        return Err(format!(
            "session summary file is too large: {} bytes > {}",
            metadata.len(),
            MAX_SUMMARY_BYTES
        ));
    }
    let raw = fs::read_to_string(&files.summary_path)
        .map_err(|err| format!("read session summary failed: {err}"))?;
    parse_redacted_summary(&raw, context)
}

pub fn parse_redacted_summary(
    raw: &str,
    context: &SummaryValidationContext,
) -> Result<(RedactedSessionSummary, SummaryValidationReport), String> {
    let redacted = redact_sensitive_text(raw);
    let summary_json: Value = serde_json::from_str(&redacted.text)
        .map_err(|err| format!("session summary JSON invalid after redaction: {err}"))?;
    let summary: SessionSummaryDoc = serde_json::from_value(summary_json.clone())
        .map_err(|err| format!("session summary schema invalid: {err}"))?;
    let report = validate_summary_doc(&summary, context)?;
    Ok((
        RedactedSessionSummary {
            summary,
            summary_json,
            redaction_count: redacted.count,
        },
        report,
    ))
}

pub fn validate_summary_doc(
    summary: &SessionSummaryDoc,
    context: &SummaryValidationContext,
) -> Result<SummaryValidationReport, String> {
    require_eq(summary.schema.trim(), SUMMARY_SCHEMA, "schema")?;
    require_nonempty(&summary.goal, "goal")?;
    require_nonempty(&summary.current_task.id, "currentTask.id")?;
    require_nonempty(&summary.current_task.status, "currentTask.status")?;
    require_nonempty(&summary.next_action, "nextAction")?;
    require_nonempty(
        &summary.in_flight_diff.disposition,
        "inFlightDiff.disposition",
    )?;
    validate_inflight(&summary.in_flight_diff)?;

    let changed_files_checked = validate_git_coverage(summary, context.git_status.as_ref())?;
    let task_checked = validate_task(summary, &context.tasks)?;
    let decisions_checked = validate_decisions(summary, &context.decisions)?;

    Ok(SummaryValidationReport {
        changed_files_checked,
        task_checked,
        decisions_checked,
    })
}

fn require_eq(actual: &str, expected: &str, label: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{label} must be {expected:?}, got {actual:?}"))
    }
}

fn require_nonempty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

fn validate_inflight(diff: &InFlightDiffSummary) -> Result<(), String> {
    let disposition = diff.disposition.trim().to_ascii_lowercase();
    if diff.present {
        if matches!(disposition.as_str(), "clean" | "none" | "not_present") {
            return Err("inFlightDiff.present=true cannot use a clean disposition".to_string());
        }
    } else if !matches!(disposition.as_str(), "clean" | "none" | "not_present") {
        return Err("inFlightDiff.present=false requires clean/none disposition".to_string());
    }
    Ok(())
}

fn validate_git_coverage(
    summary: &SessionSummaryDoc,
    status: Option<&GitStatusInfo>,
) -> Result<usize, String> {
    let Some(status) = status else {
        return Ok(0);
    };
    let changed: Vec<&ChangedFile> = status
        .changed_files
        .iter()
        .filter(|file| !is_handoff_or_ignored_runtime_file(&file.path))
        .collect();
    if changed.is_empty() {
        return Ok(0);
    }
    if !summary.in_flight_diff.present {
        return Err("git status is dirty but inFlightDiff.present is false".to_string());
    }

    let mentioned: HashSet<String> = summary
        .files
        .iter()
        .map(|file| normalize_repo_path(&file.path))
        .collect();
    let missing: Vec<String> = changed
        .iter()
        .map(|file| normalize_repo_path(&file.path))
        .filter(|path| !mentioned.contains(path))
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "session summary files omit dirty git paths: {}",
            missing.join(", ")
        ));
    }
    Ok(changed.len())
}

fn validate_task(summary: &SessionSummaryDoc, tasks: &[Task]) -> Result<bool, String> {
    if tasks.is_empty() {
        return Ok(false);
    }
    let task_id = summary.current_task.id.trim();
    if matches!(task_id, "unassigned" | "none" | "unknown") {
        return Ok(false);
    }
    let Some(task) = tasks.iter().find(|task| task.id == task_id) else {
        return Err(format!(
            "currentTask.id {task_id:?} is not in the Task graph"
        ));
    };
    if summary.current_task.status.trim() != task.status.as_str() {
        return Err(format!(
            "currentTask.status for {task_id} must match Task graph: {:?} != {:?}",
            summary.current_task.status,
            task.status.as_str()
        ));
    }
    Ok(true)
}

fn validate_decisions(
    summary: &SessionSummaryDoc,
    decisions: &BTreeMap<String, String>,
) -> Result<usize, String> {
    if decisions.is_empty() {
        return Ok(0);
    }
    let mut checked = 0usize;
    for decision in &summary.decisions {
        let Some(expected) = decisions.get(&decision.key) else {
            return Err(format!(
                "decision key {:?} is not present in ContextStore",
                decision.key
            ));
        };
        if let Some(value) = decision.value.as_deref() {
            if value != expected {
                return Err(format!(
                    "decision {:?} value does not match ContextStore",
                    decision.key
                ));
            }
        }
        checked = checked.saturating_add(1);
    }
    Ok(checked)
}

fn is_handoff_or_ignored_runtime_file(path: &str) -> bool {
    let normalized = normalize_repo_path(path);
    normalized.starts_with(".aelyris/handoff/") || normalized.starts_with(".codex-auto/")
}

fn normalize_repo_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .to_ascii_lowercase()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedactionResult {
    pub text: String,
    pub count: usize,
}

pub fn redact_sensitive_text(value: &str) -> RedactionResult {
    let mut text = value.to_string();
    let mut count = 0usize;
    let rules: &[(Regex, &str)] = &[
        (
            Regex::new(r"(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----")
                .expect("valid PEM redaction regex"),
            "[redacted:pem]",
        ),
        (
            Regex::new(r"(?i)\b(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/\-]+=*")
                .expect("valid bearer redaction regex"),
            "$1[redacted]",
        ),
        (
            Regex::new(r#"\b(AELYRIS_API_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|TOKEN|API_KEY|SECRET|PASSWORD)\s*=\s*("[^"]+"|'[^']+'|[^\s;&]+)"#)
                .expect("valid env redaction regex"),
            "$1=[redacted]",
        ),
        (
            Regex::new(r"\b(sk-[A-Za-z0-9_-]{8,})\b").expect("valid OpenAI key redaction regex"),
            "[redacted:api_key]",
        ),
        (
            Regex::new(r"\b(gh[pousr]_[A-Za-z0-9_]{8,})\b")
                .expect("valid GitHub token redaction regex"),
            "[redacted:token]",
        ),
        (
            Regex::new(r"\b(xox[baprs]-[A-Za-z0-9-]{8,})\b")
                .expect("valid Slack token redaction regex"),
            "[redacted:token]",
        ),
        (
            Regex::new(r"\b(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b")
                .expect("valid AWS key redaction regex"),
            "[redacted:aws_key]",
        ),
        (
            Regex::new(r"\bAIza[0-9A-Za-z\-_]{20,}\b").expect("valid Google API key regex"),
            "[redacted:gcp_key]",
        ),
        (
            Regex::new(r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
                .expect("valid JWT redaction regex"),
            "[redacted:jwt]",
        ),
        (
            Regex::new(r"(?i)\b([a-z][a-z0-9+.\-]*://)[^/@\s:]+:[^/@\s]+@")
                .expect("valid credential URI redaction regex"),
            "$1[redacted]@",
        ),
    ];

    for (pattern, replacement) in rules {
        let hits = pattern.find_iter(&text).count();
        if hits > 0 {
            text = pattern.replace_all(&text, *replacement).into_owned();
            count = count.saturating_add(hits);
        }
    }

    let high_entropy = Regex::new(r"\b[A-Za-z0-9+/=_-]{32,}\b").expect("valid high entropy regex");
    let mut entropy_hits = 0usize;
    text = high_entropy
        .replace_all(&text, |captures: &regex::Captures<'_>| {
            let candidate = captures.get(0).map(|m| m.as_str()).unwrap_or_default();
            if looks_like_secret_blob(candidate) {
                entropy_hits = entropy_hits.saturating_add(1);
                "[redacted:high_entropy]".to_string()
            } else {
                candidate.to_string()
            }
        })
        .into_owned();
    count = count.saturating_add(entropy_hits);

    RedactionResult { text, count }
}

fn looks_like_secret_blob(value: &str) -> bool {
    if value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return false;
    }
    let has_alpha = value.chars().any(|ch| ch.is_ascii_alphabetic());
    let has_digit = value.chars().any(|ch| ch.is_ascii_digit());
    has_alpha && has_digit && shannon_entropy(value) > 4.2
}

fn shannon_entropy(value: &str) -> f64 {
    if value.is_empty() {
        return 0.0;
    }
    let mut counts = [0usize; 256];
    for byte in value.bytes() {
        counts[byte as usize] += 1;
    }
    let len = value.len() as f64;
    counts
        .iter()
        .filter(|count| **count > 0)
        .map(|count| {
            let p = *count as f64 / len;
            -p * p.log2()
        })
        .sum()
}

pub async fn wait_for_done_marker(path: &Path, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if path.is_file() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!(
        "session summary timed out waiting for done marker: {}",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::status::TaskStatus;

    fn valid_summary_json() -> String {
        serde_json::json!({
            "schema": SUMMARY_SCHEMA,
            "goal": "Finish WU-RT-1",
            "currentTask": { "id": "task-1", "status": "running", "subtasks": [] },
            "decisions": { "runtime_boundary": "file_exchange" },
            "openQuestions": [],
            "files": [{ "path": "src/lib.rs", "status": "modified" }],
            "symbols": [{ "path": "src/lib.rs", "symbol": "run", "owner": "agent-a" }],
            "inFlightDiff": { "present": true, "disposition": "uncommitted", "ref": null },
            "nextAction": "Run the verifier.",
            "risks": [{ "id": "r1", "title": "restart gap", "severity": "high", "mitigation": "restore test" }]
        })
        .to_string()
    }

    fn dirty_status() -> GitStatusInfo {
        GitStatusInfo {
            branch: "main".to_string(),
            is_dirty: true,
            changed_files: vec![ChangedFile {
                path: "src/lib.rs".to_string(),
                status: "modified".to_string(),
                staged: false,
                conflicted: false,
                additions: 1,
                deletions: 0,
                binary: false,
            }],
            upstream: String::new(),
            ahead: 0,
            behind: 0,
        }
    }

    fn validation_context() -> SummaryValidationContext {
        let mut task = Task::new("task-1", "Task 1");
        task.status = TaskStatus::Running;
        let mut decisions = BTreeMap::new();
        decisions.insert("runtime_boundary".to_string(), "file_exchange".to_string());
        SummaryValidationContext {
            git_status: Some(dirty_status()),
            tasks: vec![task],
            decisions,
        }
    }

    #[test]
    fn parses_redacts_and_validates_summary_against_external_state() {
        let raw = valid_summary_json().replace(
            "Run the verifier.",
            "Run with OPENAI_API_KEY=sk-testsecret123456789 and then verify.",
        );
        let (redacted, report) = parse_redacted_summary(&raw, &validation_context()).unwrap();

        assert_eq!(redacted.summary.schema, SUMMARY_SCHEMA);
        assert_eq!(redacted.redaction_count, 1);
        assert!(!redacted.summary_json.to_string().contains("sk-testsecret"));
        assert_eq!(report.changed_files_checked, 1);
        assert!(report.task_checked);
        assert_eq!(report.decisions_checked, 1);
    }

    #[test]
    fn rejects_dirty_git_state_without_inflight_diff() {
        let raw = valid_summary_json().replace(
            r#""inFlightDiff":{"disposition":"uncommitted","present":true,"ref":null}"#,
            r#""inFlightDiff":{"disposition":"clean","present":false,"ref":null}"#,
        );
        let err = parse_redacted_summary(&raw, &validation_context()).unwrap_err();
        assert!(err.contains("git status is dirty"), "{err}");
    }

    #[test]
    fn rejects_dirty_git_paths_missing_from_summary_files() {
        let raw = valid_summary_json().replace("src/lib.rs", "src/other.rs");
        let err = parse_redacted_summary(&raw, &validation_context()).unwrap_err();
        assert!(err.contains("omit dirty git paths"), "{err}");
    }

    #[test]
    fn rejects_context_store_decision_mismatch() {
        let raw = valid_summary_json().replace("file_exchange", "raw_pty");
        let err = parse_redacted_summary(&raw, &validation_context()).unwrap_err();
        assert!(err.contains("does not match ContextStore"), "{err}");
    }

    #[test]
    fn redacts_pem_jwt_aws_gcp_uri_and_entropy_values() {
        let text = concat!(
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- ",
            "AKIAIOSFODNN7EXAMPLE ",
            "AIzaSyA1234567890abcdefghijklmnop ",
            "postgres://user:pass@example.test/db ",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aGVsbG93b3JsZHNlY3JldA ",
            "aW1wb3NzaWJsZV9sb29raW5nX3NlY3JldF8xMjM0NTY3ODkw"
        );
        let result = redact_sensitive_text(text);
        assert!(result.count >= 5, "count={}", result.count);
        assert!(!result.text.contains("PRIVATE KEY"));
        assert!(!result.text.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!result.text.contains("user:pass"));
        assert!(!result.text.contains("eyJhbGci"));
    }

    #[test]
    fn handoff_paths_are_sanitized_under_worktree() {
        let files = summary_files("C:/repo", "agent/one:two", 7);
        assert_eq!(
            files.summary_path,
            PathBuf::from("C:/repo")
                .join(".aelyris")
                .join("handoff")
                .join("agent_one_two.7.json")
        );
        assert!(files.done_path.ends_with("agent_one_two.7.json.done"));
    }

    #[test]
    fn checkpoint_summary_files_are_backend_built_and_canonical() {
        let temp = tempfile::tempdir().unwrap();
        let files = summary_files(temp.path(), "agent-1", 3);
        fs::create_dir_all(&files.handoff_dir).unwrap();
        fs::write(&files.summary_path, valid_summary_json()).unwrap();
        fs::write(&files.done_path, "done").unwrap();

        let canonical = canonical_summary_files_for_checkpoint(temp.path(), "agent-1", 3).unwrap();
        assert!(canonical.summary_path.starts_with(&canonical.handoff_dir));
        assert!(canonical.done_path.starts_with(&canonical.handoff_dir));
        assert!(canonical.summary_path.is_absolute());
    }

    #[test]
    fn checkpoint_summary_files_reject_parent_dir_components() {
        let err =
            canonical_summary_files_for_checkpoint("C:/repo/../evil", "agent-1", 1).unwrap_err();
        assert!(err.contains("parent directory"), "{err}");
    }

    #[test]
    fn checkpoint_summary_files_sanitize_parent_dir_session_id() {
        let files = summary_files("C:/repo", "../outside", 1);
        assert!(files.summary_path.starts_with(handoff_dir("C:/repo")));
        assert!(!files
            .summary_path
            .strip_prefix(handoff_dir("C:/repo"))
            .unwrap()
            .components()
            .any(|component| matches!(component, Component::ParentDir)));
    }

    #[test]
    fn checkpoint_summary_files_require_done_marker() {
        let temp = tempfile::tempdir().unwrap();
        let files = summary_files(temp.path(), "agent-1", 4);
        fs::create_dir_all(&files.handoff_dir).unwrap();
        fs::write(&files.summary_path, valid_summary_json()).unwrap();

        let err = canonical_summary_files_for_checkpoint(temp.path(), "agent-1", 4).unwrap_err();
        assert!(err.contains("canonicalize done_path failed"), "{err}");
    }
    #[test]
    fn prompt_names_file_exchange_contract() {
        let files = summary_files("C:/repo", "agent-1", 1);
        let prompt = build_summary_prompt("agent-1", 1, &files, "manual");
        assert!(prompt.contains(SUMMARY_SCHEMA));
        assert!(prompt.contains(".aelyris"));
        assert!(prompt.contains("done marker"));
        assert!(!prompt.contains("capture_pane"));
    }
}
