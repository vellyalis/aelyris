//! One-shot `claude -p` invocation shared by the autonomous PLANNER (goal
//! decomposition) and REVIEWER (semantic judge). Both inject an
//! `Fn(&str) -> Result<String, String>` LLM into pure, unit-tested logic; this is
//! the single real adapter they share at the call site, so there is exactly one
//! place that knows how to spawn the CLI (Windows shim resolution + hidden
//! window) and map a non-zero exit to an error. Blocking — a subprocess call, so
//! callers must keep it off the async runtime.

use super::platform_cli_program;

/// Run `claude -p <prompt> --model <model>` once and return its stdout. Errors if
/// the process cannot spawn or exits non-zero (stderr included), so a failed
/// model call is never silently treated as an empty/valid response.
pub fn claude_oneshot(prompt: &str, model: &str) -> Result<String, String> {
    let program = platform_cli_program("claude");
    let out = crate::process::hidden_command(&program)
        .arg("-p")
        .arg(prompt)
        .arg("--model")
        .arg(model)
        .output()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
