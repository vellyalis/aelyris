//! Symbol extraction — derive [`SymbolIntent`]s from a source (spec §6.3 tiers).
//!
//! **Tier implemented here: DIFF-HUNK.** Parse a unified diff's hunk headers into
//! per-file NEW-side line ranges, tagged [`Confidence::DiffHunk`]. DiffHunk is the
//! INFERRED tier: it never unlocks symbol-level parallelism ([`super::unlocks_parallelism`]
//! returns false), so an agent's actual edits serialize overlapping ready tasks and
//! light the conflict badge with PRECISE ranges, but can never prove disjointness
//! (the §6.5 slow path). It needs no language server, no parser, no file contents —
//! only the diff text the agent already has (`git diff` / [`crate::git::merge::diff_three_dot`]).
//!
//! Higher tiers that DO prove exact boundaries (LSP `textDocument/documentSymbol`,
//! a parser) are deferred to a later increment; they emit `Confidence::Lsp`/`Parser`
//! intents and plug in alongside this one. No `SymbolExtractor` trait is introduced
//! yet — with one tier it would be speculative abstraction; the trait seam lands
//! with the second tier, when its shape is known.
//!
//! Pure: no I/O, no clock, no locks. The diff text is supplied by the caller and the
//! wiring layer (IPC/MCP) stamps claim ids + leases.

use super::{ClaimMode, Confidence, SymbolIntent, SymbolRange};

/// Upper bound on a derived line number. The diff text is UNTRUSTED (an agent
/// supplies it), so every parsed line is clamped to this before any range
/// arithmetic — an adversarial `@@ ... +1,4294967295 @@` can't overflow (debug
/// panic / release wrap). No real source file approaches 10M lines.
const MAX_LINE: u32 = 10_000_000;

/// A changed line span derived from one diff hunk: the NEW-file (post-edit) range
/// in `path`, 1-based inclusive (matching [`SymbolRange`]'s convention).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunkSpan {
    pub path: String,
    pub range: SymbolRange,
}

/// Strip a unified-diff file-header path: drop the `+++ `/`--- ` already removed by
/// the caller, then a leading `a/` or `b/`, and surface `/dev/null` as `None` (an
/// added or deleted side has no real path there). Trailing `\r` is handled by
/// [`str::lines`] before this is called.
fn normalize_header_path(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw == "/dev/null" {
        return None;
    }
    let path = raw
        .strip_prefix("a/")
        .or_else(|| raw.strip_prefix("b/"))
        .unwrap_or(raw);
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

/// Parse a hunk header `@@ -<oldStart>[,<oldCount>] +<newStart>[,<newCount>] @@ [heading]`
/// into the NEW side `(start, count)`. `count` defaults to 1 when omitted. Dep-free
/// (no regex): we slice to the text between the leading `@@ ` and the closing ` @@`
/// so an optional trailing section heading can't be mistaken for the range.
fn parse_hunk_new_side(line: &str) -> Option<(u32, u32)> {
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let ranges = &rest[..end];
    let plus = ranges.split_whitespace().find(|t| t.starts_with('+'))?;
    let mut nums = plus[1..].split(',');
    let start: u32 = nums.next()?.parse().ok()?;
    let count: u32 = match nums.next() {
        Some(c) => c.parse().ok()?,
        None => 1,
    };
    Some((start, count))
}

/// Parse a unified diff into per-hunk NEW-file line spans. Tracks the current file
/// from `+++ b/<path>` headers (falling back to the `--- a/<path>` old path when the
/// new side is `/dev/null`, i.e. a deletion) and each hunk's new-side `(c, d)`:
/// span `[c, c+d-1]`. A pure deletion (`d == 0`) is recorded as the single boundary
/// line `max(c, 1)` so the edit LOCATION still claims its region. Unparseable lines
/// (context, `diff --git`, the truncation marker) are ignored.
pub fn parse_diff_hunks(diff: &str) -> Vec<DiffHunkSpan> {
    let mut spans = Vec::new();
    let mut new_path: Option<String> = None;
    let mut old_path: Option<String> = None;
    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            new_path = normalize_header_path(rest);
            continue;
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            old_path = normalize_header_path(rest);
            continue;
        }
        if line.starts_with("@@ ") {
            let Some((start, count)) = parse_hunk_new_side(line) else {
                continue;
            };
            // Prefer the new-side path; a deletion (+dev/null) keeps the old path so
            // the touched file is still attributed. (A pure `rename from/to` with no
            // content change emits no `---`/`+++`/`@@`, so it never reaches here and
            // claims nothing — the right conservative miss, not a wrong range.)
            let Some(path) = new_path.clone().or_else(|| old_path.clone()) else {
                continue;
            };
            // Clamp+saturate against the untrusted count (see MAX_LINE).
            let start = start.clamp(1, MAX_LINE);
            let range = if count == 0 {
                SymbolRange::new(start, start) // pure deletion -> single boundary line
            } else {
                let end = start.saturating_add(count.saturating_sub(1)).min(MAX_LINE);
                SymbolRange::new(start, end)
            };
            spans.push(DiffHunkSpan { path, range });
        }
    }
    spans
}

/// Derive declared DiffHunk [`SymbolIntent`]s from a diff for the given `mode` — one
/// intent per hunk, labelled by its file range. Returns EMPTY for a diff with no
/// hunks: absence IS the FILE-FALLBACK tier (the existing file gate enforces
/// file-level exclusivity; we never fabricate a whole-file range without reading the
/// file, which would require I/O and break purity).
pub fn intents_from_diff(diff: &str, mode: ClaimMode) -> Vec<SymbolIntent> {
    parse_diff_hunks(diff)
        .into_iter()
        .map(|hunk| SymbolIntent {
            symbol: format!("hunk:{}-{}", hunk.range.start_line, hunk.range.end_line),
            path: hunk.path,
            range: hunk.range,
            mode,
            confidence: Confidence::DiffHunk,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
diff --git a/src/auth.rs b/src/auth.rs
index 1111111..2222222 100644
--- a/src/auth.rs
+++ b/src/auth.rs
@@ -10,3 +10,5 @@ fn login() {
 ctx
-old
+new1
+new2
+new3
@@ -40,2 +42,2 @@ fn logout() {
 a
-b
+c
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 title
+subtitle
";

    #[test]
    fn parses_multi_file_multi_hunk_new_side_ranges() {
        let spans = parse_diff_hunks(SAMPLE);
        assert_eq!(
            spans,
            vec![
                DiffHunkSpan {
                    path: "src/auth.rs".into(),
                    range: SymbolRange::new(10, 14), // +10,5 -> [10,14]
                },
                DiffHunkSpan {
                    path: "src/auth.rs".into(),
                    range: SymbolRange::new(42, 43), // +42,2 -> [42,43]
                },
                DiffHunkSpan {
                    path: "README.md".into(),
                    range: SymbolRange::new(1, 2), // +1,2 -> [1,2]
                },
            ],
        );
    }

    #[test]
    fn omitted_count_defaults_to_one_line() {
        // `@@ -5 +7 @@` (both counts omitted) -> new side is the single line 7.
        let diff = "--- a/x.rs\n+++ b/x.rs\n@@ -5 +7 @@\n-gone\n+here\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "x.rs".into(),
                range: SymbolRange::new(7, 7)
            }]
        );
    }

    #[test]
    fn pure_deletion_records_the_boundary_line() {
        // `+3,0` is a pure deletion: no new lines, recorded as the single line 3 so
        // the touched region still claims (rather than vanishing).
        let diff = "--- a/x.rs\n+++ b/x.rs\n@@ -3,2 +3,0 @@\n-a\n-b\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "x.rs".into(),
                range: SymbolRange::new(3, 3)
            }]
        );
    }

    #[test]
    fn deletion_at_top_with_zero_start_clamps_to_line_one() {
        // `@@ -1,1 +0,0 @@` (delete the only line) -> new-side start=0, count=0;
        // clamp to the 1-based boundary line 1 rather than an invalid line 0.
        let diff = "--- a/x.rs\n+++ b/x.rs\n@@ -1,1 +0,0 @@\n-only\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "x.rs".into(),
                range: SymbolRange::new(1, 1)
            }]
        );
    }

    #[test]
    fn adversarially_large_count_is_clamped_not_overflowed() {
        // Untrusted diff: a u32::MAX count must not overflow; end clamps to MAX_LINE.
        let diff = "--- a/x.rs\n+++ b/x.rs\n@@ -1,1 +1,4294967295 @@\n+x\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].range.start_line, 1);
        assert_eq!(spans[0].range.end_line, MAX_LINE);
    }

    #[test]
    fn added_file_uses_new_path_not_dev_null() {
        let diff = "--- /dev/null\n+++ b/src/new_mod.rs\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "src/new_mod.rs".into(),
                range: SymbolRange::new(1, 3)
            }],
        );
    }

    #[test]
    fn deleted_file_falls_back_to_old_path() {
        // New side is /dev/null (whole-file delete); attribute to the old path.
        let diff = "--- a/src/dead.rs\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "src/dead.rs".into(),
                range: SymbolRange::new(1, 1)
            }],
        );
    }

    #[test]
    fn truncation_marker_and_context_are_ignored() {
        let diff =
            "--- a/x.rs\n+++ b/x.rs\n@@ -1,1 +1,1 @@\n-a\n+b\n…(diff truncated for review)\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].path, "x.rs");
    }

    #[test]
    fn empty_or_hunkless_diff_yields_no_intents() {
        assert!(intents_from_diff("", ClaimMode::Write).is_empty());
        // A header with no hunks -> file-fallback (empty), the file gate applies.
        assert!(intents_from_diff("--- a/x.rs\n+++ b/x.rs\n", ClaimMode::Write).is_empty());
    }

    #[test]
    fn intents_are_diffhunk_confidence_with_range_labels() {
        let intents = intents_from_diff(SAMPLE, ClaimMode::Write);
        assert_eq!(intents.len(), 3);
        assert!(intents.iter().all(|i| i.confidence == Confidence::DiffHunk));
        assert!(intents.iter().all(|i| i.mode == ClaimMode::Write));
        assert_eq!(intents[0].path, "src/auth.rs");
        assert_eq!(intents[0].symbol, "hunk:10-14");
        assert_eq!(intents[0].range, SymbolRange::new(10, 14));
    }

    #[test]
    fn carriage_returns_are_tolerated() {
        // A CRLF diff (Windows `git diff`) must parse identically — str::lines strips \r.
        let diff = "--- a/x.rs\r\n+++ b/x.rs\r\n@@ -1,1 +1,2 @@\r\n title\r\n+more\r\n";
        let spans = parse_diff_hunks(diff);
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "x.rs".into(),
                range: SymbolRange::new(1, 2)
            }]
        );
    }

    #[test]
    fn malformed_hunk_header_is_skipped_not_panicked() {
        let diff = "--- a/x.rs\n+++ b/x.rs\n@@ this is not a hunk @@\n@@ -1,1 +2,1 @@\n+x\n";
        let spans = parse_diff_hunks(diff);
        // Only the well-formed second header yields a span.
        assert_eq!(
            spans,
            vec![DiffHunkSpan {
                path: "x.rs".into(),
                range: SymbolRange::new(2, 2)
            }]
        );
    }
}
