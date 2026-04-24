//! Phase 3C-1c — apply a single hunk (or a whole file's worth of hunks)
//! from a ghost layer back onto the user's main worktree.
//!
//! Kept I/O-free here on purpose: the functions operate on string contents
//! so every branch can be tested without touching the filesystem. The
//! orchestrating IPC wrapper lives in `ipc/ghostdiff_commands.rs`.

use super::layer::{DiffHunk, HunkLine};

/// Reconstruct the "base" side of a hunk — every line the hunk expects to
/// find in the main file, joined with `\n` terminators in diff order.
pub fn build_base_view(hunk: &DiffHunk) -> String {
    let mut out = String::new();
    for line in &hunk.lines {
        match line {
            HunkLine::Context(t) | HunkLine::Remove(t) => {
                out.push_str(t);
                out.push('\n');
            }
            HunkLine::Add(_) => {}
        }
    }
    out
}

/// Reconstruct the "after" side of a hunk — what the main file should look
/// like inside the hunk's range once it is applied.
pub fn build_after_view(hunk: &DiffHunk) -> String {
    let mut out = String::new();
    for line in &hunk.lines {
        match line {
            HunkLine::Context(t) | HunkLine::Add(t) => {
                out.push_str(t);
                out.push('\n');
            }
            HunkLine::Remove(_) => {}
        }
    }
    out
}

/// Apply a single hunk onto `main`.
///
/// Strategy:
/// * Non-empty base view → locate it as a unique substring inside `main` and
///   splice. Position-independent, so Tab still works after prior applies
///   shifted line numbers.
/// * Empty base view (pure-add hunk with no context) → insert right after
///   line `hunk.base_start` (1-based; `0` means top of file).
///
/// Errors if the base context is missing, appears more than once, or the
/// insertion anchor is out of range — all failures leave `main` untouched.
pub fn apply_hunk_to_main(main: &str, hunk: &DiffHunk) -> Result<String, String> {
    let base_view = build_base_view(hunk);
    let after_view = build_after_view(hunk);

    if base_view.is_empty() {
        return insert_at_line(main, hunk.base_start, &after_view);
    }

    let positions: Vec<usize> = main
        .match_indices(&base_view)
        .map(|(i, _)| i)
        .collect();
    match positions.len() {
        0 => {
            log::warn!(
                "ghost diff apply: hunk base context not found (base_start={}, base_lines={})",
                hunk.base_start,
                hunk.lines.len(),
            );
            Err(
                "hunk base context not found in main file — main may have diverged from the layer"
                    .into(),
            )
        }
        1 => {
            let pos = positions[0];
            let mut out = String::with_capacity(main.len() + after_view.len());
            out.push_str(&main[..pos]);
            out.push_str(&after_view);
            out.push_str(&main[pos + base_view.len()..]);
            log::debug!("ghost diff apply ok pos={} hunk_lines={}", pos, hunk.lines.len());
            Ok(out)
        }
        _ => {
            log::warn!(
                "ghost diff apply: ambiguous base context ({} matches) at base_start={}",
                positions.len(),
                hunk.base_start,
            );
            Err("hunk base context is ambiguous in main file — refuse to patch".into())
        }
    }
}

fn insert_at_line(main: &str, line_num: u32, insertion: &str) -> Result<String, String> {
    let lines: Vec<&str> = main.split_inclusive('\n').collect();
    let idx = line_num as usize;
    if idx > lines.len() {
        return Err(format!(
            "insertion line {line_num} out of bounds (file has {} lines)",
            lines.len()
        ));
    }
    let mut out = String::with_capacity(main.len() + insertion.len());
    for l in &lines[..idx] {
        out.push_str(l);
    }
    out.push_str(insertion);
    for l in &lines[idx..] {
        out.push_str(l);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hunk(
        base_start: u32,
        base_len: u32,
        head_start: u32,
        head_len: u32,
        lines: Vec<HunkLine>,
    ) -> DiffHunk {
        DiffHunk {
            base_start,
            base_len,
            head_start,
            head_len,
            lines,
        }
    }

    #[test]
    fn build_base_view_includes_context_and_remove() {
        let h = hunk(
            1,
            3,
            1,
            4,
            vec![
                HunkLine::Context("a".into()),
                HunkLine::Remove("b".into()),
                HunkLine::Add("new1".into()),
                HunkLine::Add("new2".into()),
                HunkLine::Context("c".into()),
            ],
        );
        assert_eq!(build_base_view(&h), "a\nb\nc\n");
    }

    #[test]
    fn build_after_view_includes_context_and_add() {
        let h = hunk(
            1,
            3,
            1,
            4,
            vec![
                HunkLine::Context("a".into()),
                HunkLine::Remove("b".into()),
                HunkLine::Add("new1".into()),
                HunkLine::Add("new2".into()),
                HunkLine::Context("c".into()),
            ],
        );
        assert_eq!(build_after_view(&h), "a\nnew1\nnew2\nc\n");
    }

    #[test]
    fn apply_hunk_splices_unique_match() {
        let main = "a\nb\nc\n";
        let h = hunk(
            1,
            3,
            1,
            3,
            vec![
                HunkLine::Context("a".into()),
                HunkLine::Remove("b".into()),
                HunkLine::Add("B".into()),
                HunkLine::Context("c".into()),
            ],
        );
        let out = apply_hunk_to_main(main, &h).unwrap();
        assert_eq!(out, "a\nB\nc\n");
    }

    #[test]
    fn apply_hunk_rejects_ambiguous_match() {
        let main = "x\ny\nx\ny\n"; // "x\ny\n" appears twice
        let h = hunk(
            1,
            2,
            1,
            1,
            vec![
                HunkLine::Remove("x".into()),
                HunkLine::Remove("y".into()),
                HunkLine::Add("z".into()),
            ],
        );
        let err = apply_hunk_to_main(main, &h).unwrap_err();
        assert!(err.contains("ambiguous"));
    }

    #[test]
    fn apply_hunk_rejects_missing_context() {
        let main = "a\nb\nc\n";
        let h = hunk(
            1,
            2,
            1,
            1,
            vec![
                HunkLine::Remove("x".into()),
                HunkLine::Remove("y".into()),
                HunkLine::Add("z".into()),
            ],
        );
        let err = apply_hunk_to_main(main, &h).unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn apply_pure_add_at_top_inserts_at_line_zero() {
        let main = "existing\n";
        let h = hunk(
            0,
            0,
            1,
            2,
            vec![HunkLine::Add("new1".into()), HunkLine::Add("new2".into())],
        );
        let out = apply_hunk_to_main(main, &h).unwrap();
        assert_eq!(out, "new1\nnew2\nexisting\n");
    }

    #[test]
    fn apply_pure_add_mid_file_inserts_after_base_start() {
        let main = "a\nb\nc\n";
        // Pure-add after line 2.
        let h = hunk(2, 0, 3, 1, vec![HunkLine::Add("inserted".into())]);
        let out = apply_hunk_to_main(main, &h).unwrap();
        assert_eq!(out, "a\nb\ninserted\nc\n");
    }

    #[test]
    fn apply_pure_add_rejects_out_of_bounds() {
        let main = "a\n";
        let h = hunk(99, 0, 1, 1, vec![HunkLine::Add("x".into())]);
        let err = apply_hunk_to_main(main, &h).unwrap_err();
        assert!(err.contains("out of bounds"));
    }

    #[test]
    fn apply_hunk_preserves_surrounding_content() {
        let main = "top\na\nb\nc\nbottom\n";
        let h = hunk(
            2,
            3,
            2,
            3,
            vec![
                HunkLine::Context("a".into()),
                HunkLine::Remove("b".into()),
                HunkLine::Add("B".into()),
                HunkLine::Context("c".into()),
            ],
        );
        let out = apply_hunk_to_main(main, &h).unwrap();
        assert_eq!(out, "top\na\nB\nc\nbottom\n");
    }

    #[test]
    fn apply_hunk_handles_pure_delete() {
        let main = "a\nb\nc\n";
        let h = hunk(
            1,
            3,
            1,
            2,
            vec![
                HunkLine::Context("a".into()),
                HunkLine::Remove("b".into()),
                HunkLine::Context("c".into()),
            ],
        );
        let out = apply_hunk_to_main(main, &h).unwrap();
        assert_eq!(out, "a\nc\n");
    }
}
