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

/// `mod foo;` / `pub mod foo;` — a module DECLARATION (not an inline `mod foo {`).
fn rust_mod(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("pub ").unwrap_or(line);
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
    let rest = line.strip_prefix("pub ").unwrap_or(line);
    let rest = rest.strip_prefix("use ")?.strip_prefix("crate::")?;
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

/// Relative import specs in one line: `... from '<x>'`, `require('<x>')`,
/// `import('<x>')`. Only specs starting with `.` (relative) are returned.
fn web_specs(line: &str) -> Vec<String> {
    let mut specs = Vec::new();
    if let Some(i) = line.find(" from ") {
        if let Some(s) = quoted_after(&line[i + " from ".len()..]) {
            specs.push(s);
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
}
