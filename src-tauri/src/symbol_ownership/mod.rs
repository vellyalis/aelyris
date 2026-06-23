//! Symbol Ownership — range-based claims for same-file parallel work.
//!
//! See docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md §6.2-6.3. File ownership
//! ([`crate::file_ownership`]) is necessary but too coarse for "parallel and
//! fast": two agents should be allowed to write the SAME file when they own
//! DISJOINT line ranges, while overlapping ranges must conflict loudly. This
//! module is that finer layer — it sits ON TOP of file ownership (the file gate
//! stays the conservative fallback), and adds three things file ownership lacks:
//!
//!   1. **Ranges** — claims carry an inclusive line range, so disjoint symbols in
//!      one file are parallel-safe and only true range overlaps collide.
//!   2. **Leases** — a claim is dead once `now > lease_expires_at`; it must be
//!      refreshed (file-watcher / tool event / heartbeat) to stay live, so a
//!      crashed agent's claims self-release instead of stranding a lane.
//!   3. **Confidence** — Lsp/Parser ranges are EXACT, so a write overlap is a hard
//!      `Block`; DiffHunk ranges are inferred, so a write overlap only `Warn`s
//!      (spec §6.2: "low-confidence inferred claims warn but do not hard-block").
//!
//! The store is a pure data structure (no I/O, no locks) so it can be wrapped as
//! shared state and unit-tested deterministically (`now` is always injected).

use serde::{Deserialize, Serialize};

/// Inclusive line range `[start_line, end_line]` (1-based, editor-style). The
/// symbol extractors normalize each source (LSP's 0-based, parser, diff-hunk)
/// into this one convention so overlap is comparable across confidence tiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolRange {
    pub start_line: u32,
    pub end_line: u32,
}

impl SymbolRange {
    /// Build a range, normalizing so `start <= end` — a caller that swaps the
    /// bounds cannot accidentally hide an overlap behind an inverted range.
    pub fn new(start_line: u32, end_line: u32) -> Self {
        if start_line <= end_line {
            Self {
                start_line,
                end_line,
            }
        } else {
            Self {
                start_line: end_line,
                end_line: start_line,
            }
        }
    }

    /// Inclusive overlap: the two ranges share at least one line.
    pub fn overlaps(&self, other: &SymbolRange) -> bool {
        self.start_line <= other.end_line && other.start_line <= self.end_line
    }
}

/// What the agent intends with the range (spec §6.1). Only `Write` drives a
/// collision; `Read`/`Review`/`Test` overlapping each other is harmless.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClaimMode {
    Write,
    Review,
    Test,
    Read,
}

/// How the symbol range was derived (spec §6.3 extraction tiers). Exact tiers
/// (`Lsp`/`Parser`) know the symbol boundary, so a write overlap hard-blocks;
/// `DiffHunk` is inferred from a changed line span, so a write overlap only warns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Lsp,
    Parser,
    DiffHunk,
}

impl Confidence {
    /// Exact symbol boundaries are known (vs an inferred line span).
    fn is_exact(self) -> bool {
        matches!(self, Confidence::Lsp | Confidence::Parser)
    }
}

/// A live claim that `agent_id` owns `symbol` at `range` in `path`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolClaim {
    pub claim_id: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub path: String,
    pub symbol: String,
    pub range: SymbolRange,
    pub mode: ClaimMode,
    /// Unix seconds; the claim is dead once `now > lease_expires_at`.
    pub lease_expires_at: u64,
    pub confidence: Confidence,
}

impl SymbolClaim {
    fn is_live(&self, now: u64) -> bool {
        now <= self.lease_expires_at
    }
}

/// Whether an overlap blocks dispatch or is only surfaced as a warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictSeverity {
    Block,
    Warn,
}

/// Two cross-agent claims whose ranges overlap in the same file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolConflict {
    pub severity: ConflictSeverity,
    pub path: String,
    pub agent_a: String,
    pub symbol_a: String,
    pub range_a: SymbolRange,
    pub agent_b: String,
    pub symbol_b: String,
    pub range_b: SymbolRange,
}

/// Outcome of attempting a claim against the live ownership map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase", tag = "outcome")]
pub enum ClaimOutcome {
    /// No overlapping live claim by another agent — the claim is recorded.
    Granted,
    /// At least one `Block`-severity overlap — the claim is REJECTED (not
    /// recorded); the agent must wait or pick a disjoint range.
    Blocked { conflicts: Vec<SymbolConflict> },
    /// Only `Warn`-severity overlaps (an inferred range) — the claim IS recorded,
    /// but peers are told to coordinate (spec: warn, do not hard-block).
    Warned { conflicts: Vec<SymbolConflict> },
}

/// The shared symbol-ownership map. Pure: callers inject `now` and hold their own
/// lock.
#[derive(Debug, Default)]
pub struct SymbolOwnership {
    claims: Vec<SymbolClaim>,
}

/// The conflict between two claims, if any. Pure and symmetric in severity. A
/// pair conflicts only when: different agents, same path, overlapping ranges, and
/// at least one side is a `Write` (read/review/test overlaps are harmless). The
/// overlap `Block`s only when BOTH ranges are exact (Lsp/Parser); if either is an
/// inferred `DiffHunk` span it `Warn`s instead (spec §6.2).
fn conflict_between(a: &SymbolClaim, b: &SymbolClaim) -> Option<SymbolConflict> {
    if a.agent_id == b.agent_id || a.path != b.path || !a.range.overlaps(&b.range) {
        return None;
    }
    let involves_write = matches!(a.mode, ClaimMode::Write) || matches!(b.mode, ClaimMode::Write);
    if !involves_write {
        return None;
    }
    let severity = if a.confidence.is_exact() && b.confidence.is_exact() {
        ConflictSeverity::Block
    } else {
        ConflictSeverity::Warn
    };
    Some(SymbolConflict {
        severity,
        path: a.path.clone(),
        agent_a: a.agent_id.clone(),
        symbol_a: a.symbol.clone(),
        range_a: a.range,
        agent_b: b.agent_id.clone(),
        symbol_b: b.symbol.clone(),
        range_b: b.range,
    })
}

impl SymbolOwnership {
    pub fn new() -> Self {
        Self::default()
    }

    /// Try to record `claim`. A `Block`-severity overlap rejects it (left
    /// unrecorded); a `Warn`-only overlap records it but reports the warning;
    /// no overlap is a clean `Granted`. Expired claims never participate.
    pub fn claim(&mut self, claim: SymbolClaim, now: u64) -> ClaimOutcome {
        let conflicts: Vec<SymbolConflict> = self
            .claims
            .iter()
            .filter(|existing| existing.is_live(now))
            .filter_map(|existing| conflict_between(&claim, existing))
            .collect();
        if conflicts
            .iter()
            .any(|c| c.severity == ConflictSeverity::Block)
        {
            return ClaimOutcome::Blocked { conflicts };
        }
        self.claims.push(claim);
        if conflicts.is_empty() {
            ClaimOutcome::Granted
        } else {
            ClaimOutcome::Warned { conflicts }
        }
    }

    /// Would this prospective claim be blocked? Pure read — used by the scheduler
    /// to decide co-dispatch WITHOUT recording anything. Returns the blocking
    /// conflicts (empty = safe to dispatch).
    pub fn blocking_conflicts(&self, claim: &SymbolClaim, now: u64) -> Vec<SymbolConflict> {
        self.claims
            .iter()
            .filter(|existing| existing.is_live(now))
            .filter_map(|existing| conflict_between(claim, existing))
            .filter(|c| c.severity == ConflictSeverity::Block)
            .collect()
    }

    /// Extend a live claim's lease to `now + lease_secs`. Returns whether a live
    /// claim with `claim_id` was found (an already-expired claim is not revived).
    pub fn refresh(&mut self, claim_id: &str, now: u64, lease_secs: u64) -> bool {
        if let Some(claim) = self
            .claims
            .iter_mut()
            .find(|c| c.claim_id == claim_id && c.is_live(now))
        {
            claim.lease_expires_at = now.saturating_add(lease_secs);
            true
        } else {
            false
        }
    }

    /// Drop the claim with `claim_id`; returns whether one was removed.
    pub fn release(&mut self, claim_id: &str) -> bool {
        let before = self.claims.len();
        self.claims.retain(|c| c.claim_id != claim_id);
        self.claims.len() != before
    }

    /// Release every claim for `task_id` (a task merged/failed). Returns the count.
    pub fn release_for_task(&mut self, task_id: &str) -> usize {
        let before = self.claims.len();
        self.claims
            .retain(|c| c.task_id.as_deref() != Some(task_id));
        before - self.claims.len()
    }

    /// Release every claim held by `agent_id` (an agent exited). Returns the count.
    pub fn release_for_agent(&mut self, agent_id: &str) -> usize {
        let before = self.claims.len();
        self.claims.retain(|c| c.agent_id != agent_id);
        before - self.claims.len()
    }

    /// Drop expired claims (lease lapsed). Returns the ids removed so the caller
    /// can publish `FileReleased`-style events for them.
    pub fn expire(&mut self, now: u64) -> Vec<String> {
        let (dead, live): (Vec<_>, Vec<_>) = std::mem::take(&mut self.claims)
            .into_iter()
            .partition(|c| !c.is_live(now));
        self.claims = live;
        dead.into_iter().map(|c| c.claim_id).collect()
    }

    /// All live claims (lease not lapsed).
    pub fn live_claims(&self, now: u64) -> Vec<&SymbolClaim> {
        self.claims.iter().filter(|c| c.is_live(now)).collect()
    }

    /// Live claims touching `path` — the per-file view a pane header renders.
    pub fn claims_for_path<'a>(&'a self, path: &str, now: u64) -> Vec<&'a SymbolClaim> {
        self.claims
            .iter()
            .filter(|c| c.is_live(now) && c.path == path)
            .collect()
    }

    /// Every live cross-agent overlap (Block and Warn), for surfacing in the UI
    /// conflict badge / agent rail. Each unordered pair appears once.
    pub fn conflicts(&self, now: u64) -> Vec<SymbolConflict> {
        let live: Vec<&SymbolClaim> = self.live_claims(now);
        let mut out = Vec::new();
        for (i, a) in live.iter().enumerate() {
            for b in &live[i + 1..] {
                if let Some(conflict) = conflict_between(a, b) {
                    out.push(conflict);
                }
            }
        }
        out
    }
}

/// A task's DECLARED intent to own a symbol range — the plan-time counterpart of
/// a runtime [`SymbolClaim`] (no lease / agent / claim id yet). The scheduler
/// gates co-dispatch on these so two tasks editing one file on disjoint symbols
/// run in parallel while overlapping ones serialize.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolIntent {
    pub path: String,
    pub symbol: String,
    pub range: SymbolRange,
    pub mode: ClaimMode,
    pub confidence: Confidence,
}

/// Do two DECLARED intents (by different tasks) collide hard enough to BLOCK
/// co-dispatch? Same path, overlapping ranges, at least one `Write`, and BOTH
/// ranges exact (Lsp/Parser) — the dispatch-gate mirror of the runtime `Block`
/// tier. Inferred (`DiffHunk`) intents never block dispatch (they warn at
/// runtime instead), and disjoint ranges / different files are parallel-safe.
pub fn intents_block(a: &SymbolIntent, b: &SymbolIntent) -> bool {
    a.path == b.path
        && a.range.overlaps(&b.range)
        && (matches!(a.mode, ClaimMode::Write) || matches!(b.mode, ClaimMode::Write))
        && a.confidence.is_exact()
        && b.confidence.is_exact()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(path: &str, s: u32, e: u32, mode: ClaimMode, conf: Confidence) -> SymbolIntent {
        SymbolIntent {
            path: path.to_string(),
            symbol: "f".to_string(),
            range: SymbolRange::new(s, e),
            mode,
            confidence: conf,
        }
    }

    #[test]
    fn intents_block_only_on_exact_overlapping_writes() {
        // exact + overlapping ranges + a write -> blocks co-dispatch
        assert!(intents_block(
            &intent("x", 1, 10, ClaimMode::Write, Confidence::Lsp),
            &intent("x", 5, 15, ClaimMode::Write, Confidence::Parser),
        ));
        // disjoint ranges in the same file -> parallel-safe
        assert!(!intents_block(
            &intent("x", 1, 10, ClaimMode::Write, Confidence::Lsp),
            &intent("x", 11, 20, ClaimMode::Write, Confidence::Lsp),
        ));
        // different files -> never blocks
        assert!(!intents_block(
            &intent("x", 1, 10, ClaimMode::Write, Confidence::Lsp),
            &intent("y", 1, 10, ClaimMode::Write, Confidence::Lsp),
        ));
        // inferred (diff-hunk) range -> does not block dispatch (warns at runtime)
        assert!(!intents_block(
            &intent("x", 1, 10, ClaimMode::Write, Confidence::DiffHunk),
            &intent("x", 5, 15, ClaimMode::Write, Confidence::Lsp),
        ));
        // read-only overlap -> not a write collision
        assert!(!intents_block(
            &intent("x", 1, 10, ClaimMode::Read, Confidence::Lsp),
            &intent("x", 5, 15, ClaimMode::Read, Confidence::Lsp),
        ));
    }

    const HOUR: u64 = 3_600;

    // Test builder: every field is meaningful per case, so a flat arg list reads
    // clearer than a struct-update dance.
    #[allow(clippy::too_many_arguments)]
    fn claim(
        id: &str,
        agent: &str,
        path: &str,
        symbol: &str,
        start: u32,
        end: u32,
        mode: ClaimMode,
        confidence: Confidence,
    ) -> SymbolClaim {
        SymbolClaim {
            claim_id: id.to_string(),
            agent_id: agent.to_string(),
            task_id: Some(format!("task-{agent}")),
            path: path.to_string(),
            symbol: symbol.to_string(),
            range: SymbolRange::new(start, end),
            mode,
            lease_expires_at: HOUR, // live while now <= 3600 in these tests
            confidence,
        }
    }

    #[test]
    fn range_overlap_is_inclusive_and_order_independent() {
        assert!(SymbolRange::new(10, 20).overlaps(&SymbolRange::new(20, 30))); // touch at 20
        assert!(SymbolRange::new(10, 20).overlaps(&SymbolRange::new(15, 18))); // nested
        assert!(!SymbolRange::new(10, 20).overlaps(&SymbolRange::new(21, 30))); // disjoint
                                                                                // Inverted bounds normalize, so an overlap can't be hidden by swapping.
        assert_eq!(SymbolRange::new(30, 10), SymbolRange::new(10, 30));
        assert!(SymbolRange::new(30, 10).overlaps(&SymbolRange::new(15, 18)));
    }

    #[test]
    fn disjoint_symbols_same_file_are_parallel_safe() {
        let mut own = SymbolOwnership::new();
        assert_eq!(
            own.claim(
                claim(
                    "c1",
                    "a",
                    "src/x.rs",
                    "foo",
                    1,
                    20,
                    ClaimMode::Write,
                    Confidence::Lsp
                ),
                0,
            ),
            ClaimOutcome::Granted,
        );
        // Same file, disjoint range -> still Granted (the whole point of §6.2).
        assert_eq!(
            own.claim(
                claim(
                    "c2",
                    "b",
                    "src/x.rs",
                    "bar",
                    40,
                    60,
                    ClaimMode::Write,
                    Confidence::Lsp
                ),
                0,
            ),
            ClaimOutcome::Granted,
        );
        assert_eq!(own.live_claims(0).len(), 2);
    }

    #[test]
    fn overlapping_exact_writes_block_and_are_not_recorded() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        let outcome = own.claim(
            claim(
                "c2",
                "b",
                "src/x.rs",
                "foo2",
                25,
                40,
                ClaimMode::Write,
                Confidence::Parser,
            ),
            0,
        );
        match outcome {
            ClaimOutcome::Blocked { conflicts } => {
                assert_eq!(conflicts.len(), 1);
                assert_eq!(conflicts[0].severity, ConflictSeverity::Block);
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
        // The blocked claim must NOT be recorded.
        assert_eq!(own.live_claims(0).len(), 1);
    }

    #[test]
    fn low_confidence_overlap_warns_but_records() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::DiffHunk,
            ),
            0,
        );
        let outcome = own.claim(
            claim(
                "c2",
                "b",
                "src/x.rs",
                "bar",
                20,
                40,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        match outcome {
            ClaimOutcome::Warned { conflicts } => {
                assert_eq!(conflicts[0].severity, ConflictSeverity::Warn);
            }
            other => panic!("expected Warned, got {other:?}"),
        }
        // Warn does NOT block -> the claim is still recorded.
        assert_eq!(own.live_claims(0).len(), 2);
    }

    #[test]
    fn read_only_overlap_is_not_a_conflict() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Read,
                Confidence::Lsp,
            ),
            0,
        );
        assert_eq!(
            own.claim(
                claim(
                    "c2",
                    "b",
                    "src/x.rs",
                    "foo",
                    10,
                    30,
                    ClaimMode::Read,
                    Confidence::Lsp
                ),
                0,
            ),
            ClaimOutcome::Granted,
        );
    }

    #[test]
    fn same_agent_overlap_is_never_a_conflict() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        assert_eq!(
            own.claim(
                claim(
                    "c2",
                    "a",
                    "src/x.rs",
                    "foo",
                    10,
                    30,
                    ClaimMode::Write,
                    Confidence::Lsp
                ),
                0,
            ),
            ClaimOutcome::Granted,
        );
    }

    #[test]
    fn different_files_never_conflict() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        assert_eq!(
            own.claim(
                claim(
                    "c2",
                    "b",
                    "src/y.rs",
                    "foo",
                    10,
                    30,
                    ClaimMode::Write,
                    Confidence::Lsp
                ),
                0,
            ),
            ClaimOutcome::Granted,
        );
    }

    #[test]
    fn expired_claim_does_not_conflict_and_is_swept() {
        let mut own = SymbolOwnership::new();
        // Lease expires at 3600.
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        // At now=4000 the prior claim is dead, so an overlapping write is Granted.
        // c2 carries a FUTURE lease so it stays live past now=4000.
        let mut c2 = claim(
            "c2",
            "b",
            "src/x.rs",
            "foo",
            10,
            30,
            ClaimMode::Write,
            Confidence::Lsp,
        );
        c2.lease_expires_at = 4_000 + HOUR;
        assert_eq!(own.claim(c2, 4_000), ClaimOutcome::Granted);
        // expire() drops only the dead one (c1) and returns its id; c2 survives.
        let dead = own.expire(4_000);
        assert_eq!(dead, vec!["c1".to_string()]);
        assert_eq!(own.live_claims(4_000).len(), 1);
    }

    #[test]
    fn refresh_extends_a_live_lease_but_not_an_expired_one() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        assert!(own.refresh("c1", 100, HOUR)); // live at 100 -> lease becomes 3700
        assert!(own.live_claims(3_700).iter().any(|c| c.claim_id == "c1"));
        // Once expired, refresh fails (a crashed agent's lane self-releases).
        assert!(!own.refresh("c1", 9_999, HOUR));
        assert!(!own.refresh("missing", 0, HOUR));
    }

    #[test]
    fn release_paths_drop_claims() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        own.claim(
            claim(
                "c2",
                "a",
                "src/y.rs",
                "bar",
                1,
                5,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        assert!(own.release("c1"));
        assert!(!own.release("c1")); // already gone
        assert_eq!(own.release_for_agent("a"), 1); // c2 remains under agent a
        assert_eq!(own.live_claims(0).len(), 0);
    }

    #[test]
    fn release_for_task_frees_all_of_a_tasks_claims() {
        let mut own = SymbolOwnership::new();
        let mut c1 = claim(
            "c1",
            "a",
            "src/x.rs",
            "foo",
            10,
            30,
            ClaimMode::Write,
            Confidence::Lsp,
        );
        c1.task_id = Some("task-1".into());
        let mut c2 = claim(
            "c2",
            "a",
            "src/y.rs",
            "bar",
            1,
            5,
            ClaimMode::Write,
            Confidence::Lsp,
        );
        c2.task_id = Some("task-1".into());
        own.claim(c1, 0);
        own.claim(c2, 0);
        assert_eq!(own.release_for_task("task-1"), 2);
        assert_eq!(own.live_claims(0).len(), 0);
    }

    #[test]
    fn blocking_conflicts_is_a_pure_check_that_records_nothing() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::Lsp,
            ),
            0,
        );
        let probe = claim(
            "c2",
            "b",
            "src/x.rs",
            "foo",
            20,
            40,
            ClaimMode::Write,
            Confidence::Lsp,
        );
        assert_eq!(own.blocking_conflicts(&probe, 0).len(), 1);
        // The probe was not recorded.
        assert_eq!(own.live_claims(0).len(), 1);
    }

    #[test]
    fn conflicts_lists_each_live_pair_once() {
        let mut own = SymbolOwnership::new();
        own.claim(
            claim(
                "c1",
                "a",
                "src/x.rs",
                "foo",
                10,
                30,
                ClaimMode::Write,
                Confidence::DiffHunk,
            ),
            0,
        );
        // Warn-level overlap so both are recorded.
        own.claim(
            claim(
                "c2",
                "b",
                "src/x.rs",
                "bar",
                20,
                40,
                ClaimMode::Write,
                Confidence::DiffHunk,
            ),
            0,
        );
        let conflicts = own.conflicts(0);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].severity, ConflictSeverity::Warn);
        assert_eq!(own.claims_for_path("src/x.rs", 0).len(), 2);
    }
}
