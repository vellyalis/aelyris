//! Warp-style block output — groups command + output into collapsible blocks.
//!
//! Detects shell prompt lines to identify where commands start, then tracks
//! each command's output range so blocks can be collapsed/expanded in the UI.

use regex::Regex;

/// Detects shell prompt lines using compiled regex patterns.
pub struct PromptDetector {
    patterns: Vec<Regex>,
}

impl PromptDetector {
    /// Initialize with default patterns for PowerShell, Bash, and CMD.
    pub fn new() -> Self {
        let defaults = [
            r"PS [A-Z]:\\.*>",   // PowerShell: PS C:\Users\owner>
            r".*[$#] $",        // Bash: user@host:~$
            r"[A-Z]:\\.*>",     // CMD: C:\Users\owner>
        ];

        let patterns = defaults
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();

        Self { patterns }
    }

    /// Check if a line matches any known prompt pattern.
    pub fn is_prompt_line(&self, text: &str) -> bool {
        self.patterns.iter().any(|re| re.is_match(text))
    }

    /// Add a custom prompt pattern (e.g., from user config).
    pub fn add_pattern(&mut self, pattern: &str) {
        if let Ok(re) = Regex::new(pattern) {
            self.patterns.push(re);
        }
    }
}

impl Default for PromptDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// A single command block: the prompt line, the command text, and its output range.
pub struct CommandBlock {
    /// The command text (e.g., "cargo build").
    pub command: String,
    /// Grid row where the prompt was detected.
    pub prompt_row: usize,
    /// First row of command output.
    pub output_start: usize,
    /// Last row of output (None = command still running).
    pub output_end: Option<usize>,
    /// Whether the block is collapsed (folded).
    pub collapsed: bool,
    /// Exit code if detected.
    pub exit_code: Option<i32>,
}

/// Tracks all detected command blocks in the terminal output.
pub struct BlockTracker {
    blocks: Vec<CommandBlock>,
    detector: PromptDetector,
}

impl BlockTracker {
    pub fn new() -> Self {
        Self {
            blocks: Vec::new(),
            detector: PromptDetector::new(),
        }
    }

    /// Process a new line of terminal output.
    ///
    /// When a prompt line is detected, the previous block's output is closed
    /// and a new block is opened. The command text is extracted by stripping
    /// the prompt prefix from the line.
    pub fn process_line(&mut self, row: usize, text: &str) {
        if self.detector.is_prompt_line(text) {
            // Close the previous block's output range
            if let Some(prev) = self.blocks.last_mut() {
                if prev.output_end.is_none() {
                    // Output ends at the row before this prompt
                    prev.output_end = Some(row.saturating_sub(1));
                }
            }

            // Extract command text by removing the prompt prefix.
            // Find the last '>' or '$' that is part of the prompt, then take
            // everything after it as the command.
            let command = self.extract_command(text);

            self.blocks.push(CommandBlock {
                command,
                prompt_row: row,
                output_start: row + 1,
                output_end: None,
                collapsed: false,
                exit_code: None,
            });
        }
    }

    /// Toggle the collapsed/fold state of a block by index.
    pub fn toggle_collapse(&mut self, block_index: usize) {
        if let Some(block) = self.blocks.get_mut(block_index) {
            block.collapsed = !block.collapsed;
        }
    }

    /// Find which block contains a given row.
    ///
    /// Returns `(block_index, &CommandBlock)` if found.
    pub fn block_at_row(&self, row: usize) -> Option<(usize, &CommandBlock)> {
        for (i, block) in self.blocks.iter().enumerate() {
            let end = block.output_end.unwrap_or(usize::MAX);
            if row >= block.prompt_row && row <= end {
                return Some((i, block));
            }
        }
        None
    }

    /// Return all blocks visible within a viewport range (inclusive).
    pub fn visible_blocks(
        &self,
        viewport_start: usize,
        viewport_end: usize,
    ) -> Vec<(usize, &CommandBlock)> {
        self.blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| {
                let block_end = block.output_end.unwrap_or(usize::MAX);
                // Block overlaps viewport if it starts before viewport ends
                // and ends after viewport starts
                block.prompt_row <= viewport_end && block_end >= viewport_start
            })
            .collect()
    }

    /// Get a reference to all blocks.
    pub fn blocks(&self) -> &[CommandBlock] {
        &self.blocks
    }

    /// Get a reference to the prompt detector.
    pub fn detector(&self) -> &PromptDetector {
        &self.detector
    }

    /// Get a mutable reference to the prompt detector (e.g., to add patterns).
    pub fn detector_mut(&mut self) -> &mut PromptDetector {
        &mut self.detector
    }

    /// Extract the command portion from a prompt line.
    fn extract_command(&self, line: &str) -> String {
        // For PowerShell "PS C:\foo> command", split on "> "
        // For Bash "user@host:~$ command", split on "$ "
        // For CMD "C:\foo>command", split on ">"
        if let Some(pos) = line.rfind("> ") {
            return line[pos + 2..].trim().to_string();
        }
        if let Some(pos) = line.rfind("$ ") {
            return line[pos + 2..].trim().to_string();
        }
        if let Some(pos) = line.rfind('>') {
            return line[pos + 1..].trim().to_string();
        }
        line.trim().to_string()
    }
}

impl Default for BlockTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_prompt_detected() {
        let detector = PromptDetector::new();
        assert!(detector.is_prompt_line("PS C:\\Users\\owner>"));
        assert!(detector.is_prompt_line("PS D:\\Projects\\aether>"));
    }

    #[test]
    fn bash_prompt_detected() {
        let detector = PromptDetector::new();
        assert!(detector.is_prompt_line("user@host:~$ "));
        assert!(detector.is_prompt_line("root@server:/var/log# "));
    }

    #[test]
    fn non_prompt_not_matched() {
        let detector = PromptDetector::new();
        assert!(!detector.is_prompt_line("Hello world"));
        assert!(!detector.is_prompt_line("cargo build finished"));
        assert!(!detector.is_prompt_line("   Compiling aether v0.1.0"));
    }

    #[test]
    fn custom_pattern_added() {
        let mut detector = PromptDetector::new();
        detector.add_pattern(r"^>>> ");
        assert!(detector.is_prompt_line(">>> import os"));
    }

    #[test]
    fn block_tracking_prompt_output_prompt() {
        let mut tracker = BlockTracker::new();

        // Line 0: prompt
        tracker.process_line(0, "PS C:\\Users\\owner> cargo build");
        // Line 1: output
        tracker.process_line(1, "   Compiling aether v0.1.0");
        // Line 2: next prompt (closes previous block)
        tracker.process_line(2, "PS C:\\Users\\owner> ls");

        let blocks = tracker.blocks();
        assert_eq!(blocks.len(), 2);

        // First block: closed, output row 1
        assert_eq!(blocks[0].command, "cargo build");
        assert_eq!(blocks[0].prompt_row, 0);
        assert_eq!(blocks[0].output_start, 1);
        assert_eq!(blocks[0].output_end, Some(1));

        // Second block: still open
        assert_eq!(blocks[1].command, "ls");
        assert_eq!(blocks[1].prompt_row, 2);
        assert_eq!(blocks[1].output_start, 3);
        assert_eq!(blocks[1].output_end, None);
    }

    #[test]
    fn toggle_collapse() {
        let mut tracker = BlockTracker::new();
        tracker.process_line(0, "PS C:\\Users\\owner> echo hello");

        assert!(!tracker.blocks()[0].collapsed);
        tracker.toggle_collapse(0);
        assert!(tracker.blocks()[0].collapsed);
        tracker.toggle_collapse(0);
        assert!(!tracker.blocks()[0].collapsed);
    }

    #[test]
    fn toggle_collapse_invalid_index() {
        let mut tracker = BlockTracker::new();
        // Should not panic on out-of-bounds index
        tracker.toggle_collapse(99);
    }

    #[test]
    fn block_at_row_returns_correct_block() {
        let mut tracker = BlockTracker::new();

        tracker.process_line(0, "PS C:\\Users\\owner> cargo build");
        tracker.process_line(1, "   Compiling...");
        tracker.process_line(2, "   Finished...");
        tracker.process_line(3, "PS C:\\Users\\owner> cargo test");

        // Row 0 is in the first block (prompt row)
        let (idx, block) = tracker.block_at_row(0).unwrap();
        assert_eq!(idx, 0);
        assert_eq!(block.command, "cargo build");

        // Row 2 is in the first block (output)
        let (idx, _) = tracker.block_at_row(2).unwrap();
        assert_eq!(idx, 0);

        // Row 3 is in the second block (prompt row)
        let (idx, block) = tracker.block_at_row(3).unwrap();
        assert_eq!(idx, 1);
        assert_eq!(block.command, "cargo test");

        // Row 5 is in the second block (still open, output_end = None)
        let (idx, _) = tracker.block_at_row(5).unwrap();
        assert_eq!(idx, 1);
    }

    #[test]
    fn visible_blocks_in_viewport() {
        let mut tracker = BlockTracker::new();

        // Block 0: rows 0-4
        tracker.process_line(0, "PS C:\\Users\\owner> cmd1");
        tracker.process_line(5, "PS C:\\Users\\owner> cmd2");
        // Block 1: rows 5-9
        tracker.process_line(10, "PS C:\\Users\\owner> cmd3");

        // Viewport [3, 7] should include block 0 (ends at 4) and block 1 (starts at 5)
        let visible = tracker.visible_blocks(3, 7);
        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].0, 0);
        assert_eq!(visible[1].0, 1);
    }

    #[test]
    fn cmd_prompt_detected() {
        let detector = PromptDetector::new();
        assert!(detector.is_prompt_line("C:\\Windows\\System32>"));
    }

    #[test]
    fn bash_command_extraction() {
        let tracker = BlockTracker::new();
        let cmd = tracker.extract_command("user@host:~$ ls -la");
        assert_eq!(cmd, "ls -la");
    }

    #[test]
    fn powershell_command_extraction() {
        let tracker = BlockTracker::new();
        let cmd = tracker.extract_command("PS C:\\Users\\owner> Get-Process");
        assert_eq!(cmd, "Get-Process");
    }
}
