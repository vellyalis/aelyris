//! Auto-repair pipeline — autonomous error detection → fix → test → notify.
//!
//! Flow:
//! 1. PTY output triggers a pane_watcher rule (error pattern match)
//! 2. `AutoRepairManager::trigger()` creates an isolated worktree
//! 3. AI agent (`claude -p`) runs in the worktree to investigate and fix
//! 4. Tests run to verify the fix
//! 5. User is notified via toast with the result
//!
//! All heavy work runs in a single background thread per job.
//! The main loop calls `poll()` each frame to collect notifications.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const MAX_CONCURRENT_JOBS: usize = 3;
const DEBOUNCE_SECS: u64 = 60;
const AGENT_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const TEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const COMMAND_OUTPUT_LIMIT: usize = 1024 * 1024;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Current phase of a repair job (exposed for UI/status display).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum RepairPhase {
    CreatingWorktree,
    RunningAgent,
    RunningTests,
    Cancelling,
    Succeeded,
    Failed(String),
    TimedOut(String),
    Cancelled(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RepairOutcome {
    Succeeded { branch: String },
    Failed { code: String, message: String },
    TimedOut { stage: String, message: String },
    Cancelled { stage: String, message: String },
}

/// Captured error context from PTY output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorContext {
    pub matched_line: String,
    pub source_pane: String,
}

/// Notification emitted by the pipeline for the UI layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepairNotification {
    pub job_id: String,
    pub message: String,
    pub is_success: bool,
    pub outcome: RepairOutcome,
}

/// Read-only snapshot of a job (for UI display).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairJobInfo {
    pub id: String,
    pub phase: RepairPhase,
    pub branch: String,
    pub error_line: String,
    pub elapsed_secs: u64,
    /// Main repo path the job was triggered against. Needed so listeners
    /// (e.g. ghostdiff) can predict the worktree path without duplicating
    /// the naming rule.
    pub repo_path: String,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

struct RepairJob {
    id: String,
    phase: RepairPhase,
    branch: String,
    error_line: String,
    repo_path: String,
    started_at: Instant,
    cancellation: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

enum WorkerMsg {
    PhaseChanged(String, RepairPhase),
    Done(String, RepairOutcome),
}

fn is_terminal(phase: &RepairPhase) -> bool {
    matches!(
        phase,
        RepairPhase::Succeeded
            | RepairPhase::Failed(_)
            | RepairPhase::TimedOut(_)
            | RepairPhase::Cancelled(_)
    )
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/// Manages the auto-repair pipeline.
pub struct AutoRepairManager {
    jobs: Vec<RepairJob>,
    rx: mpsc::Receiver<WorkerMsg>,
    tx: mpsc::Sender<WorkerMsg>,
    next_id: u32,
    debounce: HashMap<u64, Instant>,
}

impl AutoRepairManager {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            jobs: Vec::new(),
            rx,
            tx,
            next_id: 0,
            debounce: HashMap::new(),
        }
    }

    /// Start a repair job for a detected error.
    ///
    /// Returns the job ID if accepted, or `None` if debounced or at capacity.
    pub fn trigger(&mut self, error: ErrorContext, repo_path: &Path) -> Option<String> {
        let now = Instant::now();

        // Debounce: same error line within DEBOUNCE_SECS
        let key = debounce_key(&error.matched_line);
        if let Some(last) = self.debounce.get(&key) {
            if now.duration_since(*last) < Duration::from_secs(DEBOUNCE_SECS) {
                log::debug!(
                    "auto-repair debounced (same error within {}s): {}",
                    DEBOUNCE_SECS,
                    error.matched_line.chars().take(80).collect::<String>(),
                );
                return None;
            }
        }

        // Capacity: limit concurrent active jobs
        let active = self.jobs.iter().filter(|j| !is_terminal(&j.phase)).count();
        if active >= MAX_CONCURRENT_JOBS {
            log::warn!(
                "auto-repair at capacity ({}/{}), dropping new trigger: {}",
                active,
                MAX_CONCURRENT_JOBS,
                error.matched_line.chars().take(80).collect::<String>(),
            );
            return None;
        }

        self.debounce.insert(key, now);

        let id = format!("repair-{}", self.next_id);
        self.next_id += 1;
        let branch = format!("fix/auto-{}", short_hash(&error.matched_line));
        log::info!(
            "auto-repair trigger id={} branch={} line={}",
            id,
            branch,
            error.matched_line.chars().take(80).collect::<String>(),
        );

        let cancellation = Arc::new(AtomicBool::new(false));
        self.jobs.push(RepairJob {
            id: id.clone(),
            phase: RepairPhase::CreatingWorktree,
            branch: branch.clone(),
            error_line: error.matched_line.clone(),
            repo_path: repo_path.to_string_lossy().to_string(),
            started_at: now,
            cancellation: cancellation.clone(),
            worker: None,
        });

        // Launch background worker
        let tx = self.tx.clone();
        let repo = repo_path.to_path_buf();
        let job_id = id.clone();
        let error_clone = error;
        let branch_clone = branch;
        let spawned = std::thread::Builder::new()
            .name(format!("auto-repair-{}", job_id))
            .spawn(move || {
                repair_worker(tx, job_id, repo, branch_clone, error_clone, cancellation);
            });
        match spawned {
            Ok(worker) => self.jobs.last_mut().expect("job inserted").worker = Some(worker),
            Err(error) => {
                self.jobs.last_mut().expect("job inserted").phase =
                    RepairPhase::Failed(error.to_string());
                let _ = self.tx.send(WorkerMsg::Done(
                    id.clone(),
                    RepairOutcome::Failed {
                        code: "worker-spawn".into(),
                        message: format!("Auto-repair worker could not start: {error}"),
                    },
                ));
            }
        }

        Some(id)
    }

    /// Poll for progress updates. Call once per frame from the event loop.
    ///
    /// Returns notifications that should be shown to the user (via toast).
    pub fn poll(&mut self) -> Vec<RepairNotification> {
        let mut notifications = Vec::new();

        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                WorkerMsg::PhaseChanged(job_id, phase) => {
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
                        job.phase = phase;
                    }
                }
                WorkerMsg::Done(job_id, outcome) => {
                    let notif = notification(&job_id, outcome.clone());
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
                        job.phase = match &outcome {
                            RepairOutcome::Succeeded { .. } => RepairPhase::Succeeded,
                            RepairOutcome::Failed { message, .. } => {
                                RepairPhase::Failed(message.clone())
                            }
                            RepairOutcome::TimedOut { message, .. } => {
                                RepairPhase::TimedOut(message.clone())
                            }
                            RepairOutcome::Cancelled { message, .. } => {
                                RepairPhase::Cancelled(message.clone())
                            }
                        };
                    }
                    if notif.is_success {
                        log::info!("auto-repair success id={} msg={}", job_id, notif.message);
                    } else {
                        log::warn!("auto-repair failed id={} msg={}", job_id, notif.message);
                    }
                    notifications.push(notif);
                }
            }
        }

        for job in &mut self.jobs {
            if job.worker.as_ref().is_some_and(JoinHandle::is_finished) {
                if let Some(worker) = job.worker.take() {
                    let _ = worker.join();
                }
            }
        }

        // Prune completed jobs older than 5 minutes
        let cutoff = Instant::now() - Duration::from_secs(300);
        self.jobs
            .retain(|j| j.started_at > cutoff || !is_terminal(&j.phase) || j.worker.is_some());

        // Prune stale debounce entries
        let debounce_cutoff = Instant::now() - Duration::from_secs(DEBOUNCE_SECS * 2);
        self.debounce.retain(|_, ts| *ts > debounce_cutoff);

        notifications
    }

    pub fn cancel(&mut self, job_id: &str) -> Result<(), String> {
        let job = self
            .jobs
            .iter_mut()
            .find(|job| job.id == job_id)
            .ok_or_else(|| format!("repair job not found: {job_id}"))?;
        if is_terminal(&job.phase) {
            return Err(format!("repair job is already terminal: {job_id}"));
        }
        job.cancellation.store(true, Ordering::Release);
        job.phase = RepairPhase::Cancelling;
        Ok(())
    }

    /// Snapshot of all active/recent jobs (for UI display).
    pub fn jobs(&self) -> Vec<RepairJobInfo> {
        self.jobs
            .iter()
            .map(|j| RepairJobInfo {
                id: j.id.clone(),
                phase: j.phase.clone(),
                branch: j.branch.clone(),
                error_line: j.error_line.clone(),
                elapsed_secs: j.started_at.elapsed().as_secs(),
                repo_path: j.repo_path.clone(),
            })
            .collect()
    }

    /// Number of currently active (non-terminal) jobs.
    pub fn active_count(&self) -> usize {
        self.jobs.iter().filter(|j| !is_terminal(&j.phase)).count()
    }
}

impl Drop for AutoRepairManager {
    fn drop(&mut self) {
        for job in &self.jobs {
            job.cancellation.store(true, Ordering::Release);
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline
            && self
                .jobs
                .iter()
                .any(|j| j.worker.as_ref().is_some_and(|w| !w.is_finished()))
        {
            std::thread::sleep(Duration::from_millis(20));
        }
        for job in &mut self.jobs {
            if job.worker.as_ref().is_some_and(JoinHandle::is_finished) {
                if let Some(worker) = job.worker.take() {
                    let _ = worker.join();
                }
            } else if job.worker.is_some() {
                log::warn!(
                    "auto-repair worker did not stop before manager drop: {}",
                    job.id
                );
            }
        }
    }
}

impl Default for AutoRepairManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

/// Runs the full repair pipeline in a background thread.
///
/// Steps: create worktree → run agent → check changes → run tests → report.
fn repair_worker(
    tx: mpsc::Sender<WorkerMsg>,
    job_id: String,
    repo_path: PathBuf,
    branch: String,
    error: ErrorContext,
    cancellation: Arc<AtomicBool>,
) {
    let outcome = repair_worker_inner(&tx, &job_id, &repo_path, &branch, &error, &cancellation);
    let _ = tx.send(WorkerMsg::Done(job_id, outcome));
}

fn repair_worker_inner(
    tx: &mpsc::Sender<WorkerMsg>,
    job_id: &str,
    repo_path: &Path,
    branch: &str,
    error: &ErrorContext,
    cancellation: &Arc<AtomicBool>,
) -> RepairOutcome {
    let worktree_path = match create_worktree_bounded(repo_path, branch, cancellation) {
        Ok(path) => path,
        Err(outcome) => return outcome,
    };

    // Step 2: Run AI agent
    let _ = tx.send(WorkerMsg::PhaseChanged(
        job_id.to_string(),
        RepairPhase::RunningAgent,
    ));

    let prompt = build_agent_prompt(&error);
    let agent_program = crate::agent::platform_cli_program("claude");
    let mut agent_command = crate::process::hidden_command(agent_program);
    agent_command
        .args(["-p", &prompt, "--output-format", "text"])
        .current_dir(&worktree_path);
    let agent_result = run_bounded_command(
        &mut agent_command,
        AGENT_TIMEOUT,
        Some(cancellation.clone()),
    );
    if !command_passed(agent_result.as_ref().ok()) {
        cleanup_worktree(repo_path, branch);
        return command_outcome("agent", agent_result.as_ref());
    }

    // Step 3: Check if agent made any changes
    let mut status_command = crate::process::hidden_command("git");
    status_command
        .args(["status", "--porcelain"])
        .current_dir(&worktree_path);
    let status_result =
        run_bounded_command(&mut status_command, GIT_TIMEOUT, Some(cancellation.clone()));
    let has_changes = status_result
        .as_ref()
        .map_err(|error| error)
        .map(|out| {
            if !command_passed(Some(&out)) {
                return false;
            }
            let text = String::from_utf8_lossy(&out.stdout_tail);
            !text.trim().is_empty()
        })
        .unwrap_or(false);

    if !has_changes {
        cleanup_worktree(repo_path, branch);
        if !command_passed(status_result.as_ref().ok()) {
            return command_outcome("git-status", status_result.as_ref());
        }
        return RepairOutcome::Failed {
            code: "no-changes".into(),
            message: "Auto-repair: agent found no changes to make".into(),
        };
    }

    // Commit the changes
    let mut add_command = crate::process::hidden_command("git");
    add_command.args(["add", "-A"]).current_dir(&worktree_path);
    let add_result = run_bounded_command(&mut add_command, GIT_TIMEOUT, Some(cancellation.clone()));
    if !command_passed(add_result.as_ref().ok()) {
        cleanup_worktree(repo_path, branch);
        return command_outcome("git-add", add_result.as_ref());
    }
    let commit_msg = format!("fix(auto-repair): {}", truncate(&error.matched_line, 72));
    let mut commit_command = crate::process::hidden_command("git");
    commit_command
        .args(["commit", "-m", &commit_msg])
        .current_dir(&worktree_path);
    let commit_result =
        run_bounded_command(&mut commit_command, GIT_TIMEOUT, Some(cancellation.clone()));
    if !command_passed(commit_result.as_ref().ok()) {
        cleanup_worktree(repo_path, branch);
        return command_outcome("git-commit", commit_result.as_ref());
    }

    // Step 4: Run tests
    let _ = tx.send(WorkerMsg::PhaseChanged(
        job_id.to_string(),
        RepairPhase::RunningTests,
    ));

    let test_passed = match detect_test_command(&worktree_path) {
        Some(cmd) => {
            let mut command = crate::process::hidden_command(&cmd.program);
            command.args(&cmd.args).current_dir(&worktree_path);
            let result =
                run_bounded_command(&mut command, TEST_TIMEOUT, Some(cancellation.clone()));
            if !command_passed(result.as_ref().ok()) {
                cleanup_worktree(repo_path, branch);
                return command_outcome("tests", result.as_ref());
            }
            true
        }
        None => true,
    };

    if test_passed {
        RepairOutcome::Succeeded {
            branch: branch.to_string(),
        }
    } else {
        cleanup_worktree(repo_path, branch);
        RepairOutcome::Failed {
            code: "tests-failed".into(),
            message: format!("Auto-repair: fix applied but tests failed. Branch: {branch}"),
        }
    }
}

/// Clean up a worktree on failure (best-effort).
fn cleanup_worktree(repo_path: &Path, branch: &str) {
    let path = crate::git::predict_worktree_path(&repo_path.to_string_lossy(), branch);
    for args in [
        vec![
            "worktree",
            "remove",
            path.to_string_lossy().as_ref(),
            "--force",
        ],
        vec!["worktree", "prune"],
    ] {
        let mut command = crate::process::hidden_command("git");
        command.args(args).current_dir(repo_path);
        let _ = run_bounded_command(&mut command, GIT_TIMEOUT, None);
    }
    let mut command = crate::process::hidden_command("git");
    command
        .args(["branch", "-D", branch])
        .current_dir(repo_path);
    let _ = run_bounded_command(&mut command, GIT_TIMEOUT, None);
}

fn create_worktree_bounded(
    repo_path: &Path,
    branch: &str,
    cancellation: &Arc<AtomicBool>,
) -> Result<PathBuf, RepairOutcome> {
    crate::git::validate_branch_name(branch).map_err(|message| RepairOutcome::Failed {
        code: "invalid-branch".into(),
        message,
    })?;
    let path = crate::git::predict_worktree_path(&repo_path.to_string_lossy(), branch);
    let path_text = path.to_string_lossy().to_string();
    let mut command = crate::process::hidden_command("git");
    command
        .args(["worktree", "add", &path_text, "-b", branch])
        .current_dir(repo_path);
    let result = run_bounded_command(&mut command, GIT_TIMEOUT, Some(cancellation.clone()));
    if command_passed(result.as_ref().ok()) {
        Ok(path)
    } else {
        Err(command_outcome("create-worktree", result.as_ref()))
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without side effects)
// ---------------------------------------------------------------------------

/// Build the prompt sent to the AI agent.
pub(crate) fn build_agent_prompt(error: &ErrorContext) -> String {
    format!(
        "An error was detected in terminal pane '{}':\n\n\
         ```\n{}\n```\n\n\
         Investigate the root cause and apply a fix. \
         Do NOT commit — just modify the necessary files.",
        error.source_pane, error.matched_line
    )
}

/// Detect the project's test command from common config files.
pub(crate) fn detect_test_command(project_root: &Path) -> Option<TestCommand> {
    // Rust
    if project_root.join("Cargo.toml").exists() {
        return Some(TestCommand {
            program: "cargo".into(),
            args: vec!["test".into()],
        });
    }
    // Node.js
    if project_root.join("package.json").exists() {
        return Some(TestCommand {
            program: "npm".into(),
            args: vec!["test".into(), "--".into(), "--passWithNoTests".into()],
        });
    }
    // Python
    if project_root.join("pyproject.toml").exists()
        || project_root.join("setup.py").exists()
        || project_root.join("pytest.ini").exists()
    {
        return Some(TestCommand {
            program: "pytest".into(),
            args: vec![],
        });
    }
    // Go
    if project_root.join("go.mod").exists() {
        return Some(TestCommand {
            program: "go".into(),
            args: vec!["test".into(), "./...".into()],
        });
    }
    None
}

/// Test command descriptor.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TestCommand {
    pub program: String,
    pub args: Vec<String>,
}

fn run_bounded_command(
    command: &mut std::process::Command,
    deadline: Duration,
    cancellation: Option<Arc<AtomicBool>>,
) -> std::io::Result<crate::process::SupervisedCommandOutput> {
    crate::process::run_supervised(
        command,
        &crate::process::SupervisedCommandConfig {
            deadline,
            output_limit_bytes: COMMAND_OUTPUT_LIMIT,
            cancellation,
        },
    )
}

fn command_outcome(
    stage: &str,
    result: Result<&crate::process::SupervisedCommandOutput, &std::io::Error>,
) -> RepairOutcome {
    let message = format!(
        "Auto-repair {stage} failed ({})",
        command_failure_kind(result)
    );
    match result {
        Ok(output) if output.status == crate::process::SupervisedCommandStatus::TimedOut => {
            RepairOutcome::TimedOut {
                stage: stage.into(),
                message,
            }
        }
        Ok(output) if output.status == crate::process::SupervisedCommandStatus::Cancelled => {
            RepairOutcome::Cancelled {
                stage: stage.into(),
                message,
            }
        }
        Err(_) => RepairOutcome::Failed {
            code: "spawn-error".into(),
            message,
        },
        _ => RepairOutcome::Failed {
            code: "nonzero-exit".into(),
            message,
        },
    }
}

fn notification(job_id: &str, outcome: RepairOutcome) -> RepairNotification {
    let (message, is_success) = match &outcome {
        RepairOutcome::Succeeded { branch } => (
            format!("Auto-repair succeeded! Branch: {branch}. Review and merge."),
            true,
        ),
        RepairOutcome::Failed { message, .. }
        | RepairOutcome::TimedOut { message, .. }
        | RepairOutcome::Cancelled { message, .. } => (message.clone(), false),
    };
    RepairNotification {
        job_id: job_id.into(),
        message,
        is_success,
        outcome,
    }
}

fn command_passed(output: Option<&crate::process::SupervisedCommandOutput>) -> bool {
    output.is_some_and(|output| {
        output.status == crate::process::SupervisedCommandStatus::Exited
            && output.exit_code == Some(0)
    })
}

fn command_failure_kind(
    result: Result<&crate::process::SupervisedCommandOutput, &std::io::Error>,
) -> &'static str {
    match result {
        Err(_) => "spawn-error",
        Ok(output) => match output.status {
            crate::process::SupervisedCommandStatus::TimedOut => "timeout",
            crate::process::SupervisedCommandStatus::Cancelled => "cancelled",
            crate::process::SupervisedCommandStatus::Exited if output.exit_code == Some(0) => {
                "passed"
            }
            crate::process::SupervisedCommandStatus::Exited => "nonzero-exit",
        },
    }
}

/// FNV-style hash for debounce keys.
fn debounce_key(line: &str) -> u64 {
    let normalized = line.trim().to_lowercase();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

/// Short 8-char hex hash for branch names.
fn short_hash(line: &str) -> String {
    let full = debounce_key(line);
    format!("{:08x}", full as u32)
}

/// Truncate a string to a maximum byte length, appending "..." if cut.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let end = s
            .char_indices()
            .take_while(|(i, _)| *i + 3 <= max)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);
        format!("{}...", &s[..end])
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_debounce_key_stable() {
        let a = debounce_key("error: cannot find module");
        let b = debounce_key("error: cannot find module");
        assert_eq!(a, b);
    }

    #[test]
    fn test_debounce_key_case_insensitive() {
        let a = debounce_key("Error: Cannot Find Module");
        let b = debounce_key("error: cannot find module");
        assert_eq!(a, b);
    }

    #[test]
    fn test_debounce_key_trims_whitespace() {
        let a = debounce_key("  error: foo  ");
        let b = debounce_key("error: foo");
        assert_eq!(a, b);
    }

    #[test]
    fn test_debounce_key_different_errors_differ() {
        let a = debounce_key("error: foo");
        let b = debounce_key("error: bar");
        assert_ne!(a, b);
    }

    #[test]
    fn test_short_hash_length() {
        let h = short_hash("some error message");
        assert_eq!(h.len(), 8);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_short_hash_deterministic() {
        let a = short_hash("error: foo");
        let b = short_hash("error: foo");
        assert_eq!(a, b);
    }

    #[test]
    fn test_truncate_short_string() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_exact_length() {
        assert_eq!(truncate("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_long_string() {
        let result = truncate("a]very long error message here", 15);
        assert!(result.ends_with("..."));
        assert!(result.len() <= 18); // 15 content + 3 dots max
    }

    #[test]
    fn test_truncate_multibyte() {
        // Japanese text: each char is 3 bytes
        let result = truncate("エラーが発生しました", 12);
        assert!(result.ends_with("..."));
        // Should not panic or split a codepoint
    }

    #[test]
    fn test_build_agent_prompt_contains_error() {
        let ctx = ErrorContext {
            matched_line: "FATAL: database connection refused".into(),
            source_pane: "server".into(),
        };
        let prompt = build_agent_prompt(&ctx);
        assert!(prompt.contains("database connection refused"));
        assert!(prompt.contains("server"));
        assert!(prompt.contains("Do NOT commit"));
    }

    #[test]
    fn test_detect_test_command_rust() {
        let dir = tempdir_with_file("Cargo.toml");
        let cmd = detect_test_command(dir.path()).unwrap();
        assert_eq!(cmd.program, "cargo");
        assert_eq!(cmd.args, vec!["test"]);
    }

    #[test]
    fn test_detect_test_command_node() {
        let dir = tempdir_with_file("package.json");
        let cmd = detect_test_command(dir.path()).unwrap();
        assert_eq!(cmd.program, "npm");
    }

    #[test]
    fn test_detect_test_command_python() {
        let dir = tempdir_with_file("pyproject.toml");
        let cmd = detect_test_command(dir.path()).unwrap();
        assert_eq!(cmd.program, "pytest");
    }

    #[test]
    fn test_detect_test_command_go() {
        let dir = tempdir_with_file("go.mod");
        let cmd = detect_test_command(dir.path()).unwrap();
        assert_eq!(cmd.program, "go");
    }

    #[test]
    fn test_detect_test_command_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert!(detect_test_command(dir.path()).is_none());
    }

    #[test]
    fn test_manager_debounce() {
        let mut mgr = AutoRepairManager::new();
        let repo = PathBuf::from("/nonexistent"); // won't actually run

        let ctx = ErrorContext {
            matched_line: "error: foo".into(),
            source_pane: "t1".into(),
        };

        // First trigger: accepted (worker will fail, but trigger returns Some)
        let r1 = mgr.trigger(ctx.clone(), &repo);
        assert!(r1.is_some());

        // Second trigger: debounced
        let r2 = mgr.trigger(ctx.clone(), &repo);
        assert!(r2.is_none());
    }

    #[test]
    fn test_manager_capacity_limit() {
        let mut mgr = AutoRepairManager::new();
        let repo = PathBuf::from("/nonexistent");

        for i in 0..MAX_CONCURRENT_JOBS {
            let ctx = ErrorContext {
                matched_line: format!("error-{}", i),
                source_pane: "t1".into(),
            };
            assert!(mgr.trigger(ctx, &repo).is_some());
        }

        // Next one should be rejected
        let ctx = ErrorContext {
            matched_line: "error-overflow".into(),
            source_pane: "t1".into(),
        };
        assert!(mgr.trigger(ctx, &repo).is_none());
    }

    #[test]
    fn test_manager_active_count() {
        let mgr = AutoRepairManager::new();
        assert_eq!(mgr.active_count(), 0);
    }

    #[test]
    fn test_manager_jobs_snapshot() {
        let mgr = AutoRepairManager::new();
        assert!(mgr.jobs().is_empty());
    }

    #[test]
    fn test_supervisor_cancellation_is_typed() {
        let cancellation = Arc::new(AtomicBool::new(true));
        let mut command = crate::process::hidden_command("cmd.exe");
        command.args(["/C", "ping -n 30 127.0.0.1 >NUL"]);
        let result = run_bounded_command(&mut command, Duration::from_secs(5), Some(cancellation));
        assert!(matches!(
            command_outcome("test", result.as_ref()),
            RepairOutcome::Cancelled { .. }
        ));
    }

    #[test]
    fn test_supervisor_timeout_is_typed() {
        let mut command = crate::process::hidden_command("cmd.exe");
        command.args(["/C", "ping -n 30 127.0.0.1 >NUL"]);
        let result = run_bounded_command(&mut command, Duration::from_millis(50), None);
        assert!(matches!(
            command_outcome("test", result.as_ref()),
            RepairOutcome::TimedOut { .. }
        ));
    }

    #[test]
    fn test_cancel_sets_owned_token_and_phase() {
        let mut mgr = AutoRepairManager::new();
        let cancellation = Arc::new(AtomicBool::new(false));
        mgr.jobs.push(RepairJob {
            id: "repair-test".into(),
            phase: RepairPhase::RunningAgent,
            branch: "fix/test".into(),
            error_line: "error".into(),
            repo_path: String::new(),
            started_at: Instant::now(),
            cancellation: cancellation.clone(),
            worker: None,
        });
        mgr.cancel("repair-test").unwrap();
        assert!(cancellation.load(Ordering::Acquire));
        assert_eq!(mgr.jobs[0].phase, RepairPhase::Cancelling);
        assert!(mgr.cancel("missing").is_err());
    }

    #[test]
    fn test_notification_preserves_typed_outcome() {
        let outcome = RepairOutcome::TimedOut {
            stage: "tests".into(),
            message: "deadline".into(),
        };
        let notification = notification("repair-1", outcome.clone());
        assert!(!notification.is_success);
        assert_eq!(notification.outcome, outcome);
    }

    /// Helper: create a temp dir with a marker file.
    fn tempdir_with_file(filename: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(filename), "").unwrap();
        dir
    }
}
