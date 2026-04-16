//! Syntax highlighting using tree-sitter.
//!
//! Detects language from file extension, parses with tree-sitter,
//! and produces per-byte highlight spans mapped to Catppuccin colors.

use std::path::Path;

use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

use super::cat;

/// Recognized highlight capture names (order matches HIGHLIGHT_COLORS).
const HIGHLIGHT_NAMES: &[&str] = &[
    "keyword",
    "string",
    "comment",
    "function",
    "function.method",
    "type",
    "type.builtin",
    "number",
    "operator",
    "variable",
    "variable.builtin",
    "variable.parameter",
    "property",
    "constant",
    "constant.builtin",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "attribute",
    "label",
    "escape",
    "constructor",
    "tag",
    "namespace",
];

/// Catppuccin Mocha colors for each highlight name (same order as HIGHLIGHT_NAMES).
const HIGHLIGHT_COLORS: &[[f32; 4]] = &[
    [0.80, 0.65, 0.97, 1.0], // keyword — Mauve
    [0.65, 0.89, 0.63, 1.0], // string — Green
    [0.42, 0.44, 0.53, 1.0], // comment — Overlay0
    [0.54, 0.71, 0.98, 1.0], // function — Blue
    [0.54, 0.71, 0.98, 1.0], // function.method — Blue
    [0.98, 0.89, 0.69, 1.0], // type — Yellow
    [0.98, 0.89, 0.69, 1.0], // type.builtin — Yellow
    [0.98, 0.70, 0.53, 1.0], // number — Peach
    [0.54, 0.86, 0.92, 1.0], // operator — Sky
    [0.81, 0.83, 0.88, 1.0], // variable — Text
    [0.95, 0.55, 0.66, 1.0], // variable.builtin — Red
    [0.95, 0.55, 0.66, 1.0], // variable.parameter — Red (Maroon)
    [0.71, 0.75, 1.0, 1.0],  // property — Lavender
    [0.98, 0.70, 0.53, 1.0], // constant — Peach
    [0.98, 0.70, 0.53, 1.0], // constant.builtin — Peach
    [0.58, 0.60, 0.71, 1.0], // punctuation — Overlay2
    [0.58, 0.60, 0.71, 1.0], // punctuation.bracket — Overlay2
    [0.58, 0.60, 0.71, 1.0], // punctuation.delimiter — Overlay2
    [0.98, 0.89, 0.69, 1.0], // attribute — Yellow
    [0.54, 0.86, 0.92, 1.0], // label — Sky
    [0.98, 0.70, 0.53, 1.0], // escape — Peach
    [0.54, 0.71, 0.98, 1.0], // constructor — Blue
    [0.54, 0.71, 0.98, 1.0], // tag — Blue
    [0.80, 0.65, 0.97, 1.0], // namespace — Mauve
];

/// A highlighted span in the source text.
#[derive(Clone)]
pub struct HighlightSpan {
    pub start_byte: usize,
    pub end_byte: usize,
    pub color: [f32; 4],
}

/// Syntax highlighting state for a file.
pub struct SyntaxState {
    pub language_name: String,
    spans: Vec<HighlightSpan>,
}

impl SyntaxState {
    /// Create highlighting for a file. Returns None if language is unsupported.
    pub fn from_path(path: &Path, source: &str) -> Option<Self> {
        let ext = path.extension()?.to_str()?;
        let lang_name = ext_to_language(ext)?;

        let mut config = make_config(ext)?;
        config.configure(HIGHLIGHT_NAMES);

        let spans = run_highlight(&config, source);

        Some(Self {
            language_name: lang_name.to_string(),
            spans,
        })
    }

    /// Re-highlight after an edit.
    pub fn rehighlight(&mut self, path: &Path, source: &str) {
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e,
            None => return,
        };

        let mut config = match make_config(ext) {
            Some(c) => c,
            None => return,
        };
        config.configure(HIGHLIGHT_NAMES);
        self.spans = run_highlight(&config, source);
    }

    /// Get the highlight color for a byte offset. Returns default text color if no highlight.
    pub fn color_at_byte(&self, byte_offset: usize) -> [f32; 4] {
        // Binary search for the span containing this byte
        let idx = self.spans.partition_point(|s| s.end_byte <= byte_offset);
        if idx < self.spans.len() && self.spans[idx].start_byte <= byte_offset {
            self.spans[idx].color
        } else {
            cat::text()
        }
    }

    /// Get colors for a line's characters given byte offsets.
    pub fn colors_for_line(&self, line_start_byte: usize, char_bytes: &[(usize, usize)]) -> Vec<[f32; 4]> {
        char_bytes
            .iter()
            .map(|(start, _end)| self.color_at_byte(line_start_byte + start))
            .collect()
    }
}

/// Map file extension to language name.
fn ext_to_language(ext: &str) -> Option<&'static str> {
    match ext.to_lowercase().as_str() {
        "rs" => Some("rust"),
        "js" | "mjs" | "cjs" => Some("javascript"),
        "ts" | "tsx" | "jsx" => Some("typescript"),
        "py" | "pyw" => Some("python"),
        "json" | "jsonc" => Some("json"),
        "toml" => Some("toml"),
        _ => None,
    }
}

/// Create a HighlightConfiguration for the given extension.
fn make_config(ext: &str) -> Option<HighlightConfiguration> {
    let lower = ext.to_lowercase();
    match lower.as_str() {
        "rs" => HighlightConfiguration::new(
            tree_sitter_rust::LANGUAGE.into(),
            "rust",
            tree_sitter_rust::HIGHLIGHTS_QUERY,
            tree_sitter_rust::INJECTIONS_QUERY,
            "",
        )
        .ok(),
        "js" | "mjs" | "cjs" | "jsx" => HighlightConfiguration::new(
            tree_sitter_javascript::LANGUAGE.into(),
            "javascript",
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY,
        )
        .ok(),
        "ts" | "tsx" => {
            // TypeScript uses JavaScript grammar + TS-specific queries
            let combined_highlights = format!(
                "{}\n{}",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_javascript::HIGHLIGHT_QUERY,
            );
            HighlightConfiguration::new(
                tree_sitter_javascript::LANGUAGE.into(),
                "typescript",
                &combined_highlights,
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_javascript::LOCALS_QUERY,
            )
            .ok()
        }
        "py" | "pyw" => HighlightConfiguration::new(
            tree_sitter_python::LANGUAGE.into(),
            "python",
            tree_sitter_python::HIGHLIGHTS_QUERY,
            "",
            "",
        )
        .ok(),
        "json" | "jsonc" => HighlightConfiguration::new(
            tree_sitter_json::LANGUAGE.into(),
            "json",
            tree_sitter_json::HIGHLIGHTS_QUERY,
            "",
            "",
        )
        .ok(),
        "toml" => HighlightConfiguration::new(
            tree_sitter_toml_ng::LANGUAGE.into(),
            "toml",
            tree_sitter_toml_ng::HIGHLIGHTS_QUERY,
            "",
            "",
        )
        .ok(),
        _ => None,
    }
}

/// Run tree-sitter-highlight and produce sorted spans.
fn run_highlight(config: &HighlightConfiguration, source: &str) -> Vec<HighlightSpan> {
    let mut highlighter = Highlighter::new();
    let events = match highlighter.highlight(config, source.as_bytes(), None, |_| None) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut spans = Vec::new();
    let mut stack: Vec<[f32; 4]> = Vec::new();

    for event in events {
        match event {
            Ok(HighlightEvent::Source { start, end }) => {
                if let Some(&color) = stack.last() {
                    spans.push(HighlightSpan {
                        start_byte: start,
                        end_byte: end,
                        color,
                    });
                }
            }
            Ok(HighlightEvent::HighlightStart(h)) => {
                let color = HIGHLIGHT_COLORS
                    .get(h.0)
                    .copied()
                    .unwrap_or(cat::text());
                stack.push(color);
            }
            Ok(HighlightEvent::HighlightEnd) => {
                stack.pop();
            }
            Err(_) => break,
        }
    }

    spans
}
