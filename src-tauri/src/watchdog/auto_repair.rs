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
use std::sync::mpsc;
use std::time::{Duration, Instant};

const MAX_CONCURRENT_JOBS: usize = 3;
const DEBOUNCE_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Current phase of a repair job (exposed for UI/status display).
#[derive(Debug, Clone, PartialEq)]
pub enum RepairPhase {
    CreatingWorktree,
    RunningAgent,
    RunningTests,
    Succeeded,
    Failed(String),
}

/// Captured error context from PTY output.
#[derive(Debug, Clone)]
pub struct ErrorContext {
    pub matched_line: String,
    pub source_pane: String,
}

/// Notification emitted by the pipeline for the UI layer.
#[derive(Debug, Clone)]
pub struct RepairNotification {
    pub job_id: String,
    pub message: String,
    pub is_success: bool,
}

/// Read-only snapshot of a job (for UI display).
#[derive(Debug, Clone)]
pub struct RepairJobInfo {
    pub id: String,
    pub phase: RepairPhase,
    pub branch: String,
    pub error_line: String,
    pub elapsed_secs: u64,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

struct RepairJob {
    id: String,
    phase: RepairPhase,
    branch: String,
    error_line: String,
    started_at: Instant,
}

enum WorkerMsg {
    PhaseChanged(String, RepairPhase),
    Done(String, RepairNotification),
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
    pub fn trigger(
        &mut self,
        error: ErrorContext,
        repo_path: &Path,
    ) -> Option<String> {
        let now = Instant::now();

        // Debounce: same error line within DEBOUNCE_SECS
        let key = debounce_key(&error.matched_line);
        if let Some(last) = self.debounce.get(&key) {
            if now.duration_since(*last) < Duration::from_secs(DEBOUNCE_SECS) {
                return None;
            }
        }

        // Capacity: limit concurrent active jobs
        let active = self
            .jobs
            .iter()
            .filter(|j| !matches!(j.phase, RepairPhase::Succeeded | RepairPhase::Failed(_)))
            .count();
        if active >= MAX_CONCURRENT_JOBS {
            return None;
        }

        self.debounce.insert(key, now);

        let id = format!("repair-{}", self.next_id);
        self.next_id += 1;
        let branch = format!("fix/auto-{}", short_hash(&error.matched_line));

        self.jobs.push(RepairJob {
            id: id.clone(),
            phase: RepairPhase::CreatingWorktree,
            branch: branch.clone(),
            error_line: error.matched_line.clone(),
            started_at: now,
        });

        // Launch background worker
        let tx = self.tx.clone();
        let repo = repo_path.to_path_buf();
        let job_id = id.clone();
        let error_clone = error;
        let branch_clone = branch;
        std::thread::Builder::new()
            .name(format!("auto-repair-{}", job_id))
            .spawn(move || {
                repair_worker(tx, job_id, repo, branch_clone, error_clone);
            })
            .ok();

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
                WorkerMsg::Done(job_id, notif) => {
                    if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
                        job.phase = if notif.is_success {
                            RepairPhase::Succeeded
                        } else {
                            RepairPhase::Failed(notif.message.clone())
                        };
                    }
                    notifications.push(notif);
                }
            }
        }

        // Prune completed jobs older than 5 minutes
        let cutoff = Instant::now() - Duration::from_secs(300);
        self.jobs.retain(|j| {
            j.started_at > cutoff
                || !matches!(j.phase, RepairPhase::Succeeded | RepairPhase::Failed(_))
        });

        // Prune stale debounce entries
        let debounce_cutoff = Instant::now() - Duration::from_secs(DEBOUNCE_SECS * 2);
        self.debounce.retain(|_, ts| *ts > debounce_cutoff);

        notifications
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
            })
            .collect()
    }

    /// Number of currently active (non-terminal) jobs.
    pub fn active_count(&self) -> usize {
        self.jobs
            .iter()
            .filter(|j| !matches!(j.phase, RepairPhase::Succeeded | RepairPhase::Failed(_)))
            .count()
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
) {
    // Step 1: Create worktree
    let worktree_path = match crate::git::create_worktree(
        &repo_path.to_string_lossy(),
        &branch,
    ) {
        Ok(info) => PathBuf::from(&info.path),
        Err(e) => {
            let _ = tx.send(WorkerMsg::Done(
                job_id,
                RepairNotification {
                    job_id: String::new(),
                    message: format!("Worktree creation failed: {}", e),
                    is_success: false,
                },
            ));
            return;
        }
    };

    // Step 2: Run AI agent
    let _ = tx.send(WorkerMsg::PhaseChanged(
        job_id.clone(),
        RepairPhase::RunningAgent,
    ));

    let prompt = build_agent_prompt(&error);
    let agent_result = std::process::Command::new("claude")
        .args(["-p", &prompt, "--output-format", "text"])
        .current_dir(&worktree_path)
        .output();

    let agent_ok = match agent_result {
        Ok(out) => out.status.success(),
        Err(_) => false,
    };

    if !agent_ok {
        cleanup_worktree(&repo_path, &branch);
        let _ = tx.send(WorkerMsg::Done(
            job_id.clone(),
            RepairNotification {
                job_id: job_id.clone(),
                message: "Auto-repair: agent could not fix the error".into(),
                is_success: false,
            },
        ));
        return;
    }

    // Step 3: Check if agent made any changes
    let has_changes = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&worktree_path)
        .output()
        .map(|out| {
            let text = String::from_utf8_lossy(&out.stdout);
            !text.trim().is_empty()
        })
        .unwrap_or(false);

    if !has_changes {
        cleanup_worktree(&repo_path, &branch);
        let _ = tx.send(WorkerMsg::Done(
            job_id.clone(),
            RepairNotification {
                job_id: job_id.clone(),
                message: "Auto-repair: agent found no changes to make".into(),
                is_success: false,
            },
        ));
        return;
    }

    // Commit the changes
    let _ = std::process::Command::new("git")
        .args(["add", "-A"])
        .current_dir(&worktree_path)
        .output();
    let commit_msg = format!("fix(auto-repair): {}", truncate(&error.matched_line, 72));
    let _ = std::process::Command::new("git")
        .args(["commit", "-m", &commit_msg])
        .current_dir(&worktree_path)
        .output();

    // Step 4: Run tests
    let _ = tx.send(WorkerMsg::PhaseChanged(
        job_id.clone(),
        RepairPhase::RunningTests,
    ));

    let test_passed = match detect_test_command(&worktree_path) {
        Some(cmd) => run_test_command(&worktree_path, &cmd),
        None => true, // No test command found — assume OK
    };

    if test_passed {
        let _ = tx.send(WorkerMsg::Done(
            job_id.clone(),
            RepairNotification {
                job_id: job_id.clone(),
                message: format!(
                    "Auto-repair succeeded! Branch: {}. Review and merge.",
                    branch
                ),
                is_success: true,
            },
        ));
    } else {
        let _ = tx.send(WorkerMsg::Done(
            job_id.clone(),
            RepairNotification {
                job_id: job_id.clone(),
                message: format!(
                    "Auto-repair: fix applied but tests failed. Branch: {}",
                    branch
                ),
                is_success: false,
            },
        ));
    }
}

/// Clean up a worktree on failure (best-effort).
fn cleanup_worktree(repo_path: &Path, branch: &str) {
    let _ = crate::git::remove_worktree(
        &repo_path.to_string_lossy(),
        branch,
        true,
    );
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

/// Run a test command and return whether it passed.
fn run_test_command(cwd: &Path, cmd: &TestCommand) -> bool {
    std::process::Command::new(&cmd.program)
        .args(&cmd.args)
        .current_dir(cwd)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
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

    /// Helper: create a temp dir with a marker file.
    fn tempdir_with_file(filename: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(filename), "").unwrap();
        dir
    }
}
