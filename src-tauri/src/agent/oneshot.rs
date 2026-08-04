//! One-shot agent CLI adapters used by the autonomous planner and reviewers.
//! The planner selects an installed provider through the existing model/CLI
//! mapping instead of assuming Claude is present. Pure planning and review logic
//! still receive an injected `Fn(&str) -> Result<String, String>`; this module is
//! the only process-spawn boundary. Blocking — callers must keep it off the async
//! runtime.

use super::platform_cli_program;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
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
        let cli_program = super::interactive::platform_codex_program();
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

fn claude_oneshot_at(
    prompt: &str,
    model: &str,
    current_dir: Option<&Path>,
) -> Result<String, String> {
    let program = platform_cli_program("claude");
    let mut command = crate::process::hidden_command(&program);
    command
        .arg("-p")
        .arg(prompt)
        .arg("--model")
        .arg(model)
        .stdin(Stdio::null());
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    let out = command
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

/// Run `claude -p <prompt> --model <model>` once and return its stdout. Errors if
/// the process cannot spawn or exits non-zero (stderr included), so a failed
/// model call is never silently treated as an empty/valid response.
pub fn claude_oneshot(prompt: &str, model: &str) -> Result<String, String> {
    claude_oneshot_at(prompt, model, None)
}

fn codex_planner_command(prompt: &str, repo_root: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        // Keep the multiline prompt out of argv. PowerShell resolves either the
        // native Codex executable or npm shim, while stdin is closed so `codex
        // exec` never waits for an additional piped prompt.
        let cli_program = super::interactive::platform_codex_program();
        let mut script = format!("& {}", super::interactive::ps_single_quote(&cli_program));
        for arg in [
            "-c",
            "model_reasoning_effort=\"medium\"",
            "-s",
            "read-only",
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--disable",
            "hooks",
            "--skip-git-repo-check",
            "--color",
            "never",
        ] {
            script.push(' ');
            script.push_str(&super::interactive::ps_single_quote(arg));
        }
        script.push_str(" $env:AELYRIS_PLANNER_PROMPT; exit $LASTEXITCODE");

        let mut command = crate::process::hidden_command(platform_cli_program("pwsh"));
        command
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
            .arg(script)
            .env("AELYRIS_PLANNER_PROMPT", prompt)
            .current_dir(repo_root)
            .stdin(Stdio::null());
        command
    }

    #[cfg(not(windows))]
    {
        let mut command = crate::process::hidden_command(platform_cli_program("codex"));
        command
            .arg("-c")
            .arg("model_reasoning_effort=\"medium\"")
            .arg("-s")
            .arg("read-only")
            .arg("exec")
            .arg("--ephemeral")
            .arg("--ignore-user-config")
            .arg("--ignore-rules")
            .arg("--disable")
            .arg("hooks")
            .arg("--skip-git-repo-check")
            .arg("--color")
            .arg("never")
            .arg(prompt)
            .current_dir(repo_root)
            .stdin(Stdio::null());
        command
    }
}

fn codex_planner_oneshot(prompt: &str, repo_root: &Path) -> Result<String, String> {
    let out = codex_planner_command(prompt, repo_root)
        .output()
        .map_err(|error| format!("failed to spawn codex planner: {error}"))?;
    if !out.status.success() {
        return Err(format!(
            "codex planner exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let response = String::from_utf8_lossy(&out.stdout).to_string();
    if response.trim().is_empty() {
        return Err("codex planner returned empty stdout".to_string());
    }
    Ok(response)
}

/// Provider-selected one-shot adapter for goal decomposition. The selected
/// model is also assigned to generated worker tasks by the caller, so planning
/// and visible execution do not silently switch back to an unavailable CLI.
pub fn planner_oneshot(prompt: &str, model: &str, repo_root: &Path) -> Result<String, String> {
    let model = super::interactive::resolve_agent_model(model);
    match super::interactive::AgentCli::from_model(&model) {
        super::interactive::AgentCli::Codex => codex_planner_oneshot(prompt, repo_root),
        super::interactive::AgentCli::Claude => claude_oneshot_at(prompt, &model, Some(repo_root)),
        super::interactive::AgentCli::Gemini => {
            Err("Gemini planner one-shot is not wired; choose codex or a Claude model".to_string())
        }
        super::interactive::AgentCli::Custom(_) => {
            Err("custom CLIs cannot own autonomous planning".to_string())
        }
    }
}

/// Provider-selected read-only adapter for semantic branch review. Planning and
/// review deliberately share the same one-shot process boundary; the prompt
/// contract and parser remain owned by their respective domain modules.
pub fn reviewer_oneshot(prompt: &str, model: &str, repo_root: &Path) -> Result<String, String> {
    planner_oneshot(prompt, model, repo_root)
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
    fn windows_codex_planner_keeps_multiline_prompt_out_of_arguments() {
        use std::ffi::OsStr;

        let prompt = "first line\nsecond 'quoted' line";
        let repo_root = std::path::Path::new(r"C:\Temp\planner-repo");
        let command = super::codex_planner_command(prompt, repo_root);
        let program = command.get_program().to_string_lossy().to_ascii_lowercase();
        assert!(
            program.ends_with("pwsh.exe") || program == "pwsh",
            "program: {program}"
        );
        assert_eq!(command.get_current_dir(), Some(repo_root));

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let script = args.last().expect("PowerShell command script");
        assert!(script.contains("codex"), "script: {script}");
        assert!(script.contains("'exec'"), "script: {script}");
        assert!(script.contains("'--ignore-rules'"), "script: {script}");
        assert!(
            script.contains("'model_reasoning_effort=\"medium\"'"),
            "script: {script}"
        );
        assert!(script.contains("'read-only'"), "script: {script}");
        assert!(script.contains("$env:AELYRIS_PLANNER_PROMPT"));
        assert!(!script.contains(prompt));

        let prompt_env = command
            .get_envs()
            .find(|(name, _)| *name == OsStr::new("AELYRIS_PLANNER_PROMPT"))
            .and_then(|(_, value)| value)
            .expect("process-local planner prompt");
        assert_eq!(prompt_env, OsStr::new(prompt));
    }

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
