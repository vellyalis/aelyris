use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use super::buffer::{strip_ansi, OutputBuffer};

const DEFAULT_MAX_BYTES_PER_TERMINAL: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyScrollbackSearchMatch {
    pub line: usize,
    pub column: usize,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct FilePtyScrollbackStore {
    root: PathBuf,
    max_bytes_per_terminal: usize,
}

impl FilePtyScrollbackStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            max_bytes_per_terminal: DEFAULT_MAX_BYTES_PER_TERMINAL,
        }
    }

    #[cfg(test)]
    pub fn with_max_bytes(mut self, max_bytes: usize) -> Self {
        self.max_bytes_per_terminal = max_bytes.max(1024);
        self
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn append(&self, terminal_id: &str, text: &str) -> Result<(), String> {
        if text.is_empty() {
            return Ok(());
        }
        fs::create_dir_all(&self.root)
            .map_err(|err| format!("create scrollback dir {}: {err}", self.root.display()))?;
        let path = self.path_for(terminal_id);
        {
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|err| format!("open scrollback {}: {err}", path.display()))?;
            file.write_all(text.as_bytes())
                .map_err(|err| format!("append scrollback {}: {err}", path.display()))?;
        }
        self.prune_if_needed(&path)
    }

    pub fn capture(&self, terminal_id: &str, lines: usize, clean: bool) -> Result<String, String> {
        let path = self.path_for(terminal_id);
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
            Err(err) => return Err(format!("read scrollback {}: {err}", path.display())),
        };
        let line_count = lines.clamp(1, 20_000);
        let mut buffer = OutputBuffer::new(line_count.saturating_add(1));
        buffer.feed(&text);
        let output = buffer.tail_including_partial(line_count).join("\n");
        if clean {
            Ok(strip_ansi(&output))
        } else {
            Ok(output)
        }
    }

    pub fn search(
        &self,
        terminal_id: &str,
        query: &str,
        lines: usize,
        case_sensitive: bool,
        limit: usize,
    ) -> Result<Vec<PtyScrollbackSearchMatch>, String> {
        let captured = self.capture(terminal_id, lines, true)?;
        Ok(search_scrollback_text(
            &captured,
            query,
            case_sensitive,
            limit,
        ))
    }

    pub fn has_terminal(&self, terminal_id: &str) -> bool {
        self.path_for(terminal_id).exists()
    }

    fn prune_if_needed(&self, path: &Path) -> Result<(), String> {
        let len = fs::metadata(path)
            .map_err(|err| format!("stat scrollback {}: {err}", path.display()))?
            .len() as usize;
        if len <= self.max_bytes_per_terminal {
            return Ok(());
        }
        let text = fs::read_to_string(path)
            .map_err(|err| format!("read scrollback for prune {}: {err}", path.display()))?;
        let target_chars = self.max_bytes_per_terminal / 2;
        let tail = text
            .chars()
            .rev()
            .take(target_chars)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>();
        fs::write(path, tail)
            .map_err(|err| format!("write pruned scrollback {}: {err}", path.display()))
    }

    fn path_for(&self, terminal_id: &str) -> PathBuf {
        self.root
            .join(format!("{}.log", encode_terminal_id(terminal_id)))
    }
}

pub fn search_scrollback_text(
    text: &str,
    query: &str,
    case_sensitive: bool,
    limit: usize,
) -> Vec<PtyScrollbackSearchMatch> {
    let needle = query.trim();
    let max_hits = limit.clamp(1, 1000);
    if needle.is_empty() {
        return Vec::new();
    }

    let searchable_needle = if case_sensitive {
        needle.to_string()
    } else {
        needle.to_lowercase()
    };
    let mut matches = Vec::new();
    for (line_index, line) in strip_ansi(text).lines().enumerate() {
        let searchable_line = if case_sensitive {
            line.to_string()
        } else {
            line.to_lowercase()
        };
        let mut offset = 0;
        while let Some(hit) = searchable_line[offset..].find(&searchable_needle) {
            let column = offset + hit;
            matches.push(PtyScrollbackSearchMatch {
                line: line_index,
                column,
                text: line.to_string(),
            });
            if matches.len() >= max_hits {
                return matches;
            }
            offset = column.saturating_add(searchable_needle.len().max(1));
        }
    }
    matches
}

fn encode_terminal_id(terminal_id: &str) -> String {
    let mut encoded = String::new();
    for byte in terminal_id.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    if encoded.is_empty() {
        "%00".to_string()
    } else {
        encoded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_capture_and_clean_scrollback() {
        let temp = tempfile::tempdir().unwrap();
        let store = FilePtyScrollbackStore::new(temp.path());
        store.append("pane:1", "\x1b[31mhello\x1b[0m\n").unwrap();
        store.append("pane:1", "world\n").unwrap();

        assert!(store.has_terminal("pane:1"));
        assert_eq!(store.capture("pane:1", 2, true).unwrap(), "hello\nworld");
        assert!(store
            .capture("pane:1", 2, false)
            .unwrap()
            .contains("\x1b[31m"));
        assert!(temp.path().join("pane%3A1.log").exists());
    }

    #[test]
    fn capture_keeps_final_partial_line() {
        let temp = tempfile::tempdir().unwrap();
        let store = FilePtyScrollbackStore::new(temp.path());
        store.append("term", "done\nPS C:\\work>").unwrap();

        assert_eq!(
            store.capture("term", 2, true).unwrap(),
            "done\nPS C:\\work>"
        );
    }

    #[test]
    fn prune_keeps_tail_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let store = FilePtyScrollbackStore::new(temp.path()).with_max_bytes(1024);
        store.append("term", &"a".repeat(900)).unwrap();
        store
            .append("term", &format!("{}\nlast\n", "b".repeat(900)))
            .unwrap();

        let captured = store.capture("term", 5, true).unwrap();
        assert!(captured.contains("last"));
        assert!(fs::metadata(store.path_for("term")).unwrap().len() <= 1024);
    }

    #[test]
    fn search_finds_multiple_matches_in_captured_window() {
        let temp = tempfile::tempdir().unwrap();
        let store = FilePtyScrollbackStore::new(temp.path());
        store
            .append(
                "term",
                "alpha\nNeedle first\nother\nneedle second\nneedle third\n",
            )
            .unwrap();

        let matches = store.search("term", "needle", 5, false, 2).unwrap();

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].line, 1);
        assert_eq!(matches[0].column, 0);
        assert_eq!(matches[0].text, "Needle first");
        assert_eq!(matches[1].text, "needle second");
    }

    #[test]
    fn search_respects_case_sensitive_mode() {
        let matches = search_scrollback_text("Needle\nneedle\n", "Needle", true, 10);

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].text, "Needle");
    }
}
