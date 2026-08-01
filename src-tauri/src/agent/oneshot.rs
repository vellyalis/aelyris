//! One-shot `claude -p` invocation shared by the autonomous PLANNER (goal
//! decomposition) and REVIEWER (semantic judge). Both inject an
//! `Fn(&str) -> Result<String, String>` LLM into pure, unit-tested logic; this is
//! the single real adapter they share at the call site, so there is exactly one
//! place that knows how to spawn the CLI (Windows shim resolution + hidden
//! window) and map a non-zero exit to an error. Blocking — a subprocess call, so
//! callers must keep it off the async runtime.

use super::platform_cli_program;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct EphemeralReviewSchema(PathBuf);

impl EphemeralReviewSchema {
    fn write(invocation_id: &str) -> Result<Self, String> {
        let path =
            std::env::temp_dir().join(format!("aelyris-a7-review-schema-{invocation_id}.json"));
        std::fs::write(&path, crate::review::mission::A7_REVIEW_OUTPUT_SCHEMA)
            .map_err(|error| format!("failed to write fixed reviewer output schema: {error}"))?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for EphemeralReviewSchema {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn codex_a7_review_command(prompt: &str, output_schema_path: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        // npm's `codex.cmd` cannot safely receive a multiline prompt through
        // `Command::args`: modern Rust rejects the ambiguous batch escaping,
        // and older launchers could truncate at the first newline. Reuse the
        // visible-agent transport contract: invoke the PowerShell 7 shim and
        // keep the prompt in a process-local environment variable. The logical
        // Codex argv remains the fixed contract attested by the durable receipt.
        let cli_program = super::interactive::platform_powershell_cli_program("codex");
        let mut script = format!("& {}", super::interactive::ps_single_quote(&cli_program));
        for arg in [
            "exec",
            "-m",
            crate::review::mission::A7_REVIEW_MODEL,
            "--ephemeral",
            "--ignore-user-config",
            "-s",
            "read-only",
            "--skip-git-repo-check",
            "--output-schema",
        ] {
            script.push(' ');
            script.push_str(&super::interactive::ps_single_quote(arg));
        }
        script.push(' ');
        script.push_str(&super::interactive::ps_single_quote(
            &output_schema_path.to_string_lossy(),
        ));
        script.push_str(" $env:AELYRIS_A7_REVIEW_PROMPT; exit $LASTEXITCODE");

        let mut command = crate::process::hidden_command(platform_cli_program("pwsh"));
        command
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
            .arg(script)
            .env("AELYRIS_A7_REVIEW_PROMPT", prompt);
        command
    }

    #[cfg(not(windows))]
    {
        let mut command = crate::process::hidden_command(platform_cli_program("codex"));
        command
            .arg("exec")
            .arg("-m")
            .arg(crate::review::mission::A7_REVIEW_MODEL)
            .arg("--ephemeral")
            .arg("--ignore-user-config")
            .arg("-s")
            .arg("read-only")
            .arg("--skip-git-repo-check")
            .arg("--output-schema")
            .arg(output_schema_path)
            .arg(prompt);
        command
    }
}

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

/// Fixed A7.3 reviewer adapter. The caller supplies only the prompt: provider,
/// model, config isolation, sandbox, and ephemeral-session policy are backend
/// constants. The attestation is minted only after the real process exits
/// successfully, so a random identity can never stand in for an invocation.
pub fn codex_a7_review_oneshot(prompt: &str) -> Result<crate::review::ReviewerInvocation, String> {
    let invocation_id = uuid::Uuid::now_v7().to_string();
    let cwd = std::env::temp_dir();
    let output_schema = EphemeralReviewSchema::write(&invocation_id)?;
    let argv_contract_digest = crate::review::mission::a7_review_argv_contract_digest();
    let prompt_digest = format!("{:x}", Sha256::digest(prompt.as_bytes()));
    let command_fingerprint = format!(
        "{:x}",
        Sha256::digest(format!("{argv_contract_digest}:{prompt_digest}").as_bytes())
    );
    let mut command = codex_a7_review_command(prompt, output_schema.path());
    command.current_dir(&cwd);
    let started_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "reviewer process clock is before Unix epoch".to_string())?
        .as_millis()
        .try_into()
        .map_err(|_| "reviewer process start time exceeds u64".to_string())?;
    let out = crate::process::run_supervised(
        &mut command,
        &crate::process::SupervisedCommandConfig::default(),
    )
    .map_err(|error| format!("failed to spawn fixed Codex reviewer: {error}"))?;
    if out.status != crate::process::SupervisedCommandStatus::Exited || out.exit_code != Some(0) {
        return Err(format!(
            "fixed Codex reviewer did not exit successfully ({:?}, {:?}): {}",
            out.status,
            out.exit_code,
            String::from_utf8_lossy(&out.stderr_tail).trim()
        ));
    }
    if out.stdout_truncated || out.stderr_truncated {
        return Err("fixed Codex reviewer exceeded bounded output".to_string());
    }
    let response = String::from_utf8_lossy(&out.stdout_tail).to_string();
    if response.trim().is_empty() {
        return Err("fixed Codex reviewer returned empty stdout".to_string());
    }
    let ended_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "reviewer process clock is before Unix epoch".to_string())?
        .as_millis()
        .try_into()
        .map_err(|_| "reviewer process end time exceeds u64".to_string())?;
    let receipt = crate::review::ReviewerInvocationReceipt::from_successful_fixed_process(
        invocation_id,
        command_fingerprint,
        argv_contract_digest,
        &response,
        started_at_unix_ms,
        ended_at_unix_ms,
        out.exit_code
            .expect("successful reviewer exit code was checked"),
        "exited",
    )?;
    Ok(crate::review::ReviewerInvocation::from_receipt(receipt))
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn a7_3_windows_fixed_reviewer_keeps_multiline_prompt_out_of_batch_arguments() {
        use std::ffi::OsStr;

        let prompt = "first line\nsecond 'quoted' line";
        let schema_path = std::path::Path::new(r"C:\Temp\aelyris-a7-review-schema.json");
        let command = super::codex_a7_review_command(prompt, schema_path);
        let program = command.get_program().to_string_lossy().to_ascii_lowercase();
        assert!(
            program.ends_with("pwsh.exe") || program == "pwsh",
            "program: {program}"
        );

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let script = args.last().expect("PowerShell command script");
        assert!(script.contains("codex"), "script: {script}");
        assert!(script.contains("'exec'"), "script: {script}");
        assert!(script.contains("'gpt-5.6-sol'"), "script: {script}");
        assert!(script.contains("'--ephemeral'"), "script: {script}");
        assert!(
            script.contains("'--ignore-user-config'"),
            "script: {script}"
        );
        assert!(script.contains("'read-only'"), "script: {script}");
        assert!(script.contains("'--output-schema'"), "script: {script}");
        assert!(
            script.contains("'C:\\Temp\\aelyris-a7-review-schema.json'"),
            "script: {script}"
        );
        assert!(script.contains("$env:AELYRIS_A7_REVIEW_PROMPT"));
        assert!(!script.contains(prompt));
        assert!(args.iter().any(|arg| arg == "-NonInteractive"));

        let prompt_env = command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new("AELYRIS_A7_REVIEW_PROMPT"))
            .and_then(|(_, value)| value)
            .expect("process-local reviewer prompt");
        assert_eq!(prompt_env, OsStr::new(prompt));
    }
}
