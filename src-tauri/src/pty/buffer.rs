use std::collections::VecDeque;

/// Ring buffer for terminal output lines, used by capture-pane.
pub struct OutputBuffer {
    lines: VecDeque<String>,
    max_lines: usize,
    /// Accumulates partial line data until a newline arrives
    partial: String,
}

impl OutputBuffer {
    pub fn new(max_lines: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(max_lines.min(1024)),
            max_lines,
            partial: String::new(),
        }
    }

    /// Feed raw output data (may contain partial lines, ANSI codes, etc.)
    pub fn feed(&mut self, data: &str) {
        self.partial.push_str(data);
        if !self.partial.contains('\n') {
            return;
        }

        // Split on newlines while keeping the final segment as the next
        // partial line. `mem::take` avoids repeatedly reallocating and copying
        // the remainder for every newline during large build-log floods.
        let pending = std::mem::take(&mut self.partial);
        let mut start = 0;
        for (idx, ch) in pending.char_indices() {
            if ch == '\n' {
                self.push_line(pending[start..idx].to_string());
                start = idx + ch.len_utf8();
            }
        }
        if start < pending.len() {
            self.partial.push_str(&pending[start..]);
        }
    }

    /// Get the last N lines
    pub fn tail(&self, n: usize) -> Vec<String> {
        let skip = self.lines.len().saturating_sub(n);
        self.lines.iter().skip(skip).cloned().collect()
    }

    /// Get all buffered content as one string
    pub fn content(&self) -> String {
        let mut result: Vec<&str> = self.lines.iter().map(|s| s.as_str()).collect();
        if !self.partial.is_empty() {
            result.push(&self.partial);
        }
        result.join("\n")
    }

    /// Number of complete lines buffered
    pub fn len(&self) -> usize {
        self.lines.len()
    }

    /// Whether no complete lines are buffered.
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    fn push_line(&mut self, line: String) {
        if self.lines.len() >= self.max_lines {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }
}

/// A command block: prompt line + command + output
#[derive(serde::Serialize, Clone, Debug)]
pub struct CommandBlock {
    /// The command that was executed (extracted from prompt line)
    pub command: String,
    /// Output lines following the command
    pub output: Vec<String>,
    /// Line index in the buffer where this block starts
    pub start_line: usize,
}

/// Detect prompt patterns and split buffer into command blocks.
/// Recognizes: PS C:\...>, $, %, #, >, and common shell prompts.
pub fn extract_command_blocks(lines: &[String]) -> Vec<CommandBlock> {
    let mut blocks = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let stripped = strip_ansi(&lines[i]);
        let trimmed = stripped.trim();

        if let Some(cmd) = detect_prompt_command(trimmed) {
            let start = i;
            i += 1;
            // Collect output lines until next prompt or end
            let mut output = Vec::new();
            while i < lines.len() {
                let next_stripped = strip_ansi(&lines[i]);
                let next_trimmed = next_stripped.trim();
                if detect_prompt_command(next_trimmed).is_some() {
                    break;
                }
                output.push(lines[i].clone());
                i += 1;
            }
            if !cmd.is_empty() {
                blocks.push(CommandBlock {
                    command: cmd,
                    output,
                    start_line: start,
                });
            }
        } else {
            i += 1;
        }
    }

    blocks
}

/// Try to extract the command from a prompt line.
/// Returns Some(command) if this looks like a prompt, None otherwise.
fn detect_prompt_command(line: &str) -> Option<String> {
    // PowerShell: PS C:\Users\owner> command
    if let Some(idx) = line.find("PS ") {
        if let Some(gt) = line[idx..].find('>') {
            let after = line[idx + gt + 1..].trim();
            return Some(after.to_string());
        }
    }
    // Bash/Zsh: user@host:~/dir$ command  or  ~/dir$ command
    if let Some(idx) = line.rfind("$ ") {
        let after = line[idx + 2..].trim();
        return Some(after.to_string());
    }
    // Generic: > command (at start of line)
    if let Some(stripped) = line.strip_prefix("> ") {
        return Some(stripped.trim().to_string());
    }
    // Trailing $ or > with content after (single char prompt)
    if line.ends_with('$') || line.ends_with('>') || line.ends_with('#') {
        // This is a prompt with no command yet typed
        return Some(String::new());
    }
    None
}

/// Strip ANSI escape sequences from text
pub fn strip_ansi(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // ESC [ ... (letter) — CSI sequence
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                              // Read until we hit a letter (the terminator)
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            // ESC ] ... BEL/ST — OSC sequence
            else if chars.peek() == Some(&']') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next == '\x07' {
                        break;
                    }
                    // Two-byte ST: ESC followed by backslash
                    if next == '\x1b' {
                        if chars.peek() == Some(&'\\') {
                            chars.next(); // consume the trailing '\'
                        }
                        break;
                    }
                }
            }
            // Other ESC sequences: consume next char
            else {
                chars.next();
            }
        } else if c == '\r' {
            // Skip carriage returns
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_basic() {
        let mut buf = OutputBuffer::new(100);
        buf.feed("line1\nline2\nline3\n");
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.tail(2), vec!["line2", "line3"]);
    }

    #[test]
    fn test_buffer_partial_line() {
        let mut buf = OutputBuffer::new(100);
        buf.feed("hello ");
        assert_eq!(buf.len(), 0); // no newline yet
        buf.feed("world\n");
        assert_eq!(buf.len(), 1);
        assert_eq!(buf.tail(1), vec!["hello world"]);
    }

    #[test]
    fn test_buffer_many_newlines_preserves_tail_and_partial() {
        let mut buf = OutputBuffer::new(3);
        buf.feed("a\nb\nc\nd\npartial");

        assert_eq!(buf.len(), 3);
        assert_eq!(buf.tail(10), vec!["b", "c", "d"]);
        assert_eq!(buf.content(), "b\nc\nd\npartial");
    }

    #[test]
    fn test_buffer_overflow() {
        let mut buf = OutputBuffer::new(3);
        buf.feed("a\nb\nc\nd\ne\n");
        assert_eq!(buf.len(), 3);
        assert_eq!(buf.tail(3), vec!["c", "d", "e"]);
    }

    #[test]
    fn test_buffer_content() {
        let mut buf = OutputBuffer::new(100);
        buf.feed("line1\nline2\npartial");
        assert_eq!(buf.content(), "line1\nline2\npartial");
    }

    #[test]
    fn test_strip_ansi_colors() {
        let input = "\x1b[31mERROR\x1b[0m: something failed";
        assert_eq!(strip_ansi(input), "ERROR: something failed");
    }

    #[test]
    fn test_strip_ansi_cursor() {
        let input = "\x1b[2J\x1b[H\x1b[?25hHello";
        assert_eq!(strip_ansi(input), "Hello");
    }

    #[test]
    fn test_strip_ansi_clean_text() {
        let input = "no escape codes here";
        assert_eq!(strip_ansi(input), "no escape codes here");
    }

    #[test]
    fn test_strip_carriage_return() {
        let input = "hello\r\nworld\r\n";
        assert_eq!(strip_ansi(input), "hello\nworld\n");
    }

    #[test]
    fn test_command_blocks_powershell() {
        let lines = vec![
            "PS C:\\Users\\owner> git status".to_string(),
            "On branch main".to_string(),
            "nothing to commit".to_string(),
            "PS C:\\Users\\owner> ls".to_string(),
            "file1.txt".to_string(),
            "file2.txt".to_string(),
        ];
        let blocks = extract_command_blocks(&lines);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].command, "git status");
        assert_eq!(blocks[0].output.len(), 2);
        assert_eq!(blocks[1].command, "ls");
        assert_eq!(blocks[1].output.len(), 2);
    }

    #[test]
    fn test_command_blocks_bash() {
        let lines = vec![
            "user@host:~$ echo hello".to_string(),
            "hello".to_string(),
            "user@host:~$ pwd".to_string(),
            "/home/user".to_string(),
        ];
        let blocks = extract_command_blocks(&lines);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].command, "echo hello");
        assert_eq!(blocks[1].command, "pwd");
    }

    #[test]
    fn test_command_blocks_no_prompts() {
        let lines = vec!["just some output".to_string(), "more output".to_string()];
        let blocks = extract_command_blocks(&lines);
        assert_eq!(blocks.len(), 0);
    }

    #[test]
    fn test_command_blocks_empty_prompt() {
        let lines = vec!["PS C:\\Users\\owner>".to_string()];
        let blocks = extract_command_blocks(&lines);
        // Empty command should be excluded
        assert_eq!(blocks.len(), 0);
    }
}
