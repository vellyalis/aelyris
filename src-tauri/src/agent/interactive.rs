use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Resolve a CLI command name to the Windows shim that CreateProcess can run.
///
/// npm-style packages often install both an extensionless Unix shim and a
/// `.cmd` shim on Windows. `CreateProcessW` can pick the extensionless file and
/// fail with ERROR_BAD_EXE_FORMAT, so prefer native launcher extensions when
/// they are present on PATH.
pub fn platform_cli_program(name: &str) -> String {
    #[cfg(windows)]
    {
        if has_windows_executable_extension(name) {
            return name.to_string();
        }

        if let Some(candidate) = resolve_windows_cli_program(name) {
            return candidate;
        }
    }

    name.to_string()
}

#[cfg(windows)]
fn has_windows_executable_extension(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".exe") || lower.ends_with(".bat")
}

#[cfg(windows)]
fn resolve_windows_cli_program(name: &str) -> Option<String> {
    let command_path = std::path::Path::new(name);
    if command_path.components().count() > 1 {
        return command_path.is_file().then(|| name.to_string());
    }

    let path = std::env::var_os("PATH")?;
    resolve_windows_cli_program_on_path(name, &path)
}

#[cfg(windows)]
fn resolve_windows_cli_program_on_path(name: &str, path: &std::ffi::OsStr) -> Option<String> {
    for dir in std::env::split_paths(path) {
        // Respect PATH directory order first. Inside a directory, prefer a
        // native executable over npm's .cmd shim when both exist; broken npm
        // wrappers should not mask a healthy CLI binary earlier on PATH.
        for ext in ["exe", "cmd", "bat"] {
            let candidate = format!("{name}.{ext}");
            if dir.join(&candidate).is_file() {
                return Some(candidate);
            }
        }
        if dir.join(name).is_file() {
            return Some(name.to_string());
        }
    }
    None
}

/// Which AI CLI is backing this session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentCli {
    Claude,
    Gemini,
    Codex,
    Custom(String),
}

impl AgentCli {
    /// Resolve CLI binary name and base arguments for interactive mode
    pub fn program_and_args(&self, model: Option<&str>) -> (String, Vec<String>) {
        match self {
            AgentCli::Claude => {
                let mut args = Vec::new();
                if let Some(m) = model {
                    args.push("--model".to_string());
                    args.push(m.to_string());
                }
                (platform_cli_program("claude"), args)
            }
            AgentCli::Gemini => {
                // Gemini CLI interactive mode
                (platform_cli_program("gemini"), Vec::new())
            }
            AgentCli::Codex => {
                // OpenAI Codex CLI
                (platform_cli_program("codex"), Vec::new())
            }
            AgentCli::Custom(bin) => (platform_cli_program(bin), Vec::new()),
        }
    }

    /// Detect CLI type from model name string.
    /// Only known CLI types are returned — no user-controlled binary execution.
    pub fn from_model(model: &str) -> Self {
        if model.starts_with("codex") {
            AgentCli::Codex
        } else if model.starts_with("gemini") {
            AgentCli::Gemini
        } else {
            AgentCli::Claude
        }
    }

    /// Validate that this CLI is safe to execute (known binary only).
    /// Custom CLIs must be in the allowlist.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            AgentCli::Claude | AgentCli::Gemini | AgentCli::Codex => Ok(()),
            AgentCli::Custom(bin) => {
                // Reject path traversal, absolute paths, shell metacharacters
                if bin.contains('/') || bin.contains('\\') || bin.contains("..") || bin.is_empty() {
                    return Err(format!("Unsafe CLI binary name: {}", bin));
                }
                // Only allow explicitly known custom CLIs
                const ALLOWED_CUSTOM: &[&str] = &["aider", "cursor", "continue"];
                if ALLOWED_CUSTOM.contains(&bin.as_str()) {
                    Ok(())
                } else {
                    Err(format!(
                        "Unknown CLI '{}'. Allowed: {:?}",
                        bin, ALLOWED_CUSTOM
                    ))
                }
            }
        }
    }
}

/// A resolved agent CLI launch: `(program, args, environment)`.
pub type AgentLaunchSpec = (String, Vec<String>, HashMap<String, String>);

/// Auto-approve flags that make a worker run AUTONOMOUSLY in its OWN isolated
/// worktree — each CLI's equivalent of "don't stop to ask, you own this
/// worktree" (BR1 / Design Principle 1: agents write freely inside their own
/// worktree). This is the single source of truth so every spawn path
/// (`agent_command_spec`, `agent_shell_command_spec`) grants the same policy per
/// model provider, instead of only Claude getting it. Each provider gets its
/// edits-only / sandbox-confined autonomous mode, NOT a full dangerous bypass:
///
/// - Claude: `--permission-mode acceptEdits` — auto-accept file edits.
/// - Codex: `--sandbox workspace-write --ask-for-approval never` — broader than
///   edits-only: shell commands also run with no human gate, but the OS sandbox
///   confines WRITES to the workspace (NOT danger-full-access; reads/network are
///   not restricted). Codex has no edits-only mode; `on-request` would re-stall
///   an unattended fleet pane on the first command, so `never` is required.
/// - Gemini: `--approval-mode auto_edit` — auto-approve edit tools, the
///   edits-only mirror of Claude's acceptEdits (NOT `yolo`, which auto-approves
///   every tool).
///
/// A custom CLI gets no flags (no known safe auto-approve flag to assume).
fn autonomous_flags(cli: &AgentCli) -> Vec<String> {
    let owned = |parts: &[&str]| parts.iter().map(|s| s.to_string()).collect();
    match cli {
        AgentCli::Claude => owned(&["--permission-mode", "acceptEdits"]),
        AgentCli::Codex => owned(&[
            "--sandbox",
            "workspace-write",
            "--ask-for-approval",
            "never",
        ]),
        AgentCli::Gemini => owned(&["--approval-mode", "auto_edit"]),
        AgentCli::Custom(_) => Vec::new(),
    }
}

/// Default Claude model when a task carries no usable model.
const DEFAULT_AGENT_MODEL: &str = "sonnet";
/// Claude model aliases the CLI accepts directly.
const CLAUDE_MODEL_ALIASES: &[&str] = &["sonnet", "opus", "haiku", "default"];

/// Resolve a task's routed model to one a CLI will actually accept and run.
///
/// An autonomy task with no explicit `model` falls back to its `owner` — an
/// *identity* like "impl" or "reviewer", not a model. Passing that as
/// `--model impl` makes the CLI reject it ("model may not exist") and exit
/// immediately, so the agent pane flashes and dies instead of working. Map any
/// unrecognized value to the default usable model so the agent always runs.
/// Recognized: codex*/gemini*/claude* providers and the Claude aliases above.
pub fn resolve_agent_model(model: &str) -> String {
    let trimmed = model.trim();
    let lower = trimmed.to_ascii_lowercase();
    let recognized = lower.starts_with("codex")
        || lower.starts_with("gemini")
        || lower.starts_with("claude")
        || CLAUDE_MODEL_ALIASES.contains(&lower.as_str());
    if recognized {
        trimmed.to_string()
    } else {
        DEFAULT_AGENT_MODEL.to_string()
    }
}

/// Resolve a model name to the `(program, args, env)` for spawning that agent's
/// CLI as a **live interactive TUI in a visible PTY** — the AgentInspector's
/// human-driven agent terminal. Deliberately NOT `-p`: `-p`/`--print` is headless
/// ("Print response and exit") — a text dump, not the agent's live interface.
/// Omitting it runs the interactive TUI the operator watches and can talk to
/// (the native engine is `alacritty_terminal`, so the alt-screen UI renders).
///
/// Sibling launch paths, kept separate on purpose: the autonomy loop's *visible
/// fleet* uses [`agent_shell_command_spec`] (same no-`-p` interactive TUI, but
/// wrapped in a PowerShell pane with an exit-code backstop for the loop); the
/// *headless* autonomy path is [`crate::agent::claude`] (`-p --output-format
/// stream-json`, parsed for cost/tokens).
///
/// When `initial_prompt` is set it is passed as a **positional arg** (exec-style
/// argv — no shell, so no escaping), and interactive claude starts a session and
/// works on it immediately. Errors if the model maps to an unknown/unsafe CLI.
pub fn agent_command_spec(
    model: &str,
    initial_prompt: Option<&str>,
    autonomous: bool,
) -> Result<AgentLaunchSpec, String> {
    // Map an identity/unknown model (e.g. a task's owner) to a usable one so the
    // CLI never rejects `--model <identity>` and exits before doing any work.
    let model = resolve_agent_model(model);
    let model = model.as_str();
    let cli = AgentCli::from_model(model);
    cli.validate()?;
    let (program, mut args) = cli.program_and_args(Some(model));

    // Autonomous worker in its own isolated worktree: grant the per-provider
    // auto-approve policy so it can actually build without stopping at an
    // interactive permission gate (NOT a full dangerous bypass). The
    // AgentInspector passes `false` so a human keeps the approval gate.
    if autonomous {
        args.extend(autonomous_flags(&cli));
    }

    if let Some(prompt) = initial_prompt {
        match cli {
            // No -p: run the interactive TUI (visible, persistent), not the
            // headless print dump. The prompt is a positional arg so the CLI
            // starts a session and works on it immediately.
            AgentCli::Claude | AgentCli::Codex | AgentCli::Gemini => {
                args.push(prompt.to_string());
            }
            AgentCli::Custom(_) => {
                // No standard way to pass a prompt to a custom CLI.
            }
        }
    }

    let mut env = HashMap::new();
    env.insert("AETHER_AGENT_CLI".to_string(), format!("{:?}", cli));
    env.insert("AETHER_AGENT_MODEL".to_string(), model.to_string());

    Ok((program, args, env))
}

/// Quote a token for a PowerShell single-quoted string literal (doubling any
/// embedded single quote). Used to build the in-shell command line safely.
fn ps_single_quote(token: &str) -> String {
    format!("'{}'", token.replace('\'', "''"))
}

/// Launch the agent CLI **inside a visible PowerShell pane**, running its full
/// INTERACTIVE TUI — the operator's mental model: split pane → a shell starts →
/// the AI CLI is invoked in it and you watch it work live. Run via `powershell
/// -Command "& <cli> … $env:AETHER_AGENT_PROMPT; exit $LASTEXITCODE"`.
///
/// Deliberately **no `-p`**: `-p`/`--print` is headless ("Print response and
/// exit") — the operator sees only a text dump, not the agent's live interface.
/// Omitting it runs the CLI's interactive TUI, which renders in the pane (the
/// native engine is `alacritty_terminal`, so the alternate-screen full-screen UI
/// is handled) and stays open. Because an interactive session never exits, the
/// loop cannot use the PTY-exit sensor for it; completion is detected
/// structurally from the task's declared outputs appearing in the worktree (see
/// [`crate::control::pane_fleet::PaneFleet::poll_completions`]). The trailing
/// `; exit $LASTEXITCODE` is a backstop: if the CLI *does* exit (e.g. a crash),
/// PowerShell exits with its code so the PTY-exit recovery path still fires.
///
/// The prompt travels through the `AETHER_AGENT_PROMPT` env var and is referenced
/// (not interpolated) inside the command, so arbitrary prompt text needs no
/// shell escaping.
pub fn agent_shell_command_spec(
    model: &str,
    prompt: &str,
    autonomous: bool,
) -> Result<AgentLaunchSpec, String> {
    let model = resolve_agent_model(model);
    let cli = AgentCli::from_model(&model);
    cli.validate()?;
    let (cli_program, mut cli_args) = cli.program_and_args(Some(&model));
    // No -p: run the interactive TUI (visible, persistent), not headless print.
    // Autonomous fleet worker → grant the per-provider auto-approve policy so a
    // non-Claude worker (codex/gemini) builds without stalling at its own
    // permission prompt, exactly like Claude's acceptEdits.
    if autonomous {
        cli_args.extend(autonomous_flags(&cli));
    }

    let mut command = format!("& {}", ps_single_quote(&cli_program));
    for arg in &cli_args {
        command.push(' ');
        command.push_str(&ps_single_quote(arg));
    }
    command.push_str(" $env:AETHER_AGENT_PROMPT; exit $LASTEXITCODE");

    let mut env = HashMap::new();
    env.insert("AETHER_AGENT_CLI".to_string(), format!("{:?}", cli));
    env.insert("AETHER_AGENT_MODEL".to_string(), model);
    env.insert("AETHER_AGENT_PROMPT".to_string(), prompt.to_string());

    Ok((
        platform_cli_program("powershell"),
        vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-Command".to_string(),
            command,
        ],
        env,
    ))
}

/// Metadata for a live interactive agent session (PTY-based)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveSessionInfo {
    pub id: String,
    pub pty_id: String,
    pub backend: String,
    pub cli: AgentCli,
    pub status: String,
    pub model: String,
    pub initial_prompt: Option<String>,
    pub cwd: String,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub repo_path: Option<String>,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: u64,
}

/// Manages interactive agent sessions (agent-agnostic, works with any CLI)
#[derive(Clone)]
pub struct InteractiveSessionManager {
    sessions: Arc<Mutex<HashMap<String, InteractiveSessionInfo>>>,
}

impl Default for InteractiveSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractiveSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new interactive session
    pub fn register(&self, info: InteractiveSessionInfo) -> Result<(), String> {
        log::info!(
            "interactive session register id={} cli={:?} model={}",
            info.id,
            info.cli,
            info.model
        );
        self.lock_sessions()?.insert(info.id.clone(), info);
        Ok(())
    }

    /// Remove a session
    pub fn unregister(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        let removed = self.lock_sessions()?.remove(id);
        if let Some(ref info) = removed {
            log::info!(
                "interactive session unregister id={} cost=${:.2} tokens={}",
                info.id,
                info.cost,
                info.tokens_used,
            );
        }
        Ok(removed)
    }

    /// Get a single session's info
    pub fn get(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.get(id).cloned())
    }

    /// Update session status (e.g. "thinking", "coding", "idle", "done")
    pub fn update_status(&self, id: &str, status: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Interactive session not found for status update: {id}"))?;
        if session.status != status {
            log::debug!(
                "interactive session id={} status {} -> {}",
                id,
                session.status,
                status,
            );
        }
        session.status = status.to_string();
        Ok(())
    }

    /// Update cost and token usage
    pub fn update_usage(&self, id: &str, cost: f64, tokens: u64) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Interactive session not found for usage update: {id}"))?;
        session.cost = cost;
        session.tokens_used = tokens;
        Ok(())
    }

    /// List all sessions
    pub fn list(&self) -> Result<Vec<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.values().cloned().collect())
    }

    /// Number of LIVE sessions — everything except finished `"done"` ones — which
    /// is what the BR7 spawn cap must count. A session that reached `"done"` (a
    /// crashed interactive CLI, or a finished one not yet dismissed) is not
    /// occupying a live agent slot, so it must not block new spawns. `"idle"` IS
    /// live (a persistent interactive TUI waiting at its prompt). Returns 0 on a
    /// poisoned lock (fail-open, matching the cap call site).
    pub fn active_count(&self) -> usize {
        self.lock_sessions()
            .map(|sessions| sessions.values().filter(|i| i.status != "done").count())
            .unwrap_or(0)
    }

    fn lock_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, InteractiveSessionInfo>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Interactive session lock poisoned".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(id: &str, cli: AgentCli) -> InteractiveSessionInfo {
        InteractiveSessionInfo {
            id: id.to_string(),
            pty_id: format!("pty-{}", id),
            backend: "sidecar".to_string(),
            cli,
            status: "idle".to_string(),
            model: "sonnet".to_string(),
            initial_prompt: None,
            cwd: "/tmp".to_string(),
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
            cost: 0.0,
            tokens_used: 0,
            started_at: 0,
        }
    }

    #[test]
    fn register_and_list() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Claude)).unwrap();
        mgr.register(make_session("s2", AgentCli::Gemini)).unwrap();
        assert_eq!(mgr.list().unwrap().len(), 2);
    }

    #[test]
    fn active_count_excludes_done_but_keeps_idle() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Claude)).unwrap();
        mgr.register(make_session("s2", AgentCli::Gemini)).unwrap();
        assert_eq!(mgr.active_count(), 2);

        // A finished/crashed session reaches "done" but lingers in the list; it
        // must stop counting toward the live spawn cap (the BR7 leak fix).
        mgr.update_status("s2", "done").unwrap();
        assert_eq!(mgr.list().unwrap().len(), 2, "done session is still listed");
        assert_eq!(
            mgr.active_count(),
            1,
            "a done session must not occupy a live cap slot"
        );

        // "idle" is a LIVE state for a persistent interactive TUI, so it still counts.
        mgr.update_status("s1", "idle").unwrap();
        assert_eq!(mgr.active_count(), 1);
    }

    #[test]
    fn update_status_and_usage() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Claude)).unwrap();

        mgr.update_status("s1", "coding").unwrap();
        mgr.update_usage("s1", 0.42, 5000).unwrap();

        let s = mgr.get("s1").unwrap().unwrap();
        assert_eq!(s.status, "coding");
        assert_eq!(s.cost, 0.42);
        assert_eq!(s.tokens_used, 5000);
    }

    #[test]
    fn unregister_returns_session() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Codex)).unwrap();

        let removed = mgr.unregister("s1").unwrap();
        assert!(removed.is_some());
        assert_eq!(mgr.list().unwrap().len(), 0);
    }

    #[test]
    fn cli_from_model() {
        assert_eq!(AgentCli::from_model("codex-mini"), AgentCli::Codex);
        assert_eq!(AgentCli::from_model("gemini-2.5-pro"), AgentCli::Gemini);
        assert_eq!(AgentCli::from_model("opus"), AgentCli::Claude);
        assert_eq!(AgentCli::from_model("sonnet"), AgentCli::Claude);
    }

    #[test]
    fn program_and_args_claude_with_model() {
        let cli = AgentCli::Claude;
        let (prog, args) = cli.program_and_args(Some("opus"));
        assert_eq!(prog, platform_cli_program("claude"));
        assert_eq!(args, vec!["--model", "opus"]);
    }

    #[test]
    fn program_and_args_claude_no_model() {
        let cli = AgentCli::Claude;
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, platform_cli_program("claude"));
        assert!(args.is_empty());
    }

    #[test]
    fn program_and_args_codex_uses_platform_program() {
        let cli = AgentCli::Codex;
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, platform_cli_program("codex"));
        assert!(args.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_cli_resolution_respects_path_order_and_prefers_exe_within_directory() {
        // Inject the PATH value instead of mutating process env: set_var here
        // races with parallel tests that resolve programs via the real PATH.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aether-cli-resolution-{stamp}"));
        let first = root.join("first");
        let second = root.join("second");
        let third = root.join("third");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::create_dir_all(&third).unwrap();

        let name = format!("aether_cli_resolution_{stamp}");
        std::fs::write(first.join(format!("{name}.cmd")), "").unwrap();
        std::fs::write(second.join(format!("{name}.exe")), "").unwrap();
        std::fs::write(third.join(format!("{name}.cmd")), "").unwrap();
        std::fs::write(third.join(format!("{name}.exe")), "").unwrap();

        let first_then_second = std::env::join_paths([first.as_path(), second.as_path()]).unwrap();
        assert_eq!(
            resolve_windows_cli_program_on_path(&name, &first_then_second),
            Some(format!("{name}.cmd"))
        );

        let third_then_first = std::env::join_paths([third.as_path(), first.as_path()]).unwrap();
        assert_eq!(
            resolve_windows_cli_program_on_path(&name, &third_then_first),
            Some(format!("{name}.exe"))
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn program_and_args_custom() {
        let cli = AgentCli::Custom("my-agent".to_string());
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, "my-agent");
        assert!(args.is_empty());
    }

    #[test]
    fn agent_command_spec_claude_injects_model_and_interactive_prompt() {
        let (program, args, env) =
            agent_command_spec("opus", Some("build the login screen"), false).unwrap();
        assert_eq!(program, platform_cli_program("claude"));
        // No -p: the AgentInspector agent runs the INTERACTIVE TUI; the prompt is
        // a positional arg, not a headless `-p` dump.
        assert!(!args.iter().any(|a| a == "-p"), "must NOT be headless -p");
        assert_eq!(args, vec!["--model", "opus", "build the login screen"]);
        assert_eq!(
            env.get("AETHER_AGENT_MODEL").map(String::as_str),
            Some("opus")
        );
        assert_eq!(
            env.get("AETHER_AGENT_CLI").map(String::as_str),
            Some("Claude")
        );
    }

    #[test]
    fn agent_command_spec_autonomous_claude_auto_accepts_edits() {
        // An autonomous worker gets --permission-mode acceptEdits so it can write
        // code in its worktree without a gate — still interactive (no -p).
        let (_program, args, _env) =
            agent_command_spec("sonnet", Some("write the file"), true).unwrap();
        assert_eq!(
            args,
            vec![
                "--model",
                "sonnet",
                "--permission-mode",
                "acceptEdits",
                "write the file"
            ]
        );
    }

    #[test]
    fn agent_command_spec_codex_passes_interactive_prompt() {
        // Codex worker, NON-autonomous (AgentInspector path): interactive prompt
        // (no -p), no --model, and no auto-approve flags — a human keeps the gate.
        let (program, args, _env) =
            agent_command_spec("codex-mini", Some("review"), false).unwrap();
        assert_eq!(program, platform_cli_program("codex"));
        assert_eq!(args, vec!["review"]);
    }

    #[test]
    fn agent_command_spec_autonomous_codex_auto_approves_in_workspace() {
        // An autonomous codex fleet worker gets codex's equivalent of claude's
        // acceptEdits: writes confined to the workspace, no approval prompts, so
        // it builds on its own instead of stalling at a permission gate. This is
        // what makes the visible fleet genuinely multi-model (not claude-only).
        let (program, args, env) =
            agent_command_spec("codex-mini", Some("build it"), true).unwrap();
        assert_eq!(program, platform_cli_program("codex"));
        assert_eq!(
            args,
            vec![
                "--sandbox",
                "workspace-write",
                "--ask-for-approval",
                "never",
                "build it"
            ]
        );
        assert_eq!(
            env.get("AETHER_AGENT_CLI").map(String::as_str),
            Some("Codex")
        );
    }

    #[test]
    fn agent_command_spec_autonomous_gemini_auto_approves() {
        // Gemini's edits-only auto-approve (auto_edit), mirroring Claude's
        // acceptEdits — NOT `yolo`, which would auto-approve every tool.
        let (program, args, _env) =
            agent_command_spec("gemini-2.5-pro", Some("build it"), true).unwrap();
        assert_eq!(program, platform_cli_program("gemini"));
        assert_eq!(args, vec!["--approval-mode", "auto_edit", "build it"]);
    }

    #[test]
    fn agent_shell_command_spec_autonomous_codex_auto_approves_in_workspace() {
        // The visible-fleet path (codex inside a PowerShell pane) must carry the
        // same autonomous auto-approve policy, or a codex pane would launch but
        // hang on its own write-permission prompt and never produce its outputs.
        let (program, args, env) =
            agent_shell_command_spec("codex-mini", "write the file", true).unwrap();
        assert_eq!(program, platform_cli_program("powershell"));
        let cmd = &args[3];
        assert!(cmd.contains("'codex"), "runs codex: {cmd}");
        assert!(
            cmd.contains("'--sandbox' 'workspace-write'")
                && cmd.contains("'--ask-for-approval' 'never'"),
            "autonomous codex auto-approve: {cmd}"
        );
        assert!(!cmd.contains("'-p'"), "must NOT be headless -p: {cmd}");
        assert_eq!(
            env.get("AETHER_AGENT_CLI").map(String::as_str),
            Some("Codex")
        );
    }

    #[test]
    fn agent_shell_command_spec_autonomous_gemini_auto_approves() {
        // Parity with the codex shell test: the gemini fleet pane must carry its
        // edits-only auto-approve (auto_edit) through the PowerShell wrapper too,
        // or the pane would launch but hang on its own permission prompt.
        let (program, args, env) =
            agent_shell_command_spec("gemini-2.5-pro", "write the file", true).unwrap();
        assert_eq!(program, platform_cli_program("powershell"));
        let cmd = &args[3];
        assert!(cmd.contains("'gemini"), "runs gemini: {cmd}");
        assert!(
            cmd.contains("'--approval-mode' 'auto_edit'"),
            "autonomous gemini auto-approve (edits-only, not yolo): {cmd}"
        );
        assert!(!cmd.contains("'-p'"), "must NOT be headless -p: {cmd}");
        assert_eq!(
            env.get("AETHER_AGENT_CLI").map(String::as_str),
            Some("Gemini")
        );
    }

    #[test]
    fn autonomous_flags_maps_each_provider_to_its_safe_autonomous_mode() {
        // Direct binding of the single source of truth: if a new AgentCli arm is
        // ever added without a matching autonomous_flags arm, this test (plus the
        // exhaustive match) forces the decision instead of silently granting no
        // policy. Claude/Gemini are edits-only; Codex is sandbox-confined; a
        // custom CLI gets nothing (no known-safe flag to assume).
        assert_eq!(
            autonomous_flags(&AgentCli::Claude),
            vec!["--permission-mode", "acceptEdits"]
        );
        assert_eq!(
            autonomous_flags(&AgentCli::Codex),
            vec![
                "--sandbox",
                "workspace-write",
                "--ask-for-approval",
                "never"
            ]
        );
        assert_eq!(
            autonomous_flags(&AgentCli::Gemini),
            vec!["--approval-mode", "auto_edit"]
        );
        assert!(autonomous_flags(&AgentCli::Custom("aider".to_string())).is_empty());
    }

    #[test]
    fn agent_command_spec_without_prompt_has_no_prompt_args() {
        let (_program, args, _env) = agent_command_spec("sonnet", None, false).unwrap();
        // Claude with a model but no prompt: just the model flags, nothing to run.
        assert_eq!(args, vec!["--model", "sonnet"]);
    }

    #[test]
    fn resolve_agent_model_maps_identities_to_a_usable_default() {
        // An identity owner routed as a model would be rejected by the CLI.
        assert_eq!(resolve_agent_model("impl"), "sonnet");
        assert_eq!(resolve_agent_model("reviewer-agent"), "sonnet");
        assert_eq!(resolve_agent_model(""), "sonnet");
        // Recognized aliases/providers pass through untouched.
        assert_eq!(resolve_agent_model("opus"), "opus");
        assert_eq!(resolve_agent_model("codex-mini"), "codex-mini");
        assert_eq!(resolve_agent_model("gemini-2.5-pro"), "gemini-2.5-pro");
        assert_eq!(resolve_agent_model("claude-opus-4-8"), "claude-opus-4-8");
    }

    #[test]
    fn agent_command_spec_falls_back_to_a_usable_model_for_an_identity() {
        // A task whose model is an identity (its owner) must still launch a real,
        // usable agent instead of `--model impl` (which the CLI rejects).
        let (program, args, _env) = agent_command_spec("impl", Some("do the work"), false).unwrap();
        assert_eq!(program, platform_cli_program("claude"));
        assert_eq!(args, vec!["--model", "sonnet", "do the work"]);
    }

    #[test]
    fn agent_shell_command_spec_runs_the_interactive_cli_inside_powershell() {
        let (program, args, env) =
            agent_shell_command_spec("impl", "build the 'login' screen", true).unwrap();
        assert_eq!(program, platform_cli_program("powershell"));
        // -Command carries the in-shell invocation; the prompt is NOT inlined.
        assert_eq!(args[0], "-NoLogo");
        assert_eq!(args[1], "-NoProfile");
        assert_eq!(args[2], "-Command");
        let cmd = &args[3];
        assert!(
            cmd.starts_with("& "),
            "runs the CLI via the call operator: {cmd}"
        );
        assert!(cmd.contains("'--model' 'sonnet'"), "resolved model: {cmd}");
        assert!(
            cmd.contains("'--permission-mode' 'acceptEdits'"),
            "autonomous edits: {cmd}"
        );
        // CRITICAL: no `-p`. -p is headless print mode (a text dump that exits);
        // the visible fleet must run the INTERACTIVE TUI so the operator watches
        // the agent work. Completion is detected from worktree outputs instead.
        assert!(!cmd.contains("'-p'"), "must NOT be headless -p: {cmd}");
        assert!(
            cmd.ends_with("'acceptEdits' $env:AETHER_AGENT_PROMPT; exit $LASTEXITCODE"),
            "interactive prompt via env, exit-code backstop: {cmd}"
        );
        // The prompt (with its embedded quote) lives in the env var, unescaped.
        assert_eq!(
            env.get("AETHER_AGENT_PROMPT").map(String::as_str),
            Some("build the 'login' screen")
        );
        assert_eq!(
            env.get("AETHER_AGENT_MODEL").map(String::as_str),
            Some("sonnet")
        );
    }

    #[test]
    fn update_nonexistent_session_is_visible_error() {
        let mgr = InteractiveSessionManager::new();
        let status_error = mgr.update_status("nonexistent", "coding").unwrap_err();
        let usage_error = mgr.update_usage("nonexistent", 1.0, 100).unwrap_err();
        assert!(status_error.contains("Interactive session not found for status update"));
        assert!(usage_error.contains("Interactive session not found for usage update"));
        assert!(mgr.get("nonexistent").unwrap().is_none());
    }

    #[test]
    fn unregister_nonexistent_returns_none() {
        let mgr = InteractiveSessionManager::new();
        let removed = mgr.unregister("nope").unwrap();
        assert!(removed.is_none());
    }

    #[test]
    fn concurrent_access() {
        use std::sync::Arc;
        use std::thread;

        let mgr = Arc::new(InteractiveSessionManager::new());
        let mut handles = vec![];

        for i in 0..10 {
            let mgr = mgr.clone();
            handles.push(thread::spawn(move || {
                let id = format!("s{}", i);
                mgr.register(make_session(&id, AgentCli::Claude)).unwrap();
                mgr.update_status(&id, "coding").unwrap();
                mgr.update_usage(&id, 0.1 * i as f64, i * 100).unwrap();
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(mgr.list().unwrap().len(), 10);
    }
}
