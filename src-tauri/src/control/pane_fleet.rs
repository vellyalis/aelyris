//! Visible-pane agent runtime — the loop's dispatch backend that spawns each
//! task's implementer in a **real, visible PTY pane** (1 pane = 1 agent) instead
//! of an invisible headless child (`agent::AgentManager`).
//!
//! This is the integration of the two agent runtimes the cockpit audit flagged:
//! the autonomy loop previously dispatched `claude -p` as a hidden subprocess
//! drained to a sink, so nothing showed on screen. `PaneFleet` dispatches the
//! same work through `PtyManager`, yielding a terminal id the frontend can mount
//! as a fleet-grid pane, while still giving the loop the completion + recovery
//! signal it needs.
//!
//! Ownership is clean: the PTY itself is owned by `PtyManager`; this registry
//! owns only (a) the `task_id -> terminal_id` map (persistent across loop steps,
//! unlike the per-step `LoopPortsAdapter`) and (b) the per-pane exit observation.
//! A dedicated waiter thread per pane takes the child handle and records its exit
//! once, so `poll_completions` can split finished panes the same way
//! `AgentManager::reap` splits headless exits: a **clean exit (code 0)** is a
//! `succeeded` task (-> review), a **non-zero exit** is a `failed` task (->
//! recovery), and a pane that never exits past the wall-clock budget is
//! `timed_out` (-> killed + recovery). See
//! docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md (BR9).

use std::collections::{hash_map::DefaultHasher, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::orchestrator::autonomy::Completions;
use crate::pty::PtyManager;

/// Backward-compatible output-file fallback window for legacy agents that do not
/// know the explicit done-marker contract yet. Marker files are still the
/// primary completion signal; output files alone must stay stable long enough to
/// avoid killing an agent after its first save.
const OUTPUTS_FALLBACK_GRACE_SECS: u64 = 30;
const PANE_IDLE_CAPTURE_LINES: usize = 20;

/// Current Unix epoch in seconds, for each pane's wall-clock start stamp.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Record a pane as failed (non-zero exit) in its exit slot so the loop's next
/// poll recovers the task — used when no waiter thread can observe the real exit.
fn mark_failed(exit: &Arc<Mutex<Option<bool>>>) {
    if let Ok(mut slot) = exit.lock() {
        *slot = Some(false);
    }
}

/// Relative marker path injected into loop-dispatched visible agents. The task id
/// is sanitized by the session-lifecycle helper used for handoff files so the
/// agent never controls a path component.
pub(crate) fn done_marker_relative_path(task_id: &str, terminal_id: &str) -> String {
    format!(
        ".aelyris/done/{}-{}.done",
        crate::agent::session_lifecycle::sanitize_handoff_id(task_id),
        terminal_id
    )
}

/// Absolute marker path under the pane worktree. The path is backend-built from a
/// fixed directory plus a sanitized file name; no user-supplied marker path is
/// trusted.
pub(crate) fn done_marker_path(worktree_path: &str, task_id: &str, terminal_id: &str) -> PathBuf {
    Path::new(worktree_path)
        .join(".aelyris")
        .join("done")
        .join(format!(
            "{}-{}.done",
            crate::agent::session_lifecycle::sanitize_handoff_id(task_id),
            terminal_id
        ))
}

fn output_signature(output: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    output.hash(&mut hasher);
    hasher.finish()
}

/// One dispatched pane: the visible terminal running its agent, when it started
/// (for the hang budget), and a slot the waiter thread fills with the exit
/// outcome (`Some(succeeded)` once the process exits; `None` while running).
struct PaneRun {
    terminal_id: String,
    started_at: u64,
    /// `Some(true)` = clean exit (code 0); `Some(false)` = non-zero exit / wait
    /// failure; `None` = still running. Written once by the waiter thread.
    exit: Arc<Mutex<Option<bool>>>,
    /// The agent's worktree (its cwd), the task's declared output paths relative
    /// to it, and the explicit done marker the agent is instructed to create as
    /// its last action. The marker is the primary completion signal for visible
    /// TUI agents that do not exit; outputs are only a delayed fallback.
    worktree_path: String,
    outputs: Vec<String>,
    done_marker_path: PathBuf,
    outputs_ready_since: Option<u64>,
    last_output_signature: Option<u64>,
    output_idle_since: Option<u64>,
}

/// Whether every declared output path exists under the worktree. Empty `outputs`
/// is NOT "ready" — the caller must guard that so a task declaring no outputs is
/// not reported done the instant it is dispatched. This is only the legacy
/// fallback; the explicit done marker wins.
fn outputs_present(worktree_path: &str, outputs: &[String]) -> bool {
    let root = Path::new(worktree_path);
    // `is_file`, not `exists`: a declared output is a work-product FILE. `exists`
    // also returns true for a directory, so an agent that creates an output dir
    // (e.g. `dist/`) before writing into it would be reported done — and its TUI
    // killed — the instant the directory appears, before any content lands. A bare
    // file is the structural "produced it" signal.
    outputs.iter().all(|rel| root.join(rel).is_file())
}

/// Persistent registry mapping each loop task to its visible PTY pane and
/// observing pane exits for the loop's completion sensor. Clone-cheap (Arc-backed
/// like `PtyManager`/`AgentManager`) so it can be shared as Tauri managed state.
#[derive(Clone)]
pub struct PaneFleet {
    pty: PtyManager,
    runs: Arc<Mutex<HashMap<String, PaneRun>>>,
}

impl PaneFleet {
    pub fn new(pty: PtyManager) -> Self {
        Self {
            pty,
            runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn `program args` in a fresh visible PTY pane for `task_id`, take its
    /// child handle onto a waiter thread that records the exit outcome, and
    /// register the `task_id -> terminal_id` binding. Returns the terminal id so
    /// the caller can announce it for the fleet grid. The command/env are
    /// resolved by the caller (the loop's `PaneDispatcher` builds them from the
    /// task's model + prompt) so this stays a pure runtime concern.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        task_id: &str,
        program: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: &str,
        env: HashMap<String, String>,
        outputs: Vec<String>,
    ) -> Result<String, String> {
        let terminal_id =
            self.pty
                .spawn_command(program, args, cols, rows, Some(cwd), Some(env))?;

        self.register_spawned_pane(task_id, &terminal_id, cwd, outputs)?;
        Ok(terminal_id)
    }

    /// Same as [`spawn`] but the caller chooses the terminal id before command
    /// construction. Visible loop dispatch uses this to inject the exact
    /// collision-proof completion marker path into the agent prompt.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_with_terminal_id(
        &self,
        terminal_id: &str,
        task_id: &str,
        program: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: &str,
        env: HashMap<String, String>,
        outputs: Vec<String>,
    ) -> Result<String, String> {
        self.pty.spawn_command_with_id(
            terminal_id,
            program,
            args,
            cols,
            rows,
            Some(cwd),
            Some(env),
        )?;
        self.register_spawned_pane(task_id, terminal_id, cwd, outputs)?;
        Ok(terminal_id.to_string())
    }

    fn register_spawned_pane(
        &self,
        task_id: &str,
        terminal_id: &str,
        cwd: &str,
        outputs: Vec<String>,
    ) -> Result<(), String> {
        let exit = Arc::new(Mutex::new(None));
        match self.pty.take_child(terminal_id) {
            Some(mut child) => {
                let slot = exit.clone();
                // Owns the child: `wait()` blocks until the agent process exits,
                // then records `success()` — exit code 0 vs non-zero — matching
                // `AgentManager::reap`'s split so the loop recovers a crashed
                // worker. (`ExitInfo::crashed` is a UI crash-banner heuristic
                // that treats exit 1 as "clean", which is the wrong split here.)
                let waiter = std::thread::Builder::new()
                    .name(format!("pane-waiter-{terminal_id}"))
                    .spawn(move || {
                        let succeeded = match child.wait() {
                            Ok(status) => status.success(),
                            Err(_) => false,
                        };
                        if let Ok(mut slot) = slot.lock() {
                            *slot = Some(succeeded);
                        }
                    });
                if waiter.is_err() {
                    // No waiter thread => the exit would never be observed and the
                    // task would wait out the full hang timeout. Mark it failed now
                    // so the loop recovers it promptly.
                    mark_failed(&exit);
                }
            }
            None => {
                // The child was already taken/gone right after spawn (should not
                // happen — we are the sole owner). Mark it failed so the loop
                // recovers the task rather than waiting forever on a pane whose
                // exit will never be observed.
                mark_failed(&exit);
            }
        }

        // Register the pane so poll_completions can report it. Recover a poisoned
        // lock (a prior panic) rather than dropping the task on the floor — a
        // dispatched task that never lands in the map would be stranded in
        // Running forever (the C-22 strand the loop must never allow).
        let mut runs = self
            .runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        runs.insert(
            task_id.to_string(),
            PaneRun {
                terminal_id: terminal_id.to_string(),
                started_at: now_secs(),
                exit,
                worktree_path: cwd.to_string(),
                outputs,
                done_marker_path: done_marker_path(cwd, task_id, terminal_id),
                outputs_ready_since: None,
                last_output_signature: None,
                output_idle_since: None,
            },
        );
        Ok(())
    }

    /// The visible terminal id dispatched for `task_id`, if it is still tracked.
    /// Used by the IPC face to announce the pane (`AgentSpawned`) and mount it.
    pub fn terminal_of(&self, task_id: &str) -> Option<String> {
        self.runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(task_id)
            .map(|run| run.terminal_id.clone())
    }

    /// Completion sensor (BR9): which dispatched panes finished since the last
    /// poll, split by exit outcome, plus panes hung past `timeout_secs` of
    /// wall-clock (killed here). Finished panes are reaped from `PtyManager` and
    /// hung panes are closed; every reported task leaves the registry so it is
    /// surfaced at most once. `now` is injected so the budget boundary is
    /// testable. Mirrors `AgentManager::reap` + `reap_timed_out` for the visible
    /// runtime.
    pub fn poll_completions(&self, timeout_secs: u64, now: u64) -> Completions {
        // Snapshot the observable state (owned) UNDER the lock, then release it
        // before the pure classify + the `outputs_present` filesystem stats. Holding
        // `runs` across per-output `stat()` calls (slow / antivirus-intercepted FS)
        // would block a concurrent `spawn` on another path for that whole duration.
        // Recover a poisoned lock rather than wedging the whole fleet on one prior
        // panic.
        let snapshot: Vec<RunSnapshot> = {
            let runs = self
                .runs
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            runs.iter()
                .map(|(task_id, run)| RunSnapshot {
                    task_id: task_id.clone(),
                    terminal_id: run.terminal_id.clone(),
                    exit: run.exit.lock().ok().and_then(|slot| *slot),
                    started_at: run.started_at,
                    worktree_path: run.worktree_path.clone(),
                    outputs: run.outputs.clone(),
                    done_marker_path: run.done_marker_path.clone(),
                    output_fallback: OutputFallbackState {
                        outputs_ready_since: run.outputs_ready_since,
                        last_output_signature: run.last_output_signature,
                        output_idle_since: run.output_idle_since,
                    },
                })
                .collect()
        };

        let mut completions = classify(&snapshot, timeout_secs, now);

        // Completion for INTERACTIVE agents: the visible TUI usually never exits,
        // so the exit-slot sensor above never fires for normal work. The primary
        // completion signal is a backend-built done marker created as the agent's
        // LAST action. Output-file presence is only a compatibility fallback, and
        // it must remain present while the pane's recent output tail is stable for
        // a grace window; a first save must not kill an in-flight refactor.
        let mut state_updates: Vec<(String, OutputFallbackState)> = Vec::new();
        let mut live_done: HashSet<String> = HashSet::new();
        for run in snapshot
            .iter()
            .filter(|run| run.exit.is_none() && now.saturating_sub(run.started_at) <= timeout_secs)
        {
            if run.done_marker_path.is_file() {
                live_done.insert(run.task_id.clone());
                continue;
            }

            let outputs_present_now =
                !run.outputs.is_empty() && outputs_present(&run.worktree_path, &run.outputs);
            let output_signature = if outputs_present_now {
                self.pty
                    .capture(&run.terminal_id, PANE_IDLE_CAPTURE_LINES, true)
                    .ok()
                    .map(|output| output_signature(&output))
            } else {
                None
            };
            let updated = update_output_fallback_state(
                run.output_fallback,
                outputs_present_now,
                output_signature,
                now,
            );
            if output_fallback_done(&updated, now, OUTPUTS_FALLBACK_GRACE_SECS) {
                live_done.insert(run.task_id.clone());
            }
            state_updates.push((run.task_id.clone(), updated));
        }
        completions.succeeded.extend(live_done.iter().cloned());

        // Re-acquire the lock only to remove the reported tasks and collect the
        // terminals to act on; the PTY I/O happens AFTER the lock drops so a pane
        // spawn/poll on another path is never blocked behind it. Re-locking after the
        // unlocked compute is safe: we only remove ids classified terminal from the
        // snapshot, and `remove` is a no-op for any task already gone. `remove`
        // hands back the terminal id directly (no second lookup).
        let mut to_kill = Vec::new(); // still-running panes (hung or done-but-alive): must be killed
        let mut to_reap = Vec::new(); // already-exited panes: just clean up
        {
            let mut runs = self
                .runs
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for (task, state) in state_updates {
                if let Some(run) = runs.get_mut(&task) {
                    run.outputs_ready_since = state.outputs_ready_since;
                    run.last_output_signature = state.last_output_signature;
                    run.output_idle_since = state.output_idle_since;
                }
            }
            for task in &completions.timed_out {
                if let Some(run) = runs.remove(task) {
                    to_kill.push(run.terminal_id);
                }
            }
            for task in completions
                .succeeded
                .iter()
                .chain(completions.failed.iter())
            {
                if let Some(run) = runs.remove(task) {
                    // Outputs-ready panes are still alive (interactive TUI) → kill;
                    // exit-observed panes already terminated → reap.
                    if live_done.contains(task) {
                        to_kill.push(run.terminal_id);
                    } else {
                        to_reap.push(run.terminal_id);
                    }
                }
            }
        }

        for terminal in to_kill {
            let _ = self.pty.close(&terminal);
        }
        for terminal in to_reap {
            let _ = self.pty.remove_exited(&terminal);
        }

        completions
    }
}

/// Owned, side-effect-free view of one pane for the classifier and the
/// structural (outputs-present) completion pass.
#[derive(Clone)]
struct RunSnapshot {
    task_id: String,
    terminal_id: String,
    /// `Some(true)` clean exit, `Some(false)` non-zero exit, `None` still running.
    exit: Option<bool>,
    started_at: u64,
    worktree_path: String,
    outputs: Vec<String>,
    done_marker_path: PathBuf,
    output_fallback: OutputFallbackState,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct OutputFallbackState {
    outputs_ready_since: Option<u64>,
    last_output_signature: Option<u64>,
    output_idle_since: Option<u64>,
}

fn update_output_fallback_state(
    previous: OutputFallbackState,
    outputs_present_now: bool,
    output_signature: Option<u64>,
    now: u64,
) -> OutputFallbackState {
    if !outputs_present_now {
        return OutputFallbackState::default();
    }

    let outputs_ready_since = previous.outputs_ready_since.or(Some(now));
    let (last_output_signature, output_idle_since) = match output_signature {
        Some(signature) if previous.last_output_signature == Some(signature) => {
            (Some(signature), previous.output_idle_since.or(Some(now)))
        }
        Some(signature) => (Some(signature), Some(now)),
        None => (previous.last_output_signature, None),
    };

    OutputFallbackState {
        outputs_ready_since,
        last_output_signature,
        output_idle_since,
    }
}

fn output_fallback_done(state: &OutputFallbackState, now: u64, grace_secs: u64) -> bool {
    state
        .outputs_ready_since
        .is_some_and(|since| now.saturating_sub(since) >= grace_secs)
        && state
            .output_idle_since
            .is_some_and(|since| now.saturating_sub(since) >= grace_secs)
        && state.last_output_signature.is_some()
}

/// Pure completion/timeout decision over the current panes — the part the loop's
/// recovery relies on, kept I/O-free so it is exhaustively unit/mutation
/// testable. A clean exit is `succeeded`, a non-zero exit is `failed`, and a pane
/// still running past its wall-clock budget is `timed_out`; a pane still running
/// within budget is left untouched (reported on a later poll).
fn classify(runs: &[RunSnapshot], timeout_secs: u64, now: u64) -> Completions {
    let mut completions = Completions::default();
    for run in runs {
        match run.exit {
            Some(true) => completions.succeeded.push(run.task_id.clone()),
            Some(false) => completions.failed.push(run.task_id.clone()),
            None => {
                if now.saturating_sub(run.started_at) > timeout_secs {
                    completions.timed_out.push(run.task_id.clone());
                }
            }
        }
    }
    completions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(task: &str, exit: Option<bool>, started_at: u64) -> RunSnapshot {
        RunSnapshot {
            task_id: task.to_string(),
            terminal_id: format!("term-{task}"),
            exit,
            started_at,
            worktree_path: String::new(),
            outputs: Vec::new(),
            done_marker_path: PathBuf::new(),
            output_fallback: OutputFallbackState::default(),
        }
    }

    #[test]
    fn classify_splits_clean_and_nonzero_exits() {
        // A clean exit (code 0) is a finished task -> review; a non-zero exit is
        // a crashed worker -> recovery. This split is exactly what lets the loop
        // advance good work and reassign dead workers (BR9).
        let runs = [run("ok", Some(true), 0), run("bad", Some(false), 0)];
        let c = classify(&runs, 1800, 100);
        assert_eq!(c.succeeded, ["ok"]);
        assert_eq!(c.failed, ["bad"]);
        assert!(c.timed_out.is_empty());
    }

    #[test]
    fn classify_leaves_running_panes_within_budget() {
        // Still running (no exit) and within the wall-clock budget -> untouched,
        // reported on a later poll once it exits.
        let runs = [run("live", None, 50)];
        let c = classify(&runs, 1800, 100); // elapsed 50 <= 1800
        assert!(c.succeeded.is_empty());
        assert!(c.failed.is_empty());
        assert!(c.timed_out.is_empty());
    }

    #[test]
    fn classify_times_out_panes_past_budget() {
        // Still running but elapsed past the budget -> timed_out so the adapter
        // kills it and the loop recovers the task (a hang never exits, so it
        // would otherwise wedge the task in Running forever).
        let runs = [run("hung", None, 0)];
        let c = classify(&runs, 1800, 1801); // elapsed 1801 > 1800
        assert_eq!(c.timed_out, ["hung"]);
        assert!(c.succeeded.is_empty());
        assert!(c.failed.is_empty());
    }

    #[test]
    fn classify_budget_boundary_is_strict_greater_than() {
        // Exactly at the budget is NOT timed out (matches AgentManager's
        // `elapsed <= timeout` healthy check); one second past is.
        let at = [run("edge", None, 0)];
        assert!(classify(&at, 1800, 1800).timed_out.is_empty());
        let past = [run("edge", None, 0)];
        assert_eq!(classify(&past, 1800, 1801).timed_out, ["edge"]);
    }

    #[test]
    fn classify_handles_mixed_panes_in_one_poll() {
        let runs = [
            run("ok", Some(true), 0),
            run("bad", Some(false), 0),
            run("hung", None, 0),
            run("live", None, 1000),
        ];
        let c = classify(&runs, 1800, 2000);
        assert_eq!(c.succeeded, ["ok"]);
        assert_eq!(c.failed, ["bad"]);
        assert_eq!(c.timed_out, ["hung"]); // elapsed 2000 > 1800
                                           // "live" (elapsed 1000) stays running, reported on a later poll.
    }

    /// Behavioral proof of the full spawn -> wait -> classify path over REAL
    /// PTYs (not just the pure classifier): a pane that exits 0 lands in
    /// `succeeded`, a pane that exits 1 lands in `failed`, the reaped panes are
    /// forgotten (idempotent), and the binding is queryable until then. Without
    /// this, a broken waiter (e.g. recording `crashed` instead of `success()`)
    /// would ship with green pure tests.
    #[cfg(windows)]
    #[test]
    fn poll_classifies_real_pty_exits() {
        use std::time::{Duration, Instant};

        let fleet = PaneFleet::new(PtyManager::new());
        let argv = |code: &str| vec!["/c".to_string(), "exit".to_string(), code.to_string()];
        fleet
            .spawn(
                "task-ok",
                "cmd",
                &argv("0"),
                80,
                24,
                ".",
                HashMap::new(),
                Vec::new(),
            )
            .expect("spawn ok pane");
        fleet
            .spawn(
                "task-bad",
                "cmd",
                &argv("1"),
                80,
                24,
                ".",
                HashMap::new(),
                Vec::new(),
            )
            .expect("spawn bad pane");

        // The binding is queryable while the pane is tracked (used to announce
        // the pane for the fleet grid).
        assert!(fleet.terminal_of("task-ok").is_some());

        // Poll until both trivial children are observed (bounded so a hang can't
        // wedge the suite). A generous budget keeps the timeout path out of it.
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        while (succeeded.is_empty() || failed.is_empty()) && Instant::now() < deadline {
            let c = fleet.poll_completions(3600, now_secs());
            succeeded.extend(c.succeeded);
            failed.extend(c.failed);
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(succeeded, ["task-ok"], "exit 0 -> succeeded");
        assert_eq!(failed, ["task-bad"], "exit 1 -> failed");

        // Reaped panes are forgotten: no double-report, and the binding is gone.
        let again = fleet.poll_completions(3600, now_secs());
        assert!(again.succeeded.is_empty() && again.failed.is_empty());
        assert!(fleet.terminal_of("task-ok").is_none());
    }

    #[test]
    fn outputs_present_requires_every_declared_output() {
        let dir = std::env::temp_dir().join(format!("aelyris-outputs-{}", now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let root = dir.to_string_lossy().to_string();
        std::fs::write(dir.join("A.md"), "a").unwrap();

        // All present -> ready; a missing one -> not ready.
        assert!(outputs_present(&root, &["A.md".to_string()]));
        assert!(!outputs_present(
            &root,
            &["A.md".to_string(), "B.md".to_string()]
        ));
        std::fs::write(dir.join("B.md"), "b").unwrap();
        assert!(outputs_present(
            &root,
            &["A.md".to_string(), "B.md".to_string()]
        ));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn done_marker_path_is_backend_built_and_sanitized() {
        let root = PathBuf::from("C:/repo");
        let path = done_marker_path(
            root.to_str().unwrap(),
            "../task/one:two",
            "123e4567-e89b-12d3-a456-426614174000",
        );
        let done_dir = root.join(".aelyris").join("done");

        assert!(path.starts_with(&done_dir));
        assert!(path.ends_with(".._task_one_two-123e4567-e89b-12d3-a456-426614174000.done"));
        assert!(!path
            .strip_prefix(done_dir)
            .unwrap()
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir)));
        assert_eq!(
            done_marker_relative_path("../task/one:two", "123e4567-e89b-12d3-a456-426614174000"),
            ".aelyris/done/.._task_one_two-123e4567-e89b-12d3-a456-426614174000.done"
        );
    }

    #[test]
    fn done_marker_collision_uses_terminal_id_discriminator() {
        let root = std::env::temp_dir().join(format!("aelyris-marker-collision-{}", now_secs()));
        std::fs::create_dir_all(root.join(".aelyris").join("done")).unwrap();
        let cwd = root.to_string_lossy().to_string();

        let first = done_marker_path(&cwd, "task/1", "terminal-a");
        let second = done_marker_path(&cwd, "task:1", "terminal-b");

        assert_ne!(first, second);
        assert!(first.ends_with("task_1-terminal-a.done"));
        assert!(second.ends_with("task_1-terminal-b.done"));

        std::fs::write(&first, "done").unwrap();
        assert!(first.is_file());
        assert!(
            !second.is_file(),
            "one colliding task's marker must not satisfy another terminal's marker"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn output_fallback_waits_for_outputs_and_idle_grace() {
        let first =
            update_output_fallback_state(OutputFallbackState::default(), true, Some(10), 100);
        assert!(!output_fallback_done(
            &first,
            100 + OUTPUTS_FALLBACK_GRACE_SECS - 1,
            OUTPUTS_FALLBACK_GRACE_SECS
        ));

        let stable =
            update_output_fallback_state(first, true, Some(10), 100 + OUTPUTS_FALLBACK_GRACE_SECS);
        assert!(output_fallback_done(
            &stable,
            100 + OUTPUTS_FALLBACK_GRACE_SECS,
            OUTPUTS_FALLBACK_GRACE_SECS
        ));
    }

    #[test]
    fn output_fallback_resets_when_output_changes_or_disappears() {
        let first =
            update_output_fallback_state(OutputFallbackState::default(), true, Some(10), 100);
        let changed =
            update_output_fallback_state(first, true, Some(11), 100 + OUTPUTS_FALLBACK_GRACE_SECS);
        assert!(
            !output_fallback_done(
                &changed,
                100 + OUTPUTS_FALLBACK_GRACE_SECS,
                OUTPUTS_FALLBACK_GRACE_SECS
            ),
            "new pane output means the pane is not idle yet"
        );

        let missing = update_output_fallback_state(changed, false, None, 200);
        assert_eq!(missing, OutputFallbackState::default());
    }

    /// The defining behavior of the visible fleet: an INTERACTIVE agent never
    /// exits, so the exit-slot sensor stays `None` forever. Proof that the pane
    /// is reported done immediately once its explicit done marker appears, and
    /// the now-idle process is killed + forgotten. Without this, every
    /// interactive agent would wedge in Running until the hang timeout. Uses a
    /// real non-exiting PTY process so the exit path genuinely never fires (a
    /// pure-classifier test could not catch a broken integration).
    #[cfg(windows)]
    #[test]
    fn poll_reports_interactive_pane_done_when_marker_appears() {
        use std::time::{Duration, Instant};

        let work = std::env::temp_dir().join(format!("aelyris-marker-{}", now_secs()));
        std::fs::create_dir_all(&work).unwrap();
        let cwd = work.to_string_lossy().to_string();

        let fleet = PaneFleet::new(PtyManager::new());
        // A process that does NOT exit on its own within the test window — stands
        // in for the interactive claude TUI that waits indefinitely.
        let argv = vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "Start-Sleep -Seconds 120".to_string(),
        ];
        fleet
            .spawn(
                "task-build",
                "powershell",
                &argv,
                80,
                24,
                &cwd,
                HashMap::new(),
                Vec::new(),
            )
            .expect("spawn interactive-like pane");

        // Before the marker exists: the pane is running, the exit slot is None,
        // and a generous budget keeps it off the timeout path -> reported as
        // neither done nor failed.
        let c = fleet.poll_completions(3600, now_secs());
        assert!(
            c.succeeded.is_empty() && c.failed.is_empty() && c.timed_out.is_empty(),
            "interactive pane is not done before its output appears"
        );
        assert!(fleet.terminal_of("task-build").is_some());

        // The agent creates its explicit marker as its last action.
        let terminal = fleet.terminal_of("task-build").unwrap();
        let marker = done_marker_path(&cwd, "task-build", &terminal);
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(marker, "done").unwrap();

        // Now the marker sensor fires: succeeded, even though the process is still
        // alive (and is killed by the poll).
        let c = fleet.poll_completions(3600, now_secs());
        assert_eq!(c.succeeded, ["task-build"], "marker present -> succeeded");
        assert!(c.failed.is_empty() && c.timed_out.is_empty());

        // Reported once: the binding is gone and a re-poll is empty (it was
        // removed even though it never exited on its own).
        assert!(fleet.terminal_of("task-build").is_none());
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut again = fleet.poll_completions(3600, now_secs());
        while !again.succeeded.is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            again = fleet.poll_completions(3600, now_secs());
        }
        assert!(again.succeeded.is_empty(), "no double-report");

        let _ = std::fs::remove_dir_all(&work);
    }

    #[cfg(windows)]
    #[test]
    fn poll_reports_outputs_only_done_after_idle_grace() {
        let work = std::env::temp_dir().join(format!("aelyris-outputs-grace-{}", now_secs()));
        std::fs::create_dir_all(&work).unwrap();
        let cwd = work.to_string_lossy().to_string();

        let fleet = PaneFleet::new(PtyManager::new());
        let argv = vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "Start-Sleep -Seconds 120".to_string(),
        ];
        fleet
            .spawn(
                "task-build",
                "powershell",
                &argv,
                80,
                24,
                &cwd,
                HashMap::new(),
                vec!["BUILT.md".to_string()],
            )
            .expect("spawn interactive-like pane");

        std::fs::write(work.join("BUILT.md"), "done").unwrap();

        let observed_at = now_secs();
        let first = fleet.poll_completions(3600, observed_at);
        assert!(
            first.succeeded.is_empty() && first.failed.is_empty() && first.timed_out.is_empty(),
            "outputs appearing alone must not complete the pane before grace"
        );
        assert!(fleet.terminal_of("task-build").is_some());

        let second = fleet.poll_completions(3600, observed_at + OUTPUTS_FALLBACK_GRACE_SECS);
        assert_eq!(
            second.succeeded,
            ["task-build"],
            "outputs-only fallback completes after idle grace"
        );
        assert!(fleet.terminal_of("task-build").is_none());

        let _ = std::fs::remove_dir_all(&work);
    }
}
