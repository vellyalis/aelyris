use super::interactive::AgentCli;
use super::status::AgentRunStatus;
use regex::Regex;
use std::sync::{LazyLock, Mutex};

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
    /// The captured permission-menu prompt when this chunk shows Claude's
    /// selectable approval menu (see [`detect_permission_menu`]). Carries the
    /// gated command/action so the Decision Inbox can show WHAT is being
    /// approved instead of a blind "agent is waiting". `None` for every other
    /// chunk and for non-Claude parsers.
    pub approval_prompt: Option<String>,
}

/// Trait for CLI-specific output pattern matching
pub trait CliOutputParser: Send + Sync {
    fn parse_chunk(&self, text: &str) -> MonitorResult;
}

/// A selectable numbered option line of Claude's permission menu, e.g.
/// `❯ 1. Yes`, `  2. Yes, and don't ask again`, `  3. No, and tell Claude …`.
/// The leading class absorbs the box border / selection glyphs the TUI draws
/// (`│`, `❯`, `›`, `▶`, `»`) plus whitespace. The trailing `(?:yes|no)\b` keys on
/// the canonical first words of the options. Used to EXCLUDE option lines from
/// the captured command text. (Markdown markers `>`/`*` are NOT in the class, so
/// a quoted/bulleted `> 1. yes` list is not mistaken for a menu.)
static MENU_OPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^[\s│❯›▶»]*\d+[.)]\s+(?:yes|no)\b").unwrap()
});

/// The HIGHLIGHTED option line — a numbered `Yes`/`No` option that the TUI draws
/// with its selection pointer (`❯`/`›`/`▶`/`»`) as a prefix. This is the live
/// menu's signature: ordinary assistant prose can list "1. Yes / 2. No" but never
/// draws the pointer ON the option. Requiring the cursor on the option line (not
/// merely somewhere in the buffer) is what stops a stale idle-prompt `❯` from
/// making prose look like a menu (and is the per-read trigger for detection).
/// ANSI color is stripped before matching, but these are literal glyphs that
/// survive stripping.
static CURSOR_OPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^[\s│]*[❯›▶»][\s│]*\d+[.)]\s+(?:yes|no)\b").unwrap()
});

/// Box-drawing glyphs the Claude TUI draws at BOTH edges of a boxed line
/// (`│ … │`). Stripped from a captured prompt line's edges only.
const BORDER_GLYPHS: &[char] = &[
    '│', '╭', '╮', '╰', '╯', '─', '├', '┤', '┬', '┴', '┼', '┌', '┐', '└', '┘',
];

/// Selection markers the TUI draws as a PREFIX of the highlighted line (`❯ 1.`).
/// Stripped from the start only — never the middle/end — so a literal `*` inside
/// a command (`rm -rf *`, `git add *.ts`) is shown exactly as it will run.
const SELECTION_MARKERS: &[char] = &['❯', '»', '▶', '*'];

/// A spinner / thinking line we never want inside a captured prompt.
fn is_prompt_noise_line(line: &str) -> bool {
    let line = line.trim();
    line.is_empty()
        || line.starts_with("Thinking")
        || line.chars().any(|c| {
            matches!(
                c,
                '⠋' | '⠙' | '⠹' | '⠸' | '⠼' | '⠴' | '⠦' | '⠧' | '⠇' | '⠏'
            )
        })
}

/// Strip TUI box/selection glyphs from a line's EDGES only — never its interior.
/// Borders sit at both edges; selection markers only ever prefix the line. The
/// middle is preserved verbatim so a literal glob/wildcard in the gated command
/// reaches the human unchanged (the security point of showing the command).
fn clean_prompt_line(line: &str) -> String {
    line.trim()
        .trim_start_matches(|c: char| {
            c.is_whitespace() || BORDER_GLYPHS.contains(&c) || SELECTION_MARKERS.contains(&c)
        })
        .trim_end_matches(|c: char| c.is_whitespace() || BORDER_GLYPHS.contains(&c))
        .trim()
        .to_string()
}

/// Returns the captured prompt text when an ANSI-stripped chunk shows Claude's
/// interactive permission MENU, otherwise `None`.
///
/// A real menu is a `Do you want to …?` question PLUS the HIGHLIGHTED, cursored
/// numbered `Yes`/`No` option the TUI draws ([`CURSOR_OPTION_RE`]). Both are
/// required:
/// - The question alone is NOT a gate — Claude writes "Do you want to split
///   this up?" in ordinary prose, and surfacing that as an approvable row would
///   let a human "approve" a sentence (false gate).
/// - The cursored `Yes`/`No` option is the structural signature: it is what the
///   Decision Inbox answers with a MENU keystroke (Enter accepts the highlighted
///   default, Esc rejects), and the selection pointer on the option line is what
///   separates a real TUI menu from prose that merely lists "1. Yes / 2. No"
///   after a "Do you want to …?" sentence (prose never draws the pointer). This
///   closes the P2-B false-gate.
///
/// A y/n-style prompt (`(y/N)`, `[y/N]`) is still deliberately NOT matched:
/// answering it needs the y/n key, not the menu keystroke the resolver sends
/// (deferred — needs the prompt kind carried per-CLI).
///
/// The captured text is the question line preceded by up to a few informative
/// content lines (the gated command / diff / description), so the Decision Inbox
/// shows WHAT is being approved rather than a blind "agent is waiting". Callers
/// pass a rolling buffer of recent reads so a menu split across PTY reads is
/// still captured whole.
pub fn detect_permission_menu(text: &str) -> Option<String> {
    if !text.contains("Do you want to") || !CURSOR_OPTION_RE.is_match(text) {
        return None;
    }

    let lines: Vec<&str> = text.lines().collect();
    // Use the LAST question line: a redraw chunk can carry an older copy higher
    // up, and the live menu is the most recent render.
    let q_idx = lines
        .iter()
        .rposition(|l| l.contains("Do you want to") && l.contains('?'))?;
    let question = clean_prompt_line(lines[q_idx]);
    if question.is_empty() {
        return None;
    }

    // Walk back from the question collecting the informative content lines the
    // menu is gating (the command box / edit description). Skip the blank/box
    // gap directly above the question, then stop at the next gap or an option
    // line so we capture one tight block, not the whole screen redraw.
    let mut preceding: Vec<String> = Vec::new();
    for raw in lines[..q_idx].iter().rev() {
        if preceding.len() >= 4 {
            break;
        }
        if is_prompt_noise_line(raw) || MENU_OPTION_RE.is_match(raw) {
            if preceding.is_empty() {
                continue; // still in the gap right above the question
            }
            break; // reached the top of the gated block
        }
        let cleaned = clean_prompt_line(raw);
        if cleaned.is_empty() {
            if preceding.is_empty() {
                continue;
            }
            break;
        }
        preceding.push(cleaned);
    }
    preceding.reverse();
    preceding.push(question);

    let prompt = preceding.join(" · ");
    Some(elide_middle(&prompt, APPROVAL_PROMPT_MAX_CHARS))
}

/// Upper bound on a captured approval prompt. Generous enough for a command plus
/// its question; longer prompts are middle-elided (see [`elide_middle`]).
const APPROVAL_PROMPT_MAX_CHARS: usize = 300;

/// Bound `s` to `max` chars WITHOUT losing either end: keep the head (what the
/// command is) and the tail (a dangerous redirect / path / `; rm -rf /` often
/// lives last), eliding only the middle. A benign-looking prefix must never hide
/// a destructive tail in the Decision Inbox.
fn elide_middle(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        return s.to_string();
    }
    const SEP: &str = " … ";
    let keep = max.saturating_sub(SEP.chars().count());
    let head_len = keep * 2 / 3;
    let tail_len = keep - head_len;
    let head: String = chars[..head_len].iter().collect();
    let tail: String = chars[chars.len() - tail_len..].iter().collect();
    format!("{head}{SEP}{tail}")
}

/// True when an ANSI-stripped chunk shows Claude's interactive permission menu.
/// Thin boolean view of [`detect_permission_menu`] for call sites that only need
/// the gate decision.
pub fn detect_waiting_permission(text: &str) -> bool {
    detect_permission_menu(text).is_some()
}

/// Max chars of recent output kept to recover a menu split across PTY reads.
/// A full-screen menu redraw is bounded by the terminal size; this is generous.
const MENU_BUFFER_CHARS: usize = 8192;

/// Keep only the last `max` chars of `s` (char-safe), for the rolling buffer.
fn cap_tail(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        s.chars().skip(count - max).collect()
    }
}

/// Claude Code interactive mode parser
struct ClaudeParser {
    cost_re: Regex,
    token_re: Regex,
    /// Rolling tail of recent ANSI-stripped reads. PTY reads are not message-
    /// framed, so a permission menu can split across reads (command box, then the
    /// question, then the options); accumulating recovers the whole menu so the
    /// gated command is still captured. Bounded by [`MENU_BUFFER_CHARS`].
    recent: Mutex<String>,
}

impl ClaudeParser {
    fn new() -> Self {
        Self {
            // Matches patterns like "Total cost: $1.23" or "Cost: $0.05"
            cost_re: Regex::new(r"(?i)(?:total\s+)?cost:\s*\$([0-9]+\.?[0-9]*)").unwrap(),
            // Matches patterns like "Total tokens: 12345" or "tokens: 5000"
            token_re: Regex::new(r"(?i)(?:total\s+)?tokens?:\s*([0-9,]+)").unwrap(),
            recent: Mutex::new(String::new()),
        }
    }
}

impl CliOutputParser for ClaudeParser {
    fn parse_chunk(&self, text: &str) -> MonitorResult {
        let mut status = None;
        let mut usage = DetectedUsage::default();

        // Status detection from Claude Code interactive output patterns.
        // These are heuristic — Claude Code may change its output format.
        // Permission detection runs BEFORE every other marker: a TUI redraw chunk
        // can carry the previous spinner AND the freshly-rendered approval prompt
        // together (and the prompt names the tool it gates), so checking Thinking
        // or Edit/Write/Bash first would mask the gate and the human Approve/Deny
        // would never surface. The captured menu text rides along on the result so
        // the Decision Inbox can show the gated command.
        //
        // A menu can also split across PTY reads (reads are not message-framed:
        // the command box, the question, and the options can arrive in three
        // separate reads), so accumulate a rolling tail of recent output and
        // search THAT, recovering the whole menu. Detect only when THIS read draws
        // the highlighted, cursored Yes/No option ([`CURSOR_OPTION_RE`]): anchoring
        // on the current read's cursored option stops a resolved menu (no longer
        // drawing its cursor) from re-firing out of stale buffered text, and stops
        // a stale idle-prompt `❯` in the buffer from making later prose that lists
        // "1. Yes / 2. No" look like a live menu.
        let buffer = match self.recent.lock() {
            Ok(mut guard) => {
                guard.push_str(text);
                let trimmed = cap_tail(&guard, MENU_BUFFER_CHARS);
                *guard = trimmed.clone();
                trimmed
            }
            Err(_) => text.to_string(),
        };
        let approval_prompt = if CURSOR_OPTION_RE.is_match(text) {
            detect_permission_menu(&buffer)
        } else {
            None
        };
        if approval_prompt.is_some() {
            status = Some(DetectedStatus::WaitingPermission);
        } else if text.contains("Thinking")
            || text.contains("⠋")
            || text.contains("⠙")
            || text.contains("⠹")
        {
            status = Some(DetectedStatus::Thinking);
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

        MonitorResult {
            status,
            usage,
            approval_prompt,
        }
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
        MonitorResult {
            status,
            usage: DetectedUsage::default(),
            approval_prompt: None,
        }
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
        MonitorResult {
            status,
            usage: DetectedUsage::default(),
            approval_prompt: None,
        }
    }
}

/// Generic fallback parser — does minimal detection
struct GenericParser;

impl CliOutputParser for GenericParser {
    fn parse_chunk(&self, _text: &str) -> MonitorResult {
        MonitorResult {
            status: None,
            usage: DetectedUsage::default(),
            approval_prompt: None,
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

    /// A realistic ANSI-stripped Claude permission menu for a Bash command.
    const BASH_MENU: &str = "Bash(rm -rf dist)\nRemove the dist directory\n\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for rm commands\n  3. No, and tell Claude what to do differently (esc)";

    /// A realistic ANSI-stripped Claude permission menu for a file edit.
    const EDIT_MENU: &str = "Edit src/main.rs\nDo you want to make this edit to main.rs?\n❯ 1. Yes\n  2. Yes, allow all edits during this session\n  3. No, and tell Claude what to do differently (esc)";

    #[test]
    fn claude_detects_permission_menu() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk(EDIT_MENU);
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
        // The captured prompt names the gated action so the inbox is not blind.
        let prompt = result.approval_prompt.expect("menu prompt captured");
        assert!(prompt.contains("Do you want to make this edit to main.rs?"), "{prompt}");
    }

    #[test]
    fn claude_permission_captures_the_gated_command() {
        // Regression for P2-A (blind approval): a Bash gate's captured prompt
        // must carry the command, not just the generic question, so the human
        // sees WHAT they are approving.
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk(BASH_MENU);
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
        let prompt = result.approval_prompt.expect("menu prompt captured");
        assert!(prompt.contains("rm -rf dist"), "{prompt}");
        assert!(prompt.contains("Do you want to proceed?"), "{prompt}");
        // Option lines are structure, not content — they stay out of the prompt.
        assert!(!prompt.contains("1. Yes"), "{prompt}");
    }

    #[test]
    fn claude_permission_precedes_spinner_in_redraw_chunk() {
        // A TUI redraw chunk can carry the previous spinner plus the new menu;
        // the permission gate must win so the actionable row still surfaces, and
        // the spinner line must not pollute the captured prompt.
        let parser = ClaudeParser::new();
        let chunk = format!("⠋ Thinking…\n{BASH_MENU}");
        let result = parser.parse_chunk(&chunk);
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
        let prompt = result.approval_prompt.expect("menu prompt captured");
        assert!(!prompt.contains("Thinking"), "{prompt}");
        assert!(prompt.contains("Do you want to proceed?"), "{prompt}");
    }

    #[test]
    fn claude_detects_permission_menu_inside_a_drawn_box() {
        // The live TUI draws the menu inside a box; box glyphs must be stripped
        // from the captured prompt and must not prevent detection.
        let parser = ClaudeParser::new();
        let boxed = "╭───────────────────────────╮\n│ Bash command              │\n│                           │\n│ ls -la                    │\n│ List directory contents   │\n│                           │\n│ Do you want to proceed?   │\n│ ❯ 1. Yes                  │\n│   2. No, tell Claude (esc)│\n╰───────────────────────────╯";
        let result = parser.parse_chunk(boxed);
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
        let prompt = result.approval_prompt.expect("menu prompt captured");
        assert!(prompt.contains("ls -la"), "{prompt}");
        assert!(prompt.contains("Do you want to proceed?"), "{prompt}");
        assert!(!prompt.contains('│'), "{prompt}");
        assert!(!prompt.contains('❯'), "{prompt}");
    }

    #[test]
    fn claude_detects_permission_menu_split_across_reads() {
        // PTY reads are not message-framed: the question can arrive in one read
        // and the options in the next (the boundary newline is part of the byte
        // stream). The rolling buffer must join reads so the gate still surfaces
        // and the command is still captured.
        let parser = ClaudeParser::new();
        let first = parser.parse_chunk("Bash(rm -rf dist)\nDo you want to proceed?\n");
        assert_ne!(first.status, Some(DetectedStatus::WaitingPermission));
        let second = parser.parse_chunk("❯ 1. Yes\n  2. No, and tell Claude what to do (esc)");
        assert_eq!(second.status, Some(DetectedStatus::WaitingPermission));
        let prompt = second.approval_prompt.expect("menu prompt captured across reads");
        assert!(prompt.contains("rm -rf dist"), "{prompt}");
        assert!(prompt.contains("Do you want to proceed?"), "{prompt}");
    }

    #[test]
    fn claude_detects_permission_menu_split_across_three_reads() {
        // Worst case: command box, question, and options each arrive in a separate
        // read. A single-chunk-of-history buffer would drop the command; the
        // rolling tail must preserve it so the inbox is never blind (codex P1).
        let parser = ClaudeParser::new();
        let c1 = parser.parse_chunk("Bash(rm -rf dist)\nRemove the dist directory\n");
        assert_ne!(c1.status, Some(DetectedStatus::WaitingPermission));
        let c2 = parser.parse_chunk("Do you want to proceed?\n");
        assert_ne!(c2.status, Some(DetectedStatus::WaitingPermission));
        let c3 = parser.parse_chunk("❯ 1. Yes\n  2. No, tell Claude (esc)");
        assert_eq!(c3.status, Some(DetectedStatus::WaitingPermission));
        let prompt = c3.approval_prompt.expect("menu prompt captured across three reads");
        assert!(prompt.contains("rm -rf dist"), "{prompt}");
        assert!(prompt.contains("Do you want to proceed?"), "{prompt}");
    }

    #[test]
    fn claude_does_not_relatch_a_resolved_menu_from_buffer() {
        // After the human resolves, the next read no longer draws the cursored
        // option. The stale menu still sits in the rolling buffer, but detection
        // is anchored on the CURRENT read's cursored option, so it must not re-fire.
        let parser = ClaudeParser::new();
        let shown = parser.parse_chunk(BASH_MENU);
        assert_eq!(shown.status, Some(DetectedStatus::WaitingPermission));
        let after = parser.parse_chunk("⠋ Thinking…");
        assert_ne!(after.status, Some(DetectedStatus::WaitingPermission));
        assert_eq!(after.approval_prompt, None);
    }

    #[test]
    fn claude_does_not_gate_prose_after_a_stale_idle_cursor() {
        // Claude's idle input prompt draws a bare `❯` that lingers in the buffer.
        // A later read of ordinary prose that merely lists a numbered Yes/No choice
        // must NOT be mistaken for a menu — the cursor must be on the CURRENT read's
        // option line, not just somewhere in the buffer (codex P2).
        let parser = ClaudeParser::new();
        let _idle = parser.parse_chunk("❯ ");
        let prose = parser.parse_chunk("Do you want to proceed?\n1. Yes, do it\n2. No, stop");
        assert_ne!(prose.status, Some(DetectedStatus::WaitingPermission));
        assert_eq!(prose.approval_prompt, None);
    }

    #[test]
    fn claude_permission_prompt_keeps_both_ends_of_a_long_command() {
        // A long gated command must keep BOTH the head (what it is) and the tail
        // (a dangerous redirect/path often lives last); only the middle is elided,
        // so a benign-looking prefix never hides a destructive tail (codex P2).
        let parser = ClaudeParser::new();
        let filler = "echo ".repeat(80); // pushes the prompt past the cap
        let menu = format!(
            "Bash({filler}&& rm -rf /etc/secret)\nDo you want to proceed?\n❯ 1. Yes\n  2. No (esc)"
        );
        let prompt = parser
            .parse_chunk(&menu)
            .approval_prompt
            .expect("menu prompt captured");
        assert!(prompt.contains("Bash("), "{prompt}");
        assert!(prompt.contains("rm -rf /etc/secret"), "{prompt}");
        assert!(prompt.contains('…'), "long prompt should be middle-elided: {prompt}");
        assert!(prompt.chars().count() <= APPROVAL_PROMPT_MAX_CHARS, "{prompt}");
    }

    #[test]
    fn claude_permission_preserves_literal_wildcards_in_command() {
        // Regression for P2-A: a literal glob in the gated command must reach the
        // human unchanged — stripping `*` would show a DIFFERENT command than the
        // one being approved.
        let parser = ClaudeParser::new();
        let menu = "Bash(rm -rf *)\nDo you want to proceed?\n❯ 1. Yes\n  2. No, tell Claude (esc)";
        let result = parser.parse_chunk(menu);
        assert_eq!(result.status, Some(DetectedStatus::WaitingPermission));
        let prompt = result.approval_prompt.expect("menu prompt captured");
        assert!(prompt.contains("rm -rf *"), "{prompt}");
    }

    #[test]
    fn claude_still_detects_coding_without_a_permission_prompt() {
        let parser = ClaudeParser::new();
        let result = parser.parse_chunk("Updated src/main.rs");
        assert_eq!(result.status, Some(DetectedStatus::Coding));
        assert_eq!(result.approval_prompt, None);
    }

    #[test]
    fn detect_permission_menu_requires_real_menu_structure() {
        // A real menu (question + numbered Yes/No options) IS a gate and is
        // captured.
        assert!(detect_permission_menu(BASH_MENU).is_some());
        assert!(detect_permission_menu(EDIT_MENU).is_some());

        // Regression for P2-B (false detection): a bare "Do you want to …?"
        // sentence in ordinary prose has NO selectable options, so it is NOT a
        // gate — otherwise the human could "approve" a sentence.
        assert!(detect_permission_menu("Do you want to split this up?").is_none());
        assert!(detect_permission_menu("Do you want to continue?").is_none());

        // Bare words / errors in ordinary output are never gates.
        assert!(detect_permission_menu("Compiling crate v0.1.0").is_none());
        assert!(detect_permission_menu("error: Permission denied (os error 13)").is_none());
        assert!(detect_permission_menu("Allow me to explain the approach.").is_none());

        // A bare y/n prompt is intentionally NOT surfaced: we cannot answer it
        // with the menu keystroke the resolver sends (deferred — needs the prompt
        // kind carried per-CLI). It has no numbered Yes/No menu, so it is none.
        assert!(detect_permission_menu("Allow this command? (y/N)").is_none());

        // A numbered list in prose without the question is not a gate either.
        assert!(detect_permission_menu("Steps:\n1. Yes do this\n2. No skip that").is_none());

        // P2-B residual closed: ordinary prose that asks "Do you want to …?" AND
        // lists a numbered Yes/No choice is STILL not a gate, because prose draws
        // no selection cursor. Without the cursor requirement this would surface a
        // false, resolvable Approve/Deny row.
        assert!(
            detect_permission_menu("Do you want to proceed?\n1. Yes, run all\n2. No, stop").is_none()
        );

        // The Yes/No discriminator is load-bearing: a real cursor + adjacent
        // numbered options whose first words are NOT Yes/No is some other prompt,
        // not the permission menu we answer with Enter/Esc.
        assert!(
            detect_permission_menu("Do you want to proceed?\n❯ 1. Update the config\n  2. Run the tests")
                .is_none()
        );

        // The boolean view agrees with the captured view.
        assert!(detect_waiting_permission(BASH_MENU));
        assert!(!detect_waiting_permission("Do you want to split this up?"));
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
