//! Real-LLM + real-gate proof of the autonomous REVIEWER tier: stand up a tiny
//! Rust crate, have a "worker" add a passing integration test on a feature
//! branch, then run the EXACT `review::review_branch` the `review_branch` command
//! uses — real `cargo test` / `cargo clippy` / `cargo check` in the worktree plus
//! a real `claude` semantic judge over the diff — and print the verdict. Proves
//! "the Reviewer decides on evidence, not a hand-canned green" independently of
//! the GUI (the counterpart to `plan_demo` for the planning tier).
//!
//! Run: cargo run --example review_demo

use std::path::{Path, PathBuf};

use aether_terminal_lib::agent::claude_oneshot;
use aether_terminal_lib::git::diff_three_dot;
use aether_terminal_lib::process::hidden_command;
use aether_terminal_lib::review::{detect_gate_commands, review_branch, spawn_run, ReviewInputs};

fn git(cwd: &Path, args: &[&str]) {
    let out = hidden_command("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    if !out.status.success() {
        panic!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, contents).unwrap();
}

fn main() {
    // A unique scratch dir (no Date/random needed — the process id is enough).
    let root = std::env::temp_dir().join(format!("aether-review-demo-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let repo = root.join("crate");
    std::fs::create_dir_all(&repo).unwrap();

    // Base crate on `main`: an empty lib + manifest, committed.
    write(
        &repo.join("Cargo.toml"),
        "[package]\nname = \"greeting-demo\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    );
    write(&repo.join("src/lib.rs"), "//! greeting demo crate\n");
    git(&repo, &["init", "-b", "main"]);
    git(&repo, &["config", "user.email", "demo@aether.test"]);
    git(&repo, &["config", "user.name", "Demo"]);
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-m", "init crate"]);

    // The worker's worktree for its feature branch.
    let branch = "feat/greeting";
    let worktree: PathBuf = root.join("crate-feat/greeting");
    git(
        &repo,
        &["worktree", "add", worktree.to_str().unwrap(), "-b", branch],
    );

    // The "worker" writes a passing, clippy-clean integration test, then commits.
    let task_title = "Add an integration test under tests/ named greeting.rs that asserts a \
friendly greeting string is non-empty and mentions a friend. Only create that file.";
    // Compute the string at runtime (not a bare literal) so the strict
    // `clippy -- -D warnings` gate doesn't flag `is_empty()` on a const.
    write(
        &worktree.join("tests/greeting.rs"),
        "fn greet() -> String {\n    String::from(\"hello, friend\")\n}\n\n\
#[test]\nfn greeting_is_friendly() {\n    let g = greet();\n    \
assert!(!g.is_empty());\n    assert!(g.contains(\"friend\"));\n}\n",
    );
    git(&worktree, &["add", "-A"]);
    git(&worktree, &["commit", "-m", "worker-a: add greeting test"]);

    // Reviewer inputs: the diff (three-dot) + the shared decisions (ADRs).
    let diff = diff_three_dot(repo.to_str().unwrap(), "main", branch, 12_000)
        .expect("compute branch diff");
    let adr = "- language: rust\n- style: concise and friendly";
    let commands = detect_gate_commands(&worktree);

    println!("REVIEWING branch `{branch}` (real cargo gates + real claude judge)\n");
    println!("gate commands detected: {}", commands.len());
    for c in &commands {
        println!("  - {} {}", c.program, c.args.join(" "));
    }
    println!("\n(running gates in the worktree + asking claude to judge the diff...)\n");

    let input = ReviewInputs {
        worktree: &worktree,
        task_title,
        adr_context: adr,
        diff: &diff,
        reviewer_id: "reviewer",
        implementer_id: "worker-a",
        commands: &commands,
    };
    let result = review_branch(&input, spawn_run, |prompt| claude_oneshot(prompt, "sonnet"));

    let g = &result.gates;
    println!(
        "gates: tests={} lint={} types={} design={} context={}",
        g.tests_pass, g.lint_pass, g.types_pass, g.design_consistent, g.context_aligned
    );
    println!("verdict: {:?}", result.verdict);
    if !result.reasons.is_empty() {
        println!("reasons:");
        for (gate, reason) in &result.reasons {
            println!("  [{gate}] {reason}");
        }
    }

    // Clean up the worktree + scratch dir.
    let _ = hidden_command("git")
        .args(["worktree", "remove", "--force", worktree.to_str().unwrap()])
        .current_dir(&repo)
        .output();
    let _ = std::fs::remove_dir_all(&root);

    match result.verdict {
        aether_terminal_lib::review::ReviewVerdict::Merge => {
            println!(
                "\nEND-TO-END: real gates green + judge green + reviewer != implementer -> MERGE."
            );
        }
        other => {
            eprintln!("\nReviewer did NOT clear the branch (no assumed-green): {other:?}");
            std::process::exit(1);
        }
    }
}
