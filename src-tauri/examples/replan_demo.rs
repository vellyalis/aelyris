//! Real-LLM proof of MID-RUN RE-PLANNING (autonomy gap #3): a task that failed
//! its retry budget is re-decomposed by the Planner into subtasks and spliced
//! into the live graph — its blocked dependent rewired onto the new subtask sinks
//! — so the build resumes itself instead of stalling on a human alert. Exercises
//! the exact `decompose_to_plan` + `replan_into` the `replan_task` command uses,
//! GUI-independent (the counterpart to plan_demo/review_demo).
//!
//! Run: cargo run --example replan_demo

use aether_terminal_lib::agent::claude_oneshot;
use aether_terminal_lib::task::{decompose_to_plan, replan_into, Task, TaskGraph, TaskStatus};

fn main() {
    // A graph where `build-api` FAILED and `wire-ui` is blocked waiting on it.
    let mut graph = TaskGraph::new();
    graph
        .add(Task::new(
            "build-api",
            "Build a small HTTP API with a /health and a /greeting endpoint in Rust.",
        ))
        .unwrap();
    graph
        .add(
            Task::new("wire-ui", "Call the API from a tiny CLI client")
                .with_dependencies(["build-api".into()]),
        )
        .unwrap();
    graph.transition("build-api", TaskStatus::Ready).unwrap();
    graph.transition("build-api", TaskStatus::Running).unwrap();
    graph.transition("build-api", TaskStatus::Failed).unwrap();
    graph.recompute_ready();
    assert_eq!(
        graph.get("wire-ui").unwrap().status,
        TaskStatus::Blocked,
        "the dependent is blocked while build-api is failed"
    );

    println!(
        "BEFORE re-plan: build-api=failed, wire-ui={:?} (deps={:?})\n",
        graph.get("wire-ui").unwrap().status,
        graph.get("wire-ui").unwrap().dependencies
    );
    println!("(asking claude to RE-DECOMPOSE the failed task — real LLM call...)\n");

    let failed = graph.get("build-api").unwrap().clone();
    let goal = format!(
        "A previous task FAILED repeatedly and must be RE-DECOMPOSED into smaller, independently \
implementable subtasks that TOGETHER accomplish it. Original task 'build-api': {}\n\
Give every subtask a NEW unique id prefixed with 'build-api-' so it cannot collide with an \
existing task.",
        failed.title
    );
    let context = "- language: rust\n- style: small, tested modules";

    let subtasks = match decompose_to_plan(&goal, context, |p| claude_oneshot(p, "sonnet"), 3) {
        Ok(tasks) => tasks,
        Err(e) => {
            eprintln!("RE-PLAN FAILED (no fallback): {e}");
            std::process::exit(1);
        }
    };

    let outcome = match replan_into(&mut graph, "build-api", subtasks) {
        Ok(o) => o,
        Err(errs) => {
            eprintln!("SPLICE REJECTED: {}", errs.join("; "));
            std::process::exit(1);
        }
    };

    println!(
        "AFTER re-plan — {} subtasks spliced in:",
        outcome.subtask_ids.len()
    );
    for id in &outcome.subtask_ids {
        let t = graph.get(id).unwrap();
        println!("  {} [{:?}] deps={:?}", id, t.status, t.dependencies);
    }
    let wire = graph.get("wire-ui").unwrap();
    println!(
        "\nwire-ui rewired: deps now {:?} (status {:?})",
        wire.dependencies, wire.status
    );

    // The dependent must now wait on the re-planned subtasks, not the dead task.
    let rewired_onto_subtasks = wire
        .dependencies
        .iter()
        .all(|d| outcome.subtask_ids.contains(d))
        && !wire.dependencies.is_empty();
    if outcome.rewired_dependents == ["wire-ui"] && rewired_onto_subtasks {
        println!(
            "\nEND-TO-END: failed task re-decomposed + dependent rewired onto the subtask sinks. \
The loop resumes through the new work — no human alert as the terminal action."
        );
    } else {
        eprintln!("\nUNEXPECTED: dependent was not rewired onto the subtasks");
        std::process::exit(1);
    }
}
