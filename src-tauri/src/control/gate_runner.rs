//! Mechanical quality-gate runner (BR9 / Acceptance ⑧): runs the *target*
//! project's test/lint/type-check commands in a task's isolated worktree and
//! maps real process exit codes to the objective `GateResults`, so only a
//! genuinely-green branch can merge — the AI reviewer cannot fabricate a passing
//! test gate. Subjective gates (design/context) remain the reviewer's judgment,
//! supplied per task in the verdict map.
//!
//! `ProcessGateRunner` subsumes the older caller-verdict-only gate: with
//! `GateCommands::default()` (no commands configured) every objective gate falls
//! back to the caller's supplied verdict (an absent verdict is all-red, so a task
//! is never merged without an explicit green) — i.e. the prior behavior. Once a
//! command is configured, that objective gate is decided mechanically and the
//! caller's claim for it is ignored (the machine is authoritative).
//!
//! Note: a mechanical gate shells out *inside* the loop step (which holds the
//! Task Graph lock). It is intended for fast gates and the deterministic exam
//! harness; for long-running suites the orchestrator should run them out of band
//! and supply verdicts (leave the command unset).

use std::collections::HashMap;

use crate::control::loop_ports::GateRunner;
use crate::review::GateResults;

/// Safe default for a task with no supplied verdict: every gate red, so it is
/// never merged without an explicit green (mirrors the loop's prior default).
const ALL_RED: GateResults = GateResults {
    tests_pass: false,
    lint_pass: false,
    types_pass: false,
    design_consistent: false,
    context_aligned: false,
};

/// Objective gate commands for the target project under construction. Each is
/// the argv of a command run in the task's worktree; `None`/empty means "no such
/// gate to run" (it falls back to the reviewer's supplied verdict). Examples:
/// `test = ["pnpm","test"]`, `lint = ["pnpm","lint"]`,
/// `types = ["pnpm","exec","tsc","--noEmit"]`.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct GateCommands {
    #[serde(default)]
    pub test: Option<Vec<String>>,
    #[serde(default)]
    pub lint: Option<Vec<String>>,
    #[serde(default)]
    pub types: Option<Vec<String>>,
}

/// Runs a single gate command and reports pass/fail. Injectable so the gate
/// mapping is unit-testable without spawning processes; the real impl shells out.
pub trait CommandRunner {
    /// Run `argv` in `cwd`; `true` iff it exits with status 0.
    fn run(&self, argv: &[String], cwd: &str) -> bool;
}

/// Real command runner: spawns the command (hidden window), waits, and reports
/// success. A spawn failure is a gate *failure* — an unrunnable gate cannot be
/// proven green.
pub struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(&self, argv: &[String], cwd: &str) -> bool {
        let Some((program, args)) = argv.split_first() else {
            return false;
        };
        crate::process::hidden_command(program)
            .args(args)
            .current_dir(cwd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

/// Concrete `GateRunner`: objective gates (tests/lint/types) decided by running
/// the configured commands in the task's worktree; subjective gates
/// (design/context) taken from the reviewer's supplied verdict.
pub struct ProcessGateRunner<R: CommandRunner> {
    repo_path: String,
    commands: GateCommands,
    verdicts: HashMap<String, GateResults>,
    runner: R,
}

impl<R: CommandRunner> ProcessGateRunner<R> {
    pub fn new(
        repo_path: impl Into<String>,
        commands: GateCommands,
        verdicts: HashMap<String, GateResults>,
        runner: R,
    ) -> Self {
        Self {
            repo_path: repo_path.into(),
            commands,
            verdicts,
            runner,
        }
    }

    /// Decide one objective gate: run its command in `cwd` when configured,
    /// otherwise fall back to the reviewer's claim for it.
    fn objective(&self, command: &Option<Vec<String>>, cwd: &str, fallback: bool) -> bool {
        match command {
            Some(argv) if !argv.is_empty() => self.runner.run(argv, cwd),
            _ => fallback,
        }
    }
}

impl<R: CommandRunner> GateRunner for ProcessGateRunner<R> {
    fn run(&self, task_id: &str, branch: &str) -> GateResults {
        let caller = self.verdicts.get(task_id).copied().unwrap_or(ALL_RED);
        // Objective gates run where the task's code lives — its isolated
        // worktree (or the repo root when the task has no bound branch).
        let cwd = if branch.is_empty() {
            self.repo_path.clone()
        } else {
            crate::control::worktree::predict_path(&self.repo_path, branch)
                .to_string_lossy()
                .into_owned()
        };
        GateResults {
            tests_pass: self.objective(&self.commands.test, &cwd, caller.tests_pass),
            lint_pass: self.objective(&self.commands.lint, &cwd, caller.lint_pass),
            types_pass: self.objective(&self.commands.types, &cwd, caller.types_pass),
            // Not mechanically checkable — the reviewer's judgment stands.
            design_consistent: caller.design_consistent,
            context_aligned: caller.context_aligned,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GREEN: GateResults = GateResults {
        tests_pass: true,
        lint_pass: true,
        types_pass: true,
        design_consistent: true,
        context_aligned: true,
    };

    /// Maps an exact argv (joined) to a scripted pass/fail; records the cwd each
    /// command ran in.
    struct FakeRunner {
        results: HashMap<String, bool>,
        ran_in: std::cell::RefCell<Vec<(String, String)>>,
    }
    impl FakeRunner {
        fn new(results: &[(&str, bool)]) -> Self {
            Self {
                results: results
                    .iter()
                    .map(|(cmd, ok)| (cmd.to_string(), *ok))
                    .collect(),
                ran_in: std::cell::RefCell::new(Vec::new()),
            }
        }
    }
    impl CommandRunner for FakeRunner {
        fn run(&self, argv: &[String], cwd: &str) -> bool {
            let joined = argv.join(" ");
            self.ran_in
                .borrow_mut()
                .push((joined.clone(), cwd.to_string()));
            *self.results.get(&joined).unwrap_or(&false)
        }
    }

    fn verdicts(task: &str, results: GateResults) -> HashMap<String, GateResults> {
        let mut map = HashMap::new();
        map.insert(task.to_string(), results);
        map
    }

    #[test]
    fn no_commands_falls_back_to_caller_verdict() {
        // With no commands configured the runner is pure caller-verdict (the
        // prior behavior): green in, green out.
        let runner = ProcessGateRunner::new(
            "/repo",
            GateCommands::default(),
            verdicts("t", GREEN),
            FakeRunner::new(&[]),
        );
        assert_eq!(runner.run("t", "feature"), GREEN);
        // No commands were actually run.
        // (FakeRunner moved into runner; assert via the result instead.)
    }

    #[test]
    fn absent_verdict_is_all_red() {
        let runner = ProcessGateRunner::new(
            "/repo",
            GateCommands::default(),
            HashMap::new(),
            FakeRunner::new(&[]),
        );
        let result = runner.run("unknown", "feature");
        assert!(!result.all_green());
        assert_eq!(result, ALL_RED);
    }

    #[test]
    fn failing_test_command_overrides_a_green_claim() {
        // The reviewer claims all green, but the mechanical test gate fails ->
        // tests_pass is false regardless, so the task cannot merge (⑧).
        let runner = ProcessGateRunner::new(
            "/repo",
            GateCommands {
                test: Some(vec!["pnpm".into(), "test".into()]),
                ..Default::default()
            },
            verdicts("t", GREEN),
            FakeRunner::new(&[("pnpm test", false)]),
        );
        let result = runner.run("t", "feature");
        assert!(!result.tests_pass);
        assert!(!result.all_green());
        assert_eq!(result.failed_gates(), ["tests"]);
        // Subjective gates still come from the (green) reviewer verdict.
        assert!(result.design_consistent && result.context_aligned);
    }

    #[test]
    fn passing_commands_with_green_subjective_is_all_green() {
        let runner = ProcessGateRunner::new(
            "/repo",
            GateCommands {
                test: Some(vec!["pnpm".into(), "test".into()]),
                lint: Some(vec!["pnpm".into(), "lint".into()]),
                types: Some(vec!["tsc".into()]),
            },
            verdicts("t", GREEN),
            FakeRunner::new(&[("pnpm test", true), ("pnpm lint", true), ("tsc", true)]),
        );
        assert!(runner.run("t", "feature").all_green());
    }

    #[test]
    fn objective_gates_run_in_the_tasks_worktree() {
        let runner = ProcessGateRunner::new(
            "/repo",
            GateCommands {
                test: Some(vec!["pnpm".into(), "test".into()]),
                ..Default::default()
            },
            verdicts("t", GREEN),
            FakeRunner::new(&[("pnpm test", true)]),
        );
        let _ = runner.run("t", "agent/auth");
        let ran = runner.runner.ran_in.borrow();
        assert_eq!(ran.len(), 1);
        // The command ran in the predicted worktree path for the branch, not the repo root.
        let expected = crate::control::worktree::predict_path("/repo", "agent/auth")
            .to_string_lossy()
            .into_owned();
        assert_eq!(ran[0].1, expected);
    }
}
