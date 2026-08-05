//! End-to-end branch review — the REAL Reviewer that replaces the demo's
//! hand-canned "all green". It runs the project's deterministic gates
//! (tests/lint/types) in the task's worktree via [`run_deterministic_gates`],
//! asks the LLM ([`judge_semantics`]) whether the diff is design-consistent and
//! context-aligned, COMBINES both into a single [`GateResults`], and funnels that
//! through [`review`] (which also enforces reviewer != implementer). No
//! assumed-green at any layer: an unconfigured deterministic gate is a failure,
//! and a judge that can't run reds the subjective gates.
//!
//! The two side-effecting dependencies — the command executor and the LLM — are
//! INJECTED, so this whole flow is unit-tested without spawning cargo or claude;
//! production passes [`super::spawn_run`] and a `claude` one-shot.

use std::path::Path;

use super::gates::{run_deterministic_gates, CommandRun, GateCommand, GateKind};
use super::judge::judge_semantics;
use super::{review, GateResults, ReviewVerdict};

fn pnpm_gate_command_with(
    kind: GateKind,
    args: &[&str],
    resolve: impl Fn(&str) -> String,
) -> GateCommand {
    let pnpm = resolve("pnpm");
    if pnpm == "pnpm" {
        let corepack = resolve("corepack");
        if corepack != "corepack" {
            return GateCommand {
                kind,
                program: corepack,
                args: std::iter::once("pnpm".to_string())
                    .chain(args.iter().map(|arg| (*arg).to_string()))
                    .collect(),
            };
        }
    }
    GateCommand::new(kind, pnpm, args)
}

fn pnpm_gate_command(kind: GateKind, args: &[&str]) -> GateCommand {
    pnpm_gate_command_with(kind, args, crate::agent::interactive::platform_cli_program)
}

fn cargo_gate_command(kind: GateKind, manifest_path: Option<&str>, args: &[&str]) -> GateCommand {
    let mut command_args = args
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    if let Some(manifest_path) = manifest_path {
        let insertion = command_args
            .iter()
            .position(|arg| arg == "--")
            .unwrap_or(command_args.len());
        command_args.splice(
            insertion..insertion,
            ["--manifest-path".to_string(), manifest_path.to_string()],
        );
    }
    GateCommand {
        kind,
        program: "cargo".into(),
        args: command_args,
    }
}

fn package_scripts(worktree: &Path) -> std::collections::HashSet<String> {
    let Ok(json) = std::fs::read_to_string(worktree.join("package.json")) else {
        return std::collections::HashSet::new();
    };
    serde_json::from_str::<serde_json::Value>(&json)
        .ok()
        .and_then(|value| {
            value
                .get("scripts")
                .and_then(serde_json::Value::as_object)
                .cloned()
        })
        .map(|scripts| {
            scripts
                .into_iter()
                .filter_map(|(name, value)| value.as_str().map(|_| name))
                .collect()
        })
        .unwrap_or_default()
}

fn first_script<'a>(
    scripts: &std::collections::HashSet<String>,
    names: &'a [&'a str],
) -> Option<&'a str> {
    names.iter().copied().find(|name| scripts.contains(*name))
}

fn has_any(worktree: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| worktree.join(name).is_file())
}

/// Pick the quality-gate commands for whatever kind of project lives in
/// `worktree`, by sniffing its manifest files and declared package scripts. A
/// root Rust crate or standard Tauri `src-tauri/Cargo.toml` gets real Cargo
/// test/clippy/check commands bound to that manifest. A Node/TS project uses its
/// declared `test`, `lint`/`check`, and typecheck scripts; only when a matching
/// config exists does it fall back to direct Biome/ESLint/tsc commands. A repo
/// with both stacks gets both sets (all commands for a gate must pass). Missing
/// configuration yields no command and therefore a red gate downstream — never
/// an assumed green or a guessed tool.
///
/// This is the OUT-OF-BAND reviewer's command source: it auto-discovers commands
/// from the manifest because it runs off the orchestrator lock (in `spawn_blocking`)
/// and is self-sufficient. It is deliberately separate from
/// [`crate::control::gate_runner::GateCommands`], the IN-LOOP mechanical safety net,
/// which instead takes commands from explicit caller config and falls back to the
/// supplied verdict when unset. The two serve different roles and are intentionally
/// independent — a task is normally reviewed out-of-band here, then merged by the
/// loop (which the cockpit face leaves with no mechanical commands, so it trusts
/// this verdict rather than re-running the gates).
pub fn detect_gate_commands(worktree: &Path) -> Vec<GateCommand> {
    let mut cmds = Vec::new();
    let cargo_manifest = if worktree.join("Cargo.toml").is_file() {
        Some(None)
    } else if worktree.join("src-tauri").join("Cargo.toml").is_file() {
        Some(Some("src-tauri/Cargo.toml"))
    } else {
        None
    };
    if let Some(manifest_path) = cargo_manifest {
        cmds.push(cargo_gate_command(
            GateKind::Tests,
            manifest_path,
            &["test"],
        ));
        cmds.push(cargo_gate_command(
            GateKind::Lint,
            manifest_path,
            &["clippy", "--all-targets"],
        ));
        cmds.push(cargo_gate_command(
            GateKind::Types,
            manifest_path,
            &["check", "--all-targets"],
        ));
    }
    if worktree.join("package.json").is_file() {
        let scripts = package_scripts(worktree);
        if scripts.contains("test") {
            cmds.push(pnpm_gate_command(GateKind::Tests, &["run", "test"]));
        }
        if let Some(script) = first_script(&scripts, &["lint", "check"]) {
            cmds.push(pnpm_gate_command(GateKind::Lint, &["run", script]));
        } else if has_any(worktree, &["biome.json", "biome.jsonc"]) {
            cmds.push(pnpm_gate_command(
                GateKind::Lint,
                &["exec", "biome", "check", "."],
            ));
        } else if has_any(
            worktree,
            &[
                "eslint.config.js",
                "eslint.config.mjs",
                "eslint.config.cjs",
                ".eslintrc",
                ".eslintrc.json",
                ".eslintrc.js",
                ".eslintrc.cjs",
            ],
        ) {
            cmds.push(pnpm_gate_command(GateKind::Lint, &["exec", "eslint", "."]));
        }
        if let Some(script) = first_script(
            &scripts,
            &["typecheck", "type-check", "check:types", "types"],
        ) {
            cmds.push(pnpm_gate_command(GateKind::Types, &["run", script]));
        } else if worktree.join("tsconfig.json").is_file() {
            cmds.push(pnpm_gate_command(
                GateKind::Types,
                &["exec", "tsc", "--noEmit"],
            ));
        }
    }
    cmds
}

/// The inputs to a branch review, grouped so the entry point stays a 3-argument
/// function (this + the two injected closures) rather than a long argument list.
pub struct ReviewInputs<'a> {
    /// The task's isolated worktree — where its code lives and the gates run.
    pub worktree: &'a Path,
    /// The instruction the worker was given (the semantic judge checks against it).
    pub task_title: &'a str,
    /// The shared decisions (ADRs) the change must not contradict.
    pub adr_context: &'a str,
    /// The unified diff of the branch vs. its merge-base with the target.
    pub diff: &'a str,
    pub reviewer_id: &'a str,
    pub implementer_id: &'a str,
    /// The deterministic gate commands to run (see [`detect_gate_commands`]).
    pub commands: &'a [GateCommand],
}

/// The full reviewer outcome for a branch: the combined gates, the merge verdict,
/// and the reason for every red gate (deterministic failures first, then the
/// subjective ones) so a rejection is actionable.
#[derive(Debug, Clone)]
pub struct BranchReview {
    pub gates: GateResults,
    pub verdict: ReviewVerdict,
    pub reasons: Vec<(String, String)>,
}

/// Run the real Reviewer over a branch: deterministic gates (`run`) + semantic
/// judge (`llm`), combined into one verdict. See the module docs for the
/// no-assumed-green contract.
pub fn review_branch(
    input: &ReviewInputs,
    run: impl Fn(&Path, &str, &[String]) -> CommandRun,
    llm: impl Fn(&str) -> Result<String, String>,
) -> BranchReview {
    let det = run_deterministic_gates(input.worktree, input.commands, run);
    let mut reasons = det.failures.clone();

    let (design_consistent, context_aligned) =
        match judge_semantics(input.task_title, input.adr_context, input.diff, llm) {
            Ok(v) => {
                if !v.design_consistent {
                    reasons.push(("design".to_string(), v.design_reason));
                }
                if !v.context_aligned {
                    reasons.push(("context".to_string(), v.context_reason));
                }
                (v.design_consistent, v.context_aligned)
            }
            // No assumed-green: a judge that can't run reds BOTH subjective gates,
            // with the failure attached to each so the rejection's reasons line up
            // with review()'s failed_gates list rather than guessing pass.
            Err(e) => {
                let why = format!("judge unavailable: {e}");
                reasons.push(("design".to_string(), why.clone()));
                reasons.push(("context".to_string(), why));
                (false, false)
            }
        };

    let gates = GateResults {
        tests_pass: det.tests_pass,
        lint_pass: det.lint_pass,
        types_pass: det.types_pass,
        design_consistent,
        context_aligned,
    };
    let verdict = review(&gates, input.reviewer_id, input.implementer_id);
    BranchReview {
        gates,
        verdict,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_run(_: &Path, _: &str, _: &[String]) -> CommandRun {
        CommandRun {
            success: true,
            output: String::new(),
        }
    }

    /// All-pass JSON verdict from the model.
    fn green_llm(_: &str) -> Result<String, String> {
        Ok(r#"{"design_consistent":true,"design_reason":"ok",
               "context_aligned":true,"context_reason":"ok"}"#
            .to_string())
    }

    fn full_rust_commands() -> Vec<GateCommand> {
        vec![
            GateCommand::new(GateKind::Tests, "cargo", &["test"]),
            GateCommand::new(GateKind::Lint, "cargo", &["clippy"]),
            GateCommand::new(GateKind::Types, "cargo", &["check"]),
        ]
    }

    fn inputs<'a>(
        commands: &'a [GateCommand],
        reviewer: &'a str,
        implementer: &'a str,
    ) -> ReviewInputs<'a> {
        ReviewInputs {
            worktree: Path::new("."),
            task_title: "add a greeting",
            adr_context: "language: rust",
            diff: "+pub fn greet() {}",
            reviewer_id: reviewer,
            implementer_id: implementer,
            commands,
        }
    }

    #[test]
    fn green_gates_and_green_judge_with_distinct_reviewer_merges() {
        let cmds = full_rust_commands();
        let r = review_branch(&inputs(&cmds, "reviewer", "worker-a"), ok_run, green_llm);
        assert!(r.gates.all_green());
        assert_eq!(r.verdict, ReviewVerdict::Merge);
        assert!(r.reasons.is_empty());
    }

    #[test]
    fn a_failing_deterministic_gate_rejects_with_its_reason() {
        let cmds = full_rust_commands();
        let run = |_: &Path, _: &str, args: &[String]| {
            if args == ["clippy"] {
                CommandRun {
                    success: false,
                    output: "error: needless clone".to_string(),
                }
            } else {
                CommandRun {
                    success: true,
                    output: String::new(),
                }
            }
        };
        let r = review_branch(&inputs(&cmds, "reviewer", "worker-a"), run, green_llm);
        assert!(!r.gates.lint_pass);
        assert_eq!(
            r.verdict,
            ReviewVerdict::Reject {
                failed_gates: vec!["lint".to_string()]
            }
        );
        assert!(r
            .reasons
            .iter()
            .any(|(g, why)| g == "lint" && why.contains("needless clone")));
    }

    #[test]
    fn a_failing_subjective_gate_rejects_with_the_models_reason() {
        let cmds = full_rust_commands();
        let llm = |_: &str| {
            Ok(r#"{"design_consistent":true,"design_reason":"ok",
                   "context_aligned":false,"context_reason":"ignores the task"}"#
                .to_string())
        };
        let r = review_branch(&inputs(&cmds, "reviewer", "worker-a"), ok_run, llm);
        assert!(!r.gates.context_aligned);
        assert_eq!(
            r.verdict,
            ReviewVerdict::Reject {
                failed_gates: vec!["context".to_string()]
            }
        );
        assert!(r
            .reasons
            .iter()
            .any(|(g, why)| g == "context" && why.contains("ignores")));
    }

    #[test]
    fn an_unrunnable_judge_reds_both_subjective_gates_no_assumed_green() {
        let cmds = full_rust_commands();
        let r = review_branch(&inputs(&cmds, "reviewer", "worker-a"), ok_run, |_| {
            Err("model offline".to_string())
        });
        assert!(r.gates.tests_pass && r.gates.lint_pass && r.gates.types_pass);
        assert!(!r.gates.design_consistent && !r.gates.context_aligned);
        assert_eq!(
            r.verdict,
            ReviewVerdict::Reject {
                failed_gates: vec!["design".to_string(), "context".to_string()]
            }
        );
        // The judge failure is attached to BOTH subjective gates so the reasons
        // line up with the failed_gates list.
        assert!(r
            .reasons
            .iter()
            .any(|(g, w)| g == "design" && w.contains("model offline")));
        assert!(r
            .reasons
            .iter()
            .any(|(g, w)| g == "context" && w.contains("model offline")));
    }

    #[test]
    fn unconfigured_deterministic_gates_block_merge_even_with_a_green_judge() {
        // No commands at all (e.g. a docs-only worktree): every deterministic
        // gate is a failure, so even a passing judge cannot merge.
        let r = review_branch(&inputs(&[], "reviewer", "worker-a"), ok_run, green_llm);
        assert!(!r.gates.tests_pass && !r.gates.lint_pass && !r.gates.types_pass);
        assert!(matches!(r.verdict, ReviewVerdict::Reject { .. }));
    }

    #[test]
    fn self_review_is_blocked_even_when_everything_is_green() {
        let cmds = full_rust_commands();
        let r = review_branch(&inputs(&cmds, "worker-a", "worker-a"), ok_run, green_llm);
        assert!(r.gates.all_green());
        assert_eq!(r.verdict, ReviewVerdict::SelfReviewBlocked);
    }

    #[test]
    fn detects_rust_then_node_then_both_then_neither() {
        let rust = tempfile::tempdir().unwrap();
        std::fs::write(rust.path().join("Cargo.toml"), "[package]").unwrap();
        let rc = detect_gate_commands(rust.path());
        assert_eq!(rc.len(), 3);
        assert!(rc.iter().all(|c| c.program == "cargo"));

        let node = tempfile::tempdir().unwrap();
        std::fs::write(
            node.path().join("package.json"),
            r#"{"scripts":{"test":"vitest","lint":"biome check .","typecheck":"tsc --noEmit"}}"#,
        )
        .unwrap();
        let nc = detect_gate_commands(node.path());
        assert_eq!(nc.len(), 3);
        assert!(nc.iter().all(|command| {
            command.program.to_ascii_lowercase().contains("pnpm")
                || (command.program.to_ascii_lowercase().contains("corepack")
                    && command.args.first().map(String::as_str) == Some("pnpm"))
        }));

        let both = tempfile::tempdir().unwrap();
        std::fs::write(both.path().join("Cargo.toml"), "[package]").unwrap();
        std::fs::write(
            both.path().join("package.json"),
            r#"{"scripts":{"test":"vitest","check":"biome check .","typecheck":"tsc --noEmit"}}"#,
        )
        .unwrap();
        assert_eq!(detect_gate_commands(both.path()).len(), 6);

        let empty = tempfile::tempdir().unwrap();
        assert!(detect_gate_commands(empty.path()).is_empty());
    }

    #[test]
    fn standard_tauri_repo_uses_nested_cargo_and_declared_node_tools() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir(repo.path().join("src-tauri")).unwrap();
        std::fs::write(
            repo.path().join("src-tauri").join("Cargo.toml"),
            "[package]",
        )
        .unwrap();
        std::fs::write(
            repo.path().join("package.json"),
            r#"{"scripts":{"test":"vitest","check":"biome check ."}}"#,
        )
        .unwrap();
        std::fs::write(repo.path().join("tsconfig.json"), "{}").unwrap();

        let commands = detect_gate_commands(repo.path());
        assert_eq!(commands.len(), 6);
        let cargo = commands
            .iter()
            .filter(|command| command.program == "cargo")
            .collect::<Vec<_>>();
        assert_eq!(cargo.len(), 3);
        assert!(cargo.iter().all(|command| {
            command
                .args
                .windows(2)
                .any(|pair| pair == ["--manifest-path", "src-tauri/Cargo.toml"])
        }));
        let node = commands
            .iter()
            .filter(|command| command.program != "cargo")
            .collect::<Vec<_>>();
        assert_eq!(node.len(), 3);
        assert!(node
            .iter()
            .any(|command| { command.args.ends_with(&["run".into(), "check".into()]) }));
        assert!(node.iter().any(|command| {
            command
                .args
                .ends_with(&["exec".into(), "tsc".into(), "--noEmit".into()])
        }));
    }

    #[test]
    fn current_aelyris_layout_is_fully_gate_detectable() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has repository parent");
        let commands = detect_gate_commands(root);
        for gate in [GateKind::Tests, GateKind::Lint, GateKind::Types] {
            assert!(
                commands.iter().any(|command| command.kind == gate),
                "missing {gate:?} command: {commands:?}"
            );
        }
        assert!(commands.iter().any(|command| {
            command.program == "cargo"
                && command
                    .args
                    .windows(2)
                    .any(|pair| pair == ["--manifest-path", "src-tauri/Cargo.toml"])
        }));
        assert!(commands.iter().any(|command| {
            command.kind == GateKind::Lint
                && command
                    .args
                    .ends_with(&["run".into(), "lint".into()])
        }));
    }

    #[test]
    fn node_gate_falls_back_to_resolved_corepack_when_pnpm_shim_is_missing() {
        let command = pnpm_gate_command_with(GateKind::Tests, &["test"], |name| match name {
            "pnpm" => "pnpm".into(),
            "corepack" => "corepack.cmd".into(),
            _ => name.into(),
        });
        assert_eq!(command.program, "corepack.cmd");
        assert_eq!(command.args, ["pnpm", "test"]);
    }
}
