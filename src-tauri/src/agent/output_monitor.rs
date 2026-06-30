use super::interactive::AgentCli;
use super::status::AgentRunStatus;
use regex::Regex;

/// Detected state from terminal output
#[derive(Debug, Clone, PartialEq)]
pub enum DetectedStatus {
    Thinking,
    Coding,
    Idle,
    Done,
    WaitingPermission,
    Unknown,
}

impl DetectedStatus {
    pub fn to_agent_run_status(&self) -> Option<AgentRunStatus> {
        match self {
            Self::Thinking => Some(AgentRunStatus::Thinking),
            Self::Coding => Some(AgentRunStatus::Coding),
            Self::Idle => Some(AgentRunStatus::Idle),
            Self::Done => Some(AgentRunStatus::Done),
            Self::WaitingPermission => Some(AgentRunStatus::WaitingApproval),
            Self::Unknown => None,
        }
    }
}

/// Cost/token info extracted from output
#[derive(Debug, Clone, Default)]
pub struct DetectedUsage {
    pub cost: Option<f64>,
    pub tokens: Option<u64>,
}

/// Result of scanning a chunk of terminal output
#[derive(Debug, Clone)]
pub struct MonitorResult {
    pub status: Option<DetectedStatus>,
    pub usage: DetectedUsage,
}

/// Trait for CLI-specific output pattern matching
pub trait CliOutputParser: Send + Sync {
    fn parse_chunk(&self, text: &str) -> MonitorResult;
}

/// The shape of an interactive approval prompt, which decides the keystroke
/// that accepts/rejects it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalPromptKind {
    /// A yes/no readline prompt (e.g. "Allow? (y/n)" or Codex "[y/N]"): accept
    /// with `y`, reject with `n`, each submitted with Enter.
    YesNo,
    /// A selectable menu (e.g. Claude's "Do you want to proceed?" with a default
    /// "Yes" option): accept with Enter on the default, reject with Esc.
    Menu,
}

/// Yes/no answer tokens. Their presence is a strong, low-false-positive signal
/// that the CLI is blocked on a y/n readline answer.
const YES_NO_MARKERS: &[&str] = &["(y/n)", "(Y/n)", "(y/N)", "[y/n]", "[Y/n]", "[y/N]", "y/n"];

/// Classify an ANSI-stripped chunk as an approval prompt, if it is one. We
/// require real prompt STRUCTURE — a yes/no token, or an explicit
/// "Do you want to …?" question — rather than a bare word, so ordinary output
/// like "Permission denied", "file permissions", or "Allow me to explain" is
/// NOT mistaken for a human gate. Checked BEFORE coding-activity markers: a
/// permission prompt routinely names the tool it gates ("Bash(...) — Do you
/// want to proceed?"), so a tool-name match would otherwise mask the prompt.
pub fn classify_approval_prompt(text: &str) -> Option<ApprovalPromptKind> {
    if YES_NO_MARKERS.iter().any(|marker| text.contains(marker)) {
        return Some(ApprovalPromptKind::YesNo);
    }
    // Menu-style gate: an explicit question, not narrative prose.
    if text.contains("Do you want to") && text.contains('?') {
        return Some(ApprovalPromptKind::Menu);
    }
    None
}

/// True when an ANSI-stripped output chunk looks like a permission prompt.
pub fn detect_waiting_permission(text: &str) -> bool {
    classify_approval_prompt(text).is_some()
}

/// The keystroke bytes that accept (`approve = true`) or reject a prompt of the
/// given kind. A yes/no answer is submitted with Enter; a menu accepts with
/// Enter on the highlighted default and rejects with Esc.
pub fn approval_keystroke(kind: ApprovalPromptKind, approve: bool) -> &'static [u8] {
    match (kind, approve) {
        (ApprovalPromptKind::YesNo, true) => b"y\r",
        (ApprovalPromptKind::YesNo, false) => b"n\r",
        (ApprovalPromptKind::Menu, true) => b"\r",
        (ApprovalPromptKind::Menu, false) => b"\x1b",
    }
}

/// Claude Code interactive mode parser
struct ClaudeParser {
    cost_re: Regex,
    token_re: Regex,
}

impl ClaudeParser {
    fn new() -> Self {
        Self {
            // Matches patterns like "Total cost: $1.23" or "Cost: $0.05"
            cost_re: Regex::new(r"(?i)(?:total\s+)?cost:\s*\$([0-9]+\.?[0-9]*)").unwrap(),
            // Matches patterns like "Total tokens: 12345" or "tokens: 5000"
            token_re: Regex::new(r"(?i)(?:total\s+)?tokens?:\s*([0-9,]+)").unwrap(),
        }
    }
}

impl CliOutputParser for ClaudeParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        let mut status = None;
        let mut usage = DetectedUsage::default();

        // Status detection from Claude Code interactive output patterns.
        // These are heuristic — Claude Code may change its output format.
        // Permission detection runs BEFORE coding detection: a tool-use approval
        // prompt names the gated tool (e.g. "Bash(...) — Do you want to proceed?"),
        // so checking Edit/Write/Bash first would misclassify the gate as Coding
        // and the human Approve/Deny would never surface.
        if text.contains("Thinking")
            || text.contains("⠋")
            || text.contains("⠙")
            || text.contains("⠹")
        {
            status = Some(DetectedStatus::Thinking);
        } else if detect_waiting_permission(text) {
            status = Some(DetectedStatus::WaitingPermission);
        } else if text.contains("Edit")
            || text.contains("Write")
            || text.contains("Bash")
            || text.contains("── file")
            || text.contains("Created")
            || text.contains("Updated")
        {
            status = Some(DetectedStatus::Coding);
        } else if text.contains("❯") || text.contains("> ") && text.len() < 20 {
            status = Some(DetectedStatus::Idle);
        }

        // Cost extraction
        if let Some(cap) = self.cost_re.captures(text) {
            if let Ok(cost) = cap[1].parse::<f64>() {
                usage.cost = Some(cost);
            }
        }

        // Token extraction
        if let Some(cap) = self.token_re.captures(text) {
            let token_str = cap[1].replace(',', "");
            if let Ok(tokens) = token_str.parse::<u64>() {
                usage.tokens = Some(tokens);
            }
        }

        MonitorResult { status, usage }
    }
}

/// Gemini CLI parser (basic — expand as Gemini CLI matures)
struct GeminiParser;

impl CliOutputParser for GeminiParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        // Permission first so a y/n gate is never masked by a "..." progress marker.
        let status = if detect_waiting_permission(text) {
            Some(DetectedStatus::WaitingPermission)
        } else if text.contains("Generating") || text.contains("...") {
            Some(DetectedStatus::Thinking)
        } else if text.contains("Done") || text.contains("Complete") {
            Some(DetectedStatus::Done)
        } else {
            None
        };
        MonitorResult {
            status,
            usage: DetectedUsage::default(),
        }
    }
}

/// Codex CLI parser (basic — expand as Codex CLI matures)
struct CodexParser;

impl CliOutputParser for CodexParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        // Permission first so an approval gate is never masked by a sandbox/run marker.
        let status = if detect_waiting_permission(text) {
            Some(DetectedStatus::WaitingPermission)
        } else if text.contains("thinking") || text.contains("Processing") {
            Some(DetectedStatus::Thinking)
        } else if text.contains("sandbox") || text.contains("running") {
            Some(DetectedStatus::Coding)
        } else {
            None
        };
        MonitorResult {
            status,
            usage: DetectedUsage::default(),
        }
    }
}

/// Generic fallback parser — minimal detection. It still surfaces permission
/// prompts so a custom CLI's human gate reaches the Decision Inbox.
struct GenericParser;

impl CliOutputParser for GenericParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        let status = if detect_waiting_permission(text) {
            Some(DetectedStatus::WaitingPermission)
        } else {
            None
        };
        MonitorResult {
            status,
            usage: DetectedUsage::default(),
        }
    }
}

/// Factory: create the right parser for a given CLI type
pub fn create_parser(cli: &AgentCli) -> Box<dyn CliOutputParser> {
    match cli {
        AgentCli::Claude => Box::new(ClaudeParser::new()),
        AgentCli::Gemini => Box::new(GeminiParser),
        AgentCli::Codex => Box::new(CodexParser),
        AgentCli::Custom(_) => Box::new(GenericParser),
    }
}

/// Strips ANSI escape sequences from raw terminal output for pattern matching.
/// This is intentionally simple — we only need it for status heuristics, not rendering.
pub fn strip_ansi(input: &str) -> String {
    use std::sync::LazyLock;
    static ANSI_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap());
    ANSI_RE.replace_all(input, "").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_detects_thinking() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("⠋ Thinking...");
        assert_eq!(result.status, Some(DetectedStatus::Thinking));
    }

    #[test]
    fn claude_detects_coding() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Updated src/main.rs");
        assert_eq!(result.status, Some(DetectedStatus::Coding));
    }

    #[test]
    fn claude_detects_permission() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Allow this tool? (y/n)");
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn claude_detects_do_you_want_to_prompt() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Do you want to proceed?");
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn claude_permission_precedes_tool_name_in_same_chunk() {
        // Regression: a tool-use approval prompt names the tool it is gating.
        // Coding markers (Bash/Edit/Write) must NOT mask the permission gate,
        // otherwise the human Approve/Deny never surfaces in the Decision Inbox.
        let parser = ClaudeParser::new();
        let bash = parser.parse_chunk("Bash(rm -rf dist)\nDo you want to proceed? (y/n)");
        assert_eq!(bash.status, Some(DetectedStatus::WaitingPermission));
        let edit = parser.parse_chunk("Edit src/main.rs — Allow this edit? (y/n)");
        assert_eq!(edit.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn claude_still_detects_coding_without_a_permission_prompt() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Updated src/main.rs");
        assert_eq!(result.status, Some(DetectedStatus::Coding));
    }

    #[test]
    fn gemini_detects_permission() {
        let parser = GeminiParser;
        let result = parser.parse_chunk("Allow this command? (y/n)");
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn codex_detects_permission() {
        let parser = CodexParser;
        let result = parser.parse_chunk("Do you want to run this command? [y/N]");
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn generic_detects_permission() {
        let parser = GenericParser;
        let result = parser.parse_chunk("Proceed with deletion? (y/n)");
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
    }

    #[test]
    fn detect_waiting_permission_requires_prompt_structure_not_bare_words() {
        // Bare words in ordinary output must NOT be treated as a gate.
        assert!(!detect_waiting_permission("Compiling crate v0.1.0"));
        assert!(!detect_waiting_permission("error: Permission denied (os error 13)"));
        assert!(!detect_waiting_permission("Updated config.rs // allow all routes"));
        assert!(!detect_waiting_permission("Allow me to explain the approach."));
        assert!(!detect_waiting_permission("I don't have permission to read that file"));
        // Real prompt structure IS detected.
        assert!(detect_waiting_permission("Do you want to continue?"));
        assert!(detect_waiting_permission("Bash(rm -rf dist) — Allow? (y/n)"));
    }

    #[test]
    fn classify_approval_prompt_distinguishes_yes_no_from_menu() {
        assert_eq!(
            classify_approval_prompt("Allow this command? (y/n)"),
            Some(ApprovalPromptKind::YesNo)
        );
        assert_eq!(
            classify_approval_prompt("Run this? [y/N]"),
            Some(ApprovalPromptKind::YesNo)
        );
        assert_eq!(
            classify_approval_prompt("Do you want to proceed?"),
            Some(ApprovalPromptKind::Menu)
        );
        assert_eq!(classify_approval_prompt("just regular output"), None);
    }

    #[test]
    fn approval_keystroke_matches_prompt_kind() {
        assert_eq!(approval_keystroke(ApprovalPromptKind::YesNo, true), b"y\r");
        assert_eq!(approval_keystroke(ApprovalPromptKind::YesNo, false), b"n\r");
        assert_eq!(approval_keystroke(ApprovalPromptKind::Menu, true), b"\r");
        assert_eq!(approval_keystroke(ApprovalPromptKind::Menu, false), b"\x1b");
    }

    #[test]
    fn claude_extracts_cost() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Total cost: $1.23");
        assert_eq!(result.usage.cost, Some(1.23));
    }

    #[test]
    fn claude_extracts_tokens() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Total tokens: 12,345");
        assert_eq!(result.usage.tokens, Some(12345));
    }

    #[test]
    fn strip_ansi_removes_escape_codes() {
        let raw = "\x1b[32mHello\x1b[0m World";
        assert_eq!(strip_ansi(raw), "Hello World");
    }

    #[test]
    fn gemini_detects_generating() {
        let parser = GeminiParser;
        let result = parser.parse_chunk("Generating response...");
        assert_eq!(result.status, Some(DetectedStatus::Thinking));
    }

    #[test]
    fn codex_detects_sandbox() {
        let parser = CodexParser;
        let result = parser.parse_chunk("running in sandbox");
        assert_eq!(result.status, Some(DetectedStatus::Coding));
    }

    #[test]
    fn generic_returns_none() {
        let parser = GenericParser;
        let result = parser.parse_chunk("anything here");
        assert_eq!(result.status, None);
    }

    #[test]
    fn factory_creates_correct_parser() {
        // Just verify it doesn't panic
        let _ = create_parser(&AgentCli::Claude);
        let _ = create_parser(&AgentCli::Gemini);
        let _ = create_parser(&AgentCli::Codex);
        let _ = create_parser(&AgentCli::Custom("my-agent".to_string()));
    }

    #[test]
    fn detected_status_maps_to_canonical_status() {
        assert_eq!(
            DetectedStatus::Thinking.to_agent_run_status(),
            Some(AgentRunStatus::Thinking)
        );
        assert_eq!(
            DetectedStatus::Coding.to_agent_run_status(),
            Some(AgentRunStatus::Coding)
        );
        assert_eq!(
            DetectedStatus::WaitingPermission.to_agent_run_status(),
            Some(AgentRunStatus::WaitingApproval)
        );
        assert_eq!(DetectedStatus::Unknown.to_agent_run_status(), None);
    }

    #[test]
    fn claude_detects_idle_prompt() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("❯ ");
        assert_eq!(result.status, Some(DetectedStatus::Idle));
    }

    #[test]
    fn claude_no_status_on_arbitrary_text() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Hello this is some normal output text");
        assert_eq!(result.status, None);
    }

    #[test]
    fn claude_cost_and_status_same_chunk() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("⠋ Thinking... Total cost: $0.05, tokens: 1,234");
        assert_eq!(result.status, Some(DetectedStatus::Thinking));
        assert_eq!(result.usage.cost, Some(0.05));
        assert_eq!(result.usage.tokens, Some(1234));
    }

    #[test]
    fn strip_ansi_handles_empty_input() {
        assert_eq!(strip_ansi(""), "");
    }

    #[test]
    fn strip_ansi_handles_no_escapes() {
        assert_eq!(strip_ansi("plain text"), "plain text");
    }

    #[test]
    fn strip_ansi_complex_sequences() {
        let raw = "\x1b[1;32mBold Green\x1b[0m \x1b[38;5;196mRed\x1b[0m";
        assert_eq!(strip_ansi(raw), "Bold Green Red");
    }
}
