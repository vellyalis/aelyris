use crate::proofbook::ledger::{ProofbookRunError, ProofbookStepOutcome, ProofbookStepStatus};
use crate::proofbook::{ProofbookError, ProofbookStep};
use serde_json::json;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

pub fn execute_wait_for_step(
    project_root: &Path,
    step: &ProofbookStep,
) -> Result<ProofbookStepOutcome, ProofbookError> {
    let Some(path) = crate::proofbook::step_shell::string_param(step, "path")
        .or_else(|| crate::proofbook::step_shell::string_param(step, "artifact"))
    else {
        return Ok(ProofbookStepOutcome::failed(
            "missing_wait_target",
            "waitFor step requires path or artifact",
        ));
    };
    let interval_ms = crate::proofbook::step_shell::u64_param(step, "intervalMs").unwrap_or(250);
    let timeout_ms = crate::proofbook::step_shell::u64_param(step, "timeoutMs").unwrap_or(5_000);
    let interval = Duration::from_millis(interval_ms.max(10));
    let timeout = Duration::from_millis(timeout_ms.max(10));
    let target = crate::proofbook::step_shell::resolve_under_root(project_root, &path)?;
    let started = Instant::now();

    while started.elapsed() <= timeout {
        if target.exists() {
            return Ok(ProofbookStepOutcome {
                status: ProofbookStepStatus::Passed,
                structured_output: Some(json!({
                    "path": crate::proofbook::ledger::normalize_path(&target),
                    "elapsedMs": started.elapsed().as_millis() as u64,
                })),
                ..ProofbookStepOutcome::passed()
            });
        }
        thread::sleep(interval);
    }

    Ok(ProofbookStepOutcome {
        status: ProofbookStepStatus::Failed,
        structured_output: Some(json!({
            "path": crate::proofbook::ledger::normalize_path(&target),
            "timeoutMs": timeout_ms,
            "intervalMs": interval_ms,
        })),
        error: Some(ProofbookRunError::new(
            "wait_timeout",
            format!("waitFor timed out waiting for {path}"),
        )),
        ..ProofbookStepOutcome::passed()
    })
}
