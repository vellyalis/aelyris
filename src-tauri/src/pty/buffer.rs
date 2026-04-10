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

        // Split on newlines, keeping the last segment as partial
        while let Some(pos) = self.partial.find('\n') {
            let line = self.partial[..pos].to_string();
            self.partial = self.partial[pos + 1..].to_string();
            self.push_line(line);
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

    fn push_line(&mut self, line: String) {
        if self.lines.len() >= self.max_lines {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }
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
                    if next == '\x07' || next == '\\' {
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
}
