//! Real-LLM proof of the autonomous PLANNING tier: decompose a one-line goal
//! with `claude`, run it through the validator, and print the resulting plan.
//! This exercises the exact `decompose_to_plan` the `plan_build` command uses
//! (real model -> JSON parse -> validate, self-correcting on rejection), proving
//! "LLM authors a valid build plan" independently of the GUI.
//!
//! Run: cargo run --example plan_demo -- "build a tiny todo CLI in Rust"

use aether_terminal_lib::task::decompose_to_plan;

fn main() {
    let goal = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "build a tiny todo CLI in Rust with add/list/done commands".to_string());

    let llm = |prompt: &str| -> Result<String, String> {
        let out = std::process::Command::new("claude")
            .arg("-p")
            .arg(prompt)
            .arg("--model")
            .arg("sonnet")
            .output()
            .map_err(|e| format!("spawn claude: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    };

    println!("GOAL: {goal}\n(decomposing with claude — real LLM call...)\n");
    match decompose_to_plan(
        &goal,
        "A small Rust project; tests run with cargo test.",
        llm,
        3,
    ) {
        Ok(tasks) => {
            println!("VALID PLAN — {} tasks, in dependency order:\n", tasks.len());
            for (i, t) in tasks.iter().enumerate() {
                println!(
                    "  {}. {} [owner={}] outputs={:?} deps={:?}",
                    i + 1,
                    t.id,
                    t.owner.as_deref().unwrap_or("?"),
                    t.outputs,
                    t.dependencies,
                );
                println!("     {}", t.title.chars().take(100).collect::<String>());
            }
        }
        Err(e) => {
            eprintln!("PLAN FAILED (no fallback): {e}");
            std::process::exit(1);
        }
    }
}
