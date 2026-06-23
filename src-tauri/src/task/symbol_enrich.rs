//! Plan symbol enrichment — the ONLY code path that mints `Confidence::Parser` into a
//! task's declared symbols (A6.3). The planner declares symbol TARGETS (names only); this
//! verifies each against the REAL source with the tree-sitter parser and, on a UNIQUE
//! match, populates `Task.symbols` with the exact verified range. A target that can't be
//! verified (file missing / outside the repo / a glob or unsafe path / an unknown or
//! AMBIGUOUS name) is DROPPED — the task stays file-level for that file — and reported as a
//! diagnostic so the planner can fix the name or add a dependency. It NEVER trusts an
//! LLM-supplied range or confidence (the hard boundary against mislabeling a guess as exact).

use std::collections::HashSet;
use std::path::Path;

use super::decompose::{PlannedSymbolTarget, PlannedTask};
use super::graph::Task;
use crate::symbol_ownership::extract::intents_from_source;
use crate::symbol_ownership::SymbolIntent;

/// Max source file size we will read + parse to verify a symbol (bounds the planner's I/O).
const MAX_SOURCE_BYTES: u64 = 1_048_576;

/// Verify each task's declared symbol targets against real source. Returns the tasks with
/// `Task.symbols` populated (verified Parser ranges ONLY) and a diagnostic for every target
/// that could not be verified.
pub fn enrich_plan_with_symbols(
    repo_root: &Path,
    planned: Vec<PlannedTask>,
) -> (Vec<Task>, Vec<String>) {
    let mut unresolved = Vec::new();
    let tasks = planned
        .into_iter()
        .map(|pt| {
            let targets = pt.symbol_targets.clone();
            let mut task = pt.into_task();
            let mut verified: Vec<SymbolIntent> = Vec::new();
            // Files where ANY declared target failed verification — every verified symbol
            // on such a file is dropped too, so a task is NEVER PARTIALLY unlocked on a
            // file (some functions proven, others not = it could still edit the unproven
            // region while a peer co-edits it). The whole file falls back to file-level.
            let mut poisoned: HashSet<String> = HashSet::new();
            for target in &targets {
                match verify_target(repo_root, target) {
                    Ok(intent) => verified.push(intent),
                    Err(reason) => {
                        poisoned.insert(
                            safe_repo_relative(&target.path).unwrap_or_else(|_| target.path.clone()),
                        );
                        unresolved.push(format!(
                            "task {} symbol target {}:{} could not be verified ({reason}) — fix the name, ensure the file exists, or remove it (the task then stays file-level for that whole file)",
                            task.id, target.path, target.symbol
                        ));
                    }
                }
            }
            verified.retain(|i| !poisoned.contains(&i.path));
            task.symbols = verified;
            task
        })
        .collect();
    (tasks, unresolved)
}

/// Verify ONE target: a safe repo-relative existing file, parsed by the real tree-sitter
/// parser, with EXACTLY ONE symbol of the declared name (anything else is unverifiable).
fn verify_target(repo_root: &Path, target: &PlannedSymbolTarget) -> Result<SymbolIntent, String> {
    let rel = safe_repo_relative(&target.path)?;
    let abs = repo_root.join(&rel);
    // `symlink_metadata` does NOT follow links: reject a symlinked file outright — a
    // verified read must be a real file under the repo, never a link that could resolve
    // outside it.
    let meta = std::fs::symlink_metadata(&abs).map_err(|_| "file does not exist".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("symlinks are not allowed".to_string());
    }
    if !meta.is_file() {
        return Err("path is not a file".to_string());
    }
    if meta.len() > MAX_SOURCE_BYTES {
        return Err("file exceeds the 1 MiB parse cap".to_string());
    }
    // Defense in depth (parent-dir junction/symlink): prove the RESOLVED path stays under
    // the canonical repo root before reading it.
    let canonical_root =
        std::fs::canonicalize(repo_root).map_err(|_| "repo root unavailable".to_string())?;
    let resolved = std::fs::canonicalize(&abs).map_err(|_| "file does not exist".to_string())?;
    if !resolved.starts_with(&canonical_root) {
        return Err("path resolves outside the repo root".to_string());
    }
    let source = std::fs::read_to_string(&resolved)
        .map_err(|_| "file is not valid UTF-8 text".to_string())?;
    // Real tree-sitter parse -> Parser confidence + exact ranges; empty on an
    // unsupported language or an unclean parse (the extractor never guesses).
    let mut matches: Vec<SymbolIntent> = intents_from_source(&rel, &source, target.mode)
        .into_iter()
        .filter(|i| i.symbol == target.symbol)
        .collect();
    match matches.len() {
        0 => Err(
            "no such symbol in the parsed source (unsupported language, unparseable file, or wrong name)"
                .to_string(),
        ),
        1 => Ok(matches.pop().unwrap()),
        n => Err(format!(
            "ambiguous — {n} symbols share that name, so an exact range cannot be proven"
        )),
    }
}

/// Normalize a planner path to a safe repo-relative `/`-path, or reject it: no absolute
/// paths, no `..` traversal, no glob/wildcard (a glob can't name one symbol's file), no
/// empty. The result is joined under `repo_root` so a verified read can never escape it.
fn safe_repo_relative(path: &str) -> Result<String, String> {
    let norm = path.trim().replace('\\', "/");
    if norm.is_empty() {
        return Err("empty path".to_string());
    }
    if norm.contains('*') || norm.contains('?') {
        return Err("a glob/wildcard path cannot name one symbol's file".to_string());
    }
    if norm.starts_with('/') || norm.contains(':') {
        return Err("absolute paths are not allowed".to_string());
    }
    if norm.split('/').any(|seg| seg == "..") {
        return Err("`..` path traversal is not allowed".to_string());
    }
    Ok(norm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::symbol_ownership::{ClaimMode, Confidence};

    fn target(path: &str, symbol: &str) -> PlannedSymbolTarget {
        PlannedSymbolTarget {
            path: path.to_string(),
            symbol: symbol.to_string(),
            mode: ClaimMode::Write,
        }
    }

    fn write(dir: &Path, rel: &str, body: &str) {
        let abs = dir.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(abs, body).unwrap();
    }

    #[test]
    fn verifies_an_existing_symbol_to_an_exact_parser_range() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "src/x.rs",
            "fn alpha() {\n    let _ = 1;\n}\n\nfn beta() {\n    let _ = 2;\n}\n",
        );
        let intent = verify_target(dir.path(), &target("src/x.rs", "beta")).unwrap();
        assert_eq!(intent.symbol, "beta");
        assert_eq!(intent.confidence, Confidence::Parser);
        assert_eq!(intent.range.start_line, 5); // beta is at lines 5-7
        assert_eq!(intent.range.end_line, 7);
    }

    #[test]
    fn rejects_missing_file_unknown_name_and_ambiguous() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "src/x.rs",
            "fn dup() {}\nfn dup() {}\nfn solo() {}\n",
        );
        assert!(verify_target(dir.path(), &target("src/missing.rs", "solo")).is_err());
        assert!(verify_target(dir.path(), &target("src/x.rs", "nope")).is_err());
        // Two `dup` -> ambiguous, can't prove an exact range.
        assert!(verify_target(dir.path(), &target("src/x.rs", "dup")).is_err());
        // ...but the unique one verifies.
        assert!(verify_target(dir.path(), &target("src/x.rs", "solo")).is_ok());
    }

    #[test]
    fn rejects_unsafe_paths() {
        assert!(safe_repo_relative("/etc/passwd").is_err());
        assert!(safe_repo_relative("C:/Windows/system32").is_err());
        assert!(safe_repo_relative("../../secrets.rs").is_err());
        assert!(safe_repo_relative("src/**").is_err());
        assert!(safe_repo_relative("").is_err());
        // A normal repo-relative path (incl. Windows separators) is accepted + normalized.
        assert_eq!(
            safe_repo_relative("src\\auth\\login.rs").unwrap(),
            "src/auth/login.rs"
        );
    }

    #[test]
    fn poison_drops_all_verified_symbols_on_a_file_with_any_failed_target() {
        // real + ghost both target src/x.rs; ghost fails -> the WHOLE file is poisoned, so
        // even the verified `real` is dropped (no PARTIAL unlock). The task falls back to
        // file-level for src/x.rs, and the ghost is reported as a diagnostic.
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/x.rs", "fn real() {\n    let _ = 1;\n}\n");
        let pt: PlannedTask = serde_json::from_str(
            r#"{"id":"t","title":"edit","owner":"w","outputs":["src/x.rs"],"source_branch":"feat/t","target_branch":"main",
                "symbol_targets":[{"path":"src/x.rs","symbol":"real","mode":"write"},{"path":"src/x.rs","symbol":"ghost","mode":"write"}]}"#,
        )
        .unwrap();
        assert_eq!(pt.symbol_targets.len(), 2);
        let (tasks, unresolved) = enrich_plan_with_symbols(dir.path(), vec![pt]);
        assert!(
            tasks[0].symbols.is_empty(),
            "poisoned file must keep NO symbols"
        );
        assert!(
            unresolved.iter().any(|u| u.contains("ghost")),
            "{unresolved:?}"
        );
    }

    #[test]
    fn a_verified_symbol_on_an_unpoisoned_file_survives() {
        // real on src/x.rs (verified) + ghost on a MISSING src/y.rs: only y.rs is poisoned,
        // so the verified real on x.rs is kept (cross-file failures don't nuke everything).
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "src/x.rs", "fn real() {\n    let _ = 1;\n}\n");
        let pt: PlannedTask = serde_json::from_str(
            r#"{"id":"t","title":"edit","owner":"w","outputs":["src/x.rs","src/y.rs"],"source_branch":"feat/t","target_branch":"main",
                "symbol_targets":[{"path":"src/x.rs","symbol":"real","mode":"write"},{"path":"src/y.rs","symbol":"ghost","mode":"write"}]}"#,
        )
        .unwrap();
        let (tasks, unresolved) = enrich_plan_with_symbols(dir.path(), vec![pt]);
        assert_eq!(tasks[0].symbols.len(), 1);
        assert_eq!(tasks[0].symbols[0].symbol, "real");
        assert_eq!(tasks[0].symbols[0].confidence, Confidence::Parser);
        assert!(
            unresolved.iter().any(|u| u.contains("ghost")),
            "{unresolved:?}"
        );
    }
}
