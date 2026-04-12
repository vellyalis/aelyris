use regex::Regex;
use super::interactive::AgentCli;

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

        // Status detection from Claude Code interactive output patterns
        // These are heuristic — Claude Code may change its output format
        if text.contains("Thinking") || text.contains("⠋") || text.contains("⠙") || text.contains("⠹") {
            status = Some(DetectedStatus::Thinking);
        } else if text.contains("Edit") || text.contains("Write") || text.contains("Bash")
            || text.contains("── file") || text.contains("Created") || text.contains("Updated")
        {
            status = Some(DetectedStatus::Coding);
        } else if text.contains("Allow") || text.contains("(y/n)") || text.contains("permission") {
            status = Some(DetectedStatus::WaitingPermission);
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
        let status = if text.contains("Generating") || text.contains("...") {
            Some(DetectedStatus::Thinking)
        } else if text.contains("Done") || text.contains("Complete") {
            Some(DetectedStatus::Done)
        } else {
            None
        };
        MonitorResult { status, usage: DetectedUsage::default() }
    }
}

/// Codex CLI parser (basic — expand as Codex CLI matures)
struct CodexParser;

impl CliOutputParser for CodexParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        let status = if text.contains("thinking") || text.contains("Processing") {
            Some(DetectedStatus::Thinking)
        } else if text.contains("sandbox") || text.contains("running") {
            Some(DetectedStatus::Coding)
        } else {
            None
        };
        MonitorResult { status, usage: DetectedUsage::default() }
    }
}

/// Generic fallback parser — does minimal detection
struct GenericParser;

impl CliOutputParser for GenericParser {
    fn parse_chunk(&self, _text: &str) -> MonitorResult {
        MonitorResult { status: None, usage: DetectedUsage::default() }
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
    static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap()
    });
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
