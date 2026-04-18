//! Compute a worktree's diff against a captured base revision.
//!
//! Strategy: call `git diff --no-color <base_sha>` inside the worktree and
//! parse the unified diff output. Base content per-file is fetched with
//! `git show <base_sha>:<path>`; head content is read directly from the
//! worktree filesystem so *uncommitted* agent edits are captured too.
//!
//! The parser is a small hand-rolled state machine. Pure — no I/O — so
//! it carries the bulk of the test weight.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::layer::{DiffHunk, FileDelta, HunkLine};

/// Capture the repo's current HEAD SHA so later diffs are anchored to the
/// commit that existed at layer-registration time.
pub fn capture_head_sha(repo_path: &Path) -> Result<String, String> {
    let out = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git rev-parse failed: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git rev-parse HEAD failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Compute the diff of a worktree against `base_sha`, including uncommitted
/// work in the worktree's working tree.
pub fn compute_diff(worktree_path: &Path, base_sha: &str) -> Result<Vec<FileDelta>, String> {
    let out = Command::new("git")
        .args(["diff", "--no-color", base_sha])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("git diff failed: {e}"))?;

    // Non-zero exit with empty output happens when base_sha is unreachable;
    // surface that. An actual diff with changes also returns 0, and an
    // identical state returns 0 with empty stdout.
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.trim().is_empty() {
            return Ok(Vec::new());
        }
        return Err(format!("git diff failed: {}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let parsed = parse_unified_diff(&text);

    let mut deltas = Vec::with_capacity(parsed.len());
    for file in parsed {
        if file.is_binary {
            continue;
        }
        let path = if file.is_deleted { file.old_path } else { file.new_path };
        if path.is_empty() {
            continue;
        }
        let base_content = if file.is_new {
            String::new()
        } else {
            read_git_show(worktree_path, base_sha, &path).unwrap_or_default()
        };
        let head_content = if file.is_deleted {
            String::new()
        } else {
            read_worktree_file(worktree_path, &path).unwrap_or_default()
        };
        deltas.push(FileDelta {
            path,
            hunks: file.hunks,
            base_content,
            head_content,
        });
    }

    Ok(deltas)
}

fn read_git_show(worktree_path: &Path, sha: &str, rel_path: &str) -> Result<String, String> {
    let out = Command::new("git")
        .args(["show", &format!("{sha}:{rel_path}")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("git show failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn read_worktree_file(worktree_path: &Path, rel_path: &str) -> Result<String, String> {
    let mut full = PathBuf::from(worktree_path);
    full.push(rel_path);
    std::fs::read_to_string(&full).map_err(|e| format!("read {}: {e}", full.display()))
}

// ---------------------------------------------------------------------------
// Pure parser (no I/O — trivially testable)
// ---------------------------------------------------------------------------

/// Intermediate result of parsing a unified diff header + body for one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ParsedFile {
    pub old_path: String,
    pub new_path: String,
    pub is_new: bool,
    pub is_deleted: bool,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
}

impl ParsedFile {
    fn empty() -> Self {
        Self {
            old_path: String::new(),
            new_path: String::new(),
            is_new: false,
            is_deleted: false,
            is_binary: false,
            hunks: Vec::new(),
        }
    }
}

/// Parse `git diff --no-color` output into per-file structures.
///
/// Handles standard unified diff + a few `diff --git` preamble quirks:
/// new file mode / deleted file mode / binary marker / /dev/null paths.
pub(crate) fn parse_unified_diff(text: &str) -> Vec<ParsedFile> {
    let mut files: Vec<ParsedFile> = Vec::new();
    let mut current: Option<ParsedFile> = None;
    let mut current_hunk: Option<DiffHunk> = None;

    for raw_line in text.split_inclusive('\n') {
        let line = raw_line.trim_end_matches('\n').trim_end_matches('\r');

        if line.starts_with("diff --git ") {
            flush_hunk(&mut current, &mut current_hunk);
            if let Some(f) = current.take() {
                files.push(f);
            }
            let mut file = ParsedFile::empty();
            if let Some((a, b)) = parse_diff_git_header(line) {
                file.old_path = a;
                file.new_path = b;
            }
            current = Some(file);
            continue;
        }

        let Some(file) = current.as_mut() else { continue };

        if line.starts_with("new file mode") {
            file.is_new = true;
            continue;
        }
        if line.starts_with("deleted file mode") {
            file.is_deleted = true;
            continue;
        }
        if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            file.is_binary = true;
            continue;
        }
        if let Some(rest) = line.strip_prefix("--- ") {
            if rest == "/dev/null" {
                file.is_new = true;
                file.old_path.clear();
            } else if let Some(p) = strip_path_prefix(rest) {
                // Prefer the "b/" side for new_path; only overwrite old_path
                // if we haven't already captured it from the diff --git line.
                if file.old_path.is_empty() {
                    file.old_path = p;
                }
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("+++ ") {
            if rest == "/dev/null" {
                file.is_deleted = true;
                file.new_path.clear();
            } else if let Some(p) = strip_path_prefix(rest) {
                if file.new_path.is_empty() {
                    file.new_path = p;
                }
            }
            continue;
        }

        if line.starts_with("@@") {
            flush_hunk(&mut current, &mut current_hunk);
            if let Some((bs, bl, hs, hl)) = parse_hunk_header(line) {
                current_hunk = Some(DiffHunk {
                    base_start: bs,
                    base_len: bl,
                    head_start: hs,
                    head_len: hl,
                    lines: Vec::new(),
                });
            }
            continue;
        }

        if let Some(hunk) = current_hunk.as_mut() {
            if let Some(rest) = line.strip_prefix('+') {
                hunk.lines.push(HunkLine::Add(rest.to_string()));
            } else if let Some(rest) = line.strip_prefix('-') {
                hunk.lines.push(HunkLine::Remove(rest.to_string()));
            } else if let Some(rest) = line.strip_prefix(' ') {
                hunk.lines.push(HunkLine::Context(rest.to_string()));
            } else if line.starts_with('\\') {
                // "\ No newline at end of file" — drop silently.
            }
        }
    }

    flush_hunk(&mut current, &mut current_hunk);
    if let Some(f) = current.take() {
        files.push(f);
    }
    files
}

fn flush_hunk(file: &mut Option<ParsedFile>, hunk: &mut Option<DiffHunk>) {
    if let (Some(f), Some(h)) = (file.as_mut(), hunk.take()) {
        f.hunks.push(h);
    }
}

/// Parse `diff --git a/foo b/bar` → ("foo", "bar").
fn parse_diff_git_header(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("diff --git ")?;
    // Paths are whitespace-separated and *usually* quoted only when they
    // contain spaces. For MVP, only handle the unquoted common case.
    let mut parts = rest.splitn(2, ' ');
    let a = parts.next()?;
    let b = parts.next()?;
    Some((
        strip_path_prefix(a).unwrap_or_else(|| a.to_string()),
        strip_path_prefix(b).unwrap_or_else(|| b.to_string()),
    ))
}

fn strip_path_prefix(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix("a/") {
        return Some(rest.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("b/") {
        return Some(rest.to_string());
    }
    if trimmed == "/dev/null" {
        return None;
    }
    Some(trimmed.to_string())
}

/// Parse `@@ -bs,bl +hs,hl @@` (lengths default to 1 when omitted).
pub(crate) fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    let inner = line.strip_prefix("@@")?.trim_start();
    // Take the numeric section before the trailing " @@".
    let end = inner.find("@@")?;
    let nums = inner[..end].trim();
    let mut parts = nums.split_whitespace();
    let base = parts.next()?.strip_prefix('-')?;
    let head = parts.next()?.strip_prefix('+')?;
    let (bs, bl) = parse_range(base)?;
    let (hs, hl) = parse_range(head)?;
    Some((bs, bl, hs, hl))
}

fn parse_range(s: &str) -> Option<(u32, u32)> {
    let mut it = s.splitn(2, ',');
    let start: u32 = it.next()?.parse().ok()?;
    let len: u32 = match it.next() {
        Some(n) => n.parse().ok()?,
        None => 1,
    };
    Some((start, len))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODIFY_SAMPLE: &str = "\
diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 line1
-line2
+line2-new
+line-added
 line3
";

    const NEW_FILE_SAMPLE: &str = "\
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+hello
+world
";

    const DELETE_SAMPLE: &str = "\
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-goodbye
-forever
";

    const BINARY_SAMPLE: &str = "\
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
";

    const MULTI_HUNK_SAMPLE: &str = "\
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 x
-y
+y2
@@ -10,1 +10,2 @@
 z
+zz
";

    #[test]
    fn parse_hunk_header_basic() {
        assert_eq!(parse_hunk_header("@@ -10,3 +10,4 @@"), Some((10, 3, 10, 4)));
    }

    #[test]
    fn parse_hunk_header_with_context_suffix() {
        assert_eq!(
            parse_hunk_header("@@ -1,3 +1,4 @@ fn foo() {"),
            Some((1, 3, 1, 4))
        );
    }

    #[test]
    fn parse_hunk_header_default_length() {
        // "@@ -5 +5 @@" means length = 1 on both sides.
        assert_eq!(parse_hunk_header("@@ -5 +5 @@"), Some((5, 1, 5, 1)));
    }

    #[test]
    fn parse_hunk_header_rejects_garbage() {
        assert_eq!(parse_hunk_header("garbage"), None);
        assert_eq!(parse_hunk_header("@@ broken @@"), None);
    }

    #[test]
    fn parse_modify() {
        let files = parse_unified_diff(MODIFY_SAMPLE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.new_path, "src/foo.ts");
        assert!(!f.is_new && !f.is_deleted && !f.is_binary);
        assert_eq!(f.hunks.len(), 1);
        let h = &f.hunks[0];
        assert_eq!((h.base_start, h.base_len, h.head_start, h.head_len), (1, 3, 1, 4));
        assert_eq!(h.lines.len(), 5);
        assert!(matches!(h.lines[0], HunkLine::Context(ref s) if s == "line1"));
        assert!(matches!(h.lines[1], HunkLine::Remove(ref s) if s == "line2"));
        assert!(matches!(h.lines[2], HunkLine::Add(ref s) if s == "line2-new"));
        assert!(matches!(h.lines[3], HunkLine::Add(ref s) if s == "line-added"));
        assert!(matches!(h.lines[4], HunkLine::Context(ref s) if s == "line3"));
    }

    #[test]
    fn parse_new_file() {
        let files = parse_unified_diff(NEW_FILE_SAMPLE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert!(f.is_new);
        assert_eq!(f.new_path, "src/new.ts");
        assert_eq!(f.hunks.len(), 1);
    }

    #[test]
    fn parse_delete() {
        let files = parse_unified_diff(DELETE_SAMPLE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert!(f.is_deleted);
        assert_eq!(f.old_path, "src/gone.ts");
    }

    #[test]
    fn parse_binary_marks_flag() {
        let files = parse_unified_diff(BINARY_SAMPLE);
        assert_eq!(files.len(), 1);
        assert!(files[0].is_binary);
        assert!(files[0].hunks.is_empty());
    }

    #[test]
    fn parse_multiple_hunks() {
        let files = parse_unified_diff(MULTI_HUNK_SAMPLE);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].hunks.len(), 2);
        assert_eq!(files[0].hunks[1].base_start, 10);
    }

    #[test]
    fn parse_multiple_files() {
        let combined = format!("{MODIFY_SAMPLE}{NEW_FILE_SAMPLE}");
        let files = parse_unified_diff(&combined);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].new_path, "src/foo.ts");
        assert_eq!(files[1].new_path, "src/new.ts");
        assert!(files[1].is_new);
    }

    #[test]
    fn parse_empty_returns_empty() {
        let files = parse_unified_diff("");
        assert!(files.is_empty());
    }

    #[test]
    fn parse_drops_noeol_marker_silently() {
        let input = "\
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-a
\\ No newline at end of file
+b
";
        let files = parse_unified_diff(input);
        assert_eq!(files.len(), 1);
        let h = &files[0].hunks[0];
        // Remove + Add only — the noeol marker should NOT appear as a line.
        assert_eq!(h.lines.len(), 2);
    }

    #[test]
    fn strip_path_prefix_variants() {
        assert_eq!(strip_path_prefix("a/foo"), Some("foo".into()));
        assert_eq!(strip_path_prefix("b/bar"), Some("bar".into()));
        assert_eq!(strip_path_prefix("/dev/null"), None);
        assert_eq!(strip_path_prefix("plain"), Some("plain".into()));
    }

    #[test]
    fn parse_diff_git_header_extracts_both_sides() {
        let (a, b) = parse_diff_git_header("diff --git a/foo b/bar").unwrap();
        assert_eq!(a, "foo");
        assert_eq!(b, "bar");
    }
}
