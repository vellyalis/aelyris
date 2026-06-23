//! Active-ownership context (spec §6.4/§6.6) — the SINGLE source that turns the live
//! [`super::SymbolOwnership`] map into the "do not edit" claims an agent about to touch
//! some files needs to know about. ONE builder + renderer feeds every consumer (the
//! dispatch prompt, the steer-avoidance verb, the frontend Orchestra prompt, shared-brain
//! snapshots) so the wording and semantics never drift across faces.
//!
//! Pure: it takes a snapshot of CURRENTLY-LIVE claims (the caller already swept expiry)
//! and returns a deterministic, bounded context. A "no claims" result is NOT a license to
//! parallelize — it only means nothing is known; the dispatch gate still serializes
//! overlapping files via file ownership (the conservative floor).

use super::{ClaimMode, Confidence, SymbolClaim, SymbolRange};
use crate::file_ownership::patterns_overlap;

/// Default cap on entries surfaced into a prompt — bounds the context so a busy file map
/// can't blow an agent's prompt; the remainder is summarized as a count.
pub const DEFAULT_CONTEXT_CAP: usize = 30;

/// One other-party WRITE claim on a file the subject agent is about to touch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnershipEntry {
    pub agent_id: String,
    pub symbol: String,
    pub path: String,
    pub range: SymbolRange,
    pub confidence: Confidence,
}

/// The deterministic, bounded set of other-party claims relevant to a set of files.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OwnershipContext {
    pub entries: Vec<OwnershipEntry>,
    /// How many relevant entries were dropped by the cap (0 = none).
    pub truncated: usize,
}

/// Build the active-ownership context for an agent about to work on `files`: the live
/// WRITE claims held by OTHERS — excluding `exclude_agent` and `exclude_task` (the
/// subject's own identity / task, so it isn't warned off its own ranges) — on any file
/// overlapping `files`. Deterministic order (path, range, agent), capped at `cap`.
/// `claims` is a snapshot of CURRENTLY-LIVE claims (expiry already swept by the caller).
pub fn active_ownership_context(
    claims: &[SymbolClaim],
    exclude_agent: Option<&str>,
    exclude_task: Option<&str>,
    files: &[String],
    cap: usize,
) -> OwnershipContext {
    let mut entries: Vec<OwnershipEntry> = claims
        .iter()
        // Only WRITE claims drive a "do not edit" — read/review/test don't conflict.
        .filter(|c| matches!(c.mode, ClaimMode::Write))
        .filter(|c| exclude_agent != Some(c.agent_id.as_str()))
        .filter(|c| exclude_task.is_none() || c.task_id.as_deref() != exclude_task)
        .filter(|c| files.iter().any(|f| paths_relevant(f, &c.path)))
        .map(|c| OwnershipEntry {
            agent_id: c.agent_id.clone(),
            symbol: c.symbol.clone(),
            path: c.path.clone(),
            range: c.range,
            confidence: c.confidence,
        })
        .collect();
    entries.sort_by(|a, b| {
        (
            a.path.as_str(),
            a.range.start_line,
            a.range.end_line,
            a.agent_id.as_str(),
        )
            .cmp(&(
                b.path.as_str(),
                b.range.start_line,
                b.range.end_line,
                b.agent_id.as_str(),
            ))
    });
    let truncated = entries.len().saturating_sub(cap);
    entries.truncate(cap);
    OwnershipContext { entries, truncated }
}

/// Is `claim_path` within the agent's `output` lane? Reuses the file-ownership overlap
/// rule (which is separator-agnostic and handles concrete==concrete and glob-vs-concrete)
/// so the prompt's notion of "your files" matches the dispatch gate's exactly.
fn paths_relevant(output: &str, claim_path: &str) -> bool {
    patterns_overlap(output, claim_path)
}

fn confidence_label(c: Confidence) -> &'static str {
    match c {
        Confidence::Lsp => "lsp",
        Confidence::Parser => "parser",
        Confidence::DiffHunk => "diff-hunk",
    }
}

/// Render the context as a prompt header — `None` when empty, so the caller injects
/// nothing rather than an empty section. Deterministic text: the ONE wording shared
/// across the backend prompt, the steer verb, and the frontend Orchestra prompt.
pub fn render_ownership_header(ctx: &OwnershipContext) -> Option<String> {
    if ctx.entries.is_empty() {
        return None;
    }
    let mut s = String::from(
        "[Active symbol ownership — do NOT edit these ranges; another agent owns them]\n",
    );
    for e in &ctx.entries {
        s.push_str(&format!(
            "- @{} owns {} in {} (lines {}-{}, {})\n",
            e.agent_id,
            e.symbol,
            e.path,
            e.range.start_line,
            e.range.end_line,
            confidence_label(e.confidence),
        ));
    }
    if ctx.truncated > 0 {
        s.push_str(&format!(
            "- …and {} more active claim(s) not shown\n",
            ctx.truncated
        ));
    }
    s.push('\n');
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Flat arg list reads clearer than a struct-update dance for these test claims.
    #[allow(clippy::too_many_arguments)]
    fn claim(
        agent: &str,
        task: Option<&str>,
        path: &str,
        sym: &str,
        s: u32,
        e: u32,
        mode: ClaimMode,
        conf: Confidence,
    ) -> SymbolClaim {
        SymbolClaim {
            claim_id: format!("{agent}:{path}:{sym}"),
            agent_id: agent.to_string(),
            task_id: task.map(String::from),
            path: path.to_string(),
            symbol: sym.to_string(),
            range: SymbolRange::new(s, e),
            mode,
            lease_expires_at: u64::MAX,
            confidence: conf,
        }
    }

    fn files(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn excludes_self_by_agent_and_by_task_keeps_others() {
        let claims = vec![
            claim(
                "me",
                Some("t1"),
                "src/x.rs",
                "mine",
                1,
                5,
                ClaimMode::Write,
                Confidence::Parser,
            ),
            claim(
                "you",
                Some("t2"),
                "src/x.rs",
                "yours",
                10,
                20,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
        ];
        // Exclude by agent: only "you" remains.
        let ctx = active_ownership_context(&claims, Some("me"), None, &files(&["src/x.rs"]), 30);
        assert_eq!(ctx.entries.len(), 1);
        assert_eq!(ctx.entries[0].agent_id, "you");
        // Exclude by task id: same result.
        let ctx2 = active_ownership_context(&claims, None, Some("t1"), &files(&["src/x.rs"]), 30);
        assert_eq!(ctx2.entries.len(), 1);
        assert_eq!(ctx2.entries[0].symbol, "yours");
    }

    #[test]
    fn only_write_claims_and_only_relevant_files() {
        let claims = vec![
            claim(
                "a",
                None,
                "src/x.rs",
                "w",
                1,
                5,
                ClaimMode::Write,
                Confidence::Parser,
            ),
            claim(
                "a",
                None,
                "src/x.rs",
                "r",
                6,
                9,
                ClaimMode::Read,
                Confidence::Parser,
            ), // not a write
            claim(
                "a",
                None,
                "src/other.rs",
                "w2",
                1,
                5,
                ClaimMode::Write,
                Confidence::Parser,
            ), // other file
        ];
        let ctx = active_ownership_context(&claims, None, None, &files(&["src/x.rs"]), 30);
        assert_eq!(ctx.entries.len(), 1);
        assert_eq!(ctx.entries[0].symbol, "w");
    }

    #[test]
    fn glob_output_matches_claims_under_it() {
        let claims = vec![claim(
            "a",
            None,
            "src/auth/login.rs",
            "f",
            1,
            5,
            ClaimMode::Write,
            Confidence::Lsp,
        )];
        // A glob output lane sees a concrete claim under it.
        let ctx = active_ownership_context(&claims, None, None, &files(&["src/**"]), 30);
        assert_eq!(ctx.entries.len(), 1);
        // A disjoint lane sees nothing.
        let ctx2 = active_ownership_context(&claims, None, None, &files(&["docs/**"]), 30);
        assert!(ctx2.entries.is_empty());
    }

    #[test]
    fn windows_style_output_matches_a_normalized_claim_path() {
        let claims = vec![claim(
            "a",
            None,
            "src/auth.rs",
            "f",
            1,
            5,
            ClaimMode::Write,
            Confidence::Lsp,
        )];
        // A task output spelled with `\` still surfaces the `/`-stored claim.
        let ctx = active_ownership_context(&claims, None, None, &files(&["src\\auth.rs"]), 30);
        assert_eq!(ctx.entries.len(), 1);
    }

    #[test]
    fn deterministic_order_and_cap_with_truncation_count() {
        let claims = vec![
            claim(
                "b",
                None,
                "src/x.rs",
                "s2",
                40,
                50,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            claim(
                "a",
                None,
                "src/x.rs",
                "s1",
                10,
                20,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            claim(
                "c",
                None,
                "src/x.rs",
                "s3",
                60,
                70,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
        ];
        let ctx = active_ownership_context(&claims, None, None, &files(&["src/x.rs"]), 2);
        // Sorted by range start -> s1(10), s2(40); s3(60) dropped by the cap.
        assert_eq!(ctx.entries.len(), 2);
        assert_eq!(ctx.entries[0].symbol, "s1");
        assert_eq!(ctx.entries[1].symbol, "s2");
        assert_eq!(ctx.truncated, 1);
    }

    #[test]
    fn render_is_none_when_empty_and_lists_claims_with_confidence_otherwise() {
        assert!(render_ownership_header(&OwnershipContext::default()).is_none());
        let claims = vec![claim(
            "a",
            None,
            "src/x.rs",
            "foo",
            10,
            20,
            ClaimMode::Write,
            Confidence::DiffHunk,
        )];
        let ctx = active_ownership_context(&claims, None, None, &files(&["src/x.rs"]), 30);
        let header = render_ownership_header(&ctx).unwrap();
        assert!(header.contains("do NOT edit"));
        assert!(header.contains("@a owns foo in src/x.rs (lines 10-20, diff-hunk)"));
    }
}
