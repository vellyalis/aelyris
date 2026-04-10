use serde::{Deserialize, Serialize};

/// Events emitted by Claude Code's `--output-format stream-json`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub subtype: Option<String>,

    // system events
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,

    // assistant events
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,

    // result events
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub total_tokens: Option<u64>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

impl StreamEvent {
    pub fn is_system(&self) -> bool {
        self.event_type == "system"
    }

    pub fn is_assistant(&self) -> bool {
        self.event_type == "assistant"
    }

    pub fn is_result(&self) -> bool {
        self.event_type == "result"
    }

    pub fn is_tool_use(&self) -> bool {
        self.is_assistant() && self.subtype.as_deref() == Some("tool_use")
    }
}

/// Line-based streaming parser for Claude Code stream-json output.
///
/// Handles partial JSON across chunk boundaries by buffering incomplete lines.
pub struct StreamParser {
    buffer: String,
}

impl StreamParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
        }
    }

    /// Feed a chunk of data from stdout, returns all successfully parsed events.
    ///
    /// Incomplete lines are buffered until the next call.
    /// Malformed JSON lines are silently skipped.
    pub fn feed(&mut self, chunk: &str) -> Vec<StreamEvent> {
        self.buffer.push_str(chunk);

        let mut events = Vec::new();
        let mut remaining = String::new();

        let lines: Vec<&str> = self.buffer.split('\n').collect();
        let last_idx = lines.len().saturating_sub(1);

        for (i, line) in lines.iter().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            // If this is the last segment and buffer didn't end with \n,
            // it might be a partial line — keep it in the buffer
            if i == last_idx && !self.buffer.ends_with('\n') {
                remaining = line.to_string();
                continue;
            }

            match serde_json::from_str::<StreamEvent>(trimmed) {
                Ok(event) => events.push(event),
                Err(_) => {
                    // Malformed JSON, skip
                }
            }
        }

        self.buffer = remaining;

        events
    }

    /// Flush any remaining buffer (call when stream ends)
    pub fn flush(&mut self) -> Vec<StreamEvent> {
        if self.buffer.trim().is_empty() {
            self.buffer.clear();
            return Vec::new();
        }

        let last = self.buffer.clone();
        self.buffer.clear();

        match serde_json::from_str::<StreamEvent>(last.trim()) {
            Ok(event) => vec![event],
            Err(_) => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_line() {
        let mut parser = StreamParser::new();
        let events = parser.feed(
            "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"abc\"}\n",
        );
        assert_eq!(events.len(), 1);
        assert!(events[0].is_system());
        assert_eq!(events[0].session_id.as_deref(), Some("abc"));
    }

    #[test]
    fn test_parse_multiple_lines() {
        let mut parser = StreamParser::new();
        let input = concat!(
            "{\"type\":\"system\",\"subtype\":\"init\"}\n",
            "{\"type\":\"assistant\",\"subtype\":\"text\",\"content\":\"hello\"}\n",
            "{\"type\":\"result\",\"subtype\":\"success\",\"cost_usd\":0.01,\"total_tokens\":500,\"duration_ms\":1000}\n",
        );
        let events = parser.feed(input);
        assert_eq!(events.len(), 3);
        assert!(events[0].is_system());
        assert!(events[1].is_assistant());
        assert_eq!(events[1].content.as_deref(), Some("hello"));
        assert!(events[2].is_result());
        assert_eq!(events[2].cost_usd, Some(0.01));
    }

    #[test]
    fn test_partial_json_buffering() {
        let mut parser = StreamParser::new();

        // Feed first half
        let events1 = parser.feed("{\"type\":\"system\",\"sub");
        assert_eq!(events1.len(), 0);

        // Feed second half
        let events2 = parser.feed("type\":\"init\"}\n");
        assert_eq!(events2.len(), 1);
        assert!(events2[0].is_system());
    }

    #[test]
    fn test_malformed_json_skipped() {
        let mut parser = StreamParser::new();
        let input = concat!(
            "this is not json\n",
            "{\"type\":\"assistant\",\"subtype\":\"text\",\"content\":\"ok\"}\n",
            "{broken json}\n",
        );
        let events = parser.feed(input);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content.as_deref(), Some("ok"));
    }

    #[test]
    fn test_tool_use_detection() {
        let mut parser = StreamParser::new();
        let events = parser.feed(
            "{\"type\":\"assistant\",\"subtype\":\"tool_use\",\"tool_name\":\"Read\",\"tool_input\":{\"path\":\"test.txt\"}}\n",
        );
        assert_eq!(events.len(), 1);
        assert!(events[0].is_tool_use());
        assert_eq!(events[0].tool_name.as_deref(), Some("Read"));
    }

    #[test]
    fn test_unknown_fields_ignored() {
        let mut parser = StreamParser::new();
        let events = parser.feed(
            "{\"type\":\"system\",\"subtype\":\"init\",\"unknown_field\":\"value\",\"another\":123}\n",
        );
        assert_eq!(events.len(), 1);
        assert!(events[0].is_system());
    }

    #[test]
    fn test_flush() {
        let mut parser = StreamParser::new();
        parser.feed("{\"type\":\"result\",\"cost_usd\":0.05}");
        let events = parser.flush();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].cost_usd, Some(0.05));
    }
}
