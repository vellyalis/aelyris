//! Running the deterministic quality gates — the part of review that replaces a
//! hand-canned "all green" with REAL command results.
//!
//! A task's branch only merges if `tests`, `lint`, and `types` actually pass.
//! This module RUNS those checks in the task's worktree and reports pass/fail.
//! The cardinal rule (no assumed-green / no fallback): a gate passes only if a
//! command for it is configured AND exits successfully; an unconfigured or
//! un-runnable gate is a FAILURE — you cannot claim a check passed without
//! running it. The command executor is injected so the aggregation logic is
//! unit-tested without spawning anything.
//!
//! The semantic gates (`design_consistent`, `context_aligned`) are an LLM
//! judgement layered on top separately; this module owns only the deterministic
//! three.

use std::path::Path;

/// Which deterministic gate a command satisfies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateKind {
    Tests,
    Lint,
    Types,
}

impl GateKind {
    fn name(self) -> &'static str {
        match self {
            GateKind::Tests => "tests",
            GateKind::Lint => "lint",
            GateKind::Types => "types",
        }
    }
}

/// One quality-gate command to run in the worktree (e.g. `cargo test`). A gate
/// kind may have several (a mixed repo runs both `cargo test` and `pnpm test`);
/// the gate passes only if ALL of its commands pass.
#[derive(Debug, Clone)]
pub struct GateCommand {
    pub kind: GateKind,
    pub program: String,
    pub args: Vec<String>,
}

impl GateCommand {
    pub fn new(kind: GateKind, program: impl Into<String>, args: &[&str]) -> Self {
        Self {
            kind,
            program: program.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
        }
    }
}

/// The result of running one command: did it exit successfully, and its output
/// (kept for diagnostics on failure).
#[derive(Debug, Clone)]
pub struct CommandRun {
    pub success: bool,
    pub output: String,
}

/// Pass/fail of the deterministic gates, with the captured reason for any that
/// failed so the rejection can tell the worker exactly what is red.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeterministicGates {
    pub tests_pass: bool,
    pub lint_pass: bool,
    pub types_pass: bool,
    /// `(gate name, reason)` for each red gate.
    pub failures: Vec<(String, String)>,
}

const FAIL_OUTPUT_TAIL: usize = 600;

fn tail(s: &str) -> String {
    let s = s.trim_end();
    if s.len() <= FAIL_OUTPUT_TAIL {
        s.to_string()
    } else {
        format!("…{}", &s[s.len() - FAIL_OUTPUT_TAIL..])
    }
}

/// Run the deterministic gates (`tests`/`lint`/`types`) in `worktree` and report
/// pass/fail. `run(cwd, program, args)` is injected (real spawn in production, a
/// stub in tests). A gate kind with no configured command, or whose command
/// fails to run, is reported as FAILED — never assumed green.
pub fn run_deterministic_gates(
    worktree: &Path,
    commands: &[GateCommand],
    run: impl Fn(&Path, &str, &[String]) -> CommandRun,
) -> DeterministicGates {
    let mut gates = DeterministicGates::default();
    for kind in [GateKind::Tests, GateKind::Lint, GateKind::Types] {
        let cmds: Vec<&GateCommand> = commands.iter().filter(|c| c.kind == kind).collect();
        let (pass, reason) = if cmds.is_empty() {
            (
                false,
                Some(format!("no {} command configured", kind.name())),
            )
        } else {
            let mut outcome = (true, None);
            for c in cmds {
                let r = run(worktree, &c.program, &c.args);
                if !r.success {
                    outcome = (false, Some(tail(&r.output)));
                    break;
                }
            }
            outcome
        };
        match kind {
            GateKind::Tests => gates.tests_pass = pass,
            GateKind::Lint => gates.lint_pass = pass,
            GateKind::Types => gates.types_pass = pass,
        }
        if let Some(reason) = reason {
            gates.failures.push((kind.name().to_string(), reason));
        }
    }
    gates
}

/// Real command executor for [`run_deterministic_gates`]: spawns `program` with
/// `args` in `cwd` (hidden window), captures combined stdout+stderr, and reports
/// success from the exit status. A spawn failure is a FAILED run (`success:
/// false`) with the OS error as output — an un-runnable gate is never green. This
/// is the production adapter the unit tests substitute with a stub closure.
pub fn spawn_run(cwd: &Path, program: &str, args: &[String]) -> CommandRun {
    match crate::process::hidden_command(program)
        .args(args)
        .current_dir(cwd)
        .output()
    {
        Ok(out) => {
            let mut output = String::from_utf8_lossy(&out.stdout).into_owned();
            output.push_str(&String::from_utf8_lossy(&out.stderr));
            CommandRun {
                success: out.status.success(),
                output,
            }
        }
        Err(e) => CommandRun {
            success: false,
            output: format!("failed to run `{program}`: {e}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok() -> CommandRun {
        CommandRun {
            success: true,
            output: String::new(),
        }
    }
    fn fail(out: &str) -> CommandRun {
        CommandRun {
            success: false,
            output: out.to_string(),
        }
    }

    fn full_config() -> Vec<GateCommand> {
        vec![
            GateCommand::new(GateKind::Tests, "cargo", &["test"]),
            GateCommand::new(GateKind::Lint, "cargo", &["clippy"]),
            GateCommand::new(GateKind::Types, "cargo", &["check"]),
        ]
    }

    #[test]
    fn all_commands_pass_means_all_gates_green() {
        let g = run_deterministic_gates(Path::new("."), &full_config(), |_, _, _| ok());
        assert!(g.tests_pass && g.lint_pass && g.types_pass);
        assert!(g.failures.is_empty());
    }

    #[test]
    fn a_failing_command_reds_its_gate_and_captures_the_reason() {
        let g = run_deterministic_gates(Path::new("."), &full_config(), |_, program, args| {
            if program == "cargo" && args == ["clippy"] {
                fail("error: unused variable `x`")
            } else {
                ok()
            }
        });
        assert!(g.tests_pass && g.types_pass);
        assert!(!g.lint_pass);
        assert_eq!(g.failures.len(), 1);
        assert_eq!(g.failures[0].0, "lint");
        assert!(g.failures[0].1.contains("unused variable"));
    }

    #[test]
    fn an_unconfigured_gate_is_a_failure_not_assumed_green() {
        // Only a test command — lint and types are unconfigured -> must fail.
        let only_tests = vec![GateCommand::new(GateKind::Tests, "cargo", &["test"])];
        let g = run_deterministic_gates(Path::new("."), &only_tests, |_, _, _| ok());
        assert!(g.tests_pass);
        assert!(!g.lint_pass && !g.types_pass);
        let failed: Vec<&str> = g.failures.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(failed, ["lint", "types"]);
        assert!(g.failures[0].1.contains("no lint command configured"));
    }

    #[test]
    fn a_gate_with_several_commands_needs_all_to_pass() {
        // Mixed repo: tests = cargo test AND pnpm test; the second fails.
        let cfg = vec![
            GateCommand::new(GateKind::Tests, "cargo", &["test"]),
            GateCommand::new(GateKind::Tests, "pnpm", &["test"]),
            GateCommand::new(GateKind::Lint, "cargo", &["clippy"]),
            GateCommand::new(GateKind::Types, "tsc", &["--noEmit"]),
        ];
        let g = run_deterministic_gates(Path::new("."), &cfg, |_, program, _| {
            if program == "pnpm" {
                fail("1 test failed")
            } else {
                ok()
            }
        });
        assert!(!g.tests_pass, "one of the test commands failed");
        assert!(g.lint_pass && g.types_pass);
        assert_eq!(g.failures[0].0, "tests");
    }

    /// Behavioral proof of the production executor: a real exit-0 command is a
    /// successful run, a real non-zero exit is a failed run, and a missing
    /// program is a failed run (never a panic). The aggregation logic above is
    /// tested with stubs; this pins the adapter the stubs stand in for so a
    /// broken spawn (e.g. success hard-coded) would fail a cargo test.
    #[cfg(windows)]
    #[test]
    fn spawn_run_maps_real_exit_codes_and_spawn_failure() {
        let zero = spawn_run(
            Path::new("."),
            "cmd",
            &["/c".into(), "exit".into(), "0".into()],
        );
        assert!(zero.success, "exit 0 -> success");

        let one = spawn_run(
            Path::new("."),
            "cmd",
            &["/c".into(), "exit".into(), "1".into()],
        );
        assert!(!one.success, "exit 1 -> failure");

        let missing = spawn_run(Path::new("."), "definitely-not-a-real-program-xyz", &[]);
        assert!(!missing.success, "an un-runnable gate is never green");
        assert!(missing.output.contains("failed to run"));
    }
}
