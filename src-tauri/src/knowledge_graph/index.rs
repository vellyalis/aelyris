//! Code-graph population from source — a lightweight, dependency-free MODULE
//! dependency scan (NOT LSP). It reuses [`crate::git::list_all_files`]
//! (gitignore-aware) to enumerate tracked files, emits one `Module` node per
//! source file, and derives file -> file dependency edges from per-language
//! import statements:
//!   - Rust:  `mod <name>;`  and  `use crate::<path>...`
//!   - TS/JS: relative `import ... from './x'`, `require('./x')`, `import('./x')`
//!
//! Non-relative / external specs (e.g. `import React from 'react'`) are skipped —
//! they are genuinely out of the in-project graph, NOT a fallback. This is a
//! module-level structure graph; richer symbol-level LSP aggregation is a
//! documented future refinement. The function is pure (filesystem + git only),
//! so it is unit-testable against a fixture directory with no DB/Tauri.

use std::collections::HashSet;
use std::path::Path;

use super::{CodeNode, NodeKind};

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const WEB_EXTS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Lang {
    Rust,
    Web,
}

/// Index a project `root` into `(nodes, edges)` where each edge is
/// `(dependent, dependency)` — the importer depends on the imported file.
pub fn index_project(root: &str) -> (Vec<CodeNode>, Vec<(String, String)>) {
    let files = crate::git::list_all_files(root, MAX_FILES).unwrap_or_default();
    if files.len() >= MAX_FILES {
        // The scan is capped so a huge repo can't blow memory; say so rather than
        // silently returning a partial graph that callers would read as complete.
        log::warn!(
            "knowledge graph: file scan hit the {MAX_FILES}-file cap; the code graph may be incomplete for this repository"
        );
    }
    let sources: Vec<String> = files
        .into_iter()
        .filter(|f| f.size <= MAX_FILE_BYTES && lang_of(&f.relative_path).is_some())
        .map(|f| f.relative_path)
        .collect();
    let known: HashSet<&str> = sources.iter().map(String::as_str).collect();

    let nodes: Vec<CodeNode> = sources
        .iter()
        .map(|p| CodeNode {
            id: p.clone(),
            kind: NodeKind::Module,
            file: Some(p.clone()),
        })
        .collect();

    let mut edges: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for path in &sources {
        let Some(lang) = lang_of(path) else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(Path::new(root).join(path)) else {
            continue;
        };
        for target in resolved_imports(lang, path, &text, &known) {
            if target != *path && seen.insert((path.clone(), target.clone())) {
                edges.push((path.clone(), target));
            }
        }
    }
    (nodes, edges)
}

fn lang_of(path: &str) -> Option<Lang> {
    match path.rsplit('.').next().unwrap_or("") {
        "rs" => Some(Lang::Rust),
        ext if WEB_EXTS.contains(&ext) => Some(Lang::Web),
        _ => None,
    }
}

/// Resolve every import statement in `text` to a known source-file id.
fn resolved_imports(lang: Lang, importer: &str, text: &str, known: &HashSet<&str>) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        match lang {
            Lang::Rust => {
                if let Some(name) = rust_mod(line) {
                    if let Some(t) = resolve_rust_mod(importer, name, known) {
                        out.push(t);
                    }
                } else if let Some(segs) = rust_use_crate(line) {
                    if let Some(t) = resolve_rust_crate(importer, &segs, known) {
                        out.push(t);
                    }
                }
            }
            Lang::Web => {
                for spec in web_specs(line) {
                    if let Some(t) = resolve_web(importer, &spec, known) {
                        out.push(t);
                    }
                }
            }
        }
    }
    out
}

// ---- Rust import extraction ----

/// Strip a leading visibility modifier (`pub`, `pub(crate)`, `pub(super)`,
/// `pub(in path)`) so `pub(crate) mod x;` / `pub(crate) use crate::y` parse like
/// their bare forms. `pub` must be a whole token (followed by space or `(`), so an
/// identifier like `public_fn` is left untouched.
fn strip_vis(line: &str) -> &str {
    let Some(rest) = line.strip_prefix("pub") else {
        return line;
    };
    match rest.chars().next() {
        Some(' ') => rest.trim_start(),
        Some('(') => match rest.find(')') {
            Some(i) => rest[i + 1..].trim_start(),
            None => line,
        },
        _ => line,
    }
}

/// `mod foo;` / `pub mod foo;` — a module DECLARATION (not an inline `mod foo {`).
fn rust_mod(line: &str) -> Option<&str> {
    let rest = strip_vis(line);
    let name = rest.strip_prefix("mod ")?.strip_suffix(';')?.trim();
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Some(name)
    } else {
        None
    }
}

/// `use crate::a::b::C;` -> the path segments after `crate::`, stopping at the
/// first `;`, `{`, whitespace (an `as`/comment), or `*`.
fn rust_use_crate(line: &str) -> Option<Vec<String>> {
    let rest = strip_vis(line)
        .strip_prefix("use ")?
        .strip_prefix("crate::")?;
    let end = rest.find([';', '{', ' ', '*']).unwrap_or(rest.len());
    let segs: Vec<String> = rest[..end]
        .split("::")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    if segs.is_empty() {
        None
    } else {
        Some(segs)
    }
}

/// The crate's `src` root for an importer path: everything up to and including
/// the last `src` directory segment (e.g. `src-tauri/src/task/x.rs` -> `src-tauri/src`).
fn crate_src_root(importer: &str) -> Option<String> {
    let comps: Vec<&str> = importer.split('/').collect();
    let idx = comps[..comps.len().saturating_sub(1)]
        .iter()
        .rposition(|c| *c == "src")?;
    Some(comps[..=idx].join("/"))
}

fn resolve_rust_mod(importer: &str, name: &str, known: &HashSet<&str>) -> Option<String> {
    let dir = parent_dir(importer);
    first_known(
        &[
            join(&dir, &format!("{name}.rs")),
            join(&dir, &format!("{name}/mod.rs")),
        ],
        known,
    )
}

fn resolve_rust_crate(importer: &str, segs: &[String], known: &HashSet<&str>) -> Option<String> {
    let root = crate_src_root(importer)?;
    // Try progressively shorter module paths (the trailing segments are usually
    // items, not modules): crate::a::b::Item -> a/b, then a.
    for n in (1..=segs.len()).rev() {
        let modpath = segs[..n].join("/");
        if let Some(t) = first_known(
            &[
                join(&root, &format!("{modpath}.rs")),
                join(&root, &format!("{modpath}/mod.rs")),
            ],
            known,
        ) {
            return Some(t);
        }
    }
    None
}

// ---- Web (TS/JS) import extraction ----

/// True if `line` begins with `kw` as a whole token — the next char (if any) is
/// not an identifier char. `import`/`export` then match the keyword but reject an
/// identifier that merely *starts with* those letters (`imported`, `exporter`).
fn starts_with_kw(line: &str, kw: &str) -> bool {
    line.strip_prefix(kw).is_some_and(|rest| {
        !rest
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    })
}

/// Relative import specs in one line: `... from '<x>'`, `require('<x>')`,
/// `import('<x>')`. Only specs starting with `.` (relative) are returned.
fn web_specs(line: &str) -> Vec<String> {
    let line = line.trim();
    let mut specs = Vec::new();
    // Skip comment lines: a `//` line comment, or a `/* … */` / `*` JSDoc block line,
    // can mention `require('./x')` / `import('./x')` in prose. Treating that as a real
    // import injects a PHANTOM dependency edge that then propagates through transitive
    // blast-radius (`impact_of`), so callers would see files that are not actually
    // affected. (A marker embedded in a STRING LITERAL inside real code stays
    // best-effort — this is a structural scan, not a JS parser.)
    if line.starts_with("//") || line.starts_with("/*") || line.starts_with('*') {
        return specs;
    }
    // A static `from` import clause lives only at statement scope: a line whose
    // leading TOKEN is `import`/`export`, or the closing line of a multi-line named
    // import (`} from '...'`). `starts_with_kw` is a whole-token test (the line is
    // trimmed), so a `" from "` hiding inside a string/comment is rejected and an
    // identifier such as `imported`/`exporter` does NOT pass. Best-effort: a line
    // that genuinely begins with the `import`/`export` keyword yet carries a string
    // `from '...'` is an accepted rare false positive (this is not a JS parser).
    if starts_with_kw(line, "import") || starts_with_kw(line, "export") || line.starts_with('}') {
        if let Some(i) = line.find(" from ") {
            if let Some(s) = quoted_after(&line[i + " from ".len()..]) {
                specs.push(s);
            }
        }
    }
    for marker in ["require(", "import("] {
        let mut hay = line;
        while let Some(i) = hay.find(marker) {
            let after = &hay[i + marker.len()..];
            if let Some(s) = quoted_after(after) {
                specs.push(s);
            }
            hay = after;
        }
    }
    specs.into_iter().filter(|s| s.starts_with('.')).collect()
}

/// The first single/double/back-quoted string at the start of `s` (after trim).
fn quoted_after(s: &str) -> Option<String> {
    let s = s.trim_start();
    let q = s.chars().next()?;
    if q != '\'' && q != '"' && q != '`' {
        return None;
    }
    let rest = &s[q.len_utf8()..];
    let end = rest.find(q)?;
    Some(rest[..end].to_string())
}

fn resolve_web(importer: &str, spec: &str, known: &HashSet<&str>) -> Option<String> {
    let base = normalize(&join(&parent_dir(importer), spec));
    let mut candidates = vec![base.clone()];
    for ext in WEB_EXTS {
        candidates.push(format!("{base}.{ext}"));
    }
    for ext in WEB_EXTS {
        candidates.push(format!("{base}/index.{ext}"));
    }
    first_known(&candidates, known)
}

// ---- path utilities (forward-slash string paths) ----

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

fn join(dir: &str, rel: &str) -> String {
    if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{dir}/{rel}")
    }
}

/// Collapse `.` and `..` segments in a forward-slash path.
fn normalize(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out.join("/")
}

fn first_known(candidates: &[String], known: &HashSet<&str>) -> Option<String> {
    candidates
        .iter()
        .find(|c| known.contains(c.as_str()))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn index_project_derives_module_edges_from_imports() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "src/a.rs",
            "mod b;\nuse crate::c::Thing;\nuse std::fmt;\nfn x() {}\n",
        );
        write(root, "src/b.rs", "pub struct B;\n");
        write(root, "src/c.rs", "pub struct Thing;\n");
        write(
            root,
            "web/x.ts",
            "import { y } from './y';\nimport React from 'react';\n",
        );
        write(root, "web/y.ts", "export const y = 1;\n");
        let root_str = root.to_string_lossy().replace('\\', "/");

        let (nodes, edges) = index_project(&root_str);

        // One Module node per source file (5 total).
        let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids.len(), 5, "nodes: {ids:?}");
        assert!(ids.contains("src/a.rs") && ids.contains("web/x.ts"));
        assert!(nodes.iter().all(|n| n.kind == NodeKind::Module));
        assert!(nodes.iter().all(|n| n.file.is_some()));

        let edgeset: HashSet<(String, String)> = edges.into_iter().collect();
        // mod b; -> sibling file; use crate::c -> crate-root file; ./y -> relative file.
        assert!(
            edgeset.contains(&("src/a.rs".into(), "src/b.rs".into())),
            "mod-b edge missing: {edgeset:?}"
        );
        assert!(
            edgeset.contains(&("src/a.rs".into(), "src/c.rs".into())),
            "use-crate-c edge missing: {edgeset:?}"
        );
        assert!(
            edgeset.contains(&("web/x.ts".into(), "web/y.ts".into())),
            "relative-import edge missing: {edgeset:?}"
        );
        // No edge for the external `react` import or `std::fmt` (out of graph).
        assert!(!edgeset.iter().any(|(_, dep)| dep.contains("react")));
        assert_eq!(edgeset.len(), 3, "only in-project edges: {edgeset:?}");
        // Direction: every dependent is a known in-project node (importer side).
        assert!(edgeset.iter().all(|(dep, _)| ids.contains(dep.as_str())));
    }

    #[test]
    fn normalize_collapses_dot_segments() {
        assert_eq!(normalize("web/./y"), "web/y");
        assert_eq!(normalize("web/sub/../y"), "web/y");
        assert_eq!(normalize("a/b/../../c"), "c");
    }

    #[test]
    fn web_specs_sees_multiline_import_close_line() {
        // The `from` clause of a multi-line named import lands on a line that
        // starts with `}` and carries neither `import` nor `export`. It must still
        // be recognized — this is the common Prettier-formatted import shape.
        assert_eq!(web_specs("} from './y';"), vec!["./y".to_string()]);
    }

    #[test]
    fn web_specs_ignores_from_inside_a_string_or_comment() {
        // A ` from '<relative>'` substring inside a string literal or comment is NOT
        // an import. Each assertion below pins a DIFFERENT gate weakness so the test
        // actually binds the fix rather than passing vacuously:
        //   - no-gate scanner would leak all four;
        //   - a `contains("import")` gate additionally leaks #1 and #2;
        //   - a `starts_with("import")` prefix gate additionally leaks #3 and #4.
        // Only a whole-token gate rejects every one.
        assert!(
            web_specs(r#"const doc = "imported from './secret'";"#).is_empty(),
            "#1 string-literal `from` on a non-import line"
        );
        assert!(
            web_specs("// reimport helpers from './legacy'").is_empty(),
            "#2 comment whose word contains \"import\""
        );
        assert!(
            web_specs("imported from './secret' = parseHeader(line);").is_empty(),
            "#3 identifier that merely starts with `import` must not pass the gate"
        );
        assert!(
            web_specs(r#"exporter.note = " from './b'";"#).is_empty(),
            "#4 identifier that merely starts with `export` must not pass the gate"
        );
    }

    #[test]
    fn web_specs_ignores_require_and_import_markers_inside_comments() {
        // The require(/import( marker loop runs unconditionally on a line, so a
        // WHOLE-TOKEN marker sitting inside a comment (prose mentioning an old path,
        // JSDoc, a commented-out line) would inject a PHANTOM dependency edge that
        // then pollutes transitive blast-radius. The comment-line gate suppresses it.
        // These cases are NOT caught by the `from`-clause whole-token gate, so they
        // bind the comment-gate specifically (deleting it would fail this test).
        assert!(
            web_specs("// import('./x')").is_empty(),
            "line comment with a whole-token dynamic import marker"
        );
        assert!(
            web_specs("// const m = require('./legacy');").is_empty(),
            "commented-out require() line"
        );
        assert!(
            web_specs("/* require('./y') */").is_empty(),
            "block-comment-open line with a require marker"
        );
        assert!(
            web_specs("   * see import('./z') for details").is_empty(),
            "indented JSDoc continuation line (pins trim-before-gate ordering)"
        );
        // A real import with a trailing line comment is still read (the line's
        // leading token is `import`, not a comment marker).
        assert_eq!(
            web_specs("import { y } from './y'; // keep"),
            vec!["./y".to_string()],
            "a real import with a trailing comment must still be detected"
        );
    }

    #[test]
    fn web_specs_reads_every_relative_import_form() {
        assert_eq!(
            web_specs("import { y } from './y';"),
            vec!["./y".to_string()]
        );
        assert_eq!(
            web_specs("export * from './re-export';"),
            vec!["./re-export".to_string()]
        );
        assert_eq!(web_specs("import D from './d';"), vec!["./d".to_string()]);
        assert_eq!(
            web_specs("const x = require('./mod');"),
            vec!["./mod".to_string()]
        );
        assert_eq!(
            web_specs("await import('./lazy');"),
            vec!["./lazy".to_string()]
        );
        // External (non-relative) specs are dropped — genuinely out of graph.
        assert!(web_specs("import React from 'react';").is_empty());
    }

    #[test]
    fn strip_vis_removes_only_a_leading_visibility_modifier() {
        assert_eq!(strip_vis("pub mod x;"), "mod x;");
        assert_eq!(strip_vis("pub(crate) mod x;"), "mod x;");
        assert_eq!(strip_vis("pub(super) use crate::y;"), "use crate::y;");
        assert_eq!(strip_vis("pub(in crate::a) mod z;"), "mod z;");
        // `pub` as part of a larger identifier is left untouched.
        assert_eq!(strip_vis("public_fn();"), "public_fn();");
        // No leading `pub` at all — returned verbatim.
        assert_eq!(strip_vis("use crate::y;"), "use crate::y;");
        // A bare `pub` token (nothing follows) is left as-is; it matches no decl.
        assert_eq!(strip_vis("pub"), "pub");
    }

    #[test]
    fn index_project_handles_restricted_visibility_rust_imports() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write(
            root,
            "src/a.rs",
            "pub(crate) mod b;\npub(super) use crate::c::Thing;\n",
        );
        write(root, "src/b.rs", "pub struct B;\n");
        write(root, "src/c.rs", "pub struct Thing;\n");
        let root_str = root.to_string_lossy().replace('\\', "/");

        let edgeset: HashSet<(String, String)> = index_project(&root_str).1.into_iter().collect();

        assert!(
            edgeset.contains(&("src/a.rs".into(), "src/b.rs".into())),
            "pub(crate) mod edge missing: {edgeset:?}"
        );
        assert!(
            edgeset.contains(&("src/a.rs".into(), "src/c.rs".into())),
            "pub(super) use-crate edge missing: {edgeset:?}"
        );
    }
}
