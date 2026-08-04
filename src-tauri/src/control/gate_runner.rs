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
use std::time::Duration;

use crate::control::loop_ports::{GateRunner, ReviewedCandidateBinding};
use crate::review::GateResults;
use sha2::{Digest, Sha256};

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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExactCommandEvidence {
    pub command_argv: Vec<String>,
    pub command_fingerprint: String,
    pub environment_fingerprint: String,
    pub result: String,
    pub exit_code: Option<i32>,
    pub evidence_digest: String,
    pub started_at_unix_ms: u64,
    pub ended_at_unix_ms: u64,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn gate_results_digest(gates: &GateResults) -> Result<String, String> {
    serde_json::to_vec(gates)
        .map(|bytes| sha256_hex(&bytes))
        .map_err(|error| format!("serialize review gates: {error}"))
}

fn a7_environment_fingerprint(
    cwd: &str,
    cargo_target_dir: Option<&std::path::Path>,
) -> Result<String, String> {
    fn version(program: &str, args: &[&str], cwd: &str) -> Result<String, String> {
        let mut command = crate::process::hidden_command(program);
        command.args(args).current_dir(cwd);
        let output = crate::process::run_supervised(
            &mut command,
            &crate::process::SupervisedCommandConfig {
                deadline: Duration::from_secs(30),
                output_limit_bytes: 32 * 1024,
                cancellation: None,
            },
        )
        .map_err(|error| format!("read {program} environment identity: {error}"))?;
        if output.status != crate::process::SupervisedCommandStatus::Exited
            || output.exit_code != Some(0)
        {
            return Err(format!(
                "{program} environment identity command did not pass"
            ));
        }
        String::from_utf8(output.stdout_tail)
            .map(|value| value.trim().to_string())
            .map_err(|error| format!("decode {program} environment identity: {error}"))
    }

    let canonical_cwd = std::fs::canonicalize(cwd)
        .map_err(|error| format!("canonicalize exact gate cwd: {error}"))?;
    let canonical_cargo_target = cargo_target_dir
        .map(|path| {
            std::fs::canonicalize(path)
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .map_err(|error| format!("canonicalize exact gate Cargo target: {error}"))
        })
        .transpose()?;
    let identity = serde_json::json!({
        "schema": "aelyris.a7_gate_environment/v1",
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "cwd": canonical_cwd.to_string_lossy().replace('\\', "/"),
        "cargoTargetDir": canonical_cargo_target,
        "cargoVersion": version("cargo", &["-V"], cwd)?,
        "rustcVersionVerbose": version("rustc", &["-Vv"], cwd)?,
    });
    serde_json::to_vec(&identity)
        .map(|bytes| sha256_hex(&bytes))
        .map_err(|error| format!("serialize exact gate environment identity: {error}"))
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

/// Execute exactly one backend-derived argv and retain only canonical digests,
/// never a secret-bearing transcript. The command fingerprint is over JSON argv
/// (not a shell-joined string), and the evidence digest binds cwd, lifecycle,
/// exit, and bounded output digests.
pub fn run_exact_command(argv: &[String], cwd: &str) -> Result<ExactCommandEvidence, String> {
    run_exact_command_with_cargo_target(argv, cwd, None)
}

pub fn run_exact_command_with_cargo_target(
    argv: &[String],
    cwd: &str,
    cargo_target_dir: Option<&std::path::Path>,
) -> Result<ExactCommandEvidence, String> {
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| "exact gate argv must not be empty".to_string())?;
    if let Some(target) = cargo_target_dir {
        std::fs::create_dir_all(target)
            .map_err(|error| format!("prepare exact gate Cargo target: {error}"))?;
    }
    let canonical_argv =
        serde_json::to_vec(argv).map_err(|error| format!("serialize exact gate argv: {error}"))?;
    let command_fingerprint = sha256_hex(&canonical_argv);
    let environment_fingerprint = a7_environment_fingerprint(cwd, cargo_target_dir)?;
    let started = now_unix_ms();
    let mut command = crate::process::hidden_command(program);
    command.args(args).current_dir(cwd);
    if let Some(target) = cargo_target_dir {
        command.env("CARGO_TARGET_DIR", target);
    }
    let output = crate::process::run_supervised(
        &mut command,
        &crate::process::SupervisedCommandConfig {
            deadline: Duration::from_secs(10 * 60),
            output_limit_bytes: 256 * 1024,
            cancellation: None,
        },
    )
    .map_err(|error| format!("run exact gate: {error}"))?;
    let ended = now_unix_ms().max(started);
    let result = match output.status {
        crate::process::SupervisedCommandStatus::Exited if output.exit_code == Some(0) => "passed",
        crate::process::SupervisedCommandStatus::Exited => "failed",
        crate::process::SupervisedCommandStatus::TimedOut => "blocked",
        crate::process::SupervisedCommandStatus::Cancelled => "cancelled",
    };
    let envelope = serde_json::json!({
        "schema": "aelyris.command_evidence/v1",
        "commandFingerprint": command_fingerprint,
        "environmentFingerprint": environment_fingerprint,
        "cwd": cwd.replace('\\', "/"),
        "startedAtUnixMs": started,
        "endedAtUnixMs": ended,
        "result": result,
        "exitCode": output.exit_code,
        "stdoutDigest": sha256_hex(&output.stdout_tail),
        "stderrDigest": sha256_hex(&output.stderr_tail),
        "stdoutTruncated": output.stdout_truncated,
        "stderrTruncated": output.stderr_truncated,
    });
    let evidence_digest = sha256_hex(
        &serde_json::to_vec(&envelope)
            .map_err(|error| format!("serialize exact gate evidence: {error}"))?,
    );
    Ok(ExactCommandEvidence {
        command_argv: argv.to_vec(),
        command_fingerprint,
        environment_fingerprint,
        result: result.to_string(),
        exit_code: output.exit_code,
        evidence_digest,
        started_at_unix_ms: started,
        ended_at_unix_ms: ended,
    })
}

impl CommandRunner for SystemCommandRunner {
    fn run(&self, argv: &[String], cwd: &str) -> bool {
        let Some((program, args)) = argv.split_first() else {
            return false;
        };
        let mut command = crate::process::hidden_command(program);
        command.args(args).current_dir(cwd);
        crate::process::run_supervised(
            &mut command,
            &crate::process::SupervisedCommandConfig {
                deadline: Duration::from_secs(10 * 60),
                output_limit_bytes: 256 * 1024,
                cancellation: None,
            },
        )
        .map(|output| {
            output.status == crate::process::SupervisedCommandStatus::Exited
                && output.exit_code == Some(0)
        })
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
    review_bindings: HashMap<String, ReviewedCandidateBinding>,
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
            review_bindings: HashMap::new(),
            runner,
        }
    }

    pub fn with_review_bindings(
        mut self,
        review_bindings: HashMap<String, ReviewedCandidateBinding>,
    ) -> Self {
        self.review_bindings = review_bindings;
        self
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
    fn has_verdict(&self, task_id: &str) -> bool {
        self.verdicts.contains_key(task_id)
    }

    fn review_binding(&self, task_id: &str) -> Option<ReviewedCandidateBinding> {
        self.review_bindings.get(task_id).cloned()
    }

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

    #[test]
    fn a7_2_exact_command_evidence_binds_safe_environment_identity() {
        let argv = vec!["cargo".to_string(), "-V".to_string()];
        let evidence = run_exact_command(&argv, env!("CARGO_MANIFEST_DIR")).unwrap();
        assert_eq!(evidence.command_argv, argv);
        assert_eq!(evidence.result, "passed");
        assert_eq!(evidence.exit_code, Some(0));
        assert_eq!(evidence.command_fingerprint.len(), 64);
        assert_eq!(evidence.environment_fingerprint.len(), 64);
        assert_eq!(evidence.evidence_digest.len(), 64);
        assert!(evidence.ended_at_unix_ms >= evidence.started_at_unix_ms);

        let cache = tempfile::tempdir().unwrap();
        let cached = run_exact_command_with_cargo_target(
            &argv,
            env!("CARGO_MANIFEST_DIR"),
            Some(cache.path()),
        )
        .unwrap();
        assert_eq!(cached.result, "passed");
        assert_ne!(
            cached.environment_fingerprint, evidence.environment_fingerprint,
            "the exact evidence must bind the shared Cargo cache identity"
        );
    }
}
